/**
 * Direktor yozuvlari: har kungi tahlil (director_runs) va takliflar — qarorlar jurnali (director_moves).
 * Taklif holati: taklif → topshirildi (egasi tasdiqladi) → tekshirildi (muddati kelib, ko'rsatkich qayta o'lchandi); yoki rad.
 */
import { newId, sql, type Row } from '../db';
import type { MetricKey, MoveMember, Verdict } from './logic';

sql.exec(`
CREATE TABLE IF NOT EXISTS director_runs (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, day TEXT NOT NULL, summary TEXT NOT NULL, problem TEXT, evidence TEXT,
  numbers TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS director_runs_day ON director_runs (business_id, day);
CREATE TABLE IF NOT EXISTS director_moves (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, run_id TEXT NOT NULL, member TEXT NOT NULL, task TEXT NOT NULL, why TEXT NOT NULL,
  metric TEXT NOT NULL, baseline REAL NOT NULL, check_days INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  decided_at TEXT, check_at TEXT, order_id TEXT, task_id TEXT, memory_id TEXT, after REAL, verdict TEXT, checked_at TEXT
);
CREATE INDEX IF NOT EXISTS director_moves_biz ON director_moves (business_id, status);
`);

export type MoveStatus = 'taklif' | 'topshirildi' | 'rad' | 'tekshirildi';

export interface DirectorRun { id: string; day: string; summary: string; problem: string | null; evidence: string | null; numbers: string; createdAt: string }
export interface DirectorMove {
  id: string; runId: string; member: MoveMember; task: string; why: string; metric: MetricKey; baseline: number; checkDays: number;
  status: MoveStatus; createdAt: string; decidedAt: string | null; checkAt: string | null;
  orderId: string | null; taskId: string | null; memoryId: string | null; after: number | null; verdict: Verdict | null; checkedAt: string | null;
}

const toRun = (r: Row): DirectorRun => ({
  id: String(r.id), day: String(r.day), summary: String(r.summary), problem: sql.str(r.problem), evidence: sql.str(r.evidence), numbers: String(r.numbers), createdAt: String(r.created_at),
});
const toMove = (r: Row): DirectorMove => ({
  id: String(r.id), runId: String(r.run_id), member: String(r.member) as MoveMember, task: String(r.task), why: String(r.why), metric: String(r.metric) as MetricKey,
  baseline: Number(r.baseline), checkDays: Number(r.check_days), status: String(r.status) as MoveStatus, createdAt: String(r.created_at),
  decidedAt: sql.str(r.decided_at), checkAt: sql.str(r.check_at), orderId: sql.str(r.order_id), taskId: sql.str(r.task_id), memoryId: sql.str(r.memory_id),
  after: r.after === null || r.after === undefined ? null : Number(r.after), verdict: (sql.str(r.verdict) as Verdict | null), checkedAt: sql.str(r.checked_at),
});

/** Jurnalda shuncha oxirgi taklif ko'rsatiladi */
const JOURNAL = 60;

export const directorRuns = {
  add(bizId: string, day: string, summary: string, problem: { title: string; evidence: string } | null, numbers: unknown): DirectorRun {
    const id = newId(10);
    sql.run('INSERT INTO director_runs (id, business_id, day, summary, problem, evidence, numbers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, bizId, day, summary, problem?.title ?? null, problem?.evidence ?? null, JSON.stringify(numbers), sql.nowIso());
    return directorRuns.latest(bizId)!;
  },
  latest: (bizId: string) => sql.one('SELECT * FROM director_runs WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', toRun, bizId) ?? null,
  onDay: (bizId: string, day: string) => sql.one('SELECT * FROM director_runs WHERE business_id = ? AND day = ? LIMIT 1', toRun, bizId, day) ?? null,
};

export const directorMoves = {
  add(bizId: string, runId: string, m: { member: MoveMember; task: string; why: string; metric: MetricKey; baseline: number; checkDays: number }): DirectorMove {
    const id = newId(10);
    sql.run('INSERT INTO director_moves (id, business_id, run_id, member, task, why, metric, baseline, check_days, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, bizId, runId, m.member, m.task, m.why, m.metric, m.baseline, m.checkDays, 'taklif', sql.nowIso());
    return directorMoves.get(bizId, id)!;
  },
  get: (bizId: string, id: string) => sql.one('SELECT * FROM director_moves WHERE business_id = ? AND id = ?', toMove, bizId, id) ?? null,
  journal: (bizId: string) => sql.many(`SELECT * FROM director_moves WHERE business_id = ? ORDER BY created_at DESC LIMIT ${JOURNAL}`, toMove, bizId),
  /** Bitta tahlilning takliflari — yaratilish tartibida (xabardagi raqam shu tartib) */
  ofRun: (bizId: string, runId: string) => sql.many('SELECT * FROM director_moves WHERE business_id = ? AND run_id = ? ORDER BY rowid', toMove, bizId, runId),
  /** Tasdiq kutayotgan takliflar */
  waiting: (bizId: string) => sql.many("SELECT * FROM director_moves WHERE business_id = ? AND status = 'taklif' ORDER BY created_at", toMove, bizId),
  /** Topshirilgan va hali tekshirilmaganlar (modelga: shularni takrorlamasin) */
  inWork: (bizId: string) => sql.many("SELECT * FROM director_moves WHERE business_id = ? AND status = 'topshirildi' ORDER BY created_at", toMove, bizId),
  /** Tekshirish vaqti kelganlar (check_at — YYYY-MM-DD, shu kun yoki oldin) */
  due: (bizId: string, day: string) => sql.many("SELECT * FROM director_moves WHERE business_id = ? AND status = 'topshirildi' AND check_at <= ? ORDER BY check_at", toMove, bizId, day),
  /** Faqat «taklif» holatidagisi egallanadi: ikki marta bosilgan tugma ikki topshiriq yaratmasin (keyin — link) */
  claim: (bizId: string, id: string, checkAt: string) =>
    sql.run("UPDATE director_moves SET status = 'topshirildi', decided_at = ?, check_at = ? WHERE business_id = ? AND id = ? AND status = 'taklif'",
      sql.nowIso(), checkAt, bizId, id).changes > 0,
  link: (bizId: string, id: string, links: { orderId: string | null; taskId: string | null; memoryId: string | null }) =>
    sql.run('UPDATE director_moves SET order_id = ?, task_id = ?, memory_id = ? WHERE business_id = ? AND id = ?', links.orderId, links.taskId, links.memoryId, bizId, id),
  decline: (bizId: string, id: string) =>
    sql.run("UPDATE director_moves SET status = 'rad', decided_at = ? WHERE business_id = ? AND id = ? AND status = 'taklif'", sql.nowIso(), bizId, id).changes > 0,
  checked: (bizId: string, id: string, after: number, verdict: Verdict) =>
    sql.run("UPDATE director_moves SET status = 'tekshirildi', after = ?, verdict = ?, checked_at = ? WHERE business_id = ? AND id = ? AND status = 'topshirildi'",
      after, verdict, sql.nowIso(), bizId, id).changes > 0,
  /** Yangi tahlil eski tasdiqlanmagan takliflarni almashtiradi (ular endi eskirgan raqamlarga asoslangan) */
  expireWaiting: (bizId: string) => sql.run("UPDATE director_moves SET status = 'rad', decided_at = ? WHERE business_id = ? AND status = 'taklif'", sql.nowIso(), bizId).changes,
};
