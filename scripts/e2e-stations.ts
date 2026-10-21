/**
 * Qabulxonadagi boshqa kompyuterlar (stansiyalar) sinovi — haqiqiy server, kompyuterdagi yordamchi o'rnida HTTP so'rovlar
 * (yordamchining o'zi — PalantirCall.exe agent — Windows'da e2e-phone'da sinaladi):
 *   sof qoidalar: bitta qo'ng'iroq ikki kompyuterda jiringlaganda (routeStation) — biri ko'tarsa, ikkinchisining «tugadi»si
 *   e'tiborsiz; hech kim ko'tarmasa — hammasida to'xtagandagina «ko'tarilmadi»; bitta kompyuterda — avvalgidek;
 *   yo'l: panelda kompyuter qo'shish (bir martalik kod) → ulash (kod bir marta) → ikki kompyuterda jiringladi, biri ko'tardi →
 *   so'rov ochilmadi → yozuv kompyuterdan keldi → tahlil, egasiga xabar → hech kim ko'tarmadi → so'rov → «📞 Kompyuterdan»
 *   (xodimning o'z kompyuteri) → buyruq o'sha kompyuterga → olib tashlangan kompyuter kaliti ishlamaydi.
 * Ishga tushirish: npm run test:stations
 */
process.env.TZ = 'Asia/Tashkent';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LOCAL_STATION, routeStation, type OpenCall } from '../server/phone/journal';
import { decodeIni, encodeIni, patchIniSettings } from '../server/phone/microsip';
import { OWNER, aiServer, listen, press, say, sent, sleep, stopProcess, stt, sttServer, tgServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const STAFF = 6004;

console.log("\n# Bir nechta kompyuterda jiringlash (sof)");
const open = (o: Partial<OpenCall & { station: string | null; ringing: string[] }>) =>
  ({ id: 'c1', direction: 'in' as const, state: 'ringing' as const, startedAt: 0, answeredAt: null, endedAt: null, station: null, ringing: [], ...o });
ok("ikkinchi kompyuterda ham jiringladi — ro'yxatga qo'shiladi", JSON.stringify(routeStation('incoming', 'B', open({ ringing: ['A'] }))) === JSON.stringify({ kind: 'ringing', ringing: ['A', 'B'] }));
ok("bittasida jiringlash to'xtadi, boshqasida davom etyapti — «ko'tarilmadi» emas", JSON.stringify(routeStation('end', 'A', open({ ringing: ['A', 'B'] }))) === JSON.stringify({ kind: 'ringing', ringing: ['B'] }));
ok("oxirgisida ham to'xtadi — odatdagi qoida («ko'tarilmadi»)", routeStation('end', 'B', open({ ringing: ['B'] })).kind === 'pass');
ok("A ko'targan qo'ng'iroqni B ning «tugadi»si yopmaydi; A ning o'zi yopadi", routeStation('end', 'B', open({ state: 'talking', station: 'A' })).kind === 'ignore'
  && routeStation('end', 'A', open({ state: 'talking', station: 'A' })).kind === 'pass');
ok('bitta kompyuter: avvalgidek (jiringladi → tugadi → «ko\'tarilmadi»)', routeStation('end', LOCAL_STATION, open({ ringing: [LOCAL_STATION] })).kind === 'pass'
  && routeStation('incoming', LOCAL_STATION, open({ ringing: [LOCAL_STATION] })).kind === 'ignore');

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), sttPort = await listen(sttServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-stansiya-'));
const dataDir = path.join(work, 'data');
const PORT = 3312, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'stansiya-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    GEMINI_API_KEY: 'g-test', GROQ_API_KEY: '', VOICELAB_API_KEY: '', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, SPEECHLAB_API_KEY: '',
    TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(p: string, opts: { method?: string; token?: string; station?: string; body?: unknown } = {}) {
  const auth = opts.token ? `Bearer ${opts.token}` : opts.station ? `Station ${opts.station}` : undefined;
  const r = await fetch(base + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string }[][] })?.inline_keyboard ?? []).flat();
