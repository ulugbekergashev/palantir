/**
 * IP kamera zanjiri sinovi:  npm run test:ipcam
 *   manzil tekshiruvi → ulash (kadr olib ko'riladi) → dvigatel kadrlarni oladi va kamera «ko'ryapti» bo'ladi → kadr (JPEG) → uzish.
 * Kamera o'rniga ffmpeg'ning sinov tasviri (CAMERA_TEST_INPUT). Odam topish sifati bu yerda tekshirilmaydi (u model ishi) —
 * faqat zanjir: ffmpeg → dvigatel → server. Kompyuterda ffmpeg bo'lmasa sinov o'tkazib yuboriladi.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sleep, stopProcess } from './fakes';

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log("ffmpeg yo'q — IP kamera sinovi o'tkazib yuborildi");
  process.exit(0);
}

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};

const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-ipcam-'));
const PORT = 3297, base = `http://127.0.0.1:${PORT}`;
const SECRET = 'JUDA-MAXFIY-PAROL';
/** Shu ishga tushirishning ffmpeg'larini ajratish uchun: testsrc davomiyligi (soniya) — jarayon raqami bilan */
const MARK = 900_000 + process.pid;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '', ANTHROPIC_API_KEY: '', VOICELAB_API_KEY: '', GEMINI_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'ipcam-secret', BACKUP_KEEP: '0',
    CAMERA_TEST_INPUT: JSON.stringify(['-re', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=5:duration=${MARK}`]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function api(path: string, opts: { token?: string; body?: unknown; method?: string } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
async function until(what: string, fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (await fn().catch(() => false)) return true;
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return false;
}

try {
  await until('server', async () => (await fetch(`${base}/api/health`)).ok, 20_000);
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Kamera sinovi', login: 'kamera', password: 'secret-12', industry: 'stomatologiya' } });
  const token = (await api('/api/login', { body: { login: 'kamera', password: 'secret-12' } })).json.token;
  const cam = (await api('/api/cameras', { token, body: { name: 'Zal' } })).json.camera;
  const put = (url: string) => api(`/api/cameras/${cam.id}/stream`, { token, method: 'PUT', body: { url } });

  console.log('\n# Manzil tekshiruvi');
  ok('yangi kamera — shu kompyuter kamerasi (IP yo\'q)', cam.ip === null && cam.feed === null);
  ok('fayl manzili qabul qilinmaydi', (await put('file:///C:/Windows/win.ini')).status === 400);
  ok('ftp va boshqa protokol qabul qilinmaydi (faqat rtsp va http)', (await put('ftp://192.168.1.64/video')).status === 400 && (await put('concat:rtsp://a|rtsp://b')).status === 400);
  ok('ffmpeg buyrug\'iga o\'xshash matn qabul qilinmaydi', (await put('-f lavfi -i testsrc')).status === 400);
  ok('tokensiz ulab bo\'lmaydi', (await api(`/api/cameras/${cam.id}/stream`, { method: 'PUT', body: { url: 'rtsp://1.2.3.4/x' } })).status === 401);
  ok('ulanmagan kamerada kadr yo\'q — 404', (await api(`/api/cameras/${cam.id}/snapshot`, { token })).status === 404);

  console.log('\n# Ulash va kadrlar');
  const set = await put(`rtsp://admin:${SECRET}@192.168.1.64:554/Streaming/Channels/102`);
  ok('ulandi: manzil parolsiz ko\'rsatiladi', set.status === 200 && set.json.camera.ip === '192.168.1.64:554' && !JSON.stringify(set.json).includes(SECRET), JSON.stringify(set.json.camera?.feed));
  const shot = await fetch(`${base}/api/cameras/${cam.id}/snapshot`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await shot.arrayBuffer());
  ok('kadr: JPEG rasm', shot.status === 200 && shot.headers.get('content-type') === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8, `${bytes.length} bayt`);
  ok('boshqa biznes kadrni ola olmaydi (tokensiz — 401)', (await api(`/api/cameras/${cam.id}/snapshot`)).status === 401);
  const seen = await until('kadr', async () => {
    const c = (await api('/api/cameras', { token })).json.cameras[0];
    return c.feed?.state === 'ok' && !!c.lastSeenAt;
  }, 60_000);
  ok('dvigatel kadr olyapti: holat «ok», oxirgi kadr vaqti bor', seen);
  ok('IP kamerada brauzer kuzatuvi rad etiladi — 409', (await api(`/api/cameras/${cam.id}/observe`, { token, body: { people: [] } })).status === 409);

  console.log('\n# Uzish');
  const off = await put('');
  ok('uzildi: yana shu kompyuter kamerasi', off.status === 200 && off.json.camera.ip === null && off.json.camera.feed === null);
  ok('uzilgandan keyin brauzer kuzatuvi yana ishlaydi', (await api(`/api/cameras/${cam.id}/observe`, { token, body: { people: [] } })).status === 200);
  await sleep(1500);
  ok('kamera paroli jurnalga tushmagan', !serverLog.includes(SECRET));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await stopProcess(server);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
// Server to'xtagach kamera dvigateli o'z ffmpeg'ini bir lahzadan keyin yopadi (Windows'da server darhol o'ldiriladi) — 10 soniyagacha kutiladi.
// Faqat shu sinovning ffmpeg'i sanaladi (testsrc dagi MARK bo'yicha): shu kompyuterda boshqa sinov ham ishlayotgan bo'lishi mumkin
const ffmpegCount = () => {
  const lines = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' }).stdout
    : spawnSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8' }).stdout;
  return lines.split('\n').filter(l => /ffmpeg/i.test(l) && l.includes(`duration=${MARK}`)).length;
};
let left = ffmpegCount();
for (let i = 0; i < 40 && left > 0; i++) { await sleep(250); left = ffmpegCount(); }
ok('server to\'xtagach ffmpeg jarayonlari qolmadi', left === 0, `${left} ta`);
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
if (passed !== results.length) console.log(`\n--- server jurnali ---\n${serverLog.slice(-3000)}`);
process.exit(passed === results.length ? 0 : 1);
