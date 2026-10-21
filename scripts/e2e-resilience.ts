/**
 * Chidamlilik sinovi (klinikadagi kompyuter sharoiti):  npm run test:resilience
 *   1) Telegram javob bermaydigan paytda (internetsiz) server baribir ko'tariladi, bot keyin o'zi ulanadi;
 *   2) Telegram uzilgan paytda vaqti kelgan eslatma yo'qolmaydi — aloqa tiklangach yetib boradi;
 *   3) shu papka bilan ikkinchi nusxa ishga tushmaydi (78 kodi bilan chiqadi);
 *   4) jurnal fayli va zaxira nusxa yoziladi;
 *   5) dastur Cerebro deb atalgan paytdagi ma'lumot (eski nom): baza fayli, shifr kaliti, zaxira, qulf — o'qiladi va hurmat qilinadi.
 * Hammasi soxta Telegram bilan, vaqtinchalik papkada.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { diskProblem, freeMb } from '../server/disk';
import { SCHEMA_VERSION } from '../server/migrate';
import { iso, stamp } from '../src/lib/week';
import { OWNER, say, sent, sleep, tgServer, waitFor, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};

/** Bo'sh port raqami (hozircha hech kim tinglamaydi) */
const freePort = () => new Promise<number>(done => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); });
});
const tgPort = await freePort();
const telegramUp = () => new Promise<void>(done => { tgServer.listen(tgPort, '127.0.0.1', () => done()); });
const telegramDown = () => new Promise<void>(done => { tgServer.close(() => done()); tgServer.closeAllConnections(); });

