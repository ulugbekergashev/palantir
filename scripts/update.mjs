/**
 * Yangilovchi: imzolangan relizni oladi, sinab ko'radi, almashtiradi; yangi nashr ishga tushmasa — eskisini qaytaradi.
 *   node scripts/update.mjs           — yangi nashr bo'lsa yangilaydi (nazoratchi kechasi o'zi chaqiradi)
 *   node scripts/update.mjs --check   — faqat tekshiradi: qaysi nashr bor (hech narsa o'zgarmaydi)
 * Oddiy Node skripti (tsx kerak emas): node_modules almashtirilayotgan paytda ham ishlaydi.
 *
 *   1. UPDATE_URL/manifest.json — nashr, baza nashri, fayl, hajm, sha256 va Ed25519 imzo; imzo shu fayldagi ochiq kalit bilan tekshiriladi.
 *   2. Arxiv yuklanadi, hajmi va sha256 tekshiriladi, DATA_DIR/yangilash/<nashr>/ ga ochiladi (arxivdan tashqariga yozib bo'lmaydi).
 *   3. Sinov: yangi nashr bazaning NUSXASI bilan, kalitlarsiz va tashqi xizmatlarsiz (PALANTIR_DRY_RUN) ko'tariladi —
 *      /api/health shu nashrni aytmasa yangilash bekor, ishlab turgan nashrga tegilmaydi.
 *   4. Nazoratchi to'xtatiladi; relizdagi ildizlar (server, src, node_modules…) almashtiriladi — eskisi DATA_DIR/yangilash/oldingi/ ga.
 *      Ish paytida paydo bo'lgan fayllar (tgvoice/.venv, sessiyalar, konfiglar) yangi papkaga ko'chadi; .env va ma'lumotlarga tegilmaydi.
 *   5. Nazoratchi qayta yoqiladi; yangi nashr 3 daqiqada sog'lom bo'lmasa — eski fayllar qaytariladi, baza migratsiyadan
 *      oldingi nusxadan (server/migrate.ts: BACKUP_DIR/oldin-v<N>-….db) tiklanadi.
 * Natija: DATA_DIR/yangilash/holat.json (hub holatida ko'rinadi). Jurnal: DATA_DIR/logs/yangilash.log
 * Chiqish kodi: 0 — yangilandi yoki yangisi yo'q; 1 — xato (hech narsa o'zgarmadi); 2 — sinovdan o'tmadi; 3 — eskisiga qaytarildi.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Unzip, UnzipInflate } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
if (existsSync('.env')) process.loadEnvFile('.env');

const DATA = resolve(process.env.DATA_DIR || 'data');
const BACKUPS = resolve(process.env.BACKUP_DIR || join(DATA, 'backups'));
/** Baza fayli — server/env.ts bilan bir xil: avvalgi nom (Cerebro — eski nom) bilan yaratilgan baza bo'lsa, o'sha */
const DB_FILE = existsSync(join(DATA, 'palantir.db')) || !existsSync(join(DATA, 'cerebro.db')) ? join(DATA, 'palantir.db') : join(DATA, 'cerebro.db'); // eski nom
const WORK = join(DATA, 'yangilash');
const STATE = join(WORK, 'holat.json');
const LOCK = join(WORK, 'yangilash.lock');
const PORT = Number(process.env.PORT) || 3200;
const SOURCE = (process.env.UPDATE_URL || 'https://github.com/ulugbekergashev/palantir/releases/latest/download').replace(/\/+$/, '');
/** Relizlarni imzolovchi kalitning ochiq qismi (maxfiy qismi sotuvchida). UPDATE_PUBLIC_KEY — o'z yig'ilmalari va sinov uchun */
const PUBLIC_KEY = process.env.UPDATE_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAof8zYcguvj+tOabkX1qrhe7AZULkqasISVGeHpX6okM=
-----END PUBLIC KEY-----
`;
/** Butunlay almashtiriladigan ildizlar: ichida ish fayli saqlanmaydi va ichi ko'rib chiqilmaydi (juda katta) */
const WHOLE = new Set(['node_modules', 'dist']);
const PREFLIGHT_MS = Number(process.env.UPDATE_PREFLIGHT_MS) || 120_000;
const HEALTHY_MS = Number(process.env.UPDATE_HEALTHY_MS) || 180_000;
/** Server shuncha marta ketma-ket sog'lom javob bersa — yangi nashr ishladi (bir martalik javob — hali yiqilishi mumkin) */
const HEALTHY_STREAK = 3;

mkdirSync(join(DATA, 'logs'), { recursive: true });
const log = text => {
  const d = new Date(), two = n => String(n).padStart(2, '0');
  const line = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${text}`;
  console.log(line);
  try { appendFileSync(join(DATA, 'logs', 'yangilash.log'), `${line}\n`); } catch { /* jurnal yozilmasa ham ishlayveradi */ }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const parts = v => String(v).split('.').map(n => Number.parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };
const currentVersion = () => readJson(join(ROOT, 'package.json'))?.version ?? '0.0.0';
const saveState = state => { mkdirSync(WORK, { recursive: true }); writeFileSync(STATE, JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2)); };

/** Imzolanadigan qator — scripts/release.ts bilan bir xil */
const signedText = m => `palantir-reliz\n${m.version}\n${m.schema}\n${m.file}\n${m.size}\n${m.sha256}`;

function checkManifest(m) {
  if (!m || typeof m !== 'object') throw new Error("manifest o'qilmadi");
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version)) || !Number.isInteger(m.schema) || !/^[\w.-]+\.zip$/.test(String(m.file))
    || !Number.isInteger(m.size) || !/^[0-9a-f]{64}$/.test(String(m.sha256)) || typeof m.signature !== 'string') throw new Error("manifest buzuq");
  const ok = verify(null, Buffer.from(signedText(m)), createPublicKey(PUBLIC_KEY), Buffer.from(m.signature, 'base64'));
  if (!ok) throw new Error("manifest imzosi to'g'ri emas — reliz soxta yoki buzilgan");
  return m;
}

async function download(url) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Arxiv yo'li xavfsizmi: nisbiy, «..» siz, disk harfisiz — arxiv papkadan tashqariga yoza olmasin */
const safeName = name => !!name && !isAbsolute(name) && !name.includes('\\') && !/^[a-zA-Z]:/.test(name) && !name.split('/').some(p => p === '..');

function extract(zip, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let failure = null, count = 0;
  const unzip = new Unzip(file => {
    if (!safeName(file.name)) { failure = new Error(`arxivda xavfli yo'l: ${file.name}`); return; }
    const target = join(dir, ...file.name.split('/'));
    if (file.name.endsWith('/')) { mkdirSync(target, { recursive: true }); return; }
    const chunks = [];
    file.ondata = (err, data, final) => {
      // Fayl nomi bilan: jurnalda qaysi fayl ochilmagani ko'rinsin
      if (err) { failure ??= new Error(`${file.name}: ${err.message}`); return; }
      chunks.push(data);
      if (final) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.concat(chunks)); count++; }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const step = 1 << 20;
  for (let i = 0; i < zip.length; i += step) unzip.push(zip.subarray(i, i + step), i + step >= zip.length);
  if (failure) throw failure;
  return count;
}

const freePort = () => new Promise(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

async function healthy(port, version, ms, streak = 1) {
  let good = 0;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1_000)) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3_000) })).json();
      good = j.ok && j.version === version ? good + 1 : 0;
    } catch { good = 0; }
    if (good >= streak) return true;
  }
  return false;
}

/** Yangi nashr uchun muhit — faqat OT o'zgaruvchilari: haqiqiy kalitlar (.env) sinovga o'tmaydi */
function bareEnv(extra) {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'TZ', 'LANG'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

const userVersion = file => {
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Number(db.prepare('PRAGMA user_version').get().user_version); } finally { db.close(); }
};

