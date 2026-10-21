/**
 * Telefon (MicroSIP) sinovi — haqiqiy kalitsiz va MicroSIP'ni ishga tushirmasdan (ekranda oyna ochilmaydi):
 *   sof qoidalar: ini (UTF-16, qo'shtirnoqli qiymatlar, begona kalitlar joyida), qo'ng'iroq holatlari, yozuv faylini vaqt bo'yicha topish;
 *   haqiqiy qismlar: yordamchi csc.exe bilan yig'iladi, %ProgramData% o'rnidagi papka icacls bilan yopiladi, haqiqiy MicroSIP.ini nusxasi
 *   o'zgartiriladi, yordamchi (ms-incoming.exe …) MicroSIP o'rniga shu sinov ishga tushiradi — hodisa haqiqiy spool orqali keladi;
 *   soxta: Telegram, Claude, ovoz xizmati, MicroSIP jarayonining o'zi (terilgan raqam faylga yoziladi).
 *   Yo'l: ulash → o'tkazib yuborilgan qo'ng'iroq → so'rov qabulxonaga → yana qo'ng'iroq qildi → «📞 Kompyuterdan» → suhbat yozildi →
 *   matn va tahlil → mijoz kartasi, so'rov natijasi, egasiga xabar → yozuvni tinglash → uzish (ini avvalgi holiga).
 * Ishga tushirish: npm run test:phone
 */
