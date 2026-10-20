/**
 * Cerebro boti (bitta bot — hamma bizneslar uchun).
 *
 * Egasi:   /start o-<kod> (paneldagi havola) → ulanadi. Keyin yozadi yoki ovozli
 *          xabar yuboradi — yordamchi bajaradi. Hujjat — .docx fayl; mijozlarga xabar — «Yuborish» tugmasi bilan.
 *          Egasi yuborgan fayl (PDF, Word, Excel) o'qilib, bilimga taklif bo'ladi — tugmalar bilan hal qilinadi.
 *          Eslatma vaqti kelsa — «Bajarildi / Keyinroq» tugmalari bilan xabar.
 * Mijoz:   havola /start l-<biznes>[-<post>] → raqamini yoki savolini yuboradi →
 *          egasiga boradi. Egasi shu xabarga «Reply» qilsa — javob mijozga ketadi.
 * Kanal:   bot kanalga admin qilib qo'shilsa, egasining kanaliga ulanadi.
 */
import { Markup, Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { Artifact, Lang, MoneyEntry, MoneyStatus, Outbound, Task } from '../src/types';
import { isMedical } from '../src/lib/compliance';
import { addDays, dueLabel, iso, stamp } from '../src/lib/week';
import { ask, resetConversation } from './agent';
import { cancelEntry, confirmEntry, entryView, undoEntry } from './crm/actions';
import { crmConnected } from './crm/index';
import { INTERVIEW_START, interviewOption, interviewReply, interviewSkip, interviewStart, interviewStop, type InterviewTurn } from './brain/interview';
import { containsSecret } from '../src/lib/secrets';
import { DAY_OUTCOME, askOutcome, dropOutcome, takeOutcome, wantsOutcome } from './outcome';
import { recallPatients } from './crm/index';
import { patientName } from './crm/logic';
import { fileKeyboard, settleFile, settleSuggestion } from './brain/learn';
import { businesses, cameras, chatLog, inbox, leads, moneyEntries, outbound, relays, replies, tasks, type BusinessRow, type LeadRow } from './db';
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
import { actorOf, setTeamOutlet } from './requests/index';
import { replyCards } from './requests/store';
import { linkStaff, listOpen, requestButton, requestReply, staffText, teamOutlet } from './requests/telegram';
import { MAX_LOOK_CAMERAS, lookAt, lookRequest, shotCaption } from './camera/ask';
import { events } from './orders/store';
import { approveReply, clearBotOutlets, dismissReply, notifyOwner, onIncoming, ownerWrites, registerSender, replySettings, sendToLead, setOwnerOutlet } from './inbox/core';

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

const langOf = (b: BusinessRow): Lang => b.profile.contentLang ?? 'uz';
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const personName = (l: Pick<LeadRow, 'name' | 'username' | 'phone'>) => l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';

/** Yordamchi javobi (oddiy Markdown) → Telegram HTML */
export function tgHtml(md: string): string {
  return md.split('\n').map(line => {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    let s = esc(h ? h[1] : line);
    s = s.replace(/^(\s*)[-*]\s+/, '$1• ');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`);
    return h ? `<b>${s}</b>` : s;
  }).join('\n');
}

/** Uzun matn Telegram chegarasiga (4096) bo'linadi — xatboshi bo'yicha */
function chunks(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split('\n')) {
    if (cur && cur.length + para.length + 1 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${para}` : para.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

const b = Markup.button.callback;
type Btn = ReturnType<typeof b>;
const kb = (rows: Btn[][]): InlineKeyboardMarkup => Markup.inlineKeyboard(rows).reply_markup;

function followupText(o: Outbound, biz: BusinessRow): string {
  const all = o.leadIds.map(id => leads.get(biz.id, id)).filter((l): l is LeadRow => !!l);
  const offline = all.filter(l => !l.reachable);
  const lines = [
    `<b>✉️ Mijozlarga xabar</b> — ${o.reachable ? `${o.reachable} kishiga Telegram orqali boradi` : "Telegram orqali hech kimga yetib bo'lmaydi"}:`,
    '',
    `<i>${esc(cut(o.text, 2500))}</i>`,
  ];
  if (offline.length) {
    lines.push('', `📞 Qo'ng'iroq qilish kerak (${offline.length}):`, ...offline.slice(0, 15).map(l => `• ${esc(personName(l))}${l.phone ? ` — ${esc(l.phone)}` : ''}`));
    if (offline.length > 15) lines.push(`… yana ${offline.length - 15} ta`);
  }
  if (o.status === 'sent') lines.push('', `✅ Yuborildi: ${o.sentCount} ta`);
  if (o.status === 'cancelled') lines.push('', '✖️ Bekor qilindi');
  return lines.join('\n');
}
const followupKeyboard = (o: Outbound) => (o.status !== 'draft' ? undefined : kb([[
  ...(o.reachable ? [b(`✅ Yuborish (${o.reachable})`, `fs|${o.id}`)] : []),
  b('✖️ Bekor qilish', `fc|${o.id}`),
]]));

const MONEY_STATE: Record<MoneyStatus, string> = {
  draft: "<i>Tekshiring. Tasdiqlasangiz — DentaCRM'ga yoziladi. Buni so'ramagan bo'lsangiz — «Bekor qilish».</i>", running: '⏳ Yozilmoqda…', done: "✅ DentaCRM'ga yozildi", cancelled: '✖️ Bekor qilindi',
  failed: '⚠️ Yozilmadi', unknown: "❓ Yozilgan-yozilmagani noma'lum — DentaCRM'da tekshiring", undone: "↩️ Ortga qaytarildi (CRM'dan o'chirildi)",
};
const moneyText = (e: MoneyEntry): string =>
  [`<b>💰 ${esc(e.title)}</b>`, ...e.details.map(esc), '', MONEY_STATE[e.status], ...(e.note ? [`ℹ️ ${esc(e.note)}`] : [])].join('\n');
const moneyKeyboard = (e: MoneyEntry) => (e.status === 'draft' ? kb([[b('✅ Tasdiqlash', `ma|${e.id}`), b('✖️ Bekor qilish', `mx|${e.id}`)]])
  : e.canUndo ? kb([[b('↩️ Ortga qaytarish', `mu|${e.id}`)]]) : undefined);

const reminderText = (t: Task, note = '') =>
  [`⏰ <b>${esc(t.title)}</b>`, t.notes ? esc(t.notes) : '', note].filter(Boolean).join('\n');
const reminderKeyboard = (t: Task) => kb([[b('✅ Bajarildi', `td|${t.id}`), b('⏰ 1 soatdan keyin', `ts|${t.id}`), b('📅 Ertaga', `tt|${t.id}`)]]);

/** Telegram "xabar o'zgarmadi" xatosi — muammo emas */
const ignoreUnchanged = (e: unknown) => {
  if (!String((e as Error)?.message).includes('message is not modified')) throw e;
};

/**
 * Uzoq ish (AI, ovoz, ko'p mijozga yuborish) fonda: Telegraf keyingi xabarlarni
 * oldingilari tugamaguncha olmaydi — bitta egasining javobi boshqa bizneslarni kutdirmasin.
 * Bitta biznesning gaplari baribir navbat bilan ishlanadi (agent.ts).
 */
const detach = (what: string, work: () => Promise<unknown>) => {
  void work().catch(e => console.error(`[bot] ${what}:`, (e as Error)?.message ?? e));
};

/**
 * Tugma bosilishiga javob (ekrandagi qisqa ogohlantirish). Eskirgan bosishga Telegram javobni rad etadi —
 * bu xato asosiy ishni to'xtatmasligi kerak (xabar yuborilmay yoki karta yangilanmay qolardi)
 */
const toast = (ctx: { answerCbQuery: (text?: string, extra?: { show_alert?: boolean }) => Promise<unknown> }, text?: string, extra?: { show_alert?: boolean }): Promise<unknown> =>
  ctx.answerCbQuery(text, extra).catch(e => { console.error('[bot] tugma javobi:', (e as Error).message); });

/** Telegram javob bermasa qayta ulanish oralig'i: 5 soniyadan boshlab ikki baravar o'sadi, ko'pi bilan bir daqiqa */
const RETRY_MIN_MS = 5_000, RETRY_MAX_MS = 60_000;

/** Yordam matni: misollar biznesga mos (klinika — qabul va to'lov, qolganlar — mijoz va savdo); ovoz — faqat ovoz xizmati sozlangan bo'lsa */
function helpFor(biz: BusinessRow): string {
  const clinic = isMedical(biz.profile.industry) || crmConnected(biz.id);
  const examples = clinic
    ? [
      '• «Bugun nechta bemor yozilgan, tushum qancha?»',
      "• «Ertaga soat 10 da laboratoriyaga qo'ng'iroq qilishni eslat»",
      "• «Kamola Tursunova 300 ming to'ladi»",
      '• «Ertaga Rustamovda bo\'sh vaqt bormi?»',
    ]
    : [
      "• «Ertaga soat 10 da Aziz akaga qo'ng'iroq qilishni eslat»",
      "• «Aziz Karimov, +998 90 123 45 67, demo so'radi — mijozlarga qo'sh, payshanba eslat»",
      '• «Kecha yozganlarga javob tayyorla»',
      '• «Tabassum klinikasiga tijorat taklifi tayyorla»',
    ];
  return [
    `Men — Cerebro, biznesingiz uchun AI yordamchi. Oddiy gapiring${voiceEnabled() ? ' yoki ovozli xabar yuboring' : ''}. Masalan:`,
    '',
    ...examples,
    "• Narxnoma yoki shartnoma namunasini fayl qilib yuboring (PDF, Word, Excel) — o'qib, bilimga qo'shaman",
    '• «Bugun nima qilishim kerak?»',
    '',
    ...(cameras.list(biz.id).length ? ["/kamera — kameralardan hozirgi rasm (savol bilan: «/kamera qabulxonada kim bor»)"] : []),
    '/vazifalar — ochiq vazifalar',
    "/savollar — mijozlar ko'p so'raydigan savollarni birma-bir so'rayman, javobingizni eslab qolaman",
    '/yangi — yangi suhbat (oldingisini unutadi, vazifa va mijozlar qoladi)',
  ].join('\n');
}

export function createBot(): BotService {
  if (!env.botToken) {
    // Token olib tashlangan bo'lsa — oldingi botning yuborish yo'llari ham yopiladi
    clearBotOutlets();
    setTeamOutlet(null);
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
      await ctx.reply("🔒 Bu xabarda maxfiy kalit (token, parol bilan manzil) bor — uni hech qayerga saqlamadim va yordamchiga bermadim. Kalitlarni klinika kompyuteridagi panelga, «Ulash» sahifasiga kiriting.");
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
    if (previous && previous !== chat) {
      await tg.sendMessage(previous, "⚠️ Cerebro boshqa Telegram akkauntiga ulandi va endi shu yerda ishlamaydi. Buni siz qilmagan bo'lsangiz — panel → «Telegram» bo'limidagi yangi havola orqali qayta ulaning (o'sha zahoti begona akkaunt uziladi) va havolani hech kimga bermang.").catch(() => {});
    }
    const name = biz.profile.ownerName ? `, ${biz.profile.ownerName}` : '';
    await ctx.reply(`✅ Ulandi: «${biz.profile.name}». Assalomu alaykum${name}!\n\n${helpFor(businesses.byId(biz.id) ?? biz)}`);
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
      // Rasm yoki fayl: egasiga asl nusxasi (Cerebro rasmni o'qimaydi)
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
      : "Assalomu alaykum! Bu Cerebro — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.");
  });

  bot.help(async ctx => {
    const biz = ownerOf(ctx);
    await ctx.reply(biz ? helpFor(biz) : 'Bu Cerebro — biznes uchun AI yordamchi. Ulanish: panel → «Telegram».');
  });

  // Mijoz: raqam tugmasi qayta (tugma bir martalik). Klinikada o'z qabulini yozishmada ko'rish uchun raqam shu tugma bilan tasdiqlanadi
  bot.command(['raqam', 'nomer'], async ctx => {
    if (ctx.chat.type !== 'private' || ownerOf(ctx)) return;
    await ctx.reply("Raqamingizni pastdagi tugma bilan yuboring.\nОтправьте номер кнопкой ниже.", contactKeyboard);
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
      const prompt = `Customer id ${lead.id} has had no contact for a while and has no next step. Look at them with list_leads (lead_id), then prepare a short, warm follow-up message with draft_followup and set the next step with update_lead. If Cerebro cannot message them, write in two sentences what I should say when I phone them.`;
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

    // Birinchi kun suhbati: «o'tkazib yuborish» (aynan shu savol hali so'ralayotgan bo'lsa) yoki «to'xtatish»
    if (code === 'iv') {
      const option = /^o:(\d+):(.+)$/.exec(id);
      const turn = option ? interviewOption(biz, option[2], Number(option[1]))
        : id.startsWith('s:') ? interviewSkip(biz, id.slice(2)) : id === 'x' ? interviewStop(biz) : null;
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
      return ctx.reply("🔒 Xabaringizda maxfiy kalit (token, parol bilan manzil) bor edi — uni chatdan o'chirdim va hech qayerga saqlamadim. Kalitlarni Telegram'ga yozmang: ularni klinika kompyuteridagi panelga, «Ulash» sahifasiga kiriting.");
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
    await ctx.reply("Assalomu alaykum! Bu Cerebro — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.");
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
        await sendToLead(biz, l, o.text, 'cerebro');
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
    async edit(biz, messageId, html) {
      if (!biz.ownerChatId) return;
      await tg.editMessageText(biz.ownerChatId, messageId, undefined, html, { parse_mode: 'HTML' }).catch(ignoreUnchanged);
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
                { command: 'yangi', description: 'Yangi suhbat' },
                { command: 'help', description: 'Nima qila olaman' },
              ]).catch(() => {});
              // Xabar olish to'xtamaguncha shu yerda turadi; uzilsa — pastda sababi yoziladi va qayta boshlanadi
              await bot.launch({ dropPendingUpdates: false, allowedUpdates: ['message', 'callback_query', 'my_chat_member'] });
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

/** Qaytarish ro'yxatida Telegram'ga shuncha bemor chiqadi (qolgani — DentaCRM'da) */
const RECALL_SHOWN = 40;

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
