import type { AiText, Clinic, ContentItem, Design, Doctor, ItemEdit, ItemKind, ItemStatus, Lang, PackState, Service, TemplateId } from '../types';
import { BASE_TAGS, DOCTOR_INTROS, MEDICAL_NOTE, POLLS, PROMO_KICKERS, SERVICE_KICKERS, TIPS, TIP_CLOSERS, profileOf } from './content';
import { occasionsInWeek, type Occasion } from './occasions';
import { hash, pickAt } from './rng';
import { money } from './text';
import { DAYS, addDays, dayLong, fromIso, iso, mondayOf } from './week';

/**
 * Haftalik paket: 3 post va 2 storis.
 *   0 — xizmat yoki aksiya (egasining haftalik maqsadi)
 *   1 — bayram (haftaga to'g'ri kelsa) yoki foydali maslahat
 *   2 — shifokor bilan tanishuv (har hafta boshqasi) yoki maslahat
 *   3 — storis: bo'sh vaqtlar yoki so'rovnoma
 *   4 — storis: ikkinchi bayram yoki so'rovnoma
 *
 * planWeek — har o'rin uchun reja (qaysi xizmat, shifokor, bayram); AI shu rejaga
 * qarab yozadi. buildWeek — rejadan tayyor post: AI matni bo'lsa o'sha, bo'lmasa
 * tayyor bankdan. Qolgan hammasi (dizayn, aloqa, ogohlantirish) har doim shu yerda.
 */

export interface SlotPlan {
  id: string;
  slot: number;
  kind: ItemKind;
  template: TemplateId;
  date: string;
  time: string;
  seed: number;
  style: number;
  /** Variantlar va haftalar bo'yicha aylanish raqami */
  n: number;
  service?: Service;
  doctor?: Doctor;
  occasion?: Occasion;
}

export interface BuildOptions {
  /** AI matni: id → matn */
  ai?: Record<string, AiText | undefined>;
  /** Postdagi yozilish havolasi (bot orqali — lid shu bilan sanaladi) */
  bookingLink?: (id: string) => string | undefined;
}

type Body = Pick<ContentItem, 'topic' | 'design' | 'caption'> & { solemn?: boolean };
interface Ctx { clinic: Clinic; plan: SlotPlan; ai?: AiText; link?: string }

const both = <T,>(f: (lang: Lang) => T): Record<Lang, T> => ({ uz: f('uz'), ru: f('ru') });

/** 1970 yildan beri necha hafta — har hafta boshqa maslahat va shifokor chiqadi */
const weekNumber = (monday: Date) =>
  Math.floor(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) / (7 * 86_400_000));

const rotate = <T,>(list: T[], n: number): T[] => list.map((_, i) => list[(i + n) % list.length]);

const clinicTag = (name: string) => `#${name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '')}`;
const tags = (lang: Lang, clinic: Clinic, extra: string[] = []) =>
  [...BASE_TAGS[lang], ...extra, clinicTag(clinic.name)].join(' ');

const addressOf = (lang: Lang, c: Clinic) => (lang === 'ru' ? c.addressRu || c.address : c.address);
const bookWord = (lang: Lang) => (lang === 'ru' ? 'Запись' : 'Yozilish');
const ctaOf = (lang: Lang, c: Clinic) => `${bookWord(lang)}: ${c.telegramBot || c.phone}`;
/** Matndagi yozilish: bot havolasi (lid sanaladi) yoki klinikaning o'z boti */
const bookLine = (lang: Lang, c: Clinic, link?: string) => {
  const to = link || c.telegramBot;
  return to ? [`✍️ ${bookWord(lang)}: ${to}`] : [];
};

const contactLines = (lang: Lang, c: Clinic, link?: string) => [
  `📍 ${addressOf(lang, c)}`,
  `📞 ${c.phone}`,
  ...bookLine(lang, c, link),
];

/** Aksiya matnidan katta belgi: "20%" → "-20%", "bepul" → "Bepul" */
const badgeOf = (text: string, lang: Lang): string | undefined => {
  const pct = text.match(/(\d{1,2})\s*%/);
  if (pct) return `-${pct[1]}%`;
  if (/bepul|бесплатн/i.test(text)) return lang === 'ru' ? 'Бесплатно' : 'Bepul';
  return undefined;
};

export const yearsText = (lang: Lang, years: number) => {
  if (lang === 'uz') return `${years} yillik tajriba`;
  const mod10 = years % 10;
  const mod100 = years % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'год' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'года' : 'лет';
  return `Опыт ${years} ${word}`;
};

