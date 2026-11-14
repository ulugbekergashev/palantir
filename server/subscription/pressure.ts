/**
 * Claude obunasi limitiga bosim (B5, egasi qarori «bemorlar birinchi»): obuna bitta — bemorlarga javob ham, Direktor va kontent ham
 * undan yeydi. Limit yaqinlashsa (SDK: «allowed_warning» yoki 80% dan ko'p), limit yangilanguncha fondagi qo'shimchalar
 * (ertalabki Direktor tahlili, avtomatik kontent) ishlamaydi — bemorlarga javob uchun joy qoladi. Egasi o'zi so'ragani ishlayveradi.
 */
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

/** Shu ulushdan keyin qo'shimchalar to'xtaydi */
export const EXTRAS_PAUSE_AT = 0.8;
/** Yangilanish vaqti aytilmagan bo'lsa — bosim shuncha vaqt amal qiladi (obuna oynasi — 5 soat) */
const DEFAULT_WINDOW_MS = 5 * 3_600_000;

interface Pressure { blocked: boolean; warning: boolean; utilization: number | null; resetsAt: number | null; at: number }
let last: Pressure | null = null;

/** SDK sekundlarda yoki millisekundlarda berishi mumkin; ulush — 0..1 yoki foiz */
const toMs = (t: number | undefined) => (t === undefined ? null : t < 1e12 ? t * 1000 : t);
const toShare = (u: number | undefined) => (u === undefined ? null : u > 1 ? u / 100 : u);

/** Obunadan kelgan oxirgi limit holati (subscription/engine.ts) */
export function notePressure(info: SDKRateLimitInfo, now = Date.now()): void {
  last = { blocked: info.status === 'rejected', warning: info.status === 'allowed_warning', utilization: toShare(info.utilization), resetsAt: toMs(info.resetsAt), at: now };
}

/** Fondagi qo'shimchalar hozir to'xtatilganmi; to'xtatilgan bo'lsa — qachongacha (ms) */
export function extrasPausedUntil(now = Date.now()): number | null {
  if (!last) return null;
  const until = last.resetsAt ?? last.at + DEFAULT_WINDOW_MS;
  if (now >= until) return null;
  return last.blocked || last.warning || (last.utilization ?? 0) >= EXTRAS_PAUSE_AT ? until : null;
}

export const extrasPaused = (now = Date.now()): boolean => extrasPausedUntil(now) !== null;

/** Sinov uchun */
export const resetPressure = (): void => { last = null; };
