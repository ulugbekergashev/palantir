/**
 * Kutish joyi va kreslo bandligi — sof qoidalar (baza va vaqt yo'q): kadrdagi odamlarni kadrdan kadrga bog'lash,
 * kreslo qancha band bo'lgani va kutishlar hisobi. Jonli holat va yozish — waiting.ts.
 */
import type { Camera, CameraSession, ChairUse, WaitStats } from '../../src/types';
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

/** Kreslo bandligi foizi shundan kam kuzatilgan bo'lsa aytilmaydi (bir necha daqiqadan foiz chiqarish — aldash) */
const MIN_WATCH_MIN = 10;

const minutes = (ms: number) => Math.round(ms / 60_000);
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Kreslo bandligi: kamera shu kuni uzluksiz kuzatgan oraliqda (seenFrom..lastSeenAt, kun ichida) kresloda kimdir o'tirgan vaqt.
 * Kamera uzilgan bo'lsa, seenFrom keyinroq bo'ladi — undan oldingi o'tirishlar ham hisobdan chiqadi (foiz to'g'ri qoladi)
 */
export function chairUse(cams: readonly Camera[], sessions: readonly CameraSession[], dayStart: number, dayEnd: number, now: number): ChairUse[] {
  return cams.flatMap(cam => cam.zones.filter(z => z.kind === 'chair').map((zone): ChairUse => {
    const from = cam.seenFrom ? Math.max(dayStart, Date.parse(cam.seenFrom)) : 0;
    const to = cam.lastSeenAt ? Math.min(dayEnd, now, Date.parse(cam.lastSeenAt)) : 0;
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
