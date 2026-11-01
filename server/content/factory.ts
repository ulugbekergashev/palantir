/**
 * Kontent-zavod: manbalardagi yangi postlar → AI qoralamalari → egasiga Telegram'da karta («📢 Kanalga joylash» / «✖️ Bekor») →
 * egasi tasdiqlasa — uning kanaliga (bot kanalda admin bo'lishi kerak). Egasi bosmaguncha hech narsa chiqmaydi.
 * Kartadagi tugma matnga bog'langan (draftMark): panelda matn o'zgarsa, eski karta joylamaydi.
 */
import { createHash } from 'node:crypto';
import type { ContentDraft, ContentSettings } from '../../src/types';
import type { BusinessRow } from '../db';
import { notifyOwner } from '../inbox/core';
import { ContentError, MAX_DRAFT, contentStore } from './store';
import { fetchChannel, normalizeHandle, type SourcePost } from './telegram';
import { writeDrafts, writeTopicDraft, type DraftText } from './writer';

export { ContentError } from './store';

/** Telegram bot orqali kanal: topish (bot admin va post yoza oladimi) va joylash. bot.ts ro'yxatdan o'tkazadi */
export interface ChannelOutlet {
  resolve(handle: string): Promise<{ id: string; title: string }>;
  post(chatId: string, text: string): Promise<number>;
}
let outlet: ChannelOutlet | null = null;
export const setChannelOutlet = (o: ChannelOutlet | null): void => { outlet = o; };

export interface FactoryDeps {
  fetch: (handle: string) => Promise<SourcePost[] | { title: string | null; posts: SourcePost[] }>;
  write: (biz: BusinessRow, s: ContentSettings, items: SourcePost[], count: number) => Promise<DraftText[]>;
}
const LIVE: FactoryDeps = { fetch: fetchChannel, write: writeDrafts };

/** Birinchi marta qo'shilgan manbadan nechta oxirgi post olinadi (eski arxiv emas — yangiliklar) */
const FIRST_TAKE = 8;
/** Yozuvchiga bir martada beriladigan postlar chegarasi */
const MAX_ITEMS = 12;
/** Juda qisqa post (faqat «Ждём?», havola) material emas */
const MIN_TEXT = 60;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const draftMark = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** Kartaga to'liq sig'adigan post (Telegram xabari 4096 belgigacha, sarlavha va izoh bilan) */
const CARD_TEXT = 3200;

/**
 * Egasiga karta: to'liq matn va tugmalar (shu matnga bog'langan). Uzun post kartaga sig'masa — boshi ko'rsatiladi, joylash tugmasi
 * yo'q: egasi oxirini ko'rmagan postni tasdiqlamasin (to'lig'i va joylash — panelda)
 */
async function card(biz: BusinessRow, d: ContentDraft, s: ContentSettings): Promise<void> {
  const where = s.channelTitle ? `«${esc(s.channelTitle)}» kanaliga` : 'kanalga (hali ulanmagan: panel → Marketing → Kontent-meyker → Kanal)';
  const long = d.text.length > CARD_TEXT;
  const body = long ? `${esc(d.text.slice(0, CARD_TEXT - 400))}…` : esc(d.text);
  const tail = long ? `<i>Post uzun (${d.text.length} belgi) — to'liq matnni panelda ko'rib, o'sha yerda joylang.</i>` : `<i>Tasdiqlasangiz ${where} chiqadi. Matnni o'zgartirish — panelda.</i>`;
  const html = `✍️ <b>Kontent-meyker: post tayyor</b>\n\n${body}${d.sourceUrl ? `\n\n<i>Material: ${esc(d.sourceUrl)}</i>` : ''}\n\n${tail}`;
  const cancel = { text: '✖️ Bekor', callback_data: `zx|${d.id}` };
  const keyboard = { inline_keyboard: [long ? [cancel] : [{ text: '📢 Kanalga joylash', callback_data: `zp|${d.id}|${draftMark(d.text)}` }, cancel]] };
  await notifyOwner(biz, html, keyboard).catch(e => console.error('[kontent] karta:', (e as Error).message));
}

const running = new Set<string>();
/** Oxirgi urinish vaqti: avtomatik rejimda xato bo'lsa ham jadval har 30 soniyada qayta urinmasin */
const attempts = new Map<string, number>();
const RETRY_MS = 60 * 60_000;

