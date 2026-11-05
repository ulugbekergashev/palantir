/**
 * Marketolog tadqiqotlari — Meta AI javoblari (jurnalda: panel → Marketolog → Hisobotlar). Kontent-reja tuzilganda oxirgilari
 * qo'shiladi (content/plan.ts): Marketolog bozorni o'rganadi, Kontent-meyker shundan mavzu oladi — ikki alohida reja yo'q.
 * Meta AI xato qilishi mumkin: reja uchun g'oya, fakt emas.
 */
import { events } from '../orders/store';

export const TOPICS = { raqobatchilar: 'Raqobatchilar', akkaunt: 'Akkaunt tahlili', video: 'Video tahlili', kontent: 'Kontent', boshqa: 'Savol' } as const;
export type Topic = keyof typeof TOPICS;

/** Rejaga necha kunlik va nechta tadqiqot olinadi, har biridan qancha matn */
const DAYS = 30;
const TAKE = 3;
const CHARS = 1500;
const PREFIXES = Object.values(TOPICS).map(t => `${t}: `);

/** Oxirgi tadqiqotlar (yangisi oldin): sarlavha va javob boshi. Bajarilmaganlari va boshqa yozuvlar (topshiriq, joylash) olinmaydi */
export function recentResearch(bizId: string, now = Date.now()): { title: string; body: string }[] {
  const since = new Date(now - DAYS * 86_400_000).toISOString();
  return events.list(bizId, 'marketolog')
    .filter(e => e.at >= since && PREFIXES.some(p => e.title.startsWith(p)))
    .slice(0, TAKE)
    .map(e => ({ title: e.title, body: e.body.slice(0, CHARS) }));
}
