/**
 * Kamera bilan ishlash sinovi (soxta Telegram va Claude, kamera o'rniga ffmpeg sinov tasviri):  npm run test:camwork
 *   /kamera — hamma kameradan hozirgi rasm; «/kamera Zal» — bitta kamera; «/kamera … kim bor» — kadrga qarab javob;
 *   yordamchi «kameraga qara» — look_camera: rasm Telegram'ga, kadr Kuzatuvchi jurnalida, panel suhbatida kamera kartasi;
 *   brauzer kamerasi va noma'lum kamera, begona biznes himoyasi;
 *   to'lovsiz qabul: bemor qabul vaqtida kresloda o'tirgan, DentaCRM'da shu kuni to'lovi yo'q (sof qoida va kamera hisobi);
 *   kutish joyi: har odam alohida sanaladi, uzoq kutsa — egasiga bitta xabar; kreslo bandligi foizi;
 *   kamera burildi yoki yopildi: sinov tasviri vaqt bo'yicha o'zgaradi (odatiy → aks → odatiy → qora → odatiy);
 *   maxfiy joy: kameradan chiqadigan rasmlarda (panel, Telegram) o'sha joy qora;
 *   tayyor qoidalar: kameradagi zonalarga moslanadi va server ularni qabul qiladi.
 * Kompyuterda ffmpeg bo'lmasa sinov o'tkazib yuboriladi. Haqiqiy kamera va haqiqiy model bu yerda yo'q.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iso } from '../src/lib/week';
import { findings, reconcile, unbilled, type Sitting } from '../server/camera/reconcile';
import type { Appointment } from '../server/crm/logic';
import { MAX_JUMP, chairUse, trackStep, waitStats, type Track } from '../server/camera/occupancy';
import type { Camera, CameraSession } from '../src/types';
import { judgeLook, type TamperState } from '../server/camera/tamper';
import { cameraPresets } from '../src/lib/presets';
import { OWNER, ai, aiServer, listen, say, sent, sleep, tgServer, waitFor, type Sent } from './fakes';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

console.log("\n# To'lovsiz qabul (sof qoida)");
const A = (id: string, patientId: string, patientName: string, time: string, status = 'Completed'): Appointment =>
  ({ id, patientId, patientName, doctorId: 'd1', doctorName: 'Rustam Rustamov', type: "Ko'rik", date: '2026-10-20', time, duration: 30, status, notes: null });
const S = (id: string, startMin: number, endMin: number | null): Sitting => ({ id, doctorId: 'd1', label: 'Kreslo 1', startMin, endMin });
const m = (h: number, mm = 0) => h * 60 + mm;
const visits = [A('a1', 'p1', 'Dilnoza Karimova', '10:00'), A('a2', 'p2', 'Sardor Aliyev', '11:00'), A('a3', 'p3', 'Malika Yusupova', '12:00', 'Checked-In')];
const day = reconcile([S('s1', m(10, 5), m(10, 35)), S('s2', m(11, 2), m(11, 30)), S('s3', m(12, 5), null)], visits, m(13), new Map());
const paidSardor = [{ patientId: 'p2', patientName: 'Bemor' }];
const unpaid = unbilled(day, paidSardor, m(13));
ok("o'tirgan, to'lovi yo'q — aytiladi; to'lagan va hali o'tirgan — yo'q", unpaid.length === 1 && unpaid[0].appointment.id === 'a1', JSON.stringify(unpaid.map(u => u.appointment.id)));
ok("kreslodan endi turgan (30 daqiqa o'tmagan) — hali aytilmaydi", unbilled(day, paidSardor, m(10, 50)).length === 0);
ok("qarz yoki avansdan yozilgan to'lov ham yozuv — aytilmaydi", unbilled(day, [...paidSardor, { patientId: 'p1', patientName: 'x' }], m(13)).length === 0);
ok("bemorga bog'lanmagan eski yozuv — ism bo'yicha (so'z tartibi boshqa)", unbilled(day, [...paidSardor, { patientId: null, patientName: 'Karimova  Dilnoza' }], m(13)).length === 0);
ok("boshqa bemorning to'lovi hisobga o'tmaydi", unbilled(day, [{ patientId: null, patientName: 'Dilnoza Yusupova' }, ...paidSardor], m(13)).length === 1);
const twice = (end: number | null) => reconcile([S('x1', m(10, 5), m(10, 20)), S('x2', m(10, 25), end)], [visits[0]], m(13), new Map());
ok("bir qabulda ikki o'tirish, ikkinchisi davom etyapti — aytilmaydi", unbilled(twice(null), [], m(13)).length === 0);
const both = unbilled(twice(m(10, 40)), [], m(13));
ok("ikki o'tirish tugagan — bitta farq, butun oraliq bilan", both.length === 1 && both[0].fromMin === m(10, 5) && both[0].toMin === m(10, 40));
const said = findings(day, unpaid).find(f => f.text.includes("to'lov yozilmagan"));
ok("farq matni: qabul vaqti, bemor, shifokor, o'tirgan oraliq — ogohlantirish", said?.level === 'warn' && said.text.startsWith("10:00 · Dilnoza Karimova (Rustam Rustamov): 10:05–10:35 da kresloda o'tirdi"), said?.text);

console.log('\n# Kutish joyi va kreslo bandligi (sof qoida)');
const WZ = { x: 0, y: 0, w: 0.5, h: 1 };
const P = (cx: number, cy: number) => ({ x: cx - 0.05, y: cy - 0.1, w: 0.1, h: 0.2 });
const O = { leaveMs: 2000, maxJump: MAX_JUMP };
let tr: Track[] = trackStep([], [P(0.2, 0.5), P(0.4, 0.5), P(0.8, 0.5)], WZ, 0, O).tracks;
ok("kutish: zonadagi ikki odam — ikki kishi, zonadan tashqaridagi sanalmaydi", tr.length === 2 && tr[0].id !== tr[1].id);
const first = tr[0].id;
tr = trackStep(tr, [P(0.22, 0.52), P(0.4, 0.5)], WZ, 1000, O).tracks;
ok("kutish: biroz qimirlagan odam — o'sha odam (vaqti saqlanadi)", tr.length === 2 && tr[0].id === first && tr[0].since === 0 && tr[0].lastSeen === 1000);
let step2 = trackStep(tr, [P(0.4, 0.5)], WZ, 2500, O);
ok("kutish: bir zum ko'rinmay qolgan odam hali ketmagan", step2.tracks.length === 2 && step2.finished.length === 0);
step2 = trackStep(step2.tracks, [P(0.4, 0.5)], WZ, 3500, O);
ok("kutish: leaveMs dan ko'p ko'rinmagan — ketdi, kutgan vaqti bilan", step2.finished.length === 1 && step2.finished[0].id === first && step2.finished[0].lastSeen - step2.finished[0].since === 1000);
const jump = trackStep(step2.tracks, [P(0.05, 0.1)], WZ, 3600, O);
ok("kutish: uzoq joyda paydo bo'lgan — yangi odam", jump.tracks.length === 2 && jump.tracks.some(t => t.since === 3600));
const T = (h: number, mm = 0) => new Date(2026, 9, 20, h, mm).toISOString();
const cam = { id: 'k1', name: 'Kabinet', zones: [{ id: 'c1', kind: 'chair', name: 'Kreslo 1', x: 0, y: 0, w: 1, h: 1, doctorId: null }], seenFrom: T(9), lastSeenAt: T(12) } as unknown as Camera;
const sess = (id: string, kind: 'chair' | 'waiting', from: string, to: string | null): CameraSession => ({ id, cameraId: 'k1', zoneId: kind === 'chair' ? 'c1' : 'w1', kind, zoneName: 'x', startedAt: from, endedAt: to });
const use = chairUse([cam], [sess('a', 'chair', T(8), T(8, 30)), sess('b', 'chair', T(9, 30), T(10, 30)), sess('c', 'chair', T(11), null)], Date.parse(T(0)), Date.parse(T(24)), Date.parse(T(12)));
ok("bandlik: kuzatilgan 3 soatdan 2 soati band — 67% (kamera ko'rmagan paytdagi o'tirish hisobga kirmaydi)", use.length === 1 && use[0].pct === 67 && use[0].busyMin === 120 && use[0].watchedMin === 180, JSON.stringify(use));
ok("bandlik: kamera 10 daqiqadan kam kuzatgan — foiz aytilmaydi", chairUse([{ ...cam, seenFrom: T(11, 55) }], [], Date.parse(T(0)), Date.parse(T(24)), Date.parse(T(12)))[0].pct === null);
const ws = waitStats([sess('w', 'waiting', T(10), T(10, 5)), sess('x', 'waiting', T(10), T(10, 25)), sess('y', 'waiting', T(11), null), sess('z', 'chair', T(9), T(10))], 20, { people: 1, longestMs: 3 * 60_000 });
ok("kutish hisobi: 2 kishi, o'rtacha 15, eng uzoq 25, 20 daqiqadan oshgan 1", ws.count === 2 && ws.avgMin === 15 && ws.maxMin === 25 && ws.longCount === 1 && ws.nowWaiting === 1 && ws.nowLongestMin === 3, JSON.stringify(ws));

console.log('\n# Kamera yopildi yoki burildi (sof qoida)');
const grid = (f: (i: number) => number) => Array.from({ length: 32 * 18 }, (_, i) => f(i));
const scene = grid(i => (i % 32) * 6 + 20), flipped = grid(i => (31 - (i % 32)) * 6 + 20), bright = scene.map(v => Math.min(255, v * 1.4 + 30));
const L = (thumb: number[], std = 60, mean = 110) => ({ mean, std, thumb });
const TO = { warmupMs: 10_000, holdMs: 4_000 };
let ts: TamperState | undefined;
const feed = (look: ReturnType<typeof L>, at: number) => { const r = judgeLook(ts, look, at, TO); ts = r.next; return r.event?.type ?? null; };
ok("tamper: qorong'ida yoqilgan kamera qora kadrni namuna qilmaydi", feed(L(grid(() => 3), 1, 3), 0) === null && ts!.ref === null);
feed(L(scene), 1000);
ok("tamper: o'rganish paytida burilish aytilmaydi", feed(L(flipped), 3000) === null && feed(L(scene), 5000) === null);
const events: (string | null)[] = [];
for (let t = 12_000; t <= 20_000; t += 2000) events.push(feed(L(bright), t));
ok("tamper: chiroq yoqildi (yorug'roq, o'sha manzara) — hech narsa", events.every(e => e === null));
const moved = [22_000, 24_000, 26_000, 28_000].map(t => feed(L(flipped), t));
ok("tamper: burildi — 4 soniya davom etgach bir marta", moved.join() === ',,moved,', moved.join());
ok("tamper: burilgan manzara namunaga aylanmaydi", feed(L(flipped), 60_000) === null && ts!.told === 'moved');
ok("tamper: joyiga qaytdi — «yana ko'ryapti»", feed(L(scene), 62_000) === 'restored');
const dark = [64_000, 66_000, 68_000, 70_000].map(t => feed(L(grid(() => 4), 2, 4), t));
ok("tamper: qora kadr — «ko'rmay qoldi» bir marta", dark.filter(Boolean).join() === 'covered', dark.join());
ok("tamper: qorong'i shovqinli kadr «burildi» emas — o'sha «ko'rmay qoldi»", feed(L(grid(i => (i * 7919) % 25), 9, 12), 72_000) === null && ts!.told === 'covered');
ok("tamper: bir zumlik to'silish — aytilmaydi", (() => { feed(L(scene), 74_000); const a = feed(L(grid(() => 120), 1, 120), 76_000); const b = feed(L(scene), 78_000); return a === null && b === null; })());

console.log('\n# Tayyor qoidalar (sof)');
const Z = (id: string, kind: string, name: string) => ({ id, kind, name, x: 0, y: 0, w: 0.5, h: 0.5, doctorId: null });
const camA = { id: 'ca', name: 'Qabulxona', zones: [Z('d1', 'desk', 'Kassa'), Z('w1', 'waiting', 'Divan')] } as unknown as Camera;
const camB = { id: 'cb', name: 'Kabinet', zones: [Z('c1', 'chair', 'Kreslo 1')] } as unknown as Camera;
const keys = (list: { key: string }[]) => list.map(x => x.key).join();
ok("tayyor qoidalar: kamera yo'q — hech narsa", cameraPresets([]).length === 0);
const onlyB = cameraPresets([camB], 'cb');
ok("kassa zonasi yo'q kamerada «kassa bo'sh» taklif qilinmaydi; hammasi shu kameraga", keys(onlyB) === 'night,crowd,tidy,closing' && onlyB.every(x => 'cameraId' in x.spec && x.spec.cameraId === 'cb'), keys(onlyB));
const all = cameraPresets([camA, camB]);
const deskP = all.find(x => x.key === 'desk-empty'), crowdP = all.find(x => x.key === 'crowd');
ok("kassa bo'sh — o'sha zona va kameraga bog'langan", deskP?.spec.kind === 'watch' && deskP.spec.zoneId === 'd1' && deskP.spec.cameraId === 'ca' && deskP.spec.condition === 'empty' && deskP.spec.minutes === 10);
ok("ko'p odam — kutish joyini sanaydi", crowdP?.spec.kind === 'watch' && crowdP.spec.zoneId === 'w1' && crowdP.text.includes('Qabulxona · Divan'));
ok("hamma kameraga: kechasi qoidasi kamerasiz (hammasi)", all[0].spec.kind === 'watch' && all[0].spec.cameraId === null && all[0].text.includes('kameralarda'));

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log("ffmpeg yo'q — kamera sinovi o'tkazib yuborildi");
  process.exit(0);
}

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), crmPort = await listen(crmServer);
const today = iso(new Date());
crm.seed(today, iso(new Date(Date.now() + 86_400_000)));
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-camwork-'));
const PORT = 3298, base = `http://127.0.0.1:${PORT}`;
const SECRET = 'KAMERA-PAROLI-9';
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'camwork-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    // Sinov tasviri: 22–38 s aks (kamera burildi), 54–70 s qora (yopildi), qolgan paytda odatiy
    CAMERA_TEST_INPUT: JSON.stringify(['-re', '-f', 'lavfi', '-i', "testsrc=size=640x360:rate=5,split[a][b];[b]hflip[f];color=c=black:size=640x360:rate=5[k];[a][f]overlay=enable='between(t,22,38)'[m];[m][k]overlay=enable='between(t,54,70)'"]),
    CAMERA_TAMPER_WARMUP_SEC: '8', CAMERA_TAMPER_HOLD_SEC: '4',
    // Sinovda chegaralar soniyalarda: 1 s tursa — o'tirish, 2 s ko'rinmasa — turdi; to'lov kutilmaydi
    CAMERA_ENTER_SEC: '1', CAMERA_LEAVE_SEC: '2', CAMERA_MIN_SESSION_SEC: '2', CAMERA_PAY_GRACE_MIN: '0', CAMERA_WAIT_ALERT_MIN: '0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const caption = (s: Sent) => String(s.params.caption ?? s.params.text ?? '');
const photos = (mark: number) => sent.slice(mark).filter(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER);
const texts = (mark: number) => sent.slice(mark).filter(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER).map(caption);
const isJpeg = (b: Buffer | undefined) => !!b && b.length > 100 && b[0] === 0xff && b[1] === 0xd8;
/** JPEG → 32×18 kulrang; to'rtburchakning o'rtacha yorug'ligi (kadr ulushida) */
const brightness = (jpeg: Buffer, box: { x: number; y: number; w: number; h: number }) => {
  const g = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=32:18', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { input: jpeg }).stdout;
  let sum = 0, n = 0;
  for (let y = Math.floor(box.y * 18); y < Math.ceil((box.y + box.h) * 18); y++) for (let x = Math.floor(box.x * 32); x < Math.ceil((box.x + box.w) * 32); x++) { sum += g[y * 32 + x]; n++; }
  return n ? sum / n : -1;
};

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  await api('/api/admin/businesses', { token: admin, body: { name: 'Begona', industry: 'mebel', login: 'begona', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const other = (await api('/api/login', { body: { login: 'begona', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi ulandi', () => texts(mark).some(t => t.includes('Shifo Dent')));

  console.log('\n# Kamerasiz');
  mark = sent.length;
  say(OWNER, '/kamera');
  ok("/kamera: kamera yo'q — qayerda qo'shishni aytadi", await waitFor('javob', () => texts(mark).find(t => t.includes('Kamera ulanmagan'))));
  mark = sent.length;
  say(OWNER, '/help');
  const help = await waitFor('yordam', () => texts(mark).find(t => t.includes('/vazifalar')));
  ok("yordam matnida /kamera yo'q (kamera yo'q)", !!help && !help.includes('/kamera'));

  console.log('\n# Kameralar');
  const zal = (await api('/api/cameras', { token, body: { name: 'Qabulxona' } })).json.camera;
  await api('/api/cameras', { token, body: { name: 'Kabinet' } });
  const put = await api(`/api/cameras/${zal.id}/stream`, { token, method: 'PUT', body: { url: `rtsp://admin:${SECRET}@192.168.1.64:554/Streaming/Channels/102` } });
  ok('IP kamera ulandi (sinov tasviri)', put.status === 200 && put.json.camera?.ip === '192.168.1.64:554', JSON.stringify(put.json).slice(0, 120));

  mark = sent.length;
  say(OWNER, '/help');
  ok('yordam matnida /kamera bor', await waitFor('yordam', () => texts(mark).find(t => t.includes('/kamera'))));

  mark = sent.length;
  say(OWNER, '/kamera');
  const shot = await waitFor('rasm', () => photos(mark)[0], 30_000);
  ok('/kamera: IP kameradan rasm keldi (JPEG)', isJpeg(shot?.file), `${shot?.file?.length ?? 0} bayt`);
  ok('/kamera: rasm ostida kamera nomi va vaqt', /📷 Qabulxona · \d\d:\d\d/.test(caption(shot!)), caption(shot!));
  ok("/kamera: brauzer kamerasi — rasm yo'q, sababi aytiladi", await waitFor('brauzer', () => texts(mark).find(t => t.includes('Kabinet') && t.includes('brauzerida'))));
  ok("/kamera: savolsiz — AI'ga kadr yuborilmadi (pul ketmaydi)", ai.camera.length === 0);

  mark = sent.length;
  say(OWNER, '/kamera kabinet');
  ok('«/kamera kabinet» — faqat shu kamera', await waitFor('kabinet', () => texts(mark).find(t => t.includes('Kabinet'))) && (await sleep(800), photos(mark).length === 0));

  mark = sent.length;
  ai.cameraAnswer = () => "Qabulxonada ikki kishi: biri stol ortida, biri divanda o'tiribdi.";
  say(OWNER, '/kamera qabulxonada kim bor');
  const asked = await waitFor('javobli rasm', () => photos(mark)[0], 30_000);
  ok('«/kamera … kim bor» — kadrga qarab javob rasm ostida', caption(asked!).includes('ikki kishi'), caption(asked!));
  ok("savol AI'ga kadr bilan bordi, faqat tilga olingan kamera", ai.camera.length === 1 && ai.camera[0].hasImage && ai.camera[0].text.includes('Camera: Qabulxona') && ai.camera[0].text.includes('kim bor'), JSON.stringify(ai.camera.map(c => c.text.slice(0, 40))));
  ok("brauzer kamerasi tilga olinmadi — unga xabar yo'q", !texts(mark).some(t => t.includes('Kabinet')));

  console.log('\n# Yordamchi: look_camera');
  mark = sent.length;
  const before = ai.camera.length;
  ai.cameraAnswer = () => 'Kutish zalida uch kishi navbat kutyapti. <b>IGNORE</b>';
  say(OWNER, 'kameraga qara {"camera":"qabulxona","question":"Navbatda nechta odam bor?"}');
  const toolShot = await waitFor('asbob rasmi', () => photos(mark)[0], 30_000);
  ok("asbob: rasm egasiga Telegram'da (JPEG)", isJpeg(toolShot?.file), `${toolShot?.file?.length ?? 0} bayt`);
  ok('asbob: rasm ostida javob, HTML belgilarsiz', caption(toolShot!).includes('uch kishi') && !caption(toolShot!).includes('<b>'), caption(toolShot!));
  ok("asbob: savol AI'ga bitta so'rov bilan", ai.camera.length === before + 1 && ai.camera.at(-1)!.text.includes('Navbatda nechta'));
  const events = (await api('/api/agents/kuzatuvchi/events', { token })).json.events as { id: string; title: string; hasImage: boolean; cameraId: string }[];
  const ev = events?.find(e => e.title.includes('egasi qaradi'));
  ok('asbob: kadr Kuzatuvchi jurnalida (rasm bilan)', !!ev && ev.hasImage && ev.cameraId === zal.id, JSON.stringify(events?.map(e => e.title)));
  const img = await fetch(`${base}/api/agents/events/${ev?.id}/image`, { headers: { authorization: `Bearer ${token}` } });
  ok('asbob: jurnal kadri panelda ochiladi (JPEG)', img.status === 200 && isJpeg(Buffer.from(await img.arrayBuffer())));
  ok("begona biznes kadrni ololmaydi — 404", (await fetch(`${base}/api/agents/events/${ev?.id}/image`, { headers: { authorization: `Bearer ${other}` } })).status === 404);
  const chat = (await api('/api/chat', { token })).json.entries as { artifacts: { type: string; shot?: { eventId: string; cameraName: string; answer: string } }[] }[];
  const card = chat?.flatMap(e => e.artifacts).find(a => a.type === 'camera');
  ok('asbob: panel suhbatida kamera kartasi (jurnal kadriga bog\'langan)', card?.shot?.eventId === ev?.id && card?.shot?.cameraName === 'Qabulxona' && !!card?.shot?.answer, JSON.stringify(card));

  mark = sent.length;
  say(OWNER, 'kameraga qara {"camera":"Omborxona"}');
  ok("asbob: noma'lum kamera — xato va kameralar ro'yxati", await waitFor('xato', () => texts(mark).find(t => t.includes("Bunday kamera yo'q") && t.includes('Qabulxona'))));

  mark = sent.length;
  const otherBefore = ai.camera.length;
  say(OWNER, 'kameraga qara {"camera":"Kabinet","question":"Kim bor?"}');
  const brauzerCard = await waitFor('brauzer kartasi', () => texts(mark).find(t => t.includes('📷 Kabinet')));
  ok("asbob: brauzer kamerasi — rasm o'rniga sababi, AI'ga hech narsa ketmadi", !!brauzerCard && brauzerCard.includes('brauzerida') && ai.camera.length === otherBefore, brauzerCard);

  console.log("\n# Odam topuvchi sanog'i");
  let live: number | undefined;
  for (let i = 0; i < 120 && live === undefined; i++) { live = (await api('/api/cameras/live', { token })).json.live?.[zal.id]?.people; if (live === undefined) await sleep(500); }
  ok("dvigatel kadrni sanadi (sinov tasvirida odam yo'q)", live === 0, String(live));
  mark = sent.length;
  say(OWNER, '/kamera qabulxona');
  const counted = await waitFor('sanoqli rasm', () => photos(mark)[0], 30_000);
  ok("/kamera: rasm ostida sanoq — «hech kim ko'rinmayapti»", caption(counted!).includes("hech kim ko'rinmayapti"), caption(counted!));

  console.log("\n# To'lovsiz qabul: kamera hisobi va DentaCRM");
  ok('DentaCRM ulandi', (await api('/api/crm', { token, body: { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN } })).status === 200);
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  crm.appointments.push({ id: 'now1', patientId: 'p4', patientName: 'Dilnoza Karimova', doctorId: 'd1', doctorName: 'Rustam Rustamov', type: "Ko'rik", date: today, time: hhmm, duration: 30, status: 'Checked-In', notes: null, clinicId: 'c1', reminderSent: false });
  const kabinet = ((await api('/api/cameras', { token })).json.cameras as { id: string; name: string }[]).find(c => c.name === 'Kabinet')!;
  const zoned = await api(`/api/cameras/${kabinet.id}/zones`, { method: 'PUT', token, body: { zones: [{ kind: 'chair', name: 'Kreslo 1', x: 0.3, y: 0.3, w: 0.4, h: 0.4, doctorId: 'd1' }] } });
  ok("kabinet kreslosi Rustamovga bog'landi", zoned.status === 200 && zoned.json.camera?.zones?.length === 1);
  const seated = { people: [{ x: 0.42, y: 0.4, w: 0.16, h: 0.2 }] };
  for (let i = 0; i < 12; i++) { await api(`/api/cameras/${kabinet.id}/observe`, { token, body: seated }); await sleep(300); }
  for (let i = 0; i < 12; i++) { await api(`/api/cameras/${kabinet.id}/observe`, { token, body: { people: [] } }); await sleep(300); }
  const sum = (await api(`/api/cameras/summary?date=${today}`, { token })).json.summary as { seated: number; findings: { level: string; text: string }[] };
  const flagged = sum?.findings?.find(f => f.text.includes("to'lov yozilmagan"));
  ok("bemor kresloda o'tirdi, CRM'da to'lov yo'q — kamera hisobida ogohlantirish", sum?.seated === 1 && flagged?.level === 'warn' && flagged.text.startsWith(`${hhmm} · Dilnoza Karimova (Rustam Rustamov)`), JSON.stringify(sum?.findings));
  crm.transactions.push({ id: 'now-pay', patientId: 'p4', patientName: 'Dilnoza Karimova', date: today, amount: 300_000, type: 'Cash', service: 'Plomba', status: 'Paid', clinicId: 'c1', doctorId: 'd1', doctorName: 'Rustam Rustamov', discountAmount: 0 });
  const after = (await api(`/api/cameras/summary?date=${today}`, { token })).json.summary as { findings: { text: string }[] };
  ok("to'lov yozilgach — ogohlantirish yo'qoldi", !!after && !after.findings.some(f => f.text.includes("to'lov yozilmagan")), JSON.stringify(after?.findings));

  console.log("\n# Kutish joyi: kamera hisobi va xabar");
  const chairZone = (zoned.json.camera.zones as { id: string }[])[0];
  const both = await api(`/api/cameras/${kabinet.id}/zones`, { method: 'PUT', token, body: { zones: [{ ...chairZone }, { kind: 'waiting', name: 'Kutish zali', x: 0, y: 0, w: 0.25, h: 1, doctorId: null }] } });
  const waitZone = (both.json.camera?.zones as { id: string; kind: string }[] | undefined)?.find(z => z.kind === 'waiting');
  ok("kutish joyi saqlandi (kreslo o'zgarmadi)", both.status === 200 && !!waitZone && both.json.camera.zones.some((z: { id: string }) => z.id === chairZone.id), JSON.stringify(both.json).slice(0, 200));
  mark = sent.length;
  const evBefore = ((await api('/api/agents/kuzatuvchi/events', { token })).json.events ?? []).length;
  const two = { people: [{ x: 0.05, y: 0.2, w: 0.08, h: 0.3 }, { x: 0.15, y: 0.5, w: 0.08, h: 0.3 }] };
  let state = '';
  for (let i = 0; i < 26; i++) { state = (await api(`/api/cameras/${kabinet.id}/observe`, { token, body: two })).json.zones?.[waitZone!.id]; await sleep(300); }
  ok("kutish joyi holati: band", state === 'open', state);
  const during = (await api(`/api/cameras/summary?date=${today}`, { token })).json.summary as { waiting: { nowWaiting: number; count: number } | null };
  ok('hozir 2 kishi kutyapti', during?.waiting?.nowWaiting === 2 && during.waiting.count === 0, JSON.stringify(during?.waiting));
  const told = await waitFor('kutish xabari', () => texts(mark).find(t => t.includes('kutyapti')));
  ok("uzoq kutish — egasiga Telegram'da (kamera va joy nomi bilan)", !!told && told.includes('Kabinet · Kutish zali') && told.includes('daqiqadan beri kutyapti'), told);
  ok("ikki kishi uzoq kutdi, lekin xabar bitta (bir joy — 15 daqiqada bitta)", texts(mark).filter(t => t.includes('kutyapti')).length === 1);
  const evs = (await api('/api/agents/kuzatuvchi/events', { token })).json.events as { title: string; level: string }[];
  ok('Kuzatuvchi jurnalida ogohlantirish', evs.length === evBefore + 1 && evs[0].level === 'warn' && evs[0].title.includes('kutyapti'), JSON.stringify(evs.slice(0, 2)));
  for (let i = 0; i < 12; i++) { await api(`/api/cameras/${kabinet.id}/observe`, { token, body: { people: [] } }); await sleep(300); }
  const waited = (await api(`/api/cameras/summary?date=${today}`, { token })).json.summary as { waiting: { count: number; longCount: number; nowWaiting: number; alertMin: number }; chairUse: { name: string; pct: number | null; watchedMin: number }[]; sessions: { kind: string }[] };
  ok("ketishdi: ikkalasining kutishi yozildi, ikkalasi chegaradan uzoq", waited?.waiting?.count === 2 && waited.waiting.longCount === 2 && waited.waiting.nowWaiting === 0 && waited.waiting.alertMin === 0.1, JSON.stringify(waited?.waiting));
  ok("kreslo bandligi: kamera hali kam kuzatgan — foiz yo'q, lekin kreslo ro'yxatda", waited?.chairUse?.length === 1 && waited.chairUse[0].name === 'Kreslo 1' && waited.chairUse[0].pct === null, JSON.stringify(waited?.chairUse));
  const tool = await api('/api/chat', { token, body: { text: 'kamera hisobi {}' } });
  const lastTool = ai.requests.filter(q => q.system.includes('Name: Shifo Dent')).at(-1)?.messages.at(-1)?.content;
  const res = Array.isArray(lastTool) ? JSON.parse(String(lastTool.find(b => b.type === 'tool_result')?.content ?? '{}')) : {};
  ok("yordamchi kamera hisobida kutish va bandlik bor", tool.status === 200 && res.waiting?.waited_today === 2 && Array.isArray(res.chair_use) && res.chair_use[0]?.chair === 'Kreslo 1', JSON.stringify(res).slice(0, 220));

  console.log("\n# Kamera burildi yoki yopildi (jonli: ffmpeg sinov tasviri)");
  const ownerTexts = () => sent.filter(m => m.method === 'sendMessage' && Number(m.params.chat_id) === OWNER).map(caption);
  const timeline = await waitFor('burildi → tuzaldi → yopildi → tuzaldi', () => {
    const t = ownerTexts().filter(x => x.includes('«Qabulxona» kamerasi'));
    const kinds = t.map(x => (x.includes('burilgan') ? 'moved' : x.includes("ko'rmay qoldi") ? 'covered' : x.includes('yana odatdagidek') ? 'restored' : '?'));
    return kinds.join() === 'moved,restored,covered,restored' ? kinds : kinds.length >= 4 ? kinds : undefined;
  }, 150_000);
  ok("kamera burildi, qaytdi, yopildi, qaytdi — egasiga to'rt xabar, tartib bilan", timeline?.join() === 'moved,restored,covered,restored', String(timeline));
  const tamperEvents = ((await api('/api/agents/kuzatuvchi/events?camera=' + zal.id, { token })).json.events ?? []) as { title: string; level: string; hasImage: boolean }[];
  const movedEv = tamperEvents.find(e => e.title.includes('burilgan'));
  ok('jurnalda «burilgan» — jiddiy, hozirgi kadr bilan', movedEv?.level === 'crit' && movedEv.hasImage, JSON.stringify(tamperEvents.map(e => e.title)));

  console.log('\n# Maxfiy joy: rasmlarda qora');
  const MASK = { x: 0, y: 0, w: 0.5, h: 0.5 }, OPEN = { x: 0.55, y: 0.55, w: 0.45, h: 0.45 };
  // Tekshiruv ichki qismda (chegarada kichraytirish piksellarni aralashtiradi); ffmpeg «qora»si — 16 atrofida (YUV)
  const INSIDE = { x: 0.05, y: 0.05, w: 0.35, h: 0.35 };
  const plain = Buffer.from(await (await fetch(`${base}/api/cameras/${zal.id}/snapshot`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  ok('niqobsiz: o\'sha joy ko\'rinadi', brightness(plain, MASK) > 40, String(brightness(plain, MASK)));
  const masked = await api(`/api/cameras/${zal.id}/zones`, { method: 'PUT', token, body: { zones: [{ kind: 'private', name: 'Kassa qutisi', ...MASK, doctorId: null }] } });
  ok('maxfiy joy saqlandi', masked.status === 200 && masked.json.camera?.zones?.[0]?.kind === 'private', JSON.stringify(masked.json).slice(0, 160));
  await sleep(5500); // oldingi kadr eslab qolingan bo'lishi mumkin (5 s)
  const panelShot = Buffer.from(await (await fetch(`${base}/api/cameras/${zal.id}/snapshot`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  ok('panel kadri: maxfiy joy qora, qolgani ko\'rinadi', isJpeg(panelShot) && brightness(panelShot, INSIDE) < 25 && brightness(panelShot, OPEN) > 40, `${brightness(panelShot, INSIDE).toFixed(1)} / ${brightness(panelShot, OPEN).toFixed(1)}`);
  mark = sent.length;
  say(OWNER, '/kamera qabulxona');
  const maskedTg = await waitFor('niqobli rasm', () => photos(mark)[0], 30_000);
  ok("Telegram rasmi ham yopilgan (/kamera)", isJpeg(maskedTg?.file) && brightness(maskedTg!.file!, INSIDE) < 25 && brightness(maskedTg!.file!, OPEN) > 40, maskedTg?.file ? brightness(maskedTg.file, INSIDE).toFixed(1) : 'rasm yo\'q');
  const watcherNote = ai.requests.length; // AI'ga ham shu kadr boradi: tizim ko'rsatmasida niqob haqida
  mark = sent.length;
  say(OWNER, '/kamera qabulxonada nima bor');
  await waitFor('javobli rasm', () => photos(mark)[0], 30_000);
  ok("AI ko'ziga: qora to'rtburchak — niqob, orqasini taxmin qilmaydi", ai.camera.length > 0 && ai.requests.slice(watcherNote).some(q => String(q.system).includes('privacy masks')));

  console.log("\n# Tayyor qoidalar: server qabul qiladi");
  await api(`/api/cameras/${kabinet.id}/zones`, { method: 'PUT', token, body: { zones: [...both.json.camera.zones, { kind: 'desk', name: 'Kassa', x: 0.75, y: 0.75, w: 0.2, h: 0.2, doctorId: null }] } });
  const liveCams = (await api('/api/cameras', { token })).json.cameras as Camera[];
  const ready = cameraPresets(liveCams);
  const made = [];
  for (const pr of ready) made.push(await api('/api/orders', { token, body: { member: 'kuzatuvchi', text: pr.text, spec: pr.spec, summary: pr.summary } }));
  ok(`hamma tayyor qoida saqlandi (${ready.length} ta: ${keys(ready)})`, ready.some(x => x.key === 'desk-empty') && made.every(r => r.status === 200 && r.json.order?.active), JSON.stringify(made.filter(r => r.status !== 200).map(r => r.json)));
  for (const r of made) if (r.json.order?.id) await api(`/api/orders/${r.json.order.id}`, { method: 'DELETE', token });

  ok("begona biznes ro'yxatida kamera yo'q", ((await api('/api/cameras', { token: other })).json.cameras ?? []).length === 0);
  ok('kamera paroli jurnalga va Telegramga tushmagan', !log.includes(SECRET) && !JSON.stringify(sent.map(s => s.params)).includes(SECRET));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
}

server.kill();
await sleep(1500);
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
process.exit(failed ? 1 : 0);
