/**
 * Kamera aniqligi — pilotda o'lchash uchun: oxirgi kunlarda kamera DentaCRM'dagi qabullarni qanchalik topdi.
 * Har kun uchun kechki hisobotdagi qoida (reconcile.ts): kreslo o'tirishlari ↔ qabullar, faqat kamera o'sha kuni uzluksiz ko'rgan
 * oraliqda (camera_days) — kamera o'chiq bo'lgan payt «topilmadi» deb sanalmaydi.
 *   topildi   — kamerada o'tirish bor, CRM'da kelgan qabul bor;
 *   topilmadi — CRM'da kelgan, kamera ko'rmadi (qamrov ichida);
 *   ortiqcha  — kamerada o'tirish bor, CRM'da mos qabul yo'q (yozilmagan bemor yoki kamera adashgan);
 *   to'lovsiz — kechki hisobotdagi «to'lov yozilmagan» ogohlantirishlari.
 * Maqsad (reja, 6-bosqich): qabullarning ≥ 90% topilsin, «to'lovsiz» ogohlantirish kuniga ko'pi bilan 1 ta.
 */
import type { AccuracyDay, CameraAccuracy } from '../../src/types';
import { addDays, iso } from '../../src/lib/week';
import { cameraSessions, cameras, type BusinessRow } from '../db';
import { crmConnected, withCrm } from '../crm/index';
import { env } from '../env';
import { reconcile, unbilled, type Sitting } from './reconcile';

export const TARGET_RECALL = 0.9, TARGET_UNBILLED_PER_DAY = 1;

const minuteOf = (isoTime: string) => { const d = new Date(isoTime); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Oxirgi `days` kun (bugundan tashqari — tugamagan kun o'lchanmaydi). CRM ulanmagan bo'lsa — null */
export async function cameraAccuracy(biz: BusinessRow, days = 7, now = new Date()): Promise<CameraAccuracy | null> {
  if (!crmConnected(biz.id)) return null;
  const cams = cameras.list(biz.id);
  const out: AccuracyDay[] = [], skipped: string[] = [];
  for (let back = days; back >= 1; back--) {
    const date = iso(addDays(now, -back));
    // Shifokor kreslosini o'sha kuni ko'rgan kameralar va qamrov oralig'i
    const coverage = new Map<string, { fromMin: number; toMin: number }>();
    for (const c of cams) {
      const seen = cameras.coverage(biz.id, c.id, date);
      if (!seen) continue;
      for (const z of c.zones) if (z.kind === 'chair' && z.doctorId) coverage.set(z.doctorId, { fromMin: minuteOf(seen.from), toMin: minuteOf(seen.to) });
    }
    if (!coverage.size) continue;
    const [y, m, d] = date.split('-').map(Number);
    const sessions = cameraSessions.between(biz.id, new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString());
    const zones = cams.flatMap(c => c.zones);
    const sittings: Sitting[] = sessions
      .filter(s => s.kind === 'chair' && s.endedAt && Date.parse(s.endedAt) - Date.parse(s.startedAt) >= env.cameraMinSessionSec * 1000)
      .map(s => ({ id: s.id, doctorId: zones.find(z => z.id === s.zoneId)?.doctorId ?? null, label: s.zoneName, startMin: minuteOf(s.startedAt), endMin: minuteOf(s.endedAt!) }));
    let crm;
    try { crm = await withCrm(biz.id, c => c.day(date)); } catch { skipped.push(date); continue; }
    const r = reconcile(sittings, crm.appointments, 24 * 60, coverage);
    // Topilganlardan faqat qamrov ichidagilari — «topilmadi» ham shunday sanaladi
    const inside = (doctorId: string, time: string) => { const c = coverage.get(doctorId); return !!c && toMin(time) >= c.fromMin && toMin(time) <= c.toMin; };
    out.push({
      date,
      found: r.matched.filter(x => inside(x.appointment.doctorId, x.appointment.time)).length,
      missed: r.missed.length,
      extra: r.ghosts.length,
      unbilled: unbilled(r, crm.transactions, 24 * 60, env.cameraPayGraceMin).length,
    });
  }
  const found = out.reduce((n, x) => n + x.found, 0), missed = out.reduce((n, x) => n + x.missed, 0);
  const per = (key: 'extra' | 'unbilled') => (out.length ? out.reduce((n, x) => n + x[key], 0) / out.length : 0);
  return {
    days: out, recall: found + missed ? found / (found + missed) : null, extraPerDay: per('extra'), unbilledPerDay: per('unbilled'),
    targets: { recall: TARGET_RECALL, unbilledPerDay: TARGET_UNBILLED_PER_DAY }, skipped,
  };
}
