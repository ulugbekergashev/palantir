/**
 * Xizmat jadvallari (db.ts dan ajratilgan): egasiga albatta yetishi kerak bo'lgan xabarlar navbati, AI xarajati,
 * server kalitlari (ulash ustasida kiritiladi)
 */
import { sql } from './db';

// Bazaning umumiy yordamchilari (db.ts): shu baza, shu ulanish
const { one, many, run, nowIso } = sql;

// ─── Egasiga xabarlar navbati ────────────────────────────────────────────────
sql.exec('CREATE TABLE IF NOT EXISTS owner_notices (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id TEXT NOT NULL, html TEXT NOT NULL, created_at TEXT NOT NULL)');

/**
 * Egasiga albatta yetishi kerak bo'lgan xabarlar (to'xtab qolgan pul yozuvi yoki qabul, yetkazilmagan mijoz xabari).
 * Bazada turadi: Telegram javob bermasa yoki server qayta tushsa ham yo'qolmaydi — jadval (scheduler.ts) yuborib, keyin o'chiradi
 */
export const notices = {
  add: (businessId: string, html: string) => run('INSERT INTO owner_notices (business_id, html, created_at) VALUES (?, ?, ?)', businessId, html, nowIso()),
  list: (limit = 20) => many('SELECT * FROM owner_notices ORDER BY id LIMIT ?', r => ({ id: Number(r.id), businessId: String(r.business_id), html: String(r.html), createdAt: String(r.created_at) }), limit),
  remove: (id: number) => run('DELETE FROM owner_notices WHERE id = ?', id),
};

// ─── AI xarajati ─────────────────────────────────────────────────────────────
sql.exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  business_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day, kind)
);
`);

export interface AiUsageRow { businessId: string; day: string; kind: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
/** Kun, biznes va ish turi bo'yicha model so'rovlari soni va tokenlar (chegara va xarajat hisobi uchun) */
export const aiUsage = {
  /** So'rov yuborilishidan OLDIN sanaladi: javobsiz qolgan yoki uzilgan so'rov ham chegaraga kiradi */
  hit: (businessId: string, day: string, kind: string) =>
    run('INSERT INTO ai_usage (business_id, day, kind, calls) VALUES (?, ?, ?, 1) ON CONFLICT(business_id, day, kind) DO UPDATE SET calls = calls + 1', businessId, day, kind),
  tokens: (businessId: string, day: string, kind: string, t: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
    run('UPDATE ai_usage SET input = input + ?, output = output + ?, cache_read = cache_read + ?, cache_write = cache_write + ? WHERE business_id = ? AND day = ? AND kind = ?', t.input, t.output, t.cacheRead, t.cacheWrite, businessId, day, kind),
  calls: (businessId: string, day: string, kind: string) => one('SELECT calls FROM ai_usage WHERE business_id = ? AND day = ? AND kind = ?', r => Number(r.calls), businessId, day, kind) ?? 0,
  since: (day: string): AiUsageRow[] => many('SELECT * FROM ai_usage WHERE day >= ? ORDER BY day DESC, business_id, kind', r => ({
    businessId: String(r.business_id), day: String(r.day), kind: String(r.kind), calls: Number(r.calls),
    input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write),
  }), day),
};

// ─── Server kalitlari (ulash ustasida kiritiladi) ────────────────────────────
sql.exec('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');

// Palantir jamoasi kirishi endi egasining roziligi bilan (http.ts, /api/login/support). Avval standart yoqiq edi — egasi o'zi tanlamagan,
// shuning uchun bir marta hammasi yopiladi (berilgan jamoa kirishlari ham bekor); xohlagan egasi Sozlamalarda qayta yoqadi
if (!one("SELECT 1 AS x FROM settings WHERE name = 'support.optin'", () => true)) {
  run('UPDATE businesses SET support_access = 0, support_until = NULL, support_ver = support_ver + 1');
  run("INSERT INTO settings (name, value, updated_at) VALUES ('support.optin', '1', ?)", nowIso());
}

/** Server bo'yicha kalitlar: qiymat shifrlangan holda (secret.ts) keladi va shunday saqlanadi */
export const settings = {
  all: () => many('SELECT * FROM settings ORDER BY name', r => ({ name: String(r.name), value: String(r.value), updatedAt: String(r.updated_at) })),
  set: (name: string, sealed: string) => run('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', name, sealed, nowIso()),
  remove: (name: string) => run('DELETE FROM settings WHERE name = ?', name),
};
