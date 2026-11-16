/**
 * Rekruter (HR): vakansiyalar va nomzodlar. Har yozuv biznes id'si bilan cheklangan.
 *   vacancy — egasi aytgan ish o'rni: e'lon matni (AI yozgan, egasi ko'rib joylaydi), nomzodga beriladigan savollar, talablar;
 *             code — botdagi havola (t.me/<bot>?start=v-<code>)
 *   candidate — havolani bosgan odam: savollarga javoblari, raqami, AI bahosi (1–10) va qisqa xulosasi; holati
 */
import { newId, sql, type Row } from '../db';

sql.exec(`
CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, questions TEXT NOT NULL,
  needs TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS vacancies_biz ON vacancies (business_id, status, created_at);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, vacancy_id TEXT NOT NULL, chat_id TEXT NOT NULL, name TEXT, username TEXT, phone TEXT,
  answers TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'asking', score INTEGER, summary TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (vacancy_id, chat_id)
);
CREATE INDEX IF NOT EXISTS candidates_vac ON candidates (business_id, vacancy_id, created_at);
CREATE INDEX IF NOT EXISTS candidates_chat ON candidates (chat_id, updated_at);
`);

export type VacancyStatus = 'open' | 'closed';
/**
 * asking — savollarga javob beryapti; phone — raqamini kutyapmiz; scoring — AI baholayapti; new — egasi hali ko'rmagan;
 * invited — suhbatga chaqirildi; rejected — rad etildi
 */
export type CandidateStatus = 'asking' | 'phone' | 'scoring' | 'new' | 'invited' | 'rejected';

export interface Vacancy {
  id: string; businessId: string; title: string; text: string; questions: string[]; needs: string; status: VacancyStatus; code: string;
  createdAt: string; closedAt: string | null;
}
export interface Candidate {
  id: string; businessId: string; vacancyId: string; chatId: string; name: string | null; username: string | null; phone: string | null;
  answers: string[]; status: CandidateStatus; score: number | null; summary: string | null; createdAt: string; updatedAt: string;
}

/** Bitta vakansiyada eslab qolinadigan nomzodlar (spam havola tarqalsa ham baza to'lmasin) */
export const MAX_CANDIDATES = 300;
/** Ochiq vakansiyalar soni (bir biznesda) */
export const MAX_OPEN_VACANCIES = 10;

