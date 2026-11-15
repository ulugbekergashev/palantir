/**
 * AI administrator avtonomiyasi (L0–L4): egasi javob takliflariga qanchalik ishonadi — raqam bilan.
 *   L0 — javob o'chiq; L1 — «Men tasdiqlayman» (har javobni egasi yuboradi); L2 — «AI o'zi javob bersin», egasini kutadi (delayMin);
 *   L3 — kutmasdan o'zi javob beradi. Narx yo'q, chegirma, shikoyat kabi savollar har bosqichda egasiga boradi (replier).
 * Har hal qilingan taklif yoziladi: clean — o'zgartirmasdan yuborildi, fixed — egasi (yoki xodim) o'rniga o'zi yozdi, rejected — rad etildi.
 * L1 dan L2 ga: so'nggi WINDOW taklifdan kamida PASS tasi o'zgarishsiz — egasiga «AI o'zi javob bersinmi?» taklifi (bir tugma). Rad etsa
 * yoki javob bermasa — OFFER_AGAIN_DAYS dan keyin, ishonch hali ham yuqori bo'lsa, yana. Rejimni o'zi o'zgartirmaydi — faqat egasi
 */
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { sql } from '../db';
import type { ReplyMode } from '../../src/types';

export type Outcome = 'clean' | 'fixed' | 'rejected';
export const WINDOW = 20, PASS = 16;
const OFFER_AGAIN_DAYS = 7;
const DAY_MS = 86_400_000;

sql.exec(`CREATE TABLE IF NOT EXISTS reply_outcomes (
  business_id TEXT NOT NULL, reply_id TEXT NOT NULL, outcome TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (business_id, reply_id)
)`);
sql.exec('CREATE INDEX IF NOT EXISTS reply_outcomes_at ON reply_outcomes (business_id, at)');
sql.exec('CREATE TABLE IF NOT EXISTS autonomy_offers (business_id TEXT PRIMARY KEY, at TEXT NOT NULL)');

/** Taklif qanday hal bo'ldi — bir marta (ikkinchi yozuv e'tiborsiz: masalan, yuborilgan taklifga keyin egasi ham yozsa) */
export function recordOutcome(bizId: string, replyId: string, outcome: Outcome, at = new Date()): void {
  sql.run('INSERT OR IGNORE INTO reply_outcomes (business_id, reply_id, outcome, at) VALUES (?, ?, ?, ?)', bizId, replyId, outcome, at.toISOString());
}

/** decided — so'nggi WINDOW ichida hal qilingani, clean — ulardan o'zgarishsiz yuborilgani; ready — L2 ga o'tsa bo'ladi */
export interface Trust { decided: number; clean: number; window: number; pass: number; ready: boolean }

export function trustFrom(outcomes: Outcome[]): Trust {
  const last = outcomes.slice(0, WINDOW);
  const clean = last.filter(o => o === 'clean').length;
  return { decided: last.length, clean, window: WINDOW, pass: PASS, ready: last.length >= WINDOW && clean >= PASS };
}

export const trustOf = (bizId: string): Trust =>
  trustFrom(sql.many('SELECT outcome FROM reply_outcomes WHERE business_id = ? ORDER BY at DESC LIMIT ?', r => String(r.outcome) as Outcome, bizId, WINDOW));

/** Taklif qilish vaqti keldimi (sof): «tasdiqlayman» rejimida, ishonch yetarli, oxirgi taklifdan OFFER_AGAIN_DAYS o'tgan */
export function offerDue(t: Trust, mode: ReplyMode, lastOfferAt: string | null, now: Date): boolean {
  if (mode !== 'draft' || !t.ready) return false;
  return !lastOfferAt || now.getTime() - Date.parse(lastOfferAt) >= OFFER_AGAIN_DAYS * DAY_MS;
}

const lastOffer = (bizId: string): string | null =>
  sql.one('SELECT at FROM autonomy_offers WHERE business_id = ?', r => String(r.at), bizId) ?? null;

/** Telegram tugmasi: av|on — o'zi javob bersin, av|no — hozircha yo'q */
export const OFFER_CODE = 'av';

/**
 * Egasiga taklif (yuborilishi kerak bo'lsa — matn va tugmalar; vaqti yozib qo'yiladi). missing — Palantir hali bilmaydigan asosiy narsalar
 * (narx, ish vaqti): ular bo'lsa taklifda aytiladi — o'zi javob berganda shu savollarni baribir egasiga uzatadi
 */
export function autonomyOffer(bizId: string, mode: ReplyMode, missing: string[], now = new Date()): { html: string; keyboard: InlineKeyboardMarkup } | null {
  const t = trustOf(bizId);
  if (!offerDue(t, mode, lastOffer(bizId), now)) return null;
  sql.run('INSERT OR REPLACE INTO autonomy_offers (business_id, at) VALUES (?, ?)', bizId, now.toISOString());
  const gaps = missing.length ? `\n\nHali bilmaydi: ${missing.join(', ')} — bunday savollarni baribir sizga uzatadi.` : '';
  return {
    html: `🤖 <b>AI administrator mijozlarga o'zi javob bersinmi?</b>\n\nSo'nggi ${t.decided} ta javob taklifidan ${t.clean} tasini o'zgartirmasdan yubordingiz. `
      + `O'zi javob bersa, bemorlar kechasi ham darhol javob oladi; siz belgilangan vaqt ichida yozsangiz — sizniki ketadi. Narx yo'q, chegirma va `
      + `shikoyat kabi savollar baribir sizga keladi.${gaps}\n\nKeyin Sozlamalar → «Mijozlarga javob»da qaytarsa bo'ladi.`,
    keyboard: { inline_keyboard: [[
      { text: "✅ Ha, o'zi javob bersin", callback_data: `${OFFER_CODE}|on` },
      { text: "Hozircha yo'q", callback_data: `${OFFER_CODE}|no` },
    ]] },
  };
}