/** Manbalardagi yangi postlardan qoralamalar. made — nechta yozildi; note — egasiga qisqa izoh */
export async function runFactory(biz: BusinessRow, deps: FactoryDeps = LIVE, opts: { notify?: boolean } = {}): Promise<{ made: number; note: string }> {
  const sources = contentStore.sources(biz.id);
  if (!sources.length) throw new ContentError("Manba yo'q: avval kuzatiladigan Telegram kanallarni qo'shing (Kontent-meyker → Manbalar)");
  if (running.has(biz.id)) throw new ContentError('Kontent-zavod hozir ishlayapti — tugashini kuting');
  running.add(biz.id);
  attempts.set(biz.id, Date.now());
  try {
    const s = contentStore.settings(biz.id);
    const fresh: { item: SourcePost; source: string }[] = [];
    const seen = new Map<string, number>();
    const problems: string[] = [];
    for (const src of sources) {
      try {
        const got = await deps.fetch(src.handle);
        const { posts, title } = Array.isArray(got) ? { posts: got, title: null } : got;
        const newer = src.lastPost ? posts.filter(p => p.id > src.lastPost) : posts.slice(-FIRST_TAKE);
        for (const item of newer) if (item.text.length >= MIN_TEXT) fresh.push({ item, source: src.id });
        const top = Math.max(src.lastPost, ...posts.map(p => p.id));
        seen.set(src.id, top);
        if (title !== null) contentStore.sourceSeen(biz.id, src.id, src.lastPost, title);
      } catch (e) {
        problems.push(e instanceof ContentError ? e.message : `@${src.handle}: ${(e as Error).message}`);
      }
    }
    // Eng yangisi birinchi (sana bo'lmasa — post raqami)
    // Birorta manba ham o'qilmadi (internet yo'q va h.k.) — xato: «bugun bajarildi» deb yozilmaydi, avtomatik rejim keyinroq qayta uriniadi
    if (problems.length === sources.length) throw new ContentError(problems.join('; '));
    const sorted = fresh.sort((a, b) => (b.item.date ?? '').localeCompare(a.item.date ?? '') || b.item.id - a.item.id);
    // Bir martada MAX_ITEMS tagacha: qolganlari ham «o'qildi» bo'ladi (eski yangilik ertaga kerak emas) — jurnalga yoziladi
    if (sorted.length > MAX_ITEMS) console.log(`[kontent] ${biz.profile.name}: ${sorted.length} ta yangi postdan eng yangi ${MAX_ITEMS} tasi olindi`);
    const items = sorted.slice(0, MAX_ITEMS).map(f => f.item);
    const done = () => {
      for (const [id, top] of seen) contentStore.sourceSeen(biz.id, id, top, null);
      contentStore.saveSettings(biz.id, { lastRun: new Date().toISOString() });
    };
    if (!items.length) {
      done();
      return { made: 0, note: problems.length ? problems.join('; ') : "Manbalarda yangi post yo'q" };
    }
    const drafts = await deps.write(biz, s, items, Math.max(1, Math.min(5, s.perRun)));
    // Yozilgandan keyin belgilanadi: AI xato bersa, shu postlar keyingi safar yana olinadi
    done();
    const saved = drafts.filter(d => d.text.trim()).map(d => contentStore.addDraft(biz.id, { text: d.text, sourceUrl: d.sourceUrl, topic: null }));
    if (opts.notify !== false) for (const d of saved) await card(biz, d, s);
    const note = saved.length ? `${saved.length} ta qoralama tayyor` : 'Yangi postlar bor, lekin biznes uchun foydali material topilmadi';
    return { made: saved.length, note: problems.length ? `${note}. ${problems.join('; ')}` : note };
  } finally {
    running.delete(biz.id);
  }
}

export const factoryRunning = (bizId: string): boolean => running.has(bizId);

/** Egasi bergan mavzu bo'yicha bitta qoralama */
export async function topicDraft(biz: BusinessRow, topic: string, write = writeTopicDraft): Promise<ContentDraft> {
  const s = contentStore.settings(biz.id);
  const d = await write(biz, s, topic);
  const saved = contentStore.addDraft(biz.id, { text: d.text, sourceUrl: null, topic: topic.slice(0, 300) });
  await card(biz, saved, s);
  return saved;
}

/** Egasining kanali: bot kanalga admin qilingan bo'lishi kerak (post yozish huquqi bilan) */
export async function connectChannel(biz: BusinessRow, input: string): Promise<{ id: string; title: string }> {
  // Ochiq kanal — @nom; yopiq kanal — raqamli ID (-100…)
  const id = /^-100\d{6,}$/.test(input.trim()) ? input.trim() : null;
  const handle = id ? null : normalizeHandle(input);
  if (!id && !handle) throw new ContentError("Kanal havolasi noto'g'ri — @kanal_nomi, t.me/kanal_nomi yoki yopiq kanal ID'si (-100…)");
  if (!outlet) throw new ContentError('Telegram bot ulanmagan — avval Sozlamalar → Telegram');
  const ch = await outlet.resolve(id ?? `@${handle}`);
  // Bitta bot bir nechta biznesga xizmat qilsa: boshqa biznes kanaliga joylab bo'lmasin
  if (contentStore.channelTaken(ch.id, biz.id)) throw new ContentError('Bu kanal boshqa biznesga ulangan');
  contentStore.saveSettings(biz.id, { channelId: ch.id, channelTitle: ch.title });
  return ch;
}

