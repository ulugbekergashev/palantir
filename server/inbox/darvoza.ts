/**
 * Darvoza: mijoz AI'dan uning qo'lidagi ishdan tashqari narsani so'rasa — boshqa mijozlar yoki xodimlar haqidagi ma'lumot,
 * biznesning ichki raqamlari, pulni qaytarish yoki o'tkazish — bunday xabarga javob avtomatik ketmaydi, egasi o'zi hal qiladi.
 * Model ko'rsatmasidagi qoida (replier.ts) birinchi himoya; bu — kod darajasidagi ikkinchisi: model adashsa ham javob qoralama bo'lib qoladi.
 * Toza funksiya (baza yo'q) — sinovda to'g'ridan-to'g'ri chaqiriladi (scripts/check-darvoza.ts).
 */

export type ForbiddenKind = 'others' | 'staff' | 'internal' | 'money';

interface Rule { kind: ForbiddenKind; re: RegExp; note: string }

/** o', g' har xil apostrof bilan yoziladi — bittasiga keltiriladi */
const norm = (s: string): string => s.toLowerCase().replace(/[ʻʼ’‘`´ʹ′]/g, "'");

const RULES: Rule[] = [
  {
    kind: 'others',
    re: /boshqa (mijoz|bemor|xaridor|klient)|(mijoz|bemor|xaridor|klient)lar(ingiz)?(ning)? (ro'yxat|raqam|telefon|kontakt|baza|ism)|kim(lar)? (kelgan|yozilgan|kelib ketgan)|бошқа (мижоз|бемор)|(мижоз|бемор)лар(ингиз)?(нинг)? (рўйхат|рақам|телефон)|(баз|список|контакт|номер)[а-яё]* (ваших |всех |других )?(клиент|пациент|покупател)|(друг|чуж)[а-яё]* (клиент|пациент|покупател)|кто (записан|приходил|у вас лечится)/,
    note: "Mijoz boshqa mijozlar haqida ma'lumot so'rayapti — bunday ma'lumot hech kimga berilmaydi, o'zingiz javob bering",
  },
  {
    kind: 'staff',
    re: /(doktor|vrach|shifokor|xodim|ishchi|direktor|egasi|hamshira)[a-z']* (shaxsiy|uy|o'z) (raqam|telefon|manzil|nomer)|(xodim|doktor|vrach|shifokor|ishchi)[a-z']* (oylig|maosh)|(личн|домашн)[а-яё]* (номер|телефон|адрес)|(зарплат|оклад)[а-яё]* (врач|доктор|сотрудник|персонал)|(шахсий|уй) (рақам|телефон|манзил)/,
    note: "Mijoz xodimning shaxsiy ma'lumotini so'rayapti — bunday ma'lumot berilmaydi, o'zingiz javob bering",
  },
  {
    kind: 'internal',
    re: /daromad|tushum(ingiz)?|oborot|oylik (savdo|aylanma)|qancha (ishlaysiz|topasiz|pul topasiz)|nechta mijoz(ingiz|lar(ingiz)?)? bor|даромад|тушум|выручк|оборот (компании|клиники|магазина|фирмы|у вас)|прибыль|сколько (вы )?зарабатыва|сколько у вас (клиентов|пациентов)/,
    note: "Mijoz biznesning ichki raqamlarini so'rayapti — ular mijozga aytilmaydi, o'zingiz javob bering",
  },
  {
    kind: 'money',
    re: /pul(ni|im(ni)?|imiz(ni)?)? (qaytar|o'tkaz|tashla|jo'nat)|qaytarib (bering|berasiz|beringlar)|vozvrat|kartam(ga|ni)|karta(ngiz)? (raqam|nomer)|пул(ни|им(ни)?)? (қайтар|ўтказ|ташла)|қайтариб беринг|возврат|верн[а-яё]* (деньг|оплат|предоплат|сумм)|перевед[а-яё]*|перевод[а-яё]* (на карт|денег|средств)|номер (вашей )?карт/,
    note: "Mijoz pulni qaytarish, o'tkazish yoki karta haqida so'rayapti — pul masalasini faqat siz hal qilasiz",
  },
];

/** Mijoz yozganida taqiqlangan so'rov bormi: birinchi topilgan tur va egasiga izoh (yo'q bo'lsa — null) */
export function forbiddenAsk(customerText: string): { kind: ForbiddenKind; note: string } | null {
  const t = norm(customerText);
  const hit = RULES.find(r => r.re.test(t));
  return hit ? { kind: hit.kind, note: hit.note } : null;
}
