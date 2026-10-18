/**
 * So'rovlar: mijoz xodimdan nimadir kutyapti — qo'ng'iroq qilishni so'radi, yozilmoqchi, qabulni surmoqchi, shikoyat qildi.
 *
 *   yozishma (Instagram, bot, Telegram), o'tkazib yuborilgan qo'ng'iroq, ovozli agent yoki egasi → so'rov
 *   → mijoz kartasi (telefon bo'yicha bitta odam) → qabulxona xodimlariga va egasiga Telegram'da karta tugmalar bilan:
 *     ✅ Bajarildi · 📵 Ko'tarmadi (keyinroq yana eslatiladi) · 💬 Mijozga yozish (ko'tarmasa) · ✖️ Bekor
 *   → hal qilinmasa — eslatma (tunda emas); kartaga «Reply» bilan yozilgan gap — natija sifatida saqlanadi.
 *
 * Kartalar hamma qabul qilganlarda bir xil yangilanadi: bir xodim yopsa, boshqasida ham «yopildi» ko'rinadi.
 */
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { LeadRequest, RequestKind, RequestSource } from '../../src/types';
import { prettyPhone } from '../../src/lib/phone';
import { stamp } from '../../src/lib/week';
import { businesses, leads, type BusinessRow, type LeadRow } from '../db';
import { normPhone } from '../crm/logic';
import { env } from '../env';
import { settlePerson } from '../people';
import { requestCards, requests, staff, type StaffRow } from './store';
import { MAX_ATTEMPTS, MAX_REMINDERS, REPEAT_MIN, RETRY_MIN, cleanDue, daytime as toDaytime, firstRemind as firstAt, isNight as night, later } from './timing';

/** Telegram orqali yuborish (bot): chatga yangi xabar va mavjud xabarni yangilash */
export interface TeamOutlet {
  send(chatId: string, html: string, keyboard?: InlineKeyboardMarkup, silent?: boolean): Promise<number>;
  edit(chatId: string, messageId: number, html: string, keyboard?: InlineKeyboardMarkup): Promise<void>;
}
let outlet: TeamOutlet | null = null;
export const setTeamOutlet = (o: TeamOutlet | null) => { outlet = o; };
/** Shu biznes kompyuteridan qo'ng'iroq qilsa bo'ladimi (MicroSIP ulangan) — kartada «📞 Kompyuterdan» tugmasi */
let canDial: (bizId: string) => boolean = () => false;
export const setDialer = (fn: (bizId: string) => boolean) => { canDial = fn; };

