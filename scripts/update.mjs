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
 *      Relizda ovoz xizmati kutubxonalari (tgvoice/requirements.txt) o'zgargan bo'lsa — almashtirishdan oldin Python'ga o'rnatiladi (pip);
 *      o'rnatilmasa — yangilash bekor, eski kutubxonalar qaytariladi.
 *   5. Nazoratchi qayta yoqiladi; yangi nashr 3 daqiqada sog'lom bo'lmasa (oldin ishlagan Telegram bot, AI yoki telefon AI ishlamasa ham)
 *      — eski fayllar (va kutubxonalar) qaytariladi, baza migratsiyadan
 *      oldingi nusxadan (server/migrate.ts: BACKUP_DIR/oldin-v<N>-….db) tiklanadi.
 * Natija: DATA_DIR/yangilash/holat.json (hub holatida ko'rinadi). Jurnal: DATA_DIR/logs/yangilash.log
 * Chiqish kodi: 0 — yangilandi yoki yangisi yo'q; 1 — xato (hech narsa o'zgarmadi); 2 — sinovdan o'tmadi; 3 — eskisiga qaytarildi.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
  // Kichik bo'laklar: fflate bitta bo'lakdagi har faylda o'zini qayta chaqiradi — 1 MB da minglab mayda fayl (node_modules)
  // «Maximum call stack size exceeded» berardi (0.4.5, 29 ming fayl); 16 KB da chuqurlik kichik, tezlik deyarli o'zgarmaydi
  const step = 1 << 14;
  for (let i = 0; i < zip.length; i += step) unzip.push(zip.subarray(i, i + step), i + step >= zip.length);
  if (failure) throw failure;
  return count;
}

