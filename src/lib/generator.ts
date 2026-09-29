import type { Clinic, ContentItem, Design, Doctor, ItemEdit, ItemKind, ItemStatus, Lang, PackState, Service, TemplateId } from '../types';
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
 * Demo'da matn tayyor bankdan olinadi; haqiqiy versiyada shu joyni AI yozadi.
 */

type Body = Pick<ContentItem, 'topic' | 'design' | 'caption'> & { solemn?: boolean };

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

const contactLines = (lang: Lang, c: Clinic) => [
  `📍 ${addressOf(lang, c)}`,
  `📞 ${c.phone}`,
  ...(c.telegramBot ? [`✍️ ${bookWord(lang)}: ${c.telegramBot}`] : []),
];

/** Aksiya matnidan katta belgi: "20%" → "-20%", "bepul" → "Bepul" */
const badgeOf = (text: string, lang: Lang): string | undefined => {
  const pct = text.match(/(\d{1,2})\s*%/);
  if (pct) return `-${pct[1]}%`;
  if (/bepul|бесплатн/i.test(text)) return lang === 'ru' ? 'Бесплатно' : 'Bepul';
  return undefined;
};

const yearsText = (lang: Lang, years: number) => {
  if (lang === 'uz') return `${years} yillik tajriba`;
  const mod10 = years % 10;
  const mod100 = years % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'год' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'года' : 'лет';
  return `Опыт ${years} ${word}`;
};

const FALLBACK_SERVICE: Service = { id: 'checkup', name: "Stomatologik ko'rik", nameRu: 'Осмотр стоматолога', price: 0 };

function promo(clinic: Clinic, n: number, week: number): Body {
  const goal = clinic.goal;
  const svc = clinic.services.find(s => s.id === goal.focusServiceId)
    ?? (clinic.services.length ? pickAt(clinic.services, week) : FALLBACK_SERVICE);
  const profile = profileOf(`${svc.name} ${svc.nameRu || ''}`);
  const hasPromo = !!goal.promo?.trim();
  const view = (lang: Lang) => {
    const name = lang === 'ru' ? svc.nameRu || svc.name : svc.name;
    const promoText = ((lang === 'ru' ? goal.promoRu || goal.promo : goal.promo) || '').trim();
    const benefits = rotate(profile.benefits[lang], n).slice(0, 2);
    const price = svc.price > 0 ? (lang === 'ru' ? `от ${money(svc.price)} сум` : `${money(svc.price)} so'mdan`) : '';
    const until = hasPromo && goal.promoUntil ? dayLong(lang, fromIso(goal.promoUntil)) : '';
    return { name, promoText, benefits, price, until };
  };
  const design = both<Design>(lang => {
    const v = view(lang);
    return {
      kicker: pickAt(hasPromo ? PROMO_KICKERS[lang] : SERVICE_KICKERS[lang], n),
      title: v.name,
      badge: hasPromo ? badgeOf(v.promoText, lang) : undefined,
      lines: hasPromo ? [v.promoText, ...v.benefits] : [...v.benefits, v.price].filter(Boolean),
      cta: ctaOf(lang, clinic),
      footnote: v.until ? (lang === 'ru' ? `Акция до ${v.until}` : `Aksiya ${v.until}gacha`) : undefined,
    };
  });
  const caption = both(lang => {
    const v = view(lang);
    const out = [pickAt(profile.hooks[lang], n), '', hasPromo ? `🦷 ${v.name}: ${v.promoText}` : `🦷 ${v.name}`];
    out.push(...v.benefits.map(b => `✔️ ${b}`));
    if (v.price && !hasPromo) out.push(`💰 ${lang === 'ru' ? 'Стоимость' : 'Narxi'}: ${v.price}`);
    if (v.until) out.push(lang === 'ru' ? `📅 Акция действует до ${v.until}.` : `📅 Aksiya ${v.until}gacha davom etadi.`);
    out.push('', ...contactLines(lang, clinic), '', `ℹ️ ${MEDICAL_NOTE[lang]}`, '', tags(lang, clinic, profile.tags[lang]));
    return out.join('\n');
  });
  return { topic: hasPromo ? { uz: 'Aksiya', ru: 'Акция' } : { uz: 'Xizmat', ru: 'Услуга' }, design, caption };
}

function tip(clinic: Clinic, n: number): Body {
  const t = pickAt(TIPS, n);
  return {
    topic: { uz: 'Maslahat', ru: 'Совет' },
    design: both(lang => ({
      kicker: lang === 'ru' ? 'Полезный совет' : 'Foydali maslahat',
      title: t.title[lang],
      lines: t.lines[lang],
      cta: ctaOf(lang, clinic),
    })),
    caption: both(lang => [
      `💡 ${t.title[lang]}`,
      '',
      ...t.lines[lang].map((l, i) => `${['1️⃣', '2️⃣', '3️⃣'][i]} ${l}`),
      '',
      pickAt(TIP_CLOSERS[lang], n).replace('{bot}', clinic.telegramBot || clinic.phone),
      '',
      `📍 ${clinic.name} · ${addressOf(lang, clinic)}`,
      tags(lang, clinic),
    ].join('\n')),
  };
}

function doctorPost(clinic: Clinic, doc: Doctor, n: number): Body {
  const view = (lang: Lang) => ({
    specialty: lang === 'ru' ? doc.specialtyRu || doc.specialty : doc.specialty,
    exp: doc.years ? yearsText(lang, doc.years) : '',
    intro: pickAt(DOCTOR_INTROS[lang], n),
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
        ...(clinic.telegramBot ? [`✍️ ${bookWord(lang)}: ${clinic.telegramBot}`] : []),
        '',
        tags(lang, clinic),
      ].join('\n');
    }),
  };
}

