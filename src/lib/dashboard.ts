/**
 * Boshqaruv paneli: davr (bugun, kecha, hafta, oy, oraliq), ko'rsatkichlar va ularning turlari — server va panel uchun umumiy.
 * Davr mahalliy kunlar bilan beriladi (from, to — ikkalasi ham kiradi); oldingi davr — xuddi shuncha kun, darhol oldin.
 */
import { addDays, iso } from './week';

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export const PERIOD_LABEL: Record<Exclude<PeriodKey, 'custom'>, string> = { today: 'Bugun', yesterday: 'Kecha', week: 'Hafta', month: 'Oy' };
/** Oraliq shundan uzun bo'lmaydi (bitta so'rovda) */
export const MAX_PERIOD_DAYS = 366;

export interface Period { key: PeriodKey; from: string; to: string }

/** Davr kunlari: today/yesterday — bitta kun; week — oxirgi 7 kun (bugun bilan); month — oxirgi 30 kun */
export function periodDays(key: PeriodKey, now: Date, custom?: { from: string; to: string }): Period {
  const today = iso(now);
  if (key === 'yesterday') { const y = iso(addDays(now, -1)); return { key, from: y, to: y }; }
  if (key === 'week') return { key, from: iso(addDays(now, -6)), to: today };
  if (key === 'month') return { key, from: iso(addDays(now, -29)), to: today };
  if (key === 'custom' && custom && custom.from <= custom.to) return { key, from: custom.from, to: custom.to };
  return { key: 'today', from: today, to: today };
}

/** Kunlar soni (ikkala chekka ham) */
export const daysIn = (p: { from: string; to: string }): number => Math.round((Date.parse(`${p.to}T12:00:00`) - Date.parse(`${p.from}T12:00:00`)) / 86_400_000) + 1;

/** Oldingi davr: xuddi shuncha kun, darhol oldin */
export function previousPeriod(p: { from: string; to: string }): { from: string; to: string } {
  const n = daysIn(p);
  const start = new Date(`${p.from}T12:00:00`);
  return { from: iso(addDays(start, -n)), to: iso(addDays(start, -1)) };
}

/** O'zgarish foizi (oldingisi 0 bo'lsa — null: «yangi») */
export const changePct = (value: number, prev: number): number | null => (prev ? Math.round(((value - prev) / prev) * 100) : null);

export interface Kpi { value: number; prev: number; series: number[] }

export interface DashboardView {
  period: Period & { bucket: 'hour' | 'day'; labels: string[] };
  kpi: {
    /** Murojaatlar: mijoz yozgan kunlar (bir odam bir kunda — bitta) + kiruvchi qo'ng'iroqlar */
    inquiries: Kpi & { instagram: number; telegram: number; calls: number };
    /** Javob berilgan murojaatlar va xabarga birinchi javobning o'rtacha (mediana) vaqti, daqiqa */
    answered: Kpi & { responseMin: number | null; prevResponseMin: number | null };
    /** Hali javobsiz: javob yozilmagan xabarlar va qayta qo'ng'iroq qilinmagan o'tkazib yuborilganlar */
    unanswered: Kpi & { messages: number; missedCalls: number };
    /** So'rovlar: davrda ochilgani (value), yopilgani, hozir ochiq, yopish vaqti (mediana, daqiqa) */
    requests: Kpi & { closed: number; open: number; closeMin: number | null };
    /** Qabulga (uchrashuvga) yozilganlar: yozishmada, ovozli agent va qo'ng'iroq tahlili bo'yicha */
    booked: Kpi;
    newLeads: Kpi;
  };
  /** Grafik: har bo'lakda kanallar bo'yicha */
  dynamics: { instagram: number[]; telegram: number[]; callsIn: number[]; callsOut: number[]; missed: number[] };
  team: TeamRow[];
  recent: RecentItem[];
}

/** Voronka bosqichi: jami va kanallar bo'yicha (bir odam — bir marta, davrdagi birinchi murojaati kanali) */
export interface FunnelStep { total: number; byChannel: { instagram: number; telegram: number; call: number } }
export interface FunnelView {
  /** DentaCRM ulanganmi; linked — murojaat qilganlardan nechtasi bemorga bog'langan */
  crm: boolean;
  linked: number;
  inquiries: FunnelStep;
  answered: FunnelStep;
  booked: FunnelStep;
  /** Keldi va to'ladi — faqat DentaCRM bilan (bo'lmasa null) */
  came: FunnelStep | null;
  paid: FunnelStep | null;
  /** Tushum, so'm: murojaat qilganlarning davrdan beri to'lagani (balansdan to'lov kirmaydi) */
  revenue: { total: number; byChannel: { instagram: number; telegram: number; call: number } } | null;
  problem?: string;
}

export interface TeamRow { id: string | null; name: string; role: 'owner' | 'reception'; linked: boolean; closed: number; noAnswer: number; closeMin: number | null; lastActiveAt: string | null }

export interface RecentItem {
  kind: 'message' | 'call' | 'request';
  at: string;
  leadId: string | null;
  who: string;
  /** instagram, telegram, bot, call, voice … */
  channel: string;
  text: string;
  /** message: answered / waiting; call: ended / missed / no_answer / talking; request: open / done / cancelled */
  state: string;
}
