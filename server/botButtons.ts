/**
 * Bot tugmalari (callback_query): so'rov kartasi, kompyuterdagi ish, jamoa kirishi, Instagram posti (Kontent-meyker), mijozlarga xabar,
 * pul yozuvi, ikkinchi miya, vazifalar va javob takliflari. bot.ts dan ajratilgan; bot ichidagi ishlar d orqali keladi.
 */
import type { Context, Telegraf } from 'telegraf';
import type { Artifact } from '../src/types';
import { addDays, dueLabel, iso, stamp } from '../src/lib/week';
import { resetConversation } from './agent';
import { b, cut, detach, esc, ignoreUnchanged, kb, RECALL_SHOWN, reminderText, toast } from './botKit';
import { interviewOption, interviewSkip, interviewStart, interviewStop, type InterviewTurn } from './brain/interview';
import { settleFile, settleSuggestion } from './brain/learn';
import { answerApproval, closeLoginWindow, restartJob, stopJob } from './computer/jobs';
import { startBuild, stopBuild } from './dev/build';
import { DevError, acceptCodeJob, answerStart, codeJobs, discardCodeJob, sendCodeDiff, stopCodeJob } from './dev/jobs';
import { cancelEntry, confirmEntry, undoEntry } from './crm/actions';
import { recallPatients } from './crm/index';
import { patientName } from './crm/logic';
import { businesses, inbox, leads, outbound, tasks, type BusinessRow } from './db';
import { approveReply, DEFAULT_REPLY, dismissReply, notifyOwner } from './inbox/core';
import { OFFER_CODE } from './inbox/autonomy';
import { APPROVE_CODE, REJECT_CODE, approvalKeyboard, decideApproval } from './permissions';
import { cancelPost, posts, publishPost } from './marketing/posts';
import { ContentError, cancelDraft, publishDraft } from './content/factory';
import { TargetError, cancel as cancelCampaign, launch as launchCampaign, pause as pauseCampaign } from './ads/campaigns';
import { approveAction as approveMcpAction, cancelAction as cancelMcpAction, pauseTrackedByOwner } from './ads/mcp';
import { askOutcome, DAY_OUTCOME, dropOutcome, wantsOutcome } from './outcome';
import { actorOf } from './requests/index';
import { requestButton } from './requests/telegram';
import { answerSupport } from './supportAsk';
import { answerPasswordReset } from './passwordReset';
import { directorButton } from './director/telegram';
import { mergeKeyboard } from './director/logic';
import { forgetLead } from './forget';
import { canMarkPersonal, personalChats, undoPersonalRow } from './inbox/personal';
import { REMIND_AFTER_MS, undoWorkRow, workChats } from './inbox/workChats';
import { HrError, decideCandidate, postVacancy } from './hr/recruit';
import { vacancies } from './hr/store';
import { trainingButton } from './hr/train';

const REMIND_HOURS = REMIND_AFTER_MS / 3600_000;
import { waiting } from './serviceStore';

export interface ButtonDeps {
  handleOwner(ctx: Context, biz: BusinessRow, text: string, voice?: boolean, extra?: { display?: string; photo?: boolean }): Promise<void>;
  sendHtml(chat: string, html: string, buttons?: { text: string; data: string }[][]): Promise<void>;
  sendInterview(biz: BusinessRow, turn: InterviewTurn): Promise<void>;
  refreshMoney(bizId: string, id: string): Promise<void>;
  sendFollowup(biz: BusinessRow, id: string): Promise<{ sent: number; failed: number }>;
  cancelFollowup(biz: BusinessRow, id: string): Promise<void>;
  sendArtifacts(biz: BusinessRow, chat: string, artifacts: Artifact[]): Promise<void>;
}

