/**
 * Qo'ng'iroq yo'llari (tgvoice/asterisk/extensions.conf) HAQIQIY Asterisk'da:  npm run test:dialplan
 * WSL ichida alohida, vaqtinchalik Asterisk nusxasi (/tmp/palantir-dialplan, o'z sozlamalari va boshqaruv soketi bilan):
 * o'rnatilgan Asterisk'ka (/etc/asterisk, systemd xizmati) tegilmaydi, SIP porti ochilmaydi — administrator telefoni (PJSIP)
 * bu nusxada yo'q, ya'ni «administrator ulanmagan». Palantir (/api/voice/*) va AI (AudioSocket, sip_live.py o'rnida) — shu skriptdagi
 * soxta serverlar; Asterisk ularga 127.0.0.1 orqali ulanadi (WSL mirrored tarmoq — klinikadagi kabi).
 * Tekshiriladi: AI ulanmasa / band bo'lsa — uzr va «qayta qo'ng'iroq qiling» so'rovi (TryExec), AI jamoada yo'q (human:) — AI'siz,
 * administrator ko'tarmasa — AI, ko'tarsa — «gaplashdi» Palantir'ga, Palantir javob bermasa — AI, raqam Palantir'ga yetadi; AI suhbat
 * o'rtasida administratorga o'tkazadi (sip_live.py redirect), u ko'tarmasa — AI'ga qaytadi; AI yiqilsa — sip_live.py qayta yonganda qutqaradi.
 * Administrator telefoni — soxta (ADMIN_PHONE = Local/javob|jim@sinov_admin): haqiqiy SIP telefon va operator liniyasi sinalmaydi.
 * Faqat Windows + WSL (distributiv: WSL_DISTRO, bo'lmasa Palantir yoki Cerebro) va unda Asterisk o'rnatilgan bo'lsa.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { createServer as tcpServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sleep } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const DIR = '/tmp/palantir-dialplan';
const CONF = `${DIR}/etc/asterisk.conf`;
const KEY = 'sinov-kalit';
const SRC = resolve('tgvoice', 'asterisk');

const distro = process.env.WSL_DISTRO || (() => {
  const have = execFileSync('wsl', ['-l', '-q'], { encoding: 'utf8' }).replace(/\0/g, '').split(/\r?\n/).map(s => s.trim());
  return !have.includes('Palantir') && have.includes('Cerebro') ? 'Cerebro' : 'Palantir';
})();
const wsl = (script: string, timeout = 30_000) => execFileSync('wsl', ['-d', distro, '-u', 'root', '--exec', 'sh', '-c', script], { encoding: 'utf8', timeout }).replace(/\0/g, '');
const ast = (cmd: string) => wsl(`asterisk -C ${CONF} -rx '${cmd}'`);
const wslPath = (p: string) => p.replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

// ─── Soxta Palantir: kim javob beradi (raqamning oxirgi raqamiga qarab) va «qayta qo'ng'iroq qiling» so'rovi ─────────
const ROUTE: Record<string, string> = { 1: 'ai', 2: 'human:3', 3: 'ai', 4: 'ai', 5: '', 6: 'admin:2', 8: 'ai', 9: 'ai' };
/** Administrator yo'llari sinovi: raqamning o'ziga qarab */
const ROUTE_BY_PHONE: Record<string, string> = { 998900000011: 'admin:5', 998900000012: 'admin:3', 998900000013: 'ai', 998900000014: 'ai', 998900000015: 'ai' };
const hits: { path: string; phone: string; auth: string; sec: string | null }[] = [];
const http = createServer((req: IncomingMessage, res) => {
  const url = new URL(req.url ?? '/', 'http://palantir');
  const phone = url.searchParams.get('phone') ?? '';
  hits.push({ path: url.pathname, phone, auth: String(req.headers.authorization ?? ''), sec: url.searchParams.get('sec') });
  // «…7» — Palantir kalitni tanimadi (401, JSON xato): qo'shtirnoqli javob yo'l tanlashni buzmasin
  if (url.pathname === '/api/voice/route' && phone.endsWith('7')) { res.statusCode = 401; return res.end('{"error":"Ovozli agent kaliti xato"}'); }
  if (url.pathname === '/api/voice/route') return res.end(ROUTE_BY_PHONE[phone] ?? ROUTE[phone.slice(-1)] ?? 'ai');
  // Haqiqiy Palantir javobi kabi (server/voice/routes.ts)
  res.end(url.pathname === '/api/voice/missed' ? '{"request":{"id":"sinov1"}}' : '{"call":{"id":"sinov2"}}');
});

