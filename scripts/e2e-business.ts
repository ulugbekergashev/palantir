/**
 * Telegram Business sinovlari: egasi botni o'z akkauntiga chat-bot qilib qo'shadi (Bot API business_connection) → shaxsiy chatiga
 * yozgan mijoz mijozlar oqimiga tushadi → javob taklifi egasiga → «Yuborish» — egasi nomidan (business_connection_id bilan) →
 * botning aks-sadosi tashlanadi, egasining telefondan yozgani yozishmaga → ruxsatsiz ulanish — faqat o'qiydi → o'chirildi.
 * Begona akkaunt ulasa — hech narsa saqlanmaydi.
 */
import type { LiveStatus } from '../src/types';
import type { Harness } from './e2e-crm';
import { OWNER, ai, businessConnection, businessMessage, press, sent, waitFor, type Sent } from './fakes';

const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));

// Boshqa sinovlarda ishlatilmagan id'lar (7101… — e2e-crm'dagi bot mijozlari: o'sha odam bo'lsa, karta bitta bo'lardi)
const CUSTOMER = 7301, FRIEND = 7302, STRANGER = 7399;

export async function businessTests(h: Harness): Promise<void> {
  const { ok, api, token } = h;
  const status = async () => (await api('/api/me', { token })).json.status as LiveStatus;
  const leadOf = async () => ((await api('/api/leads', { token })).json.leads as { id: string; channel: string; source: string | null; name: string | null }[]).find(l => l.source === 'Telegram (Business)');
  await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'draft', contacts: false, delayMin: 1 } });

  console.log('\n# Telegram Business (egasining shaxsiy chatlari, rasmiy yo\'l)');
  let mark = sent.length;
  businessConnection({ id: 'bc-begona', userId: STRANGER, canReply: true });
  ok("begona akkaunt botni chat-bot qilsa — tushuntirish, hech narsa saqlanmaydi", !!(await waitFor('begonaga', () => to(STRANGER, mark, 'faqat Palantir'))) && !(await status()).telegramBusiness.account);

  mark = sent.length;
  businessConnection({ id: 'bc-1', userId: OWNER, canReply: true });
  const connected = await waitFor('egasiga', () => to(OWNER, mark, 'Telegram Business ulandi'));
  ok('egasi ulandi — panelda akkaunt, javob ruxsati bor; egasiga xabar', !!connected && (await status()).telegramBusiness.canReply && !!(await status()).telegramBusiness.account);
  ok("ulanishda maslahat: «Kontaktlarimdan tashqari» — do'st va qarindoshlar bemor bo'lib qolmasin (E13)", textOf(connected).includes('Kontaktlarimdan tashqari'));

  ai.customer = () => ({
    action: 'reply', reply: "Assalomu alaykum! Ha, ertaga 10:00 dan ochiqmiz.", question: '', note_for_owner: '', lead_note: '', customer_name: '', customer_phone: '',
    follow_up: '', follow_up_days: 0, request_kind: 'none', request_phone: '', request_when: '', request_due: '', request_summary: '',
  });
  mark = sent.length;
  businessMessage({ connectionId: 'bc-1', chatId: CUSTOMER, fromId: CUSTOMER, name: 'Jamshid', text: 'Salom, ertaga ochiqmisizlar?' });
  const card = await waitFor('javob taklifi', () => to(OWNER, mark, 'ertaga 10:00'), 15_000);
  const lead = await leadOf();
  ok("mijoz egasining shaxsiy chatiga yozdi — karta (Telegram, Business), egasiga javob taklifi", !!card && lead?.channel === 'telegram' && lead.name === 'Jamshid', JSON.stringify(lead));
  mark = sent.length;
  // Shu biznesda boshqa sinovlar ham taklif yuborgan/rad etgan — hisob oldin va keyin solishtiriladi
  const trustBefore = (await api('/api/business/autonomy', { token })).json.trust as { decided: number; clean: number };
  press(OWNER, buttons(card).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, card!.id!);
  const out = await waitFor('egasi nomidan', () => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === CUSTOMER));
  ok("«Yuborish» → egasi nomidan: business_connection_id bilan, mijozning chatiga", out?.params.business_connection_id === 'bc-1' && textOf(out).includes('10:00'), JSON.stringify(out?.params));
  const trust = (await api('/api/business/autonomy', { token })).json.trust;
  ok("L0–L4: o'zgarishsiz yuborilgan taklif AI administratorga ishonch hisobida (bittaga ko'paydi, toza)", trust?.decided === trustBefore.decided + 1 && trust.clean === trustBefore.clean + 1,
    JSON.stringify({ trustBefore, trust }));

  // Telegram botning o'zi yozganini ham business_message qilib qaytaradi — aks-sado
  businessMessage({ connectionId: 'bc-1', chatId: CUSTOMER, fromId: OWNER, text: textOf(out), viaBot: true });
  businessMessage({ connectionId: 'bc-1', chatId: CUSTOMER, fromId: OWNER, text: 'Manzil: Chilonzor 5, mo\'ljal — metro' });
  const thread = async () => ((await api(`/api/inbox/${lead!.id}`, { token })).json.messages ?? []) as { direction: string; by: string; text: string }[];
  const own = await (async () => { for (let i = 0; i < 40; i++) { const m = await thread(); if (m.some(x => x.by === 'owner')) return m; await new Promise(r => setTimeout(r, 100)); } return thread(); })();
  ok("botning aks-sadosi qayta yozilmadi; egasining telefondan yozgani — «egasi» bo'lib yozishmada", own.filter(m => m.text.includes('10:00')).length === 1 && own.some(m => m.by === 'owner' && m.text.includes('Chilonzor')));

  // E12: javob rejimi «o'chiq» — AI javob tayyorlamaydi, lekin xabar yo'qolmaydi (mijozlar ro'yxati va yozishmada)
  await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'off', contacts: false, delayMin: 1 } });
  mark = sent.length;
  const asked = ai.requests.length;
  businessMessage({ connectionId: 'bc-1', chatId: CUSTOMER, fromId: CUSTOMER, name: 'Jamshid', text: 'Narxlar ro\'yxatini yuborasizmi?' });
  const stored = await (async () => { for (let i = 0; i < 40; i++) { const m = await thread(); if (m.some(x => x.text.includes('Narxlar ro'))) return true; await new Promise(r => setTimeout(r, 100)); } return false; })();
  await new Promise(r => setTimeout(r, 2500));
  const aiSaw = ai.requests.slice(asked).some(q => JSON.stringify(q.messages).includes('Narxlar ro'));
  ok("rejim «o'chiq»: Business xabari baribir saqlanadi, AI javob tayyorlamaydi, egasiga karta yo'q (E12)", stored && !aiSaw && !to(OWNER, mark, 'Narxlar'));
  await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'draft', contacts: false, delayMin: 1 } });

  // E13: egasining do'sti yozdi — Telegram kontaktmi aytmaydi; egasi kartadagi «Bemor emas»ni bosadi
  const friendLead = async () => ((await api('/api/leads', { token })).json.leads as { id: string; name: string | null }[]).find(l => l.name === 'Sardor do\'st');
  mark = sent.length;
  businessMessage({ connectionId: 'bc-1', chatId: FRIEND, fromId: FRIEND, name: "Sardor do'st", text: 'Qalaysan, kechqurun choyga kelasanmi?' });
  const friendCard = await waitFor("do'st kartasi", () => to(OWNER, mark, 'choyga'), 15_000);
  const np = buttons(friendCard).find(b => b.callback_data?.startsWith('np|'));
  ok("shaxsiy Telegram'dan kelgan odam kartasida «Bemor emas» tugmasi (E13)", !!np && !!(await friendLead()), JSON.stringify(buttons(friendCard)));
  mark = sent.length;
  press(OWNER, np!.callback_data!, friendCard!.id!);
  const marked = await waitFor('belgilandi', () => sent.slice(mark).find(s => s.method === 'editMessageText' && textOf(s).includes('bemor emas')));
  const undo = buttons(marked).find(b => b.callback_data?.startsWith('nu|'));
  ok("«Bemor emas» — karta o'chirildi, xabar «bemor emas deb belgilandi» va «Qaytarish» tugmasi", !!marked && !!undo && !(await friendLead()), JSON.stringify(marked?.params).slice(0, 300));
  mark = sent.length;
  businessMessage({ connectionId: 'bc-1', chatId: FRIEND, fromId: FRIEND, name: "Sardor do'st", text: 'Javob ber, kutayapman' });
  await new Promise(r => setTimeout(r, 2500));
  ok("belgilangan odam yana yozdi — bemorlar ro'yxatiga ham, egasiga karta bo'lib ham tushmadi", !(await friendLead()) && !to(OWNER, mark, 'kutayapman'));
  press(OWNER, undo!.callback_data!, marked!.params.message_id as number);
  await new Promise(r => setTimeout(r, 300));
  businessMessage({ connectionId: 'bc-1', chatId: FRIEND, fromId: FRIEND, name: "Sardor do'st", text: 'Tish og\'riyapti, yozilsam bo\'ladimi?' });
  const back = await (async () => { for (let i = 0; i < 40; i++) { if (await friendLead()) return true; await new Promise(r => setTimeout(r, 100)); } return false; })();
  ok("«Qaytarish» — keyingi xabaridan yana bemor", back);
  const again = await friendLead();
  if (again) await api(`/api/leads/${again.id}`, { method: 'DELETE', token });

  mark = sent.length;
  businessConnection({ id: 'bc-1', userId: OWNER, canReply: false });
  ok("«javob berish» ruxsati olib tashlandi — panelda ko'rinadi, egasiga aytildi", !!(await waitFor('ruxsatsiz', () => to(OWNER, mark, 'ruxsati yo'))) && !(await status()).telegramBusiness.canReply);
  mark = sent.length;
  businessConnection({ id: 'bc-1', userId: OWNER, canReply: true, enabled: false });
  ok("chat-botlardan olib tashlandi — ulanish o'chdi, egasiga aytildi", !!(await waitFor('o\'chdi', () => to(OWNER, mark, "olib tashlandi"))) && !(await status()).telegramBusiness.account);
  ai.customer = null;
}
