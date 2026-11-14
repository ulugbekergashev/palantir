/**
 * Egasi panel parolini unutdi (kirish sahifasi → «Parolni unutdingizmi?», http.ts /api/login/forgot). Admin sahifasi klinikada yo'q
 * (bitta-profil rejimi), shuning uchun yangi parol faqat egasining Telegram'iga boradi: avval «Siz so'radingizmi?» deb so'raladi
 * («✅ Ha, yangi parol» / «✖️ Yo'q», bot: pa|, px|), «Ha» bosilsa — yangi parol, hamma eski kirishlar bekor.
 * Kirish sahifasini ochgan begona odam faqat egasiga savol yubora oladi — parolni ko'ra olmaydi va almashtira olmaydi.
 */
import { Markup } from 'telegraf';
import { hashPassword } from './auth';
import { esc } from './botKit';
import { businesses, newId, type BusinessRow } from './db';
import { notifyOwner } from './inbox/core';
import { newOwnerPassword } from './profile';

/** Tasdiqlash tugmasi shuncha amal qiladi */
const VALID_MS = 15 * 60_000;
/** Bitta biznesga qayta so'rov — shundan keyin (egasini savol bilan ko'mib tashlamaslik uchun) */
const REPEAT_MS = 2 * 60_000;

const pending = new Map<string, { bizId: string; at: number }>();
const lastAsk = new Map<string, number>();

export type ResetAsk = 'sent' | 'wait' | 'unreachable';

/** Egasining Telegram'iga tasdiqlash so'rovi */
export async function askPasswordReset(biz: BusinessRow, now = Date.now()): Promise<ResetAsk> {
  if (!biz.ownerChatId) return 'unreachable';
  if (now - (lastAsk.get(biz.id) ?? 0) < REPEAT_MS) return 'wait';
  for (const [id, p] of pending) if (p.bizId === biz.id || now - p.at > VALID_MS) pending.delete(id);
  const id = newId(10);
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, yangi parol', `pa|${id}`), Markup.button.callback("✖️ Yo'q, men emas", `px|${id}`)]]).reply_markup;
  const sent = await notifyOwner(biz, "🔑 <b>Panel parolini tiklash so'raldi</b>\nKirish sahifasida «Parolni unutdingizmi?» bosildi. Siz bo'lsangiz — «Ha» ni bosing, yangi parol shu yerga keladi. Siz bo'lmasangiz — «Yo'q», parol o'zgarmaydi.", keyboard).catch(() => null);
  if (sent === null) return 'unreachable';
  pending.set(id, { bizId: biz.id, at: now });
  lastAsk.set(biz.id, now);
  return 'sent';
}

/**
 * Egasi Telegram'ini ham, parolini ham yo'qotgan (yoki klinika sotilgan) — kirish Palantir jamoasi orqali tiklanadi (H9, egasi qarori):
 * asoschi egasining shaxsini tekshiradi va Hub'da «Kirishni tiklash»ni bosadi (faqat Hub orqali, http.ts). Yangi parol, hamma eski
 * kirishlar bekor, eski Telegram uziladi (yangi egasi ulash havolasi bilan qayta ulanadi). Eski Telegram hali
 * egasining qo'lida bo'lsa (bu tiklashni u so'ramagan bo'lsa) — avval unga aytiladi: tiklash yashirin o'tmaydi.
 */
export async function recoverOwnerAccess(biz: BusinessRow, who: string | null): Promise<{ login: string; password: string }> {
  if (biz.ownerChatId) {
    await notifyOwner(biz, `⚠️ <b>Panelga kirish Palantir jamoasi orqali tiklandi</b>${who ? ` (${esc(who)})` : ''}: parol almashtirildi, bu Telegram uzildi. Siz so'ramagan bo'lsangiz — darhol Palantir jamoasiga qo'ng'iroq qiling.`).catch(() => null);
  }
  const password = newOwnerPassword();
  businesses.update(biz.id, { passwordHash: hashPassword(password), ownerChatId: null });
  businesses.revokeSessions(biz.id);
  return { login: biz.login, password };
}

/** Tugma bosildi. Qaytaradi: egasiga yuboriladigan javob (HTML); so'rov eskirgan bo'lsa — null */
export function answerPasswordReset(bizId: string, id: string, yes: boolean, now = Date.now()): string | null {
  const p = pending.get(id);
  if (!p || p.bizId !== bizId || now - p.at > VALID_MS) return null;
  pending.delete(id);
  if (!yes) return "Parol o'zgarmadi. Agar siz so'ramagan bo'lsangiz — kimdir kirish sahifasini ochgan; parolingiz baribir xavfsiz.";
  const biz = businesses.byId(bizId);
  if (!biz) return null;
  const password = newOwnerPassword();
  businesses.update(biz.id, { passwordHash: hashPassword(password) });
  // Yangi parol — eski kirishlar (yo'qolgan telefon, begona kompyuter) bekor
  businesses.revokeSessions(biz.id);
  return `🔑 <b>Yangi parol</b>\nLogin: <code>${esc(biz.login)}</code>\nParol: <code>${esc(password)}</code>\nAvvalgi hamma kirishlar yopildi. Bu xabarni kirgandan keyin o'chirib qo'ying.`;
}
