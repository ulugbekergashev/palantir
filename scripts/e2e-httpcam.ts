/**
 * RTSP'siz kameralar sinovi:  npm run test:httpcam
 *   manzil turi (rtsp, MJPEG oqim, surat) va ffmpeg kirishi — sof qoida;
 *   soxta HTTP kamera (telefon «IP Webcam» kabi): MJPEG oqim va login-parolli surat ulanadi, panelga JPEG keladi, dvigatel kadr oladi;
 *   faylga yoki boshqa manzilga yo'naltirish ishlamaydi, bulut «metadata» manzili rad etiladi, parol (so'rov satrida ham) jurnalga tushmaydi;
 *   manzil turi noto'g'ri taxmin qilinsa (…/capture aslida MJPEG) — dvigatel boshqasini sinab, kadr oladi.
 * Kamera o'rniga — shu sinovning HTTP serveri (ffmpeg testsrc kadrlari). Kompyuterda ffmpeg bo'lmasa sinov o'tkazib yuboriladi.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegInput, maskUrl, sourceKind } from '../server/camera/wire';
import { listen, sleep } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

console.log('\n# Manzil turi (sof)');
ok('rtsp — oqim', sourceKind('rtsp://admin:x@192.168.1.64:554/Streaming/Channels/102') === 'rtsp' && sourceKind('RTSPS://cam/1') === 'rtsp');
ok("telefon (IP Webcam) /video — MJPEG oqim", sourceKind('http://192.168.1.50:8080/video') === 'mjpeg' && sourceKind('http://cam/mjpg/video.mjpg') === 'mjpeg');
ok('surat manzillari — still', ['http://cam/snapshot.jpg', 'http://192.168.1.50:8080/shot.jpg', 'http://cam/cgi-bin/snapshot.cgi?chn=1', 'https://cam/ISAPI/Streaming/channels/101/picture'].every(u => sourceKind(u) === 'still'));
ok("host nomidagi so'z turini o'zgartirmaydi", sourceKind('http://snapshot-cam.local:8080/video') === 'mjpeg');
const still = ffmpegInput('http://cam/shot.jpg', 2), mjpeg = ffmpegInput('http://cam/video'), rtsp = ffmpegInput('rtsp://cam/1');
ok('HTTP kirishida faqat tarmoq protokollari', [still, mjpeg].every(a => a.includes('-protocol_whitelist') && a[a.indexOf('-protocol_whitelist') + 1] === 'http,https,tcp,tls,crypto') && !rtsp.includes('-protocol_whitelist'));
ok("surat har 2 soniyada qayta so'raladi; oqimda vaqt — kelgan payt", still.join(' ').includes('-f image2 -loop 1 -framerate 0.5 -re') && mjpeg.includes('-use_wallclock_as_timestamps') && ffmpegInput('http://cam/shot.jpg').join(' ') === '-protocol_whitelist http,https,tcp,tls,crypto -i http://cam/shot.jpg');

ok("yo'naltirish o'chiriladi (ffmpeg qo'llasa)", ffmpegInput('http://cam/video', undefined, { noRedirects: true }).join(' ').includes('-max_redirects 0') && !ffmpegInput('rtsp://cam/1', 2, { noRedirects: true }).includes('-max_redirects') && ffmpegInput('http://cam/shot.jpg', undefined, { noRedirects: true }).includes('-max_redirects') && !ffmpegInput('http://cam/shot.jpg', 2, { noRedirects: true }).includes('-max_redirects'));
ok("taxmin noto'g'ri bo'lsa — tur majburan beriladi", ffmpegInput('http://cam/capture', 2, { kind: 'mjpeg' }).includes('-use_wallclock_as_timestamps'));
ok("so'rov satridagi login-parol ham yashiriladi", !maskUrl('Error: http://cam/snap.jpg?user=admin&pwd=Sir123 failed').includes('Sir123') && !maskUrl('http://cam/a.cgi?loginuse=a&password=Sir123').includes('Sir123') && maskUrl('rtsp://admin:Sir123@cam/1') === 'rtsp://***@cam/1');

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log("\nffmpeg yo'q — jonli qism o'tkazib yuborildi");
  process.exit(results.every(Boolean) ? 0 : 1);
}
// Eski ffmpeg (-max_redirects yo'q) HTTP kamerani umuman ulamaydi — shu tekshiriladi; qolgan jonli qism faqat yangi nashrda
const blocksRedirects = /max_redirects/.test(spawnSync('ffmpeg', ['-hide_banner', '-h', 'protocol=http'], { encoding: 'utf8' }).stdout ?? '');

// ─── Soxta HTTP kamera ──────────────────────────────────────────────────────
const LOGIN = 'admin', PASSWORD = 'TELEFON-PAROLI-7';
const jpegs = Array.from({ length: 6 }, (_, i) => spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=1,trim=start=${i}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']).stdout);
const hits = { video: 0, shot: 0, unauthorized: 0, open: 0, capture: 0 };
let camPortOf = () => 0;
const cam = createServer((req, res) => {
  const url = req.url ?? '';
  if (url.startsWith('/video')) {
    hits.video++;
    res.setHeader('content-type', 'multipart/x-mixed-replace; boundary=frame');
    let i = 0;
    const t = setInterval(() => {
      const f = jpegs[i++ % jpegs.length];
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`); res.write(f); res.write('\r\n');
    }, 250);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (url.startsWith('/shot.jpg')) {
    const want = `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64')}`;
    if (req.headers.authorization !== want) { hits.unauthorized++; res.statusCode = 401; res.setHeader('www-authenticate', 'Basic realm="cam"'); return res.end(); }
    hits.shot++;
    res.setHeader('content-type', 'image/jpeg');
    return res.end(jpegs[hits.shot % jpegs.length]);
  }
  if (url.startsWith('/evil.jpg')) { res.statusCode = 302; res.setHeader('location', 'file:///C:/Windows/win.ini'); return res.end(); }
  if (url.startsWith('/hop.jpg')) { res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${camPortOf()}/open.jpg`); return res.end(); }
  if (url.startsWith('/open.jpg')) { hits.open++; res.setHeader('content-type', 'image/jpeg'); return res.end(jpegs[0]); }
  if (url.startsWith('/capture')) {
    hits.capture++;
    res.setHeader('content-type', 'multipart/x-mixed-replace; boundary=frame');
    let i = 0;
    const t = setInterval(() => { const f = jpegs[i++ % jpegs.length]; res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`); res.write(f); res.write('\r\n'); }, 250);
    req.on('close', () => clearInterval(t));
    return;
  }
  res.statusCode = 404; res.end();
});
const camPort = await listen(cam);
camPortOf = () => camPort;

const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-httpcam-'));
const PORT = 3299, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', MORNING_HOUR: '99', CAMERA_REPORT_HOUR: '99', BOT_TOKEN: '', ANTHROPIC_API_KEY: '',
    VOICELAB_API_KEY: '', GEMINI_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'httpcam-secret', BACKUP_KEEP: '0', CAMERA_TEST_INPUT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(path: string, opts: { token?: string; body?: unknown; method?: string } = {}) {
  const r = await fetch(base + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const isJpeg = (b: Buffer) => b.length > 100 && b[0] === 0xff && b[1] === 0xd8;

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Telefon kamera', login: 'telefon', password: 'secret-12', industry: 'stomatologiya' } });
  const token = (await api('/api/login', { body: { login: 'telefon', password: 'secret-12' } })).json.token;
  const phone = (await api('/api/cameras', { token, body: { name: 'Telefon' } })).json.camera;
  const snapCam = (await api('/api/cameras', { token, body: { name: 'Arzon kamera' } })).json.camera;
  const evilCam = (await api('/api/cameras', { token, body: { name: 'Xavfli' } })).json.camera;
  const captureCam = (await api('/api/cameras', { token, body: { name: 'Capture' } })).json.camera;
  const put = (id: string, url: string) => api(`/api/cameras/${id}/stream`, { token, method: 'PUT', body: { url } });
  const shotOf = async (id: string) => { const r = await fetch(`${base}/api/cameras/${id}/snapshot`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) }; };

  if (!blocksRedirects) {
    console.log("\n# Eski ffmpeg (-max_redirects yo'q): HTTP kamera rad etiladi");
    const r = await put(phone.id, `http://127.0.0.1:${camPort}/video`);
    ok("HTTP kamera ulanmaydi, sababi aytiladi, kameraga so'rov ketmaydi", r.status === 400 && String(r.json.error).includes('ffmpeg eski') && hits.video === 0, JSON.stringify(r.json).slice(0, 160));
    const rt = await put(phone.id, 'rtsp://127.0.0.1:1/x');
    ok("rtsp:// manzil bu sabab bilan rad etilmaydi", !String(rt.json.error ?? '').includes('ffmpeg eski'), JSON.stringify(rt.json).slice(0, 160));
  } else {
    console.log('\n# Telefon: MJPEG oqim');
    const p1 = await put(phone.id, `http://127.0.0.1:${camPort}/video`);
    ok("ulandi (ulashdan oldin kadr olib ko'rildi)", p1.status === 200 && p1.json.camera?.ip === `127.0.0.1:${camPort}` && hits.video > 0, JSON.stringify(p1.json).slice(0, 160));
    const s1 = await shotOf(phone.id);
    ok('panel kadri: JPEG', s1.status === 200 && isJpeg(s1.bytes), `${s1.bytes.length} bayt`);

    console.log("\n# Faqat surat beradigan kamera (login-parol bilan)");
    const wrong = await put(snapCam.id, `http://${LOGIN}:xato@127.0.0.1:${camPort}/shot.jpg`);
    ok("noto'g'ri parol — ulanmaydi, sababi aytiladi", wrong.status >= 400 && hits.unauthorized > 0, JSON.stringify(wrong.json).slice(0, 160));
    const p2 = await put(snapCam.id, `http://${LOGIN}:${PASSWORD}@127.0.0.1:${camPort}/shot.jpg`);
    ok("to'g'ri parol — ulandi, manzil parolsiz ko'rsatiladi", p2.status === 200 && !JSON.stringify(p2.json).includes(PASSWORD), JSON.stringify(p2.json).slice(0, 160));
    const s2 = await shotOf(snapCam.id);
    ok('surat kamerasi: panel kadri JPEG', s2.status === 200 && isJpeg(s2.bytes));

    console.log('\n# Dvigatel: ikkalasidan ham kadrlar');
    let feeds: { name: string; feed: { state: string } | null; lastSeenAt: string | null }[] = [];
    for (let i = 0; i < 120; i++) {
      feeds = (await api('/api/cameras', { token })).json.cameras;
      if (['Telefon', 'Arzon kamera'].every(n => { const c = feeds.find(x => x.name === n); return c?.feed?.state === 'ok' && !!c.lastSeenAt; })) break;
      await sleep(500);
    }
    const fOf = (n: string) => feeds.find(x => x.name === n);
    ok('telefon (MJPEG): dvigatel kadr olyapti', fOf('Telefon')?.feed?.state === 'ok' && !!fOf('Telefon')?.lastSeenAt, JSON.stringify(fOf('Telefon')?.feed));
    const shotsBefore = hits.shot;
    await sleep(4500);
    ok("surat kamerasi: dvigatel suratni qayta-qayta so'rayapti (har ~2 soniyada)", fOf('Arzon kamera')?.feed?.state === 'ok' && hits.shot - shotsBefore >= 2, `${hits.shot - shotsBefore} ta so'rov 4.5 s da`);

    console.log('\n# Xavfsizlik');
    const evil = await put(evilCam.id, `http://127.0.0.1:${camPort}/evil.jpg`);
    ok("faylga yo'naltiradigan manzil — ulanmaydi (ffmpeg fayl o'qimaydi)", evil.status >= 400 && !String(JSON.stringify(evil.json)).includes('[fonts]'), JSON.stringify(evil.json).slice(0, 200));
    ok('file:// — rad etiladi', (await put(evilCam.id, 'file:///C:/Windows/win.ini')).status === 400);
    const hop = await put(evilCam.id, `http://127.0.0.1:${camPort}/hop.jpg`);
    ok("boshqa manzilga yo'naltirish ham ishlamaydi (ffmpeg -max_redirects 0)", hop.status >= 400 && hits.open === 0, `${hop.status} ${JSON.stringify(hop.json).slice(0, 120)} · ochiq manzilga so'rov: ${hits.open}`);
    const meta = await put(evilCam.id, 'http://169.254.169.254/latest/meta-data/iam/x.jpg');
    ok("bulut «metadata» manzili — rad etiladi", meta.status === 400 && String(meta.json.error).includes('kamera emas') && (await put(evilCam.id, 'http://metadata.google.internal/x.jpg')).status === 400, JSON.stringify(meta.json));

    console.log("\n# Manzil turi noto'g'ri taxmin qilingan (…/capture aslida MJPEG)");
    const cap = await put(captureCam.id, `http://127.0.0.1:${camPort}/capture`);
    ok("ulandi (bitta kadr — ikkala turda ham olinadi)", cap.status === 200, JSON.stringify(cap.json).slice(0, 120));
    let capFeed: { feed: { state: string } | null; lastSeenAt: string | null } | undefined;
    for (let i = 0; i < 140; i++) {
      capFeed = ((await api('/api/cameras', { token })).json.cameras as { name: string; feed: { state: string } | null; lastSeenAt: string | null }[]).find(c => c.name === 'Capture');
      if (capFeed?.feed?.state === 'ok' && capFeed.lastSeenAt) break;
      await sleep(500);
    }
    ok("dvigatel surat deb boshlab, kadr kelmagach MJPEG'ni sinadi — kadrlar kelyapti", capFeed?.feed?.state === 'ok' && !!capFeed.lastSeenAt, JSON.stringify(capFeed?.feed));
    ok('parol jurnalga tushmagan', !log.includes(PASSWORD));
  }
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
}

server.kill();
cam.close();
await sleep(1500);
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
process.exit(failed ? 1 : 0);