const dataDir = mkdtempSync(join(tmpdir(), 'palantir-chidam-'));
const PORT = 3295;
const base = `http://127.0.0.1:${PORT}`;
const ENV = {
  ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
  ANTHROPIC_API_KEY: '', VOICELAB_API_KEY: '', GEMINI_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '500', SESSION_SECRET: 'chidam-secret', MORNING_HOUR: String((new Date().getHours() + 12) % 24),
  TG_API_ID: '', TG_API_HASH: '', IG_BROWSER: join(dataDir, 'yoq.exe'),
};
const ARGS = ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'];
const startedAt = Date.now();
const server = spawn(process.execPath, ARGS, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function api(path: string, opts: { token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
/** waitFor'ning so'rov yuboradigan (async) ko'rinishi */
async function until(what: string, fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await fn().catch(() => false)) return true;
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return false;
}
const textOf = (i: number) => sent.slice(i).map(s => String(s.params.text ?? ''));

try {
  console.log('\n# Internetsiz yonish');
  const up = await until('server', async () => (await fetch(`${base}/api/health`)).ok, 15_000);
  const bootMs = Date.now() - startedAt;
  ok('Telegram javob bermasa ham server ko\'tarildi', up, `${bootMs} ms`);
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  const created = await api('/api/admin/businesses', { token: admin, body: { name: 'Sinov klinikasi', industry: 'stomatologiya', login: 'klinika', password: 'secret-12' } });
  ok('panel ishlaydi: biznes yaratildi', created.status === 200);
  ok('qisqa parol qabul qilinmaydi (8 belgidan kam)', (await api('/api/admin/businesses', { token: admin, body: { name: 'X', login: 'qisqa', password: '1234567' } })).status === 400);
  const token = (await api('/api/login', { body: { login: 'klinika', password: 'secret-12' } })).json.token;
  ok('bot hali ulanmagan — panel buni yashirmaydi', (await api('/api/me', { token })).json.status.bot === null, JSON.stringify((await api('/api/me', { token })).json.status.bot));
  ok('jurnalda sabab va qayta urinish yozilgan', serverLog.includes('qayta uriniladi'));
  // Begona sayt brauzer orqali shu kompyuterdagi panelga o'z nomi bilan murojaat qilsa (DNS rebinding) — rad etiladi
  const foreign = await new Promise<number>(done => { request({ host: '127.0.0.1', port: PORT, path: '/api/health', headers: { host: 'begona.example' } }, r => { r.resume(); done(r.statusCode ?? 0); }).on('error', () => done(0)).end(); });
  ok("begona nom bilan kelgan so'rov rad etiladi (421)", foreign === 421, String(foreign));

  console.log('\n# Telegram paydo bo\'ldi');
  await telegramUp();
  const linked = await until('bot nomi', async () => (await api('/api/me', { token })).json.status.bot === 'palantir_test_bot', 30_000);
  ok('bot o\'zi ulandi (qayta ishga tushirmasdan)', linked);
  const code = String((await api('/api/me', { token })).json.status.linkUrl).split('start=o-')[1];
  let mark = sent.length;
  say(OWNER, `/start o-${code}`);
  ok('egasi ulandi', await waitFor('ulanish', () => textOf(mark).some(t => t.includes('Ulandi'))));

  console.log('\n# Aloqa uzildi: eslatma yo\'qolmaydi');
  await telegramDown();
  mark = sent.length;
  const task = (await api('/api/tasks', { token, body: { title: 'Sterilizatorni tekshirish', dueAt: stamp(new Date(Date.now() - 60_000)) } })).json.task;
  await sleep(2500);
  ok('uzilish paytida eslatma yuborilmadi (va xato jurnalda)', !textOf(mark).length && serverLog.includes('[jadval] eslatma'));
  await telegramUp();
  const reminder = await waitFor('eslatma', () => textOf(mark).some(t => t.includes('Sterilizatorni tekshirish')), 30_000);
  ok('aloqa tiklangach eslatma yetib keldi', reminder);
  await sleep(1500);
  ok('eslatma bir marta keldi (takrorlanmadi)', textOf(mark).filter(t => t.includes('Sterilizatorni tekshirish')).length === 1, String(task?.id));

  console.log('\n# Ikkinchi nusxa, jurnal, zaxira');
  const second = spawnSync(process.execPath, ARGS, { env: ENV, encoding: 'utf8', timeout: 30_000 });
  ok('shu papka bilan ikkinchi nusxa ishga tushmaydi (kod 78)', second.status === 78, `kod ${second.status}`);
  ok('birinchi nusxa ishlashda davom etadi', (await api('/api/health')).status === 200);
  const logFile = join(dataDir, 'logs', `${iso(new Date())}.log`);
  ok('jurnal fayli yozilgan', existsSync(logFile) && readFileSync(logFile, 'utf8').includes('Palantir server'));
  // Zaxira: serverning o'z moduli orqali, shu papkada (server ishlab turganda)
  const backup = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', '-e', "import('./server/backup.ts').then(m => { console.log(m.backupNow() ?? 'bor'); process.exit(0); })"], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  const day = join(dataDir, 'backups', iso(new Date()));
  ok('zaxira nusxa olindi (baza)', existsSync(join(day, 'palantir.db')), (backup.stderr || backup.stdout).trim().slice(0, 200));
  ok('yarim yozilgan nusxa qolmadi', !readdirSync(join(dataDir, 'backups')).some(n => n.startsWith('.yozilmoqda')));

  console.log('\n# Baza nashri');
  const version = (file: string) => { const d = new DatabaseSync(file); const v = Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version); d.close(); return v; };
  const setVersion = (file: string, v: number) => { const d = new DatabaseSync(file); d.exec(`PRAGMA user_version = ${v}`); d.close(); };
  ok("yangi baza darhol oxirgi nashrda", version(join(dataDir, 'palantir.db')) === SCHEMA_VERSION, `v${version(join(dataDir, 'palantir.db'))}`);
  // Alohida papka: bazani faqat db moduli ochadi (server emas) — tuzilmani joriy kod yaratadi, keyin «nashrsiz eski baza» qilinadi
  const oldDir = mkdtempSync(join(tmpdir(), 'palantir-nashr-')), oldDb = join(oldDir, 'palantir.db');
  const openDb = () => spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', '-e', "import('./server/db.ts').then(() => process.exit(0))"], { env: { ...ENV, DATA_DIR: oldDir, BACKUP_DIR: '' }, encoding: 'utf8', timeout: 60_000 });
  openDb();
  // Nashrsiz eski baza — postlar olib tashlanishidan oldingi tuzilma bilan (v2 ularni o'chiradi), bitta biznes yozuvi bilan
  {
    const d = new DatabaseSync(oldDb);
    d.exec(`CREATE TABLE posts (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, item TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL);
      ALTER TABLE businesses ADD COLUMN channel_id TEXT; ALTER TABLE businesses ADD COLUMN channel_title TEXT;
      INSERT INTO businesses (id, login, password_hash, profile, link_code, channel_id, created_at) VALUES ('eski1', 'eski', 'x', '{"name":"Eski"}', 'k1', '-100', '2026-01-01');
      PRAGMA user_version = 0;`);
    d.close();
  }
  const migrated = openDb();
  const before = readdirSync(join(oldDir, 'backups')).filter(n => /^oldin-v\d+-.+\.db$/.test(n));
  ok('eski baza: avval nusxa olindi, keyin oxirgi nashrga o\'tdi', migrated.status === 0 && before.length === 1 && version(oldDb) === SCHEMA_VERSION, `${migrated.status} ${before.join(',')} ${(migrated.stderr || '').trim().slice(0, 200)}`);
  {
    const d = new DatabaseSync(oldDb);
    const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
    const cols = (d.prepare('PRAGMA table_info(businesses)').all() as { name: string }[]).map(c => c.name);
    const kept = d.prepare("SELECT login FROM businesses WHERE id = 'eski1'").get() as { login: string } | undefined;
    d.close();
    ok("v2: posts jadvali va kanal ustunlari o'chdi, biznes yozuvi joyida", !tables.includes('posts') && !cols.includes('channel_id') && !cols.includes('channel_title') && kept?.login === 'eski', JSON.stringify({ posts: tables.includes('posts'), cols: cols.filter(c => c.startsWith('channel')) }));
    // Nusxada eski tuzilma butun qolgan (qaytarish mumkin)
    const copy = new DatabaseSync(join(oldDir, 'backups', before[0] ?? 'yoq'));
    const copyHasPosts = !!copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get();
    copy.close();
    ok("migratsiyadan oldingi nusxada eski tuzilma butun", copyHasPosts);
  }
  setVersion(oldDb, SCHEMA_VERSION + 1);
  const tooNew = openDb();
  ok('baza dasturdan yangiroq — ochilmaydi (kod 78, sababi aytiladi)', tooNew.status === 78 && /yangiroq nashr/.test(tooNew.stderr), `kod ${tooNew.status}`);
  ok("yangiroq bazaga tegilmadi", version(oldDb) === SCHEMA_VERSION + 1);
  rmSync(oldDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });

  console.log('\n# Disk va qo\'ng\'iroq yozuvlari');
  const free = freeMb(dataDir);
  ok("disk: bo'sh joy o'lchanadi; chegaradan ko'p — muammo yo'q, kam — sababi bilan", free != null && free > 0 && diskProblem(dataDir, 1) === null
    && /bo'sh joy \d+ MB qoldi/.test(diskProblem(dataDir, Number.MAX_SAFE_INTEGER) ?? ''), `${free} MB`);
  // Yozuvlar: 100 kunlik va yangi fayl, ikkalasiga ham qo'ng'iroq yozuvi; muddat — 90 kun (standart)
  const recData = mkdtempSync(join(tmpdir(), 'palantir-yozuv-')), recDir = join(recData, 'recordings');
  mkdirSync(recDir);
  writeFileSync(join(recDir, 'eski.wav'), Buffer.alloc(4000));
  writeFileSync(join(recDir, 'yangi.wav'), Buffer.alloc(4000));
  const hundredDays = new Date(Date.now() - 100 * 86_400_000);
  utimesSync(join(recDir, 'eski.wav'), hundredDays, hundredDays);
  const prune = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', '-e', `
    const { sql } = await import('./server/db.ts');
    const { pruneRecordings } = await import('./server/phone/index.ts');
    for (const [id, file] of [['c1', 'eski.wav'], ['c2', 'yangi.wav']])
      sql.run("INSERT INTO calls (id, business_id, phone, started_at, outcome, created_at, source, recording) VALUES (?, 'b', '+998901112233', '2026-01-01', 'x', '2026-01-01', 'microsip', ?)", id, file);
    const removed = pruneRecordings();
    const rows = sql.many('SELECT id, recording FROM calls ORDER BY id', r => [r.id, r.recording]);
    console.log(JSON.stringify({ removed, rows }));
    process.exit(0);`], { env: { ...ENV, DATA_DIR: recData, BACKUP_DIR: '' }, encoding: 'utf8', timeout: 60_000 });
  const pruned = JSON.parse(prune.stdout.trim().split('\n').at(-1) || '{}') as { removed?: number; rows?: [string, string | null][] };
  ok("yozuvlar: 90 kundan eskisi o'chdi (havolasi ham), yangisi qoldi", pruned.removed === 1 && !existsSync(join(recDir, 'eski.wav')) && existsSync(join(recDir, 'yangi.wav'))
    && JSON.stringify(pruned.rows) === JSON.stringify([['c1', null], ['c2', 'yangi.wav']]), `${prune.status} ${prune.stdout.trim().slice(-200)} ${prune.stderr.trim().slice(0, 200)}`);
  rmSync(recData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  // Dastur avval Cerebro deb atalgan (eski nom): o'sha paytdagi ma'lumot yangi nom bilan ham ishlashi kerak
  console.log("\n# Avvalgi nom bilan yaratilgan ma'lumot");
  const oldName = mkdtempSync(join(tmpdir(), 'palantir-eski-')), oldBackups = join(oldName, 'backups');
  const legacyDb = join(oldName, 'cerebro.db'); // eski nom
  { const d = new DatabaseSync(legacyDb); d.exec(`CREATE TABLE belgi (x); PRAGMA user_version = ${SCHEMA_VERSION}`); d.close(); }
  for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) {
    mkdirSync(join(oldBackups, day), { recursive: true });
    writeFileSync(join(oldBackups, day, 'cerebro.db'), ''); // eski nom
  }
  const SECRET = 'avvalgi-nom-sinov-kaliti';
  const legacyKey = createHash('sha256').update(`cerebro:vault:${SECRET}`).digest(); // eski nom
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', legacyKey, iv);
  const body = Buffer.concat([cipher.update('avvalgi qiymat', 'utf8'), cipher.final()]);
  const sealedV1 = `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
  const legacy = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', '-e', `
    const { env } = await import('./server/env.ts');
    const { open, seal } = await import('./server/secret.ts');
    const { authorOf } = await import('./server/db.ts');
    const { backupNow } = await import('./server/backup.ts');
    const { readdirSync } = await import('node:fs');
    backupNow();
    const author = [authorOf('cerebro'), authorOf('owner')]; // eski nom
    console.log(JSON.stringify({ db: env.dbFile, opened: open(process.env.SEALED_V1), sealed: seal('x').slice(0, 3), author, days: readdirSync(env.backupDir).sort() }));
    process.exit(0);`], { env: { ...ENV, DATA_DIR: oldName, BACKUP_DIR: oldBackups, BACKUP_KEEP: '2', SESSION_SECRET: SECRET, SEALED_V1: sealedV1 }, encoding: 'utf8', timeout: 60_000 });
  const got = JSON.parse(legacy.stdout.trim().split('\n').at(-1) || '{}') as { db?: string; opened?: string; sealed?: string; author?: string[]; days?: string[] };
  const tables = (() => { const d = new DatabaseSync(legacyDb); try { return (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name); } finally { d.close(); } })();
  ok("avvalgi nomli baza fayli ishlatiladi, yangisi yaratilmaydi", got.db === legacyDb && tables.includes('belgi') && tables.includes('businesses') && !existsSync(join(oldName, 'palantir.db')),
    `${legacy.status} ${got.db ?? ''} ${legacy.stderr.trim().slice(0, 200)}`);
  ok("avvalgi kalit bilan shifrlangan qiymat ochiladi, yangisi «v2.» bilan yoziladi", got.opened === 'avvalgi qiymat' && got.sealed === 'v2.', `${got.opened} ${got.sealed}`);
  ok("yozishmadagi avvalgi muallif nomi — Palantir", JSON.stringify(got.author) === JSON.stringify(['palantir', 'owner']), JSON.stringify(got.author));
  ok("zaxira: avvalgi nomli nusxalar ham sanaladi, eng eskilari o'chadi", JSON.stringify(got.days?.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) === JSON.stringify(['2026-01-03', iso(new Date())]), JSON.stringify(got.days));
  const lockDir = mkdtempSync(join(tmpdir(), 'palantir-eski-qulf-'));
  writeFileSync(join(lockDir, 'cerebro.lock'), JSON.stringify({ pid: process.pid, port: 1, host: '127.0.0.1', at: new Date().toISOString() })); // eski nom
  const legacyLock = spawnSync(process.execPath, ARGS, { env: { ...ENV, DATA_DIR: lockDir, PORT: String(await freePort()) }, encoding: 'utf8', timeout: 30_000 });
  ok("avvalgi nomli nashr shu papka bilan ishlab tursa — ishga tushmaydi (kod 78)", legacyLock.status === 78, `kod ${legacyLock.status}`);
  for (const dir of [oldName, lockDir]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await stopProcess(server);
  tgServer.close();
  tgServer.closeAllConnections();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
if (passed !== results.length) console.log(`\n--- server jurnali ---\n${serverLog.slice(-3000)}`);
process.exit(passed === results.length ? 0 : 1);
