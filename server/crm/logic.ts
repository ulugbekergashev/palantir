/**
 * DentaCRM ma'lumoti ustidagi sof qoidalar (tarmoq ham, baza ham yo'q — to'g'ridan-to'g'ri sinaladi):
 * bo'sh vaqtlar, yozishdan oldingi tekshiruv, kun hisoboti, bemor qidirish, manzilni tekshirish.
 *
 * Sana va vaqt — CRM'dagi kabi satr: "YYYY-MM-DD" va "HH:MM" (Toshkent vaqti). Hisob daqiqalarda yuradi,
 * `new Date(sana)` ishlatilmaydi — soat mintaqasi kunni surib yubormasin.
 */
import { BlockList, isIP } from 'node:net';

export interface TimeOff { dateFrom: string; dateTo: string; timeFrom?: string; timeTo?: string; note?: string }
/** Shifokor ishlamaydigan vaqtlar: haftalik kunlar, aniq muddatlar, hafta kuni bo'yicha o'z ish soatlari */
export interface DoctorOff { weekdays: number[]; blocks: TimeOff[]; workHours: Record<string, { from: string; to: string }> }
export interface DaysOff { weekdays: number[]; dates: string[] }
export interface Clinic { id: string; name: string; startHour: number; endHour: number; daysOff?: DaysOff }
export interface Doctor { id: string; firstName: string; lastName: string; specialty: string | null; status: string | null; startHour: number | null; endHour: number | null; off?: DoctorOff | null; /** Bulut nashri: 'none' | 'fixed' | 'fixed_kpi' | 'kpi'; lokal nashrda yo'q */ salaryType?: string | null }
export interface Appointment { id: string; patientId: string; patientName: string; doctorId: string; doctorName: string; type: string; date: string; time: string; duration: number; status: string; notes: string | null }
export interface Patient { id: string; firstName: string; lastName: string; phone: string | null; secondaryPhone: string | null; lastVisit: string | null; balance: number }
/** patientId — CRM'da bemorga bog'langan to'lov (eski yozuvlarda bo'lmasligi mumkin) */
export interface Transaction { id: string; patientName: string; patientId?: string | null; amount: number; type: string; service: string | null; status: string; doctorId: string | null; doctorName: string | null }

export const SLOT_STEP_MIN = 30;
export const DEFAULT_DURATION_MIN = 30;
const MAX_PER_DOCTOR = 40;
/** Bundan uzoq sanaga yozilmaydi (yil adashib aytilgan bo'lsa ushlab qolinadi) */
const MAX_YEARS_AHEAD = 2;

const CAME = new Set(['Completed', 'Checked-In']);
/** Kreslo band emas: bekor qilingan yoki kelmagan */
const FREES_SLOT = new Set(['Cancelled', 'No-Show']);

/** Taqvimda bor sana: "2026-02-31" ham, "2026-13-01" ham — yo'q */
export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

const toMin = (time: string): number => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
const toTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const doctorName = (d: Pick<Doctor, 'firstName' | 'lastName'>): string => `${d.firstName} ${d.lastName}`.trim();
export const patientName = (p: Pick<Patient, 'firstName' | 'lastName'>): string => `${p.firstName} ${p.lastName}`.trim();

/** Shifokorning shu kundagi ish oralig'i (daqiqada): kunning o'z soatlari → shifokorniki → klinikaniki */
const hours = (doctor: Doctor, clinic: Clinic, date: string): [start: number, end: number] => {
  const own = doctor.off?.workHours[String(weekdayOf(date))];
  return own ? [toMin(own.from), toMin(own.to)] : [(doctor.startHour ?? clinic.startHour) * 60, (doctor.endHour ?? clinic.endHour) * 60];
};
const busyOf = (appointments: Appointment[], doctorId: string, date: string) =>
  appointments.filter(a => a.doctorId === doctorId && a.date === date && !FREES_SLOT.has(a.status))
    .map(a => ({ from: toMin(a.time), to: toMin(a.time) + (a.duration || DEFAULT_DURATION_MIN), appt: a }));

interface SlotQuery { appointments: Appointment[]; doctor: Doctor; clinic: Clinic; date: string; duration: number; /** "YYYY-MM-DDTHH:MM" */ now: string }

