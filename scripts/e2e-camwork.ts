/**
 * Kamera bilan ishlash sinovi (soxta Telegram va Claude, kamera o'rniga ffmpeg sinov tasviri):  npm run test:camwork
 *   /kamera — hamma kameradan hozirgi rasm; «/kamera Zal» — bitta kamera; «/kamera … kim bor» — kadrga qarab javob;
 *   yordamchi «kameraga qara» — look_camera: rasm Telegram'ga, kadr Kuzatuvchi jurnalida, panel suhbatida kamera kartasi;
 *   brauzer kamerasi va noma'lum kamera, begona biznes himoyasi;
 *   to'lovsiz qabul: bemor qabul vaqtida kresloda o'tirgan, DentaCRM'da shu kuni to'lovi yo'q (sof qoida va kamera hisobi).
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
    CAMERA_TEST_INPUT: JSON.stringify(['-re', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=5']),
    // Sinovda chegaralar soniyalarda: 1 s tursa — o'tirish, 2 s ko'rinmasa — turdi; to'lov kutilmaydi
    CAMERA_ENTER_SEC: '1', CAMERA_LEAVE_SEC: '2', CAMERA_MIN_SESSION_SEC: '2', CAMERA_PAY_GRACE_MIN: '0',
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