export const promoText = (lang: Lang, c: Clinic) => ((lang === 'ru' ? c.goal.promoRu || c.goal.promo : c.goal.promo) || '').trim();

const FALLBACK_SERVICE: Service = { id: 'checkup', name: "Stomatologik ko'rik", nameRu: 'Осмотр стоматолога', price: 0 };

function promo({ clinic, plan, ai, link }: Ctx): Body {
  const svc = plan.service ?? FALLBACK_SERVICE;
  const profile = profileOf(`${svc.name} ${svc.nameRu || ''}`);
  const hasPromo = !!clinic.goal.promo?.trim();
  const n = plan.n;
  const view = (lang: Lang) => {
    const name = lang === 'ru' ? svc.nameRu || svc.name : svc.name;
    const promo = promoText(lang, clinic);
    const aiLines = ai?.[lang].lines.filter(Boolean) ?? [];
    const benefits = aiLines.length >= 2 ? aiLines.slice(0, 2) : rotate(profile.benefits[lang], n).slice(0, 2);
    const hook = ai?.[lang].hook || pickAt(profile.hooks[lang], n);
    const price = svc.price > 0 ? (lang === 'ru' ? `от ${money(svc.price)} сум` : `${money(svc.price)} so'mdan`) : '';
    const until = hasPromo && clinic.goal.promoUntil ? dayLong(lang, fromIso(clinic.goal.promoUntil)) : '';
    return { name, promo, benefits, hook, price, until };
  };
  const design = both<Design>(lang => {
    const v = view(lang);
    return {
      kicker: pickAt(hasPromo ? PROMO_KICKERS[lang] : SERVICE_KICKERS[lang], n),
      title: v.name,
      badge: hasPromo ? badgeOf(v.promo, lang) : undefined,
      lines: hasPromo ? [v.promo, ...v.benefits] : [...v.benefits, v.price].filter(Boolean),
      cta: ctaOf(lang, clinic),
      footnote: v.until ? (lang === 'ru' ? `Акция до ${v.until}` : `Aksiya ${v.until}gacha`) : undefined,
    };
  });
  const caption = both(lang => {
    const v = view(lang);
    const out = [v.hook, '', hasPromo ? `🦷 ${v.name}: ${v.promo}` : `🦷 ${v.name}`];
    out.push(...v.benefits.map(b => `✔️ ${b}`));
    if (v.price && !hasPromo) out.push(`💰 ${lang === 'ru' ? 'Стоимость' : 'Narxi'}: ${v.price}`);
    if (v.until) out.push(lang === 'ru' ? `📅 Акция действует до ${v.until}.` : `📅 Aksiya ${v.until}gacha davom etadi.`);
    out.push('', ...contactLines(lang, clinic, link), '', `ℹ️ ${MEDICAL_NOTE[lang]}`, '', tags(lang, clinic, profile.tags[lang]));
    return out.join('\n');
  });
  return { topic: hasPromo ? { uz: 'Aksiya', ru: 'Акция' } : { uz: 'Xizmat', ru: 'Услуга' }, design, caption };
}

function tip({ clinic, plan, ai, link }: Ctx): Body {
  const bank = pickAt(TIPS, plan.n);
  const view = (lang: Lang) => {
    const a = ai?.[lang];
    const useAi = !!a?.title && a.lines.filter(Boolean).length >= 3;
    return {
      title: useAi ? a!.title : bank.title[lang],
      lines: useAi ? a!.lines.slice(0, 3) : bank.lines[lang],
      closer: (useAi && a!.closer) || pickAt(TIP_CLOSERS[lang], plan.n).replace('{bot}', link || clinic.telegramBot || clinic.phone),
    };
  };
  return {
    topic: { uz: 'Maslahat', ru: 'Совет' },
    design: both(lang => {
      const v = view(lang);
      return { kicker: lang === 'ru' ? 'Полезный совет' : 'Foydali maslahat', title: v.title, lines: v.lines, cta: ctaOf(lang, clinic) };
    }),
    caption: both(lang => {
      const v = view(lang);
      return [
        `💡 ${v.title}`,
        '',
        ...v.lines.map((l, i) => `${['1️⃣', '2️⃣', '3️⃣'][i]} ${l}`),
        '',
        v.closer,
        '',
        `📍 ${clinic.name} · ${addressOf(lang, clinic)}`,
        ...bookLine(lang, clinic, link),
        tags(lang, clinic),
      ].join('\n');
    }),
  };
}

