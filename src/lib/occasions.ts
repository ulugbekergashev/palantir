import type { Lang } from '../types';
import { addDays, iso } from './week';

/** Bayram va muhim sanalar: shu haftaga to'g'ri kelsa, paketga tabrik posti qo'shiladi */
export interface Occasion {
  id: string;
  date: string;
  /** Stomatologiyaga bevosita aloqador (Tabassum kuni, Og'iz salomatligi kuni) — birinchi tanlanadi */
  dental: boolean;
  /** Xotira kuni kabi sanalarda — bezaksiz, sokin uslub */
  solemn: boolean;
  title: Record<Lang, string>;
  lines: Record<Lang, string[]>;
}

type Def = Omit<Occasion, 'date'> & { at: (year: number) => Date };

const on = (month: number, day: number) => (year: number) => new Date(year, month - 1, day, 12);

/** Oktabrning birinchi jumasi — Butunjahon tabassum kuni */
const firstFridayOfOctober = (year: number) => {
  const d = new Date(year, 9, 1, 12);
  return addDays(d, (5 - d.getDay() + 7) % 7);
};

const DEFS: Def[] = [
  {
    id: 'new-year', at: on(1, 1), dental: false, solemn: false,
    title: { uz: 'Yangi yil muborak!', ru: 'С Новым годом!' },
    lines: { uz: ["Yangi yilda sizga sog'lik va shodlik tilaymiz", "Tabassumingiz hech qachon so'nmasin"], ru: ['Желаем здоровья и радости в новом году', 'Пусть ваша улыбка всегда сияет'] },
  },
  {
    id: 'defenders', at: on(1, 14), dental: false, solemn: false,
    title: { uz: 'Vatan himoyachilari kuni muborak!', ru: 'С Днём защитников Родины!' },
    lines: { uz: ['Tinchligimiz posbonlariga rahmat', "Sog'lik va kuch-quvvat tilaymiz"], ru: ['Спасибо тем, кто бережёт наш мир', 'Желаем здоровья и сил'] },
  },
  {
    id: 'women', at: on(3, 8), dental: false, solemn: false,
    title: { uz: '8-mart muborak!', ru: 'С 8 Марта!' },
    lines: { uz: ['Aziz ayollar, tabassumingiz dunyoni chiroyli qiladi', "Sizga baxt va sog'lik tilaymiz"], ru: ['Милые женщины, ваша улыбка делает мир красивее', 'Желаем счастья и здоровья'] },
  },
  {
    id: 'oral-health', at: on(3, 20), dental: true, solemn: false,
    title: { uz: "Og'iz bo'shlig'i salomatligi kuni", ru: 'Всемирный день здоровья полости рта' },
    lines: { uz: ["Og'iz salomatligi — butun organizm salomatligi", "Yiliga 2 marta ko'rikdan o'tishni unutmang"], ru: ['Здоровье рта — здоровье всего организма', 'Не забывайте об осмотре 2 раза в год'] },
  },
  {
    id: 'navruz', at: on(3, 21), dental: false, solemn: false,
    title: { uz: "Navro'z muborak!", ru: 'С праздником Навруз!' },
    lines: { uz: ['Bahor bayrami xonadoningizga fayz olib kelsin', "Sog'lik va quvonch tilaymiz"], ru: ['Пусть весна принесёт радость в ваш дом', 'Желаем здоровья и счастья'] },
  },
  {
    id: 'memory', at: on(5, 9), dental: false, solemn: true,
    title: { uz: 'Xotira va qadrlash kuni', ru: 'День памяти и почестей' },
    lines: { uz: ['Xotiralarni asraymiz, qadrlaymiz', "Keksalarimizni e'zozlaylik"], ru: ['Помним и чтим', 'Берегите старших'] },
  },
  {
    id: 'children', at: on(6, 1), dental: false, solemn: false,
    title: { uz: 'Bolalarni himoya qilish kuni', ru: 'С Днём защиты детей!' },
    lines: { uz: ['Bolalar tabassumi — eng qimmatli boylik', "Farzandlaringizga sog'lik tilaymiz"], ru: ['Детская улыбка — самое ценное', 'Здоровья вашим детям'] },
  },
  {
    id: 'independence', at: on(9, 1), dental: false, solemn: false,
    title: { uz: 'Mustaqillik kuni muborak!', ru: 'С Днём независимости!' },
    lines: { uz: ['Vatanimizga tinchlik va farovonlik tilaymiz', "Bayramingiz qutlug' bo'lsin"], ru: ['Мира и процветания нашей Родине', 'С праздником!'] },
  },
  {
    id: 'teachers', at: on(10, 1), dental: false, solemn: false,
    title: { uz: 'Ustozlar kuni muborak!', ru: 'С Днём учителя!' },
    lines: { uz: ['Bilim va mehr bergan ustozlarimizga rahmat', "Sizga sog'lik va uzoq umr tilaymiz"], ru: ['Спасибо учителям за знания и заботу', 'Желаем здоровья и долгих лет'] },
  },
  {
    id: 'smile-day', at: firstFridayOfOctober, dental: true, solemn: false,
    title: { uz: 'Butunjahon tabassum kuni!', ru: 'Всемирный день улыбки!' },
    lines: { uz: ['Tabassum — eng chiroyli bezak', "Uni sog'lom saqlashga yordam beramiz"], ru: ['Улыбка — самое красивое украшение', 'Мы поможем сохранить её здоровой'] },
  },
  {
    id: 'constitution', at: on(12, 8), dental: false, solemn: false,
    title: { uz: 'Konstitutsiya kuni muborak!', ru: 'С Днём Конституции!' },
    lines: { uz: ['Bayramingiz bilan qutlaymiz', 'Yurtimizga tinchlik tilaymiz'], ru: ['Поздравляем с праздником', 'Мира нашей стране'] },
  },
];

/** Haftadagi sanalar: avval stomatologiyaga aloqadorlari, keyin sana tartibida */
export function occasionsInWeek(monday: Date): Occasion[] {
  const from = iso(monday);
  const to = iso(addDays(monday, 6));
  const years = [...new Set([monday.getFullYear(), addDays(monday, 6).getFullYear()])];
  const found: Occasion[] = [];
  for (const y of years) {
    for (const { at, ...rest } of DEFS) {
      const date = iso(at(y));
      if (date >= from && date <= to) found.push({ ...rest, date });
    }
  }
  return found.sort((a, b) => Number(b.dental) - Number(a.dental) || a.date.localeCompare(b.date));
}
