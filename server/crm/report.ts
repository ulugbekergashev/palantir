/**
 * Klinikaning davr hisoboti va ogohlantirishlar — sof hisob (tarmoq ham, baza ham yo'q; to'g'ridan-to'g'ri sinaladi).
 * Kirish — kunlar: har birida shu kunning qabullari va to'lovlari (DentaCRM'dan, history.ts yig'adi).
 * Ogohlantirish matnlarida faqat sonlar bo'ladi (bemor yoki shifokor ismi yo'q) — ular egasiga tayyor holda ketadi.
 */
import { money } from '../../src/lib/text';
import { addDays, fromIso, iso, mondayOf } from '../../src/lib/week';
import { daySummary, type Appointment, type Transaction } from './logic';

export interface DayData { date: string; appointments: Appointment[]; transactions: Transaction[] }

export const PERIODS = ['this_week', 'last_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days'] as const;
export type Period = typeof PERIODS[number];
export interface DateRange { from: string; to: string }

const shift = (date: string, days: number): string => iso(addDays(fromIso(date), days));

/** Davr nomi → sanalar. Hafta dushanbadan; «this_» davrlar bugungacha (kelajak kunlar hisobotga kirmaydi) */
export function periodRange(period: Period, today: string): DateRange {
  const now = fromIso(today);
  const monday = iso(mondayOf(now));
  const monthStart = `${today.slice(0, 8)}01`;
  switch (period) {
    case 'this_week': return { from: monday, to: today };
    case 'last_week': return { from: shift(monday, -7), to: shift(monday, -1) };
    case 'this_month': return { from: monthStart, to: today };
    case 'last_month': return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12)), to: shift(monthStart, -1) };
    case 'last_7_days': return { from: shift(today, -6), to: today };
    case 'last_30_days': return { from: shift(today, -29), to: today };
  }
}

/** Ikkala chegara ham kiradi; from > to bo'lsa — bo'sh */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
}

const DAY_MS = 86_400_000;
/** Davr uzunligi kunlarda (ikkala chegara ham kiradi); ro'yxat tuzmasdan — tekshiruv uchun */
export const spanDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * Solishtirish uchun oldingi davr: shu uzunlikda va xuddi shu hafta kunlaridan (butun haftalarga suriladi) —
 * dushanba-seshanba shanba-yakshanba bilan solishtirilsa, yolg'on o'sish yoki pasayish chiqardi.
 */
export function previousRange(from: string, to: string): DateRange {
  const back = Math.ceil(spanDays(from, to) / 7) * 7;
  return { from: shift(from, -back), to: shift(to, -back) };
}

/** Oy bo'yicha davrlar o'tgan oyning shu kunlari bilan solishtiriladi (to'liq oy — undan oldingi to'liq oy bilan); qolganlari — previousRange */
export function comparisonRange(range: DateRange, period?: Period): DateRange {
  if (period !== 'this_month' && period !== 'last_month') return previousRange(range.from, range.to);
  const start = fromIso(range.from);
  const from = iso(new Date(start.getFullYear(), start.getMonth() - 1, 1, 12));
  const lastDay = shift(range.from, -1);
  const sameDays = shift(from, spanDays(range.from, range.to) - 1);
  return { from, to: sameDays < lastDay ? sameDays : lastDay };
}

const NO_DOCTOR = "Shifokor ko'rsatilmagan";
const CAME = new Set(['Completed', 'Checked-In']);
const isIncome = (t: Transaction) => t.status === 'Paid' && t.type !== 'Balance';
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);
/** O'zgarish foizi; oldingi qiymat 0 bo'lsa solishtirib bo'lmaydi — null */
const change = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export interface DoctorResult { doctor_id: string; doctor: string; appointments: number; came: number; no_show: number; revenue: number }
export interface PeriodReport extends DateRange {
  days: number;
  appointments: { total: number; came: number; no_show: number; cancelled: number; expected: number; /** Kelganlar ulushi: kelgan / (kelgan + kelmagan) */ show_rate_pct: number | null };
  revenue: { total: number; by_method: Record<string, number>; advance: number; from_balance: number; per_day_avg: number };
  unpaid: { total: number; count: number };
  /** Tushum bo'yicha kamayish tartibida */
  doctors: DoctorResult[];
  by_day: { date: string; appointments: number; came: number; no_show: number; revenue: number }[];
  best_day: { date: string; revenue: number } | null;
  previous: (DateRange & { appointments: number; came: number; no_show: number; revenue: number; change_pct: { revenue: number | null; appointments: number | null; came: number | null } }) | null;
}

const flat = (days: DayData[]) => daySummary(days.flatMap(d => d.appointments), days.flatMap(d => d.transactions));

function doctorResults(days: DayData[]): DoctorResult[] {
  const rows = new Map<string, DoctorResult>();
  // Ism birinchi uchragan yozuvda bo'sh bo'lishi mumkin — keyingisidan to'ldiriladi
  const row = (id: string, name: string | null): DoctorResult => {
    const r = rows.get(id) ?? { doctor_id: id, doctor: NO_DOCTOR, appointments: 0, came: 0, no_show: 0, revenue: 0 };
    return r.doctor === NO_DOCTOR && name ? { ...r, doctor: name } : r;
  };
  for (const a of days.flatMap(d => d.appointments)) {
    const r = row(a.doctorId, a.doctorName);
    rows.set(a.doctorId, { ...r, appointments: r.appointments + 1, came: r.came + (CAME.has(a.status) ? 1 : 0), no_show: r.no_show + (a.status === 'No-Show' ? 1 : 0) });
  }
  for (const t of days.flatMap(d => d.transactions).filter(isIncome)) {
    const id = t.doctorId ?? '';
    const r = row(id, t.doctorName);
    rows.set(id, { ...r, revenue: r.revenue + t.amount });
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.appointments - a.appointments);
}

