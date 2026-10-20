/**
 * Chuqur tahlilni qayta qilish kerakmi (har tahlil pulli): ma'lumot deyarli o'zgarmagan bo'lsa, topilmalar o'z kuchida —
 * model chaqirilmaydi. Yangisi: yangi manba qo'shilsa (DentaCRM, kamera…), qatorlar 10% ko'paysa yoki oxirgisiga hafta to'lsa.
 */
import { iso } from '../../src/lib/week';

export const RERUN_GROWTH = 0.1;
export const RERUN_DAYS = 7;

interface Table { name: string; rows: number }

/** null — qayta tahlil qilinadi; matn — kerak emas (egasiga sababi) */
export function staleReason(prev: { createdAt: string; data: Table[] } | null, next: Table[], now = new Date()): string | null {
  if (!prev) return null;
  const had = new Set(prev.data.filter(t => t.rows > 0).map(t => t.name));
  if (next.some(t => t.rows > 0 && !had.has(t.name))) return null;
  const before = prev.data.reduce((s, t) => s + t.rows, 0), after = next.reduce((s, t) => s + t.rows, 0);
  const growth = (after - before) / Math.max(before, 1);
  const due = new Date(Date.parse(prev.createdAt) + RERUN_DAYS * 86_400_000);
  if (growth >= RERUN_GROWTH || now >= due) return null;
  const added = after - before;
  return `Oxirgi tahlildan beri ma'lumot kam o'zgardi (${added >= 0 ? '+' : ''}${added} qator, ${Math.round(growth * 100)}%) — topilmalar hali o'z kuchida, pul sarflanmadi. `
    + `Yangisi ma'lumot ${Math.round(RERUN_GROWTH * 100)}% ko'payganda yoki ${iso(due)} dan keyin qilinadi.`;
}
