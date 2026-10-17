/**
 * Kamera ko'rgan kreslo seanslarini DentaCRM qabullari bilan solishtirish. Sof mantiq.
 * Natija ayblov emas — egasi tekshiradigan farqlar ro'yxati: kamera odamning kimligini bilmaydi, faqat vaqt va kreslo bo'yicha bog'laydi.
 * Shubhali holatda farq aytilmaydi (noto'g'ri ayblov o'tkazib yuborilgan farqdan yomonroq).
 */
import type { CameraFinding } from '../../src/types';
import type { Appointment } from '../crm/logic';

/** Kreslodagi bitta o'tirish: vaqtlar — kun boshidan daqiqa; endMin null — hali o'tiribdi */
export interface Sitting { id: string; doctorId: string | null; label: string; startMin: number; endMin: number | null }
export interface Reconciled { matched: { sitting: Sitting; appointment: Appointment }[]; ghosts: Sitting[]; missed: Appointment[] }
/** Shifokor kreslosini kamera uzluksiz ko'rib turgan oraliq (kun boshidan daqiqa) */
export type Coverage = ReadonlyMap<string, { fromMin: number; toMin: number }>;

/** Bemor qabul vaqtidan shuncha oldin o'tirsa ham, shuncha kech qolsa ham o'sha qabul deb olinadi */
const EARLY_MIN = 30, LATE_MIN = 30;
/** Qabul tugaganidan shuncha o'tib ham kresloda hech kim ko'rinmasa — "ko'rinmadi" */
const GRACE_MIN = 20;

const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const clock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const sameId = (a: string, b: string): boolean => a.replace(/\W/g, '') === b.replace(/\W/g, '');
const gone = (a: Appointment): boolean => a.status === 'Cancelled' || a.status === 'No-Show';
const came = (a: Appointment): boolean => a.status === 'Completed' || a.status === 'Checked-In';
const fits = (s: Sitting, a: Appointment): boolean =>
  (!s.doctorId || sameId(a.doctorId, s.doctorId)) && s.startMin >= toMin(a.time) - EARLY_MIN && s.startMin <= toMin(a.time) + a.duration + LATE_MIN;

/**
 * coverage — kreslosi kamerada ko'rinadigan shifokorlar va kamera ishlab turgan oraliq. "Ko'rinmadi" faqat
 * qabulning butun vaqti shu oraliqqa tushsa aytiladi: kamerasi yo'q yoki o'sha payt o'chiq bo'lgan kabinet haqida hech narsa deyilmaydi.
 */
export function reconcile(sittings: Sitting[], appointments: Appointment[], nowMin: number, coverage: Coverage): Reconciled {
  const live = appointments.filter(a => !gone(a));
  const taken = new Set<string>();
  const matched: Reconciled['matched'] = [];
  const ghosts: Sitting[] = [];
  // Shifokori ma'lum kreslolar oldin bog'lanadi: aks holda egasi belgilanmagan kreslo birovning qabulini olib qo'yadi
  const order = [...sittings].sort((a, b) => Number(!a.doctorId) - Number(!b.doctorId) || a.startMin - b.startMin);
  for (const s of order) {
    const nearest = (pool: Appointment[]) => pool.filter(a => fits(s, a)).sort((a, b) => Math.abs(toMin(a.time) - s.startMin) - Math.abs(toMin(b.time) - s.startMin))[0];
    // Bo'sh qabul topilmasa: bemor kreslodan bir zum turib qaytgan bo'lishi mumkin (rentgen) — bu o'sha qabulning davomi, yangi bemor emas
    // (faqat shifokori ma'lum kresloda: egasiz kresloda bunday taxmin qilib bo'lmaydi)
    const hit = nearest(live.filter(a => !taken.has(a.id))) ?? (s.doctorId ? nearest(live.filter(a => taken.has(a.id))) : undefined);
    if (!hit) { ghosts.push(s); continue; }
    taken.add(hit.id);
    matched.push({ sitting: s, appointment: hit });
  }
  const watched = (a: Appointment): boolean => {
    const c = [...coverage].find(([id]) => sameId(id, a.doctorId))?.[1];
    return !!c && c.fromMin <= toMin(a.time) - EARLY_MIN && toMin(a.time) + a.duration + GRACE_MIN <= Math.min(nowMin, c.toMin);
  };
  return { matched, ghosts: ghosts.sort((a, b) => a.startMin - b.startMin), missed: live.filter(a => !taken.has(a.id) && watched(a)) };
}

/** Farqlar — egasiga ko'rsatiladigan gaplar */
export function findings(r: Reconciled): CameraFinding[] {
  return [
    ...r.ghosts.map((s): CameraFinding => ({ level: 'crit', text: `${s.label}: ${clock(s.startMin)}${s.endMin == null ? ' dan beri' : `–${clock(s.endMin)} da`} kresloda bemor bor${s.endMin == null ? '' : ' edi'}, CRM'da bunday qabul yo'q.` })),
    ...r.missed.map((a): CameraFinding => (came(a)
      ? { level: 'crit', text: `${a.time} · ${a.patientName} (${a.doctorName}): CRM'da «keldi» deb belgilangan, kresloda hech kim ko'rinmadi.` }
      : { level: 'warn', text: `${a.time} · ${a.patientName} (${a.doctorName}): CRM'da qabul bor, kresloda hech kim ko'rinmadi.` })),
  ];
}
