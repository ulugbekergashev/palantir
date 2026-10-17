/**
 * Pul asboblari — DentaCRM ulangan biznesda. Hech biri CRM'ga yozmaydi: tekshirilgan taklif tayyorlaydi,
 * egasi kartadagi «Tasdiqlash»ni bosgandagina yoziladi (actions.ts). Summani va kimga ekanini model emas, shu kod tekshiradi.
 */
import { z } from 'zod';
import { money as sum } from '../../src/lib/text';
import { addDays, iso } from '../../src/lib/week';
import { env } from '../env';
import { ToolError, def, type ToolCtx } from '../toolkit';
import { entryView, proposeEntry } from './actions';
import { CrmError, type DentaCrm } from './dentacrm';
import { withCrm } from './index';
import { doctorName, isRealDate, patientName } from './logic';
import { EXPENSE_CATEGORIES, METHODS, payoutCategory, type MoneyPayload } from './money';

/** Bir javobda tayyorlanadigan takliflar: undan ko'pi — egasi alohida so'rasin (kartalar uyumi bexato tasdiqlanmaydi) */
const MAX_DRAFTS_PER_TURN = 3;
/** O'tgan sanaga yozish: ko'pi bilan shuncha kun (eski, yopilgan kunlar hisobi o'zgarib ketmasin) */
const MAX_DAYS_BACK = 31;

