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

/**
 * Soha so'zlari — hamma biznes uchun bitta ro'yxat (klinika, o'quv markazi, do'kon, restoran, xizmat, ishlab chiqarish).
 * Mijoz: kim xizmat oladi. Xodim: kim xizmat ko'rsatadi.
 */
const CLIENT_UZ = "mijoz|bemor|xaridor|klient|o'quvchi|talaba|buyurtmachi|mehmon|abonent|a'zo";
const CLIENT_CYR = 'мижоз|бемор|харидор|ўқувчи|талаба|буюртмачи';
const CLIENT_RU = 'клиент|пациент|покупател|учени|студент|заказчик|гост|абонент';
const STAFF_UZ = "doktor|vrach|shifokor|hamshira|xodim|ishchi|direktor|egasi|o'qituvchi|ustoz|mentor|sotuvchi|menejer|kuryer|haydovchi|usta|oshpaz|ofitsiant|administrator";
const STAFF_RU = 'врач|доктор|сотрудник|персонал|учител|преподавател|продав|менеджер|курьер|водител|мастер|повар|официант|администратор';

const RULES: Rule[] = [
  {
    kind: 'others',
    re: new RegExp(
      `boshqa (${CLIENT_UZ})|(${CLIENT_UZ})lar(ingiz)?(ning)? (ro'yxat|raqam|telefon|kontakt|baza|ism|manzil)|kim(lar)? (kelgan|yozilgan|kelib ketgan|buyurtma bergan|sotib olgan|o'qiydi)`
      + `|бошқа (${CLIENT_CYR})|(${CLIENT_CYR})лар(ингиз)?(нинг)? (рўйхат|рақам|телефон)`
      + `|(баз|список|контакт|номер|адрес)[а-яё]* (ваших |всех |других )?(${CLIENT_RU})|(друг|чуж)[а-яё]* (${CLIENT_RU})|кто (у вас )?(записан|приходил|лечится|заказывал|покупал|учится)`,
    ),
    note: "Mijoz boshqa mijozlar haqida ma'lumot so'rayapti — bunday ma'lumot hech kimga berilmaydi, o'zingiz javob bering",
  },
  {
    kind: 'staff',
    re: new RegExp(
      `(${STAFF_UZ})[a-z']* (shaxsiy|uy|o'z) (raqam|telefon|manzil|nomer)|(${STAFF_UZ})[a-z']* (oylig|maosh)`
      + `|(личн|домашн)[а-яё]* (номер|телефон|адрес)|(зарплат|оклад)[а-яё]* (${STAFF_RU})|(шахсий|уй) (рақам|телефон|манзил)`,
    ),
    note: "Mijoz xodimning shaxsiy ma'lumotini so'rayapti — bunday ma'lumot berilmaydi, o'zingiz javob bering",
  },
  {
    kind: 'internal',
    re: /daromad|tushum(ingiz)?|oborot|oylik (savdo|aylanma)|qancha (ishlaysiz|topasiz|pul topasiz)|nechta (mijoz|o'quvchi|xaridor|buyurtma)(n?giz|ingiz|lar(ingiz)?)? bor|kuniga nechta (mijoz|buyurtma|xaridor)|даромад|тушум|выручк|оборот (компании|клиники|магазина|фирмы|ресторана|центра|у вас)|прибыль|сколько (вы )?зарабатыва|сколько у вас (клиентов|пациентов|учеников|студентов|заказов|покупателей)/,
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
