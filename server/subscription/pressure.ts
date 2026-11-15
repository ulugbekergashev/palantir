/**
 * Claude obunasi limitini oxirigacha ishlatish, lekin 100% ga yetkazmaslik (egasi qarori, 2026-11-16: obuna baribir to'lanadi —
 * hamma ish Claude'da, limit esa tugamasin). Obuna har javobda limit oynalarini aytadi (rate_limit_event → unifiedWindows):
 * 5 soatlik va haftalik, har biri — ishlatilgan ulush va yangilanish vaqti. Ishlar muhimligi bo'yicha navbatda (lane):
 *   background — fondagi ishlar (ertalabki Direktor, talab tahlili, avtomatik kontent): 85% gacha va haftalik sur'atdan oshmasa;
 *   heavy — egasining katta ishlari (video, brend-buk, hujjat, post, tahlil): 92% gacha;
 *   live — egasining savollari, rasm, kamera: 97% gacha;
 *   patient — bemorlarga javob va qo'ng'iroq tahlili: limit tugaguncha.
 * Yopiq navbatdagi oddiy ishlar (bemor, qo'ng'iroq, kamera) Gemini zaxirasida davom etadi (claude.ts); qolganlari — yangilanish vaqti
 * bilan rad etiladi. Ulush butun foizda keladi va bitta katta ish bir necha foiz yeydi — shuning uchun 100% emas, zaxira qoladi.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { env } from '../env';

export type Lane = 'patient' | 'live' | 'heavy' | 'background';
/** Navbat shu ulushdan (eng band oyna bo'yicha) keyin yopiladi; patient — faqat obuna o'zi rad etganda */
export const LANE_LIMIT: Record<Lane, number> = { background: 0.85, heavy: 0.92, live: 0.97, patient: 1 };
const ORDER: Lane[] = ['patient', 'live', 'heavy', 'background'];

/** Haftalik sur'at: fondagi ishlar haftaning o'tgan qismidan shuncha ko'p ishlatilgan bo'lsa to'xtaydi (oxirida limit qolsin) */
const PACE_MARGIN = 0.1;
/** Haftalik oyna yangilanishiga shuncha qolganda sur'at qaralmaydi: qolgan limit baribir kuyadi — fondagi ishlar ishlatsin */
const LEFTOVER_MS = 12 * 3_600_000;
const WEEK_MS = 7 * 24 * 3_600_000;
/** Yangilanish vaqti aytilmagan oyna — shuncha vaqt amal qiladi (obunaning qisqa oynasi — 5 soat) */
const DEFAULT_WINDOW_MS = 5 * 3_600_000;

interface Window { share: number | null; resetsAt: number | null; rejected: boolean; at: number }
const windows = new Map<string, Window>();

/** SDK sekundlarda yoki millisekundlarda berishi mumkin; ulush — 0..1 yoki foiz */
const toMs = (t: unknown) => (typeof t !== 'number' ? null : t < 1e12 ? t * 1000 : t);
const toShare = (u: unknown) => (typeof u !== 'number' ? null : u > 1 ? u / 100 : u);

type RawWindow = { utilization?: unknown; resetsAt?: unknown; status?: unknown };

/** Obunadan kelgan limit holati (subscription/engine.ts). unifiedWindows — SDK turlarida yo'q, lekin haqiqiy javobda bor */
export function notePressure(info: SDKRateLimitInfo, now = Date.now()): void {
  const put = (name: string, w: RawWindow) => {
    const share = toShare(w.utilization);
    windows.set(name, { share, resetsAt: toMs(w.resetsAt), rejected: w.status === 'rejected', at: now });
  };
  const unified = (info as { unifiedWindows?: Record<string, RawWindow> }).unifiedWindows;
  const given = new Set<string>();
  if (unified && typeof unified === 'object') for (const [name, w] of Object.entries(unified)) if (w && typeof w === 'object') { put(name, w); given.add(name); }
  // Yuqori darajadagisi — joriy oyna. Ogohlantirishda ulush noma'lum bo'lsagina kamida LANE_LIMIT.heavy deb olinadi:
  // shu javobning unifiedWindows'i aniq ulushni bergan bo'lsa — o'sha (ogohlantirish 92% dan pastda ham chiqishi mumkin)
  const name = info.rateLimitType ?? 'five_hour';
  const own = toShare(info.utilization);
  const known = windows.get(name), same = given.has(name) ? known : undefined;
  if (own !== null || !same || info.status !== 'allowed') {
    const share = own ?? same?.share ?? (info.status === 'allowed_warning' ? Math.max(known?.share ?? 0, LANE_LIMIT.heavy) : known?.share ?? null);
    windows.set(name, { share, resetsAt: toMs(info.resetsAt) ?? same?.resetsAt ?? null, rejected: info.status === 'rejected' || !!same?.rejected, at: now });
  }
  save();
}

