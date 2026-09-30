import type { Lang } from '../types';

export const DAYS: Record<Lang, string[]> = {
  uz: ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'],
  ru: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
};
export const DAYS_SHORT: Record<Lang, string[]> = {
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
};
const MONTHS: Record<Lang, string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

/** Mahalliy sana → "YYYY-MM-DD" (UTC siljishisiz) */
export const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "YYYY-MM-DD" → tush vaqtidagi mahalliy sana (soat mintaqasi kunni surmasin) */
export const fromIso = (key: string): Date => new Date(`${key}T12:00:00`);

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

/** Hafta kuni: 0 — dushanba … 6 — yakshanba */
export const weekday = (d: Date): number => (d.getDay() + 6) % 7;

export const mondayOf = (d: Date): Date => addDays(d, -weekday(d));

/** "5-oktabr" / "5 октября" */
export const dayLong = (lang: Lang, d: Date): string =>
  lang === 'ru' ? `${d.getDate()} ${MONTHS.ru[d.getMonth()]}` : `${d.getDate()}-${MONTHS.uz[d.getMonth()]}`;

/** "28-sentabr – 4-oktabr" (bir oy ichida: "5 – 11-oktabr") */
export const weekRange = (lang: Lang, monday: Date): string => {
  const sunday = addDays(monday, 6);
  const from = monday.getMonth() === sunday.getMonth() ? String(monday.getDate()) : dayLong(lang, monday);
  return `${from} – ${dayLong(lang, sunday)}`;
};

/** "Seshanba, 10:00" */
export const whenLabel = (lang: Lang, dateKey: string, time: string): string =>
  `${DAYS[lang][weekday(fromIso(dateKey))]}, ${time}`;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Mahalliy vaqt → "YYYY-MM-DDTHH:MM" (vazifa muddati shu ko'rinishda saqlanadi) */
export const stamp = (d: Date): string => `${iso(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** "YYYY-MM-DDTHH:MM" → mahalliy vaqt */
export const fromStamp = (s: string): Date => new Date(`${s}:00`);

/** ISO vaqt → "30-sentabr" (brauzerning uz-UZ formati "M09 30" chiqaradi) */
export const shortDate = (isoTime: string): string => dayLong('uz', new Date(isoTime));

/** "Bugun 14:00", "Ertaga 09:30", "5-oktabr, 10:00" */
export function dueLabel(lang: Lang, due: string, now: Date): string {
  const d = fromStamp(due);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = iso(d);
  if (day === iso(now)) return `${lang === 'ru' ? 'Сегодня' : 'Bugun'} ${time}`;
  if (day === iso(addDays(now, 1))) return `${lang === 'ru' ? 'Завтра' : 'Ertaga'} ${time}`;
  if (day === iso(addDays(now, -1))) return `${lang === 'ru' ? 'Вчера' : 'Kecha'} ${time}`;
  return `${dayLong(lang, d)}, ${time}`;
}
