/**
 * So'rovlar (mijoz xodimdan nimadir kutyapti: qo'ng'iroq, qabul, surish, shikoyat), ularning Telegram kartalari va xodimlar.
 * Har bir so'rov biznes id'si bilan cheklangan.
 */
import type { LeadRequest, RequestKind, RequestSource, RequestStatus, StaffMember } from '../../src/types';
import { newId, sql, type Row } from '../db';

sql.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, lead_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  phone TEXT, name TEXT, summary TEXT NOT NULL, when_text TEXT, due_at TEXT, quote TEXT, source TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, result TEXT, done_by TEXT, remind_at TEXT, reminders INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS requests_open ON requests (business_id, status, created_at);
CREATE INDEX IF NOT EXISTS requests_remind ON requests (status, remind_at);
CREATE TABLE IF NOT EXISTS request_cards (
  request_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS request_cards_req ON request_cards (request_id);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'reception',
  chat_id TEXT UNIQUE, link_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
`);
// Qo'ng'iroq mijoz kartasiga bog'lanadi (kartalar qo'shilganda ko'chadi)
sql.ensureColumns('calls', { lead_id: 'TEXT' });

const toRequest = (r: Row): LeadRequest => ({
  id: String(r.id), leadId: sql.str(r.lead_id), kind: String(r.kind) as RequestKind, status: String(r.status) as RequestStatus,
  phone: sql.str(r.phone), name: sql.str(r.name), summary: String(r.summary), whenText: sql.str(r.when_text), dueAt: sql.str(r.due_at),
  quote: sql.str(r.quote), source: String(r.source) as RequestSource, attempts: Number(r.attempts), result: sql.str(r.result),
  doneBy: sql.str(r.done_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at), closedAt: sql.str(r.closed_at),
});

export interface NewRequest {
  leadId: string | null; kind: RequestKind; phone: string | null; name: string | null; summary: string;
  whenText: string | null; dueAt: string | null; quote: string | null; source: RequestSource;
  /** Mahalliy vaqt: birinchi eslatma (so'rov hal qilinmagan bo'lsa) */
  remindAt: string;
}

export const requests = {
  create(businessId: string, v: NewRequest): LeadRequest {
    const id = newId(10), now = sql.nowIso();
    sql.run(`INSERT INTO requests (id, business_id, lead_id, kind, phone, name, summary, when_text, due_at, quote, source, remind_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, businessId, v.leadId, v.kind, v.phone, v.name, v.summary, v.whenText, v.dueAt, v.quote, v.source, v.remindAt, now, now);
    return requests.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => sql.one('SELECT * FROM requests WHERE business_id = ? AND id = ?', toRequest, businessId, id),
  /** Shu mijozning ochiq so'rovlari (yangisi oxirida) */
  openFor: (businessId: string, leadId: string) =>
    sql.many("SELECT * FROM requests WHERE business_id = ? AND lead_id = ? AND status = 'open' ORDER BY created_at", toRequest, businessId, leadId),
  list: (businessId: string, which: 'open' | 'closed' | 'all' = 'all', limit = 200) =>
    sql.many(`SELECT * FROM requests WHERE business_id = ? AND (? = 'all' OR (? = 'open') = (status = 'open'))
      ORDER BY status = 'open' DESC, CASE WHEN status = 'open' THEN created_at END ASC, COALESCE(closed_at, created_at) DESC LIMIT ?`,
    toRequest, businessId, which, which, limit),
  forLead: (businessId: string, leadId: string, limit = 50) =>
    sql.many('SELECT * FROM requests WHERE business_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT ?', toRequest, businessId, leadId, limit),
  openCount: (businessId: string) => Number(sql.one("SELECT COUNT(*) n FROM requests WHERE business_id = ? AND status = 'open'", r => r.n, businessId) ?? 0),
  /** Mijoz so'rovni aniqladi (boshqa raqam, boshqa vaqt): ochiq so'rov yangilanadi */
  revise(businessId: string, id: string, patch: Partial<Pick<LeadRequest, 'phone' | 'name' | 'summary' | 'whenText' | 'dueAt' | 'quote'>> & { remindAt?: string }): LeadRequest | undefined {
    const cur = requests.get(businessId, id);
    if (!cur || cur.status !== 'open') return cur;
    const pick = <K extends keyof typeof patch>(k: K, old: unknown) => (patch[k] !== undefined ? patch[k] : old) as string | null;
    sql.run(`UPDATE requests SET phone = ?, name = ?, summary = ?, when_text = ?, due_at = ?, quote = ?, remind_at = COALESCE(?, remind_at), reminders = CASE WHEN ? IS NULL THEN reminders ELSE 0 END, updated_at = ?
      WHERE business_id = ? AND id = ?`,
      pick('phone', cur.phone), pick('name', cur.name), pick('summary', cur.summary), pick('whenText', cur.whenText), pick('dueAt', cur.dueAt), pick('quote', cur.quote),
      patch.remindAt ?? null, patch.remindAt ?? null, sql.nowIso(), businessId, id);
    return requests.get(businessId, id);
  },
  /** Yopadi (faqat ochiq bo'lsa): ikki xodim bir paytda bossa — bittasi yopadi, ikkinchisiga «allaqachon» */
  close(businessId: string, id: string, status: Exclude<RequestStatus, 'open'>, result: string | null, by: string | null): boolean {
    const now = sql.nowIso();
    const r = sql.run(`UPDATE requests SET status = ?, result = COALESCE(?, result), done_by = ?, closed_at = ?, remind_at = NULL, updated_at = ?
      WHERE business_id = ? AND id = ? AND status = 'open'`, status, result, by, now, now, businessId, id);
    return Number(r.changes) > 0;
  },
  /** Qo'ng'iroq qilindi, ko'tarmadi: urinish sanaladi, keyingi eslatma — retryAt (mahalliy vaqt) */
  attempt(businessId: string, id: string, by: string, retryAt: string | null): boolean {
    const r = sql.run(`UPDATE requests SET attempts = attempts + 1, done_by = ?, remind_at = ?, reminders = 0, updated_at = ?
      WHERE business_id = ? AND id = ? AND status = 'open'`, by, retryAt, sql.nowIso(), businessId, id);
    return Number(r.changes) > 0;
  },
  /** Xodimning izohi («ertaga qayta qo'ng'iroq qiling dedi») — natijaga qo'shiladi */
  addResult(businessId: string, id: string, text: string, by: string): void {
    sql.run(`UPDATE requests SET result = CASE WHEN result IS NULL OR result = '' THEN ? ELSE substr(result || ' · ' || ?, 1, 1000) END, done_by = ?, updated_at = ?
      WHERE business_id = ? AND id = ?`, text, text, by, sql.nowIso(), businessId, id);
  },
  /** Eslatish vaqti kelgan ochiq so'rovlar (mahalliy vaqt satri solishtiriladi) */
  due: (localNow: string) =>
    sql.many(`SELECT q.*, q.business_id AS biz, q.reminders AS sent FROM requests q JOIN businesses b ON b.id = q.business_id
      WHERE b.active = 1 AND q.status = 'open' AND q.remind_at IS NOT NULL AND q.remind_at <= ? ORDER BY q.remind_at LIMIT 50`,
    r => ({ businessId: String(r.biz), reminders: Number(r.sent), request: toRequest(r) }), localNow),
  /** Eslatma ketdi: keyingisi next'da (null — boshqa eslatilmaydi) */
  reminded: (businessId: string, id: string, next: string | null) =>
    sql.run('UPDATE requests SET reminders = reminders + 1, remind_at = ? WHERE business_id = ? AND id = ?', next, businessId, id),
};

