/**
 * Egasining Chrome'ida (kengaytma yoki «Allow remote debugging» orqali) yuklab olingan fayllar Playwright'ga kelmaydi — Chrome ularni
 * egasining odatiy «Yuklanmalar» papkasiga tushiradi (2026-11-20: lex.uz dan Mehnat kodeksi bosildi, lekin Telegram'ga kelmadi).
 * Shuning uchun ish davomida shu papka kuzatiladi: ish boshlangandan keyin paydo bo'lgan, to'liq tushgan fayllar ish papkasiga nusxalanadi.
 * Egasi shu paytda o'zi ham biror narsa yuklasa — u ham o'ziga (Telegram'ga) keladi; boshqa hech kimga emas.
 */
import { copyFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { chromeDataDir } from './ownChrome';

/** Chrome hali yozayotgan fayllar */
const PARTIAL = /\.(crdownload|tmp|part)$|^\.com\.google\.Chrome\./i;
const POLL_MS = 500;
/** Fayl tugagani: hajmi shuncha vaqt o'zgarmadi */
const SETTLE_MS = 1_000;

const readJson = (file: string): Record<string, unknown> | null => {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
};

/** Egasining Chrome'i fayllarni qayerga tushiradi: profil sozlamasi (download.default_directory), bo'lmasa — uydagi Downloads */
export function ownerDownloadsDir(dataDir = chromeDataDir()): string {
  const state = readJson(join(dataDir, 'Local State')) as { profile?: { last_used?: unknown } } | null;
  const profile = typeof state?.profile?.last_used === 'string' ? state.profile.last_used : 'Default';
  const prefs = readJson(join(dataDir, profile, 'Preferences')) as { download?: { default_directory?: unknown } } | null;
  const dir = prefs?.download?.default_directory;
  return typeof dir === 'string' && dir ? dir : join(homedir(), 'Downloads');
}

interface Seen { size: number; at: number }

/** Bitta ish uchun: boshlanganda papkadagi narsa eslab qolinadi, keyin yangilari olinadi */
export class DownloadWatch {
  private readonly before = new Set<string>();
  private readonly taken = new Set<string>();
  private readonly sizes = new Map<string, Seen>();
  private readonly since = Date.now();

  constructor(private readonly dir: string, private readonly into: string) {
    for (const name of this.list()) this.before.add(name);
  }

  private list(): string[] {
    try { return readdirSync(this.dir); } catch { return []; }
  }

  /** Yangi, to'liq tushgan fayllar ish papkasiga nusxalanadi. Qaytaradi: nusxalanganlar va hali yozilayotgani bormi */
  collect(): { files: string[]; pending: boolean } {
    const files: string[] = [];
    let pending = false;
    const now = Date.now();
    for (const name of this.list()) {
      if (this.before.has(name) || this.taken.has(name)) continue;
      if (PARTIAL.test(name)) { pending = true; continue; }
      let st;
      try { st = statSync(join(this.dir, name)); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < this.since - SETTLE_MS) continue;
      const seen = this.sizes.get(name);
      if (!seen || seen.size !== st.size) { this.sizes.set(name, { size: st.size, at: now }); pending = true; continue; }
      if (now - seen.at < SETTLE_MS) { pending = true; continue; }
      const target = join(this.into, basename(name).replace(/[^\p{L}\p{N}._ ()-]+/gu, '_').slice(0, 120) || 'fayl');
      try {
        copyFileSync(join(this.dir, name), target);
        this.taken.add(name);
        files.push(target);
      } catch { pending = true; }
    }
    return { files, pending };
  }

  /** Yozilayotgan fayl bo'lsa — tugashini ko'pi bilan ms kutadi */
  async settle(ms: number): Promise<string[]> {
    const out: string[] = [];
    const end = Date.now() + ms;
    for (;;) {
      const { files, pending } = this.collect();
      out.push(...files);
      if (!pending || Date.now() >= end) return out;
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
}
