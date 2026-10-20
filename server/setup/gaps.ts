/**
 * Bo'shliqlar: Palantir mijozga to'g'ri javob berishi uchun yetishmagan yoki bir-biriga zid narsalar — ikki xil narx, yozilmagan manzil,
 * ish vaqti, telefon. Taxmin qilinmaydi: egasidan birinchi kun suhbatida (Telegram yoki panel) bittalab so'raladi, javob o'z joyiga yoziladi.
 * Ko'p so'raladigan savollar (brainPack) bu yerda emas — ular suhbatda bo'shliqlardan keyin keladi.
 */
import { createHash } from 'node:crypto';
import type { Gap } from '../../src/types';
import { CLOSED, DAYS, hoursText, missingDays } from '../../src/lib/anketa';
import { parsePrices, priceKey, splitConflicts } from '../../src/lib/prices';
import { importPrices, saveAnswer } from '../brain/index';
import { businesses, type BusinessRow } from '../db';
import { aboutBody, updateAbout } from './about';
import { setupOf, updateSetup } from './state';

export const GAP_PREFIX = 'gap:';
const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const money = (n: number) => `${n.toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
const dayNames = (keys: string[]) => keys.map(k => DAYS.find(d => d[0] === k)![1].toLowerCase()).join(', ');
const DAY_OFF = 'Dam olish kuni';

/** «Biznes haqida» sahifasida shu qator bormi (egasi Obsidian'da o'zi yozgan bo'lishi mumkin — profil maydoni bo'sh bo'lsa ham) */
const LINE: Record<'address' | 'phone' | 'hours', RegExp> = {
  address: /^\s*[-*]?\s*(manzil|адрес)\s*:\s*\S/im,
  phone: /^\s*[-*]?\s*(telefon|тел(ефон)?)\s*:\s*\S/im,
  hours: /^\s*[-*]?\s*(ish vaqti|режим работы|время работы)\s*:\s*\S/im,
};

export function gapsOf(biz: BusinessRow): Gap[] {
  const about = aboutBody(biz.id);
  const has = (field: 'address' | 'phone' | 'hours') => !!biz.profile[field]?.trim() || LINE[field].test(about);
  const s = setupOf(biz);
  const out: Gap[] = s.conflicts.map(c => ({
    id: `${GAP_PREFIX}p${short(priceKey(c.name))}`,
    question: `«${c.name}» narxi ikki xil yozilgan: ${c.prices.map(money).join(' va ')}. Mijozga qaysi birini aytay?`,
    hint: `Variantlar: ${c.prices.map(money).join(' yoki ')} (Telegram'da — tugma). To'g'ri narxni yozsangiz ham bo'ladi; ikkalasi ham to'g'ri bo'lsa — farqini yozing (masalan: oddiy 250 000, ultratovush 300 000)`,
    options: c.prices.map(money),
  }));
  if (!biz.profile.offerings.length && !s.conflicts.length) {
    out.push({ id: `${GAP_PREFIX}prices`, question: 'Narxlar hali kiritilmagan. Asosiy xizmatlaringiz va narxini yozing — har qatorda bittadan.', hint: "Masalan:\nKonsultatsiya — bepul\nPlomba — 350 000\nTish olish — 200 000" });
  }
  if (!has('address')) out.push({ id: `${GAP_PREFIX}address`, question: "Manzilingiz qayer? Mo'ljal bilan yozing.", hint: "Masalan: Chilonzor 9-kvartal, 14-uy (Chilonzor metrosi yonida)" });
  if (!has('phone')) out.push({ id: `${GAP_PREFIX}phone`, question: 'Mijozlar qaysi raqamga qo\'ng\'iroq qilsin?', hint: 'Masalan: +998 71 200 45 67' });
  const missing = s.hours ? missingDays(s.hours) : [];
  if (!s.hours && !has('hours')) {
    out.push({ id: `${GAP_PREFIX}hours`, question: 'Ish vaqtingiz qanday?', hint: 'Masalan: Du–Ju 09:00–19:00, Shanba 09:00–15:00, Yakshanba dam olish' });
  } else if (missing.length && missing.length < DAYS.length) {
    out.push({ id: `${GAP_PREFIX}days`, question: `Anketada ${dayNames(missing)} kuni ish vaqti yozilmagan. Bu kun(lar)i ishlaysizmi?`, hint: "Ishlasangiz — vaqtini yozing: 09:00–15:00. Ishlamasangiz — «dam olish kuni»", options: [DAY_OFF] });
  } else if (missing.length === DAYS.length && !has('hours')) {
    out.push({ id: `${GAP_PREFIX}hours`, question: 'Ish vaqtingiz qanday?', hint: 'Masalan: Du–Ju 09:00–19:00, Shanba 09:00–15:00, Yakshanba dam olish' });
  }
  return out;
}

