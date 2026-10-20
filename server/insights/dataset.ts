/**
 * Chuqur tahlil uchun ma'lumot to'plami (CSV): DentaCRM (qabullar, to'lovlar, bemorlar), kamera seanslari, qo'ng'iroqlar, yozishmalar,
 * mijozlar va so'rovlar. Shaxsiy belgisiz: bemor va mijoz — shu biznesga xos kod (P…, L…), ism, telefon va xabar matni yo'q; shifokor —
 * ismi bilan (xodim). Mijoz DentaCRM bemoriga bog'langan bo'lsa (leads.patient_id), kodi qabullar bilan birlashadi: murojaat → qabul → to'lov.
 * Vaqt — Toshkent (server mintaqasi).
 */
import { createHash } from 'node:crypto';
import { iso } from '../../src/lib/week';
import { crmConnected, withCrm } from '../crm/index';
import type { PatientStat, PaymentStat, VisitStat } from '../crm/dentacrm';
import { sql, type BusinessRow } from '../db';
import '../phone/store';

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
const minutes = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null);
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
  // Bemorning birinchi kelgan kuni — butun tarix bo'yicha (davrdan oldin kelgan bo'lsa, davrdagi tashrifi «birinchi» emas)
  const firstCame = new Map<string, string>();
  for (const v of stats.visits) if (v.patientId && CAME.has(v.status) && (!firstCame.has(v.patientId) || v.date < firstCame.get(v.patientId)!)) firstCame.set(v.patientId, v.date);
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
      v.patientId ? code('P', v.patientId) : null, gender(pt?.gender ?? null), ageAt(pt?.dob ?? null, v.date), !!v.patientId && firstCame.get(v.patientId) === v.date, pt?.label, paid];
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
    { name: 'visits.csv', rows: visitRows.length, about: 'DentaCRM appointments: scheduled date/time, doctor, type, status (came / no_show / cancelled), planned minutes, actual entered/finished time in the chair, wait_min = entered minus scheduled time, chair_min, reminder call result, patient rating 1-5, patient code, gender, age, whether it was the patient\'s first visit ever, VIP label, sum paid for this visit.',
      csv: toCsv(['visit', 'date', 'weekday', 'time', 'hour', 'doctor', 'type', 'status', 'came', 'no_show', 'cancelled', 'planned_min', 'entered', 'finished', 'wait_min', 'chair_min', 'call_status', 'rating', 'patient', 'gender', 'age', 'first_visit', 'patient_label', 'paid'], visitRows) },
    { name: 'payments.csv', rows: paymentRows.length, about: 'DentaCRM payments: date, time, amount, discount, payment type (cash/card/…), service, category, status, doctor, patient code, gender, age, visit code.',
      csv: toCsv(['payment', 'date', 'weekday', 'time', 'hour', 'amount', 'discount', 'type', 'service', 'category', 'status', 'doctor', 'patient', 'gender', 'age', 'visit'], paymentRows) },
    { name: 'patients.csv', rows: patientRows.length, about: 'All DentaCRM patients (all time): gender, age, registration date, label, status, number of appointments, visits came, no-shows, first and last visit, total paid.',
      csv: toCsv(['patient', 'gender', 'age', 'registered', 'label', 'status', 'appointments', 'came', 'no_shows', 'first_visit', 'last_visit', 'paid_total'], patientRows) },
  ];
}