// ─── Soxta AI (AudioSocket): id = rejim(1) + raqam uzunligi(2) + raqam(13) + tasodifiy(16). «…4» — band (darhol qo'yadi),
// «…8»/«…9» — 4 s gaplashib go'shaksiz uziladi (keskin / tinch — sip_live.py jarayoni o'lgandek), qolgani 5 s gaplashib qo'yadi ─
// «…13»/«…14» — AI mijozni administratorga o'tkazadi: ulanish ochiq turadi, uni Asterisk yopadi (channel redirect)
const TRANSFER = new Set(['998900000013', '998900000014']);
const ai: { mode: string; phone: string; id: string }[] = [];
const aiServer = tcpServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on('error', () => {});
  sock.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length < 19 || ai.some(a => (a as { sock?: unknown }).sock === sock)) return;
    if (buf[0] !== 0x01) return void sock.destroy();
    const id = buf.subarray(3, 19).toString('hex');
    const len = Number(id.slice(1, 3));
    const phone = id.slice(3, 16).slice(13 - len);
    ai.push(Object.assign({ mode: id[0], phone, id }, { sock }));
    if (TRANSFER.has(phone) && id[0] === '2') return;
    if (phone === '998900000004') return void sock.end(Buffer.from([0x00, 0x00, 0x00])); // band: sip_live.py kabi — go'shak, keyin yopadi
    setTimeout(() => { if (phone === '998900000008') sock.destroy(); else if (phone === '998900000009') sock.end(); else sock.end(Buffer.from([0x00, 0x00, 0x00])); }, phone === '998900000008' || phone === '998900000009' ? 4_000 : 5_000);
  });
});

const listen = (s: Server | ReturnType<typeof createServer>) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const deadPort = async () => { const s = tcpServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; };

const httpPort = await listen(http), aiPort = await listen(aiServer), noAiPort = await deadPort();

/** Vaqtinchalik nusxa sozlamalari: faqat kerakli modullar (SIP yo'q), jurnal — NOTICE dan */
function stage(): string {
  const local = join(process.env.TEMP || tmpdir(), 'palantir-dialplan');
  rmSync(local, { recursive: true, force: true });
  mkdirSync(local, { recursive: true });
  const modules = ['pbx_config', 'app_dial', 'app_playback', 'app_stack', 'app_exec', 'app_verbose', 'func_curl', 'res_curl', 'func_cut', 'func_logic',
    'func_strings', 'func_rand', 'func_callerid', 'func_channel', 'app_audiosocket', 'res_audiosocket', 'format_wav', 'format_pcm', 'codec_ulaw', 'codec_alaw', 'res_clioriginate', 'bridge_simple', 'bridge_native_rtp', 'bridge_holding'];
  const files: Record<string, string> = {
    'asterisk.conf': ['[directories]', `astetcdir => ${DIR}/etc`, 'astmoddir => /usr/lib/x86_64-linux-gnu/asterisk/modules', `astvarlibdir => ${DIR}/lib`,
      `astdbdir => ${DIR}/lib`, `astkeydir => ${DIR}/lib`, 'astdatadir => /usr/share/asterisk', `astagidir => ${DIR}/lib/agi-bin`, `astspooldir => ${DIR}/spool`,
      `astrundir => ${DIR}/run`, `astlogdir => ${DIR}/log`, 'astsbindir => /usr/sbin', '[options]', ''].join('\n'),
    'modules.conf': ['[modules]', 'autoload=no', ...modules.map(m => `load => ${m}.so`), ''].join('\n'),
    'logger.conf': ['[logfiles]', 'messages.log => notice,warning,error,verbose(3)', ''].join('\n'),
    // Klinikada install.sh yozadigan fayl + sinov kirishlari: «mijoz» shu raqamdan, AI — soxta (ishlaydigan yoki o'chiq)
    'extensions_palantir.conf': [
      '[globals]', `PALANTIR_URL=http://127.0.0.1:${httpPort}`, `PALANTIR_KEY=${KEY}`, '',
      '[sinov_ai]', 'exten => _X.,1,Set(CALLERID(num)=${EXTEN})', ` same => n,Set(AI_SOCKET=127.0.0.1:${aiPort})`, ' same => n,Goto(shahar,${EXTEN},1)', '',
      '[sinov_aiyoq]', 'exten => _X.,1,Set(CALLERID(num)=${EXTEN})', ` same => n,Set(AI_SOCKET=127.0.0.1:${noAiPort})`, ' same => n,Goto(shahar,${EXTEN},1)', '',
      // Soxta administrator telefoni (ADMIN_PHONE): «javob» — ko'taradi, 3 s gaplashib qo'yadi; «jim» — jiringlaydi, ko'tarmaydi
      '[sinov_admin]', 'exten => javob,1,Answer()', ' same => n,Wait(3)', ' same => n,Hangup()', 'exten => jim,1,Wait(60)', '',
    ].join('\n'),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(local, name), text);
  copyFileSync(join(SRC, 'extensions.conf'), join(local, 'extensions.conf'));
  return wslPath(local);
}

