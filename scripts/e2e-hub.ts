/**
 * Hub nazorati sinovi:  npm run test:hub
 *   klinika holatini yuboradi (versiya, baza nashri, disk) → admin ro'yxatida ko'rinadi → kompyuter o'chdi (Cerebro to'xtatildi) →
 *   HUB_OFFLINE_MS dan keyin sotuvchiga Telegram'da bir marta «aloqa yo'q» → Cerebro qayta yondi → «yana aloqada».
 * Haqiqiy hub va Cerebro jarayonlari, soxta Telegram (sotuvchining boti ham, klinika boti ham — bitta soxta server).
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION } from '../server/migrate';
import { listen, sent, sleep, tgServer, waitFor } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const VERSION = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version;
const ALERT_CHAT = 5005;
const tgPort = await listen(tgServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'cerebro-hub-'));
const HUB_PORT = 3411, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3298, base = `http://127.0.0.1:${PORT}`;
const procs: ChildProcess[] = [];
process.on('exit', () => { for (const p of procs) p.kill(); });
let log = '';
const start = (script: string, env: Record<string, string>) => {
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', script], { env: { ...process.env, DOTENV: '0', ASTERISK_WSL: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  procs.push(p);
  return p;
};
const up = async (url: string) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
const stopped = (p: ChildProcess) => new Promise<void>(done => { if (p.exitCode !== null) return done(); p.once('exit', () => done()); p.kill(); });
const adminList = async () => (await (await fetch(`${HUB}/admin/clinics`, { headers: { authorization: 'Bearer hub-admin-1' } })).json() as { clinics: { id: string; name: string; online: boolean; seenAt: string | null; status: { version: string; schema: number; diskFreeMb: number; businesses: number; problems: unknown[] } | null }[] }).clinics;
/** waitFor'ning so'rov yuboradigan (async) ko'rinishi */
async function until<T>(what: string, fn: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const v = await fn().catch(() => undefined); if (v) return v; }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
const toVendor = (mark: number, needle: string) => sent.slice(mark).filter(s => s.method === 'sendMessage' && Number(s.params.chat_id) === ALERT_CHAT && String(s.params.text).includes(needle));

try {
  start('hub/server.ts', {
    PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_ADMIN_KEY: 'hub-admin-1',
    HUB_BOT_TOKEN: '777:HUB', HUB_ALERT_CHAT: String(ALERT_CHAT), HUB_TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, HUB_OFFLINE_MS: '2500', HUB_WATCH_MS: '300',
  });
  ok('hub ishga tushdi', await up(`${HUB}/health`));

  console.log('\n# Admin va kalitlar');
  ok("admin ro'yxati kalitsiz — 401", (await fetch(`${HUB}/admin/clinics`)).status === 401);
  const clinic = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: { authorization: 'Bearer hub-admin-1' }, body: JSON.stringify({ name: 'Shifo Dent' }) })).json() as { clinicId: string; code: string };
  const listed = (await adminList()).find(c => c.id === clinic.clinicId);
  ok("yangi klinika ro'yxatda: hali ko'rinmagan, holati yo'q", !!listed && listed.seenAt === null && !listed.online && listed.status === null, JSON.stringify(listed));
  const fake = await fetch(`${HUB}/api/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${clinic.clinicId}.xato` }, body: '{}' });
  ok("noto'g'ri kalit bilan holat — 401", fake.status === 401);

  console.log('\n# Klinika holati');
  const cerebroEnv = {
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'hub-secret',
    MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    CEREBRO_HUB: clinic.code, HEARTBEAT_MS: '400',
  };
  let cerebro = start('server/index.ts', cerebroEnv);
  ok('Cerebro ishga tushdi', await up(`${base}/api/health`));
  const seen = await until('holat', async () => (await adminList()).find(c => c.id === clinic.clinicId && c.status?.version), 15_000);
  ok(`admin ro'yxatida: aloqada, versiya ${VERSION}, baza v${SCHEMA_VERSION}, diskdagi joy`, !!seen && seen.online && seen.status!.version === VERSION && seen.status!.schema === SCHEMA_VERSION
    && seen.status!.diskFreeMb > 0 && Array.isArray(seen.status!.problems), JSON.stringify(seen?.status));

  console.log("\n# Kompyuter o'chdi");
  let mark = sent.length;
  await stopped(cerebro);
  const lost = await waitFor('aloqa yo\'q', () => toVendor(mark, "aloqa yo'q")[0], 15_000);
  ok("sotuvchiga: «Shifo Dent» bilan aloqa yo'q — oxirgi ko'ringan vaqti bilan", !!lost && String(lost.params.text).includes('«Shifo Dent»') && /\d{2}:\d{2}/.test(String(lost.params.text)), String(lost?.params.text ?? ''));
  ok("admin ro'yxatida — aloqada emas", !(await adminList()).find(c => c.id === clinic.clinicId)!.online);
  await sleep(1500);
  ok('takrorlanmaydi (bir marta)', toVendor(mark, "aloqa yo'q").length === 1);

  console.log('\n# Kompyuter qayta yondi');
  mark = sent.length;
  cerebro = start('server/index.ts', cerebroEnv);
  ok('Cerebro qayta ishga tushdi', await up(`${base}/api/health`));
  ok('sotuvchiga: «Shifo Dent» yana aloqada', !!(await waitFor('yana aloqada', () => toVendor(mark, '«Shifo Dent» yana aloqada')[0], 15_000)));
  ok("admin ro'yxatida — yana aloqada", (await adminList()).find(c => c.id === clinic.clinicId)!.online);
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  for (const p of procs) p.kill();
  await sleep(500);
  tgServer.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
