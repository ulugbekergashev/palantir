import type { BrainView, LiveStatus } from '../types';

/** Ishga tushirish qadami: nima qilish kerak, bajarilganmi va qaysi bo'limda qilinadi */
export interface SetupStep { key: 'bot' | 'crm' | 'knowledge'; done: boolean; title: string; text: string; href: string; go: string }

/** Bilim qadamining matni: nima yetishmaydi va savollardan nechtasiga javob bor */
function knowledgeText(missing: string[], answered: number, total: number): string {
  const basics = missing.length ? `Hali bilmaydi: ${missing.join(', ')}.` : 'Narx, manzil, telefon va ish vaqti — bor.';
  const pack = total ? ` Ko'p so'raladigan savollar: ${answered}/${total} tasiga javob.` : '';
  return `${basics}${pack} Bilganiga Palantir o'zi javob beradi, bilmaganini sizdan so'raydi.`;
}

/**
 * O'rnatilgan kunning ro'yxati: Telegram, DentaCRM (klinikada) va Palantir bilimi.
 * Bilim — ulash ustasining «Bo'shliqlar» qadami va Miya bilan bitta ta'rif (I2): narx, manzil, telefon, ish vaqti
 * (server/setup/gaps.ts → missing) va ko'p so'raladigan savollar (Miya: javob/jami). Avval bu yerda faqat narx va savollar
 * sanalardi — manzili yo'q klinika shu ro'yxatda «tayyor», ustada esa «bo'shliq bor» chiqardi.
 * Sof funksiya: GET /api/me dagi status, GET /api/brain va GET /api/business/knowledge-gaps javobidan yig'iladi.
 * brain yoki missing kelmagan bo'lsa (null) — bilim qadami ko'rsatilmaydi.
 */
export function setupSteps(status: LiveStatus, clinic: boolean, brain: BrainView | null, missing: string[] | null): SetupStep[] {
  const answered = brain?.pack.filter(q => q.answer).length ?? 0;
  const total = brain?.pack.length ?? 0;
  const steps: (SetupStep | false | null)[] = [
    {
      key: 'bot', done: status.ownerLinked, href: '#/sozlamalar/telegram', go: 'Telegram', title: "Telegram'ni ulang",
      text: status.bot ? "Eslatmalar, ertalabki xulosa va mijozlarga javob takliflari Telegram'ingizga keladi." : "Telegram bot hali ulanmagan — uni o'rnatuvchi ulash ustasida ulaydi. Palantir jamoasiga ayting.",
    },
    (clinic || !!status.crm.account) && {
      key: 'crm', done: !!status.crm.account && !status.crm.problem, href: '#/sozlamalar/dentacrm', go: 'DentaCRM', title: "DentaCRM'ni ulang",
      text: status.crm.problem ?? "Qabullar, kelgan-kelmaganlar va tushum shu sahifada ko'rinadi; Palantir bemorni qabulga yoza oladi.",
    },
    brain && missing && {
      key: 'knowledge', done: !missing.length && answered === total, href: '#/brain', go: 'Miya', title: "Palantir bilimini to'ldiring",
      text: knowledgeText(missing, answered, total),
    },
  ];
  return steps.filter((s): s is SetupStep => !!s);
}
