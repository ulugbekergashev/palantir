/** Ikkinchi miya: savol-javoblar, egasining tuzatishlari, hujjat namunalari va eslab qolingan faktlar (db.ts dan ajratilgan) */
import type { Knowledge, KnowledgeKind, Note } from '../../src/types';
import { newId, sql, type Row } from '../db';

// Bazaning umumiy yordamchilari (db.ts): shu baza, shu ulanish
const { one, many, run, nowIso } = sql;

sql.exec(`
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, kind TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
  status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_biz ON knowledge (business_id, kind);
`);

const toKnowledge = (r: Row): Knowledge => ({
  id: String(r.id), kind: String(r.kind) as KnowledgeKind, question: String(r.question), answer: String(r.answer), status: r.status === 'suggested' ? 'suggested' : 'active',
  source: String(r.source), createdAt: String(r.created_at),
});

/** Savol-javoblar, egasining tuzatishlari va hujjat namunalari (faktlar — notes jadvalida) */
export const knowledge = {
  add(businessId: string, k: Omit<Knowledge, 'id' | 'createdAt'>): Knowledge {
    const id = newId(10), createdAt = nowIso();
    run('INSERT INTO knowledge (id, business_id, kind, question, answer, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, businessId, k.kind, k.question, k.answer, k.status, k.source, createdAt);
    return { id, ...k, createdAt };
  },
  get: (businessId: string, id: string) => one('SELECT * FROM knowledge WHERE business_id = ? AND id = ?', toKnowledge, businessId, id) ?? null,
  list: (businessId: string, kind?: KnowledgeKind) =>
    many(`SELECT * FROM knowledge WHERE business_id = ?${kind ? ' AND kind = ?' : ''} ORDER BY created_at, rowid`, toKnowledge, ...(kind ? [businessId, kind] : [businessId])),
  update(businessId: string, id: string, patch: Partial<Pick<Knowledge, 'question' | 'answer' | 'status'>>): Knowledge | null {
    const old = knowledge.get(businessId, id);
    if (!old) return null;
    const next = { ...old, ...patch };
    run('UPDATE knowledge SET question = ?, answer = ?, status = ? WHERE business_id = ? AND id = ?', next.question, next.answer, next.status, businessId, id);
    return next;
  },
  remove: (businessId: string, id: string) => Number(run('DELETE FROM knowledge WHERE business_id = ? AND id = ?', businessId, id).changes) > 0,
  /** Egasi javob bermagan eski takliflar o'chadi (kutayotganlar ro'yxati to'lib, o'rganish to'xtab qolmasin) */
  expireSuggested: (businessId: string, beforeIso: string) => run("DELETE FROM knowledge WHERE business_id = ? AND status = 'suggested' AND created_at < ?", businessId, beforeIso),
  /** Shu turdagi eng yangi `keep` tasi qoladi, eskilari o'chadi */
  trim: (businessId: string, kind: KnowledgeKind, keep: number) =>
    run('DELETE FROM knowledge WHERE business_id = ? AND kind = ? AND id NOT IN (SELECT id FROM knowledge WHERE business_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)', businessId, kind, businessId, kind, keep),
};

// ─── Eslab qolingan faktlar ───────────────────────────────────────────────────

const toNote = (r: Row): Note => ({ id: String(r.id), text: String(r.text), createdAt: String(r.created_at) });

export const notes = {
  add(businessId: string, text: string): Note {
    const id = newId(8);
    run('INSERT INTO notes (id, business_id, text, created_at) VALUES (?, ?, ?, ?)', id, businessId, text, nowIso());
    return { id, text, createdAt: nowIso() };
  },
  list: (businessId: string) => many('SELECT * FROM notes WHERE business_id = ? ORDER BY created_at', toNote, businessId),
  remove: (businessId: string, id: string) => Number(run('DELETE FROM notes WHERE business_id = ? AND id = ?', businessId, id).changes) > 0,
};
