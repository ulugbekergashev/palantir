/** Pul yozuvlari: DentaCRM'ga yoziladigan to'lov va xarajatlar (db.ts dan ajratilgan; payload — faqat server yozadi: crm/actions.ts) */
import type { SQLInputValue } from 'node:sqlite';
import type { MoneyEntry, MoneyKind, MoneyStatus } from '../../src/types';
import { newId, sql, type Row } from '../db';

// Bazaning umumiy yordamchilari (db.ts): shu baza, shu ulanish
const { one, many, run, nowIso, str, num } = sql;

/** payload — CRM'ga yoziladigan ma'lumot (JSON, faqat server yozadi: crm/actions.ts) */
export type MoneyRow = Omit<MoneyEntry, 'canUndo'> & { businessId: string; payload: string; crmId: string | null; ownerMessageId: number | null; doneAt: string | null };

const lines = (raw: unknown): string[] => {
  try { const v: unknown = JSON.parse(String(raw)); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};
const toMoney = (r: Row): MoneyRow => ({
  id: String(r.id), businessId: String(r.business_id), kind: String(r.kind) as MoneyKind, payload: String(r.payload), title: String(r.title), details: lines(r.details),
  status: String(r.status) as MoneyStatus, note: str(r.note), crmId: str(r.crm_id), ownerMessageId: num(r.owner_message_id), createdAt: String(r.created_at), doneAt: str(r.done_at),
});

export const moneyEntries = {
  create(businessId: string, kind: MoneyKind, payload: string, title: string, details: string[]): MoneyRow {
    const id = newId(10);
    run('INSERT INTO money_entries (id, business_id, kind, payload, title, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, businessId, kind, payload, title, JSON.stringify(details), nowIso());
    return moneyEntries.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM money_entries WHERE business_id = ? AND id = ?', toMoney, businessId, id),
  /** Holat faqat kutilgan holatdan o'tadi (ikki marta bosilsa — bir marta yoziladi); o'zgargan bo'lsa true. patch'da berilmagan maydon o'zgarmaydi */
  move(businessId: string, id: string, from: MoneyStatus[], to: MoneyStatus, patch: { note?: string | null; crmId?: string; doneAt?: string } = {}): boolean {
    const sets = ['status = ?', ...('note' in patch ? ['note = ?'] : []), ...(patch.crmId ? ['crm_id = ?'] : []), ...(patch.doneAt ? ['done_at = ?'] : [])];
    const values: SQLInputValue[] = [to, ...('note' in patch ? [patch.note ?? null] : []), ...(patch.crmId ? [patch.crmId] : []), ...(patch.doneAt ? [patch.doneAt] : [])];
    return Number(run(`UPDATE money_entries SET ${sets.join(', ')} WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`, ...values, businessId, id, ...from).changes) > 0;
  },
  setOwnerMessage: (businessId: string, id: string, messageId: number) => run('UPDATE money_entries SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
  /** Kunlik chegara uchun: shu vaqtdan beri yozilganlar (ortga qaytarilgani ham), hozir yozilayotgan va natijasi noma'lumlar — soni va jami summasi */
  usedSince(businessId: string, sinceIso: string): { count: number; sum: number } {
    const r = one("SELECT COUNT(*) n, COALESCE(SUM(json_extract(payload, '$.amount')), 0) total FROM money_entries WHERE business_id = ? AND (done_at >= ? OR (status IN ('running', 'unknown') AND created_at >= ?))",
      x => x, businessId, sinceIso, sinceIso) ?? {};
    return { count: Number(r.n), sum: Number(r.total) };
  },
  /** Aynan shunday, hali tasdiqlanmagan taklif (bir xil gap ikki marta aytilsa ikkita karta emas — bitta yozuv) */
  findDraft: (businessId: string, payload: string, sinceIso: string) =>
    one("SELECT * FROM money_entries WHERE business_id = ? AND payload = ? AND status = 'draft' AND created_at >= ? ORDER BY created_at DESC LIMIT 1", toMoney, businessId, payload, sinceIso),
  /** Yozish boshlangan, lekin tugagani qayd etilmaganlar (server o'sha paytda to'xtagan) */
  running: () => many("SELECT * FROM money_entries WHERE status = 'running'", toMoney),
};
