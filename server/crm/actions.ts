/**
 * Pul yozuvlarining yo'li: yordamchi taklif tayyorlaydi (draft) → egasi «Tasdiqlash»ni bosadi → CRM'ga yoziladi (done).
 * Holat faqat kutilgan holatdan o'tadi (ikki marta bosilsa — bir marta yoziladi):
 *   draft → running → done | failed (CRM rad etdi) | unknown (javob kelmadi: yozilgan-yozilmagani noma'lum, qayta urinilmaydi)
 *   draft → cancelled;  done → running → undone (shu kuni «Ortga qaytarish»)
 * CRM'ga yetib bo'lmagan bo'lsa (hech narsa yozilmagan) taklif draft'ga qaytadi — keyinroq qayta bosish mumkin.
 */
import type { MoneyEntry, MoneyStatus } from '../../src/types';
import { iso } from '../../src/lib/week';
import { moneyEntries, type BusinessRow, type MoneyRow } from '../db';
import { env } from '../env';
import { CrmError, isUnknownOutcome, type CrmErrorKind } from './dentacrm';
import { crmConnected, withCrm } from './index';
import { eraseEntry, summarize, writeEntry, type MoneyPayload } from './money';

/** Taklif shuncha vaqtdan keyin eskiradi: eski kartadagi tugma bexosdan bosilib, pul yozilib ketmasin */
const DRAFT_TTL_MS = 30 * 60_000;
/** Hech narsa yozilmagani aniq bo'lgan xatolar (CRM'ga yetib bo'lmadi yoki kirish rad etildi) */
const NOT_WRITTEN: CrmErrorKind[] = ['unreachable', 'auth', 'credentials', 'license', 'protocol'];
const STATE: Record<MoneyStatus, string> = {
  draft: 'Hali tasdiqlanmagan', running: 'Hozir yozilmoqda — kuting', done: "Allaqachon CRM'ga yozilgan", cancelled: 'Bu taklif bekor qilingan',
  failed: "Bu taklif yozilmagan — yordamchidan qayta so'rang", unknown: "Natijasi noma'lum — CRM'da tekshiring", undone: 'Bu yozuv ortga qaytarilgan',
};
const INTERRUPTED = "Cerebro ish paytida to'xtab qolgan — bu yozuvning holatini DentaCRM'da tekshiring";

/** Bir biznesning pul yozuvlari navbat bilan: «bunday yozuv bormi» tekshiruvi va yozishning o'zi orasiga boshqasi kirmaydi */
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(bizId: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(bizId) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(bizId, next);
  void next.finally(() => { if (queues.get(bizId) === next) queues.delete(bizId); }).catch(() => {});
  return next;
}

const isToday = (isoTime: string | null) => !!isoTime && iso(new Date(isoTime)) === iso(new Date());
const need = (biz: BusinessRow, id: string): MoneyRow => {
  const r = moneyEntries.get(biz.id, id);
  if (!r) throw new Error('Topilmadi');
  return r;
};
const reason = (e: unknown) => (e instanceof CrmError ? e.message : "Ichki xato — yordamchidan qayta so'rang");

/** Panel va Telegram uchun ko'rinish; ortga qaytarish — faqat yozilgan kuni */
export const entryView = (r: MoneyRow): MoneyEntry => ({
  id: r.id, kind: r.kind, status: r.status, title: r.title, details: r.details, note: r.note, createdAt: r.createdAt, canUndo: r.status === 'done' && !!r.crmId && isToday(r.doneAt),
});

export function proposeEntry(biz: BusinessRow, payload: MoneyPayload): MoneyRow {
  const json = JSON.stringify(payload);
  // Egasi gapini takrorlasa yoki model ikki marta chaqirsa — yangi taklif emas, o'sha taklifning o'zi (ikki karta bosilsa ham bir marta yoziladi)
  const twin = moneyEntries.findDraft(biz.id, json, new Date(Date.now() - DRAFT_TTL_MS).toISOString());
  if (twin) return twin;
  const { title, details } = summarize(payload);
  return moneyEntries.create(biz.id, payload.kind, json, title, details);
}