/** Qo'ng'iroq: «mijoz» raqamdan; tugashini kutadi (kanal qolmaguncha). Qaytaradi: necha soniya davom etdi */
async function call(phone: string, ctx: 'sinov_ai' | 'sinov_aiyoq'): Promise<number> {
  const started = Date.now();
  ast(`channel originate Local/${phone}@${ctx}/n application Wait 60`);
  await sleep(1_000);
  for (let i = 0; i < 60; i++) {
    if (!/Local\//.test(ast('core show channels concise'))) return Math.round((Date.now() - started) / 1000);
    await sleep(500);
  }
  console.log(`    (qo'ng'iroq 30 s da tugamadi: ${phone})`);
  return Math.round((Date.now() - started) / 1000);
}
const missed = (phone: string) => hits.some(h => h.path === '/api/voice/missed' && h.phone === phone && h.auth === `Bearer ${KEY}`);
const routed = (phone: string) => hits.some(h => h.path === '/api/voice/route' && h.phone === phone && h.auth === `Bearer ${KEY}`);
const aiGot = (phone: string) => ai.find(a => a.phone === phone);
const answered = () => hits.some(h => h.path === '/api/voice/answered');
const answeredFor = (phone: string) => hits.find(h => h.path === '/api/voice/answered' && h.phone === phone && h.auth === `Bearer ${KEY}`);
const aiAll = (phone: string) => ai.filter(a => a.phone === phone).map(a => a.mode);
const admin = (who: 'javob' | 'jim' | null) => ast(`dialplan set global ADMIN_PHONE ${who ? `Local/${who}@sinov_admin/n` : 'PJSIP/admin'}`);
/** Haqiqiy sip_live.py funksiyasi shu vaqtinchalik Asterisk bilan (SIP_ASTERISK_CONF) */
const python = (code: string) => execFileSync(resolve('tgvoice', '.venv', 'Scripts', 'python.exe'), ['-X', 'utf8', '-c', `import asyncio, sip_live; ${code}`], {
  cwd: resolve('tgvoice'), encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, SIP_ASTERISK_CONF: CONF, SIP_BRIDGE_PORT: String(aiPort), SIP_WSL_DISTRO: distro, PYTHONIOENCODING: 'utf-8' },
});
const uuidOf = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
async function until(fn: () => boolean, ms = 20_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) if (fn()) return true;
  return false;
}
/** AI suhbat o'rtasida administratorga o'tkazadi (sip_live.redirect_to_operator — haqiqiy kod); qaytaradi: xato yoki «None» */
async function transfer(phone: string): Promise<string> {
  ast(`channel originate Local/${phone}@sinov_ai/n application Wait 60`);
  if (!await until(() => !!aiGot(phone))) return 'AI ulanmadi';
  return python(`print(asyncio.run(sip_live.redirect_to_operator('${uuidOf(aiGot(phone)!.id)}', 5)))`).trim();
}
const ended = (phone: string) => until(() => !ast('core show channels concise').includes(`Local/${phone}@`), 30_000);

