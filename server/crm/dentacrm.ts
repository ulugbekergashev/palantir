/**
 * DentaCRM mijozi (bulut va lokal nashr — API bir xil): xodim logini bilan kiradi, JWT faqat xotirada turadi.
 *
 *   - token eskirsa (bulut 401, lokal 403) — bir marta qayta kiradi; parallel so'rovlar bitta kirishni kutadi;
 *   - parol rad etilsa — boshqa urinmaydi (CRM akkauntni bloklab qo'ymasin), egasi qayta ulaguncha;
 *   - har bir javob sxemadan o'tadi: keraksiz maydonlar (parol xeshi, bot tokeni…) tashlanadi, matnlar tozalanadi
 *     va qisqartiriladi (CRM'dagi ism yordamchiga ko'rsatma bo'lib o'tmasin);
 *   - pul va qabul qatorlari qat'iy: bittasi o'qilmasa — xato (noto'g'ri tushumni haqiqat deb aytgandan ko'ra);
 *   - javob hajmi sanab o'qiladi; xato matnlari qotirilgan (CRM javobi egasiga ham, logga ham ko'chirilmaydi);
 *   - CRM qabul vaqtini o'zi tekshirmaydi — yozishdan oldin bu yerda tekshiriladi.
 */
import { z } from 'zod';
import { addDays } from '../../src/lib/week';
import type { Expense, NewExpense, NewTransaction } from './money';
import type { DayData } from './report';
import { iso } from '../../src/lib/week';
import { bookingProblem, doctorName, parseDaysOff, parseDoctorOff, patientName, type Appointment, type Clinic, type Doctor, type Patient, type Transaction } from './logic';

export type CrmErrorKind = 'credentials' | 'auth' | 'license' | 'unreachable' | 'protocol' | 'conflict' | 'invalid';
export class CrmError extends Error {
  constructor(readonly kind: CrmErrorKind, message: string) { super(message); }
}

const MESSAGES = {
  credentials: "DentaCRM: login yoki parol noto'g'ri",
  auth: "DentaCRM kirishni rad etdi — parol o'zgargan bo'lishi mumkin. Panel → Ulanishlar'da qayta ulang",
  license: 'DentaCRM litsenziyasi faollashtirilmagan',
  unreachable: "DentaCRM'ga ulanib bo'lmadi — manzilni va dastur ishlab turganini tekshiring",
  protocol: 'Bu manzilda DentaCRM topilmadi yoki javobi tushunarsiz',
  invalid: "DentaCRM so'rovni qabul qilmadi",
} as const;
const fail = (kind: keyof typeof MESSAGES) => new CrmError(kind, MESSAGES[kind]);
/** Yozuv so'rovi ketdi, javob kelmadi: qayta urinish ikkinchi yozuvni yaratishi mumkin */
export const isUnknownOutcome = (e: unknown): boolean => e instanceof CrmError && e.message === UNKNOWN_OUTCOME;
const UNKNOWN_OUTCOME = "DentaCRM javob bermadi — yozildimi yoki yo'qmi, noma'lum. Qayta yozishdan oldin CRM'da tekshiring";
/** Bu nashrda yozish yo'li yo'q (404) — eski nashr bo'lsa boshqa yo'l bilan uriniladi */
const MISSING_ROUTE = 'DentaCRM bu amalni qo\'llamaydi (eski nashr)';
/** CRM 409 javobidagi sabab: ma'lum kodlar — o'zbekcha; boshqa matn — tozalanib, qisqartirilib */
function conflictText(raw: string): string {
  let error = '';
  try { error = String((JSON.parse(raw) as { error?: unknown }).error ?? ''); } catch { /* matn emas */ }
  if (error === 'CALL_DATE_TAKEN') return 'Bemor shu kuni boshqa qabulga yozilgan';
  if (!error || /^[A-Z_]+$/.test(error)) return "DentaCRM bu vaqtni qabul qilmadi (band yoki shifokor ishlamaydi)";
  return error.replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const TIMEOUT_MS = 10_000;
const PATIENTS_TIMEOUT_MS = 20_000;
const CACHE_MS = 10 * 60_000;
/** Xotiradagi yozuvlar shundan oshsa, eskirganlari tozalanadi (kunlar soni cheksiz o'smasin) */
const CACHE_SWEEP_AT = 64;
/** Ulanib bo'lmagach shuncha vaqt qayta urinmaydi — yordamchi navbati osilib qolmasin */
const DOWN_COOLDOWN_MS = 20_000;
const BODY_LIMIT = 1024 * 1024;
const PATIENTS_BODY_LIMIT = 20 * 1024 * 1024;
/** Xarajatlar ro'yxati sana bo'yicha so'ralmaydi (CRM hammasini qaytaradi) */
const EXPENSES_BODY_LIMIT = 10 * 1024 * 1024;
const ERROR_BODY_LIMIT = 4096;

// ─── Sxemalar ─────────────────────────────────────────────────────────────────

/** Boshqaruv belgilari va teg belgilarisiz, bir qatorda, cheklangan uzunlikda */
const tidy = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const label = (max: number) => z.string().transform(s => tidy(s, max));
const id = z.union([z.string().min(1).max(100), z.number()]).transform(String);
const text = (max = 120) => z.union([z.string(), z.number()]).nullish().transform(v => (v == null ? null : tidy(String(v), max) || null)).catch(null);
/** Summa: son yoki sof raqamli satr. Boshqasi — xato (0 deb olinmaydi) */
const money = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).refine(Number.isFinite);
const hour = z.union([z.number(), z.string().regex(/^\d{1,2}$/).transform(Number)]).nullish()
  .transform(v => (v == null || !Number.isInteger(v) || v < 0 || v > 24 ? null : v)).catch(null);
