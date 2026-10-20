/**
 * Yangilovchi sinovi:  npm run test:update
 * Haqiqiy reliz (scripts/release.ts), nazoratchi va server — vaqtinchalik papkada, reliz arxividan «o'rnatilgan» nusxa; reliz manbai —
 * shu sinovning HTTP serveri:
 *   1) yangi nashr → sinov → almashtirish → yangi nashr ishlayapti; ish fayllari, .env va ma'lumotlar joyida, olib tashlangan fayl yo'q;
 *   2) boshqa kalit bilan imzolangan reliz — rad etiladi, hech narsa o'zgarmaydi;
 *   3) sinovda ko'tarilmaydigan nashr — yangilash bekor, ishlab turgan nashr to'xtamaydi;
 *   4) sinovdan o'tib, haqiqiy ishga tushishda yiqiladigan va bazani migratsiya qiladigan nashr — eski fayllar va baza qaytariladi.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync } from 'fflate';
import { listen, sleep } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const REPO = resolve('.');
const work = mkdtempSync(join(tmpdir(), 'cerebro-yangilash-'));
const SRC = join(work, 'manba'), APP = join(work, 'klinika'), DATA = join(APP, 'data'), RELEASES = join(work, 'relizlar');
const PORT = 3314;
const pem = (k: { export: (o: { type: 'spki' | 'pkcs8'; format: 'pem' }) => string | Buffer }, type: 'spki' | 'pkcs8') => String(k.export({ type, format: 'pem' }));
const keys = generateKeyPairSync('ed25519'), stranger = generateKeyPairSync('ed25519');
const PRIVATE = pem(keys.privateKey, 'pkcs8'), PUBLIC = pem(keys.publicKey, 'spki'), STRANGER = pem(stranger.privateKey, 'pkcs8');
const git = (...args: string[]) => execFileSync('git', args, { cwd: SRC, env: { ...process.env, GIT_AUTHOR_NAME: 'sinov', GIT_AUTHOR_EMAIL: 's@s', GIT_COMMITTER_NAME: 'sinov', GIT_COMMITTER_EMAIL: 's@s' }, stdio: 'pipe' });
const appHealth = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2_000) })).json() as { ok: boolean; version: string }; } catch { return null; } };
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const v = await fn(); if (v) return v; }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
/** Manba faylini o'zgartiradi; topilmasa — sinov yiqiladi (Windows'da git CRLF bilan beradi: jim o'tib ketmasin) */
function edit(text: string, find: string | RegExp, put: string): string {
  const out = text.replace(find, put);
  if (out === text) throw new Error(`sinov manbasida topilmadi: ${String(find)}`);
  return out;
}
const schema = () => { const d = new DatabaseSync(join(DATA, 'cerebro.db'), { readOnly: true }); try { return Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version); } finally { d.close(); } };
const holat = () => JSON.parse(readFileSync(join(DATA, 'yangilash', 'holat.json'), 'utf8')) as { result: string; to: string; reason?: string };

/** Manba papkasida nashrni o'zgartirib, reliz yig'adi (kanal — manifest va arxiv turadigan papka) */
function release(channel: string, version: string, change: () => void = () => {}, key = PRIVATE): void {
  const pkg = JSON.parse(readFileSync(join(SRC, 'package.json'), 'utf8')) as { version: string };
  pkg.version = version;
  writeFileSync(join(SRC, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  change();
  git('add', '-A');
  git('commit', '-q', '-m', version);
  execFileSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'scripts/release.ts', '--out', join(RELEASES, channel)], { cwd: SRC, env: { ...process.env, RELEASE_SIGNING_KEY: key }, stdio: 'pipe' });
}