export const KIND_LABEL: Record<RequestKind, string> = {
  callback: "📞 Qo'ng'iroq qilish", booking: '📅 Qabulga yozish', change: '🔁 Qabulni surish yoki bekor qilish', complaint: '⚠️ Shikoyat', other: '📌 So\'rov',
};
const SOURCE_LABEL: Record<RequestSource, string> = {
  bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: "qo'lda", call: "o'tkazib yuborilgan qo'ng'iroq", voice: 'ovozli agent', owner: 'egasi', panel: 'panel',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
// Ish soatlari — sozlamadan (REQUEST_HOURS)
const daytime = (local: string) => toDaytime(local, env.requestHours);
const isNight = (now: Date) => night(now, env.requestHours);
const firstRemind = (kind: RequestKind, dueAt: string | null, now: Date) => firstAt(kind, dueAt, now, env.requestHours);

// ─── Kimga boradi ────────────────────────────────────────────────────────────

interface Recipient { chatId: string; name: string }
function recipients(biz: BusinessRow): Recipient[] {
  const team = staff.linked(biz.id).map((s: StaffRow) => ({ chatId: s.chatId!, name: s.name }));
  const owner = biz.ownerChatId && (!team.length || biz.profile.requestsCopy !== false) ? [{ chatId: biz.ownerChatId, name: biz.profile.ownerName || 'Egasi' }] : [];
  return [...team, ...owner];
}

/** Telegram chat — shu biznesning egasi yoki xodimi bo'lsa, uning ismi (tugma bosgan, kartaga yozgan) */
export function actorOf(chatId: string): { biz: BusinessRow; name: string; isOwner: boolean } | null {
  const owner = businesses.byOwnerChat(chatId);
  if (owner) return { biz: owner, name: owner.profile.ownerName || 'Egasi', isOwner: true };
  const s = staff.byChat(chatId);
  const biz = s && businesses.byId(s.businessId);
  return s && biz?.active ? { biz, name: s.name, isOwner: false } : null;
}

// ─── Karta ───────────────────────────────────────────────────────────────────

const hhmm = (iso: string) => stamp(new Date(iso)).slice(11, 16);
const dueLine = (r: LeadRequest) => {
  if (r.whenText) return `🕕 ${esc(r.whenText)}${r.dueAt ? ` <i>(${r.dueAt.replace('T', ' ')})</i>` : ''}`;
  return r.dueAt ? `🕕 ${r.dueAt.replace('T', ' ')}` : '';
};

export function requestHtml(r: LeadRequest, lead: LeadRow | undefined, head = ''): string {
  const who = lead?.name || r.name || (lead?.username ? `@${lead.username}` : null) || 'Mijoz';
  const phone = r.phone ?? lead?.phone;
  const status = r.status === 'done' ? `\n✅ <b>Bajarildi</b>${r.doneBy ? ` — ${esc(r.doneBy)}` : ''}${r.closedAt ? ` (${hhmm(r.closedAt)})` : ''}`
    : r.status === 'cancelled' ? `\n✖️ <b>Bekor qilindi</b>${r.doneBy ? ` — ${esc(r.doneBy)}` : ''}`
    : r.attempts ? `\n📵 ${r.attempts}-urinish: ko'tarmadi${r.doneBy ? ` (${esc(r.doneBy)})` : ''}` : '';
  return [
    head,
    `<b>${KIND_LABEL[r.kind]}</b> · ${SOURCE_LABEL[r.source]}`,
    // Telefon raqami Telegram'da bosiladigan bo'ladi — telefondan darhol qo'ng'iroq
    `👤 ${esc(who)}${phone ? ` · ${esc(prettyPhone(phone))}` : " · <i>raqam yo'q</i>"}`,
    dueLine(r),
    `📝 ${esc(cut(r.summary, 400))}`,
    r.quote ? `<i>«${esc(cut(r.quote, 300))}»</i>` : '',
    lead?.patientId ? '🦷 DentaCRM bemori' : '',
    r.result ? `💬 ${esc(cut(r.result, 400))}` : '',
    status,
    r.status === 'open' ? "\n<i>↩️ Natijani yozish uchun shu xabarga «Reply» qiling.</i>" : '',
  ].filter(Boolean).join('\n');
}

const btn = (text: string, data: string) => ({ text, callback_data: data });
function keyboard(r: LeadRequest, lead: LeadRow | undefined): InlineKeyboardMarkup | undefined {
  if (r.status !== 'open') return undefined;
  const rows = [[btn('✅ Bajarildi', `qd|${r.id}`), btn("📵 Ko'tarmadi", `qn|${r.id}`)]];
  // Klinika kompyuteridagi MicroSIP raqamni o'zi teradi va suhbat yozib olinadi
  if ((r.phone ?? lead?.phone) && lead && canDial(lead.businessId)) rows.unshift([btn("📞 Kompyuterdan qo'ng'iroq", `qc|${r.id}`)]);
  // Ko'tarmagan mijozga yozib qo'yish — u yozishgan kanal orqali (bo'lsa)
  if (r.attempts && lead?.reachable) rows.push([btn('💬 Mijozga yozish', `qm|${r.id}`)]);
  rows[rows.length - 1].push(btn('✖️ Bekor', `qx|${r.id}`));
  return { inline_keyboard: rows };
}

async function sendCards(biz: BusinessRow, r: LeadRequest, head = '', silent = false): Promise<number> {
  if (!outlet) return 0;
  const lead = r.leadId ? leads.get(biz.id, r.leadId) : undefined;
  const html = requestHtml(r, lead, head);
  let sent = 0;
  for (const to of recipients(biz)) {
    try {
      const id = await outlet.send(to.chatId, html, keyboard(r, lead), silent);
      requestCards.add(r.id, to.chatId, id);
      sent++;
    } catch (e) {
      console.error(`[so'rov] ${to.name}ga yetmadi:`, (e as Error).message);
    }
  }
  return sent;
}

/**
 * Mijozlar yozishmasi kartasi (javob taklifi, yetkazilgan xabar) — jamoaga: qabulxona xodimlari va egasi (nusxa sozlamasi bo'yicha;
 * xodim yo'q bo'lsa — faqat egasi). Qaytadi: qayerga ketdi. Hech kimga yetmasa — Error (chaqiruvchi navbatga qo'yadi)
 */
export async function deliverToTeam(biz: BusinessRow, html: string, keyboard?: InlineKeyboardMarkup): Promise<{ chatId: string; messageId: number }[]> {
  const to = recipients(biz);
  if (!outlet || !to.length) return [];
  const out: { chatId: string; messageId: number }[] = [];
  let last: Error | null = null;
  for (const r of to) {
    try { out.push({ chatId: r.chatId, messageId: await outlet.send(r.chatId, html, keyboard) }); } catch (e) { last = e as Error; }
  }
  if (!out.length && last) throw last;
  return out;
}

/** Jamoaga ketgan kartalarni yangilaydi (tugmalarsiz — hal qilingan) */
export async function editTeamCards(cards: { chatId: string; messageId: number }[], html: string): Promise<void> {
  if (!outlet) return;
  for (const c of cards) await outlet.edit(c.chatId, c.messageId, html).catch(() => {});
}

/** Bitta chatga karta (/sorovlar buyrug'i): tugmalari va keyingi yangilanishlari boshqa kartalar bilan bir xil */
export async function sendCardTo(biz: BusinessRow, r: LeadRequest, chatId: string): Promise<void> {
  if (!outlet) return;
  const lead = r.leadId ? leads.get(biz.id, r.leadId) : undefined;
  requestCards.add(r.id, chatId, await outlet.send(chatId, requestHtml(r, lead), keyboard(r, lead)));
}

/** Hamma kartalar holatga moslanadi (tugmalar yopilgan so'rovda olib tashlanadi) */
export async function refreshCards(biz: BusinessRow, id: string): Promise<void> {
  const r = requests.get(biz.id, id);
  if (!r || !outlet) return;
  const lead = r.leadId ? leads.get(biz.id, r.leadId) : undefined;
  const html = requestHtml(r, lead);
  for (const c of requestCards.of(id)) await outlet.edit(c.chatId, c.messageId, html, keyboard(r, lead)).catch(() => {});
}

// ─── Ochish ──────────────────────────────────────────────────────────────────

export interface RequestInput {
  kind: RequestKind; phone?: string | null; name?: string | null; summary: string; whenText?: string | null; dueAt?: string | null; quote?: string | null; source: RequestSource;
}

/**
 * So'rov ochadi (yoki shu mijozning shu turdagi ochiq so'rovini yangilaydi — mijoz «raqamim boshqa» deb aniqlashtirsa yangi so'rov ochilmaydi)
 * va xodimlarga karta yuboradi. Raqam berilgan bo'lsa va mijoz kartasida raqam bo'lmasa — kartaga yoziladi (bir odamning kartalari yig'iladi)
 */
export async function openRequest(biz: BusinessRow, leadId: string | null, v: RequestInput, now = new Date()): Promise<{ request: LeadRequest; created: boolean }> {
  const phone = v.phone ? normPhone(v.phone) || v.phone.trim().slice(0, 24) : null;
  let lead = leadId ? leads.get(biz.id, leadId) : undefined;
  if (lead && phone && !lead.phone) leads.update(biz.id, lead.id, { phone });
  // Bir odamning boshqa kartalari yig'iladi va DentaCRM bemori qisqa qidiriladi: xodim kartasida «bemor» belgisi bo'lsin
  if (lead?.phone || (lead && phone)) lead = (await settlePerson(biz, lead.id)) ?? lead;
  const dueAt = cleanDue(v.dueAt, now);
  const fields = {
    phone: phone ?? lead?.phone ?? null, name: v.name?.trim() || lead?.name || null, summary: cut(v.summary.trim() || KIND_LABEL[v.kind], 500),
    whenText: v.whenText?.trim() ? cut(v.whenText.trim(), 120) : null, dueAt, quote: v.quote?.trim() ? cut(v.quote.trim(), 600) : null,
  };
  const same = lead ? requests.openFor(biz.id, lead.id).find(r => r.kind === v.kind) : undefined;
  if (same) {
    const moved = (fields.phone && fields.phone !== same.phone) || (fields.dueAt && fields.dueAt !== same.dueAt);
    const updated = requests.revise(biz.id, same.id, {
      phone: fields.phone ?? same.phone, summary: fields.summary, whenText: fields.whenText ?? same.whenText, dueAt: fields.dueAt ?? same.dueAt,
      quote: fields.quote ?? same.quote, ...(moved ? { remindAt: firstRemind(v.kind, fields.dueAt ?? same.dueAt, now) } : {}),
    })!;
    // Raqam yoki vaqt o'zgardi — xodimlar bilishi kerak; qolgan aniqlashtirish — eski kartalarda yangilanadi
    if (moved) await sendCards(biz, updated, "✏️ <b>So'rov yangilandi</b>", isNight(now));
    else await refreshCards(biz, updated.id);
    return { request: updated, created: false };
  }
  const r = requests.create(biz.id, { leadId: lead?.id ?? null, kind: v.kind, source: v.source, ...fields, remindAt: firstRemind(v.kind, dueAt, now) });
  await sendCards(biz, r, '🆕', isNight(now));
  return { request: r, created: true };
}

// ─── Xodim harakatlari ───────────────────────────────────────────────────────

export class RequestError extends Error {}

export async function closeRequest(biz: BusinessRow, id: string, status: 'done' | 'cancelled', by: string, result: string | null = null): Promise<LeadRequest> {
  const r = requests.get(biz.id, id);
  if (!r) throw new RequestError("So'rov topilmadi");
  if (!requests.close(biz.id, id, status, result, by)) throw new RequestError(r.status === 'done' ? `Allaqachon bajarilgan${r.doneBy ? ` (${r.doneBy})` : ''}` : 'Bu so\'rov yopilgan');
  await refreshCards(biz, id);
  return requests.get(biz.id, id)!;
}

/** Ko'tarmadi: urinish yoziladi; uchinchigacha — yarim soatdan keyin yana eslatiladi */
export async function noAnswer(biz: BusinessRow, id: string, by: string, now = new Date()): Promise<LeadRequest> {
  const r = requests.get(biz.id, id);
  if (!r) throw new RequestError("So'rov topilmadi");
  const retry = r.attempts + 1 < MAX_ATTEMPTS ? daytime(later(now, RETRY_MIN)) : null;
  if (!requests.attempt(biz.id, id, by, retry)) throw new RequestError("Bu so'rov yopilgan");
  await refreshCards(biz, id);
  return requests.get(biz.id, id)!;
}

/** Ochiq so'rov bo'yicha yangi voqea (mijoz yana qo'ng'iroq qildi): izoh qo'shiladi va xodimlarga yangi karta boradi */
export async function nudgeRequest(biz: BusinessRow, id: string, head: string, note: string, by: string): Promise<void> {
  requests.addResult(biz.id, id, cut(note, 300), by);
  const r = requests.get(biz.id, id);
  if (r?.status === 'open') await sendCards(biz, r, head, isNight(new Date()));
}

export async function addResult(biz: BusinessRow, id: string, text: string, by: string): Promise<LeadRequest> {
  const r = requests.get(biz.id, id);
  if (!r) throw new RequestError("So'rov topilmadi");
  requests.addResult(biz.id, id, cut(text.trim(), 500), by);
  await refreshCards(biz, id);
  return requests.get(biz.id, id)!;
}

/** Ko'tarmagan mijozga yoziladigan xabar (u qaysi tilda yozganini bilmaymiz — ikki tilda) */
export const MISSED_TEXT = "Assalomu alaykum! Sizga qo'ng'iroq qildik, lekin bog'lana olmadik. Qachon qo'ng'iroq qilsak qulay?\n\nЗдравствуйте! Мы вам звонили, но не дозвонились. Когда вам удобно поговорить?";

// ─── Eslatmalar ──────────────────────────────────────────────────────────────

const waited = (r: LeadRequest, now: Date) => {
  const min = Math.max(1, Math.round((now.getTime() - Date.parse(r.createdAt)) / 60_000));
  return min < 60 ? `${min} daqiqa` : min < 1440 ? `${Math.round(min / 60)} soat` : `${Math.round(min / 1440)} kun`;
};

/**
 * Vaqti kelgan so'rovlar: xodimlarga yangi karta (eslatma). Eslatma — yordam, kafolat emas: Telegram javob bermasa,
 * keyingisi navbatdagi oraliqda keladi (so'rovning o'zi ochiq qoladi va panelda turadi)
 */
export async function remindRequests(now = new Date()): Promise<void> {
  if (!outlet) return;
  const local = stamp(now);
  for (const { businessId, reminders, request: r } of requests.due(local)) {
    const biz = businesses.byId(businessId);
    if (!biz) continue;
    // Tun — eslatma ertalabga suriladi
    if (daytime(local) !== local) { requests.reminded(biz.id, r.id, daytime(local)); continue; }
    const head = r.attempts ? `⏰ <b>Qayta qo'ng'iroq qilish vaqti</b> (${r.attempts}-urinishdan keyin)`
      : r.dueAt && r.dueAt <= local && reminders === 0 ? '⏰ <b>Vaqti keldi</b>'
      : `⏰ <b>${waited(r, now)}dan beri javobsiz</b>`;
    const next = reminders + 1 < MAX_REMINDERS ? daytime(later(now, REPEAT_MIN[r.kind])) : null;
    await sendCards(biz, r, head);
    requests.reminded(biz.id, r.id, next);
  }
}
