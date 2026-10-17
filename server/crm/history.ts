/**
 * Bir necha kunlik ma'lumot: DentaCRM qabul va to'lovlarni faqat kunma-kun beradi, shuning uchun davr hisoboti
 * va ogohlantirishlar kunlardan yig'iladi. So'rovlar cheklangan parallellikda ketadi (klinika serveri yuklanmasin);
 * o'tgan kunlar mijozda (dentacrm.ts) bir muddat xotirada turadi.
 */
import { addDays, fromIso, iso } from '../../src/lib/week';
import type { DentaCrm } from './dentacrm';
import { clinicClosed } from './logic';
import { clinicAlerts, comparisonRange, datesBetween, periodReport, type DayData, type Period, type PeriodReport } from './report';

/** Bir hisobotdagi eng uzun davr; oldingi davr bilan birga ikki baravar kun so'raladi */
export const MAX_PERIOD_DAYS = 31;
/** Har bir kun ikki so'rov (qabullar va to'lovlar) — bir vaqtda ko'pi bilan 6 ta so'rov */
const PARALLEL = 3;
/** Ogohlantirish uchun: xuddi shu hafta kunining oldingi nechta haftasi bilan solishtiriladi */
const WEEKS_BACK = 4;

async function loadDays(crm: DentaCrm, dates: string[]): Promise<DayData[]> {
  const queue = dates.map((date, index) => ({ date, index }));
  const out = new Map<number, DayData>();
  // Bitta kun olinmasa hisobot baribir chiqmaydi — qolganlar uchun CRM bezovta qilinmaydi
  let failed = false;
  const worker = async () => {
    for (let job = queue.shift(); job && !failed; job = queue.shift()) {
      try {
        out.set(job.index, await crm.day(job.date));
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, dates.length) }, worker));
  return dates.map((_, i) => out.get(i)!);
}

/** Davr hisoboti solishtirish davri bilan (report.ts: comparisonRange) */
export async function loadPeriod(crm: DentaCrm, from: string, to: string, period?: Period): Promise<PeriodReport> {
  const dates = datesBetween(from, to);
  const before = comparisonRange({ from, to }, period);
  const earlier = datesBetween(before.from, before.to);
  const days = await loadDays(crm, [...earlier, ...dates]);
  return periodReport(days.slice(earlier.length), days.slice(0, earlier.length));
}

/** Kecha va bugun bo'yicha ogohlantirishlar (report.ts qoidalari) */
export async function loadAlerts(crm: DentaCrm, today: string): Promise<string[]> {
  const yesterday = iso(addDays(fromIso(today), -1));
  const before = (date: string) => Array.from({ length: WEEKS_BACK }, (_, w) => iso(addDays(fromIso(date), -7 * (w + 1))));
  const [clinic, days] = await Promise.all([crm.clinic(), loadDays(crm, [yesterday, today, ...before(yesterday), ...before(today)])]);
  return clinicAlerts({
    yesterday: days[0], today: days[1],
    yesterdayBefore: days.slice(2, 2 + WEEKS_BACK), todayBefore: days.slice(2 + WEEKS_BACK),
    yesterdayClosed: clinicClosed(clinic, yesterday), todayClosed: clinicClosed(clinic, today),
  });
}
