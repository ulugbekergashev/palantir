/**
 * So'rovlar Telegram'da: kartalar (yuborish va yangilash), tugmalar, kartaga «Reply» bilan natija, qabulxona xodimini ulash
 * va /sorovlar buyrug'i. Egasi ham, xodim ham bir xil ishlaydi; farqi — xodim yordamchi bilan gaplashmaydi.
 */
import type { Context, Telegram } from 'telegraf';
import { businesses, leads, relays } from '../db';
import { ownerWrites, sendToLead } from '../inbox/core';
import { dialFor } from '../phone/index';
import { MISSED_TEXT, RequestError, actorOf, addResult, closeRequest, noAnswer, sendCardTo, type TeamOutlet } from './index';
import { replyCards, requestCards, requests, staff } from './store';

const CODES = new Set(['qd', 'qn', 'qm', 'qx', 'qc']);
/** Bitta /sorovlar buyrug'ida shuncha karta (qolgani — panelda) */
const MAX_LISTED = 10;

const toast = (ctx: Context, text: string, alert = false) => ctx.answerCbQuery(text, { show_alert: alert }).catch(() => {});
const ignoreUnchanged = (e: unknown) => {
  if (!/message is not modified/i.test((e as Error).message)) throw e;
};

export function teamOutlet(tg: Telegram): TeamOutlet {
  return {
    async send(chatId, html, keyboard, silent) {
      const m = await tg.sendMessage(chatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard, disable_notification: silent });
      return m.message_id;
    },
    async edit(chatId, messageId, html, keyboard) {
      await tg.editMessageText(chatId, messageId, undefined, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard }).catch(ignoreUnchanged);
    },
  };
}

/** So'rov kartasidagi tugma (q…). Qaytadi: bu so'rov tugmasi edimi */
export async function requestButton(ctx: Context, code: string, id: string): Promise<boolean> {
  if (!CODES.has(code)) return false;
  const actor = ctx.chat?.type === 'private' ? actorOf(String(ctx.chat.id)) : null;
  if (!actor || !id) { await toast(ctx, 'Bu tugma eskirgan'); return true; }
  const { biz, name } = actor;
  try {
    if (code === 'qd') {
      await closeRequest(biz, id, 'done', name);
      await toast(ctx, '✅ Bajarildi');
    } else if (code === 'qx') {
      await closeRequest(biz, id, 'cancelled', name);
      await toast(ctx, '✖️ Bekor qilindi');
    } else if (code === 'qc') {
      // Klinika kompyuteridagi MicroSIP teradi: xodim kompyuter yonida gaplashadi, suhbat yozib olinadi
      const r = requests.get(biz.id, id);
      const phone = r?.phone ?? (r?.leadId ? leads.get(biz.id, r.leadId)?.phone : null);
      if (!r || r.status !== 'open' || !phone) throw new RequestError(r?.status === 'open' ? "Raqam yo'q" : "Bu so'rov yopilgan");
      const { noAccount } = await dialFor(biz, phone, r.id);
      await toast(ctx, noAccount ? "📞 MicroSIP'ga yuborildi, lekin unda operator hisobi sozlanmagan ko'rinadi" : "📞 MicroSIP terayapti — kompyuterda gaplashing", noAccount);
    } else if (code === 'qn') {
      const r = await noAnswer(biz, id, name);
      await toast(ctx, r.status === 'open' && r.attempts < 3 ? "📵 Yozib qo'ydim — yarim soatdan keyin yana eslataman" : "📵 Uch marta ko'tarmadi — boshqa eslatmayman. Mijozga yozib qo'yish mumkin");
    } else {
      const r = requests.get(biz.id, id);
      const lead = r?.leadId ? leads.get(biz.id, r.leadId) : undefined;
      if (!r || !lead) throw new RequestError('Mijoz topilmadi');
      await sendToLead(biz, lead, MISSED_TEXT, 'cerebro');
      await addResult(biz, id, "Mijozga yozildi: qachon qo'ng'iroq qilsak qulay?", name);
      await toast(ctx, '💬 Yozildi');
    }
  } catch (e) {
    if (!(e instanceof RequestError)) console.error("[so'rov] tugma:", (e as Error).message);
    await toast(ctx, `⚠️ ${(e as Error).message}`, true);
  }
  return true;
}

/**
 * Xodim yoki egasi so'rov kartasiga «Reply» qilib yozdi — natija sifatida saqlanadi. Qaytadi: javob matni (bu kartaga yozilgan bo'lsa)
 */
