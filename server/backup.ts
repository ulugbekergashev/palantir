/**
 * Zaxira nusxa: kuniga bir marta baza (izchil nusxa), «ikkinchi miya» papkasi va maxfiy kalit BACKUP_DIR/YYYY-MM-DD ga ko'chiriladi.
 * Oxirgi BACKUP_KEEP kun saqlanadi. Tiklash: server to'xtatiladi, DATA_DIR dagi palantir.db-wal va palantir.db-shm o'chiriladi
 * (eski jurnal yangi baza ustiga «qayta ijro» qilinmasin), keyin shu papkadagi uchta narsa DATA_DIR ga qaytariladi.
 * Kalit (session.secret) ham kerak: usiz bazadagi ulanish parollari (DentaCRM, Telegram seansi) ochilmaydi.
 * Hub kodi bo'lsa — shu nusxa shifrlanib hubga ham yuboriladi (offsite.ts); yuborilmasa — har soatlik tekshiruvda qayta uriniladi.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { iso } from '../src/lib/week';
import { copyDb } from './db';
import { env } from './env';
import { sendOffsite } from './offsite';

const FIRST_MS = Number(process.env.BACKUP_FIRST_MS) || 2 * 60_000, CHECK_MS = 60 * 60_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** O'zimiz yozgan nusxa: ichida baza bor (avvalgi nusxalarda — cerebro.db, eski nom) */
const isBackup = (day: string) => DAY.test(day) && ['palantir.db', 'cerebro.db'].some(f => existsSync(join(env.backupDir, day, f))); // eski nom

/** Bugungi nusxa hali bo'lmasa — oladi. Qaytaradi: yangi nusxa papkasi yoki null (bor edi) */
export function backupNow(now = new Date()): string | null {
  const today = iso(now), dest = join(env.backupDir, today);
  if (existsSync(dest)) return null;
  // Avval vaqtinchalik papkaga: yarim yozilgan nusxa «tayyor» bo'lib ko'rinmasin
  const tmp = join(env.backupDir, `.yozilmoqda-${today}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  copyDb(join(tmp, 'palantir.db'));
  const vault = join(env.dataDir, 'miya'), secret = join(env.dataDir, 'session.secret');
  // Havolalar ko'chirilmaydi: papkaga tashlangan yorliq boshqa diskdagi narsani nusxaga tortib kelmasin
  if (existsSync(vault)) cpSync(vault, join(tmp, 'miya'), { recursive: true, filter: src => !lstatSync(src).isSymbolicLink() });
  if (existsSync(secret)) cpSync(secret, join(tmp, 'session.secret'));
  renameSync(tmp, dest);
  prune();
  return dest;
}

function prune(): void {
  // Faqat o'zimiz yozgan nusxalar: BACKUP_DIR da sana nomli begona papkalar (rasmlar, hujjatlar) bo'lishi mumkin
  const days = readdirSync(env.backupDir).filter(isBackup).sort();
  for (const old of days.slice(0, Math.max(0, days.length - env.backupKeep))) rmSync(join(env.backupDir, old), { recursive: true, force: true });
}

export function startBackups(): () => void {
  if (!(env.backupKeep > 0)) return () => {};
  /** Hubga hali yetmagan nusxa */
  let offsite: string | null = null;
  const run = () => {
    try {
      const made = backupNow();
      if (made) { console.log(`[zaxira] nusxa olindi: ${made}`); offsite = made; }
    } catch (e) {
      console.error('[zaxira] nusxa olinmadi:', (e as Error).message);
    }
    const dir = offsite;
    if (dir) void sendOffsite(dir, basename(dir)).then(sent => { if (sent && offsite === dir) offsite = null; });
  };
  const first = setTimeout(run, FIRST_MS), timer = setInterval(run, CHECK_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
