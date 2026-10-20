import type { BrainView, LiveStatus } from '../types';

/** Ishga tushirish qadami: nima qilish kerak, bajarilganmi va qaysi bo'limda qilinadi */
export interface SetupStep { key: 'bot' | 'crm' | 'prices' | 'answers'; done: boolean; title: string; text: string; href: string; go: string }

/**
 * O'rnatilgan kunning ro'yxati: Telegram, DentaCRM (klinikada), narxlar va tayyor savollarga javoblar.
 * Sof funksiya: GET /api/me dagi status va GET /api/brain javobidan yig'iladi. brain kelmagan bo'lsa (null) — bilim qadamlari ko'rsatilmaydi.
 */
export function setupSteps(status: LiveStatus, clinic: boolean, brain: BrainView | null): SetupStep[] {
  const answered = brain?.pack.filter(q => q.answer).length ?? 0;
  const steps: (SetupStep | false | null)[] = [
    {
      key: 'bot', done: status.ownerLinked, href: '#/sozlamalar/telegram', go: 'Telegram', title: "Telegram'ni ulang",
      text: status.bot ? "Eslatmalar, ertalabki xulosa va mijozlarga javob takliflari Telegram'ingizga keladi." : "Serverda BOT_TOKEN berilmagan — administrator @BotFather'dan token olib qo'yishi kerak.",
    },
    (clinic || !!status.crm.account) && {
      key: 'crm', done: !!status.crm.account && !status.crm.problem, href: '#/sozlamalar/dentacrm', go: 'DentaCRM', title: "DentaCRM'ni ulang",
      text: status.crm.problem ?? "Qabullar, kelgan-kelmaganlar va tushum shu sahifada ko'rinadi; yordamchi bemorni qabulga yoza oladi.",
    },
    brain && {
      key: 'prices', done: brain.priced > 0, href: '#/brain', go: 'Miya', title: 'Narxlarni kiriting',
      text: brain.priced > 0 ? `${brain.priced} ta xizmatning narxi kiritilgan — Palantir narxni shu ro'yxatdan aytadi.` : "Palantir narxni faqat siz kiritgan ro'yxatdan aytadi. Excel yoki Word'dan nusxalab tashlasangiz bo'ldi.",
    },
    brain && brain.pack.length > 0 && {
      key: 'answers', done: answered === brain.pack.length, href: '#/brain', go: 'Miya', title: "Ko'p so'raladigan savollarga javob yozing",
      text: `${answered}/${brain.pack.length} ta savolga javob yozilgan. Javobi bor savolga Palantir o'zi javob beradi, yo'g'ini sizdan so'raydi.`,
    },
  ];
  return steps.filter((s): s is SetupStep => !!s);
}
