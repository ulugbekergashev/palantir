/**
 * Kutish joyi va kreslo bandligi — sof qoidalar (baza va vaqt yo'q): kadrdagi odamlarni kadrdan kadrga bog'lash,
 * kreslo qancha band bo'lgani va kutishlar hisobi. Jonli holat va yozish — waiting.ts.
 */
import type { Attendance, Camera, CameraSession, ChairUse, WaitStats } from '../../src/types';
import { inZone, type Box } from './sessions';

/** Kutayotgan odam: markazi (kadr ulushida), qachondan beri va oxirgi ko'ringan payt; told — uzoq kutgani aytildi */
export interface Track { id: string; cx: number; cy: number; since: number; lastSeen: number; told: boolean }
export interface TrackOpts { leaveMs: number; maxJump: number }
/** Kadrlar orasida markaz shundan ko'p siljisa — boshqa odam (kadr ulushida) */
export const MAX_JUMP = 0.12;

let seq = 0;

/** Bitta kadr: zonadagi odamlar oldingi kadrdagilarga bog'lanadi; leaveMs davomida ko'rinmaganlar — ketgan (finished) */
export function trackStep(tracks: readonly Track[], people: readonly Box[], zone: Box, now: number, o: TrackOpts): { tracks: Track[]; finished: Track[] } {
  const points = people.filter(p => inZone(p, zone)).map(p => ({ cx: p.x + p.w / 2, cy: p.y + p.h / 2 }));
  const pairs = tracks.flatMap((t, ti) => points.map((p, pi) => ({ ti, pi, d: Math.hypot(t.cx - p.cx, t.cy - p.cy) })))
    .filter(x => x.d <= o.maxJump).sort((a, b) => a.d - b.d);
  const seenAt = new Map<number, { cx: number; cy: number }>();
  const usedPoints = new Set<number>();
  for (const x of pairs) {
    if (seenAt.has(x.ti) || usedPoints.has(x.pi)) continue;
    seenAt.set(x.ti, points[x.pi]);
    usedPoints.add(x.pi);
  }
  const kept: Track[] = [], finished: Track[] = [];
  tracks.forEach((t, ti) => {
    const p = seenAt.get(ti);
    if (p) kept.push({ ...t, ...p, lastSeen: now });
    else if (now - t.lastSeen <= o.leaveMs) kept.push(t);
    else finished.push(t);
  });
  points.forEach((p, pi) => { if (!usedPoints.has(pi)) kept.push({ id: `w${++seq}`, ...p, since: now, lastSeen: now, told: false }); });
  return { tracks: kept, finished };
}

