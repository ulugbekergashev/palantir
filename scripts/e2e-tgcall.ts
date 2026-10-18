/**
 * Eslatma vaqtida Telegram orqali AI qo'ng'iroq (server/tgcall.ts):  npx tsx scripts/e2e-tgcall.ts
 * Haqiqiy call_live.py o'rnida soxta skript (scripts/fakeTgCall.mjs) — telefon jiringlamaydi. Soxta Telegram, AI'siz.
 *   1) «qo'ng'iroq qilib eslat» vazifasi vaqtida egasiga qo'ng'iroq: kimga, qaysi vazifa, kalit faqat shu biznesniki;
 *   2) oddiy vazifaga qo'ng'iroq qilinmaydi, lekin Telegram eslatmasi keladi;
 *   3) ko'tarmasa — Telegram'da aytiladi;
 *   4) bir vaqtda ikkita eslatma — qo'ng'iroqlar navbat bilan (akkaunt bitta).
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stamp } from '../src/lib/week';
import { OWNER, say, sent, sleep, tgServer, waitFor } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};
const freePort = () => new Promise<number>(done => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); });
});

const tgPort = await freePort();
await new Promise<void>(done => { tgServer.listen(tgPort, '127.0.0.1', () => done()); });
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-tgcall-'));
const PORT = await freePort();
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: '', VOICELAB_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '',
    TG_CALL_PYTHON: process.execPath, TG_CALL_SCRIPT: join(import.meta.dirname, 'fakeTgCall.mjs'), FAKE_TGCALL_DIR: dataDir,
    ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '400', SESSION_SECRET: 'tgcall-secret', MORNING_HOUR: String((new Date().getHours() + 12) % 24),
    IG_BROWSER: join(dataDir, 'yoq.exe'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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
async function until(what: string, fn: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await Promise.resolve(fn()).catch(() => false)) return true;
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return false;
}
interface Call { to: string; flag: string; taskId: string; sawTask: boolean; code: number; start: number; end: number }
const calls = (): Call[] => {
  const f = join(dataDir, 'calls.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Call) : [];
};
const textsAfter = (mark: number) => sent.slice(mark).map(s => String(s.params.text ?? s.params.caption ?? ''));
const past = () => stamp(new Date(Date.now() - 60_000));

try {
  ok('server ko\'tarildi', await until('server', async () => (await fetch(`${base}/api/health`)).ok, 20_000));
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Sinov', industry: 'xizmat', login: 'sinov', password: 'secret-12' } });
  await api('/api/admin/businesses', { token: admin, body: { name: 'Boshqa', industry: 'xizmat', login: 'boshqa', password: 'secret-12' } });
  const token = (await api('/api/login', { body: { login: 'sinov', password: 'secret-12' } })).json.token;
  const otherToken = (await api('/api/login', { body: { login: 'boshqa', password: 'secret-12' } })).json.token;
  await until('bot', async () => (await api('/api/me', { token })).json.status.bot === 'cerebro_test_bot', 20_000);
  const code = String((await api('/api/me', { token })).json.status.linkUrl).split('start=o-')[1];
  let mark = sent.length;
  say(OWNER, `/start o-${code}`);
  ok('egasi botga ulandi', await waitFor('ulanish', () => textsAfter(mark).some(t => t.includes('Ulandi'))));
  const foreign = (await api('/api/tasks', { token: otherToken, body: { title: 'Begona vazifa' } })).json.task;

  console.log("\n# Eslatma vaqtida Telegram qo'ng'irog'i");
  mark = sent.length;
  const t1 = (await api('/api/tasks', { token, body: { title: 'Universitetga qo\'ng\'iroq', dueAt: past(), call: true } })).json.task;
  ok("«qo'ng'iroq bilan» vazifa belgilandi", t1?.spoken === true, JSON.stringify(t1));
  ok("vaqtsiz vazifaga qo'ng'iroq belgisi qo'yilmaydi", (await api('/api/tasks', { token, body: { title: 'Vaqtsiz', call: true } })).json.task?.spoken === false);
  await until("qo'ng'iroq", () => calls().length >= 1, 15_000);
  const c1 = calls()[0];
  ok("vaqti kelganda egasiga qo'ng'iroq: Telegram id'si va eslatiladigan vazifa", c1?.to === String(OWNER) && c1.flag === '--remind' && c1.taskId === t1.id, JSON.stringify(c1));
  ok("qo'ng'iroqqa berilgan kalit shu biznesning vazifasini ko'radi", c1?.sawTask === true);
  ok('Telegram eslatmasi ham keldi', await waitFor('eslatma', () => textsAfter(mark).some(t => t.includes("Universitetga qo'ng'iroq"))));
  await sleep(800);
  ok("gaplashildi — «ko'tarmadingiz» yozilmaydi, qo'ng'iroq takrorlanmaydi", !textsAfter(mark).some(t => t.includes("ko'tarmadingiz")) && calls().length === 1);

  console.log("\n# Oddiy vazifa va ko'tarilmagan qo'ng'iroq");
  mark = sent.length;
  await api('/api/tasks', { token, body: { title: 'Oddiy eslatma', dueAt: past() } });
  ok("oddiy vazifa: Telegram eslatmasi keladi, qo'ng'iroq yo'q", await waitFor('oddiy', () => textsAfter(mark).some(t => t.includes('Oddiy eslatma'))) && (await sleep(800), calls().length === 1));
  writeFileSync(join(dataDir, 'exit'), '2');
  mark = sent.length;
  await api('/api/tasks', { token, body: { title: 'Kassani topshirish', dueAt: past(), call: true } });
  ok("ko'tarmadi — Telegram'da «ko'tarmadingiz» va eslatma matni", await waitFor("ko'tarmadi", () => textsAfter(mark).some(t => t.includes("ko'tarmadingiz") && t.includes('Kassani topshirish'))));
  writeFileSync(join(dataDir, 'exit'), '1');
  mark = sent.length;
  await api('/api/tasks', { token, body: { title: 'Hisobot yuborish', dueAt: past(), call: true } });
  ok("qo'ng'iroq xato bilan tugadi — «qilib bo'lmadi» va eslatma; sabab jurnalda", await waitFor('xato', () => textsAfter(mark).some(t => t.includes("Qo'ng'iroq qilib bo'lmadi") && t.includes('Hisobot yuborish')))
    && serverLog.includes("[tg qo'ng'iroq] chiqish kodi 1"));
  rmSync(join(dataDir, 'exit'), { force: true });

  console.log("\n# Bir vaqtda ikkita eslatma — navbat bilan");
  const before = calls().length;
  const due = past();
  await api('/api/tasks', { token, body: { title: 'Birinchi', dueAt: due, call: true } });
  await api('/api/tasks', { token, body: { title: 'Ikkinchi', dueAt: due, call: true } });
  await until('ikki qo\'ng\'iroq', () => calls().length >= before + 2, 15_000);
  const [x, y] = calls().slice(before);
  ok("ikkala qo'ng'iroq bo'ldi, ikkinchisi birinchisi tugagach boshlandi (akkaunt bitta)", !!x && !!y && y.start >= x.end, JSON.stringify({ x: x && [x.start, x.end], y: y && [y.start, y.end] }));
  ok("boshqa biznesning vazifasiga qo'ng'iroq qilinmadi", !calls().some(c => c.taskId === foreign?.id));
} finally {
  server.kill();
  tgServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl band */ }
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
process.exit(passed === results.length ? 0 : 1);
