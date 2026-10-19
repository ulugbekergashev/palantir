/**
 * Telefon liniyasi sinovi: kim javob beradi (sof qoida) va panel yo'llari — shahar raqami, ish vaqti, administrator telefoni,
 * Asterisk so'raydigan /api/voice/route. Sinov serverida ASTERISK_WSL=0: haqiqiy Asterisk'ka ham, tgvoice/asterisk/ fayllariga ham tegilmaydi.
 */
import { routeNow, type LineRouting } from '../server/voice/route';
import type { Harness } from './e2e-crm';

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
}
