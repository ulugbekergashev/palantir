/**
 * Jonli tekshiruv — ishlab turgan Palantir'ning har bir ulangan kanali HAQIQIY xizmatda sinaladi (server/live/check.ts):
 * Telegram bot, Claude, Instagram, Meta AI, post joylashga tayyorlik, DentaCRM, MicroSIP, telefon liniyasi, kameralar, Hub, disk.
 * Server o'z ulanishlari va brauzer seanslari bilan sinaydi — klinika xodimidan hech narsa so'ralmaydi; mijozga xabar ketmaydi.
 *
 *   npm run live                         hammasi
 *   npm run live -- instagram meta_ai    faqat shu kanallar
 *   npm run live -- --deep               Meta AI'ga ham savol beradi (bir-ikki daqiqa, kunlik chegaradan bitta)
 *   npm run live -- --biz=klinika1       faqat shu biznes (login yoki id)
 *
 * Server manzili — .env dagi PORT (yoki LIVE_URL=http://127.0.0.1:3200), parol — ADMIN_PASSWORD (bo'lmasa so'raladi, ekranga chiqmaydi).
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { LiveCheck } from '../src/types';
import { LIVE_CHANNELS, type LiveChannel } from '../src/lib/live';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const deep = args.includes('--deep');
const business = args.find(a => a.startsWith('--biz='))?.slice('--biz='.length);
const only = args.filter(a => !a.startsWith('--'));
const unknown = only.filter(a => !(LIVE_CHANNELS as readonly string[]).includes(a));
if (unknown.length) {
  console.error(`Noma'lum kanal: ${unknown.join(', ')}. Bor kanallar: ${LIVE_CHANNELS.join(', ')}`);
  process.exit(2);
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
  return new Promise(res => rl.question(question, a => { rl.close(); process.stdout.write('\n'); res(a.trim()); }));
}

const base = (process.env.LIVE_URL || `http://127.0.0.1:${Number(process.env.PORT) || 3200}`).replace(/\/$/, '');
const password = process.env.ADMIN_PASSWORD || await ask('Administrator paroli: ');

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10 * 60_000),
  }).catch(() => null);
  if (!r) throw new Error(`Palantir serveri javob bermadi (${base}) — server ishlayaptimi?`);
  const j = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `server ${r.status} qaytardi`);
  return j;
}

// Oddiy belgilar: Windows buyruq oynasi emoji'ni ko'rsatmaydi
const MARK: Record<LiveCheck['level'], string> = { ok: '[ OK ]', warn: '[  ! ]', fail: '[XATO]', off: '[ -- ]' };

try {
  const { token } = await post<{ token: string }>('/api/admin/login', { password });
  console.log(`Tekshirilyapti${deep ? ' (chuqur)' : ''}: ${only.length ? only.join(', ') : 'hamma kanallar'}…`);
  const { businesses } = await post<{ businesses: { id: string; name: string; checks: LiveCheck[] }[] }>(
    '/api/admin/live-check', { deep, only: only as LiveChannel[], ...(business ? { business } : {}) }, token);
  if (!businesses.length) console.log(business ? `«${business}» biznesi topilmadi` : 'Faol biznes yo\'q');
  let failed = 0;
  for (const b of businesses) {
    console.log(`\n${b.name}`);
    for (const c of b.checks) {
      if (c.level === 'fail') failed++;
      console.log(`${MARK[c.level]} ${c.label} — ${c.detail}${c.ms >= 1000 ? ` (${(c.ms / 1000).toFixed(1)} s)` : ''}`);
    }
  }
  console.log(failed ? `\n${failed} ta muammo — yuqoridagi [XATO] qatorlarini tuzating.` : '\nUlangan kanallarning hammasi ishlayapti.');
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(`[XATO] ${(e as Error).message}`);
  process.exitCode = 2;
}