/** So'rovning Telegram kartalari: holati o'zgarsa hammasi yangilanadi (egasi va har bir xodimda) */
export const requestCards = {
  add: (requestId: string, chatId: string, messageId: number) =>
    sql.run('INSERT OR REPLACE INTO request_cards (request_id, chat_id, message_id) VALUES (?, ?, ?)', requestId, chatId, messageId),
  of: (requestId: string) => sql.many('SELECT chat_id, message_id FROM request_cards WHERE request_id = ?', r => ({ chatId: String(r.chat_id), messageId: Number(r.message_id) }), requestId),
  /** Kartaga «Reply» qilindi — qaysi so'rov */
  byMessage: (chatId: string, messageId: number) =>
    sql.one('SELECT request_id FROM request_cards WHERE chat_id = ? AND message_id = ?', r => String(r.request_id), chatId, messageId) ?? null,
};

sql.exec(`CREATE TABLE IF NOT EXISTS reply_cards (reply_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY (chat_id, message_id));
CREATE INDEX IF NOT EXISTS reply_cards_reply ON reply_cards (reply_id);`);

/** Javob taklifi kartalari (egasi va xodimlarda): «Yuborish» bosilsa — hammasi yangilanadi; kartaga «Reply» — qaysi taklif o'rniga yozilgani */
export const replyCards = {
  add: (replyId: string, chatId: string, messageId: number) =>
    sql.run('INSERT OR REPLACE INTO reply_cards (reply_id, chat_id, message_id) VALUES (?, ?, ?)', replyId, chatId, messageId),
  of: (replyId: string) => sql.many('SELECT chat_id, message_id FROM reply_cards WHERE reply_id = ?', r => ({ chatId: String(r.chat_id), messageId: Number(r.message_id) }), replyId),
  byMessage: (chatId: string, messageId: number) =>
    sql.one('SELECT reply_id FROM reply_cards WHERE chat_id = ? AND message_id = ?', r => String(r.reply_id), chatId, messageId) ?? null,
};

