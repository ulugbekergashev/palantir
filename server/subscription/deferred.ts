/**
 * Limit tufayli keyinga qolgan egasining ishlari (pressure.ts): navbat ochilganda Palantir ularni o'zi bajaradi va natijani egasiga
 * yuboradi — egasi qayta so'ramaydi (2026-11-16). Ikki xil:
 *   own — egasining butun gapi (navbat butunlay yopiq edi): o'sha gap yordamchiga qayta beriladi;
 *   tool — gapdagi bitta katta asbob (video, brend-buk, hujjat): faqat shu asbob o'sha kirish bilan, MODELSIZ qayta bajariladi —
 *          gapning bajarilgan qismi takrorlanmaydi, limit ortiqcha yeyilmaydi, kirish (begona matn bo'lishi mumkin) model ko'rsatmasiga aylanmaydi.
 * Jadvaldagi, qo'ng'iroqdagi va Palantir o'zi yozgan so'rovlar navbatga qo'yilmaydi (agent.ts deferrable).
 * Bajarish «olinadi» (claim) va tugagach o'chiriladi: server yarmida o'chsa, ish 30 daqiqadan keyin qayta olinadi (yo'qolmaydi).
 */
import { createHash } from 'node:crypto';
import { newId, sql } from '../db';
import type { Lane } from './pressure';

export interface DeferredAsk {
  id: string; businessId: string; channel: 'telegram' | 'web';
  /** own: egasining gapi; tool: asbob kaliti (dedupe uchun) */
  text: string; display: string; lane: Lane; until: number;
  own: boolean; tool: string | null; input: string | null;
  attempts: number; createdAt: string;
  /** Hozir bajarilyaptimi (olingan, hali tugamagan) */
  claimed: boolean;
}

/** Bir biznesda navbatdagi ishlar chegarasi */
const MAX_PER_BUSINESS = 10;
/** Shuncha urinishdan keyin (har safar yana limitga tushdi) — egasiga «bajarib bo'lmadi» */
export const MAX_ATTEMPTS = 3;
/** Navbatga birinchi qo'yilgandan shuncha vaqt o'tsa — bajarilmaydi (eskirgan «bugungi» ish keyingi kunlarda chiqmasin) */
const EXPIRE_MS = 2 * 24 * 3_600_000;
/** Olingan ish shuncha vaqtda tugamasa (server o'chgan) — qayta olinadi */
const CLAIM_MS = 30 * 60_000;

sql.exec(`CREATE TABLE IF NOT EXISTS deferred_asks (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, display TEXT NOT NULL,
  lane TEXT NOT NULL, until INTEGER NOT NULL, own INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deferred_asks_until ON deferred_asks (until);`);
sql.ensureColumns('deferred_asks', { tool: 'TEXT', input: 'TEXT', attempts: 'INTEGER NOT NULL DEFAULT 0', claimed_at: 'INTEGER' });

const toAsk = (r: Record<string, unknown>): DeferredAsk => ({
  id: String(r.id), businessId: String(r.business_id), channel: r.channel === 'web' ? 'web' : 'telegram', text: String(r.text), display: String(r.display),
  lane: String(r.lane) as Lane, until: Number(r.until), own: Number(r.own) === 1, tool: sql.str(r.tool), input: sql.str(r.input),
  attempts: Number(r.attempts ?? 0), createdAt: String(r.created_at), claimed: r.claimed_at !== null && r.claimed_at !== undefined,
});

/** Asbob ishining kaliti: nomi va kirishning xeshi (ikki xil kirish bir-birini bosib ketmasin) */
export const toolKey = (name: string, input: unknown): string => `tool:${name}:${createHash('sha256').update(JSON.stringify(input) ?? '').digest('hex').slice(0, 16)}`;

type NewAsk = Pick<DeferredAsk, 'businessId' | 'channel' | 'text' | 'display' | 'lane' | 'until' | 'own'> & Partial<Pick<DeferredAsk, 'tool' | 'input' | 'attempts' | 'createdAt'>>;

export const deferred = {
  /** Navbatga qo'yadi. Xuddi shu ish bo'lsa — faqat vaqti yangilanadi (qo'yilgan vaqti va urinishlari saqlanadi). Qaytadi: navbatdami */
  add(a: NewAsk): boolean {
    const same = sql.one('SELECT id FROM deferred_asks WHERE business_id = ? AND text = ?', r => String(r.id), a.businessId, a.text);
    if (same) {
      sql.run('UPDATE deferred_asks SET until = ?, lane = ?, claimed_at = NULL WHERE id = ?', a.until, a.lane, same);
      return true;
    }
    const count = sql.one('SELECT COUNT(*) AS n FROM deferred_asks WHERE business_id = ?', r => Number(r.n), a.businessId) ?? 0;
    if (count >= MAX_PER_BUSINESS) return false;
    sql.run('INSERT INTO deferred_asks (id, business_id, channel, text, display, lane, until, own, tool, input, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(12), a.businessId, a.channel, a.text, a.display, a.lane, a.until, a.own ? 1 : 0, a.tool ?? null, a.input ?? null, a.attempts ?? 0, a.createdAt ?? sql.nowIso());
    return true;
  },
  /** Vaqti kelgan va hozir hech kim bajarmayotganlari (eskirganlari o'chiriladi) */
  due(now = Date.now()): DeferredAsk[] {
    sql.run('DELETE FROM deferred_asks WHERE created_at < ?', new Date(now - EXPIRE_MS).toISOString());
    return sql.many('SELECT * FROM deferred_asks WHERE until <= ? AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY created_at', toAsk, now, now - CLAIM_MS);
  },
  /** Bajarishga olinadi (urinish sanaladi): ikki aylanish bir ishni birga bajarmasin. false — boshqasi olgan */
  claim: (id: string, now = Date.now()): boolean =>
    Number(sql.run('UPDATE deferred_asks SET claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)', now, id, now - CLAIM_MS).changes) > 0,
  /** Bajarib bo'lindi (yoki voz kechildi) */
  done: (id: string): void => { sql.run('DELETE FROM deferred_asks WHERE id = ?', id); },
  /** Egasi o'zi qayta so'radi va bajarildi — navbatdagi nusxasi kerak emas */
  dropText: (bizId: string, text: string): void => { sql.run('DELETE FROM deferred_asks WHERE business_id = ? AND text = ?', bizId, text); },
  byText: (bizId: string, text: string): DeferredAsk | null => sql.one('SELECT * FROM deferred_asks WHERE business_id = ? AND text = ?', toAsk, bizId, text) ?? null,
  list: (bizId: string): DeferredAsk[] => sql.many('SELECT * FROM deferred_asks WHERE business_id = ? ORDER BY created_at', toAsk, bizId),
};
