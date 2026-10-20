/**
 * Qarovsiz ishlash uchun himoya:
 *   bitta papka — bitta nusxa: shu DATA_DIR bilan ikkinchi server ishga tushsa, bazani va bot navbatini buzmasdan darhol to'xtaydi;
 *   ushlanmagan xato butun dasturni jim o'chirib qo'ymaydi — jurnalga yoziladi.
 * Bu fayl bazani import qilmaydi: qulf olinmaguncha baza ochilmasligi kerak (index.ts).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';

const lockFile = join(env.dataDir, 'cerebro.lock');
const PROBE_MS = 1500;
/** Yangi yozilgan qulf: egasi hali ko'tarilyapti (port ochilmagan) — javob bermasa ham tirik sanaladi */
const BOOTING_MS = 60_000;
/** Nazoratchi (scripts/supervise.mjs) bu kod bilan to'xtagan serverni qayta yoqmaydi: qayta urinish tuzatmaydigan holat */
export const EXIT_DO_NOT_RESTART = 78;

interface Lock { pid?: number; port?: number; host?: string; at?: string }

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** Qulfda yozilgan nusxa haqiqatan ishlab turibdimi: jarayoni bor va (endigina boshlangan yoki serveri javob beradi). O'lik jarayon raqami boshqa dasturga o'tgan bo'lishi mumkin */
async function running(lock: Lock): Promise<boolean> {
  if (!lock.pid || lock.pid === process.pid || !alive(lock.pid)) return false;
  const age = Date.now() - Date.parse(lock.at ?? '');
  if (age >= 0 && age < BOOTING_MS) return true;
  // Qulf faylini boshqa dastur yozgan bo'lishi mumkin: faqat oddiy manzil va port raqami bilan so'rov yuboriladi
  const host = lock.host || '127.0.0.1', port = lock.port ?? 0;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i.test(host)) return false;
  try {
    const r = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(PROBE_MS) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Qulf fayli: yo'q bo'lsa null; o'qib bo'lmasa (buzuq) — bo'sh, ya'ni eskirgan */
const readLock = (): Lock | null => {
  try { return JSON.parse(readFileSync(lockFile, 'utf8')) as Lock; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : {}; }
};

function taken(lock: Lock): never {
  console.error(`[server] Palantir shu papka bilan allaqachon ishlab turibdi (jarayon ${lock.pid ?? '?'}, port ${lock.port ?? '?'}). Ikkinchi nusxa ishga tushmaydi — avvalgisini to'xtating`);
  process.exit(EXIT_DO_NOT_RESTART);
}

/** Ishga tushishda bir marta. Boshqa nusxa ishlab turgan bo'lsa — tushuntirib, chiqadi */
export async function singleInstance(): Promise<void> {
  const old = readLock();
  if (old) {
    if (await running(old)) taken(old);
    // Eskirgan qulf (dastur majburan o'chirilgan, tok o'chgan)
    rmSync(lockFile, { force: true });
  }
  // Hamma interfeysni tinglayotgan server o'z kompyuteridan 127.0.0.1 orqali ko'rinadi; IPv6 manzil qavs ichida yoziladi
  const all = !env.listenHost || env.listenHost === '0.0.0.0' || env.listenHost === '::';
  const host = all ? '127.0.0.1' : env.listenHost.includes(':') ? `[${env.listenHost}]` : env.listenHost;
  try {
    // «wx»: fayl shu orada paydo bo'lgan bo'lsa (ikki nusxa bir vaqtda boshlangan) — yozilmaydi, bittasi yutadi
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: env.port, host, at: new Date().toISOString() } satisfies Lock), { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    taken(readLock() ?? {});
  }
  // Faqat o'z qulfini o'chiradi: o'rniga kelgan yangi nusxaning qulfiga tegmaydi
  process.on('exit', () => {
    if (readLock()?.pid === process.pid) rmSync(lockFile, { force: true });
  });
}

/**
 * Ushlanmagan xatolar. Rad etilgan va'da (tarmoq uzildi, fayl band) — jurnalga yoziladi, ish davom etadi.
 * Kutilmagan istisno — holat ishonchsiz: jurnalga yozib chiqiladi, nazoratchi (scripts/supervise.mjs) qayta ishga tushiradi.
 */
export function guardProcess(): void {
  // Xato obyektining o'zi emas, matni va joyi yoziladi: ichida so'rov tanasi (mijoz xabari, telefon) bo'lishi mumkin
  const text = (e: unknown) => (e instanceof Error ? e.stack ?? e.message : String(e));
  process.on('unhandledRejection', reason => { console.error('[server] ushlanmagan xato (ish davom etadi):', text(reason)); });
  process.on('uncaughtException', err => {
    console.error('[server] kutilmagan xato — qayta ishga tushiriladi:', text(err));
    process.exit(1);
  });
}
