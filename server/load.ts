/**
 * Kompyuter yuklamasi — kameralar ko'p bo'lganda (8 GB mini-PC, 4–8 kamera) yetadimi: protsessor (hamma yadrolar, oxirgi
 * o'lchovdan beri) va xotira. Panel (Kuzatuvchi → Kompyuter yuklamasi) va diagnostika uchun.
 */
import { cpus, freemem, totalmem } from 'node:os';

const SAMPLE_MS = 30_000;
let last = cpus().map(c => c.times);
let cpuPct: number | null = null;

function sample(): void {
  const now = cpus().map(c => c.times);
  let busy = 0, all = 0;
  now.forEach((t, i) => {
    const p = last[i];
    if (!p) return;
    const idle = t.idle - p.idle;
    const total = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
    busy += total - idle;
    all += total;
  });
  last = now;
  if (all > 0) cpuPct = Math.round((busy / all) * 100);
}
setInterval(sample, SAMPLE_MS).unref();
// Birinchi qiymat tezroq (panel ishga tushgach yarim daqiqa «—» ko'rsatmasin)
setTimeout(sample, 5_000).unref();

export interface SystemLoad { cpuPct: number | null; cores: number; memUsedMb: number; memTotalMb: number }

export function systemLoad(): SystemLoad {
  const mb = (n: number) => Math.round(n / 1_048_576);
  return { cpuPct, cores: cpus().length, memUsedMb: mb(totalmem() - freemem()), memTotalMb: mb(totalmem()) };
}