process.env.TZ = 'Asia/Tashkent';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeIni, encodeIni, iniHasAccount, patchIniSettings, readIniSettings } from '../server/phone/microsip';
import { decideCall, type OpenCall } from '../server/phone/journal';
import { findRecording } from '../server/phone/recordings';
import { OWNER, ai, aiServer, listen, press, say, sent, sleep, stt, sttServer, tgServer, waitFor, type Sent, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const STAFF = 6002;
const REAL_INI = 'D:/tmp/microsip-test/app/MicroSIP.ini';

console.log('\n# MicroSIP.ini (sof)');
const sample = '[Settings]\r\nrecordingPath=Recordings\r\nautoRecording=0\r\ncmdCallRing="C:\\x\\ring.exe"\r\ncmdCallEnd=""\r\n[Account1]\r\nserver=sip.utel.uz\r\n';
const patched = patchIniSettings(sample, { cmdCallEnd: 'C:\\h\\ms-end.exe', autoRecording: '1', cmdIncomingCall: 'C:\\h\\ms-incoming.exe' });
const back = readIniSettings(patched, ['cmdCallEnd', 'autoRecording', 'cmdIncomingCall', 'cmdCallRing', 'recordingPath'] as const);
ok("kalit almashtirildi, yo'g'i [Settings] ichiga qo'shildi, begona kalit va boshqa bo'lim joyida", back.cmdCallEnd === 'C:\\h\\ms-end.exe' && back.autoRecording === '1' && back.cmdIncomingCall === 'C:\\h\\ms-incoming.exe'
  && back.cmdCallRing === 'C:\\x\\ring.exe' && back.recordingPath === 'Recordings' && patched.indexOf('cmdIncomingCall') < patched.indexOf('[Account1]') && patched.includes('\r\n'));
ok('operator hisobi bor/yo\'q', iniHasAccount(sample) && !iniHasAccount('[Settings]\r\nautoRecording=0\r\n'));
const u16 = encodeIni({ text: sample, encoding: 'utf16le' });
ok('UTF-16 (FF FE) — o\'qib-yozish o\'zgarishsiz', u16[0] === 0xff && u16[1] === 0xfe && decodeIni(u16).text === sample && decodeIni(Buffer.from(sample, 'latin1')).encoding === 'latin1');

console.log('\n# Qo\'ng\'iroq holatlari (sof)');
const run = (events: [Parameters<typeof decideCall>[0], number][]) => {
  let open: OpenCall | null = null; let last: OpenCall | null = null; const log: string[] = [];
  for (const [ev, at] of events) {
    const a = decideCall(ev, at, open, last && !open ? last : null);
    if (a.kind === 'create') open = { id: 'c', direction: a.direction, state: a.state, startedAt: at, answeredAt: a.answered ? at : null, endedAt: null };
    if (a.kind === 'update') {
      const base: OpenCall = open ?? last!;
      const next: OpenCall = { ...base, state: a.state, answeredAt: a.answered ? base.answeredAt ?? at : base.answeredAt, endedAt: a.reopened ? null : a.ended ? at : base.endedAt };
      open = next.endedAt ? null : next; last = next;
    }
    log.push(`${ev}:${a.kind}`);
  }
  return { state: (open ?? last)?.state, log: log.join(' ') };
};
ok("kiruvchi: keldi → ko'tardi → boshlandi → tugadi = gaplashildi", run([['incoming', 0], ['answer', 3000], ['start', 3100], ['end', 60000]]).state === 'ended');
ok("kiruvchi: keldi → tugadi = o'tkazib yuborilgan", run([['incoming', 0], ['end', 20000]]).state === 'missed');
ok("chiquvchi: terildi → tugadi = ko'tarmadi; terildi → boshlandi → tugadi = gaplashildi", run([['outgoing', 0], ['end', 30000]]).state === 'no_answer' && run([['outgoing', 0], ['start', 5000], ['end', 70000]]).state === 'ended');
ok("ikki marta terildi (20 soniya ichida) — bitta yozuv", decideCall('outgoing', 5000, { id: 'o', direction: 'out', state: 'dialing', startedAt: 0, answeredAt: null, endedAt: null }, null).kind === 'ignore');

console.log('\n# Yozuv faylini topish (sof)');
const recDir = fs.mkdtempSync(path.join(tmpdir(), 'palantir-rec-'));
fs.writeFileSync(path.join(recDir, 'boshqa.wav'), Buffer.alloc(5000));
const t0 = Date.now();
fs.writeFileSync(path.join(recDir, '20261018-120000_998944445566.mp3'), Buffer.alloc(5000));
fs.writeFileSync(path.join(recDir, 'kichik.wav'), Buffer.alloc(100));
const hit = findRecording(recDir, { answeredAt: t0 - 2000, endedAt: t0 + 1000 }, '944445566');
ok('suhbat vaqtiga mos, nomida raqami bor fayl tanlandi (kichik/bo\'sh fayl emas)', hit?.file.endsWith('998944445566.mp3') && hit.ext === 'mp3');
ok('boshqa vaqtdagi suhbatga — topilmaydi', findRecording(recDir, { answeredAt: t0 - 3_600_000, endedAt: t0 - 3_500_000 }, null) === null);
fs.rmSync(recDir, { recursive: true, force: true });

// ─── Server ───────────────────────────────────────────────────────────────────
if (process.platform !== 'win32' || !fs.existsSync(REAL_INI)) {
  console.log(`\n(Windows va ${REAL_INI} kerak — server qismi o'tkazib yuborildi)`);
  finish();
}
const tgPort = await listen(tgServer), aiPort = await listen(aiServer), sttPort = await listen(sttServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-phone-'));
const msDir = path.join(work, 'ms'), programData = path.join(work, 'pd'), dataDir = path.join(work, 'data'), dialLog = path.join(work, 'dial.log');
fs.mkdirSync(msDir); fs.mkdirSync(programData);
fs.writeFileSync(path.join(msDir, 'microsip.exe'), 'MZ');
fs.writeFileSync(path.join(msDir, 'lame_enc.dll'), '');
fs.copyFileSync(REAL_INI, path.join(msDir, 'microsip.ini'));
const iniBefore = readIniSettings(decodeIni(fs.readFileSync(path.join(msDir, 'microsip.ini'))).text, ['autoRecording', 'recordingPath', 'recordingFormat', 'cmdCallEnd', 'cmdCallRing'] as const);
const PORT = 3295, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'phone-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    GEMINI_API_KEY: 'g-test', GROQ_API_KEY: '', VOICELAB_API_KEY: '', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, SPEECHLAB_API_KEY: '',
    TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    MICROSIP_EXE: path.join(msDir, 'microsip.exe'), MICROSIP_FAKE_LOG: dialLog, ProgramData: programData, PROGRAMDATA: programData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string }[][] })?.inline_keyboard ?? []).flat();
