/**
 * Mijozga ketadigan javobdagi pul va va'dalar: ma'lumotlarda yo'q narx, foiz yoki chegirma/bepul/sovg'a — avtomatik ketmasligi kerak.
 * Toza funksiya (baza yo'q) — sinovda to'g'ridan-to'g'ri chaqiriladi.
 */
/** Minglik ajratgichlar olib tashlanadi: «350 000», «350.000» → «350000» */
const joinThousands = (s: string) => s.replace(/(\d)[\s.,'](?=\d{3}(\D|$))/g, '$1');
const OFFER_WORDS = /chegirm|skidk|скидк|aksiya|акци|bepul|бесплат|tekin|текин|sovg'a|совға|подар|bonus|бонус/g;
/** Pul miqdori: valyuta yoki ming/mln bilan, foiz, yoki 5+ xonali son */
const MONEY = /(\d+(?:[.,]\d+)?)\s*(%|ming|mln|million|млн|тыс|минг|so'm|сум|сўм|\$|usd|у\.е)|(\d{5,})/g;
/**
 * Javobda ma'lumotlarda (known) yo'q narx, foiz yoki chegirma/bepul/sovg'a so'zi bormi — bunday javob avtomatik ketmasligi kerak.
 * Yumshoq tekshiruv: son yoki so'z ma'lumotlarda biror joyda uchrasa — bor deb hisoblanadi
 */
/**
 * Raqamni bir xil ko'rinishga keltirish: to'liq kenglikdagi (８６００) va arab-hind (٩٠) raqamlari — oddiy raqam, apostroflar bitta.
 * Model raqamni boshqa yozuvda bersa ham tekshiruvdan o'tib ketmasin.
 */
const foldDigits = (s: string) => s.normalize('NFKC')
  .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0))
  .replace(/[ʻʼ’‘`´]/g, "'");
/**
 * Raqam emas, lekin raqamlardan iborat bo'laklar — matndan uziladi (o'rniga chegara qo'yiladi), aks holda yonma-yon ikki son bitta
 * uzun «raqam» bo'lib qoladi: gap va ro'yxat chegarasi («150 000. 20 noyabr»), oraliq («150 000 - 200 000», «90 123 45 67 / 93 …»),
 * sana (12.11.2026, 2026-11-12), soat (9.00, 14:30), narx («200 000 so'm», «4,5 mln»)
 */
const NOT_A_NUMBER = [
  /[.,;:]\s|\s[-–—−/|]\s/g,
  /(?<!\d)\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?!\d)|(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g,
  /(?<![\d.:])([01]?\d|2[0-3])[.:][0-5]\d(?![\d.:]?\d)/g,
  /\d[\d\s.,]*\s*(?:so'm|сум|сўм|ming|минг|mln|млн|million|тыс|\$|usd|у\.е)/gi,
];
/** Raqam: guruhlar orasida bitta-ikkita ajratgich — bo'sh joy, chiziqcha, nuqta, slesh, ikki nuqta, nuqta-belgi, qavs («+998 (90) 123-45-67») */
const NUMBER_RUN = /\+?\(?\d+(?:[\s\-–—−./:·•_()]{1,2}\d+)*/g;
/** Telefon (7+ raqam), karta (16), hisob (20) — shundan qisqasi narx yoki soat */
const MIN_DIGITS = 7;
/** Bitta telefonning yozilishlari bir xil bo'ladi: +998 90 123 45 67 = 90 123 45 67 = 8 90 123 45 67 */
const canonical = (d: string) => (d.length === 12 && d.startsWith('998') ? d.slice(3) : d.length === 10 && d.startsWith('8') ? d.slice(1) : d);

const numbersIn = (s: string): string[] => {
  const text = NOT_A_NUMBER.reduce((t, re) => t.replace(re, ' | '), foldDigits(s));
  return [...text.matchAll(NUMBER_RUN)].map(m => m[0].replace(/\D/g, '')).filter(d => d.length >= MIN_DIGITS).map(canonical);
};

/**
 * Javobda ma'lumotlarda (known) yo'q telefon, karta yoki hisob raqami bormi. Model raqamni o'ylab topsa (Kommo AI agentida bo'lgan:
 * mijozlar begona hisobga pul o'tkazgan), javob avtomatik ketmasligi kerak. Raqam ma'lumotlardagisi bilan **aynan** bir xil bo'lishi
 * kerak (yozilishi boshqa bo'lsa ham) — bilimdagi kartaning bir bo'lagi «bilimda bor» hisoblanmaydi.
 */
export function unknownNumber(reply: string, known: string): boolean {
  const allowed = new Set(numbersIn(known));
  return numbersIn(reply).some(d => !allowed.has(d));
}

export function unsupportedOffer(reply: string, known: string): boolean {
  const norm = (s: string) => joinThousands(s.toLowerCase().replace(/[ʻʼ’‘`´]/g, "'"));
  const r = norm(reply), k = norm(known);
  if ((r.match(OFFER_WORDS) ?? []).some(w => !k.includes(w))) return true;
  for (const m of r.matchAll(MONEY)) if (!k.includes(m[1] ?? m[3])) return true;
  return false;
}
