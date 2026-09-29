/**
 * Tibbiy reklama filtri: davolash natijasini kafolatlaydigan, isbotsiz ustunlik
 * da'vo qiladigan iboralarni topadi. AI yozgan matn ham, egasi tahrirlagani ham
 * shu yerdan o'tadi. Ro'yxat dastlabki — yurist bilan tasdiqlanadi.
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
}

const GUARANTEE = "Davolash natijasini kafolatlab bo'lmaydi";
const ABSOLUTE = "Mutlaq va'da — har bir bemorda turlicha";
const SUPERIOR = "Isbotsiz ustunlik da'vosi";

const RULES: Rule[] = [
  { re: /kafolat\S*/gi, why: GUARANTEE, hint: "«natija tish holatiga bog'liq» deb yozing" },
  { re: /100\s*%/g, why: ABSOLUTE, hint: 'Foizni olib tashlang' },
  { re: /og'riqsiz(?!lantir)\S*/gi, why: ABSOLUTE, hint: "«mahalliy og'riqsizlantirish bilan» deb yozing" },
  { re: /\beng (?:yaxshi|zo'r|arzon|sifatli)\S*/gi, why: SUPERIOR, hint: 'Aniq faktni yozing: tajriba yili, xizmat turi' },
  { re: /(?:№|raqamli|raqam)\s*1\b|\b1-raqamli/gi, why: SUPERIOR, hint: 'Reytingni faqat manbasi bilan yozing' },
  { re: /\b(?:abadiy|umrbod|bir umrga)\b/gi, why: ABSOLUTE, hint: "«uzoq muddat xizmat qiladi» deb yozing" },
  { re: /гарант\S*/gi, why: GUARANTEE, hint: '«результат зависит от состояния зубов»' },
  { re: /безболезнен\S*|без боли/gi, why: ABSOLUTE, hint: '«с местной анестезией»' },
  // "лучше" (qiyosiy, oddiy gap) emas — "лучший/лучшая…" (ustunlik da'vosi)
  { re: /лучш(?:ий|ая|ее|ие|их|ую|ей)|самы[йея] (?:дешёв|дешев)\S*/gi, why: SUPERIOR, hint: 'Укажите конкретный факт' },
  { re: /навсегда|пожизненн\S*/gi, why: ABSOLUTE, hint: '«служит долго»' },
];

/** O'zbek apostrofining turli ko'rinishlari bitta belgiga keltiriladi */
const normalize = (text: string) => text.replace(/[‘’ʻʼ`]/g, "'");

export function check(text: string): Issue[] {
  const t = normalize(text);
  const found: Issue[] = [];
  for (const rule of RULES) {
    for (const m of t.matchAll(rule.re)) {
      if (!found.some(f => f.phrase.toLowerCase() === m[0].toLowerCase())) found.push({ phrase: m[0], why: rule.why, hint: rule.hint });
    }
  }
  return found;
}
