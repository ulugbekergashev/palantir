/**
 * Sinov jarayonining o'zi server modullarini (baza, env) import qilsa — shu fayl BIRINCHI import bo'lsin: haqiqiy .env va data/
 * o'rniga vaqtinchalik papka. ESM importlarni yozilgan tartibda bajaradi, shuning uchun bu keyingi importlardan oldin ishlaydi.
 * Busiz sinov dasturchining haqiqiy bazasini (DATA_DIR=./data) ochib, unda migratsiya va yozuvlarni bajarardi.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'palantir-sinov-'));
process.env.DOTENV = '0';
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET ||= 'sinov-secret';
process.on('exit', () => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: baza hali band */ }
});
