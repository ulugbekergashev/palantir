/**
 * Klinikaga boradigan server kodi: manba (.ts) o'rniga yig'ilgan, siqilgan, izohsiz app/*.mjs (DentaLocal'dagi ncc kabi, lekin siqilgan).
 * Kutubxonalar (node_modules) ichiga kirmaydi — ular yonida turadi. Xarita fayllari (*.map) arxivga kirmaydi: ular faqat bizda,
 * klinikadan kelgan xatoni asl fayl va qatorga qaytarib o'qish uchun (scripts/archive.ts → <out>/xarita-<nashr>).
 *   npx tsx scripts/bundle.ts            — app/ ga yig'adi
 * Kirish nuqtalari (server/entry.ts shu nomlar bilan chaqiradi):
 *   server          — server/index.ts (asosiy; nazoratchi va yangilovchi ishga tushiradi)
 *   camera-engine   — kamera dvigateli (alohida jarayon)
 *   extract-worker  — yuklangan hujjatni o'qiydigan worker
 *   check, live     — o'rnatilgan nusxadagi «Tekshirish» (npm run check) va jonli tekshiruv (npm run live)
 *   camera-model    — kamera modelini yuklash (npm run camera:model)
 */
import { rmSync } from 'node:fs';

export const APP_DIR = 'app';

export const ENTRIES: Record<string, string> = {
  server: 'server/index.ts',
  'camera-engine': 'server/camera/engine.ts',
  'extract-worker': 'server/intake/extractWorker.ts',
  check: 'scripts/preflight.ts',
  live: 'scripts/live.ts',
  'camera-model': 'scripts/fetch-model.ts',
};

/** O'rnatilgan nusxadagi npm buyruqlari — manba emas, yig'ilgan fayllar bilan */
export const COMPILED_SCRIPTS: Record<string, string> = {
  start: 'node --no-warnings app/server.mjs',
  serve: 'node scripts/supervise.mjs',
  stop: 'node scripts/supervise.mjs stop',
  status: 'node scripts/supervise.mjs status',
  update: 'node scripts/update.mjs',
  check: 'node --no-warnings app/check.mjs',
  live: 'node --no-warnings app/live.mjs',
  'camera:model': 'node --no-warnings app/camera-model.mjs',
};

export async function bundle(outDir = APP_DIR): Promise<void> {
  // esbuild — dasturchi kutubxonasi: CI'da npm prune'dan oldin chaqiriladi (keyin PALANTIR_BUNDLED=1 bilan tayyori olinadi)
  const { build } = await import('esbuild');
  rmSync(outDir, { recursive: true, force: true });
  await build({
    entryPoints: ENTRIES,
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    // Kutubxonalar yonidagi node_modules'dan olinadi (o'rnatgich va yangilovchi ularni alohida qo'yadi)
    packages: 'external',
    minify: true,
    // Xato matnlari va instanceof tekshiruvlari sinf/funksiya nomiga tayanadi — nomlar saqlanadi, qolgani siqiladi
    keepNames: true,
    legalComments: 'none',
    sourcemap: 'external',
    sourcesContent: true,
    logLevel: 'warning',
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('bundle.ts')) {
  await bundle();
  console.log(`yig'ildi: ${APP_DIR}/ (${Object.keys(ENTRIES).join(', ')})`);
}
