/**
 * Palantir boti (bitta bot — hamma bizneslar uchun).
 *
 * Egasi:   /start o-<kod> (paneldagi havola) → ulanadi. Keyin yozadi yoki ovozli
 *          xabar yuboradi — yordamchi bajaradi. Hujjat — .docx fayl; mijozlarga xabar — «Yuborish» tugmasi bilan.
 *          Egasi yuborgan fayl (PDF, Word, Excel) o'qilib, bilimga taklif bo'ladi — tugmalar bilan hal qilinadi.
 *          Eslatma vaqti kelsa — «Bajarildi / Keyinroq» tugmalari bilan xabar.
 * Mijoz:   havola /start l-<biznes>[-<post>] → raqamini yoki savolini yuboradi →
 *          egasiga boradi. Egasi shu xabarga «Reply» qilsa — javob mijozga ketadi.
 * Kanal:   bot kanalga admin qilib qo'shilsa, egasining kanaliga ulanadi.
 */
import { basename } from 'node:path';
import { Markup, Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Artifact, Task } from '../src/types';
import { dueLabel, iso, stamp } from '../src/lib/week';
import { ask, resetConversation } from './agent';
import { entryView } from './crm/actions';
import { crmConnected } from './crm/index';
import { INTERVIEW_START, interviewPending, interviewReply, interviewStart, type InterviewTurn } from './brain/interview';
import { containsSecret } from '../src/lib/secrets';
import { takeOutcome } from './outcome';
import { fileKeyboard } from './brain/learn';
import { businesses, cameras, chatLog, inbox, leads, outbound, relays, replies, tasks, type BusinessRow, type LeadRow } from './db';
import { moneyEntries } from './crm/moneyStore';
import { FileError, MAX_FILE_BYTES, intakeText, takeFile } from './intake/index';
import { docFileName, markdownToDocx } from './docx';
import { env, voiceEnabled } from './env';
import { SilenceError, transcribe } from './stt';
import { MAX_PHOTO_BYTES, describePhoto, photoMessage } from './vision';
import { reviewCall } from './callreview';
import { diagnostics, sendDiagnostics } from './diagnostics';
import { toOgg } from './tts';
import { phoneChanged } from './people';
import { proofFor } from './personRules';
import { setTeamOutlet } from './requests/index';
import { replyCards } from './requests/store';
import { linkStaff, listOpen, requestReply, staffText, teamOutlet } from './requests/telegram';
import { MAX_LOOK_CAMERAS, lookAt, lookRequest, shotCaption } from './camera/ask';
import { events } from './orders/store';
import { remoteUrl } from './remote';
import { ComputerError, openLoginWindow, runningJob, stopJob } from './computer/jobs';
import { BUSINESS_UPDATES, onBusinessConnection, onBusinessMessage, startTelegramBusiness, type BusinessConnection, type BusinessMessage } from './inbox/telegramBusiness';
import { clearBotOutlets, onIncoming, ownerWrites, registerSender, replySettings, sendToLead, setOwnerOutlet } from './inbox/core';
import { registerButtons } from './botButtons';
import { ContentError, setChannelOutlet } from './content/factory';
import { RETRY_MAX_MS, RETRY_MIN_MS, b, chunks, cut, detach, esc, followupKeyboard, followupText, helpFor, ignoreUnchanged, kb, langOf, moneyKeyboard, moneyText, personName, reminderKeyboard, reminderText, tgHtml, type Btn } from './botKit';

export interface BotService {
  enabled: boolean;
  username: () => string | null;
  start(): Promise<void>;
  stop(): void;
  /** Mijozlarga xabarni yuboradi (egasi tasdiqlagach) */
  sendFollowup(biz: BusinessRow, outboundId: string): Promise<{ sent: number; failed: number }>;
  cancelFollowup(biz: BusinessRow, outboundId: string): Promise<void>;
  remindTask(biz: BusinessRow, task: Task): Promise<void>;
  /** buttons — xabar ostidagi tugmalar (kunlik reja: «xabar tayyorla», «ro'yxat») */
  sendText(chatId: string, html: string, buttons?: { text: string; data: string }[][]): Promise<void>;
  /** Ovozli xabar (OGG/Opus) yoki — ffmpeg bo'lmasa — audio fayl (WAV) */
  sendVoice(chatId: string, audio: { ogg: Buffer } | { wav: Buffer }, caption: string): Promise<void>;
  /** Pul yozuvi kartasini hozirgi holatga keltiradi (panelda tasdiqlangan bo'lsa ham Telegramdagi tugma yo'qoladi) */
  refreshMoney(bizId: string, id: string): Promise<void>;
  /** Yordamchi javobi (matn va hujjat, rasm kabi narsalari) egasining Telegram'iga — telefon qo'ng'irog'ida so'ralgan ish natijasi */
  deliverReply(biz: BusinessRow, text: string, artifacts: Artifact[]): Promise<void>;
  /** Birinchi kun suhbatini egasining Telegram'ida boshlaydi (ulash ustasi «Egasidan so'rash»): bo'shliqlar, keyin tayyor savollar */
  startInterview(biz: BusinessRow): Promise<void>;
  /** Ertalabki tayyorgarlik: yordamchi topshiriqni bajaradi (mijozlarga xabar qoralamalari), natijasi egasiga keladi. display — jurnalda */
  prepareDay(biz: BusinessRow, prompt: string, display: string): Promise<void>;
}

