/**
 * Egasining javobidan o'rganish. Cerebro mijozning umumiy savoliga javob bilmay egasidan so'ragan bo'lsa va egasi mijozga
 * javob yozsa — «Eslab qolaymi?» deb so'raladi. Ha desa, keyingi safar shu savolga Cerebro o'zi javob beradi.
 * Egasi ketma-ket bir necha xabar yozishi mumkin («Ha, bor», «3 oygacha») — ular biroz kutib, bitta javob qilib olinadi.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { replies, type BusinessRow, type LeadRow } from '../db';
import { env } from '../env';
import { MAX_OFFERINGS, MIN_FILE_PRICES } from '../../src/lib/prices';
import { confirmSuggestion, dropSuggestion, filterOptions, filterWarning, pricesFromSuggestion, sampleFromSuggestion, suggestAnswer } from './index';
import { vault as knowledge } from './vault';

/** Savol so'ralganidan keyin shuncha vaqt ichidagi javob o'sha savolga javob deb olinadi */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bundan qisqa gap («Ha», «Hozir») yoki savol bilan tugagan gap javob emas — keyingi xabar kutiladi */
const MIN_ANSWER_CHARS = 12;
/** Egasining ketma-ket xabarlari shuncha kutib birlashtiriladi (odam ikki-uch bo'lib yozadi; mijoz xabarlarini kutishdan uzoqroq) */
const waitMs = () => env.inboxDebounceMs * 5;

type Ask = (html: string, keyboard: InlineKeyboardMarkup) => Promise<unknown>;
const waiting = new Map<string, { timer: NodeJS.Timeout; texts: string[] }>();
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

const keyboard = (id: string) => Markup.inlineKeyboard([[Markup.button.callback('✅ Eslab qol', `ky|${id}`), Markup.button.callback('✖️ Kerak emas', `kn|${id}`)]]).reply_markup;

/** Egasi mijozga yozdi (bot, panel yoki o'z telefoni). ask — egasiga tugmali xabar yuboradi */
export function ownerAnswered(biz: BusinessRow, lead: LeadRow, text: string, ask: Ask): void {
  const key = `${biz.id}:${lead.id}`;
  const batch = waiting.get(key);
  if (batch) clearTimeout(batch.timer);
  const texts = [...(batch?.texts ?? []), text.trim()];
  const timer = setTimeout(() => {
    waiting.delete(key);
    const answer = texts.join('\n');
    if (answer.length < MIN_ANSWER_CHARS || answer.endsWith('?')) return;
    // Taymer ichidagi xato (baza band yoki to'lgan) butun serverni to'xtatmasin
    let suggestion: ReturnType<typeof suggestAnswer> = null;
    try {
      const question = replies.takeQuestion(biz.id, lead.id, new Date(Date.now() - ANSWER_WINDOW_MS).toISOString());
      suggestion = question ? suggestAnswer(biz, question, answer) : null;
    } catch (e) {
      console.error('[miya] javobdan o\'rganib bo\'lmadi:', (e as Error).message);
    }
    if (!suggestion) return;
    ask([
      '🧠 <b>Eslab qolaymi?</b>',
      `Savol: «${esc(suggestion.question)}»`,
      `Javobingiz: «${esc(suggestion.answer)}»`,
      '',
      "Keyingi safar shu savolga o'zim shunday javob beraman. Faqat shu mijozga atalgan gap bo'lsa — «Kerak emas».",
    ].join('\n'), keyboard(suggestion.id)).catch(e => console.error('[miya] egasidan so\'rab bo\'lmadi:', (e as Error).message));
  }, waitMs());
  timer.unref();
  waiting.set(key, { timer, texts });
}

/** Fayl o'qilgach egasiga chiqadigan tugmalar: bilimga qo'shish, (narx bo'lsa) jadvalga olish, namuna qilish, rad etish */
export const fileKeyboard = (id: string, prices: number): InlineKeyboardMarkup => Markup.inlineKeyboard([
  [Markup.button.callback("📚 Bilimga qo'sh", `ky|${id}`), ...(prices >= MIN_FILE_PRICES ? [Markup.button.callback(`💰 Narxlar jadvaliga (${prices})`, `kp|${id}`)] : [])],
  [Markup.button.callback('📄 Hujjat namunasi', `ks|${id}`), Markup.button.callback('✖️ Kerak emas', `kn|${id}`)],
]).reply_markup;

/** done — ish bajarildi (xabar yangilanadi, tugmalar olinadi); bajarilmagan bo'lsa matn — egasiga ogohlantirish, taklif joyida qoladi */
export interface Settled { done: boolean; text: string }

/** Fayldan kelgan taklif: narxlarni jadvalga olish yoki hujjat namunasi qilish. Taklif hali kutayotgan bo'lsagina ishlaydi (aks holda null) */
export function settleFile(biz: BusinessRow, id: string, action: 'prices' | 'sample'): Settled | null {
  const s = knowledge.get(biz.id, id);
  if (!s || s.kind !== 'page' || s.status !== 'suggested') return null;
  if (action === 'sample') {
    try {
      return sampleFromSuggestion(biz, id) ? { done: true, text: `📄 Hujjat namunasi qilib saqladim: «${esc(s.question)}». Shu turdagi hujjat yozishdan oldin unga qarayman.` } : null;
    } catch (e) {
      // Namunalar to'lgan: taklif joyida qoladi
      return { done: false, text: (e as Error).message };
    }
  }
  const r = pricesFromSuggestion(biz, id);
  if (!r) return null;
  const moved = `${r.added} ta yangi, ${r.updated} tasi yangilandi${r.free ? `, ${r.free} ta bepul xizmat faktlarga yozildi` : ''}`;
  return r.dropped
    ? { done: false, text: `Jadval to'ldi (ko'pi bilan ${MAX_OFFERINGS} ta xizmat): ${moved}, ${r.dropped} tasi sig'madi. Keraksiz xizmatlarni o'chirib, tugmani yana bosing.` }
    : { done: true, text: `💰 Narxlar jadvalga tushdi: ${moved}. Manba: «${esc(s.question)}».` };
}

/** Tugma bosildi. Taklif hali kutayotgan bo'lsagina ishlaydi: panelda hal qilingan narsa eski tugma bilan o'zgarmaydi */
export function settleSuggestion(biz: BusinessRow, id: string, remember: boolean): string | null {
  const s = knowledge.get(biz.id, id);
  if (!s || (s.kind !== 'qa' && s.kind !== 'page') || s.status !== 'suggested') return null;
  if (!remember) { dropSuggestion(biz, id); return `✖️ Eslab qolmadim: «${esc(s.question)}»`; }
  const kept = confirmSuggestion(biz, id);
  if (s.kind === 'page') return `📚 Bilimga qo'shdim: «${esc(kept?.question ?? s.question)}». Mijozlar so'rasa, shu sahifadan javob beraman.`;
  const warning = filterWarning(s.answer, filterOptions(biz));
  return `🧠 Eslab qoldim. «${esc(s.question)}» deb so'rashsa, shunday javob beraman:\n<i>${esc(s.answer)}</i>${warning ? `\n\n⚠️ ${esc(warning)}` : ''}`;
}