const now = () => new Date().toISOString();
type Ev = 'incoming' | 'answer' | 'start' | 'end' | 'outgoing';
const send = (station: string, ...events: [Ev, string][]) => api('/api/phone/station/events', { station, body: { events: events.map(([event, number]) => ({ event, number, at: now() })) } });

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => to(OWNER, mark, 'Shifo Dent'));
  const team = (await api('/api/staff', { token, body: { name: 'Aziza' } })).json;
  const aziza = team.staff[0];
  say(STAFF, `/start ${String(aziza.link).split('start=')[1]}`);
  await waitFor('xodim', () => to(STAFF, mark, 'ulandingiz'));

  console.log('\n# Kompyuterni qo\'shish va ulash');
  const made = (await api('/api/phone/stations', { token, body: { name: 'Qabulxona 2', staffId: aziza.id } })).json;
  const other = (await api('/api/phone/stations', { token, body: { name: 'Qabulxona 3' } })).json;
  ok("panelda qo'shildi: bir martalik kod (8 belgi), 30 daqiqa", /^[A-Z2-9]{8}$/.test(made.code) && Date.parse(made.until) - Date.now() > 25 * 60_000 && made.station?.paired === false, JSON.stringify(made).slice(0, 160));
  ok("noto'g'ri kod — 401", (await api('/api/phone/station/pair', { body: { code: 'XXXXXXXX' } })).status === 401);
  const paired = (await api('/api/phone/station/pair', { body: { code: made.code.toLowerCase() } })).json;
  const B = paired.token as string, C = (await api('/api/phone/station/pair', { body: { code: other.code } })).json.token as string;
  ok('kod kalitga almashdi (kichik harf bilan ham), kod ikkinchi marta ishlamaydi', !!B && paired.station?.name === 'Qabulxona 2' && (await api('/api/phone/station/pair', { body: { code: made.code } })).status === 401);
  ok("kalitsiz yoki noto'g'ri kalit — 401", (await send('yolgon', ['incoming', '998901112233'])).status === 401);
  await api('/api/phone/station/commands?wait=0', { station: B });
  await api('/api/phone/station/commands?wait=0', { station: C });
  const listed = (await api('/api/phone/stations', { token })).json.stations as { name: string; online: boolean; paired: boolean; staffId: string | null }[];
  ok("panelda: ikkala kompyuter ulangan va aloqada, «Qabulxona 2» — Azizaniki", listed.length === 2 && listed.every(s => s.paired && s.online) && listed.find(s => s.name === 'Qabulxona 2')?.staffId === aziza.id);

  console.log("\n# Ikki kompyuterda jiringladi, biri ko'tardi");
  stt.text = "[0:01] 1-ovoz: Assalomu alaykum, Shifo Dent.\n[0:03] 2-ovoz: Ertaga yozilsam bo'ladimi?\n[0:06] 1-ovoz: Ertaga 10:00 ga yozdim.";
  mark = sent.length;
  await send(B, ['incoming', '+998901234567']);
  await send(C, ['incoming', '+998901234567']);
  await send(B, ['answer', '+998901234567']);
  // Ikkinchi kompyuterda jiringlash to'xtadi — MicroSIP «tugadi» yuboradi
  await send(C, ['end', '+998901234567']);
  await sleep(9000);
  await send(B, ['end', '+998901234567']);
  await sleep(400);
  let calls = (await api('/api/calls', { token })).json.calls as { id: string; status: string; direction: string; durationSec: number; hasRecording: boolean; review: string }[];
  ok("bitta yozuv: gaplashildi (~9 soniya), «ko'tarilmadi» emas; qabulxonaga so'rov ochilmadi", calls.length === 1 && calls[0].status === 'ended' && calls[0].durationSec >= 8
    && !(await api('/api/requests', { token })).json.requests.length, JSON.stringify(calls));
  // Yordamchi yozuvni suhbatdan keyin yuboradi — asl vaqtlari bilan
  const t = Date.now();
  const up = await fetch(`${base}/api/phone/station/recording?name=${encodeURIComponent('20261021-101500_998901234567.mp3')}&born=${t - 9500}&mtime=${t - 400}`, {
    method: 'POST', headers: { authorization: `Station ${B}`, 'content-type': 'application/octet-stream' }, body: Buffer.alloc(30_000, 5),
  });
  ok('yozuv kompyuterdan qabul qilindi', up.status === 200);
  const report = await waitFor('egasiga tahlil', () => to(OWNER, mark, "Kiruvchi qo'ng'iroq"), 20_000);
  calls = (await api('/api/calls', { token })).json.calls;
  ok("yozuv qo'ng'iroqqa biriktirildi, matn va tahlil — egasiga xabar", !!report && calls[0].hasRecording && calls[0].review === 'done', textOf(report).slice(0, 120));
  const audio = await fetch(`${base}/api/calls/${calls[0].id}/audio`, { headers: { authorization: `Bearer ${token}` } });
  ok('panelda yozuvni tinglash mumkin', audio.status === 200 && (await audio.arrayBuffer()).byteLength === 30_000);

  console.log("\n# Hech kim ko'tarmadi");
  mark = sent.length;
  await send(B, ['incoming', '+998935556677']);
  await send(C, ['incoming', '+998935556677']);
  await send(B, ['end', '+998935556677']);
  await sleep(400);
  ok("bittasida to'xtadi — hali jiringlayapti, so'rov yo'q", !(await api('/api/requests', { token })).json.requests.length);
  await send(C, ['end', '+998935556677']);
  const card = await waitFor("so'rov kartasi", () => to(STAFF, mark, '+998 93 555 66 77'), 10_000);
  ok("hammasida to'xtadi — «ko'tarilmadi», qabulxonaga so'rov (📞 Kompyuterdan tugmasi bilan)", !!card && buttons(card).some(b => b.callback_data?.startsWith('qc|')), textOf(card).slice(0, 100));

  console.log("\n# «📞 Kompyuterdan» — xodimning o'z kompyuteri");
  const reqId = buttons(card).find(b => b.callback_data?.startsWith('qc|'))!.callback_data!.split('|')[1];
  const waitCmd = api('/api/phone/station/commands?wait=20', { station: B });
  await sleep(300);
  mark = sent.length;
  press(STAFF, `qc|${reqId}`, card!.id!);
  const cmd = (await waitCmd).json.commands as { id: string; number: string }[];
  ok("Aziza bosdi — buyruq uning kompyuteriga («Qabulxona 2») darhol keldi", cmd?.length === 1 && cmd[0].number.endsWith('935556677'), JSON.stringify(cmd));
  ok('ikkinchi kompyuterga buyruq bormadi', !(await api('/api/phone/station/commands?wait=0', { station: C })).json.commands.length);
  const panelDial = await api('/api/phone/dial', { token, body: { phone: '+998935556677', stationId: listed.length ? (await api('/api/phone/stations', { token })).json.stations.find((s: { name: string }) => s.name === 'Qabulxona 3').id : '' } });
  ok("paneldan — tanlangan kompyuterga («Qabulxona 3»)", panelDial.json.station === 'Qabulxona 3' && (await api('/api/phone/station/commands?wait=0', { station: C })).json.commands.length === 1, JSON.stringify(panelDial.json));
  ok("kompyuter tanlanmagan, ikkalasi aloqada — qaysi biri so'raladi", (await api('/api/phone/dial', { token, body: { phone: '+998935556677' } })).status === 409);
  // Chiquvchi qo'ng'iroq shu so'rovga bog'lanadi
  await send(B, ['outgoing', '+998935556677'], ['start', '+998935556677']);
  await sleep(1200);
  await send(B, ['end', '+998935556677']);
  await sleep(500);
  const linked = ((await api('/api/calls', { token })).json.calls as { direction: string; status: string }[]).find(c => c.direction === 'out');
  ok("kompyuterdan terilgan qo'ng'iroq jurnalda (chiquvchi, gaplashildi)", linked?.status === 'ended', JSON.stringify(linked));

  console.log('\n# Olib tashlash');
  const id2 = (await api('/api/phone/stations', { token })).json.stations.find((s: { name: string }) => s.name === 'Qabulxona 2').id;
  ok("olib tashlandi — kaliti darhol ishlamaydi", (await api(`/api/phone/stations/${id2}`, { method: 'DELETE', token })).status === 200 && (await send(B, ['incoming', '998901112233'])).status === 401);
  ok("boshqa biznes kompyuterlarni ko'rmaydi", (await api('/api/phone/stations')).status === 401);

  // Kompyuterdagi yordamchining o'zi — faqat Windows'da (csc.exe bilan yig'iladi)
  if (process.platform === 'win32') {
    console.log("\n# Kompyuterdagi yordamchi (Windows: haqiqiy PalantirCall.exe)");
    const { ensureHookExe } = await import('../server/phone/hook');
    const agentDir = path.join(work, 'stansiya');
    fs.mkdirSync(agentDir);
    const built = await ensureHookExe(agentDir);
    const run = (...args: string[]) => execFileSync(built, args, { windowsHide: true, env: { ...process.env, PALANTIR_FAKE_DIAL_LOG: path.join(work, 'dial.log') } });
    // ini qoidalari serverdagi (microsip.ts) bilan bir xil bo'lishi shart
    const samples = ['[Settings]\r\ncmdCallEnd=""\r\nfoo=bar\r\n\r\n[Account1]\r\nserver=sip.example\r\n', '[Account1]\nserver=x\n\n'];
    const same = samples.every((text, i) => {
      const file = path.join(agentDir, `t${i}.ini`);
      fs.writeFileSync(file, encodeIni({ text, encoding: 'utf16le' }));
      run('patch-ini', file, 'cmdCallEnd=C:\\x\\ms-end.exe', 'autoRecording=1');
      const got = fs.readFileSync(file);
      return got[0] === 0xff && decodeIni(got).text === patchIniSettings(text, { cmdCallEnd: 'C:\\x\\ms-end.exe', autoRecording: '1' });
    });
    ok("ini: yordamchi serverdagidek o'zgartiradi (UTF-16, qo'shtirnoq, yangi kalit bo'lim oxirida, bo'lim yo'q bo'lsa — qo'shiladi)", same);
    const win = (await api('/api/phone/stations', { token, body: { name: 'Windows' } })).json;
    run('pair', base, win.code);
    const cfg = fs.readFileSync(path.join(agentDir, 'palantir-stansiya.ini'), 'utf8');
    ok('ulash: kod kalitga almashdi (sozlama faylida server va kalit)', cfg.includes(`server=${base}`) && /token=\S{20,}/.test(cfg));
    fs.copyFileSync(built, path.join(agentDir, 'ms-incoming.exe'));
    execFileSync(path.join(agentDir, 'ms-incoming.exe'), ['+998977001122'], { windowsHide: true });
    fs.mkdirSync(path.join(agentDir, 'rec'), { recursive: true });
    const recFile = path.join(agentDir, 'rec', '20261021-120000_998977001122.mp3');
    fs.writeFileSync(recFile, Buffer.alloc(9000, 3));
    const old = new Date(Date.now() - 30_000);
    fs.utimesSync(recFile, old, old);
    const winId = (await api('/api/phone/stations', { token })).json.stations.find((s: { name: string }) => s.name === 'Windows').id;
    await api('/api/phone/dial', { token, body: { phone: '+998977001122', stationId: winId } }).catch(() => null);
    run('agent', '--once');
    const ringing = ((await api('/api/calls', { token })).json.calls as { phone: string; status: string }[]).find(c => c.phone.includes('998977001122'));
    ok("yordamchi: MicroSIP hodisasi serverga yetdi (jiringlayapti)", ringing?.status === 'ringing', JSON.stringify(ringing));
    ok("yordamchi: tugagan yozuv serverga ketdi (asl vaqti bilan), kompyuterdan o'chdi", !fs.existsSync(recFile)
      && fs.readdirSync(path.join(dataDir, 'stansiya-yozuvlar', winId)).some(n => n.endsWith('998977001122.mp3')));
    ok("yordamchi: paneldagi «📞 Kompyuterdan» — MicroSIP'ga raqam", fs.existsSync(path.join(work, 'dial.log')) && fs.readFileSync(path.join(work, 'dial.log'), 'utf8').includes('+998977001122'));
  }

  ok('serverda kutilmagan xato yo\'q', !/TypeError|ReferenceError/.test(log), log.match(/.*(TypeError|ReferenceError).*/)?.[0]);
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await stopProcess(server);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl band */ }
  const failed = results.filter(r => !r).length;
  if (failed) console.log(`\n--- server jurnali (oxiri) ---\n${log.slice(-3000)}`);
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
  process.exit(failed ? 1 : 0);
}
