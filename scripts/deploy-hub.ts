/**
 * Palantir Hub'ni o'z serverimizga joylash (bir marta; qayta ishga tushirsa — yangilaydi):  npm run hub:deploy
 *   Server — SSH bilan kiriladigan istalgan Linux (hozir Oracle Cloud Always Free, oylik to'lovsiz). hub/ fayllari va
 *   hub/setup-server.sh yuklanadi va root sifatida bajariladi: swap, Node.js 24, Caddy (HTTPS avtomatik), palantir-hub xizmati.
 *   Sozlama serverda /etc/palantir-hub.env (0600): HUB_DB, HUB_PUBLIC_URL, HUB_TRUST_PROXY, HUB_VERIFY_TOKEN, HUB_ADMIN_KEY,
 *   HUB_OPERATOR va bor bo'lsa — HUB_CONTACT_EMAIL, IG_APP_ID, IG_APP_SECRET, HUB_BOT_TOKEN, HUB_ALERT_CHAT. Oxirida /health kutiladi.
 * Sirlar (admin kaliti, webhook tasdiq tokeni) va server manzili bir marta yoziladi — shu kompyuterda ~/.palantir/hub.env (0600):
 *   HUB_SSH=opc@<IP>, HUB_SSH_KEY (standart ~/.palantir/oracle-hub), HUB_DOMAIN (standart <IP>.sslip.io — domen sotib olmasdan HTTPS).
 * Kerak: ssh va scp (Git Bash'dagisi). Ixtiyoriy qiymatlar — muhitdan: HUB_SSH=opc@1.2.3.4 HUB_CONTACT_EMAIL=… npm run hub:deploy
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HUB_DIR = resolve('hub');
const FILES = ['server.ts', 'admin.ts', 'legal.ts', 'licenseKey.ts', 'package.json', 'setup-server.sh'];
/** Litsenziya imzolovchi kalit (npm run kalit ham shuni ishlatadi): bo'lsa — Hub'ga ham beriladi (bir bosishda aktivlashtirish) */
const LICENSE_KEY_FILE = join(homedir(), '.palantir', 'litsenziya.pem');
const SECRETS = join(homedir(), '.palantir', 'hub.env');
const UPLOAD = '/tmp/palantir-hub-upload';
const step = (s: string) => console.log(`\n== ${s}`);

function secrets(): Record<string, string> {
  const saved: Record<string, string> = {};
  if (existsSync(SECRETS)) for (const line of readFileSync(SECRETS, 'utf8').split('\n')) { const i = line.indexOf('='); if (i > 0) saved[line.slice(0, i)] = line.slice(i + 1).trim(); }
  saved.HUB_ADMIN_KEY ||= randomBytes(24).toString('base64url');
  saved.HUB_VERIFY_TOKEN ||= randomBytes(18).toString('base64url');
  for (const k of ['HUB_SSH', 'HUB_SSH_KEY', 'HUB_DOMAIN']) if (process.env[k]) saved[k] = process.env[k]!;
  mkdirSync(join(homedir(), '.palantir'), { recursive: true, mode: 0o700 });
  writeFileSync(SECRETS, Object.entries(saved).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(SECRETS, 0o600);
  return saved;
}

const s = secrets();
const target = s.HUB_SSH;
if (!target) throw new Error(`Server manzili yo'q: HUB_SSH=opc@<IP> npm run hub:deploy (keyin ${SECRETS} da qoladi)`);
const key = s.HUB_SSH_KEY || join(homedir(), '.palantir', 'oracle-hub');
const ip = target.split('@').pop()!;
const domain = s.HUB_DOMAIN || `${ip.replace(/\./g, '-')}.sslip.io`;
const publicUrl = `https://${domain}`;
const sshOpts = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20'];
const ssh = (command: string, input?: string) =>
  execFileSync('ssh', [...sshOpts, target, command], { input, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'] });

step(`Server: ${target}`);
ssh(`rm -rf ${UPLOAD} && mkdir -p ${UPLOAD}`);
execFileSync('scp', [...sshOpts, ...FILES.map(f => join(HUB_DIR, f)), `${target}:${UPLOAD}/`], { stdio: 'inherit' });

step("O'zgaruvchilar");
const vars: Record<string, string> = {
  PORT: '3400', HUB_DB: '/var/lib/palantir-hub/hub.db', HUB_PUBLIC_URL: publicUrl, HUB_TRUST_PROXY: '1',
  HUB_VERIFY_TOKEN: s.HUB_VERIFY_TOKEN, HUB_ADMIN_KEY: s.HUB_ADMIN_KEY, HUB_OPERATOR: process.env.HUB_OPERATOR || s.HUB_OPERATOR || 'Palantir',
};
for (const k of ['HUB_CONTACT_EMAIL', 'IG_APP_ID', 'IG_APP_SECRET', 'HUB_BOT_TOKEN', 'HUB_ALERT_CHAT']) { const v = process.env[k] || s[k]; if (v) vars[k] = v; }
// Muhit faylida qiymat bitta qatorda bo'lishi kerak — PEM emas, PKCS8 DER base64
if (existsSync(LICENSE_KEY_FILE)) vars.LICENSE_SIGNING_KEY = createPrivateKey(readFileSync(LICENSE_KEY_FILE, 'utf8')).export({ type: 'pkcs8', format: 'der' }).toString('base64');
// Sirlar buyruq qatoriga emas, stdin orqali (serverdagi jarayonlar ro'yxatida ko'rinmasin)
ssh("sudo sh -c 'umask 077; cat > /etc/palantir-hub.env'",Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(Object.keys(vars).join(', '));

step('Sozlash');
ssh(`sudo bash ${UPLOAD}/setup-server.sh ${domain} && rm -rf ${UPLOAD}`);

step('Tekshiruv (birinchi marta HTTPS sertifikati olinadi — bir daqiqagacha)');
let health: Record<string, unknown> | null = null;
for (let i = 0; i < 40 && !health; i++) {
  try { const r = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(10_000) }); if (r.ok) health = await r.json() as Record<string, unknown>; } catch { /* hali */ }
  if (!health) await new Promise(r => setTimeout(r, 5000));
}
if (!health) throw new Error(`${publicUrl}/health javob bermadi — serverda: sudo journalctl -u palantir-hub -u caddy -n 50`);
console.log(JSON.stringify(health));

console.log(`
Tayyor: ${publicUrl}
  Klinikalar va «Panelni ochish»: ${publicUrl}/admin — admin kaliti: ${SECRETS} dagi HUB_ADMIN_KEY
  Klinika kodi: curl -X POST ${publicUrl}/admin/clinics -H "Authorization: Bearer $(grep HUB_ADMIN_KEY ${SECRETS} | cut -d= -f2)" -d '{"name":"Klinika"}'
  Meta ilovasi (docs/INSTAGRAM.md): OAuth ${publicUrl}/ig/callback · webhook ${publicUrl}/ig/webhook (token — HUB_VERIFY_TOKEN)
    deauthorize ${publicUrl}/ig/deauthorize · data deletion ${publicUrl}/ig/data-deletion · ${publicUrl}/privacy · ${publicUrl}/terms · ${publicUrl}/data-deletion
${health.legal ? '' : '  ! HUB_CONTACT_EMAIL berilmagan — Meta maxfiylik siyosatini aloqa manzilisiz qabul qilmaydi: HUB_CONTACT_EMAIL=… npm run hub:deploy\n'}${health.instagram ? '' : "  ! Meta ilovasi kalitlari (IG_APP_ID, IG_APP_SECRET) hali yo'q — Instagram'siz ishlaydi (nazorat, zaxira, masofadan kirish)\n"}`);