export async function requestReply(chatId: string, replyTo: number | undefined, text: string): Promise<string | null> {
  const id = replyTo ? requestCards.byMessage(chatId, replyTo) : null;
  const actor = id ? actorOf(chatId) : null;
  if (!id || !actor) return null;
  try {
    await addResult(actor.biz, id, text, actor.name);
    return "✅ Natija so'rovga yozildi";
  } catch (e) {
    return `⚠️ ${(e as Error).message}`;
  }
}

/** Xodim yozdi (egasi emas). Qaytadi: bu xodim chatimi */
export async function staffText(ctx: Context, text: string): Promise<boolean> {
  const chatId = String(ctx.chat!.id);
  const s = staff.byChat(chatId);
  if (!s) return false;
  const replyTo = ctx.message && 'reply_to_message' in ctx.message ? ctx.message.reply_to_message?.message_id : undefined;
  const answer = await requestReply(chatId, replyTo, text);
  if (answer) { await ctx.reply(answer); return true; }
  // Mijoz xabari yoki javob taklifi kartasiga «Reply» — javob mijozga ketadi (xodim nomidan emas, biznes nomidan)
  const leadId = replyTo ? relays.leadFor(chatId, replyTo) : undefined;
  const biz = businesses.byId(s.businessId);
  const lead = leadId && biz ? leads.get(biz.id, leadId) : undefined;
  if (biz && lead) {
    try {
      await ownerWrites(biz, lead, text, replyCards.byMessage(chatId, replyTo!) ?? undefined);
      await ctx.reply(`✅ ${lead.name || 'Mijoz'}ga yuborildi.`);
    } catch (e) {
      await ctx.reply(`⚠️ Yuborilmadi: ${(e as Error).message}`);
    }
    return true;
  }
  if (/^\/(sorovlar|so'rovlar|start)\b/i.test(text)) { await listOpen(ctx); return true; }
  await ctx.reply("Mijozlar yozganda javob taklifi, qo'ng'iroq qilishni so'rasa yoki shikoyat qilsa — so'rov kartasi shu yerga keladi.\n\n✅ «Yuborish» — taklif mijozga ketadi.\n↩️ Mijozga o'zingiz yozish yoki so'rov natijasi: kartaga «Reply» qiling.\n/sorovlar — ochiq so'rovlar");
  return true;
}

/** Ochiq so'rovlar — har biri tugmali karta bo'lib (eng eskisi birinchi) */
export async function listOpen(ctx: Context): Promise<void> {
  const actor = actorOf(String(ctx.chat!.id));
  if (!actor) return;
  const open = requests.list(actor.biz.id, 'open', MAX_LISTED);
  if (!open.length) { await ctx.reply("Ochiq so'rov yo'q ✨"); return; }
  const total = requests.openCount(actor.biz.id);
  await ctx.reply(`Ochiq so'rovlar: ${total}${total > open.length ? ` (birinchi ${open.length} tasi; qolgani — panelda)` : ''}`);
  for (const r of open) await sendCardTo(actor.biz, r, String(ctx.chat!.id));
}

/** Xodim panel bergan havolani bosdi: shu Telegram — qabulxona */
export async function linkStaff(ctx: Context, code: string): Promise<void> {
  const chatId = String(ctx.chat!.id);
  const s = staff.byCode(code);
  const biz = s && businesses.byId(s.businessId);
  if (!s || !biz?.active) { await ctx.reply('Havola eskirgan — paneldan yangisini oling.'); return; }
  if (businesses.byOwnerChat(chatId)) { await ctx.reply("Bu Telegram biznes egasiga ulangan. Xodim havolasini xodimning o'z Telegram'ida oching."); return; }
  staff.link(s.id, chatId, null);
  await ctx.reply([
    `✅ ${s.name}, siz «${biz.profile.name}» qabulxonasiga ulandingiz.`,
    '',
    "Mijoz Instagram, Telegram yoki qo'ng'iroq orqali qo'ng'iroq qilishni so'rasa, yozilmoqchi bo'lsa yoki shikoyat qilsa — shu yerga karta keladi.",
    "Qo'ng'iroq qilgach «✅ Bajarildi» yoki «📵 Ko'tarmadi»ni bosing. Natijani yozish uchun kartaga «Reply» qiling.",
    '',
    "/sorovlar — ochiq so'rovlar",
  ].join('\n'));
  if (biz.ownerChatId) await ctx.telegram.sendMessage(biz.ownerChatId, `👩‍💼 ${s.name} qabulxona xodimi sifatida ulandi — so'rovlar endi unga ham boradi.`).catch(() => {});
}