export interface StaffRow extends StaffMember { businessId: string; chatId: string | null; linkCode: string }
const toStaff = (r: Row): StaffRow => ({
  id: String(r.id), businessId: String(r.business_id), name: String(r.name), role: 'reception', chatId: sql.str(r.chat_id),
  linkCode: String(r.link_code), linked: r.chat_id != null, createdAt: String(r.created_at),
});

export const staff = {
  /** Yangi xodim: Telegram'da havolani bosgach ulanadi */
  create(businessId: string, name: string): StaffRow {
    const id = newId(8);
    sql.run('INSERT INTO staff (id, business_id, name, link_code, created_at) VALUES (?, ?, ?, ?, ?)', id, businessId, name, newId(12), sql.nowIso());
    return sql.one('SELECT * FROM staff WHERE id = ?', toStaff, id)!;
  },
  list: (businessId: string) => sql.many('SELECT * FROM staff WHERE business_id = ? ORDER BY created_at', toStaff, businessId),
  linked: (businessId: string) => sql.many('SELECT * FROM staff WHERE business_id = ? AND chat_id IS NOT NULL ORDER BY created_at', toStaff, businessId),
  byCode: (code: string) => sql.one('SELECT * FROM staff WHERE link_code = ?', toStaff, code),
  byChat: (chatId: string) => sql.one('SELECT * FROM staff WHERE chat_id = ?', toStaff, chatId),
  /** Havola bosildi: shu Telegram chat shu xodimniki (boshqa xodimga ulangan bo'lsa — o'sha bo'shatiladi) */
  link(id: string, chatId: string, name: string | null): void {
    sql.tx(() => {
      sql.run('UPDATE staff SET chat_id = NULL WHERE chat_id = ? AND id <> ?', chatId, id);
      sql.run('UPDATE staff SET chat_id = ?, name = COALESCE(?, name), link_code = ? WHERE id = ?', chatId, name, newId(12), id);
    });
  },
  remove: (businessId: string, id: string) => sql.run('DELETE FROM staff WHERE business_id = ? AND id = ?', businessId, id),
};
