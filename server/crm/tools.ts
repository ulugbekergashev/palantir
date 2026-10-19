/**
 * Klinika asboblari — DentaCRM ulangan biznesda yordamchiga beriladi.
 * O'qiydiganlari (kun, bemor, bo'sh vaqt) va bitta yozadigani: qabulga yozish. U egasining aniq buyrug'i bilan
 * darhol bajariladi (tugmasiz) — shuning uchun faqat aniq patient_id va doctor_id qabul qiladi, taxmin qilmaydi.
 */
import { z } from 'zod';
import { iso, stamp } from '../../src/lib/week';
import { PHOTO_REFUSAL, UNATTENDED_REFUSAL, ToolError, def, type ToolCtx } from '../toolkit';
import { daySummary as cameraDay } from '../camera/routes';
import { cameras } from '../db';
import { CrmError, type DentaCrm } from './dentacrm';
import { MAX_PERIOD_DAYS, loadAlerts, loadPeriod } from './history';
import { bookingsLeft, noteBooking, withCrm } from './index';
import { MONEY_DEFS } from './moneyTools';
import { PERIODS, periodRange, spanDays } from './report';
import { DEFAULT_DURATION_MIN, bookingProblem, dayOff, daySummary, doctorName, freeSlots, isRealDate, patientName, searchPatients, type Patient } from './logic';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine(isRealDate, "taqvimda bunday sana yo'q");
/** Bir javobda yoziladigan qabullar: undan ko'pi — egasi alohida so'rasin */
const MAX_BOOKINGS_PER_TURN = 3;
const EARLIEST_REPORT_DATE = '2015-01-01';
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const duration = z.number().int().min(10).max(240);
const short = (max: number) => z.string().trim().min(1).max(max);

/** CRM xatosi Claude'ga tushunarli matn bo'lib qaytadi (kutilmagan xato — "ichki xato" bo'lib qoladi) */
async function inCrm<T>(ctx: ToolCtx, work: (crm: DentaCrm) => Promise<T>): Promise<T> {
  try {
    return await withCrm(ctx.biz.id, work);
  } catch (e) {
    if (e instanceof CrmError) throw new ToolError(e.message);
    throw e;
  }
}

const patientView = (p: Patient) => ({ patient_id: p.id, name: patientName(p), phone: p.phone, last_visit: p.lastVisit?.slice(0, 10) ?? null, balance: p.balance });

