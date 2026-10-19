/**
 * Topshiriqlar — sof qoidalar (bazaga, AI'ga va tarmoqqa tegmaydi; sinovlar shu faylni to'g'ridan-to'g'ri chaqiradi):
 * kamera qoidasi qarori (judge), vaqt oralig'i, model javobini tekshirish (toSpec), jadval vaqti kelganini aniqlash (dueAt, dueEvery).
 */
import type { Camera, OrderMember, OrderSpec, WatchCondition } from '../../src/types';
import { inZone, type Box } from '../camera/sessions';

/** AI ko'zi shundan tez-tez qaramaydi (har qarash — pulli so'rov) */
export const MIN_LOOK_EVERY = 15;
const MAX_MINUTES = 24 * 60;
/** Server qisqa to'xtagan bo'lsa, shu vaqt ichida o'tib ketgan jadvaldagi ish baribir bajariladi; eskisi — o'tkaziladi */
const CATCH_UP_MS = 30 * 60_000;
/** Har N daqiqalik qarash jadval tekshiruvi oralig'iga to'g'ri kelmasa ham kechikmasin */
const LOOK_SLACK_MS = 15_000;

type Watch = Extract<OrderSpec, { kind: 'watch' }>;
/** Shart bajarilayotgan holat: qachondan beri, oxirgi xabar va shart oxirgi marta bajarilgan payt */
export interface Hold { since: number; firedAt: number | null; lastTrue: number }

/** Bir zumlik ko'rinish (o'tib ketgan odam, soya) holat emas */
const MIN_HOLD_MS = 10_000;
/** Holat davom etsa — shuncha vaqtdan keyin yana eslatiladi */
const REPEAT_MS = 60 * 60_000;
/** Detektor bir-ikki kadrda odamni ko'rmay qolsa (egildi, to'sildi) holat uzilmaydi: shart shuncha vaqt bajarilmasagina — tugadi */
export const GRACE_MS = 30_000;

