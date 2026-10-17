/**
 * DentaCRM'ga pul yozuvlari: bemor to'lovi, klinika xarajati, shifokorga to'lov (ulush yoki oylik).
 * Bu yerda — nima yozilishi (tur va matnlar) va CRM'ga yozishning o'zi. Kim va qachon tasdiqlashi — actions.ts da.
 *
 * CRM takroriy so'rovdan himoyalanmagan (ikki marta yuborilsa — ikki marta yoziladi), shuning uchun:
 *   yozishdan oldin shu kunda aynan shunday yozuv bor-yo'qligi tekshiriladi; javob kelmasa qayta urinilmaydi.
 * Ikkala nashr (bulut va lokal) qabul qiladigan maydonlargina yuboriladi: bulut nashri notanish maydonni rad etadi.
 * Qarzni yopish, avans va bemor hisobidan to'lash bu yerda yo'q — ular bemor balansini o'zgartiradi (CRM'da qo'lda).
 */
import { money as sum } from '../../src/lib/text';
import type { MoneyKind } from '../../src/types';
import { CrmError, type DentaCrm } from './dentacrm';
import { doctorName, type Doctor } from './logic';

export const METHODS = ['Cash', 'Card', 'Click', 'Transfer'] as const;
export type Method = typeof METHODS[number];
export const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Inventory', 'Lab', 'Other'] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
type PayoutCategory = 'DoctorShare' | 'Salary';

const METHOD_LABEL: Record<Method, string> = { Cash: 'naqd', Card: 'karta', Click: 'Click', Transfer: "pul o'tkazmasi" };
const CATEGORY_LABEL: Record<ExpenseCategory | PayoutCategory, string> = {
  Rent: 'ijara', Utilities: 'kommunal', Inventory: 'material va jihoz', Lab: 'laboratoriya', Other: 'boshqa', DoctorShare: 'shifokor ulushi (foiz)', Salary: 'oylik',
};

interface Base { amount: number; method: Method; /** YYYY-MM-DD */ date: string }
export interface PaymentPayload extends Base { kind: 'payment'; patientId: string; patientName: string; /** Ismdoshlarni ajratish uchun kartada oxirgi raqamlari ko'rsatiladi */ patientPhone?: string | null; doctorId: string; doctorName: string; service: string }
export interface ExpensePayload extends Base { kind: 'expense'; category: ExpenseCategory; title: string }
export interface PayoutPayload extends Base { kind: 'payout'; doctorId: string; doctorName: string; category: PayoutCategory; title: string; /** Egasi bilishi kerak bo'lgan narsa (masalan, maosh turi belgilanmagan) */ warning?: string | null }
export type MoneyPayload = PaymentPayload | ExpensePayload | PayoutPayload;

export interface Expense { id: string; date: string | null; amount: number; category: string; title: string | null; doctorId: string | null }
export interface NewTransaction { patientId: string; patientName: string; doctorId: string; doctorName: string; date: string; amount: number; type: Method; service: string }
export interface NewExpense { date: string; amount: number; category: string; title: string; method: Method; doctorId?: string }

/**
 * Shifokorga to'lov CRM'da qaysi tur bilan yoziladi. Noto'g'ri tur foydani ikki marta kamaytiradi:
 * foizli shifokor — «ulush», belgilangan oylikli — «oylik»; aralash turda ikkiga bo'lish kerak (buni faqat egasi biladi).
 * Lokal nashrda maosh turi yo'q — hamma shifokor foizli.
 */
export function payoutCategory(doctor: Doctor): { category: PayoutCategory; warning: string | null } | { problem: string } {
  switch (doctor.salaryType) {
    case 'fixed_kpi': return { problem: `${doctorName(doctor)}ning maoshi ikki qismdan iborat (oylik va foiz) — bu to'lovni DentaCRM'ning Moliya bo'limida ikkiga bo'lib kiriting` };
    case 'fixed': return { category: 'Salary', warning: null };
    case 'none': return { category: 'Salary', warning: "CRM'da bu shifokorga maosh turi belgilanmagan — oylik sifatida yoziladi" };
    default: return { category: 'DoctorShare', warning: null };
  }
}