const CLINIC_DEFS = {
  clinic_day: def({
    description: 'The clinic\'s day from DentaCRM: appointments grouped by doctor with statuses, how many patients came / did not show / are still expected, revenue by payment method and unpaid sums (in so\'m). Default date is today. Use for "how many patients today", "how much did we earn", "who is booked with doctor X", "who did not come".',
    input: z.object({ date: date.optional().describe('YYYY-MM-DD, default today') }),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const day = i.date ?? iso(new Date());
      const [appointments, transactions] = await Promise.all([crm.appointments(day), crm.transactions(day)]);
      return { date: day, ...daySummary(appointments, transactions) };
    }),
  }),

  clinic_period: def({
    description: `The clinic's results over a period from DentaCRM: appointments (came / no-show / cancelled, show rate), revenue by payment method and per day, unpaid sums, a per-doctor table (appointments, came, no-show, revenue), a per-day table, the best day, and a comparison with the previous period of the same length. Give either "period" (this_week, last_week, this_month, last_month, last_7_days, last_30_days; weeks start on Monday, "this_" periods run up to today) or both "from" and "to" (at most ${MAX_PERIOD_DAYS} days). Default is this_week. Future days are never counted: the period ends today at the latest, and "includes_today": true means today is still in progress, so say that the last day is not complete. The comparison ("previous") uses the same weekdays one or more whole weeks earlier, and for months the same days of the month before. Use for "how was the week / month", "which doctor earned most", "are we growing".`,
    input: z.object({ period: z.enum(PERIODS).optional(), from: date.optional(), to: date.optional() })
      .refine(i => !!i.from === !!i.to, 'from va to — ikkalasi birga beriladi')
      .refine(i => !(i.period && i.from), 'period yoki from/to — bittasi')
      .refine(i => !i.from || !i.to || i.from <= i.to, 'from to dan keyin')
      .refine(i => !i.from || !i.to || spanDays(i.from, i.to) <= MAX_PERIOD_DAYS, `davr ${MAX_PERIOD_DAYS} kundan uzun bo'lmasin`)
      .refine(i => !i.from || i.from >= EARLIEST_REPORT_DATE, `${EARLIEST_REPORT_DATE} dan oldingi sana so'ralmaydi`),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const today = iso(new Date());
      const period = i.from ? undefined : i.period ?? 'this_week';
      const asked = i.from && i.to ? { from: i.from, to: i.to } : periodRange(period!, today);
      if (asked.from > today) throw new ToolError('Bu davr hali boshlanmagan');
      // Kelajak kunlar bo'sh keladi: ular o'rtachani va solishtirishni buzmasin
      const to = asked.to < today ? asked.to : today;
      return { ...await loadPeriod(crm, asked.from, to, period), includes_today: to === today };
    }),
  }),

  clinic_cameras: def({
    description: 'What the clinic cameras saw on one day, next to DentaCRM: how many patients actually sat in a dental chair versus appointments marked as arrived, how many people stood at the cash desk versus payments recorded, and the discrepancies between them (a patient in a chair with no such appointment in the CRM; an appointment marked as arrived while nobody was seen in the chair). "findings" are ready Uzbek sentences. Use for "how many patients really came", "does the camera match the CRM", "anything suspicious at the clinic today". The camera does not know who a person is and does not see amounts of money: findings are things for the owner to check, never proof. "cameras": 0 means no camera is set up yet — say that plainly instead of implying everything matches.',
    input: z.object({ date: date.optional().describe('YYYY-MM-DD, default today') }),
    run: async (i, ctx) => {
      const s = await cameraDay(ctx.biz, i.date ?? iso(new Date()));
      return {
        date: s.date, cameras: cameras.list(ctx.biz.id).length, seated_in_chair: s.seated, stood_at_cash_desk: s.deskVisits,
        crm: s.crm ? { marked_arrived: s.crm.visits, payments: s.crm.payments } : 'not available', findings: s.findings.map(f => f.text),
      };
    },
  }),

  clinic_alerts: def({
    description: 'Checks the clinic for anything unusual, from DentaCRM: yesterday\'s revenue against the usual for that weekday, many no-shows or cancellations, yesterday\'s appointments left without a status, payments left as debt, and today\'s schedule against the usual load. Returns ready Uzbek sentences in "alerts" (empty when everything is normal). Use for "is everything fine at the clinic", "anything strange", "what should I pay attention to".',
    input: z.object({}),
    run: (_i, ctx) => inCrm(ctx, async crm => {
      const today = iso(new Date());
      return { checked: today, alerts: await loadAlerts(crm, today) };
    }),
  }),

  find_patient: def({
    description: 'Find patients in DentaCRM by name (any word order) or phone digits. Returns up to 10 matches with patient_id, phone, last visit and advance balance, plus the total number of matches.',
    input: z.object({ query: short(80).describe('Name, surname or phone') }),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const { total, matches } = searchPatients(await crm.patients(), i.query);
      return { total, patients: matches.map(patientView) };
    }),
  }),

  free_slots: def({
    description: 'Free appointment start times in DentaCRM for a date — for one doctor or for all doctors. Each doctor comes with doctor_id (needed for book_appointment). Times when a doctor does not work (day off, leave, own working hours) and the clinic\'s days off are already excluded; "off" says why a doctor has no slots that day.',
    input: z.object({ date, doctor_id: short(60).optional(), duration: duration.optional().describe('Minutes, default 30') }),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const [appointments, clinic, all] = await Promise.all([crm.appointments(i.date), crm.clinic(), crm.doctors()]);
      const doctors = i.doctor_id ? all.filter(d => d.id === i.doctor_id) : all;
      if (!doctors.length) throw new ToolError('Bunday shifokor topilmadi');
      const now = stamp(new Date());
      return {
        date: i.date,
        doctors: doctors.map(doctor => ({
          doctor_id: doctor.id, doctor: doctorName(doctor), specialty: doctor.specialty,
          slots: freeSlots({ appointments, doctor, clinic, date: i.date, duration: i.duration ?? DEFAULT_DURATION_MIN, now }),
          off: dayOff(doctor, clinic, i.date),
        })),
      };
    }),
  }),

  book_appointment: def({
    description: `Book a patient into DentaCRM. This writes to the clinic's CRM immediately — there is no approval button — so call it only when the owner clearly asked to book and every detail is certain.
Give either patient_id (from find_patient) or new_patient (only for someone who is not in the CRM yet), plus doctor_id (from free_slots or clinic_day), date and time. If find_patient returned several people, or a name or time came from an uncertain voice transcript, ask the owner one short question first. After success tell the owner the patient, doctor, date and time.`,
    input: z.object({
      patient_id: short(60).optional(),
      new_patient: z.object({ first_name: short(60), last_name: short(60), phone: short(30).refine(p => p.replace(/\D/g, '').length >= 9, "telefon to'liq emas (kamida 9 raqam)") }).optional(),
      doctor_id: short(60),
      date,
      time,
      type: short(80).optional().describe('Visit type, e.g. "Konsultatsiya", "Davolash"'),
      duration: duration.optional().describe('Minutes, default 30'),
      notes: z.string().trim().max(500).optional(),
    }).refine(i => !!i.patient_id !== !!i.new_patient, 'patient_id yoki new_patient — aynan bittasi kerak'),
    run: (i, ctx) => inCrm(ctx, async crm => {
      if (ctx.fromPhoto) throw new ToolError(PHOTO_REFUSAL);
      if (ctx.unattended) throw new ToolError(UNATTENDED_REFUSAL);
      if ((ctx.crmWrites ?? 0) >= MAX_BOOKINGS_PER_TURN) throw new ToolError(`Bir javobda ko'pi bilan ${MAX_BOOKINGS_PER_TURN} ta qabul yoziladi — qolganini egasi alohida so'rasin`);
      if (bookingsLeft(ctx.biz.id) <= 0) throw new ToolError("Bugungi chegara tugadi: yordamchi orqali bundan ortiq qabul yozilmaydi. Qolganini DentaCRM'da qo'lda yozing");
      const now = stamp(new Date());
      const length = i.duration ?? DEFAULT_DURATION_MIN;
      const patients = await crm.patients();
      let patient = i.patient_id ? patients.find(p => p.id === i.patient_id) : undefined;
      if (i.patient_id && !patient) throw new ToolError('Bunday bemor topilmadi — patient_id ni find_patient natijasidan oling');
      if (i.new_patient) {
        const known = searchPatients(patients, i.new_patient.phone, 1).matches[0];
        if (known) throw new ToolError(`Bu telefon bazada bor: ${patientName(known)} (patient_id: ${known.id}). Shu bemorni yozing yoki egasidan aniqlang`);
        // Vaqt band bo'lsa, bazada keraksiz bemor yozuvi qolmasin — avval vaqt tekshiriladi
        const [appointments, clinic, doctors] = await Promise.all([crm.appointments(i.date), crm.clinic(), crm.doctors()]);
        const doctor = doctors.find(d => d.id === i.doctor_id);
        if (!doctor) throw new ToolError('Bunday shifokor topilmadi — doctor_id ni free_slots natijasidan oling');
        const problem = bookingProblem({ appointments, doctor, clinic, patientId: null, date: i.date, time: i.time, duration: length, now });
        if (problem) throw new ToolError(problem);
        patient = await crm.createPatient({ firstName: i.new_patient.first_name, lastName: i.new_patient.last_name, phone: i.new_patient.phone });
      }
      if (!patient) throw new ToolError('Bemor ko\'rsatilmagan');
      const saved = await crm.bookAppointment({ patient, doctorId: i.doctor_id, date: i.date, time: i.time, duration: length, type: i.type ?? "Ko'rik", notes: i.notes, now });
      ctx.crmWrites = (ctx.crmWrites ?? 0) + 1;
      noteBooking(ctx.biz.id);
      return {
        booked: { appointment_id: saved.id, patient: saved.patientName, doctor: saved.doctorName, date: saved.date, time: saved.time, duration: saved.duration, type: saved.type },
        ...(i.new_patient ? { new_patient_created: patientView(patient) } : {}),
      };
    }),
  }),
};

/** Klinika asboblari: o'qiydiganlar, qabulga yozish va pul yozuvi takliflari (moneyTools.ts) */
export const CRM_DEFS = { ...CLINIC_DEFS, ...MONEY_DEFS };
