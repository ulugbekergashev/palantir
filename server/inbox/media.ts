/**
 * Bemor yuborgan matnsiz xabar (rasm, video, stiker, lokatsiya, fayl…): yozishmada «[tur] izoh» bo'lib turadi. Botda asl nusxasi
 * egasiga boradi (bot.ts): AI unga javob yozmaydi va u tayyorlanayotgan javobni to'xtatmaydi (core.ts: botMedia); savol bilan birga
 * kelsa — model belgini ko'radi. Telegram Business va Instagram ham shu ko'rinishda yozadi («[rasm yoki fayl]») — u yerda AI qaror qiladi
 */
import type { InboxMessage } from '../../src/types';

const KINDS = ['rasm', 'video', 'dumaloq video', 'ovozli xabar', 'audio', 'GIF', 'stiker', 'lokatsiya', 'fayl', 'xabar'] as const;
export type MediaKind = (typeof KINDS)[number];
const LABEL = new RegExp(`^\\[(${KINDS.join('|')})[^\\]]*\\]`);

/** «[rasm] izoh» — izohsiz bo'lsa faqat «[rasm]»; detail — turga qo'shimcha (stiker emojisi) */
export const mediaLabel = (kind: MediaKind, caption = '', detail = ''): string => `[${kind}${detail ? ` ${detail}` : ''}]${caption ? ` ${caption}` : ''}`;

export const isMedia = (m: Pick<InboxMessage, 'direction' | 'text'>): boolean => m.direction === 'in' && LABEL.test(m.text);