export function createBot(): BotService {
  if (!env.botToken) {
    // Token olib tashlangan bo'lsa — oldingi botning yuborish yo'llari ham yopiladi
    clearBotOutlets();
    setTeamOutlet(null);
    setChannelOutlet(null);
    const off = () => Promise.reject(new Error("Telegram bot ulanmagan (BOT_TOKEN yo'q)"));
    return {
      enabled: false, username: () => null, start: async () => {}, stop: () => {},
      sendFollowup: off, cancelFollowup: off, remindTask: async () => {}, sendText: async () => {}, sendVoice: async () => {}, refreshMoney: async () => {},
      deliverReply: off,
      startInterview: off, prepareDay: async () => {},
    };
  }

  const bot = new Telegraf(env.botToken, {
    handlerTimeout: 600_000,
    ...(env.telegramApiRoot ? { telegram: { apiRoot: env.telegramApiRoot } } : {}),
  });
  const tg = bot.telegram;
  let username: string | null = null;
  let stopped = false;

  // ─── Yetkazish: yordamchi javobi va narsalari ─────────────────────────────
  async function sendArtifact(biz: BusinessRow, chat: string, a: Artifact): Promise<void> {
    if (a.type === 'document') {
      const buf = await markdownToDocx(a.doc.title, a.doc.markdown, biz.profile, a.doc.kind);
      await tg.sendDocument(chat, { source: buf, filename: docFileName(a.doc.title) }, { caption: `📄 ${cut(a.doc.title, 200)}` });
    } else if (a.type === 'outbound') {
      const o = outbound.get(biz.id, a.outbound.id) ?? a.outbound;
      const msg = await tg.sendMessage(chat, followupText(o, biz), { parse_mode: 'HTML', reply_markup: followupKeyboard(o) });
      outbound.setOwnerMessage(biz.id, o.id, msg.message_id);
    } else if (a.type === 'money') {
      const row = moneyEntries.get(biz.id, a.entry.id);
      const e = row ? entryView(row) : a.entry;
      const msg = await tg.sendMessage(chat, moneyText(e), { parse_mode: 'HTML', reply_markup: moneyKeyboard(e) });
      moneyEntries.setOwnerMessage(biz.id, e.id, msg.message_id);
    } else if (a.type === 'camera') {
      const image = a.shot.eventId ? events.image(biz.id, a.shot.eventId) : null;
      if (image) await tg.sendPhoto(chat, { source: image, filename: 'kadr.jpg' }, { caption: shotCaption(a.shot) });
      else await tg.sendMessage(chat, shotCaption(a.shot));
    }
    // Vazifa — javob matnida aytiladi, alohida xabar kerak emas
  }

  async function sendHtml(chat: string, html: string, buttons?: { text: string; data: string }[][]) {
    const parts = chunks(html);
    for (const [n, part] of parts.entries()) {
      // Tugmalar oxirgi bo'lak ostida
      const markup = buttons?.length && n === parts.length - 1 ? { reply_markup: kb(buttons.map(row => row.map(x => b(x.text, x.data)))) } : {};
      await tg.sendMessage(chat, part, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup }).catch(async e => {
        // HTML buzilgan bo'lsa (kutilmagan belgi) — oddiy matn sifatida
        if (!String((e as Error).message).includes("can't parse entities")) throw e;
        await tg.sendMessage(chat, part.replace(/<[^>]+>/g, ''), { link_preview_options: { is_disabled: true }, ...markup });
      });
    }
  }

  /** Egasining gapi → yordamchi → javob va narsalar */
  /** Birinchi kun suhbatining navbati: savol (tugmalar bilan) yoki yakun */
  async function sendInterview(biz: BusinessRow, turn: InterviewTurn): Promise<void> {
    chatLog.add(biz.id, 'telegram', 'assistant', turn.text);
    const options = (turn.open && turn.asking ? turn.options ?? [] : []).map((o, i) => [b(o, `iv|o:${i}:${turn.asking}`)]);
    const keyboard = turn.open && turn.asking ? kb([...options, [b("⏭ O'tkazib yuborish", `iv|s:${turn.asking}`), b("⏹ To'xtatish", 'iv|x')]]) : undefined;
    await tg.sendMessage(biz.ownerChatId!, turn.text, keyboard ? { reply_markup: keyboard } : {});
  }

  async function handleOwner(ctx: Context, biz: BusinessRow, text: string, voice = false, extra: { display?: string; photo?: boolean } = {}) {
    // Ovozdan o'girilgan matn yoki rasm izohida ham kalit bo'lishi mumkin: modelga, jurnalga va bilimga ketmaydi
    if (containsSecret(text)) {
      await ctx.reply("🔒 Bu xabarda maxfiy kalit (token, parol bilan manzil) bor — uni hech qayerga saqlamadim va yordamchiga bermadim. Kalitlarni Palantir o'rnatilgan kompyuterdagi panelga, «Ulash» sahifasiga kiriting.");
      return;
    }
    // Birinchi kun suhbati ochiq bo'lsa (yoki egasi «savollar» desa) — gap javob deb olinadi va yordamchiga ketmaydi. Rasm tavsifi javob emas
    // Tugmadan kelgan buyruq (display bilan) ham javob emas: u egasining gapi emas, yordamchiga topshiriq
    const turn = extra.photo || extra.display ? null : INTERVIEW_START.test(text.trim()) ? interviewStart(biz) : interviewReply(biz, text);
    if (turn) {
      chatLog.add(biz.id, 'telegram', 'owner', voice ? `🎙 ${text}` : text);
      return sendInterview(biz, turn);
    }
    const chat = String(ctx.chat!.id);
    const typing = setInterval(() => { void ctx.sendChatAction('typing').catch(() => {}); }, 4500);
    void ctx.sendChatAction('typing').catch(() => {});
    try {
      // Vazifa natijasi so'ralgan edi: gap shu vazifa haqida ekani yordamchiga aytiladi (jurnalda — egasining o'z gapi)
      const outcome = extra.photo || extra.display ? null : takeOutcome(businesses.byId(biz.id) ?? biz, text);
      const reply = await ask(biz.id, 'telegram', outcome ?? text, { voice, ...extra, ...(outcome ? { display: voice ? `🎙 ${text}` : text } : {}) });
      await deliver(biz, chat, reply, voice ? `🎙 <i>${esc(cut(text, 500))}</i>\n\n` : '');
    } finally {
      clearInterval(typing);
    }
  }

  /** Yordamchi javobi va narsalari (xabar qoralamasi «Yuborish» tugmasi bilan, hujjat…) egasiga */
  async function deliver(biz: BusinessRow, chat: string, reply: { text: string; artifacts: Artifact[] }, head = ''): Promise<void> {
    await sendHtml(chat, head + tgHtml(reply.text));
    const fresh = businesses.byId(biz.id) ?? biz;
    for (const a of reply.artifacts) {
      await sendArtifact(fresh, chat, a).catch(e => {
        console.error('[bot] yetkazilmadi:', a.type, (e as Error).message);
        return tg.sendMessage(chat, `⚠️ ${a.type === 'document' ? 'Hujjat' : a.type === 'camera' ? 'Kamera kadri' : 'Xabar'} yuborilmadi — panelda ko'ring.`).catch(() => {});
      });
    }
  }

  // ─── Egasi: ulanish ────────────────────────────────────────────────────────
  /** Egasining chatidagi «Panel» tugmasi — Telegram Mini App (panel hub orqali, remote.ts). Masofadan kirish yo'q bo'lsa — oddiy menyu */
  const panelButton = (chat: string) => {
    const url = remoteUrl();
    const menuButton = url?.startsWith('https://') ? { type: 'web_app' as const, text: 'Panel', web_app: { url } } : { type: 'default' as const };
    return tg.setChatMenuButton({ chatId: Number(chat), menuButton }).catch(e => console.error('[bot] «Panel» tugmasi:', (e as Error).message));
  };

  async function linkOwner(ctx: Context, code: string) {
    const biz = businesses.byLinkCode(code);
    if (!biz || !biz.active) {
      // Havola bir martalik: ulangan egasi uni qayta bossa (Telegram «Start»ni eski havola bilan yuboradi) — bu xato emas
      const own = ownerOf(ctx);
      await ctx.reply(own ? `«${own.profile.name}» bilan ulangansiz — hammasi joyida.\n\n${helpFor(own)}` : "Havola noto'g'ri yoki eskirgan. Panel → «Telegram» bo'limidan yangisini oling.");
      return;
    }
    const chat = String(ctx.chat!.id);
    const previous = biz.ownerChatId;
    // Egasining chati — tugmalar (pul yozuvi, javob yuborish) uchun ishonch manbai. Havola bir martalik: ulangach kod almashadi,
    // eski havolani ko'rgan odam keyin ulana olmaydi; yangi havola faqat panelda (parol bilan) ko'rinadi
    businesses.update(biz.id, { ownerChatId: chat, linkCode: businesses.newLinkCode() });
    void panelButton(chat);
    if (previous && previous !== chat) {
      void tg.setChatMenuButton({ chatId: Number(previous), menuButton: { type: 'default' } }).catch(() => {});
      await tg.sendMessage(previous, "⚠️ Palantir boshqa Telegram akkauntiga ulandi va endi shu yerda ishlamaydi. Buni siz qilmagan bo'lsangiz — panel → «Telegram» bo'limidagi yangi havola orqali qayta ulaning (o'sha zahoti begona akkaunt uziladi) va havolani hech kimga bermang.").catch(() => {});
    }
    const name = biz.profile.ownerName ? `, ${biz.profile.ownerName}` : '';
    const fresh = businesses.byId(biz.id) ?? biz;
    await ctx.reply(`✅ Ulandi: «${biz.profile.name}». Assalomu alaykum${name}!\n\n${helpFor(fresh)}`);
    // Birinchi ulanishda tanishuv taklif qilinadi (anketa to'ldirilmagan bo'lsa ham ma'lumot shu yerda yig'iladi).
    // O'zi boshlanmaydi: ochiq suhbat egasining keyingi topshirig'ini javob deb olib qo'yardi — bitta tugma yetadi
    const pending = previous ? 0 : interviewPending(fresh);
    if (pending) {
      await ctx.reply(
        `Mijozlarga to'g'ri javob berishim uchun biznesingiz bilan tanishib olay: ${pending} ta qisqa savol (manzil, ish vaqti, narxlar va mijozlar ko'p so'raydigan narsalar). Javob oddiy gap yoki ovoz bilan, istalgan payt to'xtatasiz.\n\nNarxlar ro'yxati Excel, PDF yoki Word faylda bo'lsa — shu yerga yuboring: o'qib, saqlashni taklif qilaman.`,
        { reply_markup: kb([[b('▶️ Tanishishni boshlash', 'iv|go')], [b('Keyinroq («savollar» deb yozasiz)', 'iv|later')]]) },
      );
    }
  }

  // ─── Mijoz: havola, raqam, savol ───────────────────────────────────────────
  const contactKeyboard = Markup.keyboard([Markup.button.contactRequest('📞 Raqamni yuborish / Отправить номер')]).oneTime().resize();
  /** Mijozga "yetkazildi" javobi soatiga bir marta (har xabarga emas) */
  const acked = new Map<string, number>();

  async function leadStart(ctx: Context, bizId: string) {
    const biz = businesses.byId(bizId);
    if (!biz || !biz.active) {
      await ctx.reply('Havola eskirgan. / Ссылка устарела.');
      return;
    }
    const from = ctx.from!;
    leads.fromTelegram(biz.id, String(from.id), [from.first_name, from.last_name].filter(Boolean).join(' ') || null, from.username ?? null, 'Telegram havola', null);
    await ctx.reply([
      `Assalomu alaykum! 👋 «${biz.profile.name}» bilan bog'lanish uchun telefon raqamingizni yuboring yoki savolingizni shu yerga yozing.`,
      '',
      `Здравствуйте! Чтобы связаться с «${biz.profile.name}», отправьте номер телефона или напишите вопрос здесь.`,
    ].join('\n'), contactKeyboard);
  }

  /** Mijoz xabarini egasiga yetkazadi; egasi "Reply" qilsa — javob mijozga boradi */
  async function toOwner(biz: BusinessRow, lead: LeadRow, html: string, copyFrom?: { chat: number; message: number }) {
    if (!biz.ownerChatId) return;
    const head = await tg.sendMessage(biz.ownerChatId, `${html}\n\n<i>↩️ Javob berish uchun shu xabarga «Reply» qiling.</i>`, { parse_mode: 'HTML' });
    relays.add(biz.ownerChatId, head.message_id, lead.id);
    if (copyFrom) {
      const copy = await tg.copyMessage(biz.ownerChatId, copyFrom.chat, copyFrom.message);
      relays.add(biz.ownerChatId, copy.message_id, lead.id);
    }
  }

  async function customerMessage(ctx: Context, lead: LeadRow, text: string | null) {
    const biz = businesses.byId(lead.businessId);
    if (!biz?.active) return;
    const from = ctx.from!;
    if (text) {
      onIncoming(biz, {
        channel: 'bot',
        person: { tgUserId: String(from.id), name: [from.first_name, from.last_name].filter(Boolean).join(' ') || null, username: from.username ?? null },
        text, extId: `b${ctx.message!.message_id}`, source: lead.source ?? 'Telegram havola',
      });
    } else {
      // Rasm yoki fayl: egasiga asl nusxasi (Palantir rasmni o'qimaydi)
      inbox.add(biz.id, { leadId: lead.id, channel: 'bot', direction: 'in', by: 'customer', text: '[rasm yoki fayl]', extId: `b${ctx.message!.message_id}` });
      const who = `${esc(personName(lead))}${lead.username && lead.name ? ` (@${esc(lead.username)})` : ''}${lead.phone ? ` · ${esc(lead.phone)}` : ''}`;
      await toOwner(biz, lead, `💬 <b>${who}</b> yubordi:`, { chat: ctx.chat!.id, message: ctx.message!.message_id });
    }
    // "O'zi javob bersin" rejimida javobning o'zi keladi; qolganida — yetkazilgani haqida (soatiga bir marta)
    if (replySettings(biz).mode === 'auto' && text) return;
    const last = acked.get(lead.id) ?? 0;
    if (Date.now() - last > 3600_000) {
      acked.set(lead.id, Date.now());
      await ctx.reply(`Xabaringiz «${biz.profile.name}»ga yetkazildi ✅ Tez orada javob beramiz.\nСообщение передано, скоро ответим.`);
    }
  }

  // ─── Buyruqlar ─────────────────────────────────────────────────────────────
  const ownerOf = (ctx: Context) => (ctx.chat?.type === 'private' ? businesses.byOwnerChat(String(ctx.chat.id)) : undefined);

  // Telegram Business (Bot API 7.2): Telegraf 4.16 bu yangilanishlarni tanimaydi — xom holda, boshqa ishlovchilardan oldin
  bot.use(async (ctx, next) => {
    const u = ctx.update as { business_connection?: BusinessConnection; business_message?: BusinessMessage };
    if (u.business_connection) return onBusinessConnection(u.business_connection, tg);
    if (u.business_message) return onBusinessMessage(u.business_message);
    return next();
  });

  bot.start(async ctx => {
    if (ctx.chat.type !== 'private') return;
    const payload = ctx.payload?.trim() ?? '';
    if (payload.startsWith('o-')) return linkOwner(ctx, payload.slice(2));
    if (payload.startsWith('s-')) return linkStaff(ctx, payload.slice(2));
    if (payload.startsWith('l-')) {
      // Eski post havolalari (l-<biznes>-<post>) ham ishlaydi: post qismi e'tiborga olinmaydi
      const [, bizId] = payload.split('-');
      return leadStart(ctx, bizId);
    }
    const biz = ownerOf(ctx);
    await ctx.reply(biz
      ? `«${biz.profile.name}» ulangan.\n\n${helpFor(biz)}`
      : "Assalomu alaykum! Bu Palantir — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.");
  });

  bot.help(async ctx => {
    const biz = ownerOf(ctx);
    await ctx.reply(biz ? helpFor(biz) : 'Bu Palantir — biznes uchun AI yordamchi. Ulanish: panel → «Telegram».');
  });

  // Mijoz: raqam tugmasi qayta (tugma bir martalik). Klinikada o'z qabulini yozishmada ko'rish uchun raqam shu tugma bilan tasdiqlanadi
  bot.command(['raqam', 'nomer'], async ctx => {
    if (ctx.chat.type !== 'private' || ownerOf(ctx)) return;
    await ctx.reply("Raqamingizni pastdagi tugma bilan yuboring.\nОтправьте номер кнопкой ниже.", contactKeyboard);
  });

  // Panelni telefondan ochish (Telegram Mini App, hub orqali)
  bot.command('panel', async ctx => {
    if (!ownerOf(ctx)) return;
    const url = remoteUrl();
    if (!url?.startsWith('https://')) return ctx.reply("Masofadan kirish sozlanmagan: Palantir o'rnatilgan kompyuterda Hub kodi kerak. Hozircha panel faqat o'sha kompyuterda ochiladi.");
    return ctx.reply("Panel — shu yerda, telefoningizda:", Markup.inlineKeyboard([Markup.button.webApp('📊 Panelni ochish', url)]));
  });

  // Kompyuterdagi ishni to'xtatish (yordamchi brauzerda yoki ekranda ishlayotgan bo'lsa)
  bot.command('toxta', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    const job = runningJob(biz.id);
    if (!job || !stopJob(biz.id)) return ctx.reply("Hozir kompyuterda ish bajarilmayapti.");
    await ctx.reply("⏹ To'xtatyapman…");
  });

  // Brauzer oynasi: egasi saytlarga o'zi kirib oladi (parolni AI ko'rmaydi), keyin yordamchi o'sha saytlarda ishlay oladi
  bot.command('brauzer', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    const arg = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
    try {
      const text = await openLoginWindow(biz, arg || null);
      await ctx.reply(text, Markup.inlineKeyboard([Markup.button.callback('✅ Kirdim, yopish', `cl|${biz.id}`)]));
    } catch (e) {
      await ctx.reply(e instanceof ComputerError ? e.message : `⚠️ Brauzer ochilmadi: ${(e as Error).message}`);
    }
  });

  bot.command('yangi', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    resetConversation(biz.id);
    await ctx.reply('🆕 Yangi suhbat. Vazifalar, mijozlar va eslab qolganlarim joyida.');
  });

  bot.command('savollar', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    chatLog.add(biz.id, 'telegram', 'owner', '/savollar');
    await sendInterview(biz, interviewStart(biz));
  });

  // So'rovlar (qo'ng'iroq qilish, qabul, shikoyat): egasi ham, qabulxona xodimi ham
  bot.command(['sorovlar', 'zayavki'], async ctx => {
    if (ctx.chat.type === 'private') await listOpen(ctx);
  });

  // Kameralardan hozirgi rasm: «/kamera Zal» — bitta kamera; «/kamera qabulxonada kim bor» — kadrga qarab javob (AI ko'zi)
  bot.command(['kamera', 'camera'], async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    if (!cameras.list(biz.id).length) return ctx.reply("Kamera ulanmagan. Panel → «Kameralar» bo'limida qo'shing.");
    const { list, question } = lookRequest(biz.id, ctx.payload?.slice(0, 300) ?? null);
    const chat = String(ctx.chat.id);
    await tg.sendChatAction(chat, 'upload_photo').catch(() => {});
    for (const l of await lookAt(biz, list, question)) {
      if (l.image) await tg.sendPhoto(chat, { source: l.image, filename: 'kadr.jpg' }, { caption: shotCaption(l.shot) });
      else await tg.sendMessage(chat, shotCaption(l.shot));
    }
    if (list.length > MAX_LOOK_CAMERAS) await ctx.reply(`Bir so'rovda ${MAX_LOOK_CAMERAS} ta kamera ko'rsatiladi. Qolganini nomi bilan so'rang: /kamera ${list[MAX_LOOK_CAMERAS].name}`);
  });

  // Diagnostika: sotuvchi so'raganda egasi yozadi — hubga; hub kodi bo'lmasa fayl bo'lib shu chatga (sotuvchiga uzatish uchun)
  bot.command(['diagnostika', 'diag'], async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    try {
      const file = await sendDiagnostics();
      if (file) return void await ctx.reply(`🩺 Diagnostika sotuvchiga yuborildi (${file}).`);
      const d = diagnostics();
      await tg.sendDocument(String(ctx.chat.id), { source: Buffer.from(d.text), filename: d.name }, { caption: '🩺 Diagnostika — shu faylni sotuvchiga yuboring' });
    } catch (e) {
      await ctx.reply(`Diagnostika yuborilmadi: ${(e as Error).message}`);
    }
  });

  bot.command('vazifalar', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    const open = tasks.list(biz.id, 'open', 20);
    if (!open.length) return ctx.reply("Ochiq vazifa yo'q ✨");
    const now = new Date();
    const nowStamp = stamp(now);
    const rows: Btn[][] = [];
    open.forEach((t, i) => {
      if (i % 5 === 0) rows.push([]);
      rows[rows.length - 1].push(b(`✅ ${i + 1}`, `td|${t.id}`));
    });
    await ctx.reply([
      '<b>Ochiq vazifalar</b>',
      ...open.map((t, i) => `${i + 1}. ${t.dueAt && t.dueAt < nowStamp ? '🔴 ' : ''}${esc(t.title)}${t.dueAt ? ` — <i>${dueLabel('uz', t.dueAt, now)}</i>` : ''}`),
      '',
      'Bajarilganini belgilash uchun raqamini bosing:',
    ].join('\n'), { parse_mode: 'HTML', reply_markup: kb(rows) });
  });

  // ─── Tugmalar (botButtons.ts) ─────────────────────────────────────────────────
  registerButtons(bot, { handleOwner, sendHtml, sendInterview, refreshMoney, sendFollowup, cancelFollowup });

  // ─── Xabarlar ──────────────────────────────────────────────────────────────
  bot.on(message('contact'), async ctx => {
    if (ctx.chat.type !== 'private') return;
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply("Iltimos, o'zingizning raqamingizni pastdagi tugma orqali yuboring.", contactKeyboard);
    }
    const lead = leads.latestForUser(String(ctx.from.id));
    const biz = lead && businesses.byId(lead.businessId);
    if (!lead || !biz) return ctx.reply("Qaysi biznes bilan bog'lanmoqchisiz? Havolani qayta bosing.", Markup.removeKeyboard());
    const phone = contact.phone_number.startsWith('+') ? contact.phone_number : `+${contact.phone_number}`;
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || lead.name;
    // Tugma bilan yuborilgan o'z raqami (user_id — yuboruvchining o'zi) Telegram tasdiqlagan; kontaktlardan ulashilgan karta — tasdiq emas
    const own = contact.user_id === ctx.from.id;
    leads.update(biz.id, lead.id, { phone, name, phoneProof: own ? proofFor(String(ctx.from.id), phone) : null });
    // Shu raqam bilan Instagram'da yoki qo'ng'iroqda kelgan karta bo'lsa — bitta odam, bitta karta
    const updated = phoneChanged(biz, lead.id)!;
    await ctx.reply(own && crmConnected(biz.id)
      ? "Rahmat! ✅ Raqamingiz tasdiqlandi — savolingizni yozing, qabulingiz haqida ham.\nСпасибо! Номер подтверждён — напишите вопрос, в том числе о вашей записи."
      : "Rahmat! ✅ Tez orada bog'lanamiz.\nСпасибо! Скоро свяжемся.", Markup.removeKeyboard());
    await toOwner(biz, updated, [
      '🆕 <b>Yangi mijoz</b>',
      `👤 ${esc(personName(updated))}${updated.username ? ` (@${esc(updated.username)})` : ''}`,
      `📞 ${esc(phone)}`,
      updated.source ? `📌 ${esc(updated.source)}` : '',
    ].filter(Boolean).join('\n')).catch(e => console.error('[bot] egasiga xabar:', (e as Error).message));
  });

  bot.on(message('voice'), async ctx => {
    if (ctx.chat.type !== 'private') return;
    const biz = ownerOf(ctx);
    if (!biz) {
      const lead = leads.latestForUser(String(ctx.from.id));
      if (lead) await customerMessage(ctx, lead, null);
      return;
    }
    if (!voiceEnabled()) return ctx.reply("Ovozli xabar hozircha o'chiq (serverda ovoz xizmati kaliti yo'q). Matn bilan yozing.");
    const voice = ctx.message.voice;
    if (voice.duration > 300) return ctx.reply('Ovozli xabar 5 daqiqadan oshmasin.');
    detach('ovozli xabar', async () => {
      let text: string;
      try {
        void ctx.sendChatAction('typing').catch(() => {});
        const link = await tg.getFileLink(voice.file_id);
        const res = await fetch(link);
        if (!res.ok) throw new Error(`fayl yuklanmadi (${res.status})`);
        const vocab = [
          biz.profile.name, biz.profile.ownerName, ...biz.profile.offerings.map(o => o.name), ...biz.profile.team.map(m => m.name),
          ...leads.list(biz.id, 'all', undefined, 60).map(l => l.name ?? ''),
        ].filter(Boolean);
        text = await transcribe(Buffer.from(await res.arrayBuffer()), voice.mime_type || 'audio/ogg', langOf(biz), vocab);
      } catch (e) {
        if (e instanceof SilenceError) return ctx.reply('🎙 Hech narsa eshitilmadi. Qayta yuboring.');
        console.error('[ovoz]', (e as Error).message);
        return ctx.reply("🎙 Ovozni tanib bo'lmadi. Qayta yuboring yoki matn bilan yozing.");
      }
      return handleOwner(ctx, biz, text, true);
    });
  });

  bot.on(message('text'), async ctx => {
    if (ctx.chat.type !== 'private') return;
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text.trim();
    const biz = businesses.byOwnerChat(chatId);
    if (biz && containsSecret(text)) {
      // Egasi token yoki kalitni botga yozib yubordi: xabar chatdan o'chiriladi, modelga, jurnalga va bilimga tushmaydi
      await ctx.deleteMessage().catch(() => {});
      return ctx.reply("🔒 Xabaringizda maxfiy kalit (token, parol bilan manzil) bor edi — uni chatdan o'chirdim va hech qayerga saqlamadim. Kalitlarni Telegram'ga yozmang: ularni Palantir o'rnatilgan kompyuterdagi panelga, «Ulash» sahifasiga kiriting.");
    }
    if (biz) {
      // Mijoz xabariga "Reply" — javob mijozga ketadi
      const replyTo = ctx.message.reply_to_message?.message_id;
      // So'rov kartasiga «Reply» — natija (mijozga ketmaydi)
      const noted = await requestReply(chatId, replyTo, text);
      if (noted) return ctx.reply(noted);
      const leadId = replyTo ? relays.leadFor(chatId, replyTo) : undefined;
      if (leadId) {
        const lead = leads.get(biz.id, leadId);
        if (!lead) return ctx.reply('Mijoz topilmadi.');
        try {
          // Qaysi kartaga «Reply» qilingani ma'lum: o'sha tayyor javob o'rniga yozilgan bo'lsa — tuzatish sifatida o'rganiladi
          await ownerWrites(biz, lead, text, replyCards.byMessage(chatId, replyTo!) ?? replies.byOwnerMessage(biz.id, replyTo!)?.id);
          return ctx.reply(`✅ ${personName(lead)}ga yuborildi.`);
        } catch (e) {
          return ctx.reply(`⚠️ Yuborilmadi: ${(e as Error).message}`);
        }
      }
      return detach('javob', () => handleOwner(ctx, biz, text));
    }
    // Qabulxona xodimi: yordamchi bilan gaplashmaydi, faqat so'rovlar
    if (await staffText(ctx, text)) return;
    const lead = leads.latestForUser(String(ctx.from.id));
    if (lead) return customerMessage(ctx, lead, text);
    await ctx.reply("Assalomu alaykum! Bu Palantir — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.");
  });

  // Mijoz rasm yoki fayl yuborsa — egasiga nusxasi
  const forwardMedia = async (ctx: Context) => {
    if (ctx.chat?.type !== 'private' || ownerOf(ctx) || !ctx.from) return;
    const lead = leads.latestForUser(String(ctx.from.id));
    if (lead) await customerMessage(ctx, lead, null);
  };
  /** Kuniga ko'riladigan rasmlar soni cheklangan: har bir rasm — ikkita AI so'rovi (egasining hisobidan) */
  const photoDays = new Map<string, { day: string; count: number }>();
  const photoAllowed = (bizId: string): boolean => {
    const today = iso(new Date());
    const used = photoDays.get(bizId)?.day === today ? photoDays.get(bizId)!.count : 0;
    if (used >= env.aiDailyPhotos) return false;
    photoDays.set(bizId, { day: today, count: used + 1 });
    return true;
  };

  // Egasi rasm yubordi (chek, hujjat, kabinet): avval rasm matnga aylanadi, keyin yordamchi odatdagidek ishlaydi
  bot.on(message('photo'), async ctx => {
    const biz = ctx.chat.type === 'private' ? ownerOf(ctx) : undefined;
    if (!biz) return forwardMedia(ctx);
    if (!env.aiEnabled) return ctx.reply("AI o'chiq — rasmni ko'ra olmayman.");
    const photo = ctx.message.photo.filter(p => (p.file_size ?? 0) <= MAX_PHOTO_BYTES).at(-1);
    if (!photo) return ctx.reply('Rasm juda katta — kichikroq qilib yuboring.');
    if (!photoAllowed(biz.id)) return ctx.reply(`Bugun ${env.aiDailyPhotos} ta rasm ko'rib chiqildi — bugunga shu yetarli (har bir rasm AI xarajati). Ertaga davom etamiz yoki matn bilan yozing.`);
    const caption = (ctx.message.caption ?? '').trim().slice(0, 1000);
    detach('rasm', async () => {
      let seen: string;
      try {
        void ctx.sendChatAction('typing').catch(() => {});
        const res = await fetch(await tg.getFileLink(photo.file_id), { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`fayl yuklanmadi (${res.status})`);
        seen = await describePhoto(biz.id, Buffer.from(await res.arrayBuffer()), caption);
      } catch (e) {
        console.error('[rasm]', (e as Error).message);
        return ctx.reply("📷 Rasmni ko'ra olmadim. Qayta yuboring yoki matn bilan yozing.");
      }
      await handleOwner(ctx, biz, photoMessage(caption, seen), false, { display: `📷 ${caption || 'Rasm'}`, photo: true });
    });
  });
  // ─── Qo'ng'iroq yozuvi: egasi audio tashladi → matn (kim nima dedi) va tahlil ─────
  /** Telegram bot yuklab beradigan fayl chegarasi */
  const MAX_RECORDING_BYTES = 20 * 1024 * 1024;
  const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|ogg|oga|opus|wav|flac|webm|amr|awb|3gp|3gpp)$/i;
  const MIME_BY_EXT: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };
  async function callRecording(ctx: Context, biz: BusinessRow, file: { id: string; name: string; mime: string; size: number }) {
    if (!voiceEnabled()) return ctx.reply("Yozuvni tinglash uchun ovoz xizmati kerak (serverda kaliti yo'q).");
    if (file.size > MAX_RECORDING_BYTES) return ctx.reply("📞 Yozuv 20 MB dan katta — Telegram bunday faylni botga bermaydi. Qisqaroq yoki siqilgan (mp3, m4a) qilib yuboring.");
    await ctx.reply("📞 Qo'ng'iroq yozuvi qabul qilindi — tinglab, tahlil qilyapman (1–3 daqiqa).");
    detach("qo'ng'iroq yozuvi", async () => {
      try {
        const res = await fetch(await tg.getFileLink(file.id), { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`fayl yuklanmadi (${res.status})`);
        let audio: Buffer = Buffer.from(await res.arrayBuffer()), mime = file.mime;
        // Telefon yozuvchilarining AMR/3GP formatini nutq xizmatlari qabul qilmaydi — OGG ga aylantiriladi
        if (/amr|awb|3gp/i.test(`${file.name} ${file.mime}`)) {
          const ogg = await toOgg(audio);
          if (!ogg) return ctx.reply("📞 Bu formatni o'qib bo'lmadi (kompyuterda ffmpeg kerak). mp3 yoki m4a qilib yuboring.");
          audio = ogg;
          mime = 'audio/ogg';
        }
        const r = await reviewCall(biz, audio, mime);
        chatLog.add(biz.id, 'telegram', 'owner', `📞 Qo'ng'iroq yozuvi: ${file.name}`);
        chatLog.add(biz.id, 'telegram', 'assistant', r.review);
        await ctx.reply(r.review);
        await tg.sendDocument(String(ctx.chat!.id), { source: Buffer.from(r.transcript, 'utf8'), filename: 'suhbat-matni.txt' },
          { caption: r.speakers ? "Suhbat matni: «1-ovoz», «2-ovoz» — gapiruvchilar (avtomatik ajratilgan)" : 'Suhbat matni (avtomatik)' });
      } catch (e) {
        if (e instanceof SilenceError) return ctx.reply("📞 Yozuvda gap eshitilmadi.");
        console.error("[qo'ng'iroq yozuvi]", (e as Error).message);
        return ctx.reply(`📞 Yozuvni tahlil qilib bo'lmadi: ${(e as Error).message.slice(0, 150)}`);
      }
    });
  }
  const audioMime = (name: string, mime?: string) => (mime && mime.startsWith('audio/') ? mime : MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/mpeg');

  bot.on(message('audio'), async ctx => {
    const biz = ctx.chat.type === 'private' ? ownerOf(ctx) : undefined;
    if (!biz) return forwardMedia(ctx);
    const a = ctx.message.audio;
    const name = (a.file_name ?? 'yozuv.mp3').slice(0, 200);
    return callRecording(ctx, biz, { id: a.file_id, name, mime: audioMime(name, a.mime_type), size: a.file_size ?? 0 });
  });

  // Egasi fayl tashladi (narxnoma, shartnoma namunasi, yo'riqnoma) → o'qiladi va bilimga taklif bo'lib tushadi. Mijozning fayli egasiga uzatiladi
  bot.on(message('document'), async ctx => {
    const biz = ctx.chat.type === 'private' ? ownerOf(ctx) : undefined;
    if (!biz) return forwardMedia(ctx);
    const doc = ctx.message.document;
    const name = (doc.file_name ?? 'fayl').slice(0, 200);
    // Audio fayl hujjat bo'lib kelsa (telefon yozuvi) — qo'ng'iroq tahlili
    if (doc.mime_type?.startsWith('audio/') || AUDIO_EXT.test(name)) {
      return callRecording(ctx, biz, { id: doc.file_id, name, mime: audioMime(name, doc.mime_type), size: doc.file_size ?? 0 });
    }
    if ((doc.file_size ?? 0) > MAX_FILE_BYTES) return ctx.reply(`📎 Fayl ${MAX_FILE_BYTES / 1024 / 1024} MB dan katta — kichikroq qilib yuboring.`);
    detach('fayl', async () => {
      try {
        void ctx.sendChatAction('typing').catch(() => {});
        const res = await fetch(await tg.getFileLink(doc.file_id), { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`fayl yuklanmadi (${res.status})`);
        const taken = await takeFile(biz, name, Buffer.from(await res.arrayBuffer()));
        const text = intakeText(taken);
        chatLog.add(biz.id, 'telegram', 'owner', `📎 ${taken.label}`);
        chatLog.add(biz.id, 'telegram', 'assistant', text);
        await ctx.reply(text, { reply_markup: fileKeyboard(taken.suggestion.id, taken.prices) });
      } catch (e) {
        if (!(e instanceof FileError)) console.error('[fayl]', (e as Error).message);
        await ctx.reply(e instanceof FileError ? `📎 ${e.message}` : "📎 Faylni o'qiy olmadim. Qayta yuboring.");
      }
    });
  });

  bot.catch((err, ctx) => console.error(`[bot] ${ctx.updateType} xatosi:`, (err as Error)?.message ?? err));

  // ─── Tashqi amallar (panel ham chaqiradi) ──────────────────────────────────
  async function refreshMoney(bizId: string, id: string) {
    const biz = businesses.byId(bizId);
    const row = moneyEntries.get(bizId, id);
    if (!biz?.ownerChatId || !row?.ownerMessageId) return;
    const e = entryView(row);
    await tg.editMessageText(biz.ownerChatId, row.ownerMessageId, undefined, moneyText(e), { parse_mode: 'HTML', reply_markup: moneyKeyboard(e) })
      .catch(ignoreUnchanged).catch(err => console.error('[bot] pul yozuvi:', (err as Error).message));
  }

  async function refreshFollowup(bizId: string, id: string) {
    const biz = businesses.byId(bizId);
    const o = outbound.get(bizId, id);
    if (!biz?.ownerChatId || !o?.ownerMessageId) return;
    await tg.editMessageText(biz.ownerChatId, o.ownerMessageId, undefined, followupText(o, biz), { parse_mode: 'HTML', reply_markup: followupKeyboard(o) })
      .catch(ignoreUnchanged).catch(e => console.error('[bot] xabar:', (e as Error).message));
  }

  async function sendFollowup(biz: BusinessRow, id: string): Promise<{ sent: number; failed: number }> {
    const o = outbound.get(biz.id, id);
    if (!o) throw new Error('Xabar topilmadi');
    // Avval holat o'zgaradi — ikki marta bosilsa ham bir marta ketadi
    if (!outbound.finish(biz.id, id, 'sent', 0)) throw new Error(o.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bekor qilingan');
    let sent = 0;
    let failed = 0;
    for (const lid of o.leadIds) {
      const l = leads.get(biz.id, lid);
      if (!l?.reachable) continue;
      try {
        await sendToLead(biz, l, o.text, 'palantir');
        sent++;
      } catch (e) {
        failed++;
        console.warn('[bot] mijozga yetmadi:', l.id, (e as Error).message);
      }
      await new Promise(r => setTimeout(r, 40));
    }
    outbound.setSentCount(biz.id, id, sent);
    await refreshFollowup(biz.id, id);
    return { sent, failed };
  }

  async function cancelFollowup(biz: BusinessRow, id: string): Promise<void> {
    const o = outbound.get(biz.id, id);
    if (!o) throw new Error('Xabar topilmadi');
    if (!outbound.finish(biz.id, id, 'cancelled')) throw new Error(o.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bekor qilingan');
    await refreshFollowup(biz.id, id);
  }

  startTelegramBusiness(tg);
  registerSender('bot', {
    can: (_biz, lead) => lead.botStarted && !!lead.tgUserId,
    async send(_biz, lead, text) {
      const m = await tg.sendMessage(lead.tgUserId!, text);
      return `b${m.message_id}`;
    },
  });
  setTeamOutlet(teamOutlet(tg));
  setOwnerOutlet({
    async notify(biz, html, keyboard) {
      if (!biz.ownerChatId) return null;
      const m = await tg.sendMessage(biz.ownerChatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard });
      return m.message_id;
    },
    async edit(biz, messageId, html, keyboard) {
      if (!biz.ownerChatId) return;
      await tg.editMessageText(biz.ownerChatId, messageId, undefined, html, { parse_mode: 'HTML', reply_markup: keyboard }).catch(ignoreUnchanged);
    },
    async sendFile(biz, path, caption) {
      if (!biz.ownerChatId) return;
      await tg.sendDocument(biz.ownerChatId, { source: path, filename: basename(path) }, { caption: cut(caption, 1000) });
    },
    async sendPhoto(biz, photo, html, keyboard) {
      if (!biz.ownerChatId) return null;
      const source = typeof photo === 'string' ? { source: photo } : { source: photo, filename: 'kadr.jpg' };
      const m = await tg.sendPhoto(biz.ownerChatId, source, { caption: html, parse_mode: 'HTML', reply_markup: keyboard });
      return m.message_id;
    },
  });
  // Kontent-meyker: egasining kanali (bot kanalda admin, «Xabar joylash» huquqi bilan)
  setChannelOutlet({
    async resolve(target) {
      const chat = await tg.getChat(target).catch(() => null);
      if (!chat) throw new ContentError(`${target} topilmadi — kanal nomini tekshiring (yopiq kanal bo'lsa, botni admin qilib, kanal ID'sini yozing)`);
      if (chat.type !== 'channel') throw new ContentError('Bu kanal emas — Telegram kanal havolasini yozing');
      const me = await tg.getMe();
      const member = await tg.getChatMember(chat.id, me.id).catch(() => null);
      const canPost = member?.status === 'administrator' && member.can_post_messages === true;
      if (!canPost) throw new ContentError(`Botni (@${me.username}) kanalga admin qiling va «Xabar joylash» huquqini bering, keyin qayta ulang`);
      return { id: String(chat.id), title: chat.title, username: 'username' in chat && chat.username ? chat.username : null };
    },
    async post(chatId, text) {
      const m = await tg.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
      return m.message_id;
    },
    async postVideo(chatId, file, caption) {
      const m = await tg.sendVideo(chatId, { source: file }, { caption, supports_streaming: true });
      return m.message_id;
    },
  });

  return {
    enabled: true,
    refreshMoney,
    username: () => username,
    /**
     * Botni ishga tushiradi va ishlab turishini ta'minlaydi. Qaytadi: bot tanilganda (Telegram birinchi marta javob berganda).
     * Telegram javob bermasa (kompyuter internetsiz yongan) yoki xabar olish uzilib qolsa (shu token bilan boshqa joyda ikkinchi nusxa
     * ishga tushgan — 409) — tobora uzoqroq kutib qayta uriniladi. Faqat token noto'g'ri bo'lsa (401) to'xtaydi: uni qayta urinish tuzatmaydi.
     */
    start() {
      return new Promise<void>(known => {
        void (async () => {
          for (let wait = RETRY_MIN_MS; !stopped; wait = Math.min(wait * 2, RETRY_MAX_MS)) {
            try {
              username = (await tg.getMe()).username;
              known();
              await tg.setMyCommands([
                { command: 'vazifalar', description: 'Ochiq vazifalar' },
                { command: 'kamera', description: 'Kameralardan hozirgi rasm' },
                { command: 'panel', description: 'Panelni ochish' },
                { command: 'yangi', description: 'Yangi suhbat' },
                ...(env.computerUse ? [{ command: 'toxta', description: "Kompyuterdagi ishni to'xtatish" }] : []),
                ...(env.computerUse === 'browser' || env.computerUse === 'all' ? [{ command: 'brauzer', description: 'Saytga o\'zim kiraman (parol bilan)' }] : []),
                { command: 'help', description: 'Nima qila olaman' },
              ]).catch(() => {});
              // Ulangan egalarga «Panel» tugmasi (hub manzili o'zgargan yoki masofadan kirish endi yoqilgan bo'lishi mumkin)
              if (remoteUrl()?.startsWith('https://')) for (const b of businesses.all()) if (b.active && b.ownerChatId) await panelButton(b.ownerChatId);
              // Xabar olish to'xtamaguncha shu yerda turadi; uzilsa — pastda sababi yoziladi va qayta boshlanadi
              await bot.launch({ dropPendingUpdates: false, allowedUpdates: ['message', 'callback_query', 'my_chat_member', ...BUSINESS_UPDATES] });
              if (stopped) return;
              wait = RETRY_MIN_MS;
            } catch (e) {
              const code = (e as { response?: { error_code?: number } }).response?.error_code;
              if (code === 401) {
                console.error("[bot] BOT_TOKEN noto'g'ri yoki bekor qilingan — bot o'chiq. Tokenni tuzatib, qayta ishga tushiring");
                return known();
              }
              console.error(`[bot] ${code === 409 ? 'shu token bilan boshqa nusxa ishlayapti (bitta token — bitta kompyuter)' : `Telegram'ga ulanib bo'lmadi: ${(e as Error).message}`} — ${Math.round(wait / 1000)} soniyadan keyin qayta uriniladi`);
            }
            await new Promise(r => setTimeout(r, wait));
          }
        })();
      });
    },
    stop: () => {
      stopped = true;
      try { bot.stop(); } catch { /* ishlamayotgan bo'lsa */ }
    },
    sendFollowup,
    cancelFollowup,
    async remindTask(biz, t) {
      if (!biz.ownerChatId) return;
      await tg.sendMessage(biz.ownerChatId, reminderText(t), { parse_mode: 'HTML', reply_markup: reminderKeyboard(t) });
    },
    sendText: (chatId, html, buttons) => sendHtml(chatId, html, buttons),
    async deliverReply(biz, text, artifacts) {
      if (!biz.ownerChatId) throw new Error("Egasi Telegram'da ulanmagan");
      const chat = biz.ownerChatId;
      await sendHtml(chat, `📞 ${tgHtml(text)}`);
      for (const a of artifacts) await sendArtifact(biz, chat, a);
    },
    async prepareDay(biz, prompt, display) {
      if (!biz.ownerChatId) return;
      const reply = await ask(biz.id, 'telegram', prompt, { display });
      await deliver(biz, biz.ownerChatId, reply);
    },
    async startInterview(biz) {
      if (!biz.ownerChatId) throw new Error("Egasi hali Telegram'ni ulamagan — avval ulash havolasini bossin");
      await sendInterview(biz, interviewStart(biz));
    },
    async sendVoice(chatId, audio, caption) {
      if ('ogg' in audio) await tg.sendVoice(chatId, { source: audio.ogg, filename: 'eslatma.ogg' }, { caption, parse_mode: 'HTML' });
      else await tg.sendAudio(chatId, { source: audio.wav, filename: 'eslatma.wav' }, { caption, parse_mode: 'HTML' });
    },
  };
}

/** Yangi bot Telegram'da tanilishini shuncha kutamiz (javob bermasa ham kalit saqlanadi — bot fonda ulanadi) */
const SWAP_WAIT_MS = 5_000;

/**
 * Tokeni almashtirsa bo'ladigan bot. Panel, jadval va kanallar shu obyektni ushlab turadi; ichidagi bot esa ulash ustasida
 * yangi BOT_TOKEN kiritilganda qayta yaratiladi — server to'xtamaydi. Eski bot xabar olishni to'xtatadi, yangisi boshlaydi
 */
export function swappableBot(make: () => BotService = createBot): BotService & { reload: () => Promise<void> } {
  let current = make();
  const reload = async (): Promise<void> => {
    current.stop();
    current = make();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([current.start(), new Promise(r => { timer = setTimeout(r, SWAP_WAIT_MS); })]);
    clearTimeout(timer);
  };
  return new Proxy({} as BotService & { reload: () => Promise<void> }, {
    get: (_t, prop) => (prop === 'reload' ? reload : Reflect.get(current, prop)),
  });
}