function doctorPost({ clinic, plan, ai, link }: Ctx): Body {
  const doc = plan.doctor!;
  const view = (lang: Lang) => ({
    specialty: lang === 'ru' ? doc.specialtyRu || doc.specialty : doc.specialty,
    exp: doc.years ? yearsText(lang, doc.years) : '',
    intro: ai?.[lang].closer || pickAt(DOCTOR_INTROS[lang], plan.n),
  });
  return {
    topic: { uz: 'Shifokor', ru: 'Врач' },
    design: both(lang => {
      const v = view(lang);
      return {
        kicker: lang === 'ru' ? 'Наш врач' : 'Shifokorimiz',
        title: doc.name,
        lines: [v.specialty, v.exp, v.intro].filter(Boolean),
        cta: ctaOf(lang, clinic),
      };
    }),
    caption: both(lang => {
      const v = view(lang);
      return [
        `🩺 ${lang === 'ru' ? 'Знакомьтесь' : 'Shifokorimiz bilan tanishing'}: ${doc.name}`,
        '',
        `🦷 ${v.specialty}`,
        ...(v.exp ? [`⭐ ${v.exp}`] : []),
        '',
        v.intro,
        '',
        `📞 ${clinic.phone}`,
        ...bookLine(lang, clinic, link),
        '',
        tags(lang, clinic),
      ].join('\n');
    }),
  };
}

function holiday({ clinic, plan, ai }: Ctx): Body {
  const occ = plan.occasion!;
  const lines = (lang: Lang) => {
    const a = ai?.[lang].lines.filter(Boolean) ?? [];
    return a.length >= 2 ? a.slice(0, 2) : occ.lines[lang];
  };
  return {
    solemn: occ.solemn,
    topic: occ.solemn ? { uz: 'Sana', ru: 'Памятная дата' } : { uz: 'Bayram', ru: 'Праздник' },
    design: both(lang => ({ kicker: dayLong(lang, fromIso(occ.date)), title: occ.title[lang], lines: lines(lang), cta: clinic.name })),
    caption: both(lang => [
      `${occ.solemn ? '🕊' : '🎉'} ${occ.title[lang]}`,
      '',
      ...lines(lang),
      '',
      // Tabassum kuni kabi sanada klinikaning amaldagi aksiyasi eslatiladi (o'zidan chegirma o'ylab topilmaydi)
      ...(occ.dental && promoText(lang, clinic) ? [`🎁 ${promoText(lang, clinic)}`, ''] : []),
      lang === 'ru' ? `С уважением, команда «${clinic.name}»` : `Hurmat bilan, ${clinic.name} jamoasi`,
      '',
      tags(lang, clinic),
    ].join('\n')),
  };
}

function slots({ clinic, link }: Ctx): Body {
  const list = [...clinic.goal.freeSlots].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 5);
  const to = link || clinic.telegramBot || clinic.phone;
  return {
    topic: { uz: "Bo'sh vaqtlar", ru: 'Свободное время' },
    design: both(lang => ({
      kicker: lang === 'ru' ? 'На этой неделе' : 'Bu hafta',
      title: lang === 'ru' ? 'Свободное время' : "Bo'sh vaqtlar",
      lines: list.map(s => `${DAYS[lang][s.day]}|${s.time}`),
      cta: ctaOf(lang, clinic),
    })),
    caption: both(lang => (lang === 'ru' ? `Добавьте в сторис стикер-ссылку: ${to}` : `Storisga havola stikerini qo'shing: ${to}`)),
  };
}

function poll({ plan, ai }: Ctx): Body {
  const bank = pickAt(POLLS, plan.n);
  const view = (lang: Lang) => {
    const a = ai?.[lang];
    const opts = a?.lines.filter(Boolean) ?? [];
    return a?.title && opts.length >= 2
      ? { question: a.title, options: opts.slice(0, 2) }
      : { question: bank.question[lang], options: [...bank.options[lang]] };
  };
  return {
    topic: { uz: "So'rovnoma", ru: 'Опрос' },
    design: both(lang => ({
      kicker: lang === 'ru' ? 'Опрос' : "So'rovnoma",
      title: view(lang).question,
      lines: view(lang).options,
      cta: lang === 'ru' ? 'Отметьте ответ' : 'Javobingizni belgilang',
    })),
    caption: both(lang => (lang === 'ru'
      ? `Добавьте стикер «Опрос»: ${view(lang).options.join(' / ')}`
      : `Instagram'da «So'rovnoma» stikerini qo'shing: ${view(lang).options.join(' / ')}`)),
  };
}

