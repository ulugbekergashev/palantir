/**
 * Tashqi zaxirani ochish (sotuvchi kompyuterida):
 *   npm run restore-backup -- <fayl.pzb> [--key ~/.palantir/zaxira-kaliti.pem] [--out <papka>]
 * Faylni hubdan olish: curl -H "Authorization: Bearer <HUB_ADMIN_KEY>" -o z.pzb https://<hub>/admin/backups/<klinika>/<YYYY-MM-DD>.pzb
 * (ro'yxat: /admin/backups). Natija papkasida palantir.db, miya/, session.secret — klinikada tiklash xuddi mahalliy zaxira kabi:
 * Palantir to'xtatiladi, DATA_DIR dagi palantir.db-wal va palantir.db-shm o'chiriladi, shu uchtasi DATA_DIR ga ko'chiriladi.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { unzipSync } from 'fflate';
import { unseal } from '../server/offsiteCrypto';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file || !existsSync(file)) { console.error("Foydalanish: npm run restore-backup -- <fayl.pzb> [--key <maxfiy kalit>] [--out <papka>]"); process.exit(1); }
/** Kalit papkasi ~/.palantir; avval ~/.cerebro edi (eski nom) — papka ko'chirilmagan bo'lsa, o'sha yerdan */
const keyFile = option('--key') ?? ['.palantir', '.cerebro'].map(dir => join(homedir(), dir, 'zaxira-kaliti.pem')).find(f => existsSync(f)) ?? join(homedir(), '.palantir', 'zaxira-kaliti.pem'); // eski nom
if (!existsSync(keyFile)) { console.error(`Maxfiy kalit topilmadi: ${keyFile}`); process.exit(1); }
const out = option('--out') ?? file.replace(/\.pzb$/, '') + '-ochilgan';

const zip = unseal(readFileSync(keyFile, 'utf8'), readFileSync(file));
const entries = unzipSync(new Uint8Array(zip));
let count = 0;
for (const [name, data] of Object.entries(entries)) {
  if (name.endsWith('/')) continue;
  if (isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) throw new Error(`arxivda xavfli yo'l: ${name}`);
  const target = join(out, ...name.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  count++;
}
console.log(`ochildi: ${out} — ${count} fayl (palantir.db, miya/, session.secret)`);
