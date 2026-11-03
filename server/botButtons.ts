/**
 * Bot tugmalari (callback_query): so'rov kartasi, kompyuterdagi ish, jamoa kirishi, Marketolog posti, mijozlarga xabar,
 * pul yozuvi, ikkinchi miya, vazifalar va javob takliflari. bot.ts dan ajratilgan; bot ichidagi ishlar d orqali keladi.
 */
import type { Context, Telegraf } from 'telegraf';
import { addDays, dueLabel, iso, stamp } from '../src/lib/week';
import { resetConversation } from './agent';
import { b, cut, detach, esc, ignoreUnchanged, kb, RECALL_SHOWN, reminderText, toast } from './botKit';
import { interviewOption, interviewSkip, interviewStart, interviewStop, type InterviewTurn } from './brain/interview';
import { settleFile, settleSuggestion } from './brain/learn';
import { answerApproval, closeLoginWindow, stopJob } from './computer/jobs';
import { cancelEntry, confirmEntry, undoEntry } from './crm/actions';
import { recallPatients } from './crm/index';
import { patientName } from './crm/logic';
import { businesses, leads, outbound, tasks, type BusinessRow } from './db';
import { approveReply, dismissReply, notifyOwner } from './inbox/core';
import { cancelPost, posts, publishPost } from './marketing/posts';
import { ContentError, cancelDraft, publishDraft } from './content/factory';
import { TargetError, cancel as cancelCampaign, launch as launchCampaign, pause as pauseCampaign } from './ads/campaigns';
import { askOutcome, DAY_OUTCOME, dropOutcome, wantsOutcome } from './outcome';
import { actorOf } from './requests/index';
import { requestButton } from './requests/telegram';
import { answerSupport } from './supportAsk';
import { answerPasswordReset } from './passwordReset';
import { directorButton } from './director/telegram';

export interface ButtonDeps {
  handleOwner(ctx: Context, biz: BusinessRow, text: string, voice?: boolean, extra?: { display?: string; photo?: boolean }): Promise<void>;
  sendHtml(chat: string, html: string, buttons?: { text: string; data: string }[][]): Promise<void>;
  sendInterview(biz: BusinessRow, turn: InterviewTurn): Promise<void>;
  refreshMoney(bizId: string, id: string): Promise<void>;
  sendFollowup(biz: BusinessRow, id: string): Promise<{ sent: number; failed: number }>;
  cancelFollowup(biz: BusinessRow, id: string): Promise<void>;
}

