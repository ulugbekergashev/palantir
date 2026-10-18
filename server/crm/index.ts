/**
 * Biznesning DentaCRM ulanishi: manzil va login — ochiq, parol — shifrlangan (connections jadvali, 'dentacrm').
 * Mijoz (token bilan) xotirada turadi; uzilganda yoki qayta ulanganda yangilanadi.
 */
import { iso } from '../../src/lib/week';
import { connections, type BusinessRow } from '../db';
import { env } from '../env';
import { open, seal } from '../secret';
import { CrmError, createDentaCrm, type CrmErrorKind, type DentaCrm } from './dentacrm';
import { loadAlerts, loadPeriod } from './history';
import { periodRange } from './report';
import { briefLine, normalizeBaseUrl, type Patient } from './logic';

const NOT_CONNECTED = "DentaCRM ulanmagan — panel → Ulanishlar'da ulang";
const BRIEF_TIMEOUT_MS = 4_000;
/** Ogohlantirishlar o'nlab so'rov yig'adi — alohida, kattaroq vaqt */
const ALERTS_TIMEOUT_MS = 20_000;
/** Panelda «muammo» bo'lib ko'rinadigan xatolar (band vaqt kabi ish xatolari emas) */
const OUTAGES: CrmErrorKind[] = ['auth', 'credentials', 'license', 'unreachable', 'protocol'];

const clients = new Map<string, DentaCrm>();

export const crmConnected = (bizId: string): boolean => !!connections.get(bizId, 'dentacrm');

export function crmFor(bizId: string): DentaCrm | null {
  const hit = clients.get(bizId);
  if (hit) return hit;
  const c = connections.get(bizId, 'dentacrm');
  if (!c) return null;
  let password: string;
  try { password = open(c.secret); } catch { throw new CrmError('auth', "DentaCRM paroli o'qilmadi — panel → Ulanishlar'da qayta ulang"); }
  const client = createDentaCrm({ baseUrl: c.account.baseUrl, username: c.account.username, password });
  clients.set(bizId, client);
  return client;
}

/** Manzilni tekshiradi, kirib ko'radi va klinikani o'qiydi; hammasi o'tsa — saqlaydi */
export async function connectCrm(biz: BusinessRow, v: { url: string; username: string; password: string }): Promise<void> {
  let baseUrl: string;
  try { baseUrl = normalizeBaseUrl(v.url, env.crmAllowPrivate); } catch (e) { throw new CrmError('invalid', (e as Error).message); }
  const client = createDentaCrm({ baseUrl, username: v.username, password: v.password });
  const who = await client.login();
  const clinic = await client.clinic();
  connections.save(biz.id, 'dentacrm', seal(v.password), { baseUrl, username: v.username, clinicId: who.clinicId, clinicName: clinic.name, role: who.role });
  clients.set(biz.id, client);
}

export function disconnectCrm(bizId: string): void {
  connections.remove(bizId, 'dentacrm');
  clients.delete(bizId);
}

export const crmClinicName = (bizId: string): string | null => connections.get(bizId, 'dentacrm')?.account.clinicName ?? null;

/** Panel uchun (tarmoqqa chiqmaydi) */
export function crmStatus(bizId: string): { account: string | null; problem: string | null } {
  const c = connections.get(bizId, 'dentacrm');
  if (!c) return { account: null, problem: null };
  return { account: `${c.account.clinicName} · ${new URL(c.account.baseUrl).host}`, problem: c.meta.problem ?? null };
}

function setProblem(bizId: string, problem: string | null): void {
  const cur = connections.get(bizId, 'dentacrm');
  if (cur && (cur.meta.problem ?? null) !== problem) connections.patchMeta(bizId, 'dentacrm', { problem: problem ?? undefined });
}

/** CRM bilan ish; natijasiga qarab paneldagi «muammo» belgisi qo'yiladi yoki olinadi */
export async function withCrm<T>(bizId: string, work: (crm: DentaCrm) => Promise<T>): Promise<T> {
  try {
    const crm = crmFor(bizId);
    if (!crm) throw new CrmError('invalid', NOT_CONNECTED);
    const result = await work(crm);
    setProblem(bizId, null);
    return result;
  } catch (e) {
    if (e instanceof CrmError && OUTAGES.includes(e.kind)) setProblem(bizId, e.message);
    throw e;
  }
}

