/**
 * Javobdagi biznes faktlari (E8): ish vaqti, manzil, shifokor ismi — ma'lumotlarda (profil, saqlangan faktlar, bilim, CRM jadvali,
 * bizdan chiqqan xabarlar) yo'q bo'lsa, model uni o'ylab topgan: bunday javob avtomatik ketmasligi kerak. Profilda ish vaqti va manzil
 * maydoni yo'q — ular faqat egasi saqlagan faktda bo'ladi. Toza funksiya (baza yo'q) — sinovda to'g'ridan-to'g'ri chaqiriladi.
 */
const norm = (s: string) => s.normalize('NFKC').replace(/[ʻʼ’‘`´ʹ′]/g, "'");

/** Soat: «9:00», «18.30»; daqiqasiz soat faqat ma'lumotdagi oraliqda («9–18», «с 9 до 18») */
const CLOCK = /(?<![\d.:])([01]?\d|2[0-4])[:.]([0-5]\d)(?![\d])/g;
const SEP = String.raw`\s*(?:[-–—]|dan|дан|до)\s*`;
/** Soat (daqiqasi ixtiyoriy). «2[0-4]» birinchi va keyin raqam yo'q: aks holda «21:00» dan faqat «2» olinardi */
const HH = String.raw`(2[0-4]|[01]?\d)(?:[:.]([0-5]\d))?(?!\d)`;
const RANGE = new RegExp(String.raw`(?<![\d.:])${HH}${SEP}${HH}(?![\d])`, 'g');
/** Javobda ish vaqti deb tushuniladigan gap — kamida bitta soat daqiqasi bilan: «10:00 dan 20:00 gacha», «9:00–18:00», «до 20:00», «20:00 gacha» */
const REPLY_HOURS = new RegExp(String.raw`${HH}${SEP}${HH}|(?:до|по)\s+${HH}|${HH}\s*(?:gacha|гача)`, 'g');

const minutes = (h: string, m: string | undefined) => Number(h) * 60 + Number(m ?? 0);

function knownTimes(known: string): Set<number> {
  const t = norm(known);
  const out = new Set<number>();
  for (const m of t.matchAll(CLOCK)) out.add(minutes(m[1], m[2]));
  for (const m of t.matchAll(RANGE)) { out.add(minutes(m[1], m[2])); out.add(minutes(m[3], m[4])); }
  return out;
}

/** Javobdagi ish vaqti oralig'i soatlari — hammasi ma'lumotda bo'lishi kerak */
function unknownHours(reply: string, known: string): boolean {
  const r = norm(reply).toLowerCase();
  const times: number[] = [];
  for (const m of r.matchAll(REPLY_HOURS)) {
    if (!m[0].match(/\d[:.][0-5]\d/)) continue;
    const parts = m.slice(1).reduce<[string, string | undefined][]>((acc, v, i, all) => (i % 2 === 0 && v !== undefined ? [...acc, [v, all[i + 1]]] : acc), []);
    for (const [h, mm] of parts) times.push(minutes(h, mm));
  }
  if (!times.length) return false;
  const allowed = knownTimes(known);
  return times.some(t => !allowed.has(t));
}

/** Manzil: «Navoiy ko'chasi», «Chilonzor mavzesi», «ул. Навои» — nomi ma'lumotda bo'lishi kerak */
const STREET_UZ = /([\p{L}'-]{3,})\s+(?:shoh ko'chasi|ko'chasi|mavzesi|massivi|mahallasi|tumani|кўчаси|мавзеси|массиви|маҳалласи|тумани)/giu;
const STREET_RU = /(?:ул\.|улица|проспект|просп\.|пр-т|массив|махалля)\s*([\p{L}-]{3,})/giu;
function unknownAddress(reply: string, known: string): boolean {
  const r = norm(reply), k = norm(known).toLowerCase();
  const names = [...r.matchAll(STREET_UZ), ...r.matchAll(STREET_RU)].map(m => m[1].toLowerCase());
  return names.some(n => !k.includes(n));
}

/** Shifokor: «doktor Karimov», «врач Каримова» — ismi profildagi jamoada yoki CRM jadvalida bo'lishi kerak */
const DOCTOR = /(?:^|[^\p{L}])(?:[Dd]r\.?|[Dd]oktor|[Ss]hifokor|[Vv]rach|[Вв]рач|[Дд]октор)\s+(\p{Lu}[\p{L}'-]{2,})/gu;
/** Familiya ayol shaklida ham («Karimova» ↔ «Karimov») — oxirgi «a» olinadi */
const stem = (name: string) => name.toLowerCase().replace(/[aа]$/, '');
function unknownDoctor(reply: string, known: string): boolean {
  const k = norm(known).toLowerCase();
  return [...norm(reply).matchAll(DOCTOR)].some(m => !k.includes(stem(m[1])));
}

/** Ma'lumotda yo'q fakt turi (egasiga izoh uchun) yoki null */
export function unknownFact(reply: string, known: string): string | null {
  if (unknownHours(reply, known)) return 'ish vaqti';
  if (unknownAddress(reply, known)) return 'manzil';
  if (unknownDoctor(reply, known)) return 'shifokor ismi';
  return null;
}
