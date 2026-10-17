/**
 * Resepshn: bemor yozishmada (bot, shaxsiy Telegram, Instagram) qabulga yoziladi.
 *   scheduleText   — mijozga javob beruvchi model uchun: shifokorlar va yaqin kunlardagi bo'sh vaqtlar (CRM'dan);
 *   checkBooking   — bemor tanlagan vaqtga yozib bo'ladimi (yozmasdan tekshiradi);
 *   bookForCustomer — bemorni telefoni va ismi bo'yicha topadi yoki yaratadi va CRM'ga yozadi.
 * Model faqat taklif qiladi: har bir qabul shu yerda qayta tekshiriladi (band vaqt, jadval, shifokor, sana).
 * Nechta qabul o'zi yozilishi mumkinligi (chegaralar) — inbox/core.ts da: ular faqat tasdiqsiz yozishga tegishli.
 */
import type { ReplyBooking } from '../../src/types';
import { DAYS, addDays, fromIso, iso, stamp, weekday } from '../../src/lib/week';
import type { BusinessRow } from '../db';
import { CrmError } from './dentacrm';
import { crmConnected, withCrm } from './index';
import { DEFAULT_DURATION_MIN, SLOT_STEP_MIN, bookingProblem, cleanName, dayOff, doctorName, freeSlots, hasFullName, isRealDate, normPhone, resolvePatient, slotRanges, type Doctor, type Patient } from './logic';

const DAYS_AHEAD = 7;
/** Jadval matni shuncha vaqt qayta ishlatiladi (ketma-ket xabarlarda CRM'ga qayta-qayta murojaat qilinmasin) */
const SCHEDULE_TTL_MS = 30_000;
const VISIT_TYPE = 'Konsultatsiya';
/** Bemor o'zi yozilganda: hozirdan kamida shuncha keyin (kelishga ulgursin, resepshn tayyorlansin) */
const MIN_LEAD_MIN = 60;
/** Jadvalni yig'ish uchun umumiy vaqt: CRM sekin bo'lsa, bemor javobsiz qolmasin (qabulsiz javob beriladi) */
const SCHEDULE_TIMEOUT_MS = 6_000;

/** Bir klinikaning qabullari navbat bilan yoziladi: ikki bemor bir vaqtni tanlasa, ikkinchisi band ekanini ko'radi */
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(bizId: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(bizId) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(bizId, next);
  void next.finally(() => { if (queues.get(bizId) === next) queues.delete(bizId); }).catch(() => {});
  return next;
}

/** Bemor o'zi yozila oladigan shifokorlar — jadvalda ko'rsatiladiganlar ham aynan shular */
const bookable = (d: Doctor) => d.status !== 'Inactive';
/** CRM'dagi id modelga faqat harf-raqam ko'rinishida boradi (so'rov ichiga begona matn tushmasin) va shu ko'rinishda qaytadi */
const doctorKey = (id: string) => id.replace(/[^\w-]/g, '');
/** Bemor uchun «hozir»: bundan oldingi vaqtlar taklif ham qilinmaydi, qabul ham qilinmaydi */
const earliest = () => stamp(new Date(Date.now() + MIN_LEAD_MIN * 60_000));
const window = () => Array.from({ length: DAYS_AHEAD }, (_, i) => iso(addDays(new Date(), i)));

const schedules = new Map<string, { at: number; text: string }>();
const loading = new Map<string, Promise<string | null>>();

async function loadSchedule(bizId: string): Promise<string | null> {
  try {
    const late = new Promise<never>((_, reject) => { setTimeout(() => reject(new CrmError('unreachable', 'jadval kechikdi')), SCHEDULE_TIMEOUT_MS).unref(); });
    const text = await Promise.race([late, withCrm(bizId, async crm => {
      const dates = window();
      const [clinic, doctors, days] = await Promise.all([crm.clinic(), crm.doctors(), Promise.all(dates.map(d => crm.appointments(d)))]);
      const now = earliest();
      return doctors.filter(bookable).map(doctor => [
        `- doctor_id ${doctorKey(doctor.id)} — ${doctorName(doctor)}${doctor.specialty ? `, ${doctor.specialty}` : ''}`,
        ...dates.map((date, i) => {
          const off = dayOff(doctor, clinic, date);
          const slots = off ? [] : freeSlots({ appointments: days[i], doctor, clinic, date, duration: DEFAULT_DURATION_MIN, now });
          // Shifokor jadvalidagi izoh ("seminar", "ta'til") — ichki ma'lumot: bemorga faqat «qabul yo'q»
          const closed = off?.includes('klinika') ? 'klinika dam olish kuni' : "qabul yo'q";
          return `  ${date} (${DAYS.uz[weekday(fromIso(date))]}): ${off ? closed : slots.length ? slotRanges(slots) : "bo'sh vaqt yo'q"}`;
        }),
      ].join('\n')).join('\n');
    })]);
    schedules.set(bizId, { at: Date.now(), text });
    return text;
  } catch (e) {
    if (!(e instanceof CrmError)) console.error('[crm] jadval:', e);
    return null;
  }
}