/** Shifokorning shu kundagi bo'sh boshlanish vaqtlari */
export function freeSlots(q: SlotQuery): string[] {
  const [today, clock] = q.now.split('T');
  if (q.date < today) return [];
  const [start, end] = hours(q.doctor, q.clinic, q.date);
  const busy = [...busyOf(q.appointments, q.doctor.id, q.date), ...offIntervals(q.doctor, q.clinic, q.date)];
  const earliest = q.date === today ? toMin(clock) : -1;
  const out: string[] = [];
  for (let t = start; t + q.duration <= end; t += SLOT_STEP_MIN) {
    if (t > earliest && !busy.some(b => t < b.to && t + q.duration > b.from)) out.push(toTime(t));
  }
  return out;
}

/** ["09:00","09:30","11:00"] → "09:00–09:30, 11:00": ketma-ket vaqtlar bitta oraliq (modelga qisqa matn) */
export function slotRanges(slots: string[], step = SLOT_STEP_MIN): string {
  const runs: [string, string][] = [];
  for (const s of slots) {
    const last = runs.at(-1);
    if (last && toMin(s) - toMin(last[1]) === step) runs[runs.length - 1] = [last[0], s];
    else runs.push([s, s]);
  }
  return runs.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ');
}

/** Yozib bo'lmasa — sababi (egasiga aytiladigan matn); bo'lsa — null */
export function bookingProblem(q: SlotQuery & { patientId: string | null; time: string; /** Hozirdan kamida shuncha daqiqa keyin (bemor o'zi yozilganda) */ minLeadMin?: number }): string | null {
  const [today, clock] = q.now.split('T');
  if (!isRealDate(q.date)) return "Bunday sana yo'q";
  if (q.date < today || (q.date === today && q.time <= clock)) return "Bu vaqt o'tib ketgan";
  if (q.date > `${Number(today.slice(0, 4)) + MAX_YEARS_AHEAD}${today.slice(4)}`) return 'Sana juda uzoq — yilni tekshiring';
  if (q.minLeadMin && q.date === today && toMin(q.time) - toMin(clock) < q.minLeadMin) return `Juda yaqin vaqt — kamida ${q.minLeadMin} daqiqa oldin yozilishi kerak`;
  const from = toMin(q.time);
  const to = from + q.duration;
  const off = offIntervals(q.doctor, q.clinic, q.date).find(o => from < o.to && to > o.from);
  if (off) return `${doctorName(q.doctor)} bu vaqtda qabul qilmaydi (${off.why})`;
  const [start, end] = hours(q.doctor, q.clinic, q.date);
  if (from < start || to > end) return `${doctorName(q.doctor)} ${toTime(start)}–${toTime(end)} oralig'ida ishlaydi`;
  const own = q.patientId ? q.appointments.find(a => a.patientId === q.patientId && a.date === q.date && a.status !== 'Cancelled') : undefined;
  if (own) return `Bu bemor shu kuni allaqachon yozilgan: ${own.time}, ${own.doctorName}`;
  const clash = busyOf(q.appointments, q.doctor.id, q.date).find(b => from < b.to && to > b.from);
  return clash ? `Bu vaqt band: ${toTime(clash.from)}–${toTime(clash.to)} (${clash.appt.patientName})` : null;
}

export interface DaySummary {
  total: number;
  by_status: Record<string, number>;
  came: number;
  no_show: number;
  cancelled: number;
  /** Hali kelishi kutilayotganlar (yozilgan, tasdiqlangan) */
  expected: number;
  doctors: { doctor_id: string; doctor: string; count: number; appointments: { time: string; patient: string; type: string; status: string; duration: number }[]; more?: number }[];
  /** Yangi kelgan pul; balansdan to'lov bunga kirmaydi (u avval avans bo'lib kirgan) */
  revenue: { total: number; by_method: Record<string, number>; advance: number; from_balance: number };
  unpaid: { total: number; count: number };
}

export function daySummary(appointments: Appointment[], transactions: Transaction[]): DaySummary {
  const by_status: Record<string, number> = {};
  const doctors = new Map<string, DaySummary['doctors'][number]>();
  for (const a of [...appointments].sort((x, y) => x.time.localeCompare(y.time))) {
    by_status[a.status] = (by_status[a.status] ?? 0) + 1;
    const d = doctors.get(a.doctorId) ?? { doctor_id: a.doctorId, doctor: a.doctorName, count: 0, appointments: [] };
    const row = { time: a.time, patient: a.patientName, type: a.type, status: a.status, duration: a.duration };
    doctors.set(a.doctorId, { ...d, count: d.count + 1, appointments: d.appointments.length < MAX_PER_DOCTOR ? [...d.appointments, row] : d.appointments });
  }
  const paid = transactions.filter(t => t.status === 'Paid');
  const income = paid.filter(t => t.type !== 'Balance');
  const unpaid = transactions.filter(t => t.status === 'Pending' || t.status === 'Overdue');
  const sum = (list: Transaction[]) => list.reduce((n, t) => n + t.amount, 0);
  const by_method: Record<string, number> = {};
  for (const t of income) by_method[t.type] = (by_method[t.type] ?? 0) + t.amount;
  const count = (set: Set<string>) => appointments.filter(a => set.has(a.status)).length;
  const came = count(CAME);
  const no_show = by_status['No-Show'] ?? 0;
  const cancelled = by_status.Cancelled ?? 0;
  return {
    total: appointments.length, by_status, came, no_show, cancelled, expected: appointments.length - came - no_show - cancelled,
    doctors: [...doctors.values()].map(d => (d.count > d.appointments.length ? { ...d, more: d.count - d.appointments.length } : d)),
    revenue: { total: sum(income), by_method, advance: sum(income.filter(t => t.service === 'Avans')), from_balance: sum(paid.filter(t => t.type === 'Balance')) },
    unpaid: { total: sum(unpaid), count: unpaid.length },
  };
}