export function registerButtons(bot: Telegraf, d: ButtonDeps): void {
  const tg = bot.telegram;
  const { handleOwner, sendHtml, sendInterview, refreshMoney, sendFollowup, cancelFollowup, sendArtifacts } = d;

  // ─── Tugmalar ──────────────────────────────────────────────────────────────
  bot.on('callback_query', async ctx => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const [code, id] = data.split('|');
    // So'rov kartasi: egasi va qabulxona xodimlari bosadi
    if (await requestButton(ctx, code, id)) return;
    // Murabbiy kursi (hr/train.ts): xodim bosadi — test, javob, keyingi dars. Bosilgan savol tugmalari olinadi (qayta javob bo'lmasin)
    if (ctx.chat?.type === 'private') {
      const taught = await trainingButton(String(ctx.chat.id), code, id ?? '');
      if (taught !== null) {
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, taught);
      }
    }
    const ownerBiz = ctx.chat?.type === 'private' ? businesses.byOwnerChat(String(ctx.chat.id)) : undefined;
    // Mijozga javob taklifi: qabulxona xodimi ham yuboradi yoki rad etadi
    const biz = ownerBiz ?? ((code === 'ra' || code === 'rx') && ctx.chat?.type === 'private' ? actorOf(String(ctx.chat.id))?.biz : undefined);
    if (!biz || !id) return toast(ctx, 'Bu tugma eskirgan');
    const msg = ctx.callbackQuery.message;

    // Kompyuterdagi ish: xavfli amalga ruxsat, to'xtatish, brauzer oynasini yopish
    if (code === 'ca' || code === 'cx') return toast(ctx, answerApproval(biz.id, id, code === 'ca') ?? 'Bu so\'rov eskirgan');
    if (code === 'cs') return toast(ctx, stopJob(biz.id, id) ? "To'xtatyapman…" : 'Ish allaqachon tugagan');
    // Ish boshlanmagan edi (javob bo'lmadi yoki «Yo'q»): o'sha topshiriq qayta, so'ramasdan — egasi o'zi bosdi
    if (code === 'cr') {
      const said = restartJob(biz, id);
      if (said === 'Boshladim' && msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, said);
    }
    if (code === 'cl') {
      const closed = await closeLoginWindow(biz.id);
      if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, closed ? 'Oyna yopildi — kirishlar saqlandi' : 'Oyna allaqachon yopilgan');
    }
    // Dasturchi (dev/jobs.ts): «Boshlaymi?», to'xtatish, qabul qilish, tashlab yuborish, o'zgarishlarni ko'rish — faqat egasi
    if (['ba', 'bx', 'bs', 'bo', 'bd', 'bf', 'bb', 'bq'].includes(code)) {
      if (!ownerBiz) return toast(ctx, 'Bu tugma eskirgan');
      // «📦 Yig'ish» (qabul qilingan ishning loyihasi) va yig'ishni to'xtatish
      if (code === 'bq') return toast(ctx, stopBuild(biz.id, id) ? "To'xtatyapman…" : "Yig'ish allaqachon tugagan");
      if (code === 'bb') {
        const project = codeJobs.byId(biz.id, id)?.project;
        if (!project) return toast(ctx, 'Bu ish topilmadi');
        try {
          startBuild(biz, project);
          return toast(ctx, "Yig'ish boshlandi — tayyor fayl ish stoliga qo'yiladi");
        } catch (e) {
          if (e instanceof DevError) return toast(ctx, cut(e.message, 190), { show_alert: true });
          throw e;
        }
      }
      if (code === 'ba' || code === 'bx') return toast(ctx, answerStart(biz.id, id, code === 'ba') ?? "Bu so'rov eskirgan");
      if (code === 'bs') return toast(ctx, stopCodeJob(biz.id, id) ? "To'xtatyapman — qilingani saqlanadi" : 'Ish allaqachon tugagan');
      const said = await (code === 'bo' ? acceptCodeJob(biz, id) : code === 'bd' ? discardCodeJob(biz, id) : sendCodeDiff(biz, id));
      // Qaror qilindi — tugmalar olinadi va qaror xabarda qoladi (farqni ko'rish tugmalarni olmaydi)
      if (said.ok && code !== 'bf' && msg) {
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        await ctx.reply(`${code === 'bo' ? '✅' : '✖️'} ${said.text}`, { reply_parameters: { message_id: msg.message_id }, ...(said.build ? { reply_markup: kb([[b("📦 Yig'ish (exe)", `bb|${id}`)]]) } : {}) }).catch(() => {});
      }
      return toast(ctx, cut(said.text, 190), said.ok ? undefined : { show_alert: true });
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
    // Egasining shaxsiy Telegram'iga yozgan do'st yoki qarindosh — «bemor emas» (E13, inbox/personal.ts). Faqat egasi bosadi:
    // karta va yozishma o'chadi, keyingi xabarlari tushmaydi; «Qaytarish» — keyingi xabaridan yana bemor
    if (code === 'np' || code === 'nu') {
      if (!ownerBiz) return toast(ctx, 'Buni faqat klinika egasi belgilaydi');
      if (code === 'nu') {
        personalChats.remove(biz.id, id);
        if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, "Qaytarildi — bu odam keyingi safar yozsa, bemor sifatida tushadi", { show_alert: true });
      }
      const lead = leads.get(biz.id, id);
      if (!lead?.tgUserId || !canMarkPersonal(lead)) return toast(ctx, 'Bu tugma eskirgan');
      personalChats.add(biz.id, lead.tgUserId);
      waiting.remove(biz.id, lead.id);
      forgetLead(biz.id, lead.id);
      const who = esc(lead.name || (lead.username ? `@${lead.username}` : 'Bu odam'));
      if (msg) {
        await tg.editMessageText(ctx.chat!.id, msg.message_id, undefined,
          `🙅 <b>${who}</b> — bemor emas deb belgilandi.\nKartasi va yozishmasi o'chirildi; uning Telegram'ingizdagi xabarlari endi Palantir'ga tushmaydi.`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [undoPersonalRow(lead.tgUserId)] } }).catch(ignoreUnchanged).catch(() => {});
      }
      return toast(ctx, 'Belgilandi — bemorlar ro\'yxatidan olindi');
    }
    // Rekruter (hr/recruit.ts), faqat egasi: hp — vakansiyani kanalga, hc — yopish, hi — nomzodni suhbatga, hr — rad etish
    // (nomzodga xabar faqat shu tugma bilan ketadi)
    if (code === 'hp' || code === 'hc' || code === 'hi' || code === 'hr') {
      if (!ownerBiz) return toast(ctx, 'Buni faqat klinika egasi hal qiladi');
      try {
        if (code === 'hp') {
          await postVacancy(biz, id);
          return toast(ctx, 'Kanalga joylandi', { show_alert: true });
        }
        if (code === 'hc') {
          if (!vacancies.close(biz.id, id)) return toast(ctx, 'Allaqachon yopilgan');
          if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
          return toast(ctx, "Vakansiya yopildi — yangi nomzodlar qabul qilinmaydi", { show_alert: true });
        }
        const said = await decideCandidate(biz, id, code === 'hi');
        if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        if (msg) await sendHtml(String(ctx.chat!.id), `${code === 'hi' ? '📞' : '✖️'} ${esc(said)}`).catch(() => {});
        return toast(ctx, code === 'hi' ? 'Nomzodga taklif ketdi' : 'Rad etildi');
      } catch (e) {
        return toast(ctx, e instanceof HrError ? e.message : `Bajarilmadi: ${(e as Error).message}`, { show_alert: true });
      }
    }
    // Ish bo'yicha yozgan (yetkazib beruvchi, hamkor) — Kotib (inbox/workChats.ts). Faqat egasi: bemorlar ro'yxatidan olinadi,
    // AI javob bermaydi, egasi javob bermasa — eslatadi. wd — «javob shart emas», wu — qaytarish (keyingi xabaridan yana bemor)
    if (code === 'nw' || code === 'wd' || code === 'wu') {
      if (!ownerBiz) return toast(ctx, 'Buni faqat klinika egasi belgilaydi');
      if (code === 'wd') {
        workChats.answered(biz.id, id);
        return toast(ctx, "Belgilandi — bu xabar uchun boshqa eslatmayman");
      }
      if (code === 'wu') {
        workChats.remove(biz.id, id);
        if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, "Qaytarildi — bu odam keyingi safar yozsa, bemor sifatida tushadi", { show_alert: true });
      }
      const lead = leads.get(biz.id, id);
      if (!lead?.tgUserId || !canMarkPersonal(lead)) return toast(ctx, 'Bu tugma eskirgan');
      // Egasi hali javob bermagan xabar — kuzatuv shundan boshlanadi
      const last = inbox.last(biz.id, lead.id);
      const name = lead.name || (lead.username ? `@${lead.username}` : '');
      workChats.add(biz.id, lead.tgUserId, name, last?.direction === 'in' ? { text: last.text, at: last.createdAt } : null);
      waiting.remove(biz.id, lead.id);
      forgetLead(biz.id, lead.id);
      if (msg) {
        await tg.editMessageText(ctx.chat!.id, msg.message_id, undefined,
          `🤝 <b>${esc(name || 'Bu odam')}</b> — ish bo'yicha deb belgilandi (bemor emas).\nUnga AI javob bermaydi. Siz ${REMIND_HOURS} soat ichida Telegram'ingizdan javob bermasangiz — eslataman; kechki xabarda ham «javob kutayotganlar» bo'ladi.`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [undoWorkRow(lead.tgUserId)] } }).catch(ignoreUnchanged).catch(() => {});
      }
      return toast(ctx, "Belgilandi — ish bo'yicha");
    }
    if (code === 'jy') {
      if (id !== biz.id) return toast(ctx, 'Bu tugma eskirgan');
      businesses.closeSupport(biz.id);
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, 'Palantir jamoasi kirishi yopildi', { show_alert: true });
    }

    // Instagram posti (Kontent-meyker): joylash (fonda — Instagram sekin bo'lishi mumkin) yoki bekor qilish
    if (code === 'gp' || code === 'gx') {
      if (code === 'gx') {
        try { cancelPost(biz, id); } catch (e) { return toast(ctx, (e as Error).message, { show_alert: true }); }
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, 'Bekor qilindi');
      }
      const p = posts.get(biz.id, id);
      const stop: Partial<Record<string, string>> = {
        published: 'Allaqachon joylangan', cancelled: 'Bekor qilingan', publishing: 'Joylanyapti…', drawing: 'Rasm hali chizilmoqda',
        unknown: "Oldingi urinish natijasi noma'lum — Instagram'da tekshiring, keyin panel → Kontent-meyker → Postlar",
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
      // Ertalabki xabarda kun rejasining tugmalari ham bor: faqat Direktor qatorlari yangilanadi
      const current = (ctx.callbackQuery?.message as { reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] } } | undefined)?.reply_markup?.inline_keyboard ?? [];
      await ctx.editMessageReplyMarkup({ inline_keyboard: mergeKeyboard(current, r.keyboard) }).catch(() => {});
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

    // Targetolog Meta MCP orqali: pul sarflaydigan amalni egasi tasdiqlaydi (fonda — Meta bir necha so'rov), bekor qiladi; yoqilganini to'xtatadi
    if (code === 'ta' || code === 'tz' || code === 'tq') {
      if (code === 'tz' || code === 'tq') {
        try {
          if (code === 'tz') cancelMcpAction(biz, id);
          else await pauseTrackedByOwner(biz, id);
        } catch (e) {
          if (!(e instanceof TargetError)) console.error('[targetolog] tugma:', e);
          return toast(ctx, e instanceof TargetError ? e.message : 'Ichki xato', { show_alert: true });
        }
        await ctx.editMessageReplyMarkup(undefined).catch(() => {});
        return toast(ctx, code === 'tz' ? 'Bekor qilindi' : "To'xtatildi ⏸");
      }
      await toast(ctx, 'Meta’da bajarilmoqda…');
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      detach('reklama amali', async () => {
        try { await approveMcpAction(biz, id); } catch (e) {
          await tg.sendMessage(biz.ownerChatId!, `⚠️ Bajarilmadi: ${e instanceof TargetError ? e.message : 'ichki xato'}`).catch(() => {});
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
      return sendHtml(biz.ownerChatId!, `🔁 <b>Qaytarish kerak (${list.length})</b>\nAdministrator qo'ng'iroq qilib, ko'rikka taklif qilsin:\n${lines.join('\n')}${more}`);
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

    // Ruxsatlar jadvali (permissions.ts): «So'rasin» turgan ish — faqat egasi hal qiladi; «Ha» — Palantir o'zi bajaradi
    if ((code === APPROVE_CODE || code === REJECT_CODE) && ownerBiz) {
      if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      const yes = code === APPROVE_CODE;
      // Tugma darhol javob oladi (bajarish bir necha soniya olishi mumkin), natija — alohida xabar bilan
      await toast(ctx, yes ? 'Bajaryapman…' : 'Mayli, bajarmayman');
      // Bajarish (hujjat, video…) uzoq bo'lishi mumkin: bot boshqa xabarlarni kutib qolmasin — fonda
      const chat = String(ctx.chat!.id), replyTo = msg ? { reply_parameters: { message_id: msg.message_id } } : {};
      return detach("ruxsat tasdig'i", async () => {
        const done = await decideApproval(biz.id, id, yes);
        // Limit tufayli bajarilmadi — tasdiq yana kutyapti: tugmalar qaytadi
        await ctx.reply(done.text, { ...replyTo, ...(done.retry ? { reply_markup: approvalKeyboard(id) } : {}) }).catch(() => {});
        await sendArtifacts(biz, chat, done.artifacts).catch(e => console.error('[ruxsat] natija:', (e as Error).message));
      });
    }
    // AI administrator avtonomiyasi (inbox/autonomy.ts): egasi «o'zi javob bersin»ga o'tkazadi yoki hozircha qoldiradi — faqat egasi
    if (code === OFFER_CODE && ownerBiz) {
      if (id === 'on') {
        const cur = businesses.byId(biz.id)!;
        const autoReply = { ...DEFAULT_REPLY, ...cur.profile.autoReply, mode: 'auto' as const, chosenAt: new Date().toISOString() };
        businesses.update(biz.id, { profile: { ...cur.profile, autoReply } });
      }
      if (msg) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return toast(ctx, id === 'on' ? "✅ Endi AI administrator mijozlarga o'zi javob beradi" : 'Mayli — javoblarni siz tasdiqlaysiz', { show_alert: id === 'on' });
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
