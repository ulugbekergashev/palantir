/**
 * Cerebro boti (bitta bot — hamma bizneslar uchun).
 *
 * Egasi:   /start o-<kod> (paneldagi havola) → ulanadi. Keyin yozadi yoki ovozli
 *          xabar yuboradi — yordamchi bajaradi. Hujjat — .docx fayl, post — rasm
 *          va «Kanalga joylash» tugmasi, mijozlarga xabar — «Yuborish» tugmasi.
 *          Eslatma vaqti kelsa — «Bajarildi / Keyinroq» tugmalari bilan xabar.
 * Mijoz:   havola /start l-<biznes>[-<post>] → raqamini yoki savolini yuboradi →
 *          egasiga boradi. Egasi shu xabarga «Reply» qilsa — javob mijozga ketadi.
 * Kanal:   bot kanalga admin qilib qo'shilsa, egasining kanaliga ulanadi.
 */
import { Markup, Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { Artifact, Lang, Outbound, Post, Task } from '../src/types';
import { addDays, dueLabel, iso, stamp } from '../src/lib/week';
import { ask, resetConversation } from './agent';
import { businesses, inbox, leads, outbound, posts, relays, tasks, type BusinessRow, type LeadRow } from './db';
import { docFileName, markdownToDocx } from './docx';
import { env, voiceEnabled } from './env';
import { renderPng } from './render';
import { SilenceError, transcribe } from './stt';
import { approveReply, dismissReply, onIncoming, ownerWrites, registerSender, replySettings, sendToLead, setOwnerOutlet } from './inbox/core';

export interface BotService {
  enabled: boolean;
  username: () => string | null;
  start(): Promise<void>;
  stop(): void;
  /** Postni kanalga joylaydi (egasi tasdiqlagach). Xato bo'lsa — tushunarli matn bilan Error */
  publishPost(biz: BusinessRow, postId: string): Promise<void>;
  /** Mijozlarga xabarni yuboradi (egasi tasdiqlagach) */
  sendFollowup(biz: BusinessRow, outboundId: string): Promise<{ sent: number; failed: number }>;
  cancelFollowup(biz: BusinessRow, outboundId: string): Promise<void>;
  remindTask(biz: BusinessRow, task: Task): Promise<void>;
  sendText(chatId: string, html: string): Promise<void>;
  verifyChannel(ref: string): Promise<{ id: string; title: string }>;
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

function postCaption(p: Post, biz: BusinessRow): string {
  const lang = langOf(biz);
  const status = p.status === 'published'
    ? (p.inChannel ? '✅ Kanalga joylandi' : '✅ Joylandi')
    : p.status === 'deleted' ? "🗑 O'chirildi"
      : p.item.kind === 'story' ? "Storis: rasmni saqlab, Instagram storisga qo'ying."
        : biz.channelId ? `Tasdiqlasangiz, «${esc(biz.channelTitle ?? 'kanal')}»ga joylanadi.` : "Kanal ulanmagan — rasmni o'zingiz joylang yoki panelda kanalni ulang.";
  const head = `${p.item.kind === 'story' ? '📲 Storis' : '🖼 Post'} — ${esc(p.item.design[lang].title)}`;
  const room = 1024 - head.length - status.length - 8;
  return `<b>${head}</b>\n\n${esc(cut(p.item.caption[lang], room))}\n\n${status}`;
}
const postKeyboard = (p: Post, biz: BusinessRow) => (p.status !== 'draft' ? undefined : kb([[
  ...(biz.channelId && p.item.kind === 'post' ? [b('📢 Kanalga joylash', `pp|${p.id}`)] : []),
  b("🗑 O'chirish", `pd|${p.id}`),
]]));

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

const HELP = [
  'Men — Cerebro, biznesingiz uchun AI yordamchi. Oddiy gapiring yoki ovozli xabar yuboring. Masalan:',
  '',
  "• «Ertaga soat 10 da yetkazib beruvchiga qo'ng'iroq qilishni eslat»",
  "• «Aziz Karimov, +998 90 123 45 67, 2 ta stol so'radi — mijozlarga qo'sh»",
  '• «Kecha yozgan mijozlarga rahmat xabarini tayyorla»',
  '• «Aliyevga tijorat taklifi tayyorla: 50 ta mahsulot, 10% chegirma»',
  '• «Dam olish kunlari aksiyasi haqida post qil»',
  '• «Bugun nima qilishim kerak?»',
  '',
  '/vazifalar — ochiq vazifalar',
  '/yangi — yangi suhbat (oldingisini unutadi, vazifa va mijozlar qoladi)',
].join('\n');

export function createBot(): BotService {
  if (!env.botToken) {
    const off = () => Promise.reject(new Error("Telegram bot ulanmagan (BOT_TOKEN yo'q)"));
    return {
      enabled: false, username: () => null, start: async () => {}, stop: () => {},
      publishPost: off, sendFollowup: off, cancelFollowup: off, remindTask: async () => {}, sendText: async () => {}, verifyChannel: off,
    };
  }

  const bot = new Telegraf(env.botToken, {
    handlerTimeout: 600_000,
    ...(env.telegramApiRoot ? { telegram: { apiRoot: env.telegramApiRoot } } : {}),
  });
  const tg = bot.telegram;
  let username: string | null = null;

  const leadLink = (bizId: string, postId?: string) => (username ? `https://t.me/${username}?start=l-${bizId}${postId ? `-${postId}` : ''}` : null);

  // ─── Yetkazish: yordamchi javobi va narsalari ─────────────────────────────
  async function sendArtifact(biz: BusinessRow, chat: string, a: Artifact): Promise<void> {
    if (a.type === 'document') {
      const buf = await markdownToDocx(a.doc.title, a.doc.markdown, biz.profile);
      await tg.sendDocument(chat, { source: buf, filename: docFileName(a.doc.title) }, { caption: `📄 ${cut(a.doc.title, 200)}` });
    } else if (a.type === 'post') {
      const p = posts.get(biz.id, a.post.id) ?? a.post;
      const msg = await tg.sendPhoto(chat, { source: renderPng(p.item, langOf(biz), biz.profile), filename: `${p.id}.png` },
        { caption: postCaption(p, biz), parse_mode: 'HTML', reply_markup: postKeyboard(p, biz) });
      posts.setOwnerMessage(biz.id, p.id, msg.message_id);
    } else if (a.type === 'outbound') {
      const o = outbound.get(biz.id, a.outbound.id) ?? a.outbound;
      const msg = await tg.sendMessage(chat, followupText(o, biz), { parse_mode: 'HTML', reply_markup: followupKeyboard(o) });
      outbound.setOwnerMessage(biz.id, o.id, msg.message_id);
    }
    // Vazifa — javob matnida aytiladi, alohida xabar kerak emas
  }

  async function sendHtml(chat: string, html: string) {
    for (const part of chunks(html)) {
      await tg.sendMessage(chat, part, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(async e => {
        // HTML buzilgan bo'lsa (kutilmagan belgi) — oddiy matn sifatida
        if (!String((e as Error).message).includes("can't parse entities")) throw e;
        await tg.sendMessage(chat, part.replace(/<[^>]+>/g, ''), { link_preview_options: { is_disabled: true } });
      });
    }
  }

  /** Egasining gapi → yordamchi → javob va narsalar */
  async function handleOwner(ctx: Context, biz: BusinessRow, text: string, voice = false) {
    const chat = String(ctx.chat!.id);
    const typing = setInterval(() => { void ctx.sendChatAction('typing').catch(() => {}); }, 4500);
    void ctx.sendChatAction('typing').catch(() => {});
    try {
      const reply = await ask(biz.id, 'telegram', text, { voice });
      const head = voice ? `🎙 <i>${esc(cut(text, 500))}</i>\n\n` : '';
      await sendHtml(chat, head + tgHtml(reply.text));
      const fresh = businesses.byId(biz.id) ?? biz;
      for (const a of reply.artifacts) {
        await sendArtifact(fresh, chat, a).catch(e => {
          console.error('[bot] yetkazilmadi:', a.type, (e as Error).message);
          return tg.sendMessage(chat, `⚠️ ${a.type === 'document' ? 'Hujjat' : a.type === 'post' ? 'Rasm' : 'Xabar'} yuborilmadi — panelda ko'ring.`).catch(() => {});
        });
      }
    } finally {
      clearInterval(typing);
    }
  }

  // ─── Egasi: ulanish ────────────────────────────────────────────────────────
  async function linkOwner(ctx: Context, code: string) {
    const biz = businesses.byLinkCode(code);
    if (!biz || !biz.active) {
      await ctx.reply("Havola noto'g'ri yoki eskirgan. Panel → «Telegram» bo'limidan yangisini oling.");
      return;
    }
    businesses.update(biz.id, { ownerChatId: String(ctx.chat!.id) });
    const name = biz.profile.ownerName ? `, ${biz.profile.ownerName}` : '';
    await ctx.reply(`✅ Ulandi: «${biz.profile.name}». Assalomu alaykum${name}!\n\n${HELP}`);
  }

  // ─── Mijoz: havola, raqam, savol ───────────────────────────────────────────
  const contactKeyboard = Markup.keyboard([Markup.button.contactRequest('📞 Raqamni yuborish / Отправить номер')]).oneTime().resize();
  /** Mijozga "yetkazildi" javobi soatiga bir marta (har xabarga emas) */
  const acked = new Map<string, number>();

  async function leadStart(ctx: Context, bizId: string, postId?: string) {
    const biz = businesses.byId(bizId);
    if (!biz || !biz.active) {
      await ctx.reply('Havola eskirgan. / Ссылка устарела.');
      return;
    }
    const post = postId ? posts.get(biz.id, postId) : undefined;
    const from = ctx.from!;
    leads.fromTelegram(biz.id, String(from.id), [from.first_name, from.last_name].filter(Boolean).join(' ') || null, from.username ?? null,
      post ? `Post: ${cut(post.item.design[langOf(biz)].title, 60)}` : 'Telegram havola', post?.id ?? null);
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
    if (payload.startsWith('l-')) {
      const [, bizId, postId] = payload.split('-');
      return leadStart(ctx, bizId, postId);
    }
    const biz = ownerOf(ctx);
    await ctx.reply(biz
      ? `«${biz.profile.name}» ulangan.\n\n${HELP}`
      : "Assalomu alaykum! Bu Cerebro — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.");
  });

  bot.help(async ctx => {
    const biz = ownerOf(ctx);
    await ctx.reply(biz ? HELP : 'Bu Cerebro — biznes uchun AI yordamchi. Ulanish: panel → «Telegram».');
  });

  bot.command('yangi', async ctx => {
    const biz = ownerOf(ctx);
    if (!biz) return;
    resetConversation(biz.id);
    await ctx.reply('🆕 Yangi suhbat. Vazifalar, mijozlar va eslab qolganlarim joyida.');
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
    const biz = ctx.chat?.type === 'private' ? businesses.byOwnerChat(String(ctx.chat.id)) : undefined;
    if (!biz || !id) return ctx.answerCbQuery('Bu tugma eskirgan');
    const msg = ctx.callbackQuery.message;

    if (code === 'pp' || code === 'pd') {
      const p = posts.get(biz.id, id);
      if (!p) return ctx.answerCbQuery('Post topilmadi');
      if (code === 'pd') {
        if (p.status === 'published') return ctx.answerCbQuery('Post allaqachon joylangan');
        posts.setStatus(biz.id, id, 'deleted');
        await ctx.answerCbQuery("O'chirildi");
      } else {
        try {
          await publishPost(biz, id);
          await ctx.answerCbQuery('✅ Kanalga joylandi');
        } catch (e) {
          return ctx.answerCbQuery(cut((e as Error).message, 190), { show_alert: true });
        }
      }
      return refreshPost(biz.id, id);
    }

    if (code === 'fs' || code === 'fc') {
      const o = outbound.get(biz.id, id);
      if (!o) return ctx.answerCbQuery('Xabar topilmadi');
      if (o.status !== 'draft') return ctx.answerCbQuery(o.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bekor qilingan', { show_alert: true });
      if (code === 'fc') {
        await cancelFollowup(biz, id).catch(() => {});
        return ctx.answerCbQuery('Bekor qilindi');
      }
      // Tugmaga darhol javob (Telegram kutmaydi), yuborish — fonda
      await ctx.answerCbQuery('Yuborilmoqda…');
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

    if (code === 'ra' || code === 'rx') {
      try {
        if (code === 'ra') {
          await approveReply(biz, id);
          return ctx.answerCbQuery('✅ Yuborildi');
        }
        await dismissReply(biz, id);
        return ctx.answerCbQuery('Yuborilmadi');
      } catch (e) {
        return ctx.answerCbQuery(cut((e as Error).message, 190), { show_alert: true });
      }
    }

    if (code === 'td' || code === 'ts' || code === 'tt') {
      const t = tasks.get(biz.id, id);
      if (!t) return ctx.answerCbQuery('Vazifa topilmadi');
      const isReminder = !!msg && 'text' in msg && !!msg.text?.startsWith('⏰');
      const edit = (html: string) => (isReminder
        ? tg.editMessageText(biz.ownerChatId!, msg.message_id, undefined, html, { parse_mode: 'HTML' }).catch(ignoreUnchanged).catch(() => {})
        : Promise.resolve());
      if (code === 'td') {
        tasks.update(biz.id, id, { status: 'done' });
        await ctx.answerCbQuery('✅ Bajarildi');
        return edit(reminderText(t, '✅ Bajarildi'));
      }
      const now = new Date();
      const next = code === 'ts' ? stamp(new Date(now.getTime() + 3600_000)) : `${iso(addDays(now, 1))}T09:00`;
      const u = tasks.update(biz.id, id, { dueAt: next, status: 'open' })!;
      await ctx.answerCbQuery(`⏰ ${dueLabel('uz', next, now)}`);
      return edit(reminderText(u, `⏰ Yana eslataman: ${dueLabel('uz', next, now)}`));
    }
    return ctx.answerCbQuery();
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
    const updated = leads.update(biz.id, lead.id, { phone, name })!;
    await ctx.reply(`Rahmat! ✅ Tez orada bog'lanamiz.\nСпасибо! Скоро свяжемся.${biz.profile.phone ? `\n📞 ${biz.profile.phone}` : ''}`, Markup.removeKeyboard());
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
    if (biz) {
      // Mijoz xabariga "Reply" — javob mijozga ketadi
      const replyTo = ctx.message.reply_to_message?.message_id;
      const leadId = replyTo ? relays.leadFor(chatId, replyTo) : undefined;
      if (leadId) {
        const lead = leads.get(biz.id, leadId);
        if (!lead) return ctx.reply('Mijoz topilmadi.');
        try {
          await ownerWrites(biz, lead, text);
          return ctx.reply(`✅ ${personName(lead)}ga yuborildi.`);
        } catch (e) {
          return ctx.reply(`⚠️ Yuborilmadi: ${(e as Error).message}`);
        }
      }
      return detach('javob', () => handleOwner(ctx, biz, text));
    }
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
  bot.on(message('photo'), forwardMedia);
  bot.on(message('document'), forwardMedia);

  // Bot kanalga admin qilindi → qo'shgan odam egasi bo'lsa, kanal ulanadi
  bot.on('my_chat_member', async ctx => {
    const upd = ctx.myChatMember;
    if (upd.chat.type !== 'channel') return;
    const biz = businesses.byOwnerChat(String(upd.from.id));
    if (!biz) return;
    const m = upd.new_chat_member;
    const title = 'title' in upd.chat ? upd.chat.title : 'kanal';
    if (m.status === 'administrator' && m.can_post_messages !== false) {
      businesses.update(biz.id, { channelId: String(upd.chat.id), channelTitle: title });
      await tg.sendMessage(biz.ownerChatId!, `✅ Kanal ulandi: «${title}». Endi postlarni bir tugma bilan joylash mumkin.`).catch(() => {});
    } else if (biz.channelId === String(upd.chat.id) && m.status !== 'administrator') {
      businesses.update(biz.id, { channelId: null, channelTitle: null });
      await tg.sendMessage(biz.ownerChatId!, `⚠️ «${title}» kanali uzildi (bot endi admin emas).`).catch(() => {});
    }
  });

  bot.catch((err, ctx) => console.error(`[bot] ${ctx.updateType} xatosi:`, (err as Error)?.message ?? err));

  // ─── Tashqi amallar (panel ham chaqiradi) ──────────────────────────────────
  async function refreshPost(bizId: string, postId: string) {
    const biz = businesses.byId(bizId);
    const p = posts.get(bizId, postId);
    if (!biz?.ownerChatId || !p?.ownerMessageId) return;
    await tg.editMessageCaption(biz.ownerChatId, p.ownerMessageId, undefined, postCaption(p, biz), { parse_mode: 'HTML', reply_markup: postKeyboard(p, biz) })
      .catch(ignoreUnchanged).catch(e => console.error('[bot] post xabari:', (e as Error).message));
  }

  async function refreshFollowup(bizId: string, id: string) {
    const biz = businesses.byId(bizId);
    const o = outbound.get(bizId, id);
    if (!biz?.ownerChatId || !o?.ownerMessageId) return;
    await tg.editMessageText(biz.ownerChatId, o.ownerMessageId, undefined, followupText(o, biz), { parse_mode: 'HTML', reply_markup: followupKeyboard(o) })
      .catch(ignoreUnchanged).catch(e => console.error('[bot] xabar:', (e as Error).message));
  }

  async function publishPost(bizRow: BusinessRow, postId: string): Promise<void> {
    const biz = businesses.byId(bizRow.id) ?? bizRow;
    const p = posts.get(biz.id, postId);
    if (!p || p.status === 'deleted') throw new Error('Post topilmadi');
    if (p.status === 'published') throw new Error('Post allaqachon joylangan');
    if (p.item.kind === 'story') throw new Error("Storisni kanalga joylab bo'lmaydi — rasmni yuklab olib, Instagram storisga qo'ying");
    if (!biz.channelId) throw new Error('Kanal ulanmagan: panel → Telegram → kanal');
    const lang = langOf(biz);
    const link = leadLink(biz.id, p.id);
    const tail = link ? `\n\n👉 ${lang === 'ru' ? 'Связаться' : "Bog'lanish"}: ${link}` : '';
    const msg = await tg.sendPhoto(biz.channelId, { source: renderPng(p.item, lang, biz.profile), filename: `${p.id}.png` },
      { caption: cut(p.item.caption[lang], 1024 - tail.length) + tail })
      .catch(e => { throw new Error(`Kanalga joylanmadi: bot kanalda admin ekanini tekshiring (${(e as Error).message})`); });
    posts.setPublished(biz.id, p.id, msg.message_id);
    await refreshPost(biz.id, p.id);
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
    username: () => username,
    async start() {
      const me = await tg.getMe();
      username = me.username;
      await tg.setMyCommands([
        { command: 'vazifalar', description: 'Ochiq vazifalar' },
        { command: 'yangi', description: 'Yangi suhbat' },
        { command: 'help', description: 'Nima qila olaman' },
      ]).catch(() => {});
      void bot.launch({ dropPendingUpdates: false, allowedUpdates: ['message', 'callback_query', 'my_chat_member'] })
        .catch(e => console.error('[bot] ishga tushmadi:', (e as Error).message));
    },
    stop: () => { try { bot.stop(); } catch { /* ishlamayotgan bo'lsa */ } },
    publishPost,
    sendFollowup,
    cancelFollowup,
    async remindTask(biz, t) {
      if (!biz.ownerChatId) return;
      await tg.sendMessage(biz.ownerChatId, reminderText(t), { parse_mode: 'HTML', reply_markup: reminderKeyboard(t) });
    },
    sendText: (chatId, html) => sendHtml(chatId, html),
    async verifyChannel(ref: string) {
      const clean = ref.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@?/, '@');
      const chatRef = /^@-?\d+$/.test(clean) ? clean.slice(1) : clean;
      const chat = await tg.getChat(chatRef).catch(() => { throw new Error('Kanal topilmadi — manzilni tekshiring (masalan, @mening_kanalim)'); });
      if (chat.type !== 'channel') throw new Error('Bu kanal emas');
      const me = await tg.getMe();
      const member = await tg.getChatMember(chat.id, me.id).catch(() => null);
      if (!member || member.status !== 'administrator') throw new Error(`@${me.username} kanalda admin emas — uni admin qiling`);
      if ('can_post_messages' in member && member.can_post_messages === false) throw new Error('Botga «xabar joylash» ruxsatini bering');
      return { id: String(chat.id), title: 'title' in chat ? chat.title : chatRef };
    },
  };
}