/** Yangi nashrni bazaning nusxasi bilan ko'tarib ko'radi */
async function preflight(staging, version) {
  const sandbox = join(WORK, `sinov-${version}`);
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  if (existsSync(DB_FILE)) {
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    try { db.exec(`VACUUM INTO '${join(sandbox, 'palantir.db').replace(/'/g, "''")}'`); } finally { db.close(); }
  }
  const port = await freePort();
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    cwd: staging, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: bareEnv({ DOTENV: '0', PALANTIR_DRY_RUN: '1', DATA_DIR: sandbox, BACKUP_DIR: join(sandbox, 'backups'), BACKUP_KEEP: '0', PORT: String(port), LISTEN_HOST: '127.0.0.1', SESSION_SECRET: randomBytes(32).toString('hex') }),
  });
  let out = '';
  child.stdout.on('data', d => { out = (out + d).slice(-4000); });
  child.stderr.on('data', d => { out = (out + d).slice(-4000); });
  try {
    const ok = await Promise.race([healthy(port, version, PREFLIGHT_MS), new Promise(done => child.once('exit', () => done(false)))]);
    if (!ok) throw new Error(`yangi nashr sinovda ko'tarilmadi:\n${out.trim().split('\n').slice(-15).join('\n')}`);
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
    }
    await sleep(500);
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