const BUILDERS: Record<TemplateId, (ctx: Ctx) => Body> = { promo, tip, doctor: doctorPost, holiday, slots, poll };

/** Haftaning 5 o'rni: nima, qachon, kim haqida */
export function planWeek(clinic: Clinic, monday: Date, seeds: Record<string, number>): SlotPlan[] {
  const week = weekNumber(monday);
  const key = iso(monday);
  const occ = occasionsInWeek(monday);
  const on = (day: number) => iso(addDays(monday, day));
  const plans: SlotPlan[] = [];

  const add = (slot: number, kind: ItemKind, template: TemplateId, date: string, time: string, styles: number,
    extra: (n: number) => Partial<SlotPlan> = () => ({}), offset = 0) => {
    const id = `${key}-${slot}`;
    const seed = seeds[id] ?? 0;
    const n = week + seed + offset;
    plans.push({ id, slot, kind, template, date, time, seed, n, style: (hash(id) + seed) % styles, ...extra(n) });
  };

  const focus = clinic.services.find(s => s.id === clinic.goal.focusServiceId)
    ?? (clinic.services.length ? pickAt(clinic.services, week) : FALLBACK_SERVICE);
  add(0, 'post', 'promo', on(1), '10:00', 3, () => ({ service: focus }));

  if (occ[0]) add(1, 'post', 'holiday', occ[0].date, '09:00', 2, () => ({ occasion: occ[0] }));
  else add(1, 'post', 'tip', on(3), '12:00', 2);

  if (clinic.doctors.length) add(2, 'post', 'doctor', on(5), '11:00', 2, n => ({ doctor: pickAt(clinic.doctors, n) }));
  else add(2, 'post', 'tip', on(5), '11:00', 2, undefined, 5);

  if (clinic.goal.freeSlots.length) add(3, 'story', 'slots', on(0), '19:00', 2);
  else add(3, 'story', 'poll', on(0), '19:00', 2, undefined, 3);

  if (occ[1]) add(4, 'story', 'holiday', occ[1].date, '10:00', 2, () => ({ occasion: occ[1] }));
  else add(4, 'story', 'poll', on(2), '20:00', 2);

  return plans;
}

export function buildItem(clinic: Clinic, plan: SlotPlan, opts: BuildOptions = {}): ContentItem {
  const ai = opts.ai?.[plan.id];
  const body = BUILDERS[plan.template]({ clinic, plan, ai, link: opts.bookingLink?.(plan.id) });
  return {
    id: plan.id,
    slot: plan.slot,
    kind: plan.kind,
    template: plan.template,
    date: plan.date,
    time: plan.time,
    seed: plan.seed,
    style: plan.style,
    doctorId: plan.doctor?.id,
    ai: !!ai,
    ...body,
  };
}

export function buildWeek(clinic: Clinic, monday: Date, seeds: Record<string, number>, opts: BuildOptions = {}): ContentItem[] {
  return planWeek(clinic, monday, seeds).map(p => buildItem(clinic, p, opts));
}

/** Egasining tahriri AI varianti ustiga qo'yiladi */
export function withEdits(item: ContentItem, edit?: Partial<Record<Lang, ItemEdit>> | null): ContentItem {
  if (!edit) return item;
  return {
    ...item,
    design: both(l => (edit[l]?.title ? { ...item.design[l], title: edit[l]!.title! } : item.design[l])),
    caption: both(l => edit[l]?.caption ?? item.caption[l]),
  };
}

/** Joylash vaqti (mahalliy vaqt) */
export const itemTime = (item: Pick<ContentItem, 'date' | 'time'>): Date => new Date(`${item.date}T${item.time}:00`);

/** Joylash vaqti o'tganmi */
export const isPast = (item: ContentItem, now: Date): boolean => itemTime(item) <= now;

/** Demo: o'tgan haftalar — tarix, egasi qaytarmagan bo'lsa postlar joylangan hisoblanadi */
export function statusOf(pack: PackState, item: ContentItem, now: Date): ItemStatus {
  const saved = pack.status[item.id];
  if (saved) return saved;
  // id'ning boshi — o'sha haftaning dushanbasi
  return item.id.slice(0, 10) < iso(mondayOf(now)) ? 'published' : 'pending';
}
