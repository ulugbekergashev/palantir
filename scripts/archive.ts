/**
 * Reliz arxivi — scripts/release.ts (imzolangan yangilanish) va scripts/setup-exe.ts (o'rnatuvchi .exe) uchun bitta.
 * Arxivga: git kuzatadigan fayllar, dist/, public/models/ (bo'lsa), node_modules (modules berilsa — o'sha papkadan) va files.json.
 * files.json — nashr, baza nashri, ildizlar va kuzatiladigan fayllar: yangilovchi (scripts/update.mjs) ish paytida paydo bo'lgan
 * fayllarni (tgvoice/.venv, sessiyalar) shundan ajratib saqlaydi; install/ornatish.ps1 uni ko'rib internetsiz yo'ldan o'rnatadi.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Zip, ZipDeflate } from 'fflate';
import { SCHEMA_VERSION } from '../server/migrate';

export interface ArchiveOptions {
  version: string;
  /** Arxivga node_modules shu papkadan olinadi (Windows'da yig'ilgani kerak: esbuild kabi qismlar platformaga bog'liq) */
  modules?: string;
  /** Shu papka ichidagi kuzatiladigan fayllar arxivga kirmaydi (arxiv o'zi yoziladigan joy) */
  skip?: string;
}

export interface ArchiveResult { files: number; size: number; sha256: string }

/** Papkadagi fayllar (havolalarsiz), papkaga nisbatan va «/» bilan */
function walk(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), rel = base ? `${base}/${name}` : name, st = lstatSync(path);
    if (st.isSymbolicLink()) return [];
    return st.isDirectory() ? walk(path, rel) : [rel];
  });
}

export async function writeArchive(target: string, { version, modules, skip }: ArchiveOptions): Promise<ArchiveResult> {
  const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(f => f && existsSync(f));
  // arxivdagi nom → diskdagi fayl
  const entries = new Map<string, string>(tracked.filter(f => !skip || !f.startsWith(`${skip}/`)).map(f => [f, f]));
  const addDir = (dir: string, name: string) => { for (const rel of walk(dir)) entries.set(`${name}/${rel}`, join(dir, rel)); };
  addDir('dist', 'dist');
  addDir(join('public', 'models'), 'public/models');
  if (modules) addDir(modules, 'node_modules');
  entries.delete('files.json');
  const roots = [...new Set([...entries.keys()].map(f => f.split('/')[0]))].sort();
  const files = { version, schema: SCHEMA_VERSION, roots, files: tracked };

  const out = createWriteStream(target);
  const hash = createHash('sha256');
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      hash.update(chunk);
      size += chunk.length;
      out.write(chunk);
      if (final) out.end(() => resolve());
    });
    const add = (name: string, data: Uint8Array) => {
      const entry = new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(data, true);
    };
    for (const [name, source] of entries) add(name, readFileSync(source));
    add('files.json', Buffer.from(JSON.stringify(files)));
    zip.end();
  });
  return { files: entries.size + 1, size, sha256: hash.digest('hex') };
}
