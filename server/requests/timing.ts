/**
 * So'rov eslatmalari vaqti — sof qoidalar (bazaga tegmaydi; requests/index.ts va sinovlar ishlatadi).
 * Vaqtlar mahalliy satr «YYYY-MM-DDTHH:MM» (vazifalar bilan bir xil).
 */
import type { RequestKind } from '../../src/types';
import { stamp } from '../../src/lib/week';

/** Birinchi eslatma: qo'ng'iroq va qabul so'rovi — 15 daqiqada, qolganlari — yarim soat-bir soatda; keyin har 30 daqiqa / 1–2 soatda */
export const FIRST_MIN: Record<RequestKind, number> = { callback: 15, booking: 15, change: 30, complaint: 30, other: 60 };
export const REPEAT_MIN: Record<RequestKind, number> = { callback: 30, booking: 30, change: 60, complaint: 60, other: 120 };
export const MAX_REMINDERS = 3;
/** «Ko'tarmadi»dan keyin qayta qo'ng'iroq — shuncha daqiqadan keyin; shuncha urinishdan keyin eslatma to'xtaydi */
export const RETRY_MIN = 30;
export const MAX_ATTEMPTS = 3;
const MORNING = '09:00';
const MAX_DUE_DAYS = 14;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Eslatma beriladigan soatlar (REQUEST_HOURS="8-21"): tungi so'rov ertalab eslatiladi, tunda karta ovozsiz keladi */
export interface DayHours { from: number; to: number }

export const later = (from: Date, minutes: number): string => stamp(new Date(from.getTime() + minutes * 60_000));

/** Ish soatidan tashqaridagi vaqt — keyingi ertalabga (09:00) suriladi */
export function daytime(local: string, hours: DayHours): string {
  const hour = Number(local.slice(11, 13));
  if (hour >= hours.from && hour < hours.to) return local;
  const day = hour >= hours.to ? stamp(new Date(Date.parse(`${local.slice(0, 10)}T12:00:00`) + 86_400_000)).slice(0, 10) : local.slice(0, 10);
  return `${day}T${MORNING}`;
}

export const isNight = (now: Date, hours: DayHours): boolean => now.getHours() < hours.from || now.getHours() >= hours.to;

/** Model yoki agent aytgan vaqt: haqiqiy, o'tib ketmagan (bir soatgacha mumkin) va ikki haftadan uzoq emas */
export function cleanDue(v: string | null | undefined, now = new Date()): string | null {
  if (!v || !LOCAL.test(v)) return null;
  const t = Date.parse(`${v}:00`);
  if (!Number.isFinite(t) || t < now.getTime() - 3_600_000 || t > now.getTime() + MAX_DUE_DAYS * 86_400_000) return null;
  return v;
}

/** Birinchi eslatma: mijoz aytgan vaqtda (u keyinroq bo'lsa), aks holda FIRST_MIN daqiqadan keyin — ish soatiga surib */
export const firstRemind = (kind: RequestKind, dueAt: string | null, now: Date, hours: DayHours): string => {
  const soon = later(now, FIRST_MIN[kind]);
  return daytime(dueAt && dueAt > soon ? dueAt : soon, hours);
};
