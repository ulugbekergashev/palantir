import type { AppointmentStatus, ClinicAppointment, ClinicDay } from '../types';

/** came — keldi yoki tugadi (yashil); wait — hali kutilmoqda (neytral); bad — kelmadi (qizil); off — bekor qilingan */
export type ApptTone = 'came' | 'wait' | 'bad' | 'off';
export interface ApptLook { label: string; tone: ApptTone }

const LOOK: Record<AppointmentStatus, ApptLook> = {
  Pending: { label: 'kutilmoqda', tone: 'wait' },
  Confirmed: { label: 'tasdiqlangan', tone: 'wait' },
  'Checked-In': { label: 'keldi', tone: 'came' },
  Completed: { label: 'tugadi', tone: 'came' },
  'No-Show': { label: 'kelmadi', tone: 'bad' },
  Cancelled: { label: 'bekor', tone: 'off' },
};

/** Qabul holatining o'zbekcha nomi va rangi; notanish holat — o'zi, neytral rangda */
export const apptLook = (status: string): ApptLook => (Object.hasOwn(LOOK, status) ? LOOK[status as AppointmentStatus] : { label: status, tone: 'wait' });

const METHODS: Record<string, string> = { Cash: 'Naqd', Card: 'Karta', Click: 'Click', Transfer: "O'tkazma" };
const METHOD_ORDER = Object.keys(METHODS);

/** Tushum to'lov usullari bo'yicha: avval naqd, karta, Click, o'tkazma; qolganlari CRM'dagi nomi bilan. Nol summalar tashlanadi */
export function revenueLines(byMethod: ClinicDay['revenue']['by_method']): { label: string; amount: number }[] {
  const rank = (key: string) => { const i = METHOD_ORDER.indexOf(key); return i < 0 ? METHOD_ORDER.length : i; };
  return Object.entries(byMethod)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, amount]) => ({ label: Object.hasOwn(METHODS, key) ? METHODS[key] : key, amount }));
}

/** "9:30" → 570 (kun boshidan daqiqa); o'qib bo'lmasa — null */
export function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const HOUR = 60;
/** Davomiyligi yozilmagan qabul chiziqda shuncha joy oladi */
const DEFAULT_VISIT_MIN = 30;
/** Kun chizig'i kamida shu oraliqni ko'rsatadi (odatiy ish kuni) */
const DAY_FROM = 9 * HOUR, DAY_TO = 18 * HOUR;

export const visitMinutes = (a: ClinicAppointment): number => (a.duration > 0 ? a.duration : DEFAULT_VISIT_MIN);

/** Kun chizig'ining boshi va oxiri (daqiqada, to'liq soatlarga yaxlitlangan): hamma shifokorning qabullari sig'adi */
export function dayRange(day: ClinicDay): { from: number; to: number } {
  const spans = day.doctors.flatMap(d => d.appointments).flatMap(a => { const at = minutesOf(a.time); return at === null ? [] : [{ at, end: at + visitMinutes(a) }]; });
  const from = Math.min(DAY_FROM, ...spans.map(s => Math.floor(s.at / HOUR) * HOUR));
  const to = Math.max(DAY_TO, ...spans.map(s => Math.ceil(s.end / HOUR) * HOUR));
  return { from, to: Math.min(to, 24 * HOUR) };
}

/**
 * Hozirdan keyingi eng yaqin, hali kutilayotgan qabul (kelgan, kelmagan va bekor qilinganlar hisobga kirmaydi); yo'q bo'lsa — null.
 * Biror shifokorning ro'yxati to'liq kelmagan bo'lsa (more) ham null: ko'rinmagan qabul yaqinroq bo'lishi mumkin.
 */
export function nextVisit(day: ClinicDay, nowMin: number): { time: string; patient: string; doctor: string } | null {
  if (day.doctors.some(d => d.more)) return null;
  const ahead = day.doctors
    .flatMap(d => d.appointments.filter(a => apptLook(a.status).tone === 'wait').map(a => ({ at: minutesOf(a.time) ?? -1, time: a.time, patient: a.patient, doctor: d.doctor })))
    .filter(v => v.at >= nowMin)
    .sort((a, b) => a.at - b.at);
  return ahead[0] ?? null;
}

/** Qatorlar orasida «hozir» chizig'i turadigan joy: shu indeksdan boshlab qabullar hali boshlanmagan */
export const nowIndex = (rows: ClinicAppointment[], nowMin: number): number => {
  const i = rows.findIndex(a => (minutesOf(a.time) ?? 0) > nowMin);
  return i < 0 ? rows.length : i;
};
