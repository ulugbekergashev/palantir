/**
 * Faylni alohida ishchi oqimda o'qiydi. Hujjat o'quvchi kutubxonalar buzuq yoki ataylab yasalgan faylda uzoq hisoblab qolishi yoki
 * xotirani to'ldirib qo'yishi mumkin; asosiy oqimda bu butun serverni (hamma bizneslarni) to'xtatadi va «vaqt tugadi» ham ishlamaydi,
 * chunki hisob-kitob oqimni band qilib turadi. Bu yerda vaqt yoki xotira chegarasidan oshgan o'qish majburan to'xtatiladi.
 * Bir vaqtda bitta fayl o'qiladi — navbat bilan.
 */
import { Worker } from 'node:worker_threads';
import { FileError, type Extracted } from './extract';

const TIME_LIMIT_MS = 20_000;
/** O'qish paytida jarayon xotirasi shuncha oshsa — to'xtatiladi (ishchi oqimning o'z chegarasi Buffer'larni sanamaydi) */
const MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024;
const POLL_MS = 200;
const TOO_HEAVY = "Faylni o'qish juda og'ir bo'ldi — u buzilgan yoki haddan tashqari katta. Kichikroq qilib yoki boshqa ko'rinishda (masalan, Excel o'rniga matn) yuboring.";

export type WorkerReply = { ok: true; file: Extracted } | { ok: false; message: string; expected: boolean };

let queue: Promise<unknown> = Promise.resolve();

function run(name: string, bytes: Buffer, limitMs: number): Promise<Extracted> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./extractWorker.ts', import.meta.url), { workerData: { name, bytes } });
    const baseline = process.memoryUsage.rss();
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new FileError(TOO_HEAVY))), limitMs);
    const watch = setInterval(() => { if (process.memoryUsage.rss() - baseline > MEMORY_LIMIT_BYTES) finish(() => reject(new FileError(TOO_HEAVY))); }, POLL_MS);
    worker.once('message', (r: WorkerReply) => finish(() => (r.ok ? resolve(r.file) : reject(r.expected ? new FileError(r.message) : new Error(r.message)))));
    worker.once('error', err => finish(() => reject(err)));
    worker.once('exit', code => finish(() => reject(new Error(`fayl o'quvchi kutilmaganda to'xtadi (${code})`))));
  });
}

/** Faylni o'qiydi (extract.ts), lekin asosiy oqimdan tashqarida va chegara bilan. O'qib bo'lmasa — FileError */
export function extractSafely(name: string, bytes: Buffer, limitMs = TIME_LIMIT_MS): Promise<Extracted> {
  const next = queue.then(() => run(name, bytes, limitMs));
  queue = next.catch(() => {});
  return next;
}
