/**
 * Reliz arxivi — scripts/release.ts (imzolangan yangilanish) va scripts/setup-exe.ts (o'rnatuvchi .exe) uchun bitta.
 * Arxivga: git kuzatadigan fayllar, dist/, public/models/ (bo'lsa), node_modules (modules berilsa — o'sha papkadan) va files.json.
 * files.json — nashr, baza nashri, ildizlar va kuzatiladigan fayllar: yangilovchi (scripts/update.mjs) ish paytida paydo bo'lgan
 * fayllarni (tgvoice/.venv, sessiyalar) shundan ajratib saqlaydi; install/ornatish.ps1 uni ko'rib internetsiz yo'ldan o'rnatadi.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Zip, ZipDeflate } from 'fflate';
import { SCHEMA_VERSION } from '../server/migrate';
import { APP_DIR, COMPILED_SCRIPTS, bundle } from './bundle';

export interface ArchiveOptions {
  version: string;
  /** Arxivga node_modules shu papkadan olinadi (Windows'da yig'ilgani kerak: esbuild kabi qismlar platformaga bog'liq) */
  modules?: string;
  /** Shu papka ichidagi kuzatiladigan fayllar arxivga kirmaydi (arxiv o'zi yoziladigan joy) */
  skip?: string;
  /** Qo'shimcha papkalar: diskdagi papka → arxivdagi nomi (o'rnatuvchi exe'ning runtime\ qismlari) */
  extra?: { dir: string; name: string }[];
  /** Klinikaga manbasiz, yig'ilgan nashr (app/*.mjs) — exe va avto-yangilanish uchun */
  compiled?: boolean;
  /** Xarita fayllari (*.map) shu papkaga (standart — arxiv yonida) */
  mapsDir?: string;
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

/**
 * Yig'ilgan nashr (compiled): klinikaga manba kod bormaydi. Server, src, skriptlar — app/*.mjs ga yig'ilgan (scripts/bundle.ts);
 * hub, hujjatlar, testlar, android — umuman kerak emas. Qoladi: o'rnatish, nazoratchi va yangilovchi, telefon xizmati (tgvoice),
 * server yonidagi yordamchi fayllar (C# ilgaklar), panel (dist) va kutubxonalar.
 */
const SOURCE_ONLY = /^(src|hub|docs|android|\.github)\/|^(tsconfig\.json|vite\.config\.ts|index\.html|\.oxlintrc\.json|README\.md)$|^server\/.*\.tsx?$|^scripts\/(?!(supervise|update)\.mjs$)/;
/** Eski nashrlarda bo'lgan, endi yo'q ildizlar: yangilovchi ildizni butunlay almashtiradi — ichida bitta belgi fayli qoladi, manbalar o'chadi */
const DROPPED_ROOTS = ['src', 'hub', 'docs', 'android', '.github'];
/** Eski yangilovchi va nazoratchi `tsx server/index.ts` ni ishga tushiradi — yig'ilgan serverga ko'prik */
const SHIM = "// Palantir: yig'ilgan nashr — server app/server.mjs da\nawait import('../app/server.mjs');\n";

export async function writeArchive(target: string, { version, modules, skip, extra = [], compiled = false, mapsDir }: ArchiveOptions): Promise<ArchiveResult> {
  // CI: kutubxonalar qisqartirilishidan oldin yig'ilgan (PALANTIR_BUNDLED=1) — tayyori olinadi
  if (compiled && !(process.env.PALANTIR_BUNDLED === '1' && existsSync(join(APP_DIR, 'server.mjs')))) await bundle(APP_DIR);
  const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(f => f && existsSync(f));
  // arxivdagi nom → diskdagi fayl yoki tayyor matn
  const entries = new Map<string, string | Buffer>(tracked.filter(f => (!skip || !f.startsWith(`${skip}/`)) && (!compiled || !SOURCE_ONLY.test(f))).map(f => [f, f]));
  const addDir = (dir: string, name: string) => { for (const rel of walk(dir)) entries.set(`${name}/${rel}`, join(dir, rel)); };
  addDir('dist', 'dist');
  addDir(join('public', 'models'), 'public/models');
  if (compiled) {
    for (const rel of walk(APP_DIR).filter(f => f.endsWith('.mjs'))) entries.set(`${APP_DIR}/${rel}`, join(APP_DIR, rel));
    entries.set('server/index.ts', Buffer.from(SHIM));
    for (const r of DROPPED_ROOTS) entries.set(`${r}/.olib-tashlandi`, Buffer.from("Bu papka yig'ilgan nashrda kerak emas\n"));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    entries.set('package.json', Buffer.from(`${JSON.stringify({ ...pkg, scripts: COMPILED_SCRIPTS }, null, 2)}\n`));
    // Xaritalar — faqat bizda: klinikadan kelgan xato qatorini asl manbaga qaytarish uchun
    const maps = join(mapsDir ?? dirname(target), `xarita-${version}`);
    mkdirSync(maps, { recursive: true });
    for (const rel of walk(APP_DIR).filter(f => f.endsWith('.map'))) copyFileSync(join(APP_DIR, rel), join(maps, rel));
  }
  if (modules) addDir(modules, 'node_modules');
  for (const e of extra) addDir(e.dir, e.name);
  entries.delete('files.json');
  const roots = [...new Set([...entries.keys()].map(f => f.split('/')[0]))].sort();
  // Yangilovchi shu ro'yxatdagi fayllarni «nashrniki» deb biladi, qolganini (sessiyalar, .venv) ish fayli sifatida saqlab qoladi
  const ours = compiled ? [...entries.keys()].filter(f => !f.startsWith('node_modules/') && !extra.some(e => f.startsWith(`${e.name}/`))) : tracked;
  const files = { version, schema: SCHEMA_VERSION, roots, files: ours };

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
    // Linux'da bajariladigan skriptlar (Asterisk install.sh — WSL'da) faqat LF bilan: Windows nusxasi CRLF bo'lsa bash ishlamaydi
    const lf = (b: Buffer) => Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    for (const [name, source] of entries) {
      const data = typeof source === 'string' ? readFileSync(source) : source;
      add(name, name.endsWith('.sh') ? lf(data) : data);
    }
    add('files.json', Buffer.from(JSON.stringify(files)));
    zip.end();
  });
  return { files: entries.size + 1, size, sha256: hash.digest('hex') };
}
