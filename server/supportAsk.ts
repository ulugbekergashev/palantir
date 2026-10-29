/**
 * Palantir jamoasi klinika paneliga kirmoqchi (hub «Panelni ochish», http.ts /api/login/support): egasi doimiy ruxsat bermagan bo'lsa —
 * Telegram'da so'raladi («✅ Ruxsat» / «✖️ Yo'q», bot.ts: ja|, jx|). Hub javobni ~2 daqiqa kutadi, shuning uchun kutish undan qisqa.
 * Har kirishdan keyin egasiga xabar boradi — «🚫 Kirishni yopish» (jy|) bilan jamoa darhol chiqariladi.
 */
import { Markup } from 'telegraf';
import { newId, type BusinessRow } from './db';
import { notifyOwner } from './inbox/core';

const ASK_MS = 100_000;
const pending = new Map<string, { bizId: string; resolve: (yes: boolean) => void }>();

export type SupportAnswer = 'yes' | 'no' | 'timeout' | 'unreachable';

/** Egasidan so'raydi. unreachable — Telegram'ga ulanmagan yoki xabar ketmadi */
export async function askSupport(biz: BusinessRow, hours: number): Promise<SupportAnswer> {
  if (!biz.ownerChatId) return 'unreachable';
  const id = newId(8);
  const answer = new Promise<boolean | null>(resolve => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, ASK_MS);
    pending.set(id, { bizId: biz.id, resolve: yes => { clearTimeout(timer); pending.delete(id); resolve(yes); } });
  });
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback(`✅ Ruxsat (${hours} soat)`, `ja|${id}`), Markup.button.callback("✖️ Yo'q", `jx|${id}`)]]).reply_markup;
  const sent = await notifyOwner(biz, `👥 <b>Palantir jamoasi panelingizga kirmoqchi</b>\nSozlash yoki muammoni tekshirish uchun. Ruxsat bersangiz — ${hours} soatgacha; xohlagan payt yopasiz.`, keyboard).catch(() => null);
  if (sent === null) {
    pending.get(id)?.resolve(false);
    return 'unreachable';
  }
  const yes = await answer;
  return yes === null ? 'timeout' : yes ? 'yes' : 'no';
}

/** Tugma bosildi. Qaytaradi: egasiga qisqa javob; eskirgan bo'lsa — null */
export function answerSupport(bizId: string, id: string, yes: boolean): string | null {
  const p = pending.get(id);
  if (!p || p.bizId !== bizId) return null;
  p.resolve(yes);
  return yes ? 'Ruxsat berildi' : 'Rad etildi';
}

/** Jamoa kirdi — egasiga xabar va yopish tugmasi */
export async function notifySupportVisit(biz: BusinessRow, hours: number): Promise<void> {
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🚫 Kirishni yopish', `jy|${biz.id}`)]]).reply_markup;
  await notifyOwner(biz, `👥 <b>Palantir jamoasi panelingizga kirdi</b>\n${hours} soatgacha. Kirishlar ro'yxati — panel → Sozlamalar.`, keyboard).catch(() => null);
}