const supervisor = args => spawnSync(process.execPath, ['scripts/supervise.mjs', ...args], { cwd: ROOT, stdio: 'ignore', windowsHide: true }).status;
const startSupervisor = () => spawn(process.execPath, ['scripts/supervise.mjs'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/**
 * Ko'chirish: nomini almashtirib (tez). Windows'da fayl bir lahza band bo'lishi mumkin (to'xtagan serverning esbuild jarayoni
 * hali yopilmoqda) — bir necha marta qayta uriniladi; boshqa diskda bo'lsa — nusxa olib
 */
function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try { renameSync(from, to); return; } catch (e) {
      if (e.code === 'EXDEV') break;
      if (attempt >= 20 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      pause(500);
    }
  }
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  rmSync(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

/** Eski ildiz ichidagi, relizga kirmaydigan fayllar (ish paytida paydo bo'lgan) — yangi ildizga. Qaytaradi: ko'chirilganlar */
function carryOver(backup, rel, tracked, moved) {
  const from = join(backup, rel);
  if (!statSync(from).isDirectory()) return;
  for (const name of readdirSync(from)) {
    const sub = `${rel}/${name}`, target = join(ROOT, sub);
    const isDir = statSync(join(from, name)).isDirectory();
    const known = isDir ? tracked.some(f => f.startsWith(`${sub}/`)) : tracked.includes(sub);
    if (!existsSync(target) && !known) { move(join(from, name), target); moved.push(sub); }
    else if (isDir && existsSync(target) && statSync(target).isDirectory()) carryOver(backup, sub, tracked, moved);
  }
}

function swap(staging, roots, tracked, backup) {
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  const moved = [];
  for (const r of roots) {
    if (existsSync(join(ROOT, r))) move(join(ROOT, r), join(backup, r));
    if (existsSync(join(staging, r))) move(join(staging, r), join(ROOT, r));
  }
  for (const r of roots) {
    if (WHOLE.has(r) || !existsSync(join(backup, r)) || !statSync(join(backup, r)).isDirectory()) continue;
    carryOver(backup, r, tracked, moved);
  }
  return moved;
}

function unswap(roots, backup, moved) {
  // Ish fayllari yangi ildizlardan eski joyiga — ildiz o'chirilganda ular yo'qolmasin
  for (const sub of moved) if (existsSync(join(ROOT, sub))) move(join(ROOT, sub), join(backup, sub));
  for (const r of roots) {
    if (!existsSync(join(backup, r))) continue;
    rmSync(join(ROOT, r), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    move(join(backup, r), join(ROOT, r));
  }
}

/** Yangi nashr bazani migratsiya qilgan bo'lsa — o'sha migratsiyadan oldingi nusxa qaytariladi */
function restoreDb(schemaBefore, since) {
  const now = userVersion(DB_FILE);
  if (now === null || now === schemaBefore) return 'baza o\'zgarmagan';
  const copies = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter(n => /^oldin-v\d+-.+\.db$/.test(n)).map(n => join(BACKUPS, n)).filter(f => statSync(f).mtimeMs >= since) : [];
  const copy = copies.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)[0];
  if (!copy) return `DIQQAT: baza v${now}, nusxasi topilmadi — qo'lda tiklang (BACKUP_DIR)`;
  for (const ext of ['-wal', '-shm']) rmSync(`${DB_FILE}${ext}`, { force: true });
  cpSync(copy, DB_FILE);
  return `baza v${now} → v${userVersion(DB_FILE)} (${copy})`;
}

async function main() {
  const check = process.argv.includes('--check');
  const from = currentVersion();
  const manifest = checkManifest(JSON.parse((await download(`${SOURCE}/manifest.json`)).toString('utf8')));
  if (!newer(manifest.version, from)) { log(`yangi nashr yo'q (joriy ${from}, relizda ${manifest.version})`); return 0; }
  log(`yangi nashr: ${from} → ${manifest.version}`);
  if (check) return 0;

  mkdirSync(WORK, { recursive: true });
  try { writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); } catch {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) { log('boshqa yangilovchi ishlab turibdi'); return 1; }
    writeFileSync(LOCK, String(process.pid));
  }
  try {
    const zip = await download(`${SOURCE}/${manifest.file}`);
    if (zip.length !== manifest.size || sha256(zip) !== manifest.sha256) throw new Error('arxiv manifestga mos emas (hajmi yoki sha256)');
    const staging = join(WORK, manifest.version);
    log(`arxiv tekshirildi, ochilmoqda: ${extract(zip, staging)} ta fayl`);
    const files = readJson(join(staging, 'files.json'));
    if (!files || files.version !== manifest.version || !Array.isArray(files.roots) || !files.roots.length) throw new Error("relizda files.json yo'q yoki buzuq");
    if (!files.roots.every(r => /^[^/\\]+$/.test(r) && r !== '.env' && r !== '..' && r !== '.')) throw new Error("files.json: ruxsat etilmagan ildiz");
    // Relizda kutubxonalar bo'lmasa (yengil reliz) — joriysi ishlatiladi
    if (!existsSync(join(staging, 'node_modules')) && existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(staging, 'node_modules'), 'junction');

    log('sinov: yangi nashr bazaning nusxasi bilan ko\'tarilmoqda');
    try { await preflight(staging, manifest.version); } catch (e) {
      saveState({ from, to: manifest.version, result: 'sinov', reason: e.message.slice(0, 500) });
      log(`sinovdan o'tmadi — yangilash bekor qilindi: ${e.message}`);
      return 2;
    }
    log('sinovdan o\'tdi');

    const old = readJson(join(ROOT, 'files.json'));
    // Eski ro'yxat bo'lmasa (qo'lda ko'chirilgan nusxa) — yangi relizdagi fayllar «ma'lum» sanaladi
    const tracked = Array.isArray(old?.files) ? old.files : files.files ?? [];
    const roots = [...new Set([...files.roots, 'files.json'])].filter(r => r !== 'node_modules' || !lstatSync(join(staging, 'node_modules')).isSymbolicLink());
    const schemaBefore = userVersion(DB_FILE);
    const since = Date.now();
    log('nazoratchi to\'xtatilmoqda');
    supervisor(['stop']);
    const backup = join(WORK, 'oldingi');
    const moved = swap(staging, roots, tracked, backup);
    log(`fayllar almashtirildi (${roots.length} ta ildiz; saqlangan ish fayllari: ${moved.length})`);
    startSupervisor();
    if (await healthy(PORT, manifest.version, HEALTHY_MS, HEALTHY_STREAK)) {
      saveState({ from, to: manifest.version, result: 'ok' });
      rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      log(`yangilandi: ${manifest.version}`);
      return 0;
    }

    log(`yangi nashr ${Math.round(HEALTHY_MS / 1000)} soniyada sog'lom bo'lmadi — eskisiga qaytarilmoqda`);
    supervisor(['stop']);
    unswap(roots, backup, moved);
    const db = restoreDb(schemaBefore, since);
    startSupervisor();
    const back = await healthy(PORT, from, HEALTHY_MS);
    saveState({ from, to: manifest.version, result: 'qaytarildi', reason: `yangi nashr ishga tushmadi; ${db}; eski nashr ${back ? 'ishlayapti' : 'HAM ISHLAMAYAPTI'}` });
    log(`eskisiga qaytarildi (${db}); eski nashr ${back ? 'ishlayapti' : 'HAM javob bermayapti — jurnalni ko\'ring'}`);
    return 3;
  } finally {
    rmSync(LOCK, { force: true });
  }
}

main().then(code => process.exit(code), e => {
  try { saveState({ from: currentVersion(), result: 'xato', reason: e.message.slice(0, 500) }); } catch { /* holat yozilmasa ham */ }
  log(`xato: ${e.message}`);
  process.exit(1);
});