/** Klinikadagi yangilovchi (o'rnatilgan nusxada). Asinxron: u ishlayotgan paytda sinov serverni kuzatib turadi */
function update(channel: string): Promise<{ code: number | null; out: string }> {
  return new Promise(done => {
    const p = spawn(process.execPath, ['scripts/update.mjs'], {
      cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DOTENV: '', UPDATE_URL: `${base}/${channel}`, UPDATE_PUBLIC_KEY: PUBLIC, UPDATE_HEALTHY_MS: '25000', UPDATE_PREFLIGHT_MS: '60000' },
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', code => done({ code, out: out.trim() }));
  });
}

const files = createServer((req, res) => {
  const path = join(RELEASES, ...decodeURIComponent(req.url ?? '').split('/').filter(Boolean));
  if (!path.startsWith(RELEASES) || !existsSync(path)) { res.statusCode = 404; return res.end(); }
  res.end(readFileSync(path));
});
const base = `http://127.0.0.1:${await listen(files)}`;

try {
  console.log("\n# Tayyorgarlik: manba, birinchi reliz va undan «o'rnatilgan» klinika");
  mkdirSync(SRC, { recursive: true });
  const list = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO }).toString().split('\0').filter(f => f && existsSync(f));
  for (const f of list) cpSync(join(REPO, f), join(SRC, f), { recursive: true });
  cpSync(join(REPO, 'dist'), join(SRC, 'dist'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(SRC, 'node_modules'), 'junction');
  git('init', '-q');
  release('v0', '9.0.0');
  mkdirSync(APP, { recursive: true });
  const zip = unzipSync(readFileSync(join(RELEASES, 'v0', 'cerebro-9.0.0.zip')));
  for (const [name, data] of Object.entries(zip)) {
    if (name.endsWith('/')) continue;
    mkdirSync(dirname(join(APP, name)), { recursive: true });
    writeFileSync(join(APP, name), data);
  }
  symlinkSync(join(REPO, 'node_modules'), join(APP, 'node_modules'), 'junction');
  const envText = [`PORT=${PORT}`, 'LISTEN_HOST=127.0.0.1', `DATA_DIR=${DATA}`, 'ADMIN_PASSWORD=admin-pass-1', 'SESSION_SECRET=yangilash-secret',
    'MORNING_HOUR=99', 'EVENING_HOUR=99', 'BACKUP_KEEP=0', 'ASTERISK_WSL=0', 'UPDATE_AUTO=0', ''].join('\n');
  writeFileSync(join(APP, '.env'), envText);
  // Ish paytida paydo bo'ladigan fayllar: Python muhiti va shahar raqami sozlamasi (relizda yo'q)
  mkdirSync(join(APP, 'tgvoice', '.venv'), { recursive: true });
  writeFileSync(join(APP, 'tgvoice', '.venv', 'belgi.txt'), 'venv');
  writeFileSync(join(APP, 'tgvoice', 'asterisk', 'pjsip_shahar.conf'), '; shahar raqami');
  spawn(process.execPath, ['scripts/supervise.mjs'], { cwd: APP, stdio: 'ignore', env: { ...process.env, DOTENV: '' } });
  ok("o'rnatilgan nusxa ishlayapti: 9.0.0", (await until('9.0.0', async () => (await appHealth())?.version === '9.0.0', 60_000)));
  const adminLogin = await (await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin-pass-1' }) })).json() as { token: string };
  await fetch(`http://127.0.0.1:${PORT}/api/admin/businesses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminLogin.token}` }, body: JSON.stringify({ name: 'Yangilash Dent', industry: 'stomatologiya', login: 'yangilash', password: 'secret12' }) });

  console.log('\n# 1. Yangi nashr');
  release('v1', '9.0.1', () => {
    writeFileSync(join(SRC, 'server', 'yangi-modul.ts'), 'export const YANGI = 1;\n');
    rmSync(join(SRC, 'Palantir-logo', 'README.txt'));
  });
  const first = await update('v1');
  ok('yangilovchi: 0 kodi bilan tugadi', first.code === 0, first.out.split('\n').slice(-3).join(' | '));
  ok('yangi nashr ishlayapti: 9.0.1, holat — ok', (await appHealth())?.version === '9.0.1' && holat().result === 'ok');
  ok("relizdagi yangi fayl keldi, olib tashlangani yo'q", existsSync(join(APP, 'server', 'yangi-modul.ts')) && !existsSync(join(APP, 'Palantir-logo', 'README.txt')));
  ok('ish fayllari saqlandi: tgvoice/.venv, shahar raqami sozlamasi', readFileSync(join(APP, 'tgvoice', '.venv', 'belgi.txt'), 'utf8') === 'venv'
    && existsSync(join(APP, 'tgvoice', 'asterisk', 'pjsip_shahar.conf')));
  ok('.env va baza joyida (biznes saqlangan)', readFileSync(join(APP, '.env'), 'utf8') === envText
    && (() => { const d = new DatabaseSync(join(DATA, 'cerebro.db'), { readOnly: true }); try { return !!d.prepare("SELECT 1 FROM businesses WHERE login = 'yangilash'").get(); } finally { d.close(); } })());

  console.log('\n# 2. Begona kalit bilan imzolangan reliz');
  release('v2', '9.0.2', () => {}, STRANGER);
  const forged = await update('v2');
  ok("rad etildi (kod 1, imzo to'g'ri emas), nashr o'zgarmadi", forged.code === 1 && /imzosi to'g'ri emas/.test(forged.out) && (await appHealth())?.version === '9.0.1', forged.out.split('\n').at(-1));

  console.log("\n# 3. Sinovda ko'tarilmaydigan nashr");
  release('v3', '9.0.3', () => {
    const p = join(SRC, 'server', 'index.ts');
    writeFileSync(p, `throw new Error('buzuq nashr');\n${readFileSync(p, 'utf8')}`);
  });
  // Yangilovchi ishlayotgan butun vaqt davomida 9.0.1 javob berib turishi kerak
  let down = false, stopWatch = false;
  const watcher = (async () => { while (!stopWatch) { if (!(await appHealth())) down = true; await sleep(200); } })();
  const broken = await update('v3');
  stopWatch = true;
  await watcher;
  ok("sinovdan o'tmadi (kod 2) — ishlab turgan 9.0.1 bir lahza ham to'xtamadi", broken.code === 2 && !down && (await appHealth())?.version === '9.0.1' && holat().result === 'sinov', broken.out.split('\n').at(-1));

  console.log('\n# 4. Haqiqiy ishga tushishda yiqiladigan, bazani migratsiya qiladigan nashr');
  release('v4', '9.0.4', () => {
    // Avvalgi 9.0.3 dagi buzuqlik olib tashlanadi; migratsiya v3 qo'shiladi; sinov rejimida ishlaydi, haqiqiysida — baza ochilgach yiqiladi
    const index = join(SRC, 'server', 'index.ts');
    writeFileSync(index, edit(edit(readFileSync(index, 'utf8'), "throw new Error('buzuq nashr');\n", ''),
      "await import('./main');", "if (process.env.CEREBRO_DRY_RUN !== '1') { await import('./db'); process.exit(1); }\nawait import('./main');"));
    const migrate = join(SRC, 'server', 'migrate.ts');
    writeFileSync(migrate, edit(readFileSync(migrate, 'utf8'), /\];\r?\nexport const SCHEMA_VERSION/, "  { version: 3, about: 'sinov', up: db => db.exec('ALTER TABLE businesses ADD COLUMN sinov TEXT') },\n];\nexport const SCHEMA_VERSION"));
  });
  const before = schema();
  const failing = await update('v4');
  ok('eskisiga qaytarildi (kod 3): yana 9.0.1 ishlayapti, holat — qaytarildi', failing.code === 3 && (await appHealth())?.version === '9.0.1' && holat().result === 'qaytarildi', failing.out.split('\n').slice(-2).join(' | '));
  ok(`baza migratsiyadan oldingi nusxadan tiklandi (v${before})`, schema() === before && /baza v3 → v2/.test(holat().reason ?? ''), holat().reason);
  ok('ish fayllari qaytarishdan keyin ham joyida', readFileSync(join(APP, 'tgvoice', '.venv', 'belgi.txt'), 'utf8') === 'venv' && existsSync(join(APP, 'tgvoice', 'asterisk', 'pjsip_shahar.conf')));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  if (existsSync(join(APP, 'scripts', 'supervise.mjs'))) spawnSync(process.execPath, ['scripts/supervise.mjs', 'stop'], { cwd: APP, stdio: 'ignore', env: { ...process.env, DOTENV: '' } });
  files.close();
  await sleep(500);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) {
  try { console.log(readFileSync(join(DATA, 'logs', 'yangilash.log'), 'utf8').split('\n').slice(-25).join('\n')); } catch { /* jurnal yo'q */ }
}
process.exit(failed ? 1 : 0);
