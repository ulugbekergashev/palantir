/**
 * Telefon liniyasi sinovi: kim javob beradi (sof qoida) va panel yo'llari — shahar raqami, ish vaqti, administrator telefoni,
 * Asterisk so'raydigan /api/voice/route. Sinov serverida ASTERISK_WSL=0: haqiqiy Asterisk'ka ham, tgvoice/asterisk/ fayllariga ham tegilmaydi.
 */
import { createServer } from 'node:http';
import { routeNow, transferNow, type LineRouting } from '../server/voice/route';
import { lineProblemOf } from '../server/voice/line';
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
  ok("nazorat: AI ovoz xizmati to'xtagan — «javob berilmaydi»", /javob berilmaydi/.test(lineProblemOf(st(true, 'registered', false)) ?? ''));
  ok("nazorat: Asterisk javob bermayapti — «qayta yoqing»", /qayta yoqing/.test(lineProblemOf(st(false, 'unknown')) ?? ''));
  ok("nazorat: raqam ulanmadi — «internetni tekshiring»", /internetni/.test(lineProblemOf(st(true, 'failed')) ?? ''));
  const now = Date.parse('2026-10-30T12:00:00Z');
  const num = (o: Partial<ZadarmaNumber>): ZadarmaNumber => ({ number: '998712001122', status: 'on', monthly_fee: 33, stop_date: '2026-11-03 10:00:00', ...o });
  ok('zadarma: to\'lovga 4 kun, balans yetadi — jim', accountProblem(num({}), 40, 'USD', now) === null);
  ok("zadarma: to'lovga 4 kun, balans yetmaydi — ogohlantiradi", /4 kundan keyin.*33 USD.*12\.50 USD/.test(accountProblem(num({}), 12.5, 'USD', now) ?? ''), accountProblem(num({}), 12.5, 'USD', now) ?? '');
  ok("zadarma: to'lovga hali 20 kun — jim (har oy bezovta qilmaydi)", accountProblem(num({ stop_date: '2026-11-20 10:00:00' }), 1, 'USD', now) === null);
  ok("zadarma: raqam to'xtatilgan (parking) — darhol aytadi", /to'xtatilgan/.test(accountProblem(num({ status: 'parking' }), 0, 'USD', now) ?? ''));

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

  ok("liniya: server manzilida ; belgisi — 400 (Asterisk sozlamasi buzilmasin)", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uz;x', login: 'a', number: '1', password: 'p' } })).status === 400);
  ok("liniya: birinchi marta parolsiz — 400", (await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uztelecom.uz', login: '712000000', number: '712000000' } })).status === 400);
  const trunk = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip.uztelecom.uz', port: 5060, login: '712000000', number: '712000000', password: 'Maxfiy-parol-1' } });
  ok("liniya: raqam saqlandi; Asterisk o'chiq — ogohlantirish; parol javobda yo'q", trunk.status === 200 && trunk.json.line?.trunk?.host === 'sip.uztelecom.uz' && !!trunk.json.warning && !JSON.stringify(trunk.json).includes('Maxfiy-parol-1'), JSON.stringify(trunk.json).slice(0, 300));
  const again = await api('/api/phone/line/trunk', { method: 'PUT', token, body: { host: 'sip2.uztelecom.uz', port: 5070, login: '712000000', number: '712000000' } });
  ok("liniya: parolsiz qayta saqlash — eski parol qoladi", again.status === 200 && again.json.line?.trunk?.port === 5070);
  const admin = await api('/api/phone/line/admin', { token, body: {} });
  ok('liniya: administrator telefoni uchun parol yaratildi', admin.status === 200 && typeof admin.json.line?.admin?.password === 'string' && admin.json.line.admin.password.length >= 10 && admin.json.line.admin.login === 'admin');
  ok("liniya: begona biznes boshqa biznesning raqamini ko'rmaydi", (await api('/api/phone/line', { token: otherToken })).json.line?.trunk === null);
  ok("liniya: qo'lda kiritilgan raqam — «boshqa operator»", again.json.line?.provider === 'manual');
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
