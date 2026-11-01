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
export function unsupportedOffer(reply: string, known: string): boolean {
  const norm = (s: string) => joinThousands(s.toLowerCase().replace(/[ʻʼ’‘`´]/g, "'"));
  const r = norm(reply), k = norm(known);
  if ((r.match(OFFER_WORDS) ?? []).some(w => !k.includes(w))) return true;
  for (const m of r.matchAll(MONEY)) if (!k.includes(m[1] ?? m[3])) return true;
  return false;
}