export const disconnectChannel = (biz: BusinessRow): void => { contentStore.saveSettings(biz.id, { channelId: null, channelTitle: null }); };

const STOP: Partial<Record<ContentDraft['status'], string>> = {
  published: 'Allaqachon joylangan', cancelled: 'Bekor qilingan', publishing: 'Hozir joylanyapti',
};

export async function publishDraft(biz: BusinessRow, id: string, opts: { mark?: string } = {}): Promise<ContentDraft> {
  const d = contentStore.draft(biz.id, id);
  if (!d) throw new ContentError('Qoralama topilmadi');
  if (STOP[d.status]) throw new ContentError(STOP[d.status]!);
  if (opts.mark && opts.mark !== draftMark(d.text)) throw new ContentError("Matn panelda o'zgargan — yangi kartadan yoki paneldan joylang");
  const s = contentStore.settings(biz.id);
  if (!s.channelId) throw new ContentError('Kanal ulanmagan: panel → Marketing → Kontent-meyker → Kanal');
  if (!outlet) throw new ContentError('Telegram bot ulanmagan');
  if (!contentStore.move(biz.id, id, ['draft', 'failed'], 'publishing')) throw new ContentError('Qoralama holati o\'zgardi — sahifani yangilang');
  let messageId: number;
  try {
    messageId = await outlet.post(s.channelId, d.text);
  } catch (e) {
    // Javob kelmay uzilgan bo'lsa ham Telegram postni qabul qilgan bo'lishi mumkin — egasi kanalda tekshiradi
    const why = (e as Error).message.slice(0, 200);
    contentStore.move(biz.id, id, ['publishing'], 'failed', { error: `${why} — kanalda chiqmaganini tekshirib, qayta joylang` });
    throw new ContentError(`Kanalga joylanmadi: ${why}. Kanalda chiqmaganini tekshiring`);
  }
  // Post kanalda: bazaga yozilmasa ham (disk to'lgan) «joylanmadi» deyilmaydi — holat «joylanyapti»da qoladi va qayta joylanmaydi
  try {
    contentStore.move(biz.id, id, ['publishing'], 'published', { messageId });
  } catch (e) {
    console.error('[kontent] joylandi, lekin bazaga yozilmadi:', (e as Error).message);
  }
  return contentStore.draft(biz.id, id) ?? { ...d, status: 'published', messageId };
}

export function cancelDraft(biz: BusinessRow, id: string): void {
  if (contentStore.move(biz.id, id, ['draft', 'failed'], 'cancelled')) return;
  const d = contentStore.draft(biz.id, id);
  throw new ContentError(!d ? 'Qoralama topilmadi' : STOP[d.status] ?? 'Bekor qilib bo\'lmaydi');
}

/** Matn o'zgarsa — yangi karta (eski kartadagi tugma endi bu matnni joylamaydi) */
export async function editDraft(biz: BusinessRow, id: string, text: string): Promise<ContentDraft> {
  const t = text.replace(/\r\n/g, '\n').trim();
  if (!t) throw new ContentError("Matn bo'sh");
  if (t.length > MAX_DRAFT) throw new ContentError(`Matn ${MAX_DRAFT} belgidan uzun (Telegram chegarasi)`);
  if (!contentStore.setText(biz.id, id, t)) throw new ContentError('Joylangan yoki bekor qilingan postni o\'zgartirib bo\'lmaydi');
  const d = contentStore.draft(biz.id, id)!;
  await card(biz, d, contentStore.settings(biz.id));
  return d;
}

/** Jadval: avtomatik rejimda har kuni bir marta (ertalab), oldingi ishga tushish bugun bo'lmagan bo'lsa */
export function factoryDue(bizId: string, now: Date): boolean {
  const s = contentStore.settings(bizId);
  if (!s.auto || running.has(bizId) || !contentStore.sources(bizId).length) return false;
  if (now.getTime() - (attempts.get(bizId) ?? 0) < RETRY_MS) return false;
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  return !s.lastRun || day(new Date(s.lastRun)) !== day(now);
}
