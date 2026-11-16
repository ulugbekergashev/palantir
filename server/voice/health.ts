/**
 * Ovozli AI (Gemini Live) salomatligi: telefon AI va panel ovozi (tgvoice/call_live.py) har ulanishda natijani DATA_DIR/ovoz-holat.json
 * ga yozadi — {ok, error, at}. Oxirgi urinish yiqilgan bo'lsa — bu kanallar nazoratida (monitor.ts) muammo: egasiga va Hub'ga ko'rinadi.
 * 2026-11-16 da Google modelni o'zgartirib, ulanish 1007 bilan yopildi — hech kim bilmadi, qo'ng'iroqlar administratorga o'tib ketdi.
 * Fayl yo'q (ovoz ishlatilmagan) yoki oxirgisi muvaffaqiyatli — muammo yo'q.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env';

export const VOICE_STATUS_FILE = 'ovoz-holat.json';
/** Shundan eski yiqilish — eskirgan (kompyuter uzoq ishlatilmagan): muammo deb ko'rsatilmaydi */
const STALE_MS = 3 * 86_400_000;
const ERROR_MAX = 200;

/** Fayl matnidan muammo yoki null — toza funksiya (sinovda to'g'ridan-to'g'ri) */
export function voiceProblemFrom(text: string | null, now: number): string | null {
  if (!text) return null;
  let s: { ok?: unknown; error?: unknown; at?: unknown };
  try { s = JSON.parse(text) as typeof s; } catch { return null; }
  if (s.ok !== false || typeof s.at !== 'string') return null;
  const at = Date.parse(s.at);
  if (!Number.isFinite(at) || now - at > STALE_MS) return null;
  const why = typeof s.error === 'string' && s.error.trim() ? s.error.trim().slice(0, ERROR_MAX) : "sababi noma'lum";
  return `Gemini Live ulanmayapti (${why}) — telefondagi AI va paneldagi ovozli suhbat ishlamaydi, qo'ng'iroqlar administratorga o'tadi`;
}

export function voiceAiProblem(now: number): string | null {
  let text: string | null = null;
  try { text = readFileSync(join(env.dataDir, VOICE_STATUS_FILE), 'utf8'); } catch { /* ovoz ishlatilmagan */ }
  return voiceProblemFrom(text, now);
}
