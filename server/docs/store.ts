/** Yordamchi tayyorlagan hujjatlar (db.ts dan ajratilgan) */
import type { Doc } from '../../src/types';
import { newId, sql, type Row } from '../db';

// Bazaning umumiy yordamchilari (db.ts): shu baza, shu ulanish
const { one, many, run, nowIso } = sql;

const toDoc = (r: Row): Doc => ({ id: String(r.id), title: String(r.title), kind: String(r.kind), markdown: String(r.markdown), createdAt: String(r.created_at) });

export const documents = {
  create(businessId: string, title: string, kind: string, markdown: string): Doc {
    const id = newId(10);
    run('INSERT INTO documents (id, business_id, title, kind, markdown, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, businessId, title, kind, markdown, nowIso());
    return documents.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM documents WHERE business_id = ? AND id = ?', toDoc, businessId, id),
  list: (businessId: string, limit = 200) => many('SELECT * FROM documents WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toDoc, businessId, limit),
};
