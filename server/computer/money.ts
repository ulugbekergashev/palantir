/**
 * Pul zonasi — egasi qarori (2026-11-16): bank, to'lov, pul o'tkazish va xaridga AI agent o'zi kirmaydi. Bu kodda yopilgan, egasining
 * tugmasi bilan ham ochilmaydi (riskyClick'dagi «so'rab bajarish»dan farqli). AI pul haqida faqat ma'lumot, hisobot va hisob-kitob beradi.
 * Sof funksiyalar — sinovda bevosita tekshiriladi (scripts/check-money-zone.ts).
 *   moneyTask   — kompyuter topshirig'i matni pulga oidmi (boshlanmaydi)
 *   moneyHost   — bank va to'lov saytlari (brauzer so'rovi ketmaydi)
 *   moneyAction — to'lash, o'tkazish, sotib olish tugmalari (bosilmaydi)
 *   moneyWindow — «butun kompyuter» rejimida ochiq oyna bank yoki to'lov dasturimi (bosish va yozish yo'q)
 *   cardLike    — karta raqamiga o'xshash matn (hech qayerga yozilmaydi)
 */

/** Javob matni: modelga va egasiga — nega to'xtadi */
export const MONEY_ZONE = "Pul bilan bog'liq ish (bank, to'lov, pul o'tkazish, xarid) — AI buni qilmaydi, egasi o'zi qiladi. Ma'lumot, hisobot yoki hisob-kitob kerak bo'lsa — shuni so'rang";

/** O'zbekiston banklari, to'lov tizimlari va xalqaro pul xizmatlari (nomida «bank» bo'lgan har qanday sayt ham — pastda) */
const MONEY_SITES = [
  'click.uz', 'payme.uz', 'paycom.uz', 'paynet.uz', 'uzcard.uz', 'humocard.uz', 'humo.uz', 'oson.uz', 'upay.uz', 'apelsin.uz', 'uzumbank.uz', 'mkb.uz',
  'nbu.uz', 'sqb.uz', 'xb.uz', 'ofb.uz', 'kdb.uz', 'infinbank.com', 'orientfinans.uz', 'garant.uz',
  'paypal.com', 'stripe.com', 'wise.com', 'payoneer.com', 'revolut.com', 'westernunion.com', 'koronapay.com', 'zolotayakorona.ru',
  'binance.com', 'bybit.com', 'coinbase.com', 'okx.com',
];
const siteMatch = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

export function moneyHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (MONEY_SITES.some(s => siteMatch(host, s))) return true;
  // kapitalbank.uz, ipakyulibank.uz, online.hamkorbank.uz, ibank.… — nomida «bank» bo'lgan har qanday qism
  return host.split('.').some(label => label.includes('bank'));
}

/** Tugma nomi: to'lash, pul o'tkazish, sotib olish (o'zbek, rus, ingliz). Faqat nomga qaraladi */
const MONEY_ACTION = new RegExp([
  "to'?la(sh|ng|moq|yman|ndi|b)?\\b", "to'?lan(sin|adi|di|gan|ish)", "to'?lov", "pul o'?tkaz", "o'?tkazma", "sotib ol", "xarid qil", "savatga", "kartaga (pul|o'?tkaz)", "kartadan (pul|o'?tkaz|yech)", "hisobni to'ldir",
  "оплат", "плат[её]ж", "заплат", "перев(ест|ед|од)[а-яё]*.{0,15}(деньг|сумм|средств|на карт)", "отправ[а-яё]*.{0,10}деньг", "купить", "(?<![а-яё])купи(те)?(?![а-яё])", "в корзину", "пополнить", "снять деньги",
  "\\bpay\\b", "pay now", "payment", "purchase", "\\bbuy\\b", "checkout", "add to cart", "transfer", "withdraw", "deposit", "top ?up", "send money",
].join('|'), 'i');

