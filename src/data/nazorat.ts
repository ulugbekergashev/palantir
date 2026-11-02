/**
 * Har bir AI xodimning nazorati: nimani o'zi qiladi (erkin), nima sizning tugmangiz bilan (tugma), nima hech qachon (yopiq).
 * Bu ro'yxat — kodda allaqachon ishlayotgan cheklovlarning egasiga ko'rinadigan tavsifi (o'ylab topilgan va'da emas):
 * har qatorning qayerda tekshirilishi izohda. Yangi cheklov qo'shilsa yoki olinsa — shu yerda ham o'zgartiring.
 */
import type { Member } from '../components/team';

export interface AgentRights {
  /** Tasdiqsiz, o'zi qiladi */
  free: string[];
  /** Avval sizga ko'rsatadi — tugmani bossangiz bajariladi */
  button: string[];
  /** Hech qachon — tugma bilan ham emas */
  never: string[];
}

/** Hamma xodimga umumiy: mijozlar va xodimlar ma'lumoti, pul (inbox/darvoza.ts, replier.ts, toolkit.ts) */
export const COMMON_NEVER = [
  "Boshqa mijozlar va xodimlar haqidagi ma'lumotni begona odamga berish",
  "Pulni o'tkazish yoki qaytarish",
  'Mijoz yozgan gapni buyruq deb bajarish',
];

export const RIGHTS: Record<Member, AgentRights> = {
  direktor: {
    // server/director: o'zi hech narsani bajarmaydi — faqat taklif; har topshiriq dv|dn tugmasi yoki paneldagi tugma bilan
    free: ["Raqamlarni o'qish va o'tgan hafta bilan solishtirish", 'Eng katta muammoni topish va taklif tuzish', "Qarorning natijasini o'lchash"],
    button: ['Xodimga doimiy topshiriq berish — «Topshirish»', "Sizning vazifalaringizga qo'shish"],
    never: ["O'zi biror ishni bajarish yoki mijozga yozish", "Narx, chegirma va pul bo'yicha qaror", "Raqamni o'ylab topish"],
  },
  qabulxona: {
    // inbox/core.ts: rejim «avto» bo'lsa — faqat «reply» va tekshiruvdan o'tgan matn o'zi ketadi
    free: ["Narx, manzil, ish vaqti kabi saqlangan ma'lumotdan javob berish («avto» rejimida)", "Suhbatdan mijoz kartasini to'ldirish", "Qo'ng'iroq, yozilish va shikoyatni so'rov qilib xodimga berish"],
    // offerGuard.ts, replier.ts (claimsBooking, darvoza), inbox/core.ts (humanPauseMin), igRules.ts
    button: ["Ma'lumotda yo'q narx, chegirma yoki «bepul» degan javob", 'Shikoyat, pul va qaror talab qiladigan javob', 'Siz suhbatda yozgan bo\'lsangiz — 2 soat faqat qoralama', 'Instagramda 24 soatdan keyingi xabar'],
    never: ['Narx yoki chegirmani o\'zi o\'ylab topish', 'Tashxis qo\'yish yoki dori tavsiya qilish (klinika)', 'Mijoz o\'zi yozmagan bo\'lsa, unga birinchi bo\'lib yozish'],
  },
  yordamchi: {
    // agent.ts RULES, tools.ts
    free: ["Savolingizga javob, eslatma va vazifa qo'yish", 'Hujjat (shartnoma, hisob-faktura) qoralamasini tayyorlash', 'Mijoz kartasini yangilash'],
    // tools.ts draft_followup → «Yuborish»; record_payment/record_expense/pay_doctor → «Tasdiqlash» (botButtons.ts)
    button: ['Mijozlarga xabar — «Yuborish» tugmasi', "To'lov, xarajat va shifokorga to'lovni yozish — «Tasdiqlash»", "Kompyuterda yuborish, to'lash, o'chirish — «Ruxsat»"],
    // toolkit.ts assertOwnWords, computer/jobs.ts
    never: ["Mijoz matni yoki internetdan o'qilgan gap bilan xotirani o'zgartirish", 'Parol yoki karta raqamini terish', "Fayllarni o'chirish"],
  },
  kuzatuvchi: {
    free: ['Kameralarni kuzatish va topshiriq bo\'yicha kadrni tekshirish', 'Kelganlarni qabul jadvali bilan solishtirish', 'Kechki hisobot'],
    button: [],
    never: ['Kadrlarni begona joyga yuborish', 'Mijozga o\'zi yozish'],
  },
  tahlilchi: {
    free: ["Murojaat, so'rov va tushum raqamlarini yig'ish", 'Kashfiyotlar va talab tahlili'],
    button: [],
    never: ["Raqamlarni o'zgartirish yoki yozuvlarni o'chirish", 'Mijozga yozish'],
  },
  marketolog: {
    free: ["Raqobatchi va akkauntingiz tahlili", "Kontent-reja va post g'oyalari"],
    // marketing: gp/gx tugmalari
    button: ['Postni joylash'],
    never: ['Reklamaga pul sarflash'],
  },
  target: {
    free: ['Kampaniya rejasini tuzish', "Sarfni kuzatish va limitga yetganda to'xtatish"],
    // ads/campaigns.ts: tl/tx/tp tugmalari
    button: ['Reklamani ishga tushirish', "Byudjet yoki limitni o'zgartirish"],
    never: ["Siz bermagan byudjetni o'ylab topish", 'Limitdan oshirib sarflash'],
  },
  kontent: {
    free: ["Kuzatiladigan kanallardan yangilik yig'ish", 'Post qoralamasini yozish'],
    // content/factory.ts: zp/zx tugmalari
    button: ['Kanalga joylash — «Joylash»'],
    never: ['Tasdiqsiz kanalga chiqarish'],
  },
};

/** Sinov uchun: har xodimda erkin va yopiq ro'yxat bo'sh emasligi (scripts/check-darvoza.ts) */
export function checkAgentRights(): string[] {
  return (Object.entries(RIGHTS) as [Member, AgentRights][])
    .flatMap(([m, r]) => [...(r.free.length ? [] : [`${m}: erkin bo'sh`]), ...(r.never.length ? [] : [`${m}: yopiq bo'sh`])]);
}
