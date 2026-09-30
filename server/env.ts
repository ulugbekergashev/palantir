import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

// .env — mahalliy ishga tushirish uchun (hostingda o'zgaruvchilar panelda beriladi)
if (existsSync('.env')) process.loadEnvFile('.env');

const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

/** Sessiya imzosi kaliti: berilmagan bo'lsa bir marta yaratiladi va data papkasida saqlanadi */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = join(dataDir, 'session.secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

export const env = {
  port: Number(process.env.PORT) || 3200,
  dataDir,
  dbFile: process.env.DB_FILE || join(dataDir, 'cerebro.db'),
  /** @BotFather tokeni. Bo'lmasa — panel ishlaydi, Telegram o'chiq */
  botToken: process.env.BOT_TOKEN || '',
  /** Faqat sinov uchun: soxta Telegram API manzili */
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || undefined,
  /** Claude kaliti — yordamchining "miyasi" */
  aiEnabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.AI_DISABLED !== '1',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  /** Internetdan qidirish (Claude web search). 0 — o'chiq */
  webSearch: process.env.WEB_SEARCH !== '0',
  /** Ovozli xabar → matn: Gemini (o'zbekchani yaxshi taniydi), zaxira — Groq Whisper */
  geminiKey: process.env.GEMINI_API_KEY || '',
  groqKey: process.env.GROQ_API_KEY || '',
  /** Faqat sinov uchun: soxta ovoz xizmati manzillari */
  geminiSttUrl: process.env.GEMINI_STT_URL || 'https://generativelanguage.googleapis.com/v1beta/interactions',
  groqSttUrl: process.env.GROQ_STT_URL || 'https://api.groq.com/openai/v1/audio/transcriptions',
  /** Admin panel paroli (bizneslarni qo'shish). Bo'sh — admin kirishi yopiq */
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: sessionSecret(),
  /** Jadval tekshiruvi oralig'i (eslatmalar, ertalabki xulosa) */
  tickMs: Number(process.env.TICK_MS) || 30_000,
  /** Ertalabki xulosa soati (Toshkent vaqti) */
  morningHour: process.env.MORNING_HOUR ? Number(process.env.MORNING_HOUR) : 8,
};

export const voiceEnabled = () => !!(env.geminiKey || env.groqKey);
