/**
 * Reliz: imzolangan arxiv va manifest — klinikadagi yangilovchi (scripts/update.mjs) shularni oladi.
 *   npm run release -- [--out reliz] [--with-node-modules]
 * Talab: git (kuzatiladigan fayllar ro'yxati), yig'ilgan panel (npm run build), imzo kaliti — RELEASE_SIGNING_KEY (PEM matni)
 * yoki RELEASE_SIGNING_KEY_FILE. Arxivga: git kuzatadigan fayllar, dist/, public/models/ (bo'lsa) va --with-node-modules bilan
 * node_modules (Windows'da yig'ilgani kerak: esbuild kabi qismlar platformaga bog'liq). files.json — nashr, baza nashri, ildizlar
 * va kuzatiladigan fayllar: yangilovchi ish paytida paydo bo'lgan fayllarni (tgvoice/.venv, sessiyalar) shundan ajratib saqlaydi.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Zip, ZipDeflate } from 'fflate';
import { SCHEMA_VERSION } from '../server/migrate';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (text: string): never => { console.error(`reliz: ${text}`); process.exit(1); };

const OUT = option('--out') ?? 'reliz';
const withModules = args.includes('--with-node-modules');
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const keyPem = process.env.RELEASE_SIGNING_KEY || (process.env.RELEASE_SIGNING_KEY_FILE ? readFileSync(process.env.RELEASE_SIGNING_KEY_FILE, 'utf8') : '');
if (!keyPem) fail("imzo kaliti yo'q (RELEASE_SIGNING_KEY yoki RELEASE_SIGNING_KEY_FILE)");
if (!existsSync(join('dist', 'index.html'))) fail('panel yig\'ilmagan — avval npm run build');

/** Imzolanadigan qator — scripts/update.mjs bilan bir xil */
const signedText = (m: { version: string; schema: number; file: string; size: number; sha256: string }) =>
  `palantir-reliz\n${m.version}\n${m.schema}\n${m.file}\n${m.size}\n${m.sha256}`;

/** Papkadagi fayllar (havolalarsiz), arxiv uchun «/» bilan */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), st = lstatSync(path);
    if (st.isSymbolicLink()) return [];
    return st.isDirectory() ? walk(path) : [path.split(sep).join('/')];
  });
}

const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(f => f && existsSync(f));
const extra = [...walk('dist'), ...walk(join('public', 'models')), ...(withModules ? walk('node_modules') : [])];
const all = [...new Set([...tracked, ...extra])].filter(f => f !== 'files.json' && !f.startsWith(`${OUT}/`));
const roots = [...new Set(all.map(f => f.split('/')[0]))].sort();
const files = { version, schema: SCHEMA_VERSION, roots, files: tracked };

const file = `palantir-${version}.zip`;
mkdirSync(OUT, { recursive: true });
const out = createWriteStream(join(OUT, file));
const hash = createHash('sha256');
let size = 0;
await new Promise<void>((resolve, reject) => {
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
  for (const f of all) add(f, readFileSync(f));
  add('files.json', Buffer.from(JSON.stringify(files)));
  zip.end();
});

const manifest = { version, schema: SCHEMA_VERSION, file, size, sha256: hash.digest('hex') };
const signature = sign(null, Buffer.from(signedText(manifest)), createPrivateKey(keyPem)).toString('base64');
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ ...manifest, signature }, null, 2)}\n`);
console.log(`reliz ${version}: ${join(OUT, file)} — ${all.length + 1} fayl, ${(size / 1_048_576).toFixed(1)} MB, baza v${SCHEMA_VERSION}${withModules ? ', kutubxonalar bilan' : ''}`);