/** Oxirgi `days` kunning to'plami; DentaCRM ulanmagan yoki javob bermasa — u qismsiz (sababi notes'da) */
export async function buildDataset(biz: BusinessRow, days = 365, now = new Date()): Promise<Dataset> {
  const to = iso(now), from = iso(new Date(now.getTime() - (days - 1) * 86_400_000));
  const fromIso = new Date(`${from}T00:00:00`).toISOString(), toIso = new Date(now.getTime() + 1000).toISOString();
  const code = (kind: string, id: string) => `${kind}${createHash('sha256').update(`${biz.id}:${kind === 'L' ? 'lead' : 'crm'}:${id}`).digest('hex').slice(0, 10)}`;
  // Mijoz bemorga bog'langan bo'lsa — bemor kodi bilan bir xil (jadvallar shu ustun bilan birlashadi)
  const patientCode = (id: string) => code('P', id);
  const files: DataFile[] = [], notes: string[] = [];

  if (crmConnected(biz.id)) {
    try {
      const stats = await withCrm(biz.id, crm => crm.statsExport());
      files.push(...crmTables(stats, (k, id) => code(k, id), from, to));
    } catch (e) {
      notes.push(`DentaCRM ma'lumoti olinmadi: ${(e as Error).message}`);
    }
  } else notes.push("DentaCRM ulanmagan — qabul va to'lovlarsiz");

  const sessions = sql.many(`SELECT s.kind, s.zone_name, s.started_at, s.ended_at, c.name AS camera FROM camera_sessions s LEFT JOIN cameras c ON c.id = s.camera_id
    WHERE s.business_id = ? AND s.started_at >= ? AND s.started_at < ? ORDER BY s.started_at`,
  r => ({ kind: String(r.kind), zone: String(r.zone_name), start: String(r.started_at), end: sql.str(r.ended_at), camera: sql.str(r.camera) }), biz.id, fromIso, toIso);
  if (sessions.length) {
    files.push({ name: 'camera_sessions.csv', rows: sessions.length, about: 'Camera: each period a person stayed in a zone — zone kind (chair = dental chair, desk = cash desk, waiting = waiting area, staff = staff place), zone name, camera, start, end, minutes.',
      csv: toCsv(['camera', 'zone', 'zone_kind', 'date', 'weekday', 'start', 'hour', 'end', 'minutes'], sessions.map(s => { const a = local(s.start); return [s.camera, s.zone, s.kind, a?.date, a?.weekday, a?.time, a?.hour, local(s.end)?.time, minutes(s.start, s.end)]; })) });
  } else notes.push("Kamera seanslari yo'q");

  const calls = sql.many('SELECT started_at, direction, status, duration_sec, source, booked, lead_id FROM calls WHERE business_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at',
    r => ({ at: String(r.started_at), dir: sql.str(r.direction), status: sql.str(r.status), sec: Number(r.duration_sec ?? 0), source: sql.str(r.source), booked: !!sql.str(r.booked), lead: sql.str(r.lead_id) }), biz.id, fromIso, toIso);
  if (calls.length) {
    files.push({ name: 'calls.csv', rows: calls.length, about: 'Phone calls: date, time, direction (in/out), status (ended, missed — nobody answered, no_answer — they did not pick up), duration in seconds, source (voice = AI receptionist, microsip = staff phone), booked during the call, customer code.',
      csv: toCsv(['date', 'weekday', 'time', 'hour', 'direction', 'status', 'duration_sec', 'source', 'booked', 'lead'], calls.map(c => { const a = local(c.at); return [a?.date, a?.weekday, a?.time, a?.hour, c.dir ?? 'in', c.status ?? 'ended', c.sec, c.source, c.booked, c.lead ? code('L', c.lead) : null]; })) });
  }

  // Yozishma: mijoz bo'yicha har kun — nechta xabar, birinchi javobgacha necha daqiqa, kim javob berdi
  const msgs = sql.many('SELECT lead_id, channel, direction, author, created_at FROM inbox WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, rowid',
    r => ({ lead: String(r.lead_id), channel: String(r.channel), dir: String(r.direction), by: String(r.author), at: String(r.created_at) }), biz.id, fromIso, toIso);
  const convs = new Map<string, { lead: string; channel: string; first: string; inn: number; out: number; reply: string | null; by: string | null }>();
  for (const m of msgs) {
    const key = `${m.lead}|${local(m.at)?.date}`;
    const c = convs.get(key);
    if (m.dir === 'in') { if (c) c.inn++; else convs.set(key, { lead: m.lead, channel: m.channel, first: m.at, inn: 1, out: 0, reply: null, by: null }); }
    else if (c) { c.out++; if (!c.reply) { c.reply = m.at; c.by = m.by; } }
  }
  if (convs.size) {
    files.push({ name: 'conversations.csv', rows: convs.size, about: 'Customer messages (Telegram, Instagram…) grouped per customer per day: first message time, messages in/out, minutes to the first reply, who replied (cerebro = AI, owner, staff) — no message text.',
      csv: toCsv(['lead', 'channel', 'date', 'weekday', 'time', 'hour', 'messages_in', 'messages_out', 'first_reply_min', 'replied_by'], [...convs.values()].map(c => { const a = local(c.first); return [code('L', c.lead), c.channel, a?.date, a?.weekday, a?.time, a?.hour, c.inn, c.out, minutes(c.first, c.reply), c.by]; })) });
  }

  const leads = sql.many('SELECT id, channel, stage, source, created_at, patient_id FROM leads WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    r => ({ id: String(r.id), channel: sql.str(r.channel), stage: String(r.stage), source: sql.str(r.source), at: String(r.created_at), patient: sql.str(r.patient_id) }), biz.id, fromIso, toIso);
  if (leads.length) {
    files.push({ name: 'leads.csv', rows: leads.length, about: 'Customers (inquiries): channel, stage, source, when they first appeared, and the DentaCRM patient code if linked — join with visits.csv/payments.csv on patient to follow inquiry → visit → payment.',
      csv: toCsv(['lead', 'channel', 'stage', 'source', 'date', 'weekday', 'hour', 'patient'], leads.map(l => { const a = local(l.at); return [code('L', l.id), l.channel, l.stage, l.source, a?.date, a?.weekday, a?.hour, l.patient ? patientCode(l.patient) : null]; })) });
  }

  const reqs = sql.many('SELECT kind, source, status, created_at, closed_at FROM requests WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    r => ({ kind: String(r.kind), source: String(r.source), status: String(r.status), at: String(r.created_at), closed: sql.str(r.closed_at) }), biz.id, fromIso, toIso);
  if (reqs.length) {
    files.push({ name: 'requests.csv', rows: reqs.length, about: 'Requests left for the administrator (callback, booking, change, complaint…): source, status, when created and minutes until closed.',
      csv: toCsv(['kind', 'source', 'status', 'date', 'weekday', 'hour', 'minutes_to_close'], reqs.map(r => { const a = local(r.at); return [r.kind, r.source, r.status, a?.date, a?.weekday, a?.hour, minutes(r.at, r.closed)]; })) });
  }
  return { files, from, to, notes };
}