// Server qayta yonganda oxirgi holat yo'qolmasin: aks holda birinchi katta ish 99% da ham o'tib ketardi
const stateFile = () => join(env.dataDir, 'obuna-limit.json');
function save(): void {
  try {
    writeFileSync(stateFile(), JSON.stringify(Object.fromEntries(windows)));
  } catch (e) {
    console.warn('[obuna] limit holati saqlanmadi:', (e as Error).message);
  }
}
function load(): void {
  try {
    if (!existsSync(stateFile())) return;
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as Record<string, Window>;
    for (const [name, w] of Object.entries(raw)) if (w && typeof w.at === 'number') windows.set(name, { share: w.share ?? null, resetsAt: w.resetsAt ?? null, rejected: !!w.rejected, at: w.at });
  } catch (e) {
    console.warn("[obuna] limit holati o'qilmadi:", (e as Error).message);
  }
}
load();

const liveWindows = (now: number) => [...windows.entries()].filter(([, w]) => now < (w.resetsAt ?? w.at + DEFAULT_WINDOW_MS));
const until = (w: Window) => w.resetsAt ?? w.at + DEFAULT_WINDOW_MS;

/** Haftalik sur'atdan oshib ketganmi; oshgan bo'lsa — sur'at qachon yetib oladi (ms) */
function paceAhead(now: number): number | null {
  const week = windows.get('seven_day');
  if (!week || week.share === null || week.resetsAt === null || now >= week.resetsAt) return null;
  const left = week.resetsAt - now;
  if (left <= LEFTOVER_MS) return null;
  const elapsed = 1 - left / WEEK_MS;
  if (week.share <= elapsed + PACE_MARGIN) return null;
  return week.resetsAt - WEEK_MS + (week.share - PACE_MARGIN) * WEEK_MS;
}

/** Navbat yopiqmi; yopiq bo'lsa — qachon ochiladi (ms). Ma'lumot yo'q (server endi yondi) — ochiq */
export function laneClosedUntil(lane: Lane, now = Date.now()): number | null {
  const limit = LANE_LIMIT[lane];
  const over = liveWindows(now).filter(([, w]) => w.rejected || (w.share !== null && w.share >= limit && lane !== 'patient'));
  const times = over.map(([, w]) => until(w));
  if (lane === 'background') {
    const pace = paceAhead(now);
    if (pace !== null) times.push(pace);
  }
  return times.length ? Math.max(...times) : null;
}

export const laneOpen = (lane: Lane, now = Date.now()): boolean => laneClosedUntil(lane, now) === null;

const LANE_WORK: Record<Lane, string> = {
  background: 'fondagi ishlar', heavy: 'bu katta ish', live: 'bu ish', patient: 'bemorlarga javob',
};
/** Egasiga: nega hozir emas va qachon (Toshkent vaqti; ertaga yoki keyin bo'lsa — sanasi bilan). queued — ish navbatga qo'yildi, o'zi bajariladi */
export function pausedText(lane: Lane, at: number, now = Date.now(), queued = false): string {
  const d = new Date(at), share = busiestShare(now);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  const day = d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' }) === new Date(now).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' })
    ? '' : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Tashkent' })} `;
  return `Claude obunasi limitiga yaqin${share !== null ? ` (${Math.round(share * 100)}%)` : ''} — limit bemorlarga javob uchun saqlanyapti. ${LANE_WORK[lane][0].toUpperCase()}${LANE_WORK[lane].slice(1)} ${day}${time} dan keyin ishlaydi — ${queued ? "o'shanda o'zim bajarib, natijasini yuboraman." : "o'shanda qayta so'rang."}`;
}

/** Panel va jurnal uchun: eng band oyna ulushi (0..1) yoki null */
export function busiestShare(now = Date.now()): number | null {
  const shares = liveWindows(now).map(([, w]) => (w.rejected ? 1 : w.share)).filter((s): s is number => s !== null);
  return shares.length ? Math.max(...shares) : null;
}

// ─── Navbat konteksti ────────────────────────────────────────────────────────

const context = new AsyncLocalStorage<Lane>();
/** Ichma-ich chaqirilsa — kamroq muhimi qoladi (fondagi Direktor ichidagi matn so'rovi ham fondagi ish) */
export function withLane<T>(lane: Lane, fn: () => T): T {
  const cur = context.getStore();
  return context.run(cur && ORDER.indexOf(cur) > ORDER.indexOf(lane) ? cur : lane, fn);
}
export const currentLane = (): Lane | undefined => context.getStore();

// ─── Eski nomlar (jadval: fondagi ishlar) ────────────────────────────────────

export const extrasPausedUntil = (now = Date.now()): number | null => laneClosedUntil('background', now);
export const extrasPaused = (now = Date.now()): boolean => extrasPausedUntil(now) !== null;

/** Sinov uchun */
export const resetPressure = (): void => { windows.clear(); save(); };
/** Sinov uchun: diskdagi holatni qayta o'qish (server qayta yongandek) */
export const reloadPressure = (): void => { windows.clear(); load(); };
