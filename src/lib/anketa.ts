/**
 * Anketa: biznes egasi o'rnatuvchi kelishidan OLDIN o'z telefonida to'ldiradi (manzil, ish vaqti, narxlar, ko'p so'raladigan savollar,
 * nimalari bor). Parol va kalit anketaga yozilmaydi — ular faqat klinika kompyuterida, ulash ustasida kiritiladi.
 * Bu fayl — umumiy turlar va sof yordamchilar (panel formasi ham, server ham ishlatadi).
 */

export const DAYS = [
  ['mon', 'Dushanba', 'Du'], ['tue', 'Seshanba', 'Se'], ['wed', 'Chorshanba', 'Ch'], ['thu', 'Payshanba', 'Pa'],
  ['fri', 'Juma', 'Ju'], ['sat', 'Shanba', 'Sh'], ['sun', 'Yakshanba', 'Ya'],
] as const;
export type DayKey = typeof DAYS[number][0];
/** Ish vaqti: «09:00–19:00», «yopiq» (dam olish) yoki bo'sh — egasi yozmagan */
export type Hours = Record<DayKey, string>;
export const CLOSED = 'yopiq';

export type CrmKind = 'dentacrm' | 'other' | 'none' | '';

export interface AnketaData {
  name: string;
  industry: string;
  ownerName: string;
  /** Qabulxona (mijozlar qo'ng'iroq qiladigan) telefoni */
  phone: string;
  address: string;
  /** Mo'ljal: «Chilonzor metrosi yonida» */
  landmark: string;
  hours: Hours;
  /** Biznes haqida bir-ikki gap: nima qiladi, nimasi bilan farq qiladi */
  about: string;
  /** Har qatorda bitta odam: «Dr. Rahimova — terapevt, 12 yil» */
  team: string;
  /** Narxlar: har qatorda «xizmat — narx» (Excel'dan nusxalab qo'ysa ham bo'ladi) */
  prices: string;
  /** Tayyor savollarga javoblar: savol id → javob */
  answers: Record<string, string>;
  instagram: string;
  /** Mijozlar yozadigan Telegram raqami (shaxsiy Telegram'ni ulash uchun) */
  telegramPhone: string;
  crm: CrmKind;
  cameras: number;
  cameraBrand: string;
  /** O'rnatuvchiga qo'shimcha gap */
  notes: string;
}

export type AnketaStatus = 'new' | 'draft' | 'done';

export const emptyHours = (): Hours => ({ mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' });
export const emptyAnketa = (industry = ''): AnketaData => ({
  name: '', industry, ownerName: '', phone: '', address: '', landmark: '', hours: emptyHours(), about: '', team: '', prices: '',
  answers: {}, instagram: '', telegramPhone: '', crm: '', cameras: 0, cameraBrand: '', notes: '',
});

/** Egasi yozmagan kunlar (dam olish ham javob: «yopiq» yozilgan kun bo'sh emas) */
export const missingDays = (h: Hours): DayKey[] => DAYS.map(d => d[0]).filter(k => !h[k].trim());

const shown = (v: string): string => (v.trim().toLowerCase() === CLOSED ? 'dam olish' : v.trim());

/** Ish vaqti bitta qatorda, ketma-ket bir xil kunlar birlashadi: «Du–Ju 09:00–19:00, Sh 09:00–15:00, Ya dam olish» */
export function hoursText(h: Hours): string {
  const parts: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const v = h[DAYS[i][0]].trim();
    let j = i;
    while (j + 1 < DAYS.length && h[DAYS[j + 1][0]].trim().toLowerCase() === v.toLowerCase()) j++;
    if (v) parts.push(`${DAYS[i][2]}${j > i ? `–${DAYS[j][2]}` : ''} ${shown(v)}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Anketa kodi: «K7QM-2XPA» — telefonda yozish oson (o'xshash harflar yo'q) */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ANKETA_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const cleanCode = (raw: string): string => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : raw.trim().toUpperCase();
};
