/**
 * Reklama filtri: mutlaq va'da va isbotsiz ustunlik da'vosini topadi
 * ("Reklama to'g'risida"gi qonun ruhida). Tibbiyot sohasida qo'shimcha qoidalar
 * (natija kafolati, "og'riqsiz"). Yordamchi yozgan post va mijozlarga xabar shu yerdan o'tadi.
 * Ro'yxat dastlabki — yurist bilan tasdiqlanadi.
 */

export interface Issue {
  phrase: string;
  why: string;
  hint: string;
}

interface Rule {
  re: RegExp;
  why: string;
  hint: string;
  /** Faqat tibbiyot sohasida */
  medical?: boolean;
}

const GUARANTEE = "Natijani kafolatlab bo'lmaydi";
const ABSOLUTE = "Mutlaq va'da";
const SUPERIOR = "Isbotsiz ustunlik da'vosi";

const RULES: Rule[] = [
  // Tovarga kafolat (masalan, telefonga 1 yil) — oddiy fakt; natija kafolati esa faqat tibbiyotda taqiqlanadi
  { re: /kafolat\S*/gi, why: GUARANTEE, hint: "«ko'rikdan o'ting», «mutaxassis maslahat beradi» deb yozing", medical: true },
  { re: /100\s*%/g, why: ABSOLUTE, hint: 'Foizni olib tashlang' },
  { re: /\beng (?:yaxshi|zo'r|arzon|sifatli|ishonchli)\S*/gi, why: SUPERIOR, hint: "Aniq faktni yozing: tajriba yili, mijozlar soni" },
  { re: /(?:№|raqamli|raqam)\s*1\b|\b1-raqamli/gi, why: SUPERIOR, hint: 'Reytingni faqat manbasi bilan yozing' },
  { re: /\b(?:abadiy|umrbod|bir umrga)\b/gi, why: ABSOLUTE, hint: "«uzoq xizmat qiladi» deb yozing" },
  { re: /гарант\S*/gi, why: GUARANTEE, hint: '«запишитесь на консультацию»', medical: true },
  // "лучше" (qiyosiy, oddiy gap) emas — "лучший/лучшая…" (ustunlik da'vosi)
  { re: /лучш(?:ий|ая|ее|ие|их|ую|ей)|самы[йея] (?:дешёв|дешев|надёжн|надежн)\S*/gi, why: SUPERIOR, hint: 'Укажите конкретный факт' },
  { re: /навсегда|пожизненн\S*/gi, why: ABSOLUTE, hint: '«служит долго»' },
  { re: /og'riqsiz(?!lantir)\S*/gi, why: "Mutlaq va'da — har bir bemorda turlicha", hint: "«mahalliy og'riqsizlantirish bilan» deb yozing", medical: true },
  { re: /безболезнен\S*|без боли/gi, why: "Mutlaq va'da", hint: '«с местной анестезией»', medical: true },
  { re: /\bdavolaymiz\b|\bshifo (?:beramiz|topasiz)\b/gi, why: "Davolash natijasi va'dasi", hint: "«yordam beramiz», «ko'rikdan o'ting» deb yozing", medical: true },
];

/** Soha tibbiyotmi (stomatologiya, klinika, apteka…) */
export const isMedical = (industry: string) => /stomat|klinik|tibb|shifo|apteka|dorixona|медиц|клиник|стомат|аптек/i.test(industry);

/** O'zbek apostrofining turli ko'rinishlari bitta belgiga keltiriladi */
const normalize = (text: string) => text.replace(/[‘’ʻʼ`]/g, "'");

export function check(text: string, opts: { medical?: boolean } = {}): Issue[] {
  const t = normalize(text);
  const found: Issue[] = [];
  for (const rule of RULES) {
    if (rule.medical && !opts.medical) continue;
    for (const m of t.matchAll(rule.re)) {
      if (!found.some(f => f.phrase.toLowerCase() === m[0].toLowerCase())) found.push({ phrase: m[0], why: rule.why, hint: rule.hint });
    }
  }
  return found;
}
