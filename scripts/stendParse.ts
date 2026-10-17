/**
 * Stenddagi «taqlid miya» uchun matndan o'qish: sana va vaqt, summa, ism, telefon. Sof mantiq, modelsiz.
 * Bu haqiqiy modelning tushunishi emas — faqat eng ko'p uchraydigan yozilishlar: «ertaga soat 10 da», «juma kuni 15:30»,
 * «2 soatdan keyin», «350 ming», «1,5 mln», «Ali Valiyevni». Tushunilmagani null bo'lib qaytadi (taxmin qilinmaydi).
 */
import { addDays, iso, weekday } from '../src/lib/week';

/** Apostrof bitta ko'rinishda, bo'sh joylar yig'ilgan; katta-kichik harf saqlanadi (ismlar buzilmasin) */
export const clean = (s: string): string => s.replace(/[‘’ʻʼ`´]/g, "'").replace(/[ \t]+/g, ' ').trim();
export const low = (s: string): string => clean(s).toLowerCase();
/** Kichik harfda va apostrofsiz: ismlarni solishtirish uchun («O'ktam» ~ «Oktam») */
export const fold = (s: string): string => low(s).replace(/'/g, '');
export const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const sum = (n: number): string => `${n.toLocaleString('ru').replace(/\s/g, ' ')} so'm`;

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const COUNT: Record<string, number> = { bir: 1, ikki: 2, uch: 3, "to'rt": 4, besh: 5, olti: 6, yetti: 7, sakkiz: 8, "to'qqiz": 9, "o'n": 10, yarim: 0.5 };

export interface When {
  /** Gapda aytilgan sana (YYYY-MM-DD); aytilmagan bo'lsa null */
  date: string | null;
  /** Gapda aniq aytilgan vaqt (HH:MM); aytilmagan bo'lsa null */
  time: string | null;
  /** Kun qismi aniq soatsiz aytilgan bo'lsa («ertalab», «kechqurun») — taxminiy vaqt. Eslatmaga yaraydi, qabulga yozishga emas */
  part: string | null;
  /** Sana hafta kuni bilan aytilgan («juma kuni») */
  weekday: boolean;
  /** Sana va vaqt so'zlari olib tashlangan matn */
  rest: string;
}

const UNIT_AMOUNT = /\d+(?:[.,]\d+)?\s*(?:mln|million|milyon|millon|млн|ming|тыс|k)(?![\p{L}])/giu;
/** Taqvimda bor sana («45-may», «2026-13-45» — yo'q) */
const realDate = (y: number, m: number, d: number): string | null => {
  const at = new Date(y, m - 1, d, 12);
  return at.getFullYear() === y && at.getMonth() === m - 1 && at.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Gapdagi sana va vaqt. `now` — egasi yozgan payt (nisbiy so'zlar shunga qarab hisoblanadi) */
export function parseWhen(text: string, now: Date): When {
  let s = ` ${clean(text).replace(/\u0000/g, '')} `;
  // Telefon raqami va summa vaqtincha yopib qo'yiladi: «…45 12 ga» soat 12 emas, «2.5 million» 2-may emas
  const held: string[] = [];
  const hide = (index: number, length: number): void => {
    held.push(s.slice(index, index + length));
    s = `${s.slice(0, index)}\u0000${String.fromCharCode(64 + held.length)}\u0000${s.slice(index + length)}`;
  };
  const phone = phoneAt(s);
  if (phone) hide(phone.index, phone.length);
  for (const m of [...s.matchAll(UNIT_AMOUNT)].reverse()) hide(m.index, m[0].length);

  const found = { date: null as string | null, time: null as string | null, pm: false, night: false, part: null as string | null, weekday: false };
  /** Topilgan bo'lak matndan olib tashlanadi; `on` false qaytarsa — bu bo'lak sana/vaqt emas ekan, joyida qoladi */
  const take = (re: RegExp, on: (m: RegExpExecArray) => boolean | void): void => {
    const m = re.exec(s);
    if (m && on(m) !== false) s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
  };
  const clock = (h: number, m: number): boolean => {
    if (h > 23 || m > 59) return false;
    found.time = `${pad(h)}:${pad(m)}`;
    return true;
  };
  const day = (value: string | null): boolean => {
    if (!value) return false;
    found.date = value;
    return true;
  };

  // «2 soatdan keyin», «2,5 soatdan keyin», «yarim soatdan keyin», «3 kundan keyin»
  take(/(?<![\p{L}'\d.,])(\d+(?:[.,]\d+)?|bir|ikki|uch|to'rt|besh|olti|yetti|sakkiz|to'qqiz|o'n|yarim)\s*(soat|daqiqa|minut|kun|hafta)(?:dan)?\s+(?:keyin|so'ng|o'tib)/iu, m => {
    const n = COUNT[m[1].toLowerCase()] ?? parseFloat(m[1].replace(',', '.')), unit = m[2].toLowerCase();
    const minutes = unit === 'soat' ? n * 60 : unit === 'kun' ? n * 1440 : unit === 'hafta' ? n * 10080 : n;
    const at = new Date(now.getTime() + Math.round(minutes) * 60_000);
    found.date = iso(at);
    if (unit !== 'kun' && unit !== 'hafta') found.time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  });
  take(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/, m => day(realDate(Number(m[1]), Number(m[2]), Number(m[3]))));
  // «soat 15.30» — vaqt; «15.10» yoki «15.10.2026» — sana
  take(/(?<!soat\s?)(?<![\d.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d.,])/i, m => {
    const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
    return day(realDate(year, Number(m[2]), Number(m[1])));
  });
  take(new RegExp(String.raw`(?<!\d)(\d{1,2})[- ]?(${MONTHS.join('|')}|sentyabr|oktyabr)(?:da|ga|gacha)?(?![\p{L}])`, 'iu'), m => {
    const month = MONTHS.indexOf(m[2].toLowerCase().replace('ty', 't'));
    return day(realDate(now.getFullYear() + (month < now.getMonth() ? 1 : 0), month + 1, Number(m[1])));
  });
  const NEAR: Record<string, number> = { bugun: 0, ertaga: 1, indinga: 2, kecha: -1 };
  take(/(?<![\p{L}'])(bugun|ertaga|indinga|kecha)(?:gi|ga)?(?![\p{L}'])/iu, m => { found.date = iso(addDays(now, NEAR[m[1].toLowerCase()])); });
  take(new RegExp(String.raw`(?<![\p{L}'])(${[...WEEKDAYS].sort((a, b) => b.length - a.length).join('|')})(?:\s+kuni)?(?:ga|da)?(?![\p{L}'])`, 'iu'), m => {
    if (found.date) return;
    found.date = iso(addDays(now, (WEEKDAYS.indexOf(m[1].toLowerCase()) - weekday(now) + 7) % 7));
    found.weekday = true;
  });

  take(/(?<![\p{L}'])(tushdan keyin|kechqurun|kechki payt|kechga|oqshom|kechasi|tunda)(?![\p{L}'])/iu, m => {
    found.night = /kechasi|tunda/i.test(m[1]);
    found.pm = !found.night;
    found.part = found.night ? '21:00' : /tushdan/i.test(m[1]) ? '15:00' : '18:00';
  });
  take(/(?<![\p{L}'])(ertalab(?:ki)?|tushlikda|tushda)(?![\p{L}'])/iu, m => { found.part = /ertalab/i.test(m[1]) ? '09:00' : '13:00'; });
  take(/(?<![\p{L}'])soat\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:larda|lar|da|ga))?(?![\p{L}\d])/iu, m => clock(Number(m[1]), Number(m[2] ?? 0)));
  if (!found.time) take(/(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:da|ga))?(?![\p{L}\d:])/iu, m => clock(Number(m[1]), Number(m[2])));
  if (!found.time) take(/(?<![\d.,])([01]?\d|2[0-3])\.([0-5]\d)\s*(?:da|ga)(?![\p{L}'])/iu, m => clock(Number(m[1]), Number(m[2])));
  if (!found.time) take(/(?<![\d.,])(\d{1,2})\s*yarim(?:da|ga)?(?![\p{L}])/iu, m => clock(Number(m[1]), 30));
  if (!found.time) take(/(?<![\d.,:])(\d{1,2})\s*(?:da|ga)(?![\p{L}'\d])/iu, m => clock(Number(m[1]), 0));

  // «kechqurun 7 da» — 19:00, «tushdan keyin 3 da» — 15:00; «kechasi 11» — 23:00, lekin «kechasi soat 1» — 01:00
  if (found.time) {
    const hour = Number(found.time.slice(0, 2));
    if ((found.pm && hour < 12) || (found.night && hour >= 6 && hour < 12)) found.time = `${pad(hour + 12)}${found.time.slice(2)}`;
  }
  const rest = s.replace(/\u0000(.)\u0000/g, (_, token: string) => held[token.charCodeAt(0) - 65] ?? '').replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  return { date: found.date, time: found.time, part: found.time ? null : found.part, weekday: found.weekday, rest };
}

/**
 * Vazifa muddati. Sana aytilmagan bo'lsa — vaqt hali o'tmagan bo'lsa bugun, o'tgan bo'lsa ertaga; vaqt aytilmagan bo'lsa — kun qismi
 * («kechqurun» — 18:00) yoki 09:00. Bugunga to'g'ri kelgan hafta kuni («seshanba kuni soat 9 da», hozir seshanba 14:00) — keyingi hafta.
 */
export function dueAt(when: When, now: Date): string | null {
  if (!when.date && !when.time && !when.part) return null;
  const time = when.time ?? when.part ?? '09:00';
  const today = iso(now), passed = time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (!when.date) return `${passed ? iso(addDays(now, 1)) : today}T${time}`;
  return `${when.weekday && when.date === today && passed ? iso(addDays(now, 7)) : when.date}T${time}`;
}

export interface Amount { amount: number; rest: string }

/** Gapdagi summa: «350 ming», «1,5 mln», «1 mln 200 ming», «350 000 so'm». Birliksiz 1000 dan kichik son summa emas */
export function parseAmount(text: string): Amount | null {
  const s = clean(text);
  // Telefon raqamining bir bo'lagi («90 123») summa bo'lib ketmasin: qidiruvda uning o'rni yopib qo'yiladi
  const phone = phoneAt(s);
  const seen = phone ? `${s.slice(0, phone.index)}${'#'.repeat(phone.length)}${s.slice(phone.index + phone.length)}` : s;
  const cut = (m: RegExpExecArray, amount: number): Amount => ({
    amount: Math.round(amount),
    rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(),
  });
  const num = (v: string) => parseFloat(v.replace(',', '.'));
  const tail = String.raw`(?:\s*(?:so'm|sum|сум))?`;
  const millions = new RegExp(String.raw`(?<![\d.,+])(\d+(?:[.,]\d+)?)\s*(?:mln|million|milyon|millon|млн)(?:\s*(\d+)\s*(?:ming|тыс))?${tail}(?![\p{L}])`, 'iu').exec(seen);
  if (millions) return cut(millions, num(millions[1]) * 1_000_000 + Number(millions[2] ?? 0) * 1000);
  const thousands = new RegExp(String.raw`(?<![\d.,+])(\d+(?:[.,]\d+)?)\s*(?:ming|тыс|k)${tail}(?![\p{L}])`, 'iu').exec(seen);
  if (thousands) return cut(thousands, num(thousands[1]) * 1000);
  const plain = new RegExp(String.raw`(?<![\d.,+:])(\d{1,3}(?:[ .,]\d{3})+|\d{4,9})${tail}(?![\d:])`, 'i').exec(seen);
  if (plain) { const amount = Number(plain[1].replace(/\D/g, '')); if (amount >= 1000) return cut(plain, amount); }
  return null;
}

const PHONE = /(?<![\d])(\+?\d[\d\s()-]{7,16}\d)(?!\d)/;
/**
 * Matndagi telefon raqamining o'rni. «+» bilan boshlangani yoki 9 raqamli mahalliy («90 123 45 67»), 12 raqamli («998…») yozuv;
 * «100 000 000» kabi summa telefon deb olinmaydi
 */
function phoneAt(text: string): { index: number; length: number; phone: string } | null {
  const m = PHONE.exec(text);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  const local = digits.length === 9 && /^[2-9]/.test(digits) && !/^\d{1,3}( \d{3})+$/.test(m[1].trim());
  if (!(m[1].startsWith('+') && digits.length >= 10 && digits.length <= 13) && !local && !(digits.length === 12 && digits.startsWith('998'))) return null;
  return { index: m.index, length: m[0].length, phone: m[1].trim() };
}

/** Telefon raqami va u olib tashlangan matn */
export function parsePhone(text: string): { phone: string; rest: string } | null {
  const at = phoneAt(text);
  return at && { phone: at.phone, rest: `${text.slice(0, at.index)} ${text.slice(at.index + at.length)}`.replace(/\s+/g, ' ').trim() };
}

/** Gap boshida katta harf bilan yoziladigan, lekin ism bo'lmagan so'zlar */
const NOT_A_NAME = new Set([
  'bugun', 'ertaga', 'indinga', 'kecha', 'soat', 'bemor', 'bemorni', 'mijoz', 'mijozni', 'yangi', 'eslat', 'narx', 'narxlar', 'narxi', 'salom', 'assalomu', 'alaykum', 'iltimos', 'menga', 'shifokor', 'doktor',
  'ismim', 'men', 'telefon', 'telefonim', 'raqamim', 'ha', "yo'q", 'rahmat', 'qabulga', 'klinika', 'ertalab', 'kechqurun', 'tushda', 'kechasi', 'kelaman', 'kelmoqchiman', 'boraman', 'yozing', 'yozilmoqchi',
  'edim', 'tish', 'tishim', 'davolash', 'bilan', 'uchun', 'kerak', 'bormi', 'qancha', 'keyin', 'oldin', ...WEEKDAYS, ...MONTHS,
]);

/**
 * Kichik harf bilan yozilgan ism-familiya («bobur karimov»): aynan ikki-uch so'z, faqat harf, hech biri oddiy so'z emas.
 * Faqat ism so'ralgandan keyingi javobga qo'llanadi — istalgan ikki so'z ism deb olinmasin («ertaga soat», «tish davolash»).
 */
export function plainName(text: string | undefined): string | null {
  const words = clean(text ?? '').split(' ').filter(Boolean);
  const ok = words.length >= 2 && words.length <= 3 && words.every(w => /^[\p{L}']{2,}$/u.test(w) && !NOT_A_NAME.has(w.toLowerCase()));
  return ok ? words.map(capital).join(' ') : null;
}
const FAMILY = /(ov|ev|ova|eva|in|ina|iy|iya|zoda)$/i;
/** «Valiyevni», «Karimovaga» → «Valiyev», «Karimova». Faqat familiya qo'shimchasi aniq bo'lganda («Saida», «Farida» kabi ismlar buzilmasin) */
export function stripCase(word: string): string {
  for (const suffix of ['ning', 'dan', 'ga', 'ni', 'ka', 'qa']) {
    const stem = word.slice(0, -suffix.length);
    if (word.toLowerCase().endsWith(suffix) && stem.length >= 3 && FAMILY.test(stem)) return stem;
  }
  return word;
}

const PATRONYMIC = /(ovich|evich|ovna|evna|o'g'li|qizi)$/i;
/**
 * Ism-familiya: ketma-ket ikkita katta harfli so'z («Ali Valiyevni» → «Ali Valiyev»); uchinchisi faqat otasining ismi bo'lsa olinadi —
 * «Ali Valiyevni Rustamovga yoz» dagi shifokor familiyasi bemor ismiga qo'shilib ketmasin
 */
export function parseName(text: string): string | null {
  for (const m of clean(text).matchAll(/\p{Lu}[\p{L}']+(?:\s+\p{Lu}[\p{L}']+)+/gu)) {
    const words = m[0].split(' ');
    while (words.length && NOT_A_NAME.has(words[0].toLowerCase())) words.shift();
    if (words.length < 2 || NOT_A_NAME.has(words[1].toLowerCase())) continue;
    const family = stripCase(words[1]);
    const third = family === words[1] && words[2] && PATRONYMIC.test(stripCase(words[2])) ? [stripCase(words[2])] : [];
    return [words[0], family, ...third].join(' ');
  }
  return null;
}

/** Ketma-ket yarim soatlik vaqtlar oraliq bo'lib yoziladi: 09:00, 09:30, 10:00 → 09:00–10:00 */
export function ranges(slots: string[]): string {
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const runs = slots.reduce<[string, string][]>((all, s) => {
    const last = all.at(-1);
    return last && minutes(s) - minutes(last[1]) === 30 ? [...all.slice(0, -1), [last[0], s]] : [...all, [s, s]];
  }, []);
  return runs.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ');
}

/** So'zlarning qo'pol «o'zagi»: qo'shimchalar farq qilmasin («borishni» ~ «borish») */
export function stems(text: string, skip: Set<string> = new Set()): string[] {
  return low(text).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(w => w.length > 3 && !skip.has(w)).map(w => w.slice(0, 6));
}

/** `text` so'zlarining qancha qismi `asked` ichida bor (0..1) */
export function overlap(text: string, asked: Set<string>, skip?: Set<string>): number {
  const words = stems(text, skip);
  return words.length ? words.filter(w => asked.has(w)).length / words.length : 0;
}
