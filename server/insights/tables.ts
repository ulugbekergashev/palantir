/**
 * Chuqur tahlil jadvallari — sof qism (bazasiz, sinovlar to'g'ridan-to'g'ri chaqiradi): CSV, mahalliy vaqt, yosh, jins va DentaCRM
 * ma'lumotidan qabullar, to'lovlar, bemorlar jadvallari. Ma'lumotni yig'ish — dataset.ts.
 */
import { iso } from '../../src/lib/week';
import type { PatientStat, PaymentStat, VisitStat } from '../crm/dentacrm';

export interface DataFile { name: string; about: string; rows: number; csv: string }
export interface Dataset { files: DataFile[]; from: string; to: string; notes: string[] }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CAME = new Set(['Completed', 'Checked-In']);

type Cell = string | number | boolean | null | undefined;
const cell = (v: Cell) => {
  if (v == null || v === '') return '';
  const s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(head: string[], rows: Cell[][]): string {
  return [head.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
}

/** Mahalliy sana, vaqt, soat va hafta kuni */
export function local(isoStr: string | null): { date: string; time: string; hour: number; weekday: string } | null {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return null;
  return { date: iso(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, hour: d.getHours(), weekday: WEEKDAYS[(d.getDay() + 6) % 7] };
}
export const minutes = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null);
/** Yosh (yil) tug'ilgan sanadan — «YYYY-MM-DD» yoki «DD.MM.YYYY» */
export function ageAt(dob: string | null, on: string): number | null {
  if (!dob) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob), dmy = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(dob);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [y, mo, d] = parts.map(Number);
  const [oy, om, od] = on.split('-').map(Number);
  const age = oy - y - (om < mo || (om === mo && od < d) ? 1 : 0);
  return age >= 0 && age < 120 ? age : null;
}
const gender = (g: string | null) => { const s = (g ?? '').toLowerCase(); return /^(m|male|erkak|муж)/.test(s) ? 'M' : /^(f|female|ayol|жен)/.test(s) ? 'F' : ''; };

/** CRM ma'lumotidan qabullar, to'lovlar va bemorlar jadvallari (sof funksiya: sinovlar to'g'ridan-to'g'ri chaqiradi) */
export function crmTables(stats: { visits: VisitStat[]; payments: PaymentStat[]; patients: PatientStat[] }, code: (kind: 'P' | 'V' | 'T', id: string) => string, from: string, to: string): DataFile[] {
  const patients = new Map(stats.patients.map(p => [p.id, p]));
  const visits = stats.visits.filter(v => v.date >= from && v.date <= to);
  const payments = stats.payments.map(p => ({ ...p, day: (p.date ?? '').slice(0, 10) || (local(p.createdAt)?.date ?? '') })).filter(p => p.day >= from && p.day <= to);
  // Bemorning birinchi yozilgan qabuli — butun tarix bo'yicha, holatidan qat'i nazar (birinchi qabulga kelmaganlar ham ko'rinsin)
  const firstBooked = new Map<string, string>();
  for (const v of stats.visits) if (v.patientId && (!firstBooked.has(v.patientId) || v.date < firstBooked.get(v.patientId)!)) firstBooked.set(v.patientId, v.date);
  const paidByVisit = new Map<string, number>(), paidByPatientDay = new Map<string, number>();
  for (const p of payments) {
    if (p.status && /cancel|refund|bekor/i.test(p.status)) continue;
    if (p.appointmentId) paidByVisit.set(p.appointmentId, (paidByVisit.get(p.appointmentId) ?? 0) + p.amount);
    else if (p.patientId) paidByPatientDay.set(`${p.patientId}|${p.day}`, (paidByPatientDay.get(`${p.patientId}|${p.day}`) ?? 0) + p.amount);
  }
  const visitRows = visits.map(v => {
    const pt = v.patientId ? patients.get(v.patientId) : undefined;
    const scheduled = v.time ? new Date(`${v.date}T${v.time}:00`).toISOString() : null;
    const entered = local(v.enteredAt), finished = local(v.finishedAt);
    const paid = paidByVisit.get(v.id) ?? (v.patientId ? paidByPatientDay.get(`${v.patientId}|${v.date}`) : undefined) ?? 0;
    const wd = WEEKDAYS[(new Date(`${v.date}T12:00:00`).getDay() + 6) % 7];
    return [code('V', v.id), v.date, wd, v.time, v.time ? Number(v.time.slice(0, 2)) : null, v.doctorName, v.type, v.status, CAME.has(v.status), v.status === 'No-Show', v.status === 'Cancelled',
      v.duration, entered?.time, finished?.time, minutes(scheduled, v.enteredAt), minutes(v.enteredAt, v.finishedAt), v.callStatus, v.rating,
      v.patientId ? code('P', v.patientId) : null, gender(pt?.gender ?? null), ageAt(pt?.dob ?? null, v.date), !!v.patientId && firstBooked.get(v.patientId) === v.date, pt?.label, paid];
  });
  const paymentRows = payments.map(p => {
    const pt = p.patientId ? patients.get(p.patientId) : undefined;
    const t = local(p.createdAt);
    return [code('T', p.id), p.day, t?.weekday ?? WEEKDAYS[(new Date(`${p.day}T12:00:00`).getDay() + 6) % 7], t?.time, t?.hour, p.amount, p.discountAmount, p.type, p.service, p.category, p.status, p.doctorName,
      p.patientId ? code('P', p.patientId) : null, gender(pt?.gender ?? null), ageAt(pt?.dob ?? null, p.day), p.appointmentId ? code('V', p.appointmentId) : null];
  });
  const byPatient = new Map<string, { visits: number; came: number; noShow: number; first: string | null; last: string | null; paid: number }>();
  for (const v of stats.visits) {
    if (!v.patientId) continue;
    const s = byPatient.get(v.patientId) ?? { visits: 0, came: 0, noShow: 0, first: null, last: null, paid: 0 };
    s.visits++;
    if (CAME.has(v.status)) { s.came++; s.first = !s.first || v.date < s.first ? v.date : s.first; s.last = !s.last || v.date > s.last ? v.date : s.last; }
    if (v.status === 'No-Show') s.noShow++;
    byPatient.set(v.patientId, s);
  }
  for (const p of stats.payments) if (p.patientId && !(p.status && /cancel|refund|bekor/i.test(p.status))) { const s = byPatient.get(p.patientId); if (s) s.paid += p.amount; }
  const patientRows = stats.patients.map(p => {
    const s = byPatient.get(p.id);
    return [code('P', p.id), gender(p.gender), ageAt(p.dob, to), local(p.createdAt)?.date, p.label, p.status, s?.visits ?? 0, s?.came ?? 0, s?.noShow ?? 0, s?.first, s?.last, s?.paid ?? 0];
  });
  return [
    { name: 'visits.csv', rows: visitRows.length, about: 'DentaCRM appointments: scheduled date/time, doctor, type, status (came / no_show / cancelled), planned minutes, actual entered/finished time in the chair, wait_min = entered minus scheduled time, chair_min, reminder call result, patient rating 1-5, patient code, gender, age, first_booking = the patient\'s first appointment ever (whatever its status), VIP label, sum paid for this visit.',
      csv: toCsv(['visit', 'date', 'weekday', 'time', 'hour', 'doctor', 'type', 'status', 'came', 'no_show', 'cancelled', 'planned_min', 'entered', 'finished', 'wait_min', 'chair_min', 'call_status', 'rating', 'patient', 'gender', 'age', 'first_booking', 'patient_label', 'paid'], visitRows) },
    { name: 'payments.csv', rows: paymentRows.length, about: 'DentaCRM payments: date, time, amount, discount, payment type (cash/card/…), service, category, status, doctor, patient code, gender, age, visit code.',
      csv: toCsv(['payment', 'date', 'weekday', 'time', 'hour', 'amount', 'discount', 'type', 'service', 'category', 'status', 'doctor', 'patient', 'gender', 'age', 'visit'], paymentRows) },
    { name: 'patients.csv', rows: patientRows.length, about: 'All DentaCRM patients (all time): gender, age, registration date, label, status, number of appointments, visits came, no-shows, first and last day they actually came, total paid.',
      csv: toCsv(['patient', 'gender', 'age', 'registered', 'label', 'status', 'appointments', 'came', 'no_shows', 'first_came', 'last_came', 'paid_total'], patientRows) },
  ];
}
