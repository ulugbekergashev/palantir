/**
 * Chidamlilik sinovi (klinikadagi kompyuter sharoiti):  npm run test:resilience
 *   1) Telegram javob bermaydigan paytda (internetsiz) server baribir ko'tariladi, bot keyin o'zi ulanadi;
 *   2) Telegram uzilgan paytda vaqti kelgan eslatma yo'qolmaydi — aloqa tiklangach yetib boradi;
 *   3) shu papka bilan ikkinchi nusxa ishga tushmaydi (78 kodi bilan chiqadi);
 *   4) jurnal fayli va zaxira nusxa yoziladi.
 * Hammasi soxta Telegram bilan, vaqtinchalik papkada.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iso, stamp } from '../src/lib/week';
import { OWNER, say, sent, sleep, tgServer, waitFor } from './fakes';

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

const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-chidam-'));
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
  const linked = await until('bot nomi', async () => (await api('/api/me', { token })).json.status.bot === 'cerebro_test_bot', 30_000);
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
  ok('jurnal fayli yozilgan', existsSync(logFile) && readFileSync(logFile, 'utf8').includes('Cerebro server'));
  // Zaxira: serverning o'z moduli orqali, shu papkada (server ishlab turganda)
  const backup = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', '-e', "import('./server/backup.ts').then(m => { console.log(m.backupNow() ?? 'bor'); process.exit(0); })"], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  const day = join(dataDir, 'backups', iso(new Date()));
  ok('zaxira nusxa olindi (baza)', existsSync(join(day, 'cerebro.db')), (backup.stderr || backup.stdout).trim().slice(0, 200));
  ok('yarim yozilgan nusxa qolmadi', !readdirSync(join(dataDir, 'backups')).some(n => n.startsWith('.yozilmoqda')));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  server.kill();
  await sleep(500);
  tgServer.close();
  tgServer.closeAllConnections();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
if (passed !== results.length) console.log(`\n--- server jurnali ---\n${serverLog.slice(-3000)}`);
process.exit(passed === results.length ? 0 : 1);