/** Ish vaqti (kun boshidan daqiqa) */
export interface WorkHours { fromMin: number; toMin: number }
export const DEFAULT_HOURS: WorkHours = { fromMin: 8 * 60, toMin: 21 * 60 };
/** Egasining matnidan birinchi «HH:MM–HH:MM» («Du–Sh 9:00–20:00»); topilmasa yoki tushunarsiz bo'lsa — 08:00–21:00 */
export function workHours(text?: string | null): WorkHours {
  const m = /(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/.exec(text ?? '');
  if (!m) return DEFAULT_HOURS;
  const fromMin = Number(m[1]) * 60 + Number(m[2]), toMin = Number(m[3]) * 60 + Number(m[4]);
  return fromMin < toMin && toMin <= 24 * 60 ? { fromMin, toMin } : DEFAULT_HOURS;
}
export const inHours = (h: WorkHours, at: Date): boolean => { const m = at.getHours() * 60 + at.getMinutes(); return m >= h.fromMin && m < h.toMin; };

/** Kreslo bandligi foizi shundan kam kuzatilgan bo'lsa aytilmaydi (bir necha daqiqadan foiz chiqarish — aldash) */
const MIN_WATCH_MIN = 10;

const minutes = (ms: number) => Math.round(ms / 60_000);
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Kreslo bandligi: ish vaqtida, kamera uzluksiz kuzatgan oraliqda (seenFrom..lastSeenAt) kresloda kimdir o'tirgan vaqt.
 * Kechayu kunduz ishlaydigan kamerada tun hisobga kirmaydi; kamera uzilgan bo'lsa, seenFrom keyinroq bo'ladi — undan oldingi
 * o'tirishlar ham hisobdan chiqadi (foiz to'g'ri qoladi)
 */
export function chairUse(cams: readonly Camera[], sessions: readonly CameraSession[], dayStart: number, now: number, hours: WorkHours): ChairUse[] {
  const open = dayStart + hours.fromMin * 60_000, close = dayStart + hours.toMin * 60_000;
  return cams.flatMap(cam => cam.zones.filter(z => z.kind === 'chair').map((zone): ChairUse => {
    const from = cam.seenFrom ? Math.max(open, Date.parse(cam.seenFrom)) : 0;
    const to = cam.lastSeenAt ? Math.min(close, now, Date.parse(cam.lastSeenAt)) : 0;
    const watched = Math.max(0, to - from);
    const busy = watched ? sessions.filter(s => s.cameraId === cam.id && s.zoneId === zone.id && s.kind === 'chair')
      .reduce((sum, s) => sum + overlap(Date.parse(s.startedAt), s.endedAt ? Date.parse(s.endedAt) : now, from, to), 0) : 0;
    const watchedMin = minutes(watched);
    return { zoneId: zone.id, name: zone.name, cameraName: cam.name, busyMin: minutes(busy), watchedMin, pct: watchedMin >= MIN_WATCH_MIN ? Math.min(100, Math.round((busy / watched) * 100)) : null };
  }));
}

/** Kutishlar hisobi: tugagan kutishlar (seanslar) va hozir kutayotganlar */
export function waitStats(sessions: readonly CameraSession[], alertMin: number, current: { people: number; longestMs: number }): WaitStats {
  const waits = sessions.filter(s => s.kind === 'waiting' && s.endedAt).map(s => Date.parse(s.endedAt!) - Date.parse(s.startedAt));
  const total = waits.reduce((a, b) => a + b, 0);
  return {
    count: waits.length, avgMin: waits.length ? minutes(total / waits.length) : 0, maxMin: minutes(Math.max(0, ...waits)),
    longCount: waits.filter(w => w >= alertMin * 60_000).length, alertMin, nowWaiting: current.people, nowLongestMin: minutes(current.longestMs),
  };
}

/** Xodim joyidagi ikki o'tirish orasi shundan qisqa bo'lsa — «yo'qlik» emas (bir zum turib ketgan) */
const AWAY_MIN = 5;

/** Xodim joylari bo'yicha kun: kelgan, ketgan, joyida bo'lgan vaqt va eng uzoq yo'qligi */
export function attendance(cams: readonly Camera[], sessions: readonly CameraSession[], now: number): Attendance[] {
  return cams.flatMap(cam => cam.zones.filter(z => z.kind === 'staff').map((zone): Attendance => {
    const mine = sessions.filter(s => s.cameraId === cam.id && s.zoneId === zone.id && s.kind === 'staff').sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    const end = (s: CameraSession) => (s.endedAt ? Date.parse(s.endedAt) : now);
    let longestAway: Attendance['longestAway'] = null;
    for (let i = 1; i < mine.length; i++) {
      const gap = Date.parse(mine[i].startedAt) - end(mine[i - 1]);
      if (gap >= AWAY_MIN * 60_000 && (!longestAway || gap > longestAway.min * 60_000)) longestAway = { from: mine[i - 1].endedAt!, to: mine[i].startedAt, min: minutes(gap) };
    }
    const last = mine.at(-1);
    return {
      zoneId: zone.id, name: zone.name, cameraName: cam.name, firstAt: mine[0]?.startedAt ?? null, lastAt: last ? last.endedAt : null, here: !!last && !last.endedAt,
      presentMin: minutes(mine.reduce((sum, s) => sum + end(s) - Date.parse(s.startedAt), 0)), longestAway,
    };
  }));
}
