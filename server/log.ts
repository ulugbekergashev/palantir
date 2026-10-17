/**
 * Jurnal fayli: konsolga chiqqan har bir qator DATA_DIR/logs/YYYY-MM-DD.log ga ham yoziladi. Klinikadagi kompyuterda oyna yopiq
 * turadi — nima bo'lganini keyin shu fayldan ko'riladi. Eski fayllar o'zi o'chadi. Jurnal yozilmasa ham ish to'xtamaydi.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { iso } from '../src/lib/week';
import { env } from './env';

const KEEP_DAYS = 14;
const dir = join(env.dataDir, 'logs');
let day = '';

function prune(today: string): void {
  const oldest = iso(new Date(Date.now() - KEEP_DAYS * 86_400_000));
  for (const name of readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.log$/.test(name) && name.slice(0, 10) < oldest && name.slice(0, 10) !== today) rmSync(join(dir, name), { force: true });
  }
}

/** Kalitga o'xshagan narsa jurnalga yozilmaydi (xato matni ichida manzil yoki sarlavha bilan kelib qolishi mumkin) */
const SECRETS = /bot\d{5,}:[\w-]{20,}|sk-ant-[\w-]{10,}|AIza[\w-]{30,}|AQ\.[\w-]{30,}|vlk_[\w-]{16,}|gsk_\w{20,}|Bearer\s+[\w.~+/-]{16,}|([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+:[^/@\s]*@/gi;
const scrub = (line: string): string => line.replace(SECRETS, (_m, scheme?: string) => (scheme ? `${scheme}***@` : '***'));

function write(level: string, args: unknown[]): void {
  try {
    const now = new Date(), today = iso(now);
    if (today !== day) {
      mkdirSync(dir, { recursive: true });
      day = today;
      prune(today);
    }
    appendFileSync(join(dir, `${today}.log`), `${now.toTimeString().slice(0, 8)} ${level} ${scrub(format(...args))}\n`);
  } catch { /* disk to'lgan yoki fayl band — konsolga baribir chiqqan */ }
}

// Import qilinishi bilan ishlaydi: boshqa modullar yuklanayotganda yozgan qatorlar ham faylga tushsin
for (const [name, level] of [['log', '   '], ['warn', 'WRN'], ['error', 'ERR']] as const) {
  const print = console[name].bind(console);
  console[name] = (...args: unknown[]) => {
    // Avval faylga: konsol yopiq bo'lsa (fonda, oynasiz) chiqarish xato berishi mumkin — fayl jurnali aynan shu holat uchun
    write(level, args);
    try { print(...args); } catch { /* konsol yo'q */ }
  };
}

export const logDir = dir;