/** Egasi tasdiqladi: CRM'ga yoziladi. Xato — sababi bilan (holat shunga qarab qo'yilgan) */
export async function confirmEntry(biz: BusinessRow, id: string): Promise<MoneyRow> {
  const r = need(biz, id);
  if (r.status !== 'draft') throw new Error(STATE[r.status]);
  if (Date.now() - Date.parse(r.createdAt) > DRAFT_TTL_MS) {
    moneyEntries.move(biz.id, id, ['draft'], 'cancelled', { note: "Taklif eskirdi — yordamchidan qayta so'rang" });
    throw new Error("Bu taklif eskirgan (30 daqiqadan oshdi) — yordamchidan qayta so'rang");
  }
  // Ulanmagan CRM — hech narsa yozilmagan: taklif joyida qoladi
  if (!crmConnected(biz.id)) throw new Error("DentaCRM ulanmagan — panel → Ulanishlar'da ulang va qayta bosing");
  // payload'ni faqat server yozgan (proposeEntry)
  const payload = JSON.parse(r.payload) as MoneyPayload;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const used = moneyEntries.usedSince(biz.id, midnight.toISOString());
  if (payload.amount > env.crmMaxAmount) throw new Error("Summa bitta yozuv chegarasidan katta — DentaCRM'da kiriting");
  if (used.count >= env.crmDailyMoney || used.sum + payload.amount > env.crmDailySum) throw new Error("Bugun Cerebro orqali kiritiladigan pul yozuvlari chegarasiga yetildi — qolganini DentaCRM'da kiriting");
  if (!moneyEntries.move(biz.id, id, ['draft'], 'running')) throw new Error(STATE.running);
  let crmId: string;
  try {
    crmId = await inTurn(biz.id, () => withCrm(biz.id, crm => writeEntry(crm, payload)));
  } catch (e) {
    if (isUnknownOutcome(e)) moneyEntries.move(biz.id, id, ['running'], 'unknown', { note: reason(e) });
    else if (e instanceof CrmError && NOT_WRITTEN.includes(e.kind)) moneyEntries.move(biz.id, id, ['running'], 'draft', { note: `${reason(e)} — keyinroq qayta bosing` });
    else moneyEntries.move(biz.id, id, ['running'], 'failed', { note: reason(e) });
    if (!(e instanceof CrmError)) console.error('[crm] pul yozuvi:', e);
    throw new Error(reason(e));
  }
  // Yozilgandan keyingi qadam alohida: bu yerdagi xato yozilgan yozuvni «yozilmadi» qilib qo'ymasin.
  // «unknown» ham: ishga tushishdagi tiklash shu yozuvni noma'lum deb belgilab ulgurgan bo'lsa — natija baribir yoziladi
  if (!moneyEntries.move(biz.id, id, ['running', 'unknown'], 'done', { crmId, doneAt: new Date().toISOString(), note: null })) console.error(`[crm] pul yozuvi ${id}: CRM'ga yozildi (${crmId}), lekin holati saqlanmadi`);
  return need(biz, id);
}

export function cancelEntry(biz: BusinessRow, id: string): MoneyRow {
  need(biz, id);
  if (!moneyEntries.move(biz.id, id, ['draft'], 'cancelled', { note: null })) throw new Error(STATE[need(biz, id).status]);
  return need(biz, id);
}

/** Yozilgan kuni ortga qaytarish: yozuv CRM'dan o'chiriladi */
export async function undoEntry(biz: BusinessRow, id: string): Promise<MoneyRow> {
  const r = need(biz, id);
  if (r.status !== 'done' || !r.crmId) throw new Error(STATE[r.status]);
  if (!isToday(r.doneAt)) throw new Error("Ortga qaytarish faqat yozilgan kuni mumkin — endi DentaCRM'da tuzating");
  if (!moneyEntries.move(biz.id, id, ['done'], 'running')) throw new Error(STATE.running);
  try {
    await inTurn(biz.id, () => withCrm(biz.id, crm => eraseEntry(crm, r.kind, r.crmId!)));
    moneyEntries.move(biz.id, id, ['running'], 'undone', { note: null });
  } catch (e) {
    if (isUnknownOutcome(e)) moneyEntries.move(biz.id, id, ['running'], 'unknown', { note: reason(e) });
    else moneyEntries.move(biz.id, id, ['running'], 'done', {});
    if (!(e instanceof CrmError)) console.error('[crm] ortga qaytarish:', e);
    throw new Error(reason(e));
  }
  return need(biz, id);
}

/** Server yozish paytida to'xtagan bo'lsa (ishga tushganda bir marta): natija noma'lum deb belgilanadi; qaytaradi — egasiga aytish kerak bo'lganlar */
export function recoverMoney(): MoneyRow[] {
  return moneyEntries.running().filter(r => moneyEntries.move(r.businessId, r.id, ['running'], 'unknown', { note: INTERRUPTED }))
    .map(r => ({ ...r, status: 'unknown' as const, note: INTERRUPTED }));
}