/** days — davrning hamma kunlari tartib bilan (bo'sh kunlar ham); previous — oldingi davr kunlari (bo'lmasa solishtirilmaydi) */
export function periodReport(days: DayData[], previous: DayData[] = []): PeriodReport {
  const s = flat(days);
  const by_day = days.map(d => {
    const one = daySummary(d.appointments, d.transactions);
    return { date: d.date, appointments: one.total, came: one.came, no_show: one.no_show, revenue: one.revenue.total };
  });
  const best = by_day.reduce<PeriodReport['best_day']>((top, d) => (d.revenue > (top?.revenue ?? 0) ? { date: d.date, revenue: d.revenue } : top), null);
  const before = previous.length ? flat(previous) : null;
  return {
    from: days[0]?.date ?? '', to: days.at(-1)?.date ?? '', days: days.length,
    appointments: { total: s.total, came: s.came, no_show: s.no_show, cancelled: s.cancelled, expected: s.expected, show_rate_pct: pct(s.came, s.came + s.no_show) },
    revenue: { ...s.revenue, per_day_avg: days.length ? Math.round(s.revenue.total / days.length) : 0 },
    unpaid: s.unpaid,
    doctors: doctorResults(days),
    by_day,
    best_day: best,
    previous: before && {
      from: previous[0].date, to: previous.at(-1)!.date, appointments: before.total, came: before.came, no_show: before.no_show, revenue: before.revenue.total,
      change_pct: { revenue: change(s.revenue.total, before.revenue.total), appointments: change(s.total, before.total), came: change(s.came, before.came) },
    },
  };
}

// ─── Ogohlantirishlar ─────────────────────────────────────────────────────────

/** Solishtirish uchun kamida shuncha oldingi hafta kerak (yangi ulangan klinikada jim turadi) */
const MIN_HISTORY = 3;
/** Odatdagining shu ulushidan kam bo'lsa — aytiladi */
const LOW_SHARE = 0.5;
/** Bugungi jadval uchun pastroq: ertalab hali yozilmagan (kun davomida yoziladigan va navbatsiz keladigan) bemorlar bor */
const LOW_SHARE_TODAY = 0.35;
/** Kelmagan yoki bekor qilinganlar: kamida shuncha va shu ulushdan ko'p bo'lsa */
const MIN_COUNT = 3;
const HIGH_SHARE = 0.3;
/** Jadval solishtiriladigan eng kichik odatiy yuk (kuniga 2–3 bemor bo'lsa, farq tasodif) */
const MIN_USUAL_LOAD = 4;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const live = (d: DayData) => d.appointments.filter(a => a.status !== 'Cancelled').length;
/** Solishtirishga faqat klinika ishlagan kunlar olinadi: dam olish kuni, bayram, ulanishdan oldingi bo'sh kunlar odatdagi darajani pasaytirmasin */
const worked = (days: DayData[]) => days.filter(d => d.appointments.length || d.transactions.length);

export interface AlertInput {
  yesterday: DayData;
  today: DayData;
  /** Oldingi haftalardagi xuddi shu hafta kunlari (kechagi va bugungi kun uchun alohida) */
  yesterdayBefore: DayData[];
  todayBefore: DayData[];
  yesterdayClosed: boolean;
  todayClosed: boolean;
}

/** Egasi e'tibor berishi kerak bo'lgan narsalar — tayyor o'zbekcha gaplar; hammasi joyida bo'lsa bo'sh */
export function clinicAlerts(i: AlertInput): string[] {
  const out: string[] = [];
  if (!i.yesterdayClosed) {
    const y = daySummary(i.yesterday.appointments, i.yesterday.transactions);
    const history = worked(i.yesterdayBefore);
    const usual = history.length >= MIN_HISTORY ? median(history.map(d => daySummary(d.appointments, d.transactions).revenue.total)) : 0;
    if (usual > 0 && y.revenue.total < usual * LOW_SHARE) {
      out.push(`Kecha tushum odatdagidan ${Math.round(((usual - y.revenue.total) * 100) / usual)}% kam: ${money(y.revenue.total)} so'm (shu hafta kuni odatda ${money(usual)} so'm)`);
    }
    if (y.no_show >= MIN_COUNT && y.no_show / (y.came + y.no_show) >= HIGH_SHARE) out.push(`Kecha ${y.no_show} ta bemor kelmadi (kelishi kerak bo'lganlarning ${pct(y.no_show, y.came + y.no_show)}%)`);
    if (y.cancelled >= MIN_COUNT && y.cancelled / y.total >= HIGH_SHARE) out.push(`Kecha ${y.cancelled} ta qabul bekor qilindi (${y.total} tadan)`);
    if (y.expected >= MIN_COUNT) out.push(`Kechagi ${y.expected} ta qabulning holati belgilanmagan (keldi yoki kelmadi) — hisobot noto'g'ri chiqadi`);
    if (y.unpaid.count >= 2 && y.unpaid.total > 0 && y.unpaid.total >= (y.revenue.total + y.unpaid.total) * HIGH_SHARE) out.push(`Kecha ${y.unpaid.count} ta to'lov qarzga qoldi: ${money(y.unpaid.total)} so'm`);
  }
  const history = worked(i.todayBefore);
  if (!i.todayClosed && history.length >= MIN_HISTORY) {
    const usual = median(history.map(live));
    const booked = live(i.today);
    if (usual >= MIN_USUAL_LOAD && booked < usual * LOW_SHARE_TODAY) out.push(`Bugunga hozircha ${booked} ta qabul yozilgan (shu hafta kuni odatda ${Math.round(usual)} ta bo'ladi)`);
  }
  return out;
}