/** Shifokorlar va bo'sh vaqtlar; CRM ulanmagan yoki javob bermasa — null (javob beruvchi qabulsiz ishlayveradi) */
export function scheduleText(bizId: string): Promise<string | null> {
  if (!crmConnected(bizId)) return Promise.resolve(null);
  const hit = schedules.get(bizId);
  if (hit && Date.now() - hit.at < SCHEDULE_TTL_MS) return Promise.resolve(hit.text);
  // Bir vaqtda kelgan xabarlar bitta so'rovni kutadi
  const busy = loading.get(bizId);
  if (busy) return busy;
  const fresh = loadSchedule(bizId).finally(() => loading.delete(bizId));
  loading.set(bizId, fresh);
  return fresh;
}

/** Ma'lumot to'liqmi (CRM'ga bormasdan) */
function askProblem(ask: ReplyBooking): string | null {
  if (!hasFullName(ask.name)) return 'bemorning ismi va familiyasi kerak';
  if (!normPhone(ask.phone)) return "telefon raqami yo'q yoki to'liq emas";
  if (!isRealDate(ask.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(ask.time)) return "sana yoki vaqt noto'g'ri";
  if (ask.date > window().at(-1)!) return `yozishmada faqat yaqin ${DAYS_AHEAD} kunga yoziladi`;
  return null;
}

export type BookingCheck =
  | { doctorId: string; doctorName: string; /** Bazadagi shu bemor (telefon ham, ism-familiya ham mos); yo'q bo'lsa yangi bemor ochiladi */ patient: Patient | null; /** Shu telefon bazada boshqa ism(lar) bilan turibdi */ others: string[] }
  | { problem: string };

/** Yozib bo'ladimi: qaytaradi — shifokor va bemor (bo'ladi) yoki sababi (bo'lmaydi). Hech narsa yozmaydi */
export async function checkBooking(biz: BusinessRow, ask: ReplyBooking): Promise<BookingCheck> {
  const incomplete = askProblem(ask);
  if (incomplete) return { problem: incomplete };
  try {
    return await withCrm(biz.id, async crm => {
      const [appointments, clinic, doctors, patients] = await Promise.all([crm.appointments(ask.date), crm.clinic(), crm.doctors(), crm.patients()]);
      const doctor = doctors.filter(bookable).find(d => doctorKey(d.id) === doctorKey(ask.doctorId));
      if (!doctor) return { problem: 'bunday shifokor topilmadi' };
      const { patient, others } = resolvePatient(patients, ask.name, ask.phone);
      const slot = { appointments, doctor, clinic, date: ask.date, duration: DEFAULT_DURATION_MIN };
      const problem = bookingProblem({ ...slot, patientId: patient?.id ?? null, time: ask.time, now: stamp(new Date()), minLeadMin: MIN_LEAD_MIN });
      if (problem) return { problem };
      // Faqat jadvalda ko'rsatilgan vaqtlar: 13:07 kabi vaqt ikkita bo'sh o'rinni band qilib qo'yardi
      if (!freeSlots({ ...slot, now: earliest() }).includes(ask.time)) return { problem: `${ask.time} jadvalda yo'q (qabul har ${SLOT_STEP_MIN} daqiqada boshlanadi, kamida ${MIN_LEAD_MIN} daqiqa oldin yoziladi)` };
      return { doctorId: doctor.id, doctorName: doctorName(doctor), patient, others };
    });
  } catch (e) {
    if (e instanceof CrmError) return { problem: e.message };
    throw e;
  }
}

/**
 * CRM'ga yozadi. Bazada telefoni ham, ism-familiyasi ham mos bemor bo'lsa — o'shanga; aks holda vaqt tekshirilgach
 * yangi bemor ochiladi (bir telefonda oila a'zolari bo'ladi — begona kartaga yozib qo'yilmaydi). Xato — CrmError
 */
export const bookForCustomer = (biz: BusinessRow, ask: ReplyBooking): Promise<void> => inTurn(biz.id, async () => {
  // Navbat ichida qayta tekshiriladi: oldingi bemor shu vaqtni olgan bo'lishi mumkin
  const ready = await checkBooking(biz, ask);
  if ('problem' in ready) throw new CrmError('conflict', ready.problem);
  await withCrm(biz.id, async crm => {
    const [firstName, ...rest] = cleanName(ask.name).split(' ');
    const patient = ready.patient ?? await crm.createPatient({ firstName, lastName: rest.join(' '), phone: normPhone(ask.phone) });
    await crm.bookAppointment({
      patient, doctorId: ready.doctorId, date: ask.date, time: ask.time, duration: DEFAULT_DURATION_MIN, type: VISIT_TYPE,
      notes: 'Cerebro: bemor yozishmada yozildi', now: stamp(new Date()),
    });
  });
  schedules.delete(biz.id);
});

/** Egasiga ko'rsatiladigan qator: "Rustam Rustamov, 2026-10-09 15:00 — Vali Valiyev, +998…" */
export const bookingLine = (b: ReplyBooking): string => `${b.doctorName || 'shifokor'}, ${b.date} ${b.time} — ${b.name}, ${b.phone}`;
