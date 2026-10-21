/**
 * Palantir Hub'ni Railway'ga joylash (bir marta; qayta ishga tushirsa — yangilaydi):  npm run hub:deploy
 *   loyiha «palantir-hub», xizmat «hub» (hub/ papkasi, hub/railway.json), doimiy disk /data (baza, zaxiralar), Railway domeni,
 *   o'zgaruvchilar (HUB_DB, HUB_PUBLIC_URL, HUB_TRUST_PROXY, HUB_VERIFY_TOKEN, HUB_ADMIN_KEY, HUB_OPERATOR va bor bo'lsa —
 *   HUB_CONTACT_EMAIL, IG_APP_ID, IG_APP_SECRET, HUB_BOT_TOKEN, HUB_ALERT_CHAT), joylash va /health kutish.
 * Sirlar (admin kaliti, webhook tasdiq tokeni) bir marta yaratiladi va shu kompyuterda ~/.palantir/hub.env da turadi (0600).
 * Kerak: Railway CLI va kirilgan hisob (`railway login`). Ixtiyoriy qiymatlar — muhitdan: HUB_CONTACT_EMAIL=… npm run hub:deploy
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HUB_DIR = resolve('hub');
const SECRETS = join(homedir(), '.palantir', 'hub.env');
const PROJECT = 'palantir-hub', SERVICE = 'hub';

const railway = (args: string[], opts: { quiet?: boolean } = {}): string => {
  try {
    return execFileSync('railway', args, { cwd: HUB_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'pipe' : 'inherit'] });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`railway ${args.join(' ')}: ${(err.stderr || err.stdout || err.message).trim().slice(0, 400)}`);
  }
};
const step = (s: string) => console.log(`\n== ${s}`);

function secrets(): Record<string, string> {
  const saved: Record<string, string> = {};
  if (existsSync(SECRETS)) for (const line of readFileSync(SECRETS, 'utf8').split('\n')) { const i = line.indexOf('='); if (i > 0) saved[line.slice(0, i)] = line.slice(i + 1).trim(); }
  saved.HUB_ADMIN_KEY ||= randomBytes(24).toString('base64url');
  saved.HUB_VERIFY_TOKEN ||= randomBytes(18).toString('base64url');
  mkdirSync(join(homedir(), '.palantir'), { recursive: true, mode: 0o700 });
  writeFileSync(SECRETS, Object.entries(saved).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(SECRETS, 0o600);
  return saved;
}

step('Railway hisobi');
console.log(railway(['whoami'], { quiet: true }).trim());

step('Loyiha va xizmat');
let linked = true;
try { railway(['status', '--json'], { quiet: true }); } catch { linked = false; }
if (!linked) railway(['init', '--name', PROJECT]);
// Qayta ishga tushirilganda xizmat allaqachon bor — xato emas
try { railway(['add', '--service', SERVICE], { quiet: true }); } catch (e) { if (!/exist|already|taken|mavjud/i.test((e as Error).message)) throw e; }
railway(['link', '--service', SERVICE], { quiet: true });

step('Doimiy disk (/data — baza va zaxiralar)');
try { railway(['volume', 'add', '--service', SERVICE, '--mount-path', '/data'], { quiet: true }); console.log('qo\'shildi'); }
catch (e) { console.log(/already|exists|mavjud/i.test((e as Error).message) ? 'bor' : `o'tkazib yuborildi: ${(e as Error).message}`); }

step('Domen');
const domains = railway(['domain', '--service', SERVICE, '--json'], { quiet: true });
const host = /([a-z0-9-]+\.up\.railway\.app)/.exec(domains)?.[1];
if (!host) throw new Error(`Domen olinmadi: ${domains.slice(0, 200)}`);
const publicUrl = `https://${host}`;
console.log(publicUrl);

step("O'zgaruvchilar");
const s = secrets();
const vars: Record<string, string> = {
  HUB_DB: '/data/hub.db', HUB_PUBLIC_URL: publicUrl, HUB_TRUST_PROXY: '1', HUB_VERIFY_TOKEN: s.HUB_VERIFY_TOKEN, HUB_ADMIN_KEY: s.HUB_ADMIN_KEY,
  HUB_OPERATOR: process.env.HUB_OPERATOR || s.HUB_OPERATOR || 'Palantir',
};
for (const k of ['HUB_CONTACT_EMAIL', 'IG_APP_ID', 'IG_APP_SECRET', 'HUB_BOT_TOKEN', 'HUB_ALERT_CHAT']) { const v = process.env[k] || s[k]; if (v) vars[k] = v; }
railway(['variable', 'set', '--service', SERVICE, '--skip-deploys', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)], { quiet: true });
console.log(Object.keys(vars).join(', '));

step('Joylash (hub/ papkasi)');
railway(['up', '--service', SERVICE, '--ci']);

step('Tekshiruv');
let health: Record<string, unknown> | null = null;
for (let i = 0; i < 60 && !health; i++) {
  try { const r = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(10_000) }); if (r.ok) health = await r.json() as Record<string, unknown>; } catch { /* hali */ }
  if (!health) await new Promise(r => setTimeout(r, 5000));
}
if (!health) throw new Error(`${publicUrl}/health javob bermadi — Railway jurnalini qarang: railway logs --service ${SERVICE}`);
console.log(JSON.stringify(health));

console.log(`
Tayyor: ${publicUrl}
  Admin kaliti va webhook tasdiq tokeni: ${SECRETS}
  Meta ilovasi (docs/INSTAGRAM.md): OAuth ${publicUrl}/ig/callback · webhook ${publicUrl}/ig/webhook (token — HUB_VERIFY_TOKEN)
    deauthorize ${publicUrl}/ig/deauthorize · data deletion ${publicUrl}/ig/data-deletion · ${publicUrl}/privacy · ${publicUrl}/terms · ${publicUrl}/data-deletion
  Klinika kodi: curl -X POST ${publicUrl}/admin/clinics -H "Authorization: Bearer $(grep HUB_ADMIN_KEY ${SECRETS} | cut -d= -f2)" -d '{"name":"Klinika"}'
${health.legal ? '' : '  ! HUB_CONTACT_EMAIL berilmagan — Meta maxfiylik siyosatini aloqa manzilisiz qabul qilmaydi: HUB_CONTACT_EMAIL=… npm run hub:deploy\n'}${health.instagram ? '' : "  ! Meta ilovasi kalitlari (IG_APP_ID, IG_APP_SECRET) hali yo'q — Instagram'siz ishlaydi (nazorat, zaxira, masofadan kirish)\n"}`);
