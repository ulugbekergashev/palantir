/** Anketalar: o'rnatishdan oldin egasi to'ldiradi (db.ts dan ajratilgan) */
import { sql, type Row } from '../db';

// Bazaning umumiy yordamchilari (db.ts): shu baza, shu ulanish
const { one, many, run, nowIso, str } = sql;

sql.exec(`
CREATE TABLE IF NOT EXISTS anketa (
  code TEXT PRIMARY KEY, label TEXT NOT NULL, industry TEXT NOT NULL, data TEXT, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
`);

export interface AnketaRow { code: string; label: string; industry: string; data: string | null; status: string; createdAt: string; updatedAt: string; expiresAt: string }
const toAnketa = (r: Row): AnketaRow => ({
  code: String(r.code), label: String(r.label), industry: String(r.industry), data: str(r.data), status: String(r.status),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), expiresAt: String(r.expires_at),
});
export const anketas = {
  create(code: string, label: string, industry: string, expiresAt: string): AnketaRow {
    run('INSERT INTO anketa (code, label, industry, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', code, label, industry, nowIso(), nowIso(), expiresAt);
    return anketas.get(code)!;
  },
  get: (code: string) => one('SELECT * FROM anketa WHERE code = ?', toAnketa, code),
  list: () => many('SELECT * FROM anketa ORDER BY created_at DESC LIMIT 200', toAnketa),
  save: (code: string, data: string, status: string) => run('UPDATE anketa SET data = ?, status = ?, updated_at = ? WHERE code = ?', data, status, nowIso(), code),
  remove: (code: string) => run('DELETE FROM anketa WHERE code = ?', code),
  /** Muddati o'tganlari o'chadi: anketada manzil, telefon, narxlar bor — keraksiz turmasin */
  expire: () => run('DELETE FROM anketa WHERE expires_at < ?', nowIso()),
};
