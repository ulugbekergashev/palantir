/**
 * Bosh ekrandagi «Bugun klinikada» qatori (Boshqaruv markazi): bugungi tushum, to'lovlar, kelganlar va to'lanmagan qarz —
 * DentaCRM'dan, AI'siz. Taqqoslash — oxirgi 7 kunning ish kunlari o'rtachasi bilan (qabul ham, to'lov ham bo'lmagan kun — dam olish,
 * u o'rtachani tushirmaydi). Tushum — yangi kelgan pul: balansdan to'lov (oldin to'langan avans) kirmaydi (logic.ts daySummary bilan bir xil).
 */
import type { ClinicMoney } from '../../src/types';
import { daySummary } from './logic';
import type { DayData } from './report';

/** Taqqoslash uchun shuncha oldingi kun */
export const MONEY_PAST_DAYS = 7;

const isIncome = (t: DayData['transactions'][number]) => t.status === 'Paid' && t.type !== 'Balance';

export function clinicMoney(today: DayData, past: DayData[]): ClinicMoney {
  const s = daySummary(today.appointments, today.transactions);
  const open = past.filter(d => d.appointments.length || d.transactions.length);
  const revenueOf = (d: DayData) => d.transactions.filter(isIncome).reduce((n, t) => n + t.amount, 0);
  return {
    date: today.date,
    revenue: s.revenue.total,
    payments: today.transactions.filter(isIncome).length,
    came: s.came, total: s.total - s.cancelled, expected: s.expected,
    unpaid: s.unpaid,
    avgRevenue: open.length ? Math.round(open.reduce((n, d) => n + revenueOf(d), 0) / open.length) : null,
    openDays: open.length,
  };
}