const MIN_ANSWER = 2;
const MIN_PHONE_DIGITS = 7;
/** «Dam olish kuni», «yopiq», «ishlamaymiz», «выходной» — faqat butun javob (gap ichidagi «dam olmaymiz» emas) */
const OFF_ANSWER = /^(dam olish( kuni| kunlari)?|dam olamiz|dam|yopiq|yopiqmiz|ishlamaymiz|yo'q, ishlamaymiz|выходной|выходные|не работаем)[.!]?$/;
const said = (s: string): string => s.trim().toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
const asPrice = (text: string): number | null => parsePrices(`Narx — ${text.replace(/so['‘’ʻ]?m/gi, '').trim()} so'm`).items[0]?.price ?? null;
const setProfile = (bizId: string, patch: Partial<BusinessRow['profile']>) => {
  const fresh = businesses.byId(bizId)!;
  businesses.update(bizId, { profile: { ...fresh.profile, ...patch } });
};

/**
 * Egasining javobini o'z joyiga yozadi. Qaytadi: egasiga aytiladigan qisqa izoh, yoki null — javobdan foydalanib bo'lmadi
 * (masalan, narx so'ralganda narx topilmadi) va savol qayta so'raladi
 */
export function resolveGap(biz: BusinessRow, id: string, raw: string): string | null {
  const answer = raw.trim();
  if (answer.length < MIN_ANSWER && !/^\d+$/.test(answer)) return null;
  const s = setupOf(biz);
  const conflict = s.conflicts.find(c => `${GAP_PREFIX}p${short(priceKey(c.name))}` === id);
  if (conflict) {
    const drop = () => updateSetup(biz.id, st => ({ ...st, conflicts: st.conflicts.filter(c => priceKey(c.name) !== priceKey(conflict.name)) }));
    const price = /\d/.test(answer) && !/[,;]|\bva\b/i.test(answer) ? asPrice(answer) : null;
    if (price && price > 0) {
      importPrices(biz, [{ name: conflict.name, price }]);
      drop();
      return `«${conflict.name}» — ${money(price)} deb yozdim.`;
    }
    // Ikkalasi ham to'g'ri (turi boshqa): egasining izohi savol-javob bo'lib qoladi, jadvalga taxminiy narx yozilmaydi.
    // Izohda narx bo'lishi shart: «keyin aytaman» kabi gap bilim bo'lib qolmasin — savol qayta so'raladi
    if (!/\d/.test(answer)) return null;
    saveAnswer(biz, `${conflict.name} narxi qancha?`, answer, 'owner');
    drop();
    return `«${conflict.name}» narxi haqida yozganingizni eslab qoldim.`;
  }
  switch (id) {
    case `${GAP_PREFIX}prices`: {
      const { clean, conflicts } = splitConflicts(parsePrices(answer).items);
      if (!clean.length && !conflicts.length) return null;
      if (clean.length) importPrices(biz, clean);
      if (conflicts.length) updateSetup(biz.id, st => ({ ...st, conflicts: [...st.conflicts, ...conflicts] }));
      return `${clean.length} ta narxni jadvalga yozdim.`;
    }
    case `${GAP_PREFIX}address`:
      setProfile(biz.id, { address: answer.slice(0, 160) });
      updateAbout(biz.id, [['Manzil', answer]]);
      return 'Manzilni yozdim.';
    case `${GAP_PREFIX}phone`:
      // Kamida 7 ta raqam: «yo'q», «keyin» kabi javob telefon bo'lib yozilmasin
      if (answer.replace(/\D/g, '').length < MIN_PHONE_DIGITS) return null;
      setProfile(biz.id, { phone: answer.slice(0, 40) });
      updateAbout(biz.id, [['Telefon', answer]]);
      return 'Raqamni yozdim.';
    case `${GAP_PREFIX}hours`:
      setProfile(biz.id, { hours: answer.slice(0, 120) });
      updateAbout(biz.id, [['Ish vaqti', answer]]);
      return 'Ish vaqtini yozdim.';
    case `${GAP_PREFIX}days`: {
      if (!s.hours) return null;
      // Vaqt yozilgan bo'lsa — u ustun («yo'q, 9-15 ishlaymiz»); dam olish faqat butun javob shu ma'noda bo'lsa
      const hasTime = /\d{1,2}([:.]\d{2})?\s*[-–—]\s*\d{1,2}/.test(answer);
      const value = !hasTime && OFF_ANSWER.test(said(answer)) ? CLOSED : answer;
      if (!hasTime && value !== CLOSED) return null;
      const hours = { ...s.hours };
      for (const k of missingDays(s.hours)) hours[k] = value;
      updateSetup(biz.id, st => ({ ...st, hours }));
      const text = hoursText(hours);
      setProfile(biz.id, { hours: text.slice(0, 120) });
      updateAbout(biz.id, [['Ish vaqti', text]]);
      return `Ish vaqti: ${text}.`;
    }
    default:
      return null;
  }
}
