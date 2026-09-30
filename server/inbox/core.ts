/**
 * Mijozlar bilan yozishma — bot, egasining shaxsiy Telegrami va Instagram bitta oqimda:
 *
 *   mijoz yozdi → mijozlar ro'yxatiga (bir odam — bitta yozuv) → bir necha soniya kutiladi
 *   (odatda ketma-ket yozishadi) → Claude javob tayyorlaydi → rejimga qarab:
 *     draft — egasiga Telegramda karta: mijoz gapi, javob taklifi, «Yuborish / Kerak emas»;
 *     auto  — egasi belgilangan daqiqa ichida o'zi yozmasa, Cerebro yuboradi va egasiga aytadi.
 *             Bilmagan narsasini (narx yo'q, chegirma, buyurtma) baribir egasidan so'raydi.
 *   Egasi o'zi javob yozsa — Cerebro tayyorlagan taklif bekor bo'ladi.
 *
 * Kanallar (bot, shaxsiy Telegram, Instagram) bu yerga faqat "xabar keldi" va "yubor" orqali ulanadi.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { AutoReply, InboxMessage, LeadChannel } from '../../src/types';
import { check, isMedical } from '../../src/lib/compliance';
import { businesses, inbox, leads, relays, replies, type BusinessRow, type ChannelPerson, type LeadRow, type ReplyRow } from '../db';
import { env } from '../env';
import { decide, type Decision } from './replier';

export interface Sender {
  /** Shu mijozga shu kanal orqali yozish mumkinmi */
  can(biz: BusinessRow, lead: LeadRow): boolean;
  /** Yuboradi; qaytaradi — kanal bergan xabar id'si (qayta kelsa tanib olish uchun) */
  send(biz: BusinessRow, lead: LeadRow, text: string): Promise<string | null>;
}

/** Egasiga Telegram orqali xabar (bot) */
export interface OwnerOutlet {
  notify(biz: BusinessRow, html: string, keyboard?: InlineKeyboardMarkup): Promise<number | null>;
  edit(biz: BusinessRow, messageId: number, html: string): Promise<void>;
}

const senders = new Map<LeadChannel, Sender>();
let owner: OwnerOutlet | null = null;
export const registerSender = (channel: LeadChannel, s: Sender) => { senders.set(channel, s); };
export const setOwnerOutlet = (o: OwnerOutlet) => { owner = o; };
export const notifyOwner = (biz: BusinessRow, html: string) => owner?.notify(biz, html) ?? Promise.resolve(null);

export const DEFAULT_REPLY: AutoReply = { mode: 'draft', contacts: false, delayMin: 2 };
export const replySettings = (biz: BusinessRow): AutoReply => ({ ...DEFAULT_REPLY, ...biz.profile.autoReply });