/** Egasiga ko'rsatiladigan matn: sarlavha va qatorlar. Faqat tekshirilgan ma'lumotdan (model matni emas) */
export function summarize(p: MoneyPayload): { title: string; details: string[] } {
  const tail = [`Usul: ${METHOD_LABEL[p.method]}`, `Sana: ${p.date}`];
  const phone = p.kind === 'payment' ? (p.patientPhone ?? '').replace(/\D/g, '').slice(-4) : '';
  switch (p.kind) {
    case 'payment': return { title: `To'lov qabul qilish: ${sum(p.amount)} so'm`, details: [`Bemor: ${p.patientName}${phone ? ` (tel. …${phone})` : ''}`, `Xizmat: ${p.service}`, `Shifokor: ${p.doctorName}`, ...tail] };
    case 'expense': return { title: `Xarajat: ${sum(p.amount)} so'm`, details: [`Nima uchun: ${p.title}`, `Turi: ${CATEGORY_LABEL[p.category]}`, ...tail] };
    case 'payout': return { title: `Shifokorga to'lov: ${sum(p.amount)} so'm`, details: [`Shifokor: ${p.doctorName}`, `Turi: ${CATEGORY_LABEL[p.category]}`, ...tail, ...(p.warning ? [`Eslatma: ${p.warning}`] : [])] };
  }
}

const DUPLICATE = "CRM'da shu kunda aynan shunday yozuv allaqachon bor — ikkinchi marta yozmadim. Haqiqatan yana bitta kerak bo'lsa, DentaCRM'da qo'lda kiriting";
const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
const gone = (what: string) => new CrmError('invalid', `${what} CRM'da topilmadi — yordamchidan qayta so'rang`);

/** CRM'ga yozadi; qaytaradi — yaratilgan yozuvning id'si. Yozishdan oldin bemor/shifokor borligi va takror tekshiriladi */
export async function writeEntry(crm: DentaCrm, p: MoneyPayload): Promise<string> {
  if (p.kind === 'payment') {
    const [patients, doctors, day] = await Promise.all([crm.patients(), crm.doctors(), crm.transactions(p.date)]);
    if (!patients.some(x => x.id === p.patientId)) throw gone('Bemor');
    if (!doctors.some(d => d.id === p.doctorId)) throw gone('Shifokor');
    if (day.some(t => t.amount === p.amount && t.type === p.method && same(t.service, p.service) && same(t.patientName, p.patientName))) throw new CrmError('conflict', DUPLICATE);
    return crm.createTransaction({ patientId: p.patientId, patientName: p.patientName, doctorId: p.doctorId, doctorName: p.doctorName, date: p.date, amount: p.amount, type: p.method, service: p.service });
  }
  const doctorId = p.kind === 'payout' ? p.doctorId : null;
  const [expenses, doctors] = await Promise.all([crm.expenses(), doctorId ? crm.doctors() : []]);
  if (doctorId && !doctors.some(d => d.id === doctorId)) throw gone('Shifokor');
  const twin = expenses.some(e => (e.date ?? '').startsWith(p.date) && e.amount === p.amount && e.category === p.category && same(e.title, p.title) && (e.doctorId ?? null) === doctorId);
  if (twin) throw new CrmError('conflict', DUPLICATE);
  return crm.createExpense({ date: p.date, amount: p.amount, category: p.category, title: p.title, method: p.method, ...(doctorId ? { doctorId } : {}) });
}

/** Yozuvni CRM'dan o'chiradi (shu yerda yozilgan oddiy to'lov va xarajat balansga ta'sir qilmagan — o'chirish to'liq ortga qaytaradi) */
export const eraseEntry = (crm: DentaCrm, kind: MoneyKind, crmId: string): Promise<void> =>
  (kind === 'payment' ? crm.removeTransaction(crmId) : crm.removeExpense(crmId));