function holiday(clinic: Clinic, occ: Occasion): Body {
  const promoText = (lang: Lang) => ((lang === 'ru' ? clinic.goal.promoRu || clinic.goal.promo : clinic.goal.promo) || '').trim();
  return {
    solemn: occ.solemn,
    topic: occ.solemn ? { uz: 'Sana', ru: 'Памятная дата' } : { uz: 'Bayram', ru: 'Праздник' },
    design: both(lang => ({
      kicker: dayLong(lang, fromIso(occ.date)),
      title: occ.title[lang],
      lines: occ.lines[lang],
      cta: clinic.name,
    })),
    caption: both(lang => [
      `${occ.solemn ? '🕊' : '🎉'} ${occ.title[lang]}`,
      '',
      ...occ.lines[lang],
      '',
      // Tabassum kuni kabi sanada klinikaning amaldagi aksiyasi eslatiladi (o'zidan chegirma o'ylab topilmaydi)
      ...(occ.dental && promoText(lang) ? [`🎁 ${promoText(lang)}`, ''] : []),
      lang === 'ru' ? `С уважением, команда «${clinic.name}»` : `Hurmat bilan, ${clinic.name} jamoasi`,
      '',
      tags(lang, clinic),
    ].join('\n')),
  };
}

function slots(clinic: Clinic): Body {
  const list = [...clinic.goal.freeSlots].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 5);
  return {
    topic: { uz: "Bo'sh vaqtlar", ru: 'Свободное время' },
    design: both(lang => ({
      kicker: lang === 'ru' ? 'На этой неделе' : 'Bu hafta',
      title: lang === 'ru' ? 'Свободное время' : "Bo'sh vaqtlar",
      lines: list.map(s => `${DAYS[lang][s.day]}|${s.time}`),
      cta: ctaOf(lang, clinic),
    })),
    caption: both(lang => lang === 'ru'
      ? `Добавьте в сторис стикер-ссылку: ${clinic.telegramBot || clinic.phone}`
      : `Storisga havola stikerini qo'shing: ${clinic.telegramBot || clinic.phone}`),
  };
}

function poll(n: number): Body {
  const p = pickAt(POLLS, n);
  return {
    topic: { uz: "So'rovnoma", ru: 'Опрос' },
    design: both(lang => ({
      kicker: lang === 'ru' ? 'Опрос' : "So'rovnoma",
      title: p.question[lang],
      lines: [...p.options[lang]],
      cta: lang === 'ru' ? 'Отметьте ответ' : 'Javobingizni belgilang',
    })),
    caption: both(lang => lang === 'ru'
      ? `Добавьте стикер «Опрос»: ${p.options.ru.join(' / ')}`
      : `Instagram'da «So'rovnoma» stikerini qo'shing: ${p.options.uz.join(' / ')}`),
  };
}

export function buildWeek(clinic: Clinic, monday: Date, seeds: Record<string, number>): ContentItem[] {
  const week = weekNumber(monday);
  const key = iso(monday);
  const occ = occasionsInWeek(monday);
  const on = (day: number) => iso(addDays(monday, day));
  const items: ContentItem[] = [];

  const add = (slot: number, kind: ItemKind, template: TemplateId, date: string, time: string, styles: number,
    body: (n: number, seed: number) => Body, doctorId?: (n: number) => string | undefined) => {
    const id = `${key}-${slot}`;
    const seed = seeds[id] ?? 0;
    const n = week + seed;
    items.push({ id, slot, kind, template, date, time, seed, style: (hash(id) + seed) % styles, doctorId: doctorId?.(n), ...body(n, seed) });
  };

  add(0, 'post', 'promo', on(1), '10:00', 3, n => promo(clinic, n, week));

  if (occ[0]) add(1, 'post', 'holiday', occ[0].date, '09:00', 2, () => holiday(clinic, occ[0]));
  else add(1, 'post', 'tip', on(3), '12:00', 2, n => tip(clinic, n));

  if (clinic.doctors.length) {
    const docAt = (n: number) => pickAt(clinic.doctors, n);
    add(2, 'post', 'doctor', on(5), '11:00', 2, n => doctorPost(clinic, docAt(n), n), n => docAt(n).id);
  } else add(2, 'post', 'tip', on(5), '11:00', 2, n => tip(clinic, n + 5));

  if (clinic.goal.freeSlots.length) add(3, 'story', 'slots', on(0), '19:00', 2, () => slots(clinic));
  else add(3, 'story', 'poll', on(0), '19:00', 2, n => poll(n + 3));

  if (occ[1]) add(4, 'story', 'holiday', occ[1].date, '10:00', 2, () => holiday(clinic, occ[1]));
  else add(4, 'story', 'poll', on(2), '20:00', 2, n => poll(n));

  return items;
}

/** Egasining tahriri AI varianti ustiga qo'yiladi */
export function withEdits(item: ContentItem, edit?: Partial<Record<Lang, ItemEdit>>): ContentItem {
  if (!edit) return item;
  return {
    ...item,
    design: both(l => (edit[l]?.title ? { ...item.design[l], title: edit[l]!.title! } : item.design[l])),
    caption: both(l => edit[l]?.caption ?? item.caption[l]),
  };
}

/** Joylash vaqti o'tganmi */
export const isPast = (item: ContentItem, now: Date): boolean => new Date(`${item.date}T${item.time}:00`) <= now;

/** O'tgan haftalar — tarix: egasi qaytarmagan bo'lsa, postlar joylangan hisoblanadi */
export function statusOf(pack: PackState, item: ContentItem, now: Date): ItemStatus {
  const saved = pack.status[item.id];
  if (saved) return saved;
  // id'ning boshi — o'sha haftaning dushanbasi
  return item.id.slice(0, 10) < iso(mondayOf(now)) ? 'published' : 'pending';
}