/** Ertalabki xulosa uchun qator(lar). CRM javob bermasa — bo'sh: xulosa baribir ketadi */
export async function crmBriefLines(bizId: string, date: string): Promise<string[]> {
  if (!crmConnected(bizId)) return [];
  const within = <T,>(work: Promise<T>, ms: number): Promise<T> =>
    Promise.race([work, new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('timeout')), ms).unref(); })]);
  // CRM javob bermagani kutilgan holat (paneldagi belgi yetarli); boshqasi — dastur xatosi
  const quiet = (e: unknown) => { if (!(e instanceof CrmError) && (e as Error).message !== 'timeout') console.error('[crm] xulosa:', e); };
  // Ikkalasi alohida: ogohlantirishlar (ko'proq so'rov) kechiksa ham bugungi qabullar qatori chiqadi
  const [line, alerts] = await Promise.all([
    within(withCrm(bizId, crm => crm.appointments(date)), BRIEF_TIMEOUT_MS).then(briefLine).catch(e => { quiet(e); return null; }),
    // withCrm'siz: eski kunlardagi bitta buzuq qator paneldagi «muammo» belgisini yoqib-o'chirmasin
    within(Promise.resolve().then(() => { const crm = crmFor(bizId); return crm ? loadAlerts(crm, date) : []; }), ALERTS_TIMEOUT_MS)
      .catch(e => { quiet(e); console.warn(`[crm] ogohlantirishlar olinmadi: ${(e as Error).message}`); return [] as string[]; }),
  ]);
  return [...(line ? [line] : []), ...alerts.map(a => `⚠️ ${a}`)];
}

/** Bugun yordamchi yana nechta qabul yoza oladi */
export function bookingsLeft(bizId: string): number {
  const m = connections.get(bizId, 'dentacrm')?.meta;
  return env.crmDailyBookings - (m?.bookDay === iso(new Date()) ? Number(m.booked ?? 0) : 0);
}

export function noteBooking(bizId: string): void {
  const today = iso(new Date());
  connections.patchMeta(bizId, 'dentacrm', { bookDay: today, booked: String(env.crmDailyBookings - bookingsLeft(bizId) + 1) });
}

// ─── Kunlik reja: dushanba yakuni va qaytarish ro'yxati ──────────────────────

const WEEK_TIMEOUT_MS = 20_000;
const RECALL_FROM_DAYS = 365, RECALL_TO_DAYS = 180;
const money = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');
const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('timeout')), ms).unref(); })]);

/** O'tgan haftaning bitta qatori: qabullar, kelganlar, tushum va oldingi haftaga nisbatan. CRM javob bermasa — null */
export async function crmWeekLine(bizId: string, today: string): Promise<string | null> {
  if (!crmConnected(bizId)) return null;
  try {
    const { from, to } = periodRange('last_week', today);
    const r = await withTimeout(withCrm(bizId, crm => loadPeriod(crm, from, to, 'last_week')), WEEK_TIMEOUT_MS);
    const change = r.previous?.change_pct.revenue;
    const vs = change == null ? '' : ` (oldingi haftadan ${change >= 0 ? '+' : ''}${change}%)`;
    return `${r.appointments.total} ta qabul, kelgani ${r.appointments.came}, tushum ${money(r.revenue.total)} so'm${vs}`;
  } catch (e) {
    console.warn(`[crm] haftalik yakun olinmadi: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Qaytarish kerak bo'lgan bemorlar: oxirgi kelgani 6–12 oy oldin (eng yaqini birinchi). Qabulxona qo'ng'iroq qilib ko'rikka chaqiradi.
 * CRM javob bermasa — bo'sh ro'yxat
 */
export async function recallPatients(bizId: string, today: string): Promise<Patient[]> {
  if (!crmConnected(bizId)) return [];
  const day = (n: number) => iso(new Date(Date.parse(`${today}T12:00:00`) - n * 86_400_000));
  const from = day(RECALL_FROM_DAYS), to = day(RECALL_TO_DAYS);
  try {
    const all = await withTimeout(withCrm(bizId, crm => crm.patients()), WEEK_TIMEOUT_MS);
    return all.filter(p => p.lastVisit && p.lastVisit.slice(0, 10) >= from && p.lastVisit.slice(0, 10) <= to)
      .sort((a, b) => b.lastVisit!.localeCompare(a.lastVisit!));
  } catch (e) {
    console.warn(`[crm] qaytarish ro'yxati olinmadi: ${(e as Error).message}`);
    return [];
  }
}