const CHANNEL_LABEL: Record<LeadChannel, string> = { bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: "qo'lda" };
/** Qaysi kanal orqali yozish: mijoz qayerda yozishgan bo'lsa — o'sha yerda */
const ROUTES: Record<LeadChannel, LeadChannel[]> = { bot: ['bot', 'telegram'], telegram: ['telegram', 'bot'], instagram: ['instagram'], manual: ['telegram', 'bot'] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const who = (l: LeadRow) => {
  const name = l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';
  return `${esc(name)}${l.username && l.name ? ` (@${esc(l.username)})` : ''}`;
};

// ─── Yuborish ─────────────────────────────────────────────────────────────────

/** O'zimiz yuborgan xabar kanaldan qaytib kelsa (Instagram echo, Telegram "chiquvchi xabar") — egasiniki deb o'ylamaslik uchun */
const ours = new Map<string, number>();
const ourKey = (bizId: string, channel: LeadChannel, text: string) => `${bizId}|${channel}|${text.trim()}`;
export const isOurEcho = (bizId: string, channel: LeadChannel, text: string) => {
  const t = ours.get(ourKey(bizId, channel, text));
  return !!t && Date.now() - t < 120_000;
};

export function canReach(biz: BusinessRow, lead: LeadRow): boolean {
  return ROUTES[lead.channel].some(ch => senders.get(ch)?.can(biz, lead));
}

/** Mijozga yozadi (u yozishgan kanal orqali) va yozishmaga qo'shadi */
export async function sendToLead(biz: BusinessRow, lead: LeadRow, text: string, by: 'owner' | 'cerebro'): Promise<LeadChannel> {
  let last: Error | null = null;
  for (const ch of ROUTES[lead.channel]) {
    const s = senders.get(ch);
    if (!s?.can(biz, lead)) continue;
    try {
      ours.set(ourKey(biz.id, ch, text), Date.now());
      const extId = await s.send(biz, lead, text);
      inbox.add(biz.id, { leadId: lead.id, channel: ch, direction: 'out', by, text, extId });
      if (lead.stage === 'new') leads.update(biz.id, lead.id, { stage: 'contacted' });
      return ch;
    } catch (e) {
      last = e as Error;
    }
  }
  throw last ?? new Error(lead.channel === 'instagram'
    ? "Instagram qoidasi: mijoz oxirgi 24 soatda yozmagan bo'lsa, javob berib bo'lmaydi"
    : "Bu mijozga Cerebro yoza olmaydi: u botga yozmagan, shaxsiy Telegram esa ulanmagan");
}

// ─── Kiruvchi xabar ───────────────────────────────────────────────────────────

export interface Incoming {
  channel: 'bot' | 'telegram' | 'instagram';
  person: ChannelPerson;
  text: string;
  /** Kanaldagi xabar id'si — bir xabar ikki marta kelsa (webhook qayta yuborsa) bir marta ishlanadi */
  extId: string;
  source: string;
}

const timers = new Map<string, NodeJS.Timeout>();

export function onIncoming(biz: BusinessRow, m: Incoming): LeadRow {
  const { lead } = leads.fromChannel(biz.id, m.channel, m.person, m.source);
  const saved = inbox.add(biz.id, { leadId: lead.id, channel: m.channel, direction: 'in', by: 'customer', text: m.text, extId: m.extId });
  if (saved) schedule(biz.id, lead.id);
  return lead;
}

/** Egasi o'zi yozdi (telefonidagi Telegram yoki Instagram'dan) */
export function onOwnerOutgoing(biz: BusinessRow, channel: 'telegram' | 'instagram', peer: { tgUserId?: string; igUserId?: string }, text: string, extId: string | null): void {
  const lead = peer.igUserId ? leads.byInstagram(biz.id, peer.igUserId) : peer.tgUserId ? leads.byTelegram(biz.id, peer.tgUserId) : undefined;
  // Mijoz bo'lmagan odam bilan yozishma (shaxsiy suhbat) — yozib olinmaydi
  if (!lead) return;
  if ((extId && inbox.has(biz.id, channel, extId)) || isOurEcho(biz.id, channel, text)) return;
  inbox.add(biz.id, { leadId: lead.id, channel, direction: 'out', by: 'owner', text, extId });
  void supersede(biz, lead, "O'zingiz javob berdingiz");
}

function schedule(bizId: string, leadId: string): void {
  const key = `${bizId}:${leadId}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    handle(bizId, leadId).catch(e => console.error('[mijozlar]', (e as Error).message));
  }, env.inboxDebounceMs));
}

/** Oxirgi javobimizdan keyingi mijoz xabarlari */
const unanswered = (thread: InboxMessage[]) => {
  const i = thread.map(m => m.direction).lastIndexOf('out');
  return thread.slice(i + 1);
};

async function handle(bizId: string, leadId: string): Promise<void> {
  const biz = businesses.byId(bizId);
  const lead = leads.get(bizId, leadId);
  if (!biz?.active || !lead) return;
  const thread = inbox.thread(bizId, leadId, 30);
  const last = thread.at(-1);
  if (!last || last.direction !== 'in') return;
  const fresh = unanswered(thread);
  const settings = replySettings(biz);
  await supersede(biz, lead, 'Yangi xabar keldi — pastda yangi taklif');

  if (settings.mode === 'off' || !env.aiEnabled) {
    // Bot suhbatini egasi boshqa joyda ko'rmaydi — shunchaki yetkaziladi
    if (lead.channel === 'bot') await forward(biz, lead, fresh, null);
    return;
  }
  let d: Decision;
  try {
    d = await decide(biz, lead, thread);
  } catch (e) {
    console.error('[mijozlar] javob tayyorlanmadi:', (e as Error).message);
    await forward(biz, lead, fresh, "Cerebro javob tayyorlay olmadi — o'zingiz javob bering");
    return;
  }
  // Claude o'ylayotganda yana yozgan bo'lsa — navbatdagi ishlov hammasini birga ko'radi
  if (inbox.last(bizId, leadId)?.id !== last.id) return;
  remember(biz, lead, d);

  if (d.action === 'ignore' || !d.reply) {
    if (lead.channel === 'bot') await forward(biz, lead, fresh, null);
    return;
  }
  const clean = check(d.reply, { medical: isMedical(biz.profile.industry) }).length === 0;
  if (settings.mode === 'auto' && d.action === 'reply' && clean) {
    // Botda egasi suhbatda yo'q — darhol; shaxsiy chatda egasiga o'zi javob berishga vaqt
    const delay = lead.channel === 'bot' ? 0 : settings.delayMin * env.minuteMs;
    const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'scheduled', note: null, dueAt: new Date(Date.now() + delay).toISOString() });
    if (!delay) await flush(r);
    return;
  }
  const note = !clean ? "Javob taklifida reklama filtriga tushadigan so'z bor — tekshirib yuboring" : d.noteForOwner || null;
  const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'pending', note, dueAt: null });
  await card(biz, lead, fresh, r);
}

/** Mijoz o'zi aytgan ism, telefon va nima xohlashi — mijozlar ro'yxatiga */
function remember(biz: BusinessRow, lead: LeadRow, d: Decision): void {
  const patch: { name?: string; phone?: string; note?: string } = {};
  if (d.customerName && !lead.name) patch.name = d.customerName;
  if (d.customerPhone && !lead.phone) patch.phone = d.customerPhone;
  if (d.leadNote && d.leadNote !== lead.note) patch.note = d.leadNote;
  if (Object.keys(patch).length) leads.update(biz.id, lead.id, patch);
}

// ─── Egasiga kartalar ─────────────────────────────────────────────────────────

const REPLY_HINT = "<i>↩️ O'zingiz yozmoqchi bo'lsangiz — shu xabarga «Reply» qiling.</i>";
const quotes = (fresh: InboxMessage[]) => fresh.slice(-5).map(m => `«${esc(cut(m.text, 700))}»`).join('\n');

async function forward(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], note: string | null): Promise<void> {
  if (!owner || !fresh.length) return;
  const id = await owner.notify(biz, [`💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`, quotes(fresh), note ? `\nℹ️ ${esc(note)}` : '', '', REPLY_HINT].join('\n'));
  if (id && biz.ownerChatId) relays.add(biz.ownerChatId, id, lead.id);
}

const replyKeyboard = (r: ReplyRow) => Markup.inlineKeyboard([[
  Markup.button.callback('✅ Yuborish', `ra|${r.id}`),
  Markup.button.callback('✖️ Kerak emas', `rx|${r.id}`),
]]).reply_markup;

async function card(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], r: ReplyRow): Promise<void> {
  if (!owner) return;
  const html = [
    `💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`,
    quotes(fresh),
    '',
    `✍️ <b>Javob taklifi:</b>\n<i>${esc(r.text)}</i>`,
    r.note ? `ℹ️ ${esc(r.note)}` : '',
    '',
    REPLY_HINT,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  const id = await owner.notify(biz, html, replyKeyboard(r));
  if (!id) return;
  replies.setOwnerMessage(biz.id, r.id, id);
  if (biz.ownerChatId) relays.add(biz.ownerChatId, id, lead.id);
}

/** Karta natijasi bilan yangilanadi (tugmalar olib tashlanadi) */
async function settleCard(biz: BusinessRow, r: ReplyRow, status: string): Promise<void> {
  if (!owner || !r.ownerMessageId) return;
  const lead = leads.get(biz.id, r.leadId);
  await owner.edit(biz, r.ownerMessageId, `💬 <b>${lead ? who(lead) : 'Mijoz'}</b> · ${CHANNEL_LABEL[r.channel]}\n✍️ <i>${esc(cut(r.text, 1500))}</i>\n\n${status}`)
    .catch(() => {});
}

/** Mijoz yana yozdi yoki egasi o'zi javob berdi — oldingi takliflar eskirdi */
async function supersede(biz: BusinessRow, lead: LeadRow, why: string): Promise<void> {
  for (const r of replies.open(biz.id, lead.id)) {
    if (replies.move(biz.id, r.id, ['pending', 'scheduled'], 'obsolete')) await settleCard(biz, r, `↪️ ${why}`);
  }
}

// ─── Javobni yuborish ─────────────────────────────────────────────────────────

/** "O'zi javob bersin": vaqti kelgan javob (egasi bu orada yozmagan bo'lsa) */
async function flush(r: ReplyRow): Promise<void> {
  const biz = businesses.byId(r.businessId);
  const lead = biz && leads.get(biz.id, r.leadId);
  if (!biz || !lead) return;
  if (!replies.move(biz.id, r.id, ['scheduled'], 'sent')) return;
  try {
    const ch = await sendToLead(biz, lead, r.text, 'cerebro');
    await owner?.notify(biz, `🤖 <b>${who(lead)}</b> · ${CHANNEL_LABEL[ch]} — javob berdim:\n<i>${esc(cut(r.text, 1500))}</i>`);
  } catch (e) {
    replies.move(biz.id, r.id, ['sent'], 'pending');
    const fresh = unanswered(inbox.thread(biz.id, lead.id, 30));
    await card(biz, lead, fresh, { ...r, status: 'pending', note: `Yuborilmadi: ${(e as Error).message}` });
  }
}

export async function flushDue(): Promise<void> {
  for (const r of replies.due(new Date().toISOString())) await flush(r).catch(e => console.error('[mijozlar] yuborilmadi:', (e as Error).message));
}

/** Egasi «Yuborish» ni bosdi (Telegram yoki panel) */
export async function approveReply(biz: BusinessRow, id: string): Promise<void> {
  const r = replies.get(biz.id, id);
  if (!r) throw new Error('Topilmadi');
  if (r.status !== 'pending') throw new Error(r.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bu taklif eskirgan');
  const lead = leads.get(biz.id, r.leadId);
  if (!lead) throw new Error('Mijoz topilmadi');
  if (!replies.move(biz.id, id, ['pending'], 'sent')) throw new Error('Allaqachon yuborilgan');
  try {
    await sendToLead(biz, lead, r.text, 'cerebro');
  } catch (e) {
    replies.move(biz.id, id, ['sent'], 'pending');
    throw e;
  }
  await settleCard(biz, r, '✅ Yuborildi');
}

export async function dismissReply(biz: BusinessRow, id: string): Promise<void> {
  const r = replies.get(biz.id, id);
  if (!r) throw new Error('Topilmadi');
  if (!replies.move(biz.id, id, ['pending', 'scheduled'], 'dismissed')) throw new Error('Bu taklif allaqachon hal qilingan');
  await settleCard(biz, r, '✖️ Yuborilmadi');
}

/** Egasi mijozga o'zi yozdi (kartaga «Reply» yoki panel orqali) */
export async function ownerWrites(biz: BusinessRow, lead: LeadRow, text: string): Promise<LeadChannel> {
  const ch = await sendToLead(biz, lead, text, 'owner');
  await supersede(biz, lead, "O'zingiz javob berdingiz");
  return ch;
}