const amount = z.number().int('butun son (so\'mda)').positive().refine(n => n <= env.crmMaxAmount, { message: `bitta yozuv chegarasi — ${sum(env.crmMaxAmount)} so'm; kattasini DentaCRM'da kiriting` });
const method = z.enum(METHODS).optional().describe('Payment method, default Cash');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine(isRealDate, "taqvimda bunday sana yo'q").optional().describe('YYYY-MM-DD, default today; not in the future');
const short = (max: number) => z.string().trim().min(1).max(max);
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>`]/g, ' ').replace(/\s+/g, ' ').trim();

const CONFIRM_NOTE = 'Nothing is written to the CRM yet. The owner got a card with the details and a "Tasdiqlash" button; it is written only when they press it. Tell the owner to check the card and press the button — do not say it is recorded.';

async function inCrm<T>(ctx: ToolCtx, work: (crm: DentaCrm) => Promise<T>): Promise<T> {
  try {
    return await withCrm(ctx.biz.id, work);
  } catch (e) {
    if (e instanceof CrmError) throw new ToolError(e.message);
    throw e;
  }
}

function dayOf(given: string | undefined): string {
  const today = iso(new Date());
  const day = given ?? today;
  if (day > today) throw new ToolError("Kelajak sanaga pul yozilmaydi");
  if (day < iso(addDays(new Date(), -MAX_DAYS_BACK))) throw new ToolError(`${MAX_DAYS_BACK} kundan eski sanaga yozilmaydi — DentaCRM'da qo'lda kiriting`);
  return day;
}

function propose(ctx: ToolCtx, payload: MoneyPayload, warning: string | null = null) {
  if ((ctx.moneyDrafts ?? 0) >= MAX_DRAFTS_PER_TURN) throw new ToolError(`Bir javobda ko'pi bilan ${MAX_DRAFTS_PER_TURN} ta pul yozuvi tayyorlanadi — qolganini egasi alohida so'rasin`);
  const entry = entryView(proposeEntry(ctx.biz, payload));
  ctx.moneyDrafts = (ctx.moneyDrafts ?? 0) + 1;
  ctx.artifacts.push({ type: 'money', entry });
  return { draft_id: entry.id, status: 'waiting_for_owner', summary: [entry.title, ...entry.details], ...(warning ? { warning } : {}), note: CONFIRM_NOTE };
}

export const MONEY_DEFS = {
  record_payment: def({
    description: `Prepare a patient payment for DentaCRM (money the clinic received for treatment). This does NOT write anything: it creates a card with a "Tasdiqlash" button for the owner, and the payment is saved only when the owner presses it. Needs patient_id (from find_patient), the amount in so'm, and doctor_id (from clinic_day or free_slots) unless the clinic has a single doctor. Use only for a plain payment. It cannot close an old debt, add an advance to the patient's balance or pay from that balance — for those tell the owner to enter it in DentaCRM. If the owner did not say the amount or the patient clearly, ask first.`,
    input: z.object({ patient_id: short(60), amount, method, service: short(80).optional().describe('What was paid for, e.g. "Plomba"; default "To\'lov"'), doctor_id: short(60).optional(), date }),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const day = dayOf(i.date);
      const service = clean(i.service ?? "To'lov") || "To'lov";
      if (/avans|depozit|oldindan|аванс|предоплат|депозит|залог|deposit|advance|prepay/i.test(service)) throw new ToolError("Avans bemor balansini o'zgartiradi — uni DentaCRM'da kiriting");
      const [patients, doctors] = await Promise.all([crm.patients(), crm.doctors()]);
      const patient = patients.find(p => p.id === i.patient_id);
      if (!patient) throw new ToolError('Bunday bemor topilmadi — patient_id ni find_patient natijasidan oling');
      const active = doctors.filter(d => d.status !== 'Inactive');
      const doctor = i.doctor_id ? doctors.find(d => d.id === i.doctor_id) : active.length === 1 ? active[0] : undefined;
      if (!doctor) throw new ToolError(i.doctor_id ? 'Bunday shifokor topilmadi — doctor_id ni clinic_day yoki free_slots natijasidan oling' : "Klinikada bir nechta shifokor bor — to'lov qaysi shifokorga tegishli ekanini egasidan so'rang (doctor_id)");
      return propose(ctx, { kind: 'payment', patientId: patient.id, patientName: patientName(patient), patientPhone: patient.phone, doctorId: doctor.id, doctorName: doctorName(doctor), service, amount: i.amount, method: i.method ?? 'Cash', date: day });
    }),
  }),

  record_expense: def({
    description: `Prepare a clinic expense for DentaCRM (rent, utilities, materials, lab, other). This does NOT write anything: it creates a card with a "Tasdiqlash" button, and the expense is saved only when the owner presses it. Categories: Rent, Utilities, Inventory (materials, equipment), Lab, Other. Do not use this for paying a doctor — use pay_doctor.`,
    input: z.object({ amount, category: z.enum(EXPENSE_CATEGORIES), title: short(120).describe('What the money was spent on, in the owner\'s words'), method, date }),
    run: async (i, ctx) => {
      const title = clean(i.title);
      if (!title) throw new ToolError('Xarajat nima uchunligini yozing');
      return propose(ctx, { kind: 'expense', category: i.category, title, amount: i.amount, method: i.method ?? 'Cash', date: dayOf(i.date) });
    },
  }),

  pay_doctor: def({
    description: `Prepare a payout to a doctor for DentaCRM (their share or salary). This does NOT write anything: it creates a card with a "Tasdiqlash" button, and the payout is saved only when the owner presses it. Needs doctor_id (from clinic_day or free_slots) and the amount the owner named. The entry type (share or salary) is chosen from the doctor's pay terms in the CRM. You cannot calculate how much the doctor is owed — the owner names the amount.`,
    input: z.object({ doctor_id: short(60), amount, method, date }),
    run: (i, ctx) => inCrm(ctx, async crm => {
      const day = dayOf(i.date);
      const doctor = (await crm.doctors()).find(d => d.id === i.doctor_id);
      if (!doctor) throw new ToolError('Bunday shifokor topilmadi — doctor_id ni clinic_day yoki free_slots natijasidan oling');
      const kind = payoutCategory(doctor);
      if ('problem' in kind) throw new ToolError(kind.problem);
      const name = doctorName(doctor);
      return propose(ctx, { kind: 'payout', doctorId: doctor.id, doctorName: name, category: kind.category, title: `${kind.category === 'Salary' ? 'Oylik' : 'Shifokor ulushi'} — ${name}`, warning: kind.warning, amount: i.amount, method: i.method ?? 'Cash', date: day }, kind.warning);
    }),
  }),
};
