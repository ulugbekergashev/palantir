/**
 * Summa so'z bilan (shartnoma, hisob-varaq, dalolatnomada majburiy): «Bir million besh yuz ming so'm» / «Один миллион пятьсот тысяч сумов».
 * Modelga hisoblatilmaydi — u {{words:1500000}} belgisini qo'yadi, matn shu yerda yoziladi (xato bo'lmasin).
 */
import type { Lang } from '../../src/types';

const UZ_ONES = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const UZ_TENS = ['', "o'n", 'yigirma', "o'ttiz", 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', "to'qson"];
const UZ_SCALES = ['', 'ming', 'million', 'milliard', 'trillion'];

/** 0–999 o'zbekcha: «bir yuz yigirma besh» (rasmiy hujjatlardagidek «bir yuz») */
function uzTriple(n: number): string[] {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return [h ? `${UZ_ONES[h]} yuz` : '', UZ_TENS[t], UZ_ONES[o]].filter(Boolean);
}

const RU_ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
/** [один, два–четыре, пять+]; тысяча — женского рода */
const RU_SCALES: { forms: [string, string, string]; female: boolean }[] = [
  { forms: ['', '', ''], female: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], female: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], female: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], female: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], female: false },
];

/** Ruscha son shakli: 1 сум, 2 сума, 5 сумов (11–14 — «сумов») */
export function ruForm(n: number, forms: [string, string, string]): string {
  const d = n % 100, u = n % 10;
  if (d >= 11 && d <= 14) return forms[2];
  return u === 1 ? forms[0] : u >= 2 && u <= 4 ? forms[1] : forms[2];
}

function ruTriple(n: number, female: boolean): string[] {
  const h = Math.floor(n / 100), rest = n % 100, t = Math.floor(rest / 10), o = rest % 10;
  const ones = female ? RU_ONES_F : RU_ONES_M;
  return [RU_HUNDREDS[h], ...(t === 1 ? [RU_TEENS[o]] : [RU_TENS[t], ones[o]])].filter(Boolean);
}

/** Butun son so'z bilan (0 — «nol» / «ноль»). Manfiy va kasr qism qabul qilinmaydi */
export function numberWords(n: number, lang: Lang): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return lang === 'ru' ? 'ноль' : 'nol';
  const groups: number[] = [];
  for (let v = value; v > 0; v = Math.floor(v / 1000)) groups.push(v % 1000);
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (lang === 'ru') {
      const scale = RU_SCALES[i] ?? RU_SCALES[0];
      words.push(...ruTriple(g, scale.female), ...(i ? [ruForm(g, scale.forms)] : []));
    } else {
      words.push(...uzTriple(g), ...(i ? [UZ_SCALES[i]] : []));
    }
  }
  return words.join(' ');
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Summa so'z bilan, valyuta bilan: «Bir million besh yuz ming so'm» / «Один миллион пятьсот тысяч сумов» */
export function amountWords(n: number, lang: Lang): string {
  const value = Math.floor(Math.abs(n));
  return capital(`${numberWords(value, lang)} ${lang === 'ru' ? ruForm(value, ['сум', 'сума', 'сумов']) : "so'm"}`);
}

/**
 * {{words:1500000}} → «Bir million besh yuz ming so'm». Valyuta so'zning ichida: model belgidan keyin yana «so'm» yozsa — tashlanadi
 * («so'm so'm» chiqmasin). Raqami noto'g'ri belgi o'zgarishsiz qoladi (tekshiruv ushlaydi)
 */
export function fillWords(markdown: string, lang: Lang): string {
  return markdown.replace(/\{\{\s*words\s*:\s*([\d\s.,]+?)\s*\}\}(\s*(?:so['‘’ʻ]?m|сум(?:ов|а)?)(?![\p{L}'‘’ʻ]))?/gu, (all, raw: string) => {
    const n = Number(raw.replace(/[\s.,]/g, ''));
    return Number.isSafeInteger(n) ? amountWords(n, lang) : all;
  });
}