let hookDir = '';
/** MicroSIP o'rniga: yordamchining o'zi (haqiqiy .exe) raqam bilan ishga tushadi */
const microsip = (event: 'incoming' | 'answer' | 'start' | 'end' | 'outgoing', number: string) => execFileSync(path.join(hookDir, `ms-${event}.exe`), [number], { windowsHide: true });

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => to(OWNER, mark, 'Shifo Dent'));
  const team = (await api('/api/staff', { token, body: { name: 'Aziza' } })).json;
  say(STAFF, `/start ${String(team.staff[0].link).split('start=')[1]}`);
  await waitFor('xodim', () => to(STAFF, mark, 'ulandingiz'));

  console.log('\n# MicroSIP\'ni ulash');
  ok('holat: MicroSIP topildi, hali ulanmagan', (await api('/api/phone', { token })).json.phone?.exePath && !(await api('/api/phone', { token })).json.phone.connected);
  const t = Date.now();
  const con = await api('/api/phone/connect', { token, body: {} });
  ok('ulandi: yordamchi yig\'ildi (csc.exe), yozib olish yoqildi (mp3)', con.json.phone?.connected && con.json.phone.mine && con.json.phone.recordFormat === 'mp3', `${Date.now() - t} ms ${JSON.stringify(con.json).slice(0, 200)}`);
  hookDir = fs.readdirSync(programData).filter(n => n.startsWith('Palantir-ms-')).map(n => path.join(programData, n))[0] ?? '';
  const ini = readIniSettings(decodeIni(fs.readFileSync(path.join(msDir, 'microsip.ini'))).text, ['cmdIncomingCall', 'cmdCallEnd', 'cmdOutgoingCall', 'autoRecording', 'recordingPath', 'recordingFormat', 'cmdCallRing'] as const);
  ok("ini: buyruqlar yordamchiga, autoRecording=1, yozuv papkasi — yordamchi yonida; begona cmdCallRing joyida", ini.cmdIncomingCall === path.join(hookDir, 'ms-incoming.exe') && ini.cmdCallEnd === path.join(hookDir, 'ms-end.exe')
    && ini.autoRecording === '1' && ini.recordingPath === path.join(hookDir, 'rec') && ini.recordingFormat === 'mp3' && ini.cmdCallRing === iniBefore.cmdCallRing, JSON.stringify(ini));
  ok('ini UTF-16 bo\'lib qoldi, zaxira nusxasi bor', fs.readFileSync(path.join(msDir, 'microsip.ini'))[0] === 0xff && fs.existsSync(path.join(msDir, 'microsip.ini.palantir-backup')));
  const acl = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'), [hookDir], { encoding: 'utf8' });
  ok("yordamchi papkasi yopiq (meros ruxsat «(I)» yo'q, «Users» yozolmaydi)", !/\(I\)/.test(acl) && !/BUILTIN\\Users/i.test(acl), acl.split('\n').slice(0, 3).join(' | '));

  console.log('\n# O\'tkazib yuborilgan qo\'ng\'iroq → qabulxona');
  mark = sent.length;
  microsip('incoming', '998944445566');
  await sleep(600);
  microsip('end', '998944445566');
  const card = await waitFor('so\'rov kartasi', () => to(STAFF, mark, "o'tkazib yuborilgan qo'ng'iroq"), 15_000);
  ok("xodimga karta: «Qo'ng'iroq qilish · o'tkazib yuborilgan qo'ng'iroq», raqam, «📞 Kompyuterdan» tugmasi", textOf(card).includes("Qo'ng'iroq qilish") && textOf(card).includes('+998 94 444 55 66') && buttons(card).some(b => b.callback_data?.startsWith('qc|')), textOf(card));
  let calls = (await api('/api/calls', { token })).json.calls;
  ok("jurnal: kiruvchi, o'tkazib yuborilgan, mijoz kartasiga bog'langan", calls[0]?.source === 'microsip' && calls[0].direction === 'in' && calls[0].status === 'missed' && !!calls[0].leadId);
  mark = sent.length;
  await sleep(6000);
  microsip('incoming', '+998944445566');
  await sleep(300);
  microsip('end', '+998944445566');
  ok("yana qo'ng'iroq qildi — yangi so'rov emas, o'sha so'rovga «Yana qo'ng'iroq qildi»", await waitFor('yana', () => to(STAFF, mark, "Yana qo'ng'iroq qildi"), 15_000) && (await api('/api/requests', { token })).json.open === 1);

  console.log('\n# «📞 Kompyuterdan» → suhbat yozildi → tahlil');
  const reqId = buttons(card).find(b => b.callback_data?.startsWith('qc|'))!.callback_data!.split('|')[1];
  press(STAFF, `qc|${reqId}`, card!.id!);
  ok('MicroSIP raqamni terdi', await waitFor('terildi', () => fs.existsSync(dialLog) && fs.readFileSync(dialLog, 'utf8').includes('+998944445566')));
  stt.text = "[0:01] 1-ovoz: Assalomu alaykum, Shifo Dent klinikasi.\n[0:03] 2-ovoz: Implant narxi qancha?\n[0:08] 1-ovoz: Ertaga 10:00 ga yozib qo'yaman.";
  mark = sent.length;
  microsip('outgoing', '+998944445566');
  await sleep(500);
  microsip('start', '+998944445566');
  await sleep(1000);
  // MicroSIP suhbat paytida yozuv faylini yaratadi
  fs.writeFileSync(path.join(hookDir, 'rec', `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_998944445566.mp3`), Buffer.alloc(20_000, 7));
  await sleep(8500);
  microsip('end', '+998944445566');
  const report = await waitFor('egasiga tahlil', () => to(OWNER, mark, "Chiquvchi qo'ng'iroq"), 25_000);
  ok("egasiga: chiquvchi qo'ng'iroq, davomiyligi, xulosa, natija, xodim bahosi", textOf(report).includes('ertaga 10:00 ga yozildi') && textOf(report).includes('Ertaga 10:00, Rustamov') && textOf(report).includes('8/10'), textOf(report));
  ok("tahlilga yozuv matni bordi (gapiruvchilar bilan), yo'nalishi bilan", ai.calls_analysed.at(-1)?.includes('2-ovoz: Implant narxi') && ai.calls_analysed.at(-1)?.includes('Outgoing call'));
  calls = (await api('/api/calls', { token })).json.calls;
  const talk = calls.find((c: { status: string }) => c.status === 'ended');
  ok("jurnal: gaplashildi, ~9 soniya, yozuv bor, tahlil tayyor", talk?.direction === 'out' && talk.durationSec >= 8 && talk.hasRecording && talk.review === 'done' && talk.analysis?.outcome === 'booked', JSON.stringify(talk ?? {}).slice(0, 200));
  const audio = await fetch(`${base}/api/calls/${talk?.id}/audio`, { headers: { authorization: `Bearer ${token}` } });
  ok('panel: yozuvni tinglash (mp3)', audio.status === 200 && audio.headers.get('content-type') === 'audio/mpeg' && (await audio.arrayBuffer()).byteLength === 20_000);
  ok("MicroSIP papkasidan yozuv olib ketildi (Palantir data papkasida)", fs.readdirSync(path.join(hookDir, 'rec')).length === 0 && fs.existsSync(path.join(dataDir, 'recordings', `${talk?.id}.mp3`)));
  const req = (await api('/api/requests', { token })).json.requests[0];
  ok("so'rovga natija: «Qo'ng'iroq qilindi» va tahlil xulosasi (yopishni xodim qiladi)", req?.result?.includes("Qo'ng'iroq qilindi") && req.result.includes('ertaga 10:00'), req?.result);
  const lead = (await api('/api/leads', { token })).json.leads[0];
  ok("mijoz kartasi: bitta, ismi tahlildan, izohi — nima xohladi", (await api('/api/leads', { token })).json.leads.length === 1 && lead?.name === 'Dilnoza' && lead.note?.includes('Implant'), JSON.stringify(lead).slice(0, 200));
  ok('boshqa biznes yozuvni ololmaydi', (await fetch(`${base}/api/calls/${talk?.id}/audio`)).status === 401);

  console.log('\n# Uzish');
  const off = await api('/api/phone/disconnect', { token, body: {} });
  const after = readIniSettings(decodeIni(fs.readFileSync(path.join(msDir, 'microsip.ini'))).text, ['autoRecording', 'recordingPath', 'recordingFormat', 'cmdCallEnd', 'cmdCallRing'] as const);
  ok('uzildi: ini avvalgi holiga (buyruqlar bo\'sh, yozish sozlamasi oldingidek)', off.json.phone?.connected === false && JSON.stringify(after) === JSON.stringify(iniBefore), JSON.stringify(after));
  ok('kartada «📞 Kompyuterdan» endi yo\'q', !(await (async () => { mark = sent.length; say(STAFF, '/sorovlar'); const c = await waitFor('ro\'yxat', () => to(STAFF, mark, "Qo'ng'iroq qilish")); return buttons(c).some(b => b.callback_data?.startsWith('qc|')); })()));
  ok('serverda kutilmagan xato yo\'q', !/TypeError|ReferenceError|SyntaxError/.test(log), log.match(/.*(TypeError|ReferenceError).*/)?.[0]);
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await stopProcess(server);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl band */ }
  if (results.some(r => !r)) console.log(`\n--- server jurnali (oxiri) ---\n${log.slice(-3000)}`);
  finish();
}

function finish(): never {
  const failed = results.filter(r => !r).length;
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
  process.exit(failed ? 1 : 0);
}
