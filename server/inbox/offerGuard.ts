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
/** Raqam ko'rinishidagi bo'lak: raqamlar orasida bo'sh joy, chiziqcha, nuqta, qavs bo'lishi mumkin («+998 (90) 123-45-67», «8600 1234 5678 9012») */
const NUMBER_RUN = /\+?\(?\d[\d\s\-().]*\d/g;
/** Sana yoki yillar oralig'i — raqam emas: 12.11.2026, 12/11/26, 2026-11-12, 2025–2026 */
const DATE_LIKE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{4}\s*[-–]\s*\d{4})$/;
/** Telefon (7+ raqam), karta (16), hisob (20) — shundan qisqasi narx yoki soat */
const MIN_DIGITS = 7;
/** Bir raqamning ikki yozilishi orasidagi farq: davlat kodi (998) yoki boshidagi 0/8 */
const PREFIX_SLACK = 3;

const digitRuns = (s: string, skipDates: boolean): string[] => [...s.matchAll(NUMBER_RUN)]
  .map(m => m[0].trim())
  .filter(run => !(skipDates && DATE_LIKE.test(run)))
  .map(run => run.replace(/\D/g, ''))
  .filter(d => d.length >= MIN_DIGITS);

/**
 * Javobda ma'lumotlarda (known) yo'q telefon, karta yoki hisob raqami bormi. Model raqamni o'ylab topsa (Kommo AI agentida bo'lgan:
 * mijozlar begona hisobga pul o'tkazgan), javob avtomatik ketmasligi kerak. Bir raqam boshqacha yozilsa ham («+998 90 123 45 67» va
 * «901234567») bitta deb hisoblanadi; mijozning o'zi aytgan raqami ham known ichida keladi.
 */
export function unknownNumber(reply: string, known: string): boolean {
  const knownRuns = digitRuns(known, false);
  return digitRuns(reply, true).some(d => !knownRuns.some(k => k.includes(d) || (d.includes(k) && d.length - k.length <= PREFIX_SLACK)));
}

export function unsupportedOffer(reply: string, known: string): boolean {
  const norm = (s: string) => joinThousands(s.toLowerCase().replace(/[ʻʼ’‘`´]/g, "'"));
  const r = norm(reply), k = norm(known);
  if ((r.match(OFFER_WORDS) ?? []).some(w => !k.includes(w))) return true;
  for (const m of r.matchAll(MONEY)) if (!k.includes(m[1] ?? m[3])) return true;
  return false;
}
