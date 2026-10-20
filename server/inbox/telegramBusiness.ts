/**
 * Telegram Business — egasining shaxsiy Telegram'idagi mijoz yozishmalari, rasmiy yo'l (Bot API). Egasi (Telegram Premium):
 * Sozlamalar → Telegram Business → Chat-botlar → Palantir botini qo'shadi va qaysi chatlarga kirishini o'zi tanlaydi
 * (masalan, «kontaktlardan tashqari hammasi»). Shaxsiy akkauntga kod bilan kirish (telegramUser.ts) kerak emas: seans ham, parol ham yo'q.
 *
 *   ulanish — business_connection: faqat botga ulangan biznes egasining o'z akkaunti; begona akkaunt ulasa — hech narsa saqlanmaydi;
 *   o'qish  — business_message: mijozdan — mijozlar oqimiga (kanal «telegram»); egasining o'zi yozgani — «egasi javob berdi»;
 *             botning o'zi yozgani (sender_business_bot) — aks-sado, tashlanadi;
 *   yozish  — sendMessage business_connection_id bilan: egasi «javob berish» ruxsatini bergan bo'lsa va mijoz oxirgi 24 soatda yozgan
 *             bo'lsa (Telegram undan keyin bot nomidan yozishga ruxsat bermaydi — unda bot yoki egasi o'zi).
 * Telegraf 4.16 bu yangilanishlarni tanimaydi (Bot API 7.2) — bot.ts xom yangilanishni shu yerga beradi.
 */
import type { Telegram } from 'telegraf';
import { businesses, connections, type BusinessRow, type LeadRow } from '../db';
import { notifyOwner, onIncoming, onOwnerOutgoing, registerSender, replySettings } from './core';

const KIND = 'tg_business';
/** Bot olishi kerak bo'lgan yangilanishlar (bot.ts: allowedUpdates) — Telegraf 4.16 turlarida yo'q */
export const BUSINESS_UPDATES = ['business_connection', 'business_message'] as unknown as 'message'[];
const WINDOW_MS = 24 * 3_600_000;

interface TgUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
export interface BusinessConnection { id: string; user: TgUser; user_chat_id: number; is_enabled: boolean; can_reply?: boolean; rights?: { can_reply?: boolean } }
export interface BusinessMessage {
  message_id: number; business_connection_id?: string; chat: { id: number; type: string }; from?: TgUser; sender_business_bot?: TgUser;
  text?: string; caption?: string; voice?: unknown; audio?: unknown; photo?: unknown; video?: unknown; video_note?: unknown; document?: unknown; sticker?: unknown;
}

const nameOf = (u?: TgUser) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || null : null);
const canReply = (c: BusinessConnection) => !!(c.rights?.can_reply ?? c.can_reply);

/** Matnsiz xabar: mijoz nima yuborgani ko'rinsin (javobni egasi yoki model «egasidan so'rash» bilan beradi) */
function textOf(m: BusinessMessage): string {
  const t = (m.text ?? m.caption ?? '').trim();
  if (t) return t;
  if (m.voice || m.video_note) return '[ovozli xabar]';
  if (m.photo || m.video || m.document || m.audio) return '[rasm yoki fayl]';
  return m.sticker ? '[stiker]' : '';
}

/** Javob yozish mumkin bo'lgan ulanish id'si (ruxsat berilmagan yoki ulanmagan — null) */
function replyConnection(bizId: string): string | null {
  const c = connections.get(bizId, KIND);
  return c && c.meta.canReply === '1' ? c.account.id : null;
}

export async function onBusinessConnection(c: BusinessConnection, tg: Telegram): Promise<void> {
  const biz = businesses.byOwnerChat(String(c.user_chat_id)) ?? businesses.byOwnerChat(String(c.user.id));
  if (!biz) {
    if (c.is_enabled) await tg.sendMessage(c.user_chat_id, "Bu bot faqat Palantir'ga ulangan biznes egasi uchun. Avval panel → Ulanishlar'dagi havola bilan botga ulaning, keyin chat-bot sifatida qayta qo'shing.").catch(() => null);
    return;
  }
  if (!c.is_enabled) {
    connections.remove(biz.id, KIND);
    await notifyOwner(biz, "Telegram Business: Palantir chat-botlar ro'yxatidan olib tashlandi — shaxsiy chatlaringizdagi mijozlarni endi ko'rmaydi.").catch(() => null);
    return;
  }
  const reply = canReply(c);
  connections.save(biz.id, KIND, '', { id: c.id, userId: String(c.user.id), username: c.user.username ?? '', name: nameOf(c.user) ?? '' }, { canReply: reply ? '1' : '' });
  await notifyOwner(biz, reply
    ? "✅ Telegram Business ulandi: shaxsiy chatlaringizga yozgan mijozlarga Palantir javob beradi (panel → Ulanishlar → «Mijozlarga javob» sozlamasi bo'yicha)."
    : "✅ Telegram Business ulandi, lekin «Xabarlarga javob berish» ruxsati yo'q — Palantir mijoz yozganini ko'radi va sizga javob taklif qiladi, o'zi yubora olmaydi. Ruxsat: Telegram → Sozlamalar → Telegram Business → Chat-botlar.").catch(() => null);
}

export function onBusinessMessage(m: BusinessMessage): void {
  // Bot o'zi egasi nomidan yozgani — aks-sado
  if (!m.business_connection_id || m.chat.type !== 'private' || m.sender_business_bot) return;
  const conn = connections.byAccount(KIND, m.business_connection_id);
  const biz = conn && businesses.byId(conn.businessId);
  if (!conn || !biz?.active || replySettings(biz).mode === 'off') return;
  const text = textOf(m);
  if (!text) return;
  const extId = `${m.chat.id}:${m.message_id}`;
  if (String(m.from?.id) === conn.account.userId) {
    onOwnerOutgoing(biz, 'telegram', { tgUserId: String(m.chat.id) }, text, extId);
    return;
  }
  if (m.from?.is_bot) return;
  onIncoming(biz, { channel: 'telegram', person: { tgUserId: String(m.chat.id), name: nameOf(m.from), username: m.from?.username ?? null }, text, extId, source: 'Telegram (Business)' });
}

/** Panel uchun: ulangan akkaunt va javob berish ruxsati */
export function telegramBusinessStatus(bizId: string): { account: string | null; canReply: boolean } {
  const c = connections.get(bizId, KIND);
  return { account: c ? [c.account.name, c.account.username && `@${c.account.username}`].filter(Boolean).join(' · ') || 'ulangan' : null, canReply: c?.meta.canReply === '1' };
}

export function startTelegramBusiness(tg: Telegram): void {
  registerSender('telegram', {
    can: (biz: BusinessRow, lead: LeadRow) => !!lead.tgUserId && !!replyConnection(biz.id) && !!lead.lastInboundAt && Date.now() - Date.parse(lead.lastInboundAt) < WINDOW_MS,
    async send(biz: BusinessRow, lead: LeadRow, text: string) {
      // Telegraf 4.16 turlarida business_connection_id yo'q — so'rov xom holda
      const r = await (tg.callApi as (method: string, payload: Record<string, unknown>) => Promise<{ message_id: number }>)('sendMessage', {
        business_connection_id: replyConnection(biz.id), chat_id: Number(lead.tgUserId), text,
      });
      return `${lead.tgUserId}:${r.message_id}`;
    },
  }, KIND);
}
