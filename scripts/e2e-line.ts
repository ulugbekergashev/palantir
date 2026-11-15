/**
 * Telefon liniyasi sinovi: kim javob beradi (sof qoida) va panel yo'llari — shahar raqami, ish vaqti, administrator telefoni,
 * Asterisk so'raydigan /api/voice/route. Sinov serverida ASTERISK_WSL=0: haqiqiy Asterisk'ka ham, tgvoice/asterisk/ fayllariga ham tegilmaydi.
 */
import { createServer } from 'node:http';
import { routeNow, transferNow, type LineRouting } from '../server/voice/route';
import { lineProblemOf } from '../server/voice/line';
import { contactState, registrationState, trunkConf, trunkReason } from '../server/voice/trunk';
import { forwardCodes, intlNumber } from '../src/lib/forwarding';
import { accountProblem, zadarmaSign, type ZadarmaNumber } from '../server/voice/zadarma';
import type { Harness } from './e2e-crm';
import { json, patient, readBody } from './fakes';

/** Soxta Zadarma API: imzoni haqiqiydek tekshiradi, raqam/SIP/yo'naltirish holatini eslab qoladi */
export const ZADARMA = { key: 'zkey1234567890', secret: 'zsecret1234567890' };
export const zadarmaState = {
  numbers: [{ number: '998712001122', status: 'on', country: 'Uzbekistan', channels: 2 }],
  sips: [{ id: '100100', display_name: 'Asosiy' }] as { id: string; display_name: string }[],
  created: 0,
  passwords: {} as Record<string, string>,
  routed: {} as Record<string, string>,
};
export const zadarmaServer = patient(createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://zadarma');
  const raw = (await readBody(req)).toString();
  const params = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? url.search.slice(1) : raw));
  const [key, sign] = String(req.headers.authorization ?? '').split(':');
  if (key !== ZADARMA.key || sign !== zadarmaSign(url.pathname, params, ZADARMA.secret)) return json(res, { status: 'error', message: 'Not authorized' }, 401);
  const s = zadarmaState, p = url.pathname;
  if (p === '/v1/info/balance/') return json(res, { status: 'success', balance: 12.5, currency: 'USD' });
  if (p === '/v1/direct_numbers/') return json(res, { status: 'success', info: s.numbers });
  if (p === '/v1/sip/') return json(res, { status: 'success', sips: s.sips, left: 2 });
  if (p === '/v1/sip/create/' && req.method === 'POST') {
    const id = String(100200 + s.created++);
    s.sips.push({ id, display_name: params.name });
    s.passwords[id] = params.password;
    return json(res, { status: 'success', sip: id });
  }
  const pass = p.match(/^\/v1\/sip\/(\d+)\/password\/$/);
  if (pass && req.method === 'PUT') { s.passwords[pass[1]] = params.value; return json(res, { status: 'success', sip: pass[1] }); }
  if (p === '/v1/direct_numbers/set_sip_id/' && req.method === 'PUT') { s.routed[params.number] = params.sip_id; return json(res, { status: 'success', number: params.number, sip_id: params.sip_id }); }
  json(res, { status: 'error', message: `unknown ${req.method} ${p}` }, 404);
}));

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`);
// 2026-10-19 — dushanba, 2026-10-25 — yakshanba
const DAY: LineRouting = { mode: 'day_admin', ring: 20, days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' };

export function lineLogicTests(ok: Harness['ok']): void {
  console.log("\n# Telefon liniyasi: kim javob beradi");
  ok('liniya: «har doim AI» — har doim ai', routeNow({ ...DAY, mode: 'ai' }, at('2026-10-19', '12:00')) === 'ai');
  ok('liniya: ish vaqtida — avval administrator (20 soniya)', routeNow(DAY, at('2026-10-19', '12:00')) === 'admin:20');
  ok("liniya: ish vaqti tugadi — AI", routeNow(DAY, at('2026-10-19', '20:00')) === 'ai' && routeNow(DAY, at('2026-10-19', '08:59')) === 'ai');
  ok('liniya: dam olish kuni — AI', routeNow(DAY, at('2026-10-25', '12:00')) === 'ai');
  ok("liniya: kechki smena yarim tundan o'tadi", routeNow({ ...DAY, days: [1, 2, 3, 4, 5, 6, 7], from: '20:00', to: '02:00' }, at('2026-10-19', '23:30')) === 'admin:20');
  // «AI javob beradi, ish vaqtida kerak bo'lsa o'tkazadi»: qo'ng'iroqni har doim AI oladi; o'tkazish — faqat ish vaqtida
  const SOFT: LineRouting = { ...DAY, mode: 'ai_transfer' };
  ok("liniya: «kerak bo'lsa o'tkazadi» — qo'ng'iroqni ish vaqtida ham AI oladi", routeNow(SOFT, at('2026-10-19', '12:00')) === 'ai');
  ok("liniya: ish vaqtida AI administratorga o'tkaza oladi (20 soniya)", transferNow(SOFT, at('2026-10-19', '12:00')) === 20);
  ok("liniya: kechasi va dam olish kuni o'tkazilmaydi", transferNow(SOFT, at('2026-10-19', '21:00')) === null && transferNow(SOFT, at('2026-10-25', '12:00')) === null);
  ok("liniya: boshqa rejimlarda AI o'tkazmaydi", transferNow(DAY, at('2026-10-19', '12:00')) === null && transferNow({ ...DAY, mode: 'ai' }, at('2026-10-19', '12:00')) === null);

  console.log("\n# Telefon liniyasi: nazorat (egasiga xabar)");
  const st = (asterisk: boolean, trunk: 'none' | 'registered' | 'failed' | 'unknown', ai: boolean | null = true) => ({ asterisk, trunk, phones: [], ai, note: null });
  ok('nazorat: hammasi ulangan — muammo yo\'q', lineProblemOf(st(true, 'registered')) === null);
  ok("nazorat: AI ovoz xizmati to'xtagan — «AI javob bermayapti, administratorga o'tyapti»", /AI javob bermayapti.*administrator/.test(lineProblemOf(st(true, 'registered', false)) ?? ''));
  ok("nazorat: Asterisk javob bermayapti — «qayta yoqing»", /qayta yoqing/.test(lineProblemOf(st(false, 'unknown')) ?? ''));
  ok("nazorat: raqam ulanmadi — «internetni tekshiring»", /internetni/.test(lineProblemOf(st(true, 'failed')) ?? ''));
  const now = Date.parse('2026-10-30T12:00:00Z');
  const num = (o: Partial<ZadarmaNumber>): ZadarmaNumber => ({ number: '998712001122', status: 'on', monthly_fee: 33, stop_date: '2026-11-03 10:00:00', ...o });
  ok('zadarma: to\'lovga 4 kun, balans yetadi — jim', accountProblem(num({}), 40, 'USD', now) === null);
  ok("zadarma: to'lovga 4 kun, balans yetmaydi — ogohlantiradi", /4 kundan keyin.*33 USD.*12\.50 USD/.test(accountProblem(num({}), 12.5, 'USD', now) ?? ''), accountProblem(num({}), 12.5, 'USD', now) ?? '');
  ok("zadarma: to'lovga hali 20 kun — jim (har oy bezovta qilmaydi)", accountProblem(num({ stop_date: '2026-11-20 10:00:00' }), 1, 'USD', now) === null);
  ok("zadarma: raqam to'xtatilgan (parking) — darhol aytadi", /to'xtatilgan/.test(accountProblem(num({ status: 'parking' }), 0, 'USD', now) ?? ''));

  console.log("\n# Telefon liniyasi: shahar raqami (T3) — sozlama va holat");
  const T = { host: '10.20.30.40', port: 5060, login: '712000000', number: '712000000' };
  const withPass = trunkConf(T, 'Maxfiy-1');
  ok("T3: ro'yxatdan o'tish to'xtamaydi — cheksiz urinish, rad javobidan keyin ham qayta",
    /max_retries=1000000/.test(withPass) && /auth_rejection_permanent=no/.test(withPass) && /forbidden_retry_interval=120/.test(withPass) && /fatal_retry_interval=120/.test(withPass), withPass);
  ok("T3: har 30 soniyada operatorga «tirikmisan» (routerdagi yo'l yopilmaydi)", /qualify_frequency=30/.test(withPass) && /expiration=300/.test(withPass));
  const ipOnly = trunkConf(T, null);
  ok("T3: parolsiz (IP bo'yicha) — ro'yxatdan o'tish va parol yo'q, operator IP bilan taniladi",
    !/type=registration/.test(ipOnly) && !/type=auth/.test(ipOnly) && !/outbound_auth/.test(ipOnly) && /match=10\.20\.30\.40/.test(ipOnly) && /qualify_frequency=30/.test(ipOnly), ipOnly);
  ok("T3: TLS port (5061) — transport tls", /transport=tls/.test(trunkConf({ ...T, port: 5061 }, 'p')) && /;transport=tls/.test(trunkConf({ ...T, port: 5061 }, 'p')));
  const regs = (state: string) => ` <Registration/ServerURI..>  <Auth..>  <Status.......>\n==========\n shahar/sip:10.20.30.40          shahar            ${state}        (exp. 250s)\n`;
  ok("T3: «Registered» — ulangan", registrationState(regs('Registered')) === 'registered');
  ok("T3: «Unregistered» — ulanmagan (avval «ulangan» deb ko'rinardi)", registrationState(regs('Unregistered')) === 'failed');
  ok("T3: «Rejected» / «Stopped» — ulanmagan", registrationState(regs('Rejected')) === 'failed' && registrationState(regs('Stopped')) === 'failed');
  ok("T3: ro'yxatda shahar yo'q — o'rnatilmagan", registrationState('No objects found.') === 'none');
  const contacts = (s: string) => `  Contact:  admin/sip:admin@192.168.1.5:5060   abc Avail 3.1\n  Contact:  shahar/sip:10.20.30.40         def ${s}   12.0\n`;
  ok("T3: parolsiz — operator «tirikmisan»ga javob beryapti (Avail) / javob yo'q (Unavail)", contactState(contacts('Avail')) === 'registered' && contactState(contacts('Unavail')) === 'failed');
  const rej = "[2026-11-15 10:00:01] WARNING[123]: res_pjsip_outbound_registration.c:1110 handle_registration_response: 403 Forbidden fatal response received from 'sip:10.20.30.40' on registration attempt to 'sip:712000000@10.20.30.40', retrying in '120' seconds";
  ok("T3: sabab — operator parolni rad etdi (403)", /login yoki parolni rad etdi/.test(trunkReason('failed', 'password', rej) ?? ''), trunkReason('failed', 'password', rej) ?? '');
  const silent = "[2026-11-15 10:00:01] WARNING[123]: res_pjsip_outbound_registration.c:1110 handle_registration_response: No response received from 'sip:10.20.30.40' on registration attempt to 'sip:712000000@10.20.30.40', retrying in '60'";
  ok("T3: sabab — operator serveri javob bermayapti (manzil, port yoki internet; Uztelecom eslatmasi)", /javob bermayapti.*Uztelecom internetida/.test(trunkReason('failed', 'password', silent) ?? ''));
  // Shu kompyuterdagi haqiqiy jurnal (2026-10-28): eski sozlamada 10 urinishdan keyin ro'yxatdan o'tish butunlay to'xtagan
  const stopped = "[Oct 28 16:06:57] WARNING[2809] res_pjsip_outbound_registration.c: Maximum retries reached when attempting outbound registration to 'sip:x with client 'sip:y stopping registration attempt";
  ok("T3: sabab — urinishlar tugagan (haqiqiy jurnal qatori) — «javob bermayapti»", /javob bermayapti/.test(trunkReason('failed', 'password', stopped) ?? ''), trunkReason('failed', 'password', stopped) ?? '');
  ok("T3: «retrying in '120'» javob kodi deb o'qilmaydi", /javob bermayapti/.test(trunkReason('failed', 'password', "No response received from 'sip:x' on registration attempt to 'sip:y', retrying in '120'") ?? ''));
  ok("T3: sabab — 404: login noto'g'ri", /loginni tanimaydi/.test(trunkReason('failed', 'password', "Fatal response '404' received from 'sip:x' on registration attempt to 'sip:y', stopping outbound registration") ?? ''));
  ok("T3: ulangan raqam uchun sabab aytilmaydi (eski xato jurnalda qolgan bo'lsa ham)", trunkReason('registered', 'password', rej) === null);
  ok("T3: nazorat xabarida aniq sabab", /raqam ulanmadi: operator login yoki parolni/.test(lineProblemOf({ ...st(true, 'failed'), reason: trunkReason('failed', 'password', rej) }) ?? ''));

  console.log("\n# Telefon liniyasi: klinika telefonidan yo'naltirish kodlari");
  const f = forwardCodes('998712001122', 15);
  ok("yo'naltirish: ko'tarilmasa 15 s, band, o'chiq — standart GSM kodlari", f?.on.map(c => c.code).join(' ') === '**61*+998712001122**15# **67*+998712001122# **62*+998712001122#', f?.on.map(c => c.code).join(' '));
  ok("yo'naltirish: o'chirish kodi", f?.off.code === '##004#');
  ok("yo'naltirish: 9 xonali mahalliy raqamga +998 qo'shiladi", intlNumber('712001122') === '+998712001122' && intlNumber('+998 71 200-11-22') === '+998712001122');
  ok("yo'naltirish: soniya 5 ga karrali va 5–30 oralig'ida", forwardCodes('998712001122', 42)?.on[0].code.endsWith('**30#') && forwardCodes('998712001122', 12)?.on[0].code.endsWith('**10#'));
  ok("yo'naltirish: raqam noto'g'ri — kod chiqmaydi", forwardCodes('123') === null);
}

export async function lineApiTests(h: Harness): Promise<void> {
  const { ok, api, base, token, otherToken } = h;
  console.log("\n# Telefon liniyasi: panel va Asterisk yo'llari");
  ok('liniya: kirishsiz — 401', (await api('/api/phone/line')).status === 401);
  const first = await api('/api/phone/line', { token });
  ok("liniya: boshida raqam yo'q, «har doim AI», sinov serverida Asterisk o'chiq", first.status === 200 && first.json.line?.trunk === null && first.json.line.routing.mode === 'ai' && first.json.line.status.asterisk === false, JSON.stringify(first.json));

  ok("liniya: noto'g'ri vaqt — 400", (await api('/api/phone/line/routing', { method: 'PUT', token, body: { mode: 'day_admin', ring: 20, days: [1], from: '25:00', to: '20:00' } })).status === 400);
  const day = await api('/api/phone/line/routing', { method: 'PUT', token, body: { mode: 'day_admin', ring: 15, days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59' } });
  ok('liniya: «ish vaqtida administrator» saqlandi', day.status === 200 && day.json.line?.routing.mode === 'day_admin' && day.json.line.routing.ring === 15);
  ok("liniya: begona biznesda o'zgarmadi", (await api('/api/phone/line', { token: otherToken })).json.line?.routing.mode === 'ai');

  // Asterisk ovozli agent kaliti bilan so'raydi
  const key = (await api('/api/voice/key', { method: 'POST', token, body: {} })).json.key as string;
  const route = async (k: string) => { const r = await fetch(`${base}/api/voice/route`, { headers: { authorization: `Bearer ${k}` } }); return { status: r.status, text: await r.text() }; };
  ok("liniya: Asterisk so'raydi — hozir ish vaqti: avval administrator", (await route(key)).text === 'admin:15', JSON.stringify(await route(key)));
  ok("liniya: noto'g'ri kalit — 401", (await route(`${key}x`)).status === 401);
  const handoff = async (k: string) => { const r = await fetch(`${base}/api/voice/handoff`, { headers: { authorization: `Bearer ${k}` } }); return { status: r.status, json: await r.json().catch(() => ({})) as { ring?: number | null } }; };
  ok("liniya: «avval administrator» rejimida AI o'zi o'tkazmaydi", (await handoff(key)).json.ring === null);
  const soft = await api('/api/phone/line/routing', { method: 'PUT', token, body: { mode: 'ai_transfer', ring: 25, days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59' } });
  ok("liniya: «AI javob beradi, kerak bo'lsa o'tkazadi» saqlandi", soft.status === 200 && soft.json.line?.routing.mode === 'ai_transfer');
  ok("liniya: bu rejimda qo'ng'iroqni AI oladi, ish vaqtida o'tkaza oladi (25 s)", (await route(key)).text === 'ai' && (await handoff(key)).json.ring === 25);
  ok("liniya: o'tkazish so'rovi noto'g'ri kalit bilan — 401", (await handoff(`${key}x`)).status === 401);
  await api('/api/phone/line/routing', { method: 'PUT', token, body: { mode: 'ai', ring: 20, days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' } });
  ok('liniya: «har doim AI» — Asterisk darhol AI ga ulaydi', (await route(key)).text === 'ai');

  // AI ishlamay qoldi va administrator ham ko'tarmadi — Asterisk ([yordam]) «qayta qo'ng'iroq qiling» so'rovini ochadi
  const missed = (query: string, k = key) => fetch(`${base}/api/voice/missed?${query}`, { method: 'POST', headers: { authorization: `Bearer ${k}` }, body: 'x=1' });
  ok("liniya: javobsiz qo'ng'iroq — kalitsiz 401", (await missed('phone=998935550077', `${key}x`)).status === 401);
  ok("liniya: javobsiz qo'ng'iroq — raqamsiz (yashirin raqam) 400", (await missed('phone=')).status === 400);
  ok("liniya: javobsiz qo'ng'iroq — so'rov ochildi", (await missed('phone=998935550077')).status === 200);
  const reqs = (await api('/api/requests', { token })).json.requests as { phone?: string; summary?: string; kind?: string; lead?: { phone?: string } }[];
  const cb = reqs.find(r => /AI qo'ng'iroqqa javob bera olmadi/.test(r.summary ?? ''));
  ok("liniya: qabulxonada «qayta qo'ng'iroq qiling» so'rovi, raqami bilan", cb?.kind === 'callback' && /935550077/.test(JSON.stringify(cb)), JSON.stringify(reqs).slice(0, 400));
  // F12: administrator o'zi ko'tarib gaplashdi (Asterisk h) — jurnalda va mijoz kartasida iz qoladi
  const answered = await fetch(`${base}/api/voice/answered?phone=998935550088&sec=42`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: 'x=1' });
  const adminCall = ((await api('/api/calls', { token })).json.calls as { phone: string; durationSec: number; outcome: string; leadId?: string | null }[]).find(c => c.phone.includes('935550088'));
  ok("F12: administrator ko'targan qo'ng'iroq — jurnalda (42 s), mijoz kartasiga bog'langan; kalitsiz — 401",
    answered.status === 200 && adminCall?.durationSec === 42 && /Administrator ko'tardi/.test(adminCall.outcome) && !!adminCall.leadId
    && (await fetch(`${base}/api/voice/answered?phone=998935550088&sec=1`, { method: 'POST', headers: { authorization: `Bearer ${key}x` }, body: 'x=1' })).status === 401, JSON.stringify(adminCall));
  // F12: AI suhbatida raqam yashirin va bemor raqam aytmadi — so'rov baribir «So'rovlar»ga, izoh bilan (avval yo'qolardi)
  const hidden = await fetch(`${base}/api/voice/requests`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ phone: '', kind: 'complaint', summary: "Shifokor kechikdi, shikoyat" }) });
  const hiddenReq = ((await api('/api/requests', { token })).json.requests as { summary?: string; phone?: string | null; kind?: string }[]).find(r => r.summary?.includes('Shifokor kechikdi'));
  ok("F12: yashirin raqam — so'rov baribir ochildi, «raqam yashirin» izohi bilan", hidden.status === 200 && hiddenReq?.kind === 'complaint' && !hiddenReq.phone && !!hiddenReq.summary?.includes('raqam yashirin'), JSON.stringify(hiddenReq));
  ok("liniya: begona biznesda bu so'rov yo'q", !JSON.stringify((await api('/api/requests', { token: otherToken })).json).includes('935550077'));

  ok("liniya: server manzilida ; belgisi — 400 (Asterisk sozlamasi buzilmasin)", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uz;x', login: 'a', number: '1', password: 'p' } })).status === 400);
  ok("liniya: birinchi marta parolsiz — 400", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uztelecom.uz', login: '712000000', number: '712000000' } })).status === 400);
  const trunk = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uztelecom.uz', port: 5060, login: '712000000', number: '712000000', password: 'Maxfiy-parol-1' } });
  ok("liniya: raqam saqlandi; Asterisk o'chiq — ogohlantirish; parol javobda yo'q", trunk.status === 200 && trunk.json.line?.trunk?.host === 'sip.uztelecom.uz' && !!trunk.json.warning && !JSON.stringify(trunk.json).includes('Maxfiy-parol-1'), JSON.stringify(trunk.json).slice(0, 300));
  const again = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip2.uztelecom.uz', port: 5070, login: '712000000', number: '712000000' } });
  ok("liniya: parolsiz qayta saqlash — eski parol qoladi", again.status === 200 && again.json.line?.trunk?.port === 5070);
  const admin = await api('/api/phone/line/admin', { token, body: {} });
  ok('liniya: administrator telefoni uchun parol yaratildi', admin.status === 200 && typeof admin.json.line?.admin?.password === 'string' && admin.json.line.admin.password.length >= 10 && admin.json.line.admin.login === 'admin');
  ok("liniya: begona biznes boshqa biznesning raqamini ko'rmaydi", (await api('/api/phone/line', { token: otherToken })).json.line?.trunk === null);
  ok("liniya: qo'lda kiritilgan raqam — «boshqa operator»", again.json.line?.provider === 'manual' && again.json.line.trunk?.auth === 'password' && again.json.line.trunk.operator === 'other');
  // T3: Uztelecom ajratilgan IP bilan — parolsiz; saqlangan parol o'chiriladi, parolli shaklga qaytishda yana parol kerak
  const ipTrunk = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: '10.20.30.40', login: '712000000', number: '712000000', auth: 'ip', operator: 'uztelecom' } });
  ok("T3: Uztelecom, parolsiz (IP bo'yicha) — saqlandi", ipTrunk.status === 200 && ipTrunk.json.line?.trunk?.auth === 'ip' && ipTrunk.json.line.trunk.operator === 'uztelecom', JSON.stringify(ipTrunk.json).slice(0, 300));
  ok("T3: parolsizdan parolliga — parol yana so'raladi (eskisi o'chirilgan)", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: '10.20.30.40', login: '712000000', number: '712000000' } })).status === 400);
  ok("T3: noto'g'ri ulanish turi — 400", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: '10.20.30.40', login: 'a', number: '1', auth: 'magic' } })).status === 400);
  const check = await api('/api/phone/line/check', { token, body: {} });
  ok("T3: «Tekshirish» — holat qaytadi (sinov serverida Asterisk o'chiq, kutmaydi)", check.status === 200 && check.json.line?.status?.asterisk === false && check.json.line.trunk?.auth === 'ip', JSON.stringify(check.json).slice(0, 200));
  ok("T3: «Tekshirish» kirishsiz — 401", (await api('/api/phone/line/check', { body: {} })).status === 401);
  await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip2.uztelecom.uz', port: 5070, login: '712000000', number: '712000000', password: 'Maxfiy-parol-1' } });
  // «Boshqa operator» shakliga Zadarma SIP'i yozilgan (API kalitlarisiz) — baribir Zadarma: Uztelecom/Sarkor shakli u bilan to'lib ochilmasin
  const manualZ = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'SIP.zadarma.com', port: 5061, login: '343303', number: '', password: 'Zadarma-sip-1' } });
  ok("liniya: qo'lda kiritilgan sip.zadarma.com — Zadarma (boshqa operator emas)", manualZ.status === 200 && manualZ.json.line?.provider === 'zadarma', JSON.stringify(manualZ.json).slice(0, 200));

  console.log("\n# Telefon liniyasi: Zadarma (faqat API kalitlari)");
  const zadarma = (body: Record<string, string>, t = token) => api('/api/phone/line/zadarma', { token: t, body });
  ok("zadarma: kalit formati noto'g'ri — 400", (await zadarma({ key: 'a b', secret: 'x' })).status === 400);
  const wrong = await zadarma({ key: ZADARMA.key, secret: 'boshqasecret12345' });
  ok("zadarma: noto'g'ri secret — tushunarli xato", wrong.status === 400 && /kaliti noto'g'ri/.test(wrong.json.error ?? ''), JSON.stringify(wrong.json));
  zadarmaState.numbers[0].status = 'checking';
  const pending = await zadarma(ZADARMA);
  ok("zadarma: raqam hali tekshiruvda — «faol emas» deydi", pending.status === 400 && /faol emas/.test(pending.json.error ?? ''), JSON.stringify(pending.json));
  zadarmaState.numbers[0].status = 'on';
  const z = await zadarma(ZADARMA);
  const sip = Object.keys(zadarmaState.passwords).find(id => zadarmaState.sips.some(x => x.id === id && x.display_name === 'Palantir AI'));
  ok("zadarma: ulandi — alohida SIP ochildi, raqam unga yo'naltirildi, TLS 5061",
    z.status === 200 && z.json.line?.provider === 'zadarma' && z.json.line.trunk?.host === 'sip.zadarma.com' && z.json.line.trunk.port === 5061
      && !!sip && z.json.line.trunk.login === sip && zadarmaState.routed['998712001122'] === sip && z.json.zadarma?.balance === 12.5,
    JSON.stringify(z.json).slice(0, 300));
  ok("zadarma: klinikaning asosiy SIP'iga tegilmadi", !zadarmaState.passwords['100100']);
  const leaked = JSON.stringify(z.json);
  ok("zadarma: javobda SIP paroli ham, Secret ham yo'q", !leaked.includes(ZADARMA.secret) && !!sip && !leaked.includes(zadarmaState.passwords[sip]));
  const firstPass = sip ? zadarmaState.passwords[sip] : '';
  const z2 = await zadarma(ZADARMA);
  ok("zadarma: qayta ulash — yangi SIP ochilmaydi, faqat paroli yangilanadi", z2.status === 200 && zadarmaState.created === 1 && z2.json.line?.trunk?.login === sip && !!sip && zadarmaState.passwords[sip] !== firstPass);
  ok("zadarma: begona biznes ko'rmaydi", (await api('/api/phone/line', { token: otherToken })).json.line?.trunk === null);
}
