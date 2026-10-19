/**
 * Kutish joyi (zona turi «waiting») — jonli holat: kim hozir kutyapti, ketganlarning kutishi bazaga, uzoq kutish haqida xabar.
 * Kutish joyida har odam alohida sanaladi: kadrdan kadrga eng yaqin markaz bo'yicha bog'lanadi (kutayotgan odam kam qimirlaydi).
 * Ketgan odamning kutishi seans bo'lib yoziladi; kimdir juda uzoq kutsa — egasiga xabar (zonaga ko'pi bilan har ALERT_GAP_MS da bitta).
 * Odamni yuzidan tanimaydi: ikki odam bir-birini to'sib o'tsa, ular almashib qolishi mumkin — kutish vaqti baribir taxminan to'g'ri.
 */
import type { Camera, CameraZone } from '../../src/types';
import { newId, sql, type BusinessRow } from '../db';
import { env } from '../env';
import { MAX_JUMP, trackStep, type Track, type TrackOpts } from './occupancy';
import type { Box } from './sessions';

/** Bitta kutish joyi haqida egasiga shundan tez-tez aytilmaydi (gavjum kunda har odam uchun xabar bo'lmasin) */
const ALERT_GAP_MS = 15 * 60_000;

export type WaitAlert = (biz: BusinessRow, cam: Camera, zone: CameraZone, minutes: number) => void;
/** `${kamera}|${zona}` → kutayotganlar */
const live = new Map<string, Track[]>();
const lastAlert = new Map<string, number>();
const opts = (): TrackOpts => ({ leaveMs: env.cameraLeaveSec * 1000, maxJump: MAX_JUMP });
const isoAt = (ms: number) => new Date(ms).toISOString();

/** Ketgan odamning kutishi: o'tib ketgan (minimal seansdan qisqa) odam kutish emas */
function record(biz: BusinessRow, cam: Camera, zone: CameraZone, t: Track): void {
  if (t.lastSeen - t.since < env.cameraMinSessionSec * 1000) return;
  sql.run('INSERT INTO camera_sessions (id, business_id, camera_id, zone_id, kind, zone_name, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(12), biz.id, cam.id, zone.id, 'waiting', zone.name, isoAt(t.since), isoAt(t.lastSeen));
}

/** Kamera kadri (har IP kadr va brauzer kuzatuvi): kutish joylaridagi odamlar */
export function waitFrame(biz: BusinessRow, cam: Camera, people: readonly Box[], now: number, alert: WaitAlert): void {
  const waiting = cam.zones.filter(z => z.kind === 'waiting');
  for (const zone of waiting) {
    const key = `${cam.id}|${zone.id}`;
    const r = trackStep(live.get(key) ?? [], people, zone, now, opts());
    for (const t of r.finished) record(biz, cam, zone, t);
    const due = r.tracks.filter(t => !t.told && now - t.since >= env.cameraWaitAlertMin * 60_000);
    const longest = [...due].sort((a, b) => a.since - b.since)[0];
    const quiet = now - (lastAlert.get(key) ?? 0) < ALERT_GAP_MS;
    if (longest && !quiet) {
      lastAlert.set(key, now);
      alert(biz, cam, zone, Math.round((now - longest.since) / 60_000));
    }
    // Aytilganlar qayta aytilmaydi; tinch oraliqda yetganlar navbatda qoladi
    const told = new Set(longest && !quiet ? due.map(t => t.id) : []);
    live.set(key, r.tracks.map(t => (told.has(t.id) ? { ...t, told: true } : t)));
  }
  // O'chirilgan yoki turi o'zgargan zonalarning holati unutiladi
  for (const key of [...live.keys()]) if (key.startsWith(`${cam.id}|`) && !waiting.some(z => key === `${cam.id}|${z.id}`)) live.delete(key);
}

/** Kadr kelmay qolgan kameralar: kutayotganlar oxirgi ko'ringan paytda «ketdi» deb yoziladi */
export function settleWaits(biz: BusinessRow, cams: readonly Camera[], now = Date.now()): void {
  for (const cam of cams) for (const zone of cam.zones) {
    const key = `${cam.id}|${zone.id}`;
    const tracks = live.get(key);
    if (!tracks?.length) continue;
    const gone = tracks.filter(t => now - t.lastSeen > opts().leaveMs);
    for (const t of gone) record(biz, cam, zone, t);
    live.set(key, tracks.filter(t => !gone.includes(t)));
  }
}

/** Hozir kutish joylarida nechta odam (kamida enterSec turgan) va eng uzog'i qancha kutyapti */
export function waitingNow(cams: readonly Camera[], now = Date.now()): { people: number; longestMs: number } {
  let people = 0, longestMs = 0;
  for (const cam of cams) for (const zone of cam.zones) {
    if (zone.kind !== 'waiting') continue;
    for (const t of live.get(`${cam.id}|${zone.id}`) ?? []) {
      if (now - t.lastSeen > opts().leaveMs || t.lastSeen - t.since < env.cameraEnterSec * 1000) continue;
      people++;
      longestMs = Math.max(longestMs, now - t.since);
    }
  }
  return { people, longestMs };
}
/** Shu zonada hozir kimdir kutyaptimi (panelda zona holati uchun) */
export const waitingIn = (cameraId: string, zoneId: string): boolean => (live.get(`${cameraId}|${zoneId}`) ?? []).length > 0;