// ─── Jadval: shifokor ishlamaydigan vaqtlar va klinikaning dam olish kunlari ──
// Lokal DentaCRM qoidasi (dentalocal: utils/doctorSchedule.ts, utils/daysOff.ts): server shu vaqtlarga yozishni rad etadi,
// shuning uchun bu yerda ham bo'sh vaqt sifatida taklif qilinmaydi. Hafta kuni — getDay: 0 yakshanba … 6 shanba.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const DAY_MIN = 24 * 60;
const MAX_BLOCKS = 200;

const asObject = (raw: unknown): Record<string, unknown> | null => {
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return null; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
};
const weekdaysOf = (raw: unknown): number[] =>
  (Array.isArray(raw) ? [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : []);
const hhmm = (raw: unknown): string | null => (typeof raw === 'string' && TIME_RE.test(raw) ? toTime(toMin(raw)) : null);

/** Doctor.schedule (JSON matn yoki obyekt) → toza jadval; buzuq yozuvlar tashlab ketiladi. Jadval yo'q — null */
export function parseDoctorOff(raw: unknown): DoctorOff | null {
  const value = asObject(raw);
  if (!value) return null;
  const blocks: TimeOff[] = [];
  for (const b of Array.isArray(value.blocks) ? value.blocks.slice(0, MAX_BLOCKS) : []) {
    const row = asObject(b);
    const dateFrom = String(row?.dateFrom ?? '');
    if (!row || !DATE_RE.test(dateFrom)) continue;
    const rawTo = String(row.dateTo ?? '');
    const dateTo = DATE_RE.test(rawTo) && rawTo >= dateFrom ? rawTo : dateFrom;
    const [timeFrom, timeTo] = [hhmm(row.timeFrom), hhmm(row.timeTo)];
    const note = typeof row.note === 'string' ? row.note.replace(/[\u0000-\u001f<>`]/g, ' ').trim().slice(0, 80) : '';
    // Soat oralig'i faqat to'g'ri bo'lsa olinadi, aks holda — kun bo'yi
    blocks.push({ dateFrom, dateTo, ...(timeFrom && timeTo && timeFrom < timeTo ? { timeFrom, timeTo } : {}), ...(note ? { note } : {}) });
  }
  const workHours: DoctorOff['workHours'] = {};
  const hoursRaw = asObject(value.workHours) ?? {};
  for (let day = 0; day <= 6; day++) {
    const h = asObject(hoursRaw[String(day)]);
    const [from, to] = [hhmm(h?.from), hhmm(h?.to)];
    if (from && to && from < to) workHours[String(day)] = { from, to };
  }
  return { weekdays: weekdaysOf(value.weekdays), blocks, workHours };
}

/** Clinic.features (JSON matn yoki obyekt) ichidagi daysOff; yo'q — undefined */
export function parseDaysOff(features: unknown): DaysOff | undefined {
  const raw = asObject(asObject(features)?.daysOff);
  if (!raw) return undefined;
  const dates = Array.isArray(raw.dates) ? [...new Set(raw.dates.map(String).filter(d => DATE_RE.test(d)))].sort() : [];
  return { weekdays: weekdaysOf(raw.weekdays), dates };
}

const weekdayOf = (date: string): number => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

/** Klinika shu kuni ishlamaydi (haftalik dam olish kuni yoki belgilangan sana) */
export const clinicClosed = (clinic: Clinic, date: string): boolean =>
  !!clinic.daysOff && (clinic.daysOff.dates.includes(date) || clinic.daysOff.weekdays.includes(weekdayOf(date)));

interface OffInterval { from: number; to: number; why: string }
/** Shu kuni qabul qilinmaydigan oraliqlar (daqiqada) va sababi */
function offIntervals(doctor: Doctor, clinic: Clinic, date: string): OffInterval[] {
  const day = weekdayOf(date);
  const out: OffInterval[] = [];
  if (clinicClosed(clinic, date)) out.push({ from: 0, to: DAY_MIN, why: 'klinika dam olish kuni' });
  const off = doctor.off;
  if (!off) return out;
  if (off.weekdays.includes(day)) out.push({ from: 0, to: DAY_MIN, why: 'shifokorning dam olish kuni' });
  for (const b of off.blocks) {
    if (date < b.dateFrom || date > b.dateTo) continue;
    const hours = b.timeFrom && b.timeTo ? `${b.timeFrom}–${b.timeTo}` : "kun bo'yi";
    out.push({ from: b.timeFrom && b.timeTo ? toMin(b.timeFrom) : 0, to: b.timeFrom && b.timeTo ? toMin(b.timeTo) : DAY_MIN, why: b.note ? `${hours} — ${b.note}` : hours });
  }
  return out;
}

/** Shu kuni umuman qabul yo'q bo'lsa — sababi; aks holda null */
export function dayOff(doctor: Doctor, clinic: Clinic, date: string): string | null {
  return offIntervals(doctor, clinic, date).find(o => o.from === 0 && o.to === DAY_MIN)?.why ?? null;
}

/** o', g' har xil apostrof bilan yoziladi (ʻ ʼ ’ ‘ `) — bittasiga keltiriladi */
const fold = (s: string) => s.toLowerCase().replace(/[ʻʼ’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');

/** Ism-familiya (so'zlar istalgan tartibda) yoki telefonning oxirgi raqamlari bo'yicha */
export function searchPatients(list: Patient[], query: string, limit = 10): { total: number; matches: Patient[] } {
  const num = digits(query);
  const byPhone = num.length >= 5 && !/[a-zа-яё]/i.test(query);
  const tail = num.slice(-9);
  const words = fold(query).split(' ').filter(Boolean);
  const hit = (p: Patient) => (byPhone
    ? digits(p.phone).endsWith(tail) || digits(p.secondaryPhone).endsWith(tail)
    : words.length > 0 && words.every(w => fold(patientName(p)).includes(w)));
  const all = list.filter(hit);
  return { total: all.length, matches: all.slice(0, limit) };
}

/** Telefon → "+998901234567": 9 xonali mahalliy raqamga +998 qo'shiladi; chala yoki raqamsiz — '' */
export function normPhone(raw: string): string {
  const d = digits(raw);
  if (d.length === 9) return `+998${d}`;
  // "8 90 123 45 67", "0901234567" — mahalliy yozuv: boshidagi 8 yoki 0 mamlakat kodi emas
  if (d.length === 10 && /^[08]/.test(d)) return `+998${d.slice(1)}`;
  return d.length >= 10 && d.length <= 15 ? `+${d}` : '';
}

/** Ism-familiya: faqat harflar, apostrof bitta ko'rinishda (O‘ktam, Oʻktam, O`ktam → O'ktam). Bazaga ham, solishtirishga ham shu boradi */
export const cleanName = (s: string): string => s.replace(/[ʻʼ’‘`´ʹ′]/g, "'").replace(/[^\p{L}\p{M}' -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
/** Ism ham, familiya ham bormi: kamida ikki so'z, har birida kamida ikki harf */
export const hasFullName = (s: string): boolean => cleanName(s).split(' ').filter(w => (w.match(/\p{L}/gu) ?? []).length >= 2).length >= 2;

const nameWords = (name: string) => new Set(fold(cleanName(name)).split(' ').filter(w => w.length > 1));
/** Bir odammi: so'zlar tartibi ahamiyatsiz, lekin kamida ikki so'z (ism va familiya) mos kelishi shart — bitta umumiy familiya yetmaydi */
function sameFullName(a: string, b: string): boolean {
  const [x, y] = [nameWords(a), nameWords(b)];
  const [few, more] = x.size <= y.size ? [x, y] : [y, x];
  return few.size >= 2 && [...few].every(w => more.has(w));
}

const MAX_OTHERS = 5;

/**
 * Yozishmada aytilgan ism va telefon bazadagi kimga to'g'ri keladi. Bir telefonda oila a'zolari bo'ladi, shuning uchun
 * telefonning o'zi yetmaydi: ism-familiya ham mos kelsa — o'sha bemor; aks holda patient null va shu telefondagi
 * boshqa ismlar qaytadi (qarorni egasi qiladi).
 */
export function resolvePatient(list: Patient[], name: string, phone: string): { patient: Patient | null; others: string[] } {
  const tail = digits(normPhone(phone)).slice(-9);
  if (!tail) return { patient: null, others: [] };
  const sharing = list.filter(p => digits(p.phone).endsWith(tail) || digits(p.secondaryPhone).endsWith(tail));
  const patient = sharing.find(p => sameFullName(patientName(p), name)) ?? null;
  return { patient, others: patient ? [] : sharing.slice(0, MAX_OTHERS).map(p => patientName(p) || 'ismsiz bemor') };
}

/** Ertalabki xulosaga bitta qator; qabul bo'lmasa — null */
export function briefLine(appointments: Appointment[]): string | null {
  const live = appointments.filter(a => a.status !== 'Cancelled');
  if (!live.length) return null;
  const first = live.map(a => a.time).sort()[0];
  return `🦷 <b>Qabullar:</b> bugun ${live.length} ta qabul, birinchisi ${first}`;
}

// ─── Manzil ───────────────────────────────────────────────────────────────────

/** Hech qachon: aniqlanmagan manzil, bulut xizmatlarining ichki (metadata) manzillari, link-local */
const DENY = new BlockList();
DENY.addSubnet('0.0.0.0', 8, 'ipv4');
DENY.addSubnet('169.254.0.0', 16, 'ipv4');
DENY.addAddress('::', 'ipv6');
DENY.addSubnet('fe80::', 10, 'ipv6');
DENY.addSubnet('fd00:ec2::', 32, 'ipv6');
/** Shu kompyuter yoki klinikaning ichki tarmog'i — shifrsiz (http) ham mumkin */
const LAN = new BlockList();
LAN.addSubnet('127.0.0.0', 8, 'ipv4');
LAN.addSubnet('10.0.0.0', 8, 'ipv4');
LAN.addSubnet('172.16.0.0', 12, 'ipv4');
LAN.addSubnet('192.168.0.0', 16, 'ipv4');
LAN.addAddress('::1', 'ipv6');
LAN.addSubnet('fc00::', 7, 'ipv6');
const BLOCKED_NAMES = new Set(['metadata', 'metadata.google.internal']);

/** "::ffff:a9fe:a9fe" (IPv4 ning IPv6 ko'rinishi) → "169.254.169.254": tekshiruv haqiqiy manzil bo'yicha yursin */
function unmapped(host: string): string {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!m) return host;
  const [a, b] = [parseInt(m[1], 16), parseInt(m[2], 16)];
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

/**
 * Egasi kiritgan manzil → "http(s)://host[:port]". Yo'l tashlab yuboriladi (so'rov yo'llari kodda qotirilgan).
 * Ichki tarmoq faqat haqiqiy IP bo'yicha aniqlanadi ("10.evil.com" — ichki emas); internetdagi manzil faqat https.
 * allowPrivate=false (umumiy server): ichki tarmoq va lokal nomlar umuman yopiq.
 */
export function normalizeBaseUrl(input: string, allowPrivate = true): string {
  const raw = input.trim();
  if (!raw) throw new Error('DentaCRM manzilini kiriting');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const parse = (text: string): URL => {
    try { return new URL(text); } catch { throw new Error("DentaCRM manzili noto'g'ri — masalan: http://192.168.1.20:3001"); }
  };
  const u = parse(hasScheme ? raw : `http://${raw}`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Manzil http:// yoki https:// bilan boshlansin');
  if (u.username || u.password) throw new Error("Manzilda login va parol bo'lmasin — ularni pastdagi maydonlarga yozing");
  const blocked = new Error("Bu manzilga ulanib bo'lmaydi");
  const host = unmapped(u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''));
  const family = isIP(host);
  let local: boolean;
  if (family) {
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (DENY.check(host, type)) throw blocked;
    local = LAN.check(host, type);
  } else {
    if (BLOCKED_NAMES.has(host)) throw blocked;
    local = host === 'localhost' || !host.includes('.') || host.endsWith('.local');
  }
  if (local) {
    if (!allowPrivate) throw new Error("Bu serverda ichki tarmoq manzillariga ulanish o'chirilgan");
    return `${u.protocol}//${u.host}`;
  }
  // Sxemasiz yozilgan internet manzili — https deb olinadi; ochiq http rad etiladi (parol ochiq ketmasin)
  if (!hasScheme) return `https://${parse(`https://${raw}`).host}`;
  if (u.protocol !== 'https:') throw new Error('Internetdagi manzil https:// bilan boshlanishi kerak');
  return `https://${u.host}`;
}