const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Vaqt oralig'ida: from–to (kechasi ham bo'ladi: 21:00–07:00). Oraliq berilmagan — har doim */
export function inWindow(from: string | null, to: string | null, at: Date): boolean {
  if (!from || !to) return true;
  const m = minuteOf(at), a = toMin(from), b = toMin(to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

export const conditionHolds = (c: WatchCondition, count: number, people: number): boolean =>
  c === 'empty' ? count === 0 : c === 'crowd' ? count >= people : count >= 1;

/** Sof qaror: shart hozir bajarilyaptimi (ok) → yangi holat va xabar berish kerakmi */
export function judge(prev: Hold | undefined, ok: boolean, now: number, minutes: number): { next: Hold | undefined; fire: boolean } {
  if (!ok) return { next: prev && now - prev.lastTrue <= GRACE_MS ? prev : undefined, fire: false };
  const since = prev?.since ?? now;
  const held = now - since >= Math.max(minutes * 60_000, MIN_HOLD_MS);
  const due = prev?.firedAt == null || now - prev.firedAt >= REPEAT_MS;
  return { next: { since, firedAt: held && due ? now : prev?.firedAt ?? null, lastTrue: now }, fire: held && due };
}

/** Xabar matni: nima bo'ldi, qayerda */
export function whatHappened(spec: Watch, count: number, place: string): string {
  const long = spec.minutes ? ` ${spec.minutes} daqiqadan beri` : '';
  if (spec.condition === 'empty') return `${place}:${long || ' hozir'} hech kim yo'q`;
  if (spec.condition === 'crowd') return `${place}: ${count} kishi${long}`;
  if (spec.condition === 'linger') return `${place}: kimdir${long || ''} turibdi`;
  return `${place}: odam ko'rindi${count > 1 ? ` (${count} kishi)` : ''}`;
}

/** Shu kameradagi (yoki zonasidagi) odamlar soni */
export const countIn = (cam: Camera, zoneId: string | null, people: Box[]): number => {
  const zone = zoneId ? cam.zones.find(z => z.id === zoneId) : null;
  return zone ? people.filter(p => inZone(p, zone)).length : people.length;
};

/** Har xodimga qaysi topshiriq turlari */
export const KINDS: Record<OrderMember, OrderSpec['kind'][]> = {
  qabulxona: ['standing', 'schedule'], yordamchi: ['standing', 'schedule'], tahlilchi: ['standing', 'schedule'], kuzatuvchi: ['watch', 'look', 'standing'],
};

export type Parsed = { ok: true; spec: OrderSpec; summary: string } | { ok: false; question: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (v: unknown): string | null => { const s = String(v ?? '').trim().replace(/^(\d):/, '0$1:'); return HHMM.test(s) ? s : null; };
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const dayList = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : []);
export const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, ' ').trim().slice(0, max);

/** Model javobi → tekshirilgan topshiriq: vaqt «HH:MM», kamera va zona — shu biznesniki, sonlar — chegarada */
export function toSpec(member: OrderMember, j: Record<string, unknown>, cams: Camera[]): Parsed {
  const kind = String(j.kind);
  const question = oneLine(j.question_to_owner, 300);
  if (kind === 'unclear' || !(KINDS[member] as string[]).includes(kind)) return { ok: false, question: question || "Aniqroq aytib bera olasizmi: nima qilsin va qachon?" };
  const summary = oneLine(j.summary, 300);
  if (!summary) return { ok: false, question: 'Aniqroq aytib bera olasizmi?' };
  const cam = cams.find(c => c.id === j.camera_id) ?? null;
  const zone = cam?.zones.find(z => z.id === j.zone_id) ?? null;
  const from = time(j.from), to = time(j.to);
  const window = from && to ? { from, to } : { from: null, to: null };
  if (kind === 'standing') return { ok: true, spec: { kind }, summary };
  if (kind === 'schedule') {
    const at = time(j.at);
    return at ? { ok: true, spec: { kind, at, days: dayList(j.days) }, summary } : { ok: false, question: 'Soat nechada bajarsin?' };
  }
  if ((kind === 'watch' || kind === 'look') && !cams.length) return { ok: false, question: "Hali kamera ulanmagan — avval «Kameralar» varag'ida kamera qo'shing." };
  if (kind === 'watch') {
    const condition = (['crowd', 'linger', 'empty', 'presence'] as WatchCondition[]).find(c => c === j.condition);
    if (!condition) return { ok: false, question: 'Kamerada nima bo\'lsa xabar bersin?' };
    const people = condition === 'crowd' ? clamp(j.people, 1, 40, 3) : 1;
    return { ok: true, spec: { kind, cameraId: cam?.id ?? null, zoneId: zone?.id ?? null, condition, people, minutes: clamp(j.minutes, 0, MAX_MINUTES, condition === 'presence' ? 0 : 5), ...window }, summary };
  }
  const look = oneLine(j.look_question, 400);
  if (!look) return { ok: false, question: 'Kadrda nimani tekshirsin?' };
  const at = time(j.at);
  return { ok: true, spec: { kind: 'look', cameraId: cam?.id ?? null, at, days: at ? dayList(j.days) : [], everyMin: at ? 0 : clamp(j.every_min, MIN_LOOK_EVERY, MAX_MINUTES, 60), ...window, question: look }, summary };
}

const weekday = (d: Date) => ((d.getDay() + 6) % 7) + 1;

/** Bugungi «HH:MM» vaqti keldimi va hali bajarilmadimi (sof funksiya) */
export function dueAt(at: string, days: number[], lastRunAt: string | null, now: Date): boolean {
  if (days.length && !days.includes(weekday(now))) return false;
  const [h, m] = at.split(':').map(Number);
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const t = now.getTime();
  return t >= slot && t - slot < CATCH_UP_MS && (!lastRunAt || Date.parse(lastRunAt) < slot);
}

/** Har N daqiqalik tekshiruv vaqti keldimi (oraliq ichida) */
export function dueEvery(spec: Extract<OrderSpec, { kind: 'look' }>, lastRunAt: string | null, now: Date): boolean {
  if (spec.at) return dueAt(spec.at, spec.days, lastRunAt, now);
  if (!inWindow(spec.from, spec.to, now)) return false;
  return !lastRunAt || now.getTime() - Date.parse(lastRunAt) >= spec.everyMin * 60_000 - LOOK_SLACK_MS;
}