const strings = (v: unknown): string[] => {
  try { const a: unknown = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
};
const toVacancy = (r: Row): Vacancy => ({
  id: String(r.id), businessId: String(r.business_id), title: String(r.title), text: String(r.text), questions: strings(r.questions),
  needs: String(r.needs ?? ''), status: String(r.status) as VacancyStatus, code: String(r.code), createdAt: String(r.created_at), closedAt: sql.str(r.closed_at),
});
const toCandidate = (r: Row): Candidate => ({
  id: String(r.id), businessId: String(r.business_id), vacancyId: String(r.vacancy_id), chatId: String(r.chat_id), name: sql.str(r.name),
  username: sql.str(r.username), phone: sql.str(r.phone), answers: strings(r.answers), status: String(r.status) as CandidateStatus,
  score: sql.num(r.score), summary: sql.str(r.summary), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

export const vacancies = {
  create(businessId: string, v: { title: string; text: string; questions: string[]; needs: string }): Vacancy {
    const id = newId(10);
    sql.run('INSERT INTO vacancies (id, business_id, title, text, questions, needs, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, v.title, v.text, JSON.stringify(v.questions), v.needs, newId(10), sql.nowIso());
    return sql.one('SELECT * FROM vacancies WHERE id = ?', toVacancy, id)!;
  },
  get: (businessId: string, id: string) => sql.one('SELECT * FROM vacancies WHERE business_id = ? AND id = ?', toVacancy, businessId, id),
  byCode: (code: string) => sql.one('SELECT * FROM vacancies WHERE code = ?', toVacancy, code),
  list: (businessId: string, status: VacancyStatus | 'all' = 'all', limit = 30) => (status === 'all'
    ? sql.many('SELECT * FROM vacancies WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toVacancy, businessId, limit)
    : sql.many('SELECT * FROM vacancies WHERE business_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?', toVacancy, businessId, status, limit)),
  openCount: (businessId: string) => Number(sql.one("SELECT COUNT(*) AS n FROM vacancies WHERE business_id = ? AND status = 'open'", r => r.n, businessId) ?? 0),
  close: (businessId: string, id: string): boolean =>
    Number(sql.run("UPDATE vacancies SET status = 'closed', closed_at = ? WHERE business_id = ? AND id = ? AND status = 'open'", sql.nowIso(), businessId, id).changes) > 0,
  setText: (businessId: string, id: string, text: string) => { sql.run('UPDATE vacancies SET text = ? WHERE business_id = ? AND id = ?', text, businessId, id); },
};

export const candidates = {
  /** Havolani bosdi. Shu vakansiyaga avval kelgan bo'lsa — o'sha yozuv (qaytadan boshlamaydi). Chegara to'lsa — null */
  start(v: Vacancy, chatId: string, name: string | null, username: string | null): Candidate | null {
    const old = sql.one('SELECT * FROM candidates WHERE vacancy_id = ? AND chat_id = ?', toCandidate, v.id, chatId);
    if (old) return old;
    if (Number(sql.one('SELECT COUNT(*) AS n FROM candidates WHERE vacancy_id = ?', r => r.n, v.id) ?? 0) >= MAX_CANDIDATES) return null;
    const id = newId(10), now = sql.nowIso();
    sql.run('INSERT INTO candidates (id, business_id, vacancy_id, chat_id, name, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, v.businessId, v.id, chatId, name, username, now, now);
    return sql.one('SELECT * FROM candidates WHERE id = ?', toCandidate, id)!;
  },
  get: (businessId: string, id: string) => sql.one('SELECT * FROM candidates WHERE business_id = ? AND id = ?', toCandidate, businessId, id),
  /** Bu chatda savollarga javob berayotgan (yoki raqamini kutayotgan) nomzod — eng oxirgisi */
  active: (chatId: string) => sql.one("SELECT * FROM candidates WHERE chat_id = ? AND status IN ('asking', 'phone') ORDER BY updated_at DESC LIMIT 1", toCandidate, chatId),
  /** Bu chat biror vakansiyaga nomzod bo'lganmi (bemor emas — keyingi yozganlari ham mijoz xabari bo'lib tushmasin) */
  any: (chatId: string) => sql.one('SELECT * FROM candidates WHERE chat_id = ? ORDER BY updated_at DESC LIMIT 1', toCandidate, chatId),
  list: (businessId: string, vacancyId: string) =>
    sql.many('SELECT * FROM candidates WHERE business_id = ? AND vacancy_id = ? ORDER BY COALESCE(score, -1) DESC, created_at', toCandidate, businessId, vacancyId),
  count: (businessId: string, vacancyId: string, statuses: CandidateStatus[]) => Number(sql.one(
    `SELECT COUNT(*) AS n FROM candidates WHERE business_id = ? AND vacancy_id = ? AND status IN (${statuses.map(() => '?').join(', ')})`, r => r.n,
    businessId, vacancyId, ...statuses) ?? 0),
  answer(id: string, answers: string[], status: CandidateStatus): void {
    sql.run('UPDATE candidates SET answers = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify(answers), status, sql.nowIso(), id);
  },
  setPhone: (id: string, phone: string, name: string | null) => {
    // Ismi havoladan (Telegram profili) bor bo'lsa — o'sha; kontakt kartasidagi ism faqat bo'sh bo'lsa
    sql.run("UPDATE candidates SET phone = ?, name = COALESCE(name, ?), status = 'scoring', updated_at = ? WHERE id = ?", phone, name, sql.nowIso(), id);
  },
  scored: (id: string, score: number | null, summary: string) => {
    sql.run("UPDATE candidates SET score = ?, summary = ?, status = 'new', updated_at = ? WHERE id = ?", score, summary, sql.nowIso(), id);
  },
  /** Egasi qaror qildi: faqat ko'rilmagan nomzod (ikki marta bosilsa — ikkinchisi hech narsa qilmaydi) */
  decide: (businessId: string, id: string, status: 'invited' | 'rejected'): boolean =>
    Number(sql.run("UPDATE candidates SET status = ?, updated_at = ? WHERE business_id = ? AND id = ? AND status = 'new'", status, sql.nowIso(), businessId, id).changes) > 0,
};
