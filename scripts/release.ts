/**
 * Reliz: imzolangan arxiv va manifest — klinikadagi yangilovchi (scripts/update.mjs) shularni oladi.
 *   npm run release -- [--out reliz] [--with-node-modules]
 * Talab: git (kuzatiladigan fayllar ro'yxati), yig'ilgan panel (npm run build), imzo kaliti — RELEASE_SIGNING_KEY (PEM matni)
 * yoki RELEASE_SIGNING_KEY_FILE. Arxiv tarkibi — scripts/archive.ts; --with-node-modules bilan node_modules ham kiradi
 * (Windows'da yig'ilgani kerak: esbuild kabi qismlar platformaga bog'liq).
 */
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../server/migrate';
import { writeArchive } from './archive';

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

const file = `palantir-${version}.zip`;
mkdirSync(OUT, { recursive: true });
const { files, size, sha256 } = await writeArchive(join(OUT, file), { version, modules: withModules ? 'node_modules' : undefined, skip: OUT });

const manifest = { version, schema: SCHEMA_VERSION, file, size, sha256 };
const signature = sign(null, Buffer.from(signedText(manifest)), createPrivateKey(keyPem)).toString('base64');
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ ...manifest, signature }, null, 2)}\n`);
console.log(`reliz ${version}: ${join(OUT, file)} — ${files} fayl, ${(size / 1_048_576).toFixed(1)} MB, baza v${SCHEMA_VERSION}${withModules ? ', kutubxonalar bilan' : ''}`);
