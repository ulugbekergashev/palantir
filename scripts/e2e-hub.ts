/**
 * Hub nazorati sinovi:  npm run test:hub
 *   klinika holatini yuboradi (versiya, baza nashri, disk) → admin ro'yxatida ko'rinadi → kompyuter o'chdi (Palantir to'xtatildi) →
 *   HUB_OFFLINE_MS dan keyin sotuvchiga Telegram'da bir marta «aloqa yo'q» → Palantir qayta yondi → «yana aloqada».
 *   Tashqi zaxira: kunlik zaxira shifrlanib hubga keladi, hub uni o'qiy olmaydi, sotuvchining maxfiy kaliti (va restore-backup) ochadi.
 *   Diagnostika: admin panelidan hubga — holat va jurnallar, kalitlarsiz.
 * Haqiqiy hub va Palantir jarayonlari, soxta Telegram (sotuvchining boti ham, klinika boti ham — bitta soxta server).
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { SCHEMA_VERSION } from '../server/migrate';
import { unseal } from '../server/offsiteCrypto';
import { parseHubCode } from '../src/lib/hubCode';
import { listen, sent, sleep, tgServer, waitFor, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const VERSION = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version;
const ALERT_CHAT = 5005;
const keyPem = () => { const k = generateKeyPairSync('x25519'); return { public: String(k.publicKey.export({ type: 'spki', format: 'pem' })), private: String(k.privateKey.export({ type: 'pkcs8', format: 'pem' })) }; };
const VENDOR = keyPem(), STRANGER = keyPem();
const tgPort = await listen(tgServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-hub-'));
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
    HUB_BACKUP_DIR: path.join(work, 'hub-zaxira'),
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
  const palantirEnv = {
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ADMIN_PASSWORD: 'admin-pass-1',
    MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '3', BACKUP_FIRST_MS: '800', BACKUP_PUBLIC_KEY: VENDOR.public, GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    PALANTIR_HUB: clinic.code, HEARTBEAT_MS: '400',
  };
  let palantir = start('server/index.ts', palantirEnv);
  ok('Palantir ishga tushdi', await up(`${base}/api/health`));
  const seen = await until('holat', async () => (await adminList()).find(c => c.id === clinic.clinicId && c.status?.version), 15_000);
  ok(`admin ro'yxatida: aloqada, versiya ${VERSION}, baza v${SCHEMA_VERSION}, diskdagi joy`, !!seen && seen.online && seen.status!.version === VERSION && seen.status!.schema === SCHEMA_VERSION
    && seen.status!.diskFreeMb > 0 && Array.isArray(seen.status!.problems), JSON.stringify(seen?.status));

  console.log('\n# Tashqi zaxira');
  const admin = { authorization: 'Bearer hub-admin-1' };
  const listBackups = async () => (await (await fetch(`${HUB}/admin/backups`, { headers: admin })).json() as { backups: { clinicId: string; file: string; size: number }[] }).backups;
  const backup = await until('zaxira', async () => (await listBackups()).find(b => b.clinicId === clinic.clinicId), 20_000);
  ok('hubga kunlik zaxira keldi', !!backup && backup.size > 1000, JSON.stringify(backup));
  const blob = Buffer.from(await (await fetch(`${HUB}/admin/backups/${clinic.clinicId}/${backup!.file}`, { headers: admin })).arrayBuffer());
  ok("hubda ochiq ma'lumot yo'q (bazaning SQLite sarlavhasi ko'rinmaydi)", blob.length === backup!.size && !blob.includes('SQLite format 3'));
  const opened = unzipSync(new Uint8Array(unseal(VENDOR.private, blob)));
  ok("sotuvchining maxfiy kaliti bilan ochiladi: baza va session.secret", Buffer.from(opened['palantir.db'] ?? []).subarray(0, 15).toString() === 'SQLite format 3' && !!opened['session.secret'], Object.keys(opened).join(', '));
  ok('begona kalit bilan ochilmaydi', (() => { try { unseal(STRANGER.private, blob); return false; } catch { return true; } })());
  ok("admin kalitsiz yuklab bo'lmaydi", (await fetch(`${HUB}/admin/backups/${clinic.clinicId}/${backup!.file}`)).status === 401);
  const notBackup = await fetch(`${HUB}/api/backup?day=2026-01-01`, { method: 'POST', headers: { authorization: `Bearer ${parseHubCode(clinic.code)!.key}` }, body: 'oddiy matn' });
  ok('zaxira bo\'lmagan fayl — 400, saqlanmaydi', notBackup.status === 400 && !(await listBackups()).some(b => b.file === '2026-01-01.pzb'));
  const keyFile = path.join(work, 'kalit.pem'), pzb = path.join(work, 'z.pzb'), out = path.join(work, 'ochilgan');
  fs.writeFileSync(keyFile, VENDOR.private);
  fs.writeFileSync(pzb, blob);
  const restored = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'scripts/restore-backup.ts', pzb, '--key', keyFile, '--out', out], { encoding: 'utf8' });
  ok('npm run restore-backup: papkaga ochdi', restored.status === 0 && fs.existsSync(path.join(out, 'palantir.db')) && fs.existsSync(path.join(out, 'session.secret')), (restored.stdout + restored.stderr).trim());
  const reported = await until('holatda zaxira', async () => (await adminList()).find(c => c.id === clinic.clinicId && (c.status as { lastOffsite?: { ok: boolean } } | null)?.lastOffsite?.ok), 10_000);
  ok("hub holatida: oxirgi tashqi zaxira yetdi", !!reported);

  console.log('\n# Diagnostika');
  const palantirAdmin = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin-pass-1' }) })).json() as { token: string }).token;
  const diag = await (await fetch(`${base}/api/admin/diag`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${palantirAdmin}` }, body: '{}' })).json() as { sent?: boolean; file?: string };
  ok('admin panelidan diagnostika hubga yuborildi', diag.sent === true && !!diag.file, JSON.stringify(diag));
  const diagText = await (await fetch(`${HUB}/admin/diag/${clinic.clinicId}/${diag.file}`, { headers: admin })).text();
  ok("ichida holat va nashr bor; admin paroli va hub kaliti yo'q", diagText.startsWith('Palantir diagnostika') && diagText.includes(`"version": "${VERSION}"`)
    && !diagText.includes('admin-pass-1') && !diagText.includes(parseHubCode(clinic.code)!.key.split('.')[1]), diagText.slice(0, 80));
  ok("diagnostikani admin kalitsiz o'qib bo'lmaydi", (await fetch(`${HUB}/admin/diag/${clinic.clinicId}/${diag.file}`)).status === 401);

  console.log('\n# Masofadan kirish: panel hub orqali (port ochilmaydi)');
  const R = `${HUB}/c/${clinic.clinicId}`;
  const viaHub = (p: string, init: RequestInit = {}) => fetch(`${R}${p}`, init);
  const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const moved = await fetch(R, { redirect: 'manual' });
  ok("/c/<klinika> → «/» bilan (panel fayllari nisbiy yo'l bilan)", moved.status === 301 && moved.headers.get('location') === `/c/${clinic.clinicId}/`);
  const health = await viaHub('/api/health');
  ok("hub orqali panel serveri javob berdi; Telegram ichida ochilishi mumkin, boshqa saytga joylab bo'lmaydi", health.status === 200 && (await health.json() as { ok: boolean }).ok
    && String(health.headers.get('content-security-policy')).includes('frame-ancestors') && !health.headers.get('x-frame-options'));
  if (fs.existsSync('dist/index.html')) {
    const index = await viaHub('/', { headers: { accept: 'text/html' } });
    ok('panelning o\'zi ham hub orqali ochiladi (nisbiy fayl yo\'llari)', index.status === 200 && (await index.text()).includes('./assets/'));
  }
  await fetch(`${base}/api/admin/businesses`, { ...json({ name: 'Shifo Dent', login: 'shifo', password: 'secret12' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${palantirAdmin}` } });
  const remoteLogin = await (await viaHub('/api/login', json({ login: 'shifo', password: 'secret12' }))).json() as { token?: string };
  ok('egasi hub orqali login va parol bilan kirdi', !!remoteLogin.token && (await viaHub('/api/me', { headers: { authorization: `Bearer ${remoteLogin.token}` } })).status === 200);
  const closed = await Promise.all(['/api/admin/login', '/api/setup', '/api/voice/knowledge'].map(async p => (await viaHub(p, p === '/api/admin/login' ? json({ password: 'admin-pass-1' }) : {})).status));
  ok("masofadan yopiq: admin, ulash ustasi, ovozli agent yo'llari — 403", closed.every(c => c === 403), closed.join(','));
  const tries: number[] = [];
  // Har urinishda boshqa soxta X-Forwarded-For: HUB_TRUST_PROXY yoqilmagan — e'tiborga olinmaydi
  for (let i = 0; i < 9; i++) {
    const attempt = json({ login: 'shifo', password: `xato-${i}` });
    tries.push((await viaHub('/api/login', { ...attempt, headers: { ...attempt.headers, 'x-forwarded-for': `10.0.0.${i}` } })).status);
  }
  const localOk = (await fetch(`${base}/api/login`, json({ login: 'shifo', password: 'secret12' }))).status;
  ok("masofadan parol taxmin qilish — 8 tadan keyin 429, soxta X-Forwarded-For yordam bermaydi (klinikadagi kirishga tegmaydi)", tries.slice(0, 8).every(c => c === 401) && tries[8] === 429 && localOk === 200, tries.join(','));
  ok("noma'lum klinika — 404", (await fetch(`${HUB}/c/0000000000/api/health`)).status === 404);

  console.log("\n# Kompyuter o'chdi");
  let mark = sent.length;
  await stopProcess(palantir);
  const lost = await waitFor('aloqa yo\'q', () => toVendor(mark, "aloqa yo'q")[0], 15_000);
  ok("sotuvchiga: «Shifo Dent» bilan aloqa yo'q — oxirgi ko'ringan vaqti bilan", !!lost && String(lost.params.text).includes('«Shifo Dent»') && /\d{2}:\d{2}/.test(String(lost.params.text)), String(lost?.params.text ?? ''));
  ok("admin ro'yxatida — aloqada emas", !(await adminList()).find(c => c.id === clinic.clinicId)!.online);
  await sleep(1500);
  ok('takrorlanmaydi (bir marta)', toVendor(mark, "aloqa yo'q").length === 1);
  const offline = await until('aloqada emas sahifasi', async () => {
    const r = await fetch(`${HUB}/c/${clinic.clinicId}/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
    return r.status === 503 || r.status === 504 ? await r.text() : undefined;
  }, 30_000);
  ok("panel havolasi: kompyuter o'chiq — «aloqada emas» sahifasi (ko'pi bilan 15 soniya, 2 daqiqa kutib qolmaydi)", !!offline?.includes('aloqada emas'));

  console.log('\n# Kompyuter qayta yondi');
  mark = sent.length;
  palantir = start('server/index.ts', palantirEnv);
  ok('Palantir qayta ishga tushdi', await up(`${base}/api/health`));
  ok('sotuvchiga: «Shifo Dent» yana aloqada', !!(await waitFor('yana aloqada', () => toVendor(mark, '«Shifo Dent» yana aloqada')[0], 15_000)));
  ok("admin ro'yxatida — yana aloqada", (await adminList()).find(c => c.id === clinic.clinicId)!.online);
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  // Tugashini kutib: ohista to'xtayotgan server keyingi sinovning porti va hubiga xalaqit bermasin
  await Promise.all(procs.map(p => stopProcess(p)));
  tgServer.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