try {
  const local = stage();
  wsl(`command -v asterisk >/dev/null || { echo "asterisk yo'q" >&2; exit 1; }
    [ -S ${DIR}/run/asterisk.ctl ] && asterisk -C ${CONF} -rx 'core stop now' >/dev/null 2>&1; sleep 1
    rm -rf ${DIR} && mkdir -p ${DIR}/etc ${DIR}/lib ${DIR}/spool ${DIR}/run ${DIR}/log
    cp ${local}/*.conf ${DIR}/etc/
    asterisk -C ${CONF}`);
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await sleep(500); try { up = /fully booted/i.test(ast('core waitfullybooted')); } catch { /* hali */ } }
  ok(`vaqtinchalik Asterisk ishga tushdi (${distro}, ${wsl('asterisk -V').trim()})`, up);
  if (!up) throw new Error('Asterisk ko\'tarilmadi');
  ast('core set verbose 3');
  ok('qo\'ng\'iroq yo\'llari yuklandi ([kiruvchi], [ai], [yordam])', /kiruvchi/.test(ast('dialplan show kiruvchi')) && /yordam/.test(ast('dialplan show yordam')));

  console.log('\n# AI ulanmagan (sip_live.py ishlamayapti)');
  await call('998900000001', 'sinov_aiyoq');
  ok('raqam Palantir\'ga yetdi (/api/voice/route?phone=, kalit bilan)', routed('998900000001'));
  ok("qo'ng'iroq uzilmadi: administrator ulanmagan — uzr va «qayta qo'ng'iroq qiling» so'rovi", missed('998900000001') && !aiGot('998900000001'));

  console.log('\n# AI administrator jamoada yo\'q (human:) — A3');
  await call('998900000002', 'sinov_ai');
  ok("AI'ga ulanmadi (AI ishlab tursa ham), administrator ko'tarmadi — so'rov", !aiGot('998900000002') && missed('998900000002'));

  console.log('\n# AI javob berdi');
  await call('998900000003', 'sinov_ai');
  const a3 = aiGot('998900000003');
  ok("AI ulandi: mijoz rejimi (2), raqam AudioSocket id'sida", a3?.mode === '2', JSON.stringify(a3 && { mode: a3.mode, phone: a3.phone }));
  ok("AI gaplashib bo'lgach — so'rov ochilmaydi", !missed('998900000003'));

  console.log('\n# AI band (hamma liniya band — darhol qo\'yadi)');
  await call('998900000004', 'sinov_ai');
  ok("AI ulandi, lekin band — uzr va so'rov (TryExec 3 soniya qoidasi)", !!aiGot('998900000004') && missed('998900000004'));

  console.log('\n# Palantir «kim javob beradi»ga javob bermadi');
  await call('998900000005', 'sinov_ai');
  ok("bo'sh javob — AI oladi, so'rov yo'q", aiGot('998900000005')?.mode === '2' && !missed('998900000005'));

  console.log('\n# Ish vaqti: avval administrator (admin:2) — u ulanmagan');
  await call('998900000006', 'sinov_ai');
  ok("administrator ko'tarmadi — AI oladi (rejim 2), so'rov yo'q", aiGot('998900000006')?.mode === '2' && !missed('998900000006'));
  ok("administrator gaplashmagan — «gaplashdi» yozuvi yo'q (h)", !answered());

  console.log("\n# Ish vaqti: administrator ko'tardi");
  admin('javob');
  await call('998900000011', 'sinov_ai');
  const talk = answeredFor('998900000011');
  ok("AI'ga bormaydi, «administrator gaplashdi» Palantir'ga — raqam va soniya (h)", !aiGot('998900000011') && !!talk && Number(talk.sec) >= 2, JSON.stringify(talk));

  console.log("\n# Ish vaqti: administrator jiringladi, ko'tarmadi");
  admin('jim');
  await call('998900000012', 'sinov_ai');
  ok("3 soniyadan keyin AI oladi (rejim 2), so'rov va «gaplashdi» yo'q", aiGot('998900000012')?.mode === '2' && !missed('998900000012') && !answeredFor('998900000012'));

  console.log("\n# AI suhbat o'rtasida administratorga o'tkazdi (channel redirect) — u ko'tardi");
  admin('javob');
  const t13 = await transfer('998900000013');
  ok("sip_live.redirect_to_operator: kanal topildi va burildi", t13 === 'None', t13);
  ok("administrator gaplashdi, qo'ng'iroq tugadi — AI'ga qaytmadi, so'rov yo'q", await ended('998900000013') && aiAll('998900000013').join() === '2' && !missed('998900000013'), aiAll('998900000013').join());

  console.log("\n# AI o'tkazdi — administrator ko'tarmadi: mijoz AI'ga qaytadi (3-rejim)");
  admin('jim');
  const t14 = await transfer('998900000014');
  ok("burildi", t14 === 'None', t14);
  ok("administrator ko'tarmadi — AI qayta ulandi «ko'tarmadi» rejimida (3), so'rov yo'q", await ended('998900000014') && aiAll('998900000014').join() === '2,3' && !missed('998900000014'), aiAll('998900000014').join());

  console.log("\n# AI ishlamayapti — administrator ko'tardi");
  admin('javob');
  await call('998900000015', 'sinov_aiyoq');
  ok("administrator gaplashdi — «qayta qo'ng'iroq qiling» so'rovi ochilmaydi", !missed('998900000015') && !aiGot('998900000015'));
  admin(null);

  console.log("\n# Palantir kalitni tanimadi (401 — JSON xato)");
  await call('998900000007', 'sinov_ai');
  ok("qo'shtirnoqli javob yo'lni buzmadi — AI oladi", aiGot('998900000007')?.mode === '2' && !missed('998900000007'));

  console.log("\n# AI suhbat o'rtasida yiqildi (sip_live.py o'ldi yoki yangilanishda o'chirildi) — qayta ishga tushganda qutqaradi");
  // Ikkalasi bir vaqtda: biri keskin uziladi (RST), biri tinch yopiladi (FIN) — ikkalasida ham go'shak yo'q
  ast('channel originate Local/998900000008@sinov_ai application Wait 60');
  ast('channel originate Local/998900000009@sinov_ai application Wait 60');
  await sleep(9_000);
  const stuck = ast('core show channels concise').split('\n').filter(l => /!AudioSocket!/.test(l)).length;
  ok("Asterisk AI uzilganini o'zi sezmaydi — ikkala mijoz jimlikda turibdi (shuning uchun qutqarish kerak)", stuck === 2, `${stuck} ta`);
  // Haqiqiy sip_live.py qutqaruvi (ishga tushishdagi qadam) — shu vaqtinchalik Asterisk bilan
  const out = python('asyncio.run(sip_live.rescue_orphans())');
  ok("sip_live.py: ikkala qo'ng'iroq administratorga burildi", (out.match(/burildi/g) ?? []).length === 2, out.trim().split('\n').slice(-2).join(' | '));
  let left = 2;
  for (let i = 0; i < 40 && left; i++) { await sleep(500); left = ast('core show channels concise').split('\n').filter(l => /Local\/99890000000[89]/.test(l)).length; }
  ok("administrator ulanmagan — uzr va «qayta qo'ng'iroq qiling» so'rovi, qo'ng'iroq tugadi", !left && missed('998900000008') && missed('998900000009'));

  const log = wsl(`cat ${DIR}/log/messages.log 2>/dev/null || true`);
  // To'liq jurnal (qadamlar bilan) — yiqilganda sababini ko'rish uchun
  writeFileSync(join(process.env.TEMP || tmpdir(), 'palantir-dialplan.log'), log);
  ok('jurnalda sabablar: «AI ulanmadi yoki band», «AI o\'chiq, administrator»', /AI ulanmadi yoki band/.test(log) && /AI o'chiq, administrator/.test(log));
  ok("jurnal to'g'ri: ochilgan so'rov «ochildi» deb yoziladi (JSON javob ifodani buzmaydi)", /998900000001 — «qayta qo'ng'iroq qiling» so'rovi: ochildi/.test(log) && !/syntax error/.test(log));
  // Yiqilsa (yoki DIALPLAN_LOG=1) — jurnal, Asterisk'ning ishga tushish shovqinisiz
  const NOISE = /config file|ccss\.c|indications|udptl|cdr\.c|cel\.c|features_config|manager\.c|loader\.c|built by/;
  if (results.some(r => !r) || process.env.DIALPLAN_LOG) console.log(log.split('\n').filter(l => l.trim() && !NOISE.test(l)).slice(-60).join('\n'));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`, false);
} finally {
  try { wsl(`asterisk -C ${CONF} -rx 'core stop now' >/dev/null 2>&1; sleep 1; rm -rf ${DIR}`); } catch { /* to'xtatilgan */ }
  http.close();
  aiServer.close();
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
