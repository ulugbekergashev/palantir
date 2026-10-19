/**
 * So'rovlar va bitta mijoz kartasi sinovi — haqiqiy kalitsiz (soxta Telegram, Claude, Instagram, DentaCRM):
 *   sof qoidalar: telefon kaliti, bir odammi (laqab va oila a'zosi), DentaCRM bemori, eslatma vaqti (tun, mijoz aytgan vaqt);
 *   server: qabulxona xodimi havola bilan ulanadi → bemor Instagram'da «qo'ng'iroq qiling, raqamim …, oltidan keyin» deydi →
 *   so'rov ochiladi (raqam, vaqt, iqtibos, DentaCRM bemori) → karta xodimga va egasiga → bemor raqamni aniqlashtirsa yangi so'rov
 *   ochilmaydi → o'sha odam botga yozib kontakt yuboradi → bitta karta (Instagram + bot) → «Ko'tarmadi» → «Mijozga yozish» →
 *   kartaga «Reply» bilan natija → «Bajarildi» (ikkinchi bosish — «allaqachon») → eslatma → panel va yordamchi asboblari.
 * Ishga tushirish: npm run test:requests
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Lead, LeadRequest } from '../src/types';
import { phoneKey, prettyPhone } from '../src/lib/phone';
import { iso, stamp } from '../src/lib/week';
import { namesFit, patientFor, samePerson } from '../server/personRules';
import { cleanDue, daytime, firstRemind } from '../server/requests/timing';
import { CUSTOMER, OWNER, ai, aiServer, igWeb, igWebServer, listen, press, say, sent, shareContact, sleep, tgNames, tgServer, waitFor, type Sent } from './fakes';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const STAFF = 6001;

console.log('\n# Telefon va bitta odam (sof)');
ok('telefon kaliti: har xil yozuv — bitta raqam', ['+998 94 444-55-66', '8 94 444 55 66', '944445566', '998944445566'].every(p => phoneKey(p) === '944445566') && phoneKey('12345') === null);
ok("ko'rsatish: +998 94 444 55 66", prettyPhone('+998944445566') === '+998 94 444 55 66');
const L = (o: Partial<{ tgUserId: string; igUserId: string; patientId: string; name: string }>) => ({ tgUserId: null, igUserId: null, patientId: null, name: null, ...o });
ok('laqab («Dilya») va to\'liq ism — bir odam', samePerson(L({ name: 'Dilya', igUserId: 'i1' }), L({ name: 'Dilnoza Karimova', tgUserId: 't1' })));
ok("ikki to'liq ism, umumiy so'z yo'q (oila a'zosi) — ikki odam", !samePerson(L({ name: 'Malika Yusupova' }), L({ name: 'Dilnoza Karimova' })) && namesFit('Dilnoza Karimova', 'Karimova Dilnoza'));
ok('boshqa-boshqa Telegram akkaunt — ikki odam', !samePerson(L({ tgUserId: '1' }), L({ tgUserId: '2' })));
const pts = [
  { id: 'p1', firstName: 'Dilnoza', lastName: 'Karimova', phone: '+998944445566', secondaryPhone: null, lastVisit: null, balance: 0 },
  { id: 'p2', firstName: 'Ali', lastName: 'Karimov', phone: '+998944445566', secondaryPhone: null, lastVisit: null, balance: 0 },
  { id: 'p3', firstName: 'Sardor', lastName: 'Aliyev', phone: null, secondaryPhone: '+998 97 555 66 77', lastVisit: null, balance: 0 },
];
ok("bemor: to'liq ism mos — o'sha; telefon oilaniki va ism yo'q — hech kim", patientFor(pts, 'Dilnoza Karimova', '94 444 55 66')?.id === 'p1' && patientFor(pts, null, '944445566') === null);
ok('bemor: ism yo\'q, telefonda bitta bemor (ikkinchi raqami) — o\'sha', patientFor(pts, 'Sardor', '+998975556677')?.id === 'p3');

console.log('\n# Eslatma vaqti (sof)');
const H = { from: 8, to: 21 };
ok('kunduz — o\'zgarmaydi; kech — ertaga 09:00; tong — bugun 09:00', daytime('2026-10-18T14:10', H) === '2026-10-18T14:10' && daytime('2026-10-18T22:30', H) === '2026-10-19T09:00' && daytime('2026-10-19T06:00', H) === '2026-10-19T09:00');
const at = new Date('2026-10-18T12:00:00');
ok("mijoz aytgan vaqt: o'tgan (1 soatdan ko'p), noto'g'ri, 2 haftadan uzoq — olinmaydi", cleanDue('2026-10-18T18:00', at) === '2026-10-18T18:00' && cleanDue('2026-10-18T10:00', at) === null && cleanDue('ertaga', at) === null && cleanDue('2026-11-30T10:00', at) === null);
ok("birinchi eslatma: qo'ng'iroq — 15 daqiqada; mijoz «oltidan keyin» desa — 18:00 da", firstRemind('callback', null, at, H) === '2026-10-18T12:15' && firstRemind('callback', '2026-10-18T18:00', at, H) === '2026-10-18T18:00');
ok('kechqurun ochilgan so\'rov — ertalab eslatiladi', firstRemind('callback', null, new Date('2026-10-18T20:50:00'), H) === '2026-10-19T09:00');

// ─── Server ───────────────────────────────────────────────────────────────────
const tgPort = await listen(tgServer), aiPort = await listen(aiServer), igPort = await listen(igWebServer), crmPort = await listen(crmServer);
const today = iso(new Date()), tomorrow = iso(new Date(Date.now() + 86_400_000));
crm.seed(today, tomorrow);
// Dilnoza Karimova (p4) ertaga qabulga yozilgan — yozishmada ko'chiradi va bekor qiladi
crm.appointments.push({ id: 'up1', patientId: 'p4', patientName: 'Dilnoza Karimova', doctorId: 'd1', doctorName: 'Rustam Rustamov', type: "Ko'rik", date: tomorrow, time: '11:00', duration: 30, status: 'Pending', notes: null, clinicId: 'c1', reminderSent: false });
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-req-'));
const PORT = 3294, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'req-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0', INBOX_DEBOUNCE_MS: '300',
    IG_FAKE_URL: `http://127.0.0.1:${igPort}`, IG_POLL_MS: '500',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
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
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const edits = (chat: number, mark: number, needle: string) => sent.slice(mark).filter(s => s.method === 'editMessageText' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const toast = (mark: number) => sent.slice(mark).filter(s => s.method === 'answerCallbackQuery').map(s => String(s.params.text ?? ''));
const decision = (o: Record<string, unknown>) => ({
  action: 'reply', reply: '', question: '', note_for_owner: '', lead_note: '', customer_name: '', customer_phone: '', follow_up: '', follow_up_days: 0,
  request_kind: 'none', request_phone: '', request_when: '', request_due: '', request_summary: '', ...o,
});

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi ulandi', () => to(OWNER, mark, 'ulandi') || to(OWNER, mark, 'Shifo Dent'));
  const crmOk = await api('/api/crm', { token, body: { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN } });
  ok('DentaCRM ulandi', crmOk.status === 200, JSON.stringify(crmOk.json).slice(0, 120));

  console.log('\n# Qabulxona xodimi');
  const team = (await api('/api/staff', { token, body: { name: 'Aziza' } })).json;
  const link = team.staff?.[0]?.link as string | undefined;
  ok('panel: xodim qo\'shildi, Telegram havolasi bor', !!link?.includes('start=s-'), link);
  mark = sent.length;
  say(STAFF, `/start ${link!.split('start=')[1]}`);
  ok('xodim havolani bosdi — ulandi', await waitFor('xodim', () => to(STAFF, mark, 'qabulxonasiga ulandingiz')));
  ok('egasiga: «Aziza ulandi»', await waitFor('egasi', () => to(OWNER, mark, 'Aziza qabulxona xodimi')));
  ok('panel: ulangan, havola yopildi', (await api('/api/staff', { token })).json.staff[0].linked === true && !(await api('/api/staff', { token })).json.staff[0].link);
  mark = sent.length;
  say(STAFF, `/start ${link!.split('start=')[1]}`);
  ok('eski havola ikkinchi marta ishlamaydi', await waitFor('eski havola', () => to(STAFF, mark, 'eskirgan')));

  console.log('\n# Instagram: «qo\'ng\'iroq qiling» → so\'rov → qabulxona');
  await api('/api/instagram/login', { token, body: {} });
  await sleep(300);
  igWeb.loggedIn = true;
  for (let i = 0; i < 60 && !(await api('/api/me', { token })).json.status.instagram?.account; i++) await sleep(150);
  const due = stamp(new Date(Date.now() + 2 * 3_600_000));
  ai.customer = () => decision({
    action: 'reply', reply: 'Albatta, administratorimiz sizga qo\'ng\'iroq qiladi.', customer_name: 'Dilnoza Karimova', lead_note: "Implant narxini so'radi",
    request_kind: 'callback', request_phone: '94 444 55 66', request_when: 'ikki soatdan keyin', request_due: due, request_summary: "Qo'ng'iroq qilib implant narxini aytish",
  });
  mark = sent.length;
  igWeb.incoming('t1', "Assalomu alaykum, implant qancha turadi? Qo'ng'iroq qiling: 94 444 55 66, ikki soatdan keyin", { pk: '8001', username: 'dilnoza_ig', name: 'Dilnoza' });
  const card = await waitFor('xodimga karta', () => to(STAFF, mark, "Qo'ng'iroq qilish"), 25_000);
  const cardText = textOf(card);
  ok("xodimga karta: kanal, ism, raqam, vaqt, nima qilish, bemorning gapi", cardText.includes('Instagram') && cardText.includes('+998 94 444 55 66') && cardText.includes('ikki soatdan keyin') && cardText.includes('implant narxini aytish') && cardText.includes('implant qancha turadi'), cardText);
  ok("kartada: DentaCRM bemori (telefon va ism mos)", cardText.includes('DentaCRM bemori'));
  ok('tugmalar: Bajarildi, Ko\'tarmadi, Bekor', ['qd|', 'qn|', 'qx|'].every(c => buttons(card).some(b => b.callback_data?.startsWith(c))));
  ok('egasiga ham nusxa', await waitFor('egasi', () => to(OWNER, mark, "Qo'ng'iroq qilish")));
  let list = (await api('/api/requests', { token })).json;
  const req1 = list.requests[0] as LeadRequest & { lead: Lead | null };
  ok("panel: bitta ochiq so'rov, raqam +998…, vaqt, mijoz kartasi Instagram'dan, bemorga bog'langan", list.open === 1 && req1.phone === '+998944445566' && req1.dueAt === due && req1.lead?.channel === 'instagram' && req1.lead?.patientId === 'p4', JSON.stringify(req1).slice(0, 300));
  ok("mijoz ismi bemor kartasidagi to'liq ism", req1.lead?.name === 'Dilnoza Karimova', String(req1.lead?.name));

  // Bemor yana yozdi: «yo'q, boshqa raqam» — yangi so'rov ochilmaydi, eskisi yangilanadi va xodimga aytiladi
  ai.customer = () => decision({ action: 'reply', reply: 'Yaxshi, shu raqamga qo\'ng\'iroq qilamiz.', request_kind: 'callback', request_phone: '+998 90 777 88 99', request_summary: "Qo'ng'iroq qilib implant narxini aytish" });
  mark = sent.length;
  igWeb.incoming('t1', 'Kechirasiz, boshqa raqamga: 90 777 88 99');
  ok("raqam o'zgardi — «So'rov yangilandi» kartasi", await waitFor('yangilandi', () => to(STAFF, mark, "So'rov yangilandi") && to(STAFF, mark, '+998 90 777 88 99'), 15_000));
  list = (await api('/api/requests', { token })).json;
  ok("hali ham bitta so'rov, raqami yangi", list.open === 1 && list.requests[0].phone === '+998907778899');
  // «Rahmat» — so'rov yo'q, hech narsa yuborilmaydi
  ai.customer = () => decision({ action: 'ignore' });
  mark = sent.length;
  igWeb.incoming('t1', 'Rahmat');
  await sleep(2500);
  ok("«rahmat» — xodimga yangi so'rov kartasi yo'q", !to(STAFF, mark, "Qo'ng'iroq qilish</b>"));

  console.log('\n# Qabulxona mijozlarga javob beradi');
  ai.customer = () => decision({ action: 'ask_owner', reply: "Narxni aniqlab, hozir aytamiz.", note_for_owner: 'Narxni ayting' });
  mark = sent.length;
  igWeb.incoming('t1', 'Breket narxi qancha?');
  const staffCard = await waitFor('xodimga javob taklifi', () => to(STAFF, mark, 'Javob taklifi'), 15_000);
  ok("javob taklifi xodimga ham keldi (egasiga — nusxa)", !!staffCard && !!(await waitFor('egasiga nusxa', () => to(OWNER, mark, 'Javob taklifi'))) && buttons(staffCard).some(b => b.callback_data?.startsWith('ra|')));
  const typedBefore = igWeb.typed.length;
  press(STAFF, buttons(staffCard).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, staffCard!.id!);
  ok("xodim «Yuborish»ni bosdi — Instagram'da mijozga ketdi", await waitFor('yuborildi', () => igWeb.typed.slice(typedBefore).some(m => m.text.includes('Narxni aniqlab'))));
  ok('egasidagi karta ham yopildi («Yuborildi», tugmasiz)', await waitFor('egasi kartasi', () => edits(OWNER, mark, 'Yuborildi').length > 0) && !buttons(edits(STAFF, mark, 'Yuborildi').at(-1)).length);
  ai.customer = () => decision({ action: 'ask_owner', reply: 'Aniqlab aytamiz.', note_for_owner: 'Vaqtni ayting' });
  mark = sent.length;
  igWeb.incoming('t1', 'Shanba kuni ishlaysizmi?');
  const card2 = await waitFor('ikkinchi karta', () => to(STAFF, mark, 'Javob taklifi'), 15_000);
  const typed2 = igWeb.typed.length;
  mark = sent.length;
  say(STAFF, 'Ha, shanba 9:00 dan 15:00 gacha ishlaymiz', card2!.id!);
  ok("xodim kartaga «Reply» qildi — o'z matni mijozga ketdi, egasidagi taklif eskirdi", await waitFor('xodim yozdi', () => igWeb.typed.slice(typed2).some(m => m.text.includes('shanba 9:00')))
    && !!(await waitFor('yuborildi xabari', () => to(STAFF, mark, 'yuborildi'))) && !!(await waitFor('eskirdi', () => edits(OWNER, mark, "O'zingiz javob berdingiz").length)));

  console.log('\n# O\'sha odam botga yozdi — bitta karta');
  tgNames.set(CUSTOMER, { first_name: 'Dilya' });
  mark = sent.length;
  say(CUSTOMER, `/start ${String(me.status.generalLink).split('start=')[1]}`);
  await waitFor('bot salom', () => to(CUSTOMER, mark, 'Assalomu alaykum'));
  shareContact(CUSTOMER, '998944445566');
  await waitFor('rahmat', () => to(CUSTOMER, mark, 'Rahmat'));
  await sleep(500);
  const leadsNow = (await api('/api/leads', { token })).json.leads as Lead[];
  const dil = leadsNow.filter(l => phoneKey(l.phone) === '944445566');
  ok("bitta mijoz kartasi (Instagram va bot qo'shildi)", dil.length === 1 && leadsNow.length === 1, JSON.stringify(leadsNow.map(l => [l.name, l.channel, l.phone])));
  const thread = (await api(`/api/inbox/${dil[0]?.id}`, { token })).json;
  ok("kartada Instagram yozishmasi ham bor; so'rov shu kartaga ko'chdi", (thread.messages ?? []).some((m: { channel: string }) => m.channel === 'instagram') && (await api('/api/requests', { token })).json.requests[0].leadId === dil[0]?.id);
  ok("ism — to'liqrog'i (laqab emas), bemor bog'langan", dil[0]?.name === 'Dilnoza Karimova' && dil[0]?.patientId === 'p4', String(dil[0]?.name));

  console.log('\n# Xodim: ko\'tarmadi → mijozga yozish → natija → bajarildi');
  const reqId = list.requests[0].id as string;
  mark = sent.length;
  press(STAFF, `qn|${reqId}`, card!.id!);
  await waitFor('toast', () => toast(mark).length);
  ok("«Ko'tarmadi» — yarim soatdan keyin eslatiladi", toast(mark)[0]?.includes('yarim soatdan keyin'), toast(mark)[0]);
  const edited = await waitFor('karta yangilandi', () => edits(STAFF, mark, "1-urinish: ko'tarmadi").at(-1));
  ok("hamma kartalar yangilandi (xodim va egasi): 1-urinish, «Mijozga yozish» tugmasi", !!edited && edits(OWNER, mark, '1-urinish').length > 0 && buttons(edited).some(b => b.callback_data === `qm|${reqId}`));
  mark = sent.length;
  press(STAFF, `qm|${reqId}`, card!.id!);
  ok('mijozga yozildi (bot orqali — u oxirgi shu yerda yozgan)', await waitFor('mijozga', () => to(CUSTOMER, mark, "Sizga qo'ng'iroq qildik")));
  mark = sent.length;
  say(STAFF, 'Ertaga 10:00 ga yozildi', card!.id!);
  ok("kartaga «Reply» — natija saqlandi", await waitFor('natija', () => to(STAFF, mark, 'Natija so\'rovga yozildi')) && (await api('/api/requests', { token })).json.requests[0].result?.includes('Ertaga 10:00'));
  mark = sent.length;
  press(STAFF, `qd|${reqId}`, card!.id!);
  ok('«Bajarildi» — kartalar yopildi (kim yopgani bilan, tugmasiz)', await waitFor('yopildi', () => edits(OWNER, mark, 'Bajarildi</b> — Aziza').length) && !buttons(edits(STAFF, mark, 'Bajarildi').at(-1)).length);
  mark = sent.length;
  const ownerPress = press(OWNER, `qd|${reqId}`, card!.id!);
  const answerOf = (cb: string) => sent.find(s => s.method === 'answerCallbackQuery' && s.params.callback_query_id === cb);
  await waitFor('toast', () => answerOf(ownerPress));
  ok('egasi ham bossa — «allaqachon bajarilgan (Aziza)»', String(answerOf(ownerPress)?.params.text ?? '').includes('Allaqachon bajarilgan (Aziza)'), String(answerOf(ownerPress)?.params.text));
  ok("panel: ochiq so'rov yo'q, yopilgani tarixda", (await api('/api/requests', { token })).json.open === 0 && (await api('/api/requests?which=closed', { token })).json.requests[0]?.doneBy === 'Aziza');

  console.log('\n# Qabulni ko\'chirish va bekor qilish (DentaCRM)');
  ai.customer = () => decision({
    action: 'reschedule', reply: `Qabulingiz ertaga soat 15:00 ga ko'chirildi.`, book_doctor_id: '', book_date: tomorrow, book_time: '15:00', change_appointment_id: 'up1',
  });
  mark = sent.length;
  say(CUSTOMER, "Ertangi qabulimni soat 15:00 ga o'tkazsa bo'ladimi?");
  const moveCard = await waitFor("ko'chirish kartasi", () => to(STAFF, mark, "Qabulni ko'chiradi"), 15_000);
  ok("modelga bemorning qabullari bordi (appointment_id bilan)", ai.replier.at(-1)?.user.includes('appointment_id up1') && ai.replier.at(-1)?.user.includes('<customer_appointments>'), (ai.replier.at(-1)?.user ?? '').split('</saved_facts>').at(-1)!.slice(0, 900));
  ok("karta: «🔁 Qabulni ko'chiradi: Rustamov: ertaga 11:00 → 15:00», tugma «Ko'chirish va yuborish»", textOf(moveCard).includes(`${tomorrow} 11:00 → ${tomorrow} 15:00`) && buttons(moveCard).some(b => b.text.includes("Ko'chirish")), textOf(moveCard));
  ok("tasdiqsiz CRM'ga tegilmadi", !crm.callResults.length);
  mark = sent.length;
  press(STAFF, buttons(moveCard).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, moveCard!.id!);
  ok("bosildi → DentaCRM'da ko'chirildi (qabulxona natijasi «rescheduled»), bemorga tasdiq", await waitFor('ko\'chdi', () => crm.callResults.some(c => c.id === 'up1' && c.result === 'rescheduled' && c.time === '15:00'))
    && crm.appointments.find(a => a.id === 'up1')?.time === '15:00' && !!(await waitFor('bemorga', () => to(CUSTOMER, mark, "15:00 ga ko'chirildi"))));
  ok("kartalar yopildi: «Ko'chirildi va yuborildi»", !!(await waitFor('yopildi', () => edits(OWNER, mark, "Ko'chirildi va yuborildi").length)));
  // Bekor qilish — eski nashr (qabulxona yo'li yo'q): oddiy tahrir bilan
  ai.customer = () => decision({ action: 'reschedule', reply: "Ko'chirildi", book_date: tomorrow, book_time: '16:00', change_appointment_id: 'boshqa-bemorniki' });
  mark = sent.length;
  say(CUSTOMER, "Qabulni 16:00 ga o'tkazing");
  const held = await waitFor('ushlab qolindi', () => to(STAFF, mark, "Qabul o'zgartirilmadi"), 15_000);
  ok("model begona qabul id'sini bersa — CRM'ga tegilmaydi, egasiga sababi bilan, bemorga «ko'chirildi» ketmaydi", !!held && !crm.callResults.some(c => c.id === 'boshqa-bemorniki')
    && textOf(held).includes('bemorniki emas') && !textOf(held).includes("Ko'chirildi</i>"), textOf(held).slice(0, 300));
  crm.noCallRoute = true;
  ai.customer = () => decision({ action: 'cancel_visit', reply: 'Qabulingiz bekor qilindi. Boshqa vaqtga yozaylikmi?', change_appointment_id: 'up1' });
  mark = sent.length;
  say(CUSTOMER, 'Kechirasiz, ertangi qabulni bekor qiling');
  const cancelCard = await waitFor('bekor kartasi', () => to(STAFF, mark, 'Qabulni bekor qiladi'), 15_000);
  press(OWNER, buttons(cancelCard).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, cancelCard!.id!);
  ok("bekor qilish (eski nashr — PUT): DentaCRM'da Cancelled, bemorga javob", await waitFor('bekor', () => crm.appointments.find(a => a.id === 'up1')?.status === 'Cancelled')
    && crm.callResults.some(c => c.id === 'up1' && c.put) && !!(await waitFor('bemorga', () => to(CUSTOMER, mark, 'bekor qilindi'))));
  crm.noCallRoute = false;
  ai.customer = () => decision({ action: 'reschedule', reply: "Ko'chirildi", book_date: tomorrow, book_time: '15:00', change_appointment_id: 'up1' });
  mark = sent.length;
  say(CUSTOMER, "Qabulni 15:00 ga o'tkazing");
  const none = await waitFor('qabul yo\'q', () => to(STAFF, mark, 'qabuli topilmadi'), 15_000);
  ok("qabul qolmagan bo'lsa: taklif — betaraf javob («ko'chirildi» emas), egasiga sababi", !!none && textOf(none).includes("Ma'lumotni tekshirib") && !textOf(none).includes("Ko'chirildi"), textOf(none).slice(0, 300));

  console.log('\n# Eslatma va panel');
  const manual = (await api('/api/requests', { token, body: { kind: 'callback', phone: '+998 97 555 66 77', name: 'Sardor Aliyev', summary: 'Natijani aytish' } })).json.request;
  ok("paneldan so'rov: telefon bo'yicha mijoz kartasi yo'q — karta ochilmaydi, so'rov ochiladi", !!manual?.id && manual.phone === '+998975556677');
  const db = new DatabaseSync(join(dataDir, 'cerebro.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE requests SET remind_at = ? WHERE id = ?').run(stamp(new Date(Date.now() - 60_000)), manual.id);
  db.close();
  mark = sent.length;
  const remind = await waitFor('eslatma', () => to(STAFF, mark, '⏰'), 8000);
  ok("vaqti kelgan so'rov — xodimga eslatma (tugmalari bilan)", !!remind && textOf(remind).includes('Sardor Aliyev') && buttons(remind).some(b => b.callback_data === `qd|${manual.id}`), textOf(remind).slice(0, 120));
  await sleep(1500);
  ok('eslatma bir marta (keyingisi 30 daqiqada)', sent.slice(mark).filter(s => Number(s.params.chat_id) === STAFF && textOf(s).includes('⏰')).length === 1);
  const done = await api(`/api/requests/${manual.id}/done`, { token, body: { text: 'Gaplashdik' } });
  ok("paneldan yopildi — Telegram'dagi kartalar ham yopildi", done.json.request?.status === 'done' && !!(await waitFor('panel yopdi', () => edits(STAFF, mark, 'Bajarildi').length)));
  mark = sent.length;
  say(STAFF, '/sorovlar');
  ok("/sorovlar — ochiq so'rov yo'q", await waitFor('ro\'yxat', () => to(STAFF, mark, "Ochiq so'rov yo'q")));
  mark = sent.length;
  const aiCalls = ai.requests.length;
  say(STAFF, 'bugun nima qilay?');
  ok("xodim yordamchi bilan gaplashmaydi — qisqa yo'riqnoma", await waitFor("yo'riqnoma", () => to(STAFF, mark, 'kartaga «Reply» qiling')) && ai.requests.length === aiCalls);

  console.log('\n# Yordamchi: so\'rovlar asboblari');
  const tools = (ai.requests.at(-1)?.tools ?? []).map(t => String(t.name));
  ok("yordamchida list_requests, open_request, close_request bor", ['list_requests', 'open_request', 'close_request'].every(n => tools.includes(n)) || (await (async () => {
    say(OWNER, 'Salom');
    await waitFor('AI', () => ai.requests.some(r => r.tools?.some(t => t.name === 'list_requests')), 8000);
    return ai.requests.some(r => (r.tools ?? []).some(t => t.name === 'open_request'));
  })()));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  server.kill();
  await sleep(500);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
  const failed = results.filter(r => !r).length;
  if (failed) console.log(`\n--- server jurnali (oxiri) ---\n${log.slice(-4000)}`);
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
  process.exit(failed ? 1 : 0);
}