const freePort = () => new Promise(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

const health = async port => {
  try { return await (await fetch(`http://127.0.0.1:${port}/api/health?deep=1`, { signal: AbortSignal.timeout(10_000) })).json(); } catch { return null; }
};
/** Oxirgi sog'lik javobi: qaytarishda sababi aniq bo'lsin (nashr ko'tarildi, lekin bot ulanmadi) */
let lastHealth = null;

/**
 * Yangilashdan oldin ishlagan bo'lsa — yangi nashrda ham ishlashi shart bo'lganlar (server tirik, lekin bular o'lik — klinika ishlamaydi).
 * Eski nashrlar bularni aytmaydi (maydon yo'q) — talab ham yo'q
 */
const NEEDS = {
  botOnline: 'Telegram bot ulanmadi',
  aiReady: "AI ishlamayapti (Claude dasturi yoki obunaga kirish)",
  phoneAi: "telefon AI xizmati (sip_live.py) qo'ng'iroq qabul qilmayapti",
};
/** Hozir ishlayotganlar ro'yxati (sog'lik javobidan) */
const working = j => Object.keys(NEEDS).filter(k => j?.[k] === true);
/** Yangi nashrda ishlamay qolgani (birinchisi) — qaytarish sababi uchun */
const missing = (j, needs) => needs.find(k => j?.[k] !== true) ?? null;

/** needs — yangilashdan oldin ishlagan narsalar (working): yangi nashrda ham hammasi ishlashi shart */
async function healthy(port, version, ms, streak = 1, needs = []) {
  let good = 0;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1_000)) {
    const j = lastHealth = await health(port);
    good = j?.ok && j.version === version && !missing(j, needs) ? good + 1 : 0;
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

/**
 * Ovoz xizmati (tgvoice — telefon liniyasi, Telegram qo'ng'iroq) Python'i: TG_CALL_PYTHON (tgvoice\.venv yoki runtime\python).
 * Relizda kutubxonalar ro'yxati o'zgarsa — shu Python'ga o'rnatiladi, aks holda yangi sip_live.py eski kutubxonalar bilan yiqiladi (H1).
 * Telefon to'xtagan paytda o'rnatiladi: Windows'da ishlatilayotgan kutubxona faylini (.pyd) almashtirib bo'lmaydi.
 * TG_CALL_PYTHON .mjs bo'lsa — Node bilan (sinovdagi soxta pip)
 */
const PIP_TIMEOUT_MS = Number(process.env.UPDATE_PIP_MS) || 15 * 60_000;
const voicePython = () => { const p = process.env.TG_CALL_PYTHON?.trim(); return p && existsSync(p) ? p : null; };
const requirementsFile = dir => join(dir, 'tgvoice', 'requirements.txt');
const requirements = dir => { try { return readFileSync(requirementsFile(dir), 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return null; } };
/** Kutubxonalarni o'rnatadi; xato bo'lsa — qisqa sababi, bo'lmasa null */
function pipInstall(python, file) {
  const args = ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', file];
  const [cmd, argv] = /\.m?js$/i.test(python) ? [process.execPath, [python, ...args]] : [python, args];
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', timeout: PIP_TIMEOUT_MS, windowsHide: true });
  if (r.status === 0) return null;
  const said = String(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
  return (r.error?.message || said || `kod ${r.status}`).slice(0, 300);
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

/** Almashtirish yarim yo'lda yiqildi (papka band — EBUSY va h.k.): qaysi ildizlar va ish fayllari allaqachon ko'chgani bilan */
class SwapError extends Error {
  constructor(cause, done, moved) { super(cause.message); this.done = done; this.moved = moved; }
}

/**
 * Ildizlar almashtiriladi. Yiqilsa — SwapError (rollbackSwap shu bilan hammasini eski holiga qaytaradi): avval bir qismi almashib,
 * qolgani eski qolardi — dastur ishga tushmas, nazoratchi ham yoqilmasdi (C: da 2026-11-16 bo'lgan)
 */
function swap(staging, roots, tracked, backup) {
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  const moved = [], done = [];
  try {
    for (const r of roots) {
      const hadOld = existsSync(join(ROOT, r));
      if (hadOld) {
        try {
          move(join(ROOT, r), join(backup, r));
        } catch (e) {
          if (!inPlaceOk(e, staging, r)) throw e;
          // Papkaning o'zi band: joyida qoladi, ichidagilari birma-bir almashadi (2026-11-17, C: da IDE tgvoice/.venv ni kuzatib turgan)
          log(`${r}: papkaning o'zi band (${e.code}) — ichidagilari birma-bir almashtiriladi`);
          const entry = { root: r, hadOld, inPlace: true, added: [] };
          done.push(entry);
          moveChildren(join(ROOT, r), join(backup, r));
          if (existsSync(join(staging, r))) moveChildren(join(staging, r), join(ROOT, r), entry.added);
          continue;
        }
      }
      done.push({ root: r, hadOld });
      if (existsSync(join(staging, r))) move(join(staging, r), join(ROOT, r));
    }
    for (const r of roots) {
      if (WHOLE.has(r) || !existsSync(join(backup, r)) || !statSync(join(backup, r)).isDirectory()) continue;
      carryOver(backup, r, tracked, moved);
    }
  } catch (e) {
    throw new SwapError(e, done, moved);
  }
  return { moved, inPlace: done.filter(d => d.inPlace).map(d => d.root) };
}

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES']);
/** Ildizni joyida (ichidagilarini) almashtirsa bo'ladimi: band bo'lgani uchun ko'chmadi va eskisi ham, yangisi ham papka */
const inPlaceOk = (e, staging, r) => BUSY.has(e.code) && statSync(join(ROOT, r)).isDirectory()
  && (!existsSync(join(staging, r)) || statSync(join(staging, r)).isDirectory());
/** Papka ichidagilari boshqa papkaga (papkaning o'zi joyida qoladi). names — ko'chganlar nomi (yarim yo'lda qaytarish uchun) */
function moveChildren(from, to, names = []) {
  mkdirSync(to, { recursive: true });
  for (const n of readdirSync(from)) { move(join(from, n), join(to, n)); names.push(n); }
}
/** Joyida almashgan ildiz eski holiga: yangi kelganlari o'chadi, eskilari zaxiradan qaytadi */
function restoreInPlace(root, added, backup) {
  for (const n of added) rmSync(join(ROOT, root, n), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  if (existsSync(join(backup, root))) moveChildren(join(backup, root), join(ROOT, root));
}

/** Yarim yo'lda qolgan almashtirishni qaytaradi: ish fayllari eski joyiga, yangi ildizlar o'chadi, eskilari qaytadi (teskari tartibda) */
function rollbackSwap(err, backup) {
  for (const sub of err.moved) if (existsSync(join(ROOT, sub))) move(join(ROOT, sub), join(backup, sub));
  for (const { root, hadOld, inPlace, added } of [...err.done].reverse()) {
    if (inPlace) { restoreInPlace(root, added, backup); continue; }
    rmSync(join(ROOT, root), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    if (hadOld) move(join(backup, root), join(ROOT, root));
  }
}

/**
 * Telefon liniyasining WSL'i (Asterisk, sip_live.py yoqiq tutadigan jarayon) ichida joriy papkasi shu dastur papkasida bo'lgan jarayonlar
 * to'xtatiladi: Windows ularning papkasini ko'chira olmaydi (EBUSY). Telefon xizmati nazoratchi bilan birga qayta yonadi
 */
function releaseWslHandles() {
  if (process.platform !== 'win32') return;
  const neutral = { cwd: process.env.SystemRoot || undefined, windowsHide: true, timeout: 30_000 };
  const list = spawnSync('wsl.exe', ['-l', '-q'], { ...neutral, encoding: 'utf16le' });
  if (list.status !== 0) return;
  const have = String(list.stdout).replace(/\0/g, '').split(/\r?\n/).map(x => x.trim());
  const distro = process.env.WSL_DISTRO || (have.includes('Palantir') ? 'Palantir' : have.includes('Cerebro') ? 'Cerebro' : ''); // eski nom
  if (!distro || !have.includes(distro)) return;
  const linuxRoot = '/mnt/' + ROOT[0].toLowerCase() + ROOT.slice(2).replace(/\\/g, '/');
  const script = 'cd / && for p in /proc/[0-9]*; do c=$(readlink "$p/cwd" 2>/dev/null) || continue; case "$c" in "$1"|"$1"/*) n=$(basename "$p"); kill "$n" 2>/dev/null && echo "$n";; esac; done';
  const r = spawnSync('wsl.exe', ['-d', distro, '-u', 'root', '--exec', 'sh', '-c', script, 'sh', linuxRoot], { ...neutral, encoding: 'utf8' });
  const killed = String(r.stdout ?? '').trim().split(/\s+/).filter(Boolean);
  if (killed.length) log(`WSL (${distro}): dastur papkasini band qilgan ${killed.length} ta jarayon to'xtatildi`);
}

function unswap(roots, backup, moved, inPlace = []) {
  // Ish fayllari yangi ildizlardan eski joyiga — ildiz o'chirilganda ular yo'qolmasin
  for (const sub of moved) if (existsSync(join(ROOT, sub))) move(join(ROOT, sub), join(backup, sub));
  for (const r of roots) {
    if (!existsSync(join(backup, r))) continue;
    // Joyida almashgan papka o'chirilmaydi (u hali band bo'lishi mumkin): ichidagilari almashadi
    if (inPlace.includes(r)) { restoreInPlace(r, readdirSync(join(ROOT, r)), backup); continue; }
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
    // Eski nashrda bo'lib, yangisida yo'q ildizlar (tsconfig.json, index.html…) ham almashtiriladi — aks holda eskisi joyida qoladi
    const oldRoots = (Array.isArray(old?.roots) ? old.roots : []).filter(r => typeof r === 'string' && /^[^/\\]+$/.test(r) && !['.env', '..', '.', 'data', 'node_modules'].includes(r));
    const roots = [...new Set([...files.roots, ...oldRoots, 'files.json'])].filter(r => r !== 'node_modules' || !lstatSync(join(staging, 'node_modules')).isSymbolicLink());
    const schemaBefore = userVersion(DB_FILE);
    const since = Date.now();
    // Hozirgi nashrda bot, AI, telefon AI ishlayotgan bo'lsa — yangisida ham ishlashi kutiladi (H1)
    const needs = working(await health(PORT));
    if (needs.length) log(`yangi nashrda ham ishlashi kerak: ${needs.join(', ')}`);
    const python = voicePython(), reqOld = requirements(ROOT), reqNew = requirements(staging);
    const pipNeeded = !!python && reqNew !== null && reqNew !== reqOld;
    /** Eski kutubxonalar qaytariladi (yangilash bekor yoki eskisiga qaytildi) — jurnal/holat uchun natija */
    const pipBack = () => {
      if (!pipNeeded || reqOld === null) return '';
      const e = pipInstall(python, requirementsFile(ROOT));
      return e ? `; eski kutubxonalar HAM tiklanmadi: ${e}` : '; eski kutubxonalar tiklandi';
    };
    log('nazoratchi to\'xtatilmoqda');
    supervisor(['stop']);
    if (pipNeeded) {
      log('ovoz xizmati kutubxonalari yangilanmoqda (tgvoice/requirements.txt o\'zgargan — pip)');
      const err = pipInstall(python, requirementsFile(staging));
      if (err) {
        const back = pipBack();
        startSupervisor();
        const reason = `ovoz xizmati kutubxonalari o'rnatilmadi (pip): ${err}${back}`;
        saveState({ from, to: manifest.version, result: 'sinov', reason });
        log(`yangilash bekor qilindi — ${reason}`);
        return 2;
      }
      log('kutubxonalar o\'rnatildi');
    }
    const backup = join(WORK, 'oldingi');
    releaseWslHandles();
    let moved, inPlace;
    try {
      ({ moved, inPlace } = swap(staging, roots, tracked, backup));
    } catch (e) {
      // Yarim yo'lda — almashganlari qaytariladi, eski nashr qayta yoqiladi (aks holda klinikada Palantir o'chiq qolardi)
      let back = 'eski fayllar tiklandi';
      try { if (e instanceof SwapError) rollbackSwap(e, backup); } catch (r) { back = `eski fayllarni ham tiklab bo'lmadi: ${r.message} — qo'lda: ${backup}`; }
      back += pipBack();
      startSupervisor();
      const reason = `fayllarni almashtirib bo'lmadi: ${e.message}; ${back}`;
      saveState({ from, to: manifest.version, result: 'xato', reason });
      log(`yangilash bekor qilindi — ${reason}`);
      return 1;
    }
    log(`fayllar almashtirildi (${roots.length} ta ildiz; saqlangan ish fayllari: ${moved.length})`);
    startSupervisor();
    if (await healthy(PORT, manifest.version, HEALTHY_MS, HEALTHY_STREAK, needs)) {
      saveState({ from, to: manifest.version, result: 'ok' });
      rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      log(`yangilandi: ${manifest.version}`);
      return 0;
    }

    const down = lastHealth?.ok && lastHealth.version === manifest.version ? missing(lastHealth, needs) : null;
    const why = down ? `yangi nashrda ${NEEDS[down]}` : 'yangi nashr ishga tushmadi';
    log(`${why} (${Math.round(HEALTHY_MS / 1000)} soniya kutildi) — eskisiga qaytarilmoqda`);
    supervisor(['stop']);
    unswap(roots, backup, moved, inPlace);
    const db = `${restoreDb(schemaBefore, since)}${pipBack()}`;
    startSupervisor();
    const back = await healthy(PORT, from, HEALTHY_MS);
    saveState({ from, to: manifest.version, result: 'qaytarildi', reason: `${why}; ${db}; eski nashr ${back ? 'ishlayapti' : 'HAM ISHLAMAYAPTI'}` });
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