export function registerButtons(bot: Telegraf, d: ButtonDeps): void {
  const tg = bot.telegram;
  const { handleOwner, sendHtml, sendInterview, refreshMoney, sendFollowup, cancelFollowup } = d;

  // ─── Tugmalar ──────────────────────────────────────────────────────────────
  bot.on('callback_query', async ctx => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const [code, id] = data.split('|');
    // So'rov kartasi: egasi va qabulxona xodimlari bosadi
    if (await requestButton(ctx, code, id)) return;
    const ownerBiz = ctx.chat?.type === 'private' ? businesses.byOwnerChat(String(ctx.chat.id)) : undefined;
    // Mijozga javob taklifi: qabulxona xodimi ham yuboradi yoki rad etadi
    const biz = ownerBiz ?? ((code === 'ra' || code === 'rx') && ctx.chat?.type === 'private' ? actorOf(String(ctx.chat.id))?.biz : undefined);
    if (!biz || !id) return toast(ctx, 'Bu tugma eskirgan');
    const msg = ctx.callbackQuery.message;

    // Kompyuterdagi ish: xavfli amalga ruxsat, to'xtatish, brauzer oynasini yopish
    if (code === 'ca' || code === 'cx') return toast(ctx, answerApproval(biz.id, id, code === 'ca') ?? 'Bu so\'rov eskirgan');
    if (code === 'cs') return toast(ctx, stopJob(biz.id, id) ? "To'xtatyapman…" : 'Ish allaqachon tugagan');
    if (code === 'cl') {
      const closed = await closeLoginWindow(biz.id);
      if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, closed ? 'Oyna yopildi — kirishlar saqlandi' : 'Oyna allaqachon yopilgan');
    }
    // Palantir jamoasi kirmoqchi (supportAsk.ts): ruxsat / rad; kirgandan keyin — «Kirishni yopish» (jamoa darhol chiqariladi)
    if (code === 'ja' || code === 'jx') {
      const said = answerSupport(biz.id, id, code === 'ja');
      if (said) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, said ?? "Bu so'rov eskirgan");
    }
    // Egasi parolni unutdi (passwordReset.ts): «Ha» — yangi parol shu chatga, «Yo'q» — parol o'zgarmaydi
    if (code === 'pa' || code === 'px') {
      const said = answerPasswordReset(biz.id, id, code === 'pa');
      if (!said) return toast(ctx, "Bu so'rov eskirgan — kirish sahifasida qaytadan bosing", { show_alert: true });
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await sendHtml(String(ctx.chat!.id), said).catch(() => {});
      return toast(ctx, code === 'pa' ? 'Yangi parol yuborildi' : "Parol o'zgarmadi");
    }
    if (code === 'jy') {
      if (id !== biz.id) return toast(ctx, 'Bu tugma eskirgan');
      businesses.closeSupport(biz.id);
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, 'Palantir jamoasi kirishi yopildi', { show_alert: true });
    }

    // Marketolog posti: Instagram'ga joylash (fonda — Instagram sekin bo'lishi mumkin) yoki bekor qilish
    if (code === 'gp' || code === 'gx') {
      if (code === 'gx') {
        try { cancelPost(biz, id); } catch (e) { return toast(ctx, (e as Error).message, { show_alert: true }); }
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, 'Bekor qilindi');
      }
      const p = posts.get(biz.id, id);
      const stop: Partial<Record<string, string>> = {
        published: 'Allaqachon joylangan', cancelled: 'Bekor qilingan', publishing: 'Joylanyapti…', drawing: 'Rasm hali chizilmoqda',
        unknown: "Oldingi urinish natijasi noma'lum — Instagram'da tekshiring, keyin panel → Marketolog → Postlar",
      };
      if (!p || stop[p.status]) return toast(ctx, !p ? 'Post topilmadi' : stop[p.status]!, { show_alert: true });
      // Kartadagi tugma shu matnga berilgan: panelda matn o'zgargan bo'lsa — joylanmaydi, yangi karta keladi
      const mark = data.split('|')[2];
      await toast(ctx, "Instagram'ga joylanmoqda…");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      detach('instagram posti', async () => {
        try { await publishPost(biz, id, { mark }); } catch (e) {
          await tg.sendMessage(biz.ownerChatId!, `⚠️ Post joylanmadi: ${(e as Error).message}`).catch(() => {});
        }
      });
      return;
    }

    // Kontent-meyker qoralamasi: egasining kanaliga joylash yoki bekor qilish (karta matnga bog'langan)
    // Direktor taklifi: topshirish (xodimga doimiy topshiriq + Xotira'ga qaror) yoki kerak emas
    if (code === 'dv' || code === 'dn') {
      const r = directorButton(biz, code, id);
      await ctx.editMessageReplyMarkup({ inline_keyboard: r.keyboard.map(row => row.map(k => ({ text: k.text, callback_data: k.data }))) }).catch(() => {});
      return toast(ctx, r.toast, r.alert ? { show_alert: true } : undefined);
    }
    if (code === 'zp' || code === 'zx') {
      try {
        if (code === 'zx') cancelDraft(biz, id);
        else await publishDraft(biz, id, { mark: data.split('|')[2] });
      } catch (e) {
        if (!(e instanceof ContentError)) console.error('[kontent] tugma:', e);
        return toast(ctx, e instanceof ContentError ? e.message : 'Ichki xato', { show_alert: true });
      }
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, code === 'zx' ? 'Bekor qilindi' : 'Kanalga joylandi ✅');
    }

    // Targetolog: reklamani ishga tushirish (pul ketadi — faqat egasi; fonda, Meta bir necha so'rov), bekor qilish, to'xtatish
    if (code === 'tl' || code === 'tx' || code === 'tp') {
      if (code === 'tx' || code === 'tp') {
        try {
          if (code === 'tx') cancelCampaign(biz, id);
          else await pauseCampaign(biz, id);
        } catch (e) {
          if (!(e instanceof TargetError)) console.error('[targetolog] tugma:', e);
          return toast(ctx, e instanceof TargetError ? e.message : 'Ichki xato', { show_alert: true });
        }
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, code === 'tx' ? 'Bekor qilindi' : "To'xtatildi ⏸");
      }
      await toast(ctx, 'Meta’da yaratilmoqda…');
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      detach('reklama kampaniyasi', async () => {
        try { await launchCampaign(biz, id, { mark: data.split('|')[2] }); } catch (e) {
          if (!(e instanceof TargetError)) console.error('[targetolog] ishga tushirish:', e);
          await tg.sendMessage(biz.ownerChatId!, `⚠️ Reklama ishga tushmadi: ${e instanceof TargetError ? e.message : 'ichki xato'}`).catch(() => {});
        }
      });
      return;
    }

    // Postlar olib tashlangan: eski xabarlardagi «Kanalga joylash» va «O'chirish» tugmalari
    if (code === 'pp' || code === 'pd') return toast(ctx, 'Postlar olib tashlangan', { show_alert: true });

    if (code === 'fs' || code === 'fc') {
      const o = outbound.get(biz.id, id);
      if (!o) return toast(ctx, 'Xabar topilmadi');
      if (o.status !== 'draft') return toast(ctx, o.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bekor qilingan', { show_alert: true });
      if (code === 'fc') {
        await cancelFollowup(biz, id).catch(() => {});
        return toast(ctx, 'Bekor qilindi');
      }
      // Tugmaga darhol javob (Telegram kutmaydi), yuborish — fonda
      await toast(ctx, 'Yuborilmoqda…');
      detach('mijozlarga xabar', async () => {
        try {
          const r = await sendFollowup(biz, id);
          if (r.failed) await tg.sendMessage(biz.ownerChatId!, `⚠️ ${r.failed} kishiga yetmadi (botni bloklagan bo'lishi mumkin).`);
        } catch (e) {
          await tg.sendMessage(biz.ownerChatId!, `⚠️ ${(e as Error).message}`).catch(() => {});
        }
      });
      return;
    }

    if (code === 'ma' || code === 'mx' || code === 'mu') {
      try {
        if (code === 'mx') {
          cancelEntry(biz, id);
          await toast(ctx, 'Bekor qilindi');
        } else {
          // CRM sekin javob bersa Telegram tugmasi kutib qolmasin: natija kartaning o'zida ko'rinadi
          const work = code === 'ma' ? confirmEntry(biz, id) : undoEntry(biz, id);
          const fast = await Promise.race([work.then(() => true), new Promise<false>(r => setTimeout(() => r(false), 8000))]);
          if (!fast) {
            await toast(ctx, 'Yozilmoqda…');
            detach('pul yozuvi', async () => {
              try {
                await work.catch(e => tg.sendMessage(biz.ownerChatId!, `⚠️ ${(e as Error).message}`));
              } finally {
                await refreshMoney(biz.id, id);
              }
            });
            return;
          }
          await toast(ctx, code === 'ma' ? "✅ DentaCRM'ga yozildi" : '↩️ Ortga qaytarildi');
        }
      } catch (e) {
        await toast(ctx, cut((e as Error).message, 190), { show_alert: true });
      }
      return refreshMoney(biz.id, id);
    }

    // Ikkinchi miya: «bu javobimni eslab qol / kerak emas»
    if (code === 'ky' || code === 'kn') {
      const result = settleSuggestion(biz, id, code === 'ky');
      if (!result) return toast(ctx, 'Bu tugma eskirgan');
      // Bilim o'zgardi — yordamchi keyingi gapni yangi bilim bilan boshlasin (panel ham shunday qiladi)
      resetConversation(biz.id);
      if (msg) await tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, result, { parse_mode: 'HTML' }).catch(ignoreUnchanged).catch(() => {});
      return toast(ctx, code === 'ky' ? 'Eslab qoldim' : 'Eslab qolmadim');
    }

    // Vazifa natijasi so'ralgandi — egasi «aytadigan narsa yo'q» dedi
    if (code === 'od') {
      dropOutcome(biz.id, DAY_OUTCOME);
      if (msg) await tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, 'Mayli, ertaga gaplashamiz. Yaxshi dam oling!').catch(ignoreUnchanged).catch(() => {});
      return toast(ctx);
    }

    if (code === 'oc') {
      // Faqat shu vazifaning so'rovi yopiladi (keyinroq boshqa vazifa bajarilgan bo'lsa, uning so'roviga tegilmaydi)
      dropOutcome(biz.id, id);
      if (msg) await tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, 'Mayli, natijasiz yopdim.').catch(ignoreUnchanged).catch(() => {});
      return toast(ctx);
    }

    // Kunlik reja: unutilgan mijozga qayta yozish matni — yordamchi tayyorlaydi (yuborish baribir egasining tugmasi bilan)
    if (code === 'fu') {
      const lead = leads.get(biz.id, id);
      if (!lead) return toast(ctx, 'Mijoz topilmadi');
      await toast(ctx, 'Tayyorlayapman…');
      const prompt = `Customer id ${lead.id} has had no contact for a while and has no next step. Look at them with list_leads (lead_id), then prepare a short, warm follow-up message with draft_followup and set the next step with update_lead. If Palantir cannot message them, write in two sentences what I should say when I phone them.`;
      // Jurnalga mijozning ismi (begona matn) egasining gapi bo'lib yozilmasin — keyingi suhbatlarga «egasi aytgan» bo'lib o'tardi
      return detach('qayta yozish', () => handleOwner(ctx, biz, prompt, false, { display: '✍️ Unutilgan mijozga qayta yozish matnini tayyorla' }));
    }

    // Kunlik reja (klinika): 6–12 oy oldin kelgan bemorlar ro'yxati — qabulxona qo'ng'iroq qilishi uchun
    if (code === 'rc') {
      await toast(ctx, "Ro'yxat olinmoqda…");
      const list = await recallPatients(biz.id, iso(new Date()));
      if (!list.length) return tg.sendMessage(biz.ownerChatId!, "6–12 oy oldin kelgan bemor topilmadi (yoki DentaCRM javob bermadi).").then(() => {}).catch(() => {});
      const shown = list.slice(0, RECALL_SHOWN);
      const lines = shown.map(p => `• ${esc(patientName(p))}${p.phone ? ` — ${esc(p.phone)}` : ''} · oxirgi: ${esc(p.lastVisit!.slice(0, 10))}`);
      const more = list.length > shown.length ? `\n… yana ${list.length - shown.length} ta — to'liq ro'yxat DentaCRM'da` : '';
      return sendHtml(biz.ownerChatId!, `🔁 <b>Qaytarish kerak (${list.length})</b>\nQabulxona qo'ng'iroq qilib, ko'rikka taklif qilsin:\n${lines.join('\n')}${more}`);
    }

    // Birinchi kun suhbati: boshlash (ulanishdagi taklif), «o'tkazib yuborish» (aynan shu savol hali so'ralayotgan bo'lsa) yoki «to'xtatish»
    if (code === 'iv') {
      if (id === 'later') return toast(ctx, "Kerak bo'lganda «savollar» deb yozing");
      const option = /^o:(\d+):(.+)$/.exec(id);
      const turn = option ? interviewOption(biz, option[2], Number(option[1]))
        : id === 'go' ? interviewStart(biz) : id.startsWith('s:') ? interviewSkip(biz, id.slice(2)) : id === 'x' ? interviewStop(biz) : null;
      if (!turn) return toast(ctx, 'Bu tugma eskirgan');
      await toast(ctx);
      return sendInterview(biz, turn);
    }

    // Fayldan kelgan taklif: narxlarni jadvalga olish yoki hujjat namunasi qilish
    if (code === 'kp' || code === 'ks') {
      const result = settleFile(biz, id, code === 'kp' ? 'prices' : 'sample');
      if (!result) return toast(ctx, 'Bu tugma eskirgan');
      resetConversation(biz.id);
      // Bajarilmadi (jadval yoki namunalar to'lgan): taklif va tugmalar joyida qoladi, sababi ogohlantirish bo'lib chiqadi
      if (!result.done) return toast(ctx, cut(result.text, 190), { show_alert: true });
      if (msg) await tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, result.text, { parse_mode: 'HTML' }).catch(ignoreUnchanged).catch(() => {});
      return toast(ctx, code === 'kp' ? 'Narxlar jadvalga tushdi' : 'Namuna saqlandi');
    }

    if (code === 'ra' || code === 'rx') {
      try {
        if (code === 'ra') {
          // Instagram'da brauzer orqali yozish bir necha soniya oladi — Telegram tugmasi uzoq kutmasin
          const sending = approveReply(biz, id);
          const fast = await Promise.race([sending.then(() => true), new Promise<false>(r => setTimeout(() => r(false), 8000))]);
          if (fast) return toast(ctx, '✅ Yuborildi');
          await toast(ctx, 'Yuborilmoqda…');
          return detach('javob', () => sending.catch(e => notifyOwner(biz, `⚠️ Yuborilmadi: ${esc(cut((e as Error).message, 300))}`)));
        }
        await dismissReply(biz, id);
        return toast(ctx, 'Yuborilmadi');
      } catch (e) {
        return toast(ctx, cut((e as Error).message, 190), { show_alert: true });
      }
    }

    if (code === 'td' || code === 'ts' || code === 'tt') {
      const t = tasks.get(biz.id, id);
      if (!t) return toast(ctx, 'Vazifa topilmadi');
      const isReminder = !!msg && 'text' in msg && !!msg.text?.startsWith('⏰');
      const edit = (html: string) => (isReminder
        ? tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, html, { parse_mode: 'HTML' }).catch(ignoreUnchanged).catch(() => {})
        : Promise.resolve());
      if (code === 'td') {
        const wasOpen = t.status === 'open';
        tasks.update(biz.id, id, { status: 'done' });
        await toast(ctx, '✅ Bajarildi');
        await edit(reminderText(t, '✅ Bajarildi'));
        // Uchrashuv, qo'ng'iroq, taklif yoki mijozga bog'liq ish: natijasi so'raladi — keyingi qadamni yordamchi qo'yadi
        // Ikki marta bosilsa (yoki allaqachon bajarilgan bo'lsa) qayta so'ralmaydi
        if (wasOpen && wantsOutcome(t)) {
          askOutcome(biz, t);
          await tg.sendMessage(biz.ownerChatId!, `«${cut(t.title, 80)}» — natijasi qanday bo'ldi? Yozing yoki ovozli ayting — mijozni yangilab, keyingi qadamni o'zim qo'yaman.`,
            { reply_markup: kb([[b("Aytadigan narsa yo'q", `oc|${t.id}`)]]) }).catch(() => {});
        }
        return;
      }
      const now = new Date();
      const next = code === 'ts' ? stamp(new Date(now.getTime() + 3600_000)) : `${iso(addDays(now, 1))}T09:00`;
      const u = tasks.update(biz.id, id, { dueAt: next, status: 'open' })!;
      await toast(ctx, `⏰ ${dueLabel('uz', next, now)}`);
      return edit(reminderText(u, `⏰ Yana eslataman: ${dueLabel('uz', next, now)}`));
    }
    return toast(ctx);
  });
}
