/**
 * Cerebro boti (bitta bot — hamma klinikalar uchun).
 *
 * Egasi:   /start o-<kod> (paneldagi havola) → ulanadi. Har dushanba paket keladi:
 *          har post — rasm, matn, tugmalar (Joylash / Boshqa variant / Tahrirlash /
 *          Kerak emas). Matn yuborsa — savol (AI javob beradi) yoki tahrir.
 * Bemor:   postdagi havola /start l-<klinika>-<post> → raqamini yuboradi →
 *          egasiga "Yangi murojaat" boradi. Qaysi postdan kelgani sanaladi.
 * Kanal:   tasdiqlangan post vaqti kelganda kanalga chiqadi; Instagram uchun rasm
 *          va matn egasiga yuboriladi (Instagram'ga avtomatik joylash — Meta ruxsatidan keyin).
 */
import { Markup, Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { ContentItem, ItemStatus, Lang } from '../src/types';
import { check } from '../src/lib/compliance';
import { itemTime } from '../src/lib/generator';
import { fromIso, mondayOf, weekRange, whenLabel } from '../src/lib/week';
import { applyAction, saveEdit, validItemId, type Action } from './actions';
import { clinics, items, leads, type ClinicRow } from './db';
import { ensureAi, itemIdFromCode, setBotUsername, thisMonday, viewWeek, type ItemMeta } from './content';
import { env } from './env';
import { answerQuestion, weekNumbers } from './qa';
import { renderPng } from './render';

export interface BotService {
  enabled: boolean;
  username: () => string;
  start(): Promise<void>;
  stop(): void;
  sendPackage(clinic: ClinicRow, monday: string): Promise<void>;
  publishDue(now?: Date): Promise<void>;
  /** Paneldagi o'zgarishni egasining Telegramidagi xabarga ham tushiradi */
  refreshOwnerMessage(clinicId: string, itemId: string, media?: boolean): Promise<void>;
  verifyChannel(ref: string): Promise<{ id: string; title: string }>;
}

const langOf = (c: ClinicRow): Lang => c.profile.contentLang ?? 'uz';
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klinika';
const ACTIONS: Record<string, Action> = { p: 'publish', r: 'reject', u: 'undo', v: 'variant' };

/** Paket yuborish vaqti keldimi: dushanba soat 09:00 dan keyin va bu hafta hali yuborilmagan */
export const packageDue = (clinic: ClinicRow, now = new Date()) => {
  const start = mondayOf(now);
  start.setHours(env.sendHour, 0, 0, 0);
  return !!clinic.ownerChatId && clinic.active && now >= start && clinic.sentWeek !== thisMonday(now);
};

function statusLine(item: ContentItem, status: ItemStatus, meta: ItemMeta): string {
  if (status === 'rejected') return '❌ Chiqmaydi';
  if (status !== 'published') return '';
  if (!meta.publishedAt) return `⏰ Rejaga qo'yildi: ${whenLabel('uz', item.date, item.time)}`;
  if (item.kind === 'story') return '✅ Vaqti keldi — rasm yuborildi';
  return meta.inChannel ? '✅ Kanalga joylandi' : '✅ Joylash vaqti keldi — rasm va matn yuborildi';
}

/** Egasiga ko'rinadigan izoh: sarlavha, post matni, holat (Telegram cheklovi — 1024 belgi) */
function ownerCaption(item: ContentItem, status: ItemStatus, meta: ItemMeta, lang: Lang): string {
  const head = `${item.kind === 'story' ? '📲 Storis' : '🖼 Post'} · ${item.topic.uz} · ${whenLabel('uz', item.date, item.time)}`;
  const issues = check(`${item.design[lang].title}\n${item.caption[lang]}`);
  const tail = [
    issues.length ? `⚠️ Tekshiring: ${issues.map(i => `«${i.phrase}»`).join(', ')}` : '',
    statusLine(item, status, meta),
  ].filter(Boolean).join('\n');
  const room = 1024 - head.length - (tail ? tail.length + 2 : 0) - 2;
  return [head, cut(item.caption[lang], room), tail].filter(Boolean).join('\n\n');
}

function keyboard(item: ContentItem, status: ItemStatus, meta: ItemMeta): InlineKeyboardMarkup | undefined {
  if (meta.publishedAt) return undefined;
  const b = Markup.button.callback;
  if (status === 'pending') {
    return Markup.inlineKeyboard([
      [b('✅ Joylash', `p|${item.id}`), b('🔄 Boshqa variant', `v|${item.id}`)],
      [b('✏️ Tahrirlash', `e|${item.id}`), b('❌ Kerak emas', `r|${item.id}`)],
    ]).reply_markup;
  }
  return Markup.inlineKeyboard([[b('↩️ Qaytarish', `u|${item.id}`)]]).reply_markup;
}

/** Telegram "xabar o'zgarmadi" xatosi — muammo emas */
const ignoreUnchanged = (e: unknown) => {
  if (!String((e as Error)?.message).includes('message is not modified')) throw e;
};

export function createBot(): BotService {
  if (!env.botToken) {
    const off = async () => {};
    return {
      enabled: false,
      username: () => '',
      start: off,
      stop: () => {},
      sendPackage: off,
      publishDue: off,
      refreshOwnerMessage: off,
      verifyChannel: async () => { throw new Error('Bot ulanmagan (BOT_TOKEN yo\'q)'); },
    };
  }

  const bot = new Telegraf(env.botToken, {
    handlerTimeout: 180_000,
    ...(env.telegramApiRoot ? { telegram: { apiRoot: env.telegramApiRoot } } : {}),
  });
  const tg = bot.telegram;
  let username = '';
  /** Egasi tahrir yubormoqda: chat → post */
  const awaitingEdit = new Map<string, { clinicId: string; itemId: string }>();

  async function refreshOwnerMessage(clinicId: string, itemId: string, media = false): Promise<void> {
    const clinic = clinics.byId(clinicId);
    const row = items.get(clinicId, itemId);
    if (!clinic?.ownerChatId || !row?.ownerMessageId) return;
    const view = viewWeek(clinic, itemId.slice(0, 10));
    const item = view.items.find(i => i.id === itemId);
    if (!item) return;
    const lang = langOf(clinic);
    const caption = ownerCaption(item, view.status[itemId], view.meta[itemId], lang);
    const reply_markup = keyboard(item, view.status[itemId], view.meta[itemId]);
    if (media) {
      await tg.editMessageMedia(clinic.ownerChatId, row.ownerMessageId, undefined,
        { type: 'photo', media: { source: renderPng(item, lang, clinic.profile), filename: `${item.id}.png` }, caption },
        { reply_markup }).catch(ignoreUnchanged);
    } else {
      await tg.editMessageCaption(clinic.ownerChatId, row.ownerMessageId, undefined, caption, { reply_markup }).catch(ignoreUnchanged);
    }
  }

  async function sendPackage(clinicRow: ClinicRow, monday: string): Promise<void> {
    if (!clinicRow.ownerChatId) return;
    await ensureAi(clinicRow, monday);
    const clinic = clinics.byId(clinicRow.id)!;
    const chat = clinic.ownerChatId!;
    const view = viewWeek(clinic, monday);
    const lang = langOf(clinic);
    const posts = view.items.filter(i => i.kind === 'post').length;
    await tg.sendMessage(chat, [
      `Assalomu alaykum${clinic.profile.ownerName ? `, ${clinic.profile.ownerName}` : ''}! 👋`,
      `${weekRange('uz', fromIso(monday))} uchun paket tayyor: ${posts} ta post, ${view.items.length - posts} ta storis.`,
      "Har birini ko'rib chiqing — tasdiqlaganingiz belgilangan vaqtda o'zi joylanadi.",
    ].join('\n'));
    for (const item of view.items) {
      const msg = await tg.sendPhoto(chat, { source: renderPng(item, lang, clinic.profile), filename: `${item.id}.png` }, {
        caption: ownerCaption(item, view.status[item.id], view.meta[item.id], lang),
        reply_markup: keyboard(item, view.status[item.id], view.meta[item.id]),
      });
      items.update(clinic.id, item.id, { ownerMessageId: msg.message_id });
    }
    await tg.sendMessage(chat, [
      'Savol bering, masalan: «Nechta odam yozildi?» yoki «Qaysi post yaxshi ishladi?»',
      ...(clinic.channelId ? [] : ["\n⚠️ Telegram kanal ulanmagan — postlar vaqti kelganda rasm va matnni sizga yuboraman, o'zingiz joylaysiz. Ulash: panel → Telegram bot."]),
    ].join('\n'));
    clinics.update(clinic.id, { sentWeek: monday });
  }

  async function publishItem(clinic: ClinicRow, item: ContentItem): Promise<void> {
    const lang = langOf(clinic);
    const png = renderPng(item, lang, clinic.profile);
    const text = item.caption[lang];
    let channelMessageId: number | null = null;
    if (item.kind === 'post' && clinic.channelId) {
      const msg = await tg.sendPhoto(clinic.channelId, { source: png, filename: `${item.id}.png` }, { caption: cut(text, 1024) });
      channelMessageId = msg.message_id;
    }
    items.update(clinic.id, item.id, { publishedAt: new Date().toISOString(), channelMessageId, publishError: null });
    if (clinic.ownerChatId) {
      const head = item.kind === 'story'
        ? "📲 Storis vaqti keldi — rasmni Instagram storisga joylang."
        : channelMessageId
          ? "✅ Kanalga joylandi. Instagram uchun — rasm (asl sifatda) va matn:"
          : "⏰ Joylash vaqti keldi. Kanal ulanmagan — rasm va matnni o'zingiz joylang:";
      await tg.sendDocument(clinic.ownerChatId,
        { source: png, filename: `${slug(clinic.profile.name)}-${item.date}-${item.kind}.png` },
        { caption: cut(`${head}\n\n${text}`, 1024) });
      await refreshOwnerMessage(clinic.id, item.id).catch(e => console.error('[bot] yangilash:', (e as Error).message));
    }
  }

  let publishing = false;
  async function publishDue(now = new Date()): Promise<void> {
    if (publishing) return;
    publishing = true;
    try {
      for (const row of items.due()) {
        const clinic = clinics.byId(row.clinicId);
        if (!clinic) continue;
        const item = viewWeek(clinic, row.week).items.find(i => i.id === row.itemId);
        if (!item || itemTime(item) > now) continue;
        try {
          await publishItem(clinic, item);
          console.log(`[bot] joylandi: ${clinic.profile.name} · ${item.id}`);
        } catch (e) {
          const msg = (e as Error).message;
          const attempts = row.attempts + 1;
          items.update(clinic.id, item.id, { attempts, publishError: msg });
          console.error(`[bot] joylanmadi (${attempts}/3): ${clinic.profile.name} · ${item.id}: ${msg}`);
          if (attempts >= 3 && clinic.ownerChatId) {
            await tg.sendMessage(clinic.ownerChatId,
              `⚠️ «${item.topic.uz}: ${item.design.uz.title}» joylanmadi.\nSabab: ${msg}\nBot kanalda admin ekanini va xabar joylash ruxsati borligini tekshiring.`).catch(() => {});
          }
        }
      }
    } finally {
      publishing = false;
    }
  }

  // ─── Egasi: ulanish ────────────────────────────────────────────────────────
  async function linkOwner(ctx: Context, code: string) {
    const clinic = clinics.byLinkCode(code);
    if (!clinic || !clinic.active) {
      await ctx.reply("Havola noto'g'ri yoki eskirgan. Panel → «Telegram bot» bo'limidan yangisini oling.");
      return;
    }
    clinics.update(clinic.id, { ownerChatId: String(ctx.chat!.id) });
    await ctx.reply([
      `✅ Ulandi: «${clinic.profile.name}».`,
      `Har dushanba soat ${String(env.sendHour).padStart(2, '0')}:00 da haftalik paket shu yerga keladi.`,
      'Buyruqlar: /paket — shu haftaning paketi, /natija — murojaatlar soni.',
    ].join('\n'));
    const fresh = clinics.byId(clinic.id)!;
    if (packageDue(fresh)) await sendPackage(fresh, thisMonday());
  }

  // ─── Bemor: postdagi havola ────────────────────────────────────────────────
  const contactKeyboard = Markup.keyboard([Markup.button.contactRequest('📞 Raqamni yuborish / Отправить номер')]).oneTime().resize();

  async function leadStart(ctx: Context, clinicId: string, code?: string) {
    const clinic = clinics.byId(clinicId);
    if (!clinic || !clinic.active) {
      await ctx.reply('Havola eskirgan. / Ссылка устарела.');
      return;
    }
    const itemId = code ? itemIdFromCode(code) : null;
    const from = ctx.from!;
    leads.click(clinic.id, itemId && validItemId(itemId) ? itemId : null, String(from.id),
      [from.first_name, from.last_name].filter(Boolean).join(' ') || null, from.username ?? null);
    await ctx.reply([
      `Assalomu alaykum! 👋 «${clinic.profile.name}» klinikasiga yozilish uchun telefon raqamingizni yuboring — administrator qo'ng'iroq qilib, qulay vaqtni kelishadi.`,
      '',
      `Здравствуйте! Чтобы записаться в «${clinic.profile.name}», отправьте номер телефона — администратор перезвонит.`,
    ].join('\n'), contactKeyboard);
  }

  bot.start(async ctx => {
    const payload = ctx.payload?.trim() ?? '';
    if (payload.startsWith('o-')) return linkOwner(ctx, payload.slice(2));
    if (payload.startsWith('l-')) {
      const [, clinicId, code] = payload.split('-');
      return leadStart(ctx, clinicId, code);
    }
    const owner = clinics.byOwnerChat(String(ctx.chat.id));
    await ctx.reply(owner
      ? `«${owner.profile.name}» ulangan. /paket — shu haftaning paketi, /natija — murojaatlar soni.`
      : 'Assalomu alaykum! Bu Cerebro — stomatologiya klinikalari uchun marketing yordamchisi. Klinika egasi bo\'lsangiz, paneldagi «Telegramni ulash» havolasini bosing.');
  });

  bot.command('paket', async ctx => {
    const clinic = clinics.byOwnerChat(String(ctx.chat.id));
    if (!clinic) return ctx.reply('Avval klinikangizni ulang (panel → Telegram bot).');
    await ctx.reply('Tayyorlanmoqda…');
    await sendPackage(clinic, thisMonday());
  });

  bot.command('natija', async ctx => {
    const clinic = clinics.byOwnerChat(String(ctx.chat.id));
    if (!clinic) return ctx.reply('Avval klinikangizni ulang (panel → Telegram bot).');
    const n = weekNumbers(clinic, thisMonday());
    await ctx.reply([
      `Bu hafta: havolani ${n.clicks} kishi bosdi, ${n.contacts} kishi raqam qoldirdi.`,
      '',
      ...n.rows.map(r => `• ${r.what} — ${r.status}${r.clicks ? `, ${r.clicks} bosish, ${r.contacts} raqam` : ''}`),
    ].join('\n'));
  });

  bot.command('cancel', async ctx => {
    awaitingEdit.delete(String(ctx.chat.id));
    await ctx.reply('Bekor qilindi.', Markup.removeKeyboard());
  });

  bot.on('callback_query', async ctx => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const [code, itemId] = data.split('|');
    const clinic = clinics.byOwnerChat(String(ctx.chat?.id ?? ''));
    if (!clinic || !itemId || !validItemId(itemId)) return ctx.answerCbQuery('Bu tugma eskirgan');

    if (code === 'e') {
      if (items.get(clinic.id, itemId)?.publishedAt) return ctx.answerCbQuery('Post allaqachon chiqqan');
      awaitingEdit.set(String(ctx.chat!.id), { clinicId: clinic.id, itemId });
      await ctx.answerCbQuery();
      const lang = langOf(clinic) === 'ru' ? 'ruscha' : "o'zbekcha";
      return ctx.reply(`✏️ Yangi matnni yuboring (${lang}) — postga aynan shu matn chiqadi. Bekor qilish: /cancel`);
    }
    const action = ACTIONS[code];
    if (!action) return ctx.answerCbQuery();
    const error = applyAction(clinic, itemId, action);
    if (error) return ctx.answerCbQuery(error);
    await ctx.answerCbQuery(action === 'publish' ? "✅ Rejaga qo'yildi" : action === 'reject' ? 'Chiqmaydi' : action === 'undo' ? 'Qaytarildi' : '🔄 Yangi variant tayyorlanmoqda…');
    if (action === 'variant') await ensureAi(clinics.byId(clinic.id)!, itemId.slice(0, 10));
    await refreshOwnerMessage(clinic.id, itemId, action === 'variant');
    if (action === 'publish') void publishDue();
  });

  bot.on(message('contact'), async ctx => {
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply("Iltimos, o'zingizning raqamingizni pastdagi tugma orqali yuboring.", contactKeyboard);
    }
    const lead = leads.latestForUser(String(ctx.from.id));
    const clinic = lead && clinics.byId(lead.clinicId);
    if (!lead || !clinic) return ctx.reply('Qaysi klinikaga yozilmoqchisiz? Postdagi havolani qayta bosing.', Markup.removeKeyboard());
    const phone = contact.phone_number.startsWith('+') ? contact.phone_number : `+${contact.phone_number}`;
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null;
    leads.setContact(lead.id, phone, name);
    await ctx.reply(`Rahmat! ✅ Administrator tez orada qo'ng'iroq qiladi.\nСпасибо! Администратор скоро перезвонит.\n📞 ${clinic.profile.phone}`, Markup.removeKeyboard());
    if (clinic.ownerChatId) {
      const item = lead.itemId ? viewWeek(clinic, lead.itemId.slice(0, 10)).items.find(i => i.id === lead.itemId) : undefined;
      await tg.sendMessage(clinic.ownerChatId, [
        '🆕 Yangi murojaat',
        `👤 ${name ?? lead.name ?? 'Ismi yo\'q'}${lead.username ? ` (@${lead.username})` : ''}`,
        `📞 ${phone}`,
        `📌 ${item ? `«${item.topic.uz}: ${item.design.uz.title}» posti (${whenLabel('uz', item.date, item.time)})` : 'Umumiy havola'}`,
      ].join('\n')).catch(e => console.error('[bot] egasiga xabar:', (e as Error).message));
    }
  });

  bot.on(message('text'), async ctx => {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text.trim();
    const clinic = clinics.byOwnerChat(chatId);
    if (clinic) {
      const pending = awaitingEdit.get(chatId);
      if (pending) {
        awaitingEdit.delete(chatId);
        const lang = langOf(clinic);
        const row = items.get(clinic.id, pending.itemId);
        const error = saveEdit(clinic, pending.itemId, { ...(row?.edits ?? {}), [lang]: { ...(row?.edits?.[lang] ?? {}), caption: text } });
        if (error) return ctx.reply(error);
        await refreshOwnerMessage(clinic.id, pending.itemId);
        const issues = check(text);
        return ctx.reply(issues.length
          ? `✅ Saqlandi, lekin tekshiring:\n${issues.map(i => `• «${i.phrase}» — ${i.why}. ${i.hint}.`).join('\n')}`
          : '✅ Saqlandi. Post xabaridagi «Joylash» tugmasini bosing.');
      }
      await ctx.sendChatAction('typing');
      return ctx.reply(await answerQuestion(clinic, text));
    }
    // Bemor: havolani bosgan, lekin raqam o'rniga matn yozdi
    if (leads.latestForUser(String(ctx.from.id))) {
      return ctx.reply('Yozilish uchun pastdagi tugma orqali raqamingizni yuboring. / Отправьте номер кнопкой ниже.', contactKeyboard);
    }
    await ctx.reply('Assalomu alaykum! Bu Cerebro — klinikalar uchun marketing yordamchisi.');
  });

  bot.catch((err, ctx) => console.error(`[bot] ${ctx.updateType} xatosi:`, (err as Error)?.message ?? err));

  return {
    enabled: true,
    username: () => username,
    async start() {
      const me = await tg.getMe();
      username = me.username;
      setBotUsername(username);
      await tg.setMyCommands([
        { command: 'paket', description: 'Shu haftaning paketi' },
        { command: 'natija', description: 'Murojaatlar soni' },
        { command: 'cancel', description: 'Bekor qilish' },
      ]).catch(() => {});
      void bot.launch({ dropPendingUpdates: false }).catch(e => console.error('[bot] ishga tushmadi:', (e as Error).message));
    },
    stop: () => { try { bot.stop(); } catch { /* ishlamayotgan bo'lsa */ } },
    sendPackage,
    publishDue,
    refreshOwnerMessage,
    async verifyChannel(ref: string) {
      const clean = ref.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@?/, '@');
      const chatRef = /^@-?\d+$/.test(clean) ? clean.slice(1) : clean;
      const chat = await tg.getChat(chatRef).catch(() => { throw new Error('Kanal topilmadi — manzilni tekshiring (masalan, @klinika_kanali)'); });
      if (chat.type !== 'channel') throw new Error('Bu kanal emas');
      const me = await tg.getMe();
      const member = await tg.getChatMember(chat.id, me.id).catch(() => null);
      if (!member || member.status !== 'administrator') throw new Error(`@${me.username} kanalda admin emas — uni admin qiling`);
      if ('can_post_messages' in member && member.can_post_messages === false) throw new Error('Botga «xabar joylash» ruxsatini bering');
      return { id: String(chat.id), title: 'title' in chat ? chat.title : chatRef };
    },
  };
}