export const moneyAction = (name: string): boolean => MONEY_ACTION.test(name.replace(/[‘’ʻʼ`]/g, "'"));

/** Tugma yoki havola nomidan uzun matn — bu tugma emas, butun blok (oyna, kartochka): ichida «to'lov» so'zi bo'lsa ham bosish to'lov emas */
const CONTROL_NAME_MAX = 100;

/**
 * Bosilayotgan yoki Enter berilayotgan element — to'lov tugmasimi. 2026-11-19: texnomart.uz da hudud tanlash oynasi faol edi, uning butun
 * matni «nom» bo'lib keldi va qidiruvdagi Enter «pul zonasi» deb to'xtatildi
 */
export const moneyControl = (name: string): boolean => name.trim().length <= CONTROL_NAME_MAX && moneyAction(name);

/** Gap bo'lagi tugaydigan joy: nuqta, vergul, ikki nuqta, tire, qavs yoki «but» — undan keyingi so'rov taqiqqa qo'shilib ketmasin */
const CLAUSE = "(?:(?!\\bbut\\b|\\bно\\b|\\blekin\\b)[^.;:!?\\n,—–()])*";

/**
 * Taqiq va eslatma — so'rov emas (2026-11-19: model topshiriqqa «Do not buy anything — only read prices», «Central Bank of
 * Uzbekistan» deb yozdi va narx yoki kursni o'qish ham rad etildi). Olib tashlanadi: inkor gap bo'lagi («do not…», «не…»,
 * «no real purchase», «sotib olinmaydi», «to'lov emas») va Markaziy bank nomi — u yerda hisob yo'q, faqat kurs. «Don't forget to pay» kabi eslatma — inkor emas, qoladi.
 * Ish ichidagi himoya baribir ishlaydi: bank saytlari ochilmaydi (moneyHost), to'lov tugmalari bosilmaydi (moneyAction)
 */
const NOT_A_REQUEST = [
  new RegExp(`\\b(?:do not|don't|never|must not|mustn't|should not|shouldn't|without|avoid|no|not|nothing|nor|\\w+n't)\\b(?!\\s+(?:forget|fail|hesitate)\\b)${CLAUSE}`, 'gi'),
  new RegExp(`(?<![а-яё])(?:не|без|нельзя)\\s(?!забу|забы)${CLAUSE}`, 'gi'),
  /(?:sotib ol|xarid qil|pul o'?tkaz|savatga qo'?sh|to'?la)(?:i?n)?ma(?:ng|sdan|slik|sin|ydi|ymiz|yman|y)?(?![a-z'])/gi,
  /(?:to'?lov|xarid|o'?tkazma|pul)\s+(?:emas|yo'q|qilinmaydi|olinmaydi|kerak emas)/gi,
  /\b(?:central bank|markaziy bank)[a-z']*|центральн[а-яё]*\s+банк[а-яё]*|\bcbu(?:\.uz)?\b/gi,
];
const withoutProhibitions = (text: string): string => NOT_A_REQUEST.reduce((t, re) => t.replace(re, ' '), text);

/**
 * Kompyuter topshirig'i (egasi yoki model yozgan) pulga oidmi. Qaytaradi — sababi (egasiga aytiladi); bo'lmasa — null.
 * Bank saytidan «ko'chirma yuklab olish» ham — bank saytiga kirish (egasi o'zi yuklab, Palantir'ga yuboradi)
 */
export function moneyTask(text: string): string | null {
  const t = withoutProhibitions(text.replace(/[‘’ʻʼ`]/g, "'"));
  if (/bank|банк/i.test(t)) return "bank bilan ish";
  // «click» va «oson» — oddiy so'z ham: faqat to'lov tizimi sifatida
  if (/\b(payme|paynet|uzcard|humo|apelsin|upay|paypal)\b|click\.uz|\bclick (orqali|bilan|ilova)|\boson (orqali|bilan|ilova)/i.test(t)) return "to'lov tizimi bilan ish";
  if (MONEY_ACTION.test(t)) return "to'lov, pul o'tkazish yoki xarid";
  if (cardLike(t)) return "karta raqami";
  return null;
}

/** «Butun kompyuter»: ochiq oyna sarlavhasi va dasturi bank yoki to'lovnikimi (brauzerda — sayt nomi sarlavhada bo'ladi) */
export function moneyWindow(w: { title: string; process: string } | null): boolean {
  if (!w) return false;
  const s = `${w.title} ${w.process}`.replace(/[‘’ʻʼ`]/g, "'");
  return /bank|банк|payme|paynet|click\.uz|uzcard|humo|apelsin|upay|paypal|to'lov|оплат|плат[её]ж/i.test(s)
    || MONEY_SITES.some(site => s.toLowerCase().includes(site));
}

/** Karta raqami (16 raqam, bo'shliq yoki chiziqcha bilan) yoki uning muddati bilan birga — AI hech qayerga yozmaydi */
export const cardLike = (text: string): boolean => /(?<!\d)(?:\d[ -]?){15}\d(?!\d)/.test(text);