/** CRM sanani oddiy satrda saqlaydi; vaqt belgisi bilan kelsa — Toshkent kuni olinadi (server shu mintaqada ishlaydi) */
const day = z.string().transform((v, ctx) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: 'custom', message: 'sana' }); return z.NEVER; }
  return iso(d);
});
const clock = z.string().regex(/^\d{1,2}:\d{2}/).transform(t => { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${m.slice(0, 2)}`; });

const LoginSchema = z.object({ token: z.string().min(1).max(4096), clinicId: id, name: label(80).catch(''), role: label(40).catch('') });
// features (lokal nashr) ichidan faqat dam olish kunlari olinadi
const ClinicSchema = z.object({ id, name: label(80).catch('Klinika'), startHour: hour, endHour: hour, features: z.unknown().optional().transform(parseDaysOff) });
const DoctorSchema = z.object({ id, firstName: label(60).catch(''), lastName: label(60).catch(''), specialty: text(60), status: text(40), startHour: hour, endHour: hour, salaryType: text(20), schedule: z.unknown().optional().transform(parseDoctorOff) })
  .transform(({ schedule, ...d }) => ({ ...d, off: schedule }));
const AppointmentSchema = z.object({
  // Bemorsiz yozuv (band qilingan vaqt) ham kresloni band qiladi
  id, patientId: id.nullish().transform(v => v ?? ''), patientName: label(80).catch(''), doctorId: id, doctorName: label(80).catch(''), type: label(60).catch(''),
  date: day, time: clock, duration: z.coerce.number().int().positive().max(24 * 60).catch(30), status: label(40).catch('Pending'), notes: text(500),
});
const PatientSchema = z.object({ id, firstName: label(80).catch(''), lastName: label(80).catch(''), phone: text(40), secondaryPhone: text(40), lastVisit: text(40), balance: money.catch(0) });
const TransactionSchema = z.object({ id, patientName: label(80).catch(''), patientId: id.nullish().transform(v => v ?? null).catch(null), amount: money, type: label(40), service: text(80), status: label(40).pipe(z.string().min(1)), doctorId: id.nullish().transform(v => v ?? null).catch(null), doctorName: text(80), date: text(40) });

const ExpenseSchema = z.object({ id, date: text(40), amount: money, category: label(40), title: text(120), doctorId: id.nullish().transform(v => v ?? null).catch(null) });

// Tahlil uchun (insights/dataset.ts): statistik maydonlar — ism, telefon, izoh va tibbiy yozuv olinmaydi
const when = z.union([z.string(), z.number()]).nullish().transform(v => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }).catch(null);
const optId = id.nullish().transform(v => v ?? null).catch(null);
const VisitStatSchema = z.object({
  id, patientId: optId, doctorId: optId, doctorName: text(80), type: text(60), date: day, time: clock.nullish().transform(v => v ?? null).catch(null),
  duration: z.coerce.number().int().nonnegative().max(24 * 60).catch(30), status: label(40).catch(''), callStatus: text(30),
  enteredAt: when, finishedAt: when, review: z.object({ rating: z.coerce.number().int().min(1).max(5) }).nullish().catch(null),
}).transform(({ review, ...v }) => ({ ...v, rating: review?.rating ?? null }));
const PaymentStatSchema = z.object({
  id, patientId: optId, appointmentId: optId, amount: money, discountAmount: money.nullish().transform(v => v ?? 0).catch(0), type: text(40), service: text(80),
  category: text(40), status: text(40), doctorId: optId, doctorName: text(80), date: text(40), createdAt: when,
});
const PatientStatSchema = z.object({ id, gender: text(12), dob: text(20), createdAt: when, label: text(20), status: text(30) });
export type VisitStat = z.infer<typeof VisitStatSchema>;
export type PaymentStat = z.infer<typeof PaymentStatSchema>;
export type PatientStat = z.infer<typeof PatientStatSchema>;
const CreatedSchema = z.object({ id });

export interface CrmConfig { baseUrl: string; username: string; password: string }
export interface Booking { patient: Patient; doctorId: string; date: string; time: string; duration: number; type: string; notes?: string; /** "YYYY-MM-DDTHH:MM" */ now: string }
export interface DentaCrm {
  login(): Promise<{ clinicId: string; name: string; role: string }>;
  clinic(): Promise<Clinic>;
  doctors(): Promise<Doctor[]>;
  appointments(date: string): Promise<Appointment[]>;
  transactions(date: string): Promise<Transaction[]>;
  /** Bir kunning qabullari va to'lovlari. O'tgan kun bir muddat xotirada turadi (davr hisoboti kunma-kun yig'iladi) */
  day(date: string): Promise<DayData>;
  patients(): Promise<Patient[]>;
  createPatient(p: { firstName: string; lastName: string; phone: string }): Promise<Patient>;
  bookAppointment(b: Booking): Promise<Appointment>;
  /**
   * Qabulxona natijasi: ko'chirildi (yangi kun va vaqt, shifokor o'sha), bekor qildi, tasdiqladi. CRM shifokor ishlamaydigan vaqtni
   * o'zi ham tekshiradi va kim, qachon qo'ng'iroq qilgani izini saqlaydi. Eski nashrda bu yo'l bo'lmasa — oddiy tahrir (PUT)
   */
  visitResult(id: string, r: { result: 'rescheduled' | 'cancelled' | 'confirmed'; date?: string; time?: string; note?: string }): Promise<Appointment>;
  /** Klinikaning hamma xarajatlari (CRM sana bo'yicha saralamaydi) */
  expenses(): Promise<Expense[]>;
  /** To'langan to'lov yozuvi; qaytaradi — id. Takrordan himoya yo'q: chaqiruvchi oldindan tekshiradi (money.ts) */
  createTransaction(t: NewTransaction): Promise<string>;
  createExpense(e: NewExpense): Promise<string>;
  removeTransaction(id: string): Promise<void>;
  removeExpense(id: string): Promise<void>;
  /** Tahlil uchun hamma qabul, to'lov va bemorlarning statistik maydonlari (insights/dataset.ts); buzuq qator tashlanadi */
  statsExport(): Promise<{ visits: VisitStat[]; payments: PaymentStat[]; patients: PatientStat[] }>;
}

interface Cached<T> { at: number; value: Promise<T> }
type Session = z.infer<typeof LoginSchema>;
interface Call { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: (clinicId: string) => string; body?: (clinicId: string) => unknown; timeoutMs?: number; limit?: number }

/** Javobni sanab o'qiydi: hajmi aytilmagan yoki siqilgan katta javob xotirani to'ldirmasin */
async function readCapped(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel().catch(() => {}); throw fail('protocol'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createDentaCrm(cfg: CrmConfig): DentaCrm {
  // `as`: TS yopilma ichidagi o'zlashtirishni ko'rmaydi va turni null deb toraytirib yuboradi
  let session = null as Session | null;
  let loggingIn = null as Promise<Session> | null;
  /** CRM parolni rad etdi: egasi qayta ulaguncha (yangi mijoz) boshqa urinilmaydi */
  let locked = false;
  let downUntil = 0;
  const cache = new Map<string, Cached<unknown>>();
  /** Qabul yozish ketma-ket: tekshiruv va yozuv orasiga boshqa yozuv kirmasin */
  let booking: Promise<unknown> = Promise.resolve();

  /** Natija bir muddat xotirada; parallel chaqiruvlar bitta so'rovni kutadi; xato saqlanmaydi */
  const remember = <T,>(key: string, at: number, value: Promise<T>): Promise<T> => {
    if (cache.size >= CACHE_SWEEP_AT) for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
    cache.set(key, { at, value });
    value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
    return value;
  };
  const cached = <T,>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key) as Cached<T> | undefined;
    return hit && Date.now() - hit.at < CACHE_MS ? hit.value : remember(key, Date.now(), load());
  };

  async function send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token: string | null, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<Response> {
    if (Date.now() < downUntil) throw fail('unreachable');
    try {
      const res = await fetch(`${cfg.baseUrl}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/json', 'accept-encoding': 'identity',
          ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      downUntil = 0;
      return res;
    } catch {
      downUntil = Date.now() + DOWN_COOLDOWN_MS;
      throw fail('unreachable');
    }
  }
  const drop = (res: Response) => { void res.body?.cancel().catch(() => {}); };
  /** Javob tanasi (o'qish paytidagi uzilish — "ulanib bo'lmadi") → JSON */
  async function jsonOf(res: Response, limit: number): Promise<unknown> {
    const raw = await readCapped(res, limit).catch(e => { throw e instanceof CrmError ? e : fail('unreachable'); });
    try { return JSON.parse(raw); } catch { throw fail('protocol'); }
  }
  const one = <S extends z.ZodType>(schema: S, data: unknown): z.infer<S> => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw fail('protocol');
    return parsed.data;
  };
  /** Ro'yxat. strict — bitta qator o'qilmasa ham xato; aks holda buzuq qatorlar tashlab ketiladi (soni logga) */
  const many = <S extends z.ZodType>(schema: S, data: unknown, what: string, strict: boolean): z.infer<S>[] => {
    if (!Array.isArray(data)) throw fail('protocol');
    const rows = data.map(row => schema.safeParse(row));
    const bad = rows.filter(r => !r.success).length;
    if (bad && strict) throw fail('protocol');
    if (bad) console.warn(`[dentacrm] ${what}: ${bad} ta qator o'qilmadi, tashlab ketildi`);
    return rows.flatMap(r => (r.success ? [r.data] : []));
  };

  function login(): Promise<Session> {
    if (locked) return Promise.reject(fail('auth'));
    loggingIn ??= (async () => {
      const res = await send('POST', '/api/auth/login', null, { username: cfg.username, password: cfg.password });
      if (res.status === 403 && (await readCapped(res, ERROR_BODY_LIMIT).catch(() => '')).includes('LICENSE_REQUIRED')) throw fail('license');
      if ([400, 401, 403].includes(res.status)) { drop(res); locked = true; throw fail('credentials'); }
      if (!res.ok) { drop(res); throw fail(res.status >= 500 ? 'unreachable' : 'protocol'); }
      const s = one(LoginSchema, await jsonOf(res, BODY_LIMIT));
      session = s;
      return s;
    })().finally(() => { loggingIn = null; });
    return loggingIn;
  }
  /** Ish paytidagi kirish: parol rad etilsa — "qayta ulang" (ulash paytidagi "parol noto'g'ri" emas) */
  const signIn = () => login().catch(e => { throw e instanceof CrmError && e.kind === 'credentials' ? fail('auth') : e; });

  /** Token bilan so'rov; rad etilsa — bir marta qayta kirib takrorlaydi. Qaytaradi — JSON */
  async function call(c: Call): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const s = session ?? await signIn();
      const res = await send(c.method, c.path(s.clinicId), s.token, c.body?.(s.clinicId), c.timeoutMs);
      if (res.status === 401 || res.status === 403) {
        if ((await readCapped(res, ERROR_BODY_LIMIT).catch(() => '')).includes('LICENSE_REQUIRED')) throw fail('license');
        if (attempt > 0) throw fail('auth');
        // Boshqa parallel so'rov allaqachon yangilagan bo'lsa — yangi token bilan takrorlanadi
        if (session?.token === s.token) { session = null; await signIn(); }
        continue;
      }
      // Band vaqt, shifokor ishlamaydi, bemor shu kuni yozilgan — CRM aytgan sabab (ma'lum kodlar tarjima qilinadi)
      if (res.status === 409) throw new CrmError('conflict', conflictText(await readCapped(res, ERROR_BODY_LIMIT).catch(() => '')));
      if (res.status === 404 && c.method !== 'GET') { drop(res); throw new CrmError('invalid', MISSING_ROUTE); }
      if (!res.ok) { drop(res); throw fail(res.status >= 500 ? 'unreachable' : 'invalid'); }
      const refreshed = res.headers.get('x-refreshed-token');
      if (refreshed && refreshed.length <= 4096 && session?.token === s.token) session = { ...session, token: refreshed };
      // O'chirishga javob bo'sh (204) bo'lishi mumkin; tushunarsiz javob esa (oraliq server sahifasi) — natija noma'lum
      if (c.method === 'DELETE') {
        const raw = await readCapped(res, ERROR_BODY_LIMIT).catch(e => { throw e instanceof CrmError ? e : fail('unreachable'); });
        if (!raw.trim()) return {};
        try { return JSON.parse(raw); } catch { throw fail('protocol'); }
      }
      return jsonOf(res, c.limit ?? BODY_LIMIT);
    }
  }
  /** Yozuv: javob kelmasa natija noma'lum — "yozilmadi" deyilmaydi, bemorlar ro'yxati qayta yuklanadi */
  async function write(path: string | ((clinicId: string) => string), body?: (clinicId: string) => unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<unknown> {
    try {
      return await call({ method, path: typeof path === 'string' ? () => path : path, body });
    } catch (e) {
      if (!(e instanceof CrmError) || (e.kind !== 'unreachable' && e.kind !== 'protocol')) throw e;
      cache.delete('patients');
      throw new CrmError('unreachable', UNKNOWN_OUTCOME);
    }
  }
  /** Yozuv yaratadi. CRM qabul qilib (2xx), javobida id bo'lmasa — yozilgan bo'lishi mumkin: natija noma'lum (qayta yozishga yo'l qo'yilmaydi) */
  async function create(path: string, body: (clinicId: string) => unknown): Promise<string> {
    const made = CreatedSchema.safeParse(await write(path, body));
    if (!made.success) throw new CrmError('unreachable', UNKNOWN_OUTCOME);
    return made.data.id;
  }
  async function remove(path: (clinicId: string) => string): Promise<void> {
    const reply = await write(path, undefined, 'DELETE');
    if (reply && typeof reply === 'object' && (reply as { success?: unknown }).success === false) throw new CrmError('conflict', "DentaCRM yozuvni o'chirmadi — CRM'da qo'lda tekshiring");
  }
  const q = (clinicId: string, extra: Record<string, string> = {}) => new URLSearchParams({ clinicId, ...extra }).toString();

  const api: DentaCrm = {
    async login() { const s = await login(); return { clinicId: s.clinicId, name: s.name, role: s.role }; },
    clinic: () => cached('clinic', async () => {
      const c = one(ClinicSchema, await call({ method: 'GET', path: cid => `/api/clinics/${encodeURIComponent(cid)}?${q(cid)}` }));
      return { id: c.id, name: c.name, startHour: c.startHour ?? 8, endHour: c.endHour ?? 20, daysOff: c.features ?? { weekdays: [], dates: [] } };
    }),
    doctors: () => cached('doctors', async () =>
      many(DoctorSchema, await call({ method: 'GET', path: cid => `/api/doctors?${q(cid)}` }), 'shifokorlar', false).filter(d => d.status !== 'Deleted')),
    // CRM "date" ni e'tiborsiz qoldirsa ham faqat so'ralgan kun qaytadi
    appointments: async date => many(AppointmentSchema, await call({ method: 'GET', path: cid => `/api/appointments?${q(cid, { date })}` }), 'qabullar', true).filter(a => a.date === date),
    // CRM "date" ni e'tiborsiz qoldirsa, hamma kunning to'lovi qaytardi va davr hisobotida tushum bir necha baravar ko'payardi
    transactions: async date => many(TransactionSchema, await call({ method: 'GET', path: cid => `/api/transactions?${q(cid, { date })}` }), "to'lovlar", true)
      .filter(t => !t.date || t.date.startsWith(date)).map(({ date: _date, ...t }) => t),
    day(date) {
      const load = async (): Promise<DayData> => {
        const [appointments, transactions] = await Promise.all([api.appointments(date), api.transactions(date)]);
        return { date, appointments, transactions };
      };
      // Kechagi kun ham xotiraga olinmaydi: kechikkan to'lov va holat tuzatishlari aynan unga tushadi
      return date < iso(addDays(new Date(), -1)) ? cached(`day:${date}`, load) : load();
    },
    patients: () => cached('patients', async () =>
      many(PatientSchema, await call({ method: 'GET', path: cid => `/api/patients?${q(cid)}`, timeoutMs: PATIENTS_TIMEOUT_MS, limit: PATIENTS_BODY_LIMIT }), 'bemorlar', false)),
    async createPatient(p) {
      const created = one(PatientSchema, await write('/api/patients', clinicId => ({ ...p, clinicId })));
      // Yangi bemor ro'yxatni qayta yuklamasdan topilsin; ro'yxat yuklanmagan yoki yuklanmay qolgan bo'lsa — keyingi safar yuklanadi
      const hit = cache.get('patients') as Cached<Patient[]> | undefined;
      const list = hit ? await hit.value.catch(() => null) : null;
      if (hit && list) remember('patients', hit.at, Promise.resolve([...list.filter(x => x.id !== created.id), created]));
      else cache.delete('patients');
      return created;
    },
    expenses: async () => many(ExpenseSchema, await call({ method: 'GET', path: cid => `/api/expenses?${q(cid)}`, timeoutMs: PATIENTS_TIMEOUT_MS, limit: EXPENSES_BODY_LIMIT }), 'xarajatlar', false),
    // Sanasiz so'rov — hamma yozuv (tahlil uchun bir marta); katta klinikada ham sig'adigan chegara bilan
    async statsExport() {
      const bulk = (path: string) => call({ method: 'GET', path: cid => `${path}?${q(cid)}`, timeoutMs: PATIENTS_TIMEOUT_MS, limit: PATIENTS_BODY_LIMIT });
      const [visits, payments, patients] = await Promise.all([bulk('/api/appointments'), bulk('/api/transactions'), bulk('/api/patients')]);
      return {
        visits: many(VisitStatSchema, visits, 'qabullar (tahlil)', false),
        payments: many(PaymentStatSchema, payments, "to'lovlar (tahlil)", false),
        patients: many(PatientStatSchema, patients, 'bemorlar (tahlil)', false),
      };
    },
    // Faqat ikkala nashr ham qabul qiladigan maydonlar: bulut nashri notanish maydonli so'rovni rad etadi
    createTransaction: t => create('/api/transactions', clinicId => ({ ...t, clinicId, status: 'Paid', discountAmount: 0, discountPercent: 0 })),
    createExpense: e => create('/api/expenses', clinicId => ({ ...e, clinicId, note: 'Palantir orqali kiritildi' })),
    removeTransaction: id => remove(cid => `/api/transactions/${encodeURIComponent(id)}?${q(cid)}`),
    removeExpense: id => remove(cid => `/api/expenses/${encodeURIComponent(id)}?${q(cid)}`),
    bookAppointment(b) {
      const next = booking.catch(() => {}).then(() => bookNow(b));
      booking = next;
      return next;
    },
    visitResult(id, r) {
      const next = booking.catch(() => {}).then(async () => {
        const body = { result: r.result, ...(r.date ? { date: r.date, time: r.time } : {}), note: r.note ?? 'Palantir' };
        let saved: unknown;
        try {
          saved = await write(cid => `/api/appointments/${encodeURIComponent(id)}/call?${q(cid)}`, () => body);
        } catch (e) {
          if (!(e instanceof CrmError) || e.message !== MISSING_ROUTE) throw e;
          // Eski nashr: qabulxona yo'li yo'q — qabulning o'zi tahrirlanadi
          const patch = r.result === 'rescheduled' ? { date: r.date, time: r.time, status: 'Confirmed' } : { status: r.result === 'cancelled' ? 'Cancelled' : 'Confirmed' };
          saved = await write(cid => `/api/appointments/${encodeURIComponent(id)}?${q(cid)}`, () => patch, 'PUT');
        }
        return one(AppointmentSchema, saved);
      });
      booking = next;
      return next;
    },
  };

  async function bookNow(b: Booking): Promise<Appointment> {
    {
      const [dayRows, clinic, doctors] = await Promise.all([api.appointments(b.date), api.clinic(), api.doctors()]);
      const doctor = doctors.find(d => d.id === b.doctorId);
      if (!doctor) throw new CrmError('invalid', 'Bunday shifokor topilmadi — doctor_id ni free_slots yoki clinic_day natijasidan oling');
      const problem = bookingProblem({ appointments: dayRows, doctor, clinic, patientId: b.patient.id, date: b.date, time: b.time, duration: b.duration, now: b.now });
      if (problem) throw new CrmError('conflict', problem);
      const saved = one(AppointmentSchema, await write('/api/appointments', clinicId => ({
        clinicId, patientId: b.patient.id, patientName: patientName(b.patient), doctorId: doctor.id, doctorName: doctorName(doctor),
        type: b.type, date: b.date, time: b.time, duration: b.duration, status: 'Pending', reminderSent: false, notes: b.notes ?? '',
      })));
      // CRM bemorning shu kundagi eski yozuvini jimgina qaytarishi mumkin — bu yangi qabul emas
      const existed = dayRows.some(a => a.id === saved.id);
      if (existed || saved.time !== b.time || saved.doctorId !== doctor.id || saved.date !== b.date || saved.patientId !== b.patient.id) {
        throw new CrmError('conflict', `Yozilmadi: bu bemor shu kuni allaqachon yozilgan — ${saved.time}, ${saved.doctorName}`);
      }
      return saved;
    }
  }
  return api;
}
