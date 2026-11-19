/**
 * Nazoratchi: Palantir serverini ishga tushiradi va to'xtab qolsa qayta yoqadi (klinikadagi kompyuterda qarovsiz ishlash uchun).
 *   node scripts/supervise.mjs         — ishga tushirish (oyna yopilguncha yoki «stop» buyrug'igacha ishlaydi)
 *   node scripts/supervise.mjs stop    — ishlab turgan nazoratchi va serverni tinch to'xtatish
 *   node scripts/supervise.mjs status  — ishlayaptimi
 * Telefon liniyasi (tgvoice/sip_live.py — Asterisk WSL'da ↔ Gemini Live) sozlangan bo'lsa (.env: SIP_OWNER_PASSWORD va TG_CALL_PYTHON),
 * u ham shu yerda yoqiladi va kuzatiladi: AI qabulxona kechasi ham, qarovsiz ishlaydi. Jurnali — DATA_DIR\logs\telefon.log
 * Oddiy Node skripti (tsx kerak emas): server buzilgan bo'lsa ham nazoratchi ishlaydi va sababini jurnalga yozadi.
 * Yangilash: har kecha UPDATE_HOUR da (standart 3:00; kompyuter o'sha payt o'chiq bo'lgan bo'lsa — yonganidan 5 daqiqa keyin)
 * yangilovchi (scripts/update.mjs) alohida jarayonda ishga tushadi — yangi nashr
 * bo'lsa u nazoratchini o'zi to'xtatib, fayllarni almashtirib, qayta yoqadi. Dasturchi nusxasida (.git bor) va UPDATE_AUTO=0 da — o'chiq.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
if (existsSync('.env')) process.loadEnvFile('.env');

const DATA = resolve(process.env.DATA_DIR || 'data');
const LOGS = join(DATA, 'logs');
const PID_FILE = join(DATA, 'supervisor.pid');
const STOP_FILE = join(DATA, 'palantir.stop');
/** Server shu kod bilan chiqsa — shu papka bilan boshqa nusxa ishlayapti (server/guard.ts): tez-tez qayta yoqishning foydasi yo'q */
const EXIT_DO_NOT_RESTART = 78;
const RESTART_MIN_MS = 2_000, RESTART_MAX_MS = 60_000;
/** Shuncha ishlagan server «sog'lom» sanaladi: keyingi to'xtashda kutish yana qisqadan boshlanadi */
const HEALTHY_MS = 60_000;
const STOP_POLL_MS = 1_000, STOP_WAIT_MS = 8_000;
/**
 * Nazoratchi PID faylini shu oraliqda «yangilab» turadi; shuncha vaqt yangilanmagan fayl — eskirgan.
 * Tok o'chib-yonganda eski fayl qoladi va undagi raqam boshqa dasturga o'tgan bo'lishi mumkin: faqat raqamga qarab
 * «ishlab turibdi» deyilsa Palantir umuman yonmay qolardi, «stop» esa begona dasturni yopib yuborardi
 */
const BEAT_MS = 5_000, STALE_MS = 30_000;

mkdirSync(LOGS, { recursive: true });
const log = text => {
  const d = new Date(), two = n => String(n).padStart(2, '0');
  // Mahalliy vaqt — server jurnali bilan bir xil
  const line = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${text}`;
  console.log(line);
  try { appendFileSync(join(LOGS, 'supervisor.log'), `${line}\n`); } catch { /* jurnal yozilmasa ham ishlayveradi */ }
};
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const runningPid = () => {
  try {
    if (Date.now() - statSync(PID_FILE).mtimeMs > STALE_MS) return 0;
    const pid = Number(readFileSync(PID_FILE, 'utf8'));
    return pid && pid !== process.pid && alive(pid) ? pid : 0;
  } catch { return 0; }
};
/** Faqat o'z PID faylini o'chiradi (o'rniga kelgan boshqa nazoratchinikiga tegmaydi) */
const dropPid = () => {
  try { if (Number(readFileSync(PID_FILE, 'utf8')) === process.pid) rmSync(PID_FILE, { force: true }); } catch { /* fayl yo'q */ }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const command = process.argv[2] ?? 'run';

if (command === 'status') {
  const pid = runningPid();
  console.log(pid ? `Palantir ishlayapti (nazoratchi jarayoni ${pid})` : 'Palantir ishlamayapti');
  process.exit(pid ? 0 : 1);
}

if (command === 'stop') {
  const pid = runningPid();
  if (!pid) {
    console.log('Palantir ishlamayapti');
    process.exit(0);
  }
  writeFileSync(STOP_FILE, String(Date.now()));
  for (let waited = 0; waited < STOP_WAIT_MS + 4_000 && alive(pid); waited += 250) await sleep(250);
  // Majburan yopish — faqat fayl hali ham yangi bo'lsa (ya'ni bu haqiqatan nazoratchi va u hali tirik)
  if (runningPid() === pid) {
    // Nazoratchi javob bermadi: Windows'da bolalari (server) bilan birga yopiladi
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else try { process.kill(pid); } catch { /* shu orada o'zi to'xtagan */ }
  }
  rmSync(STOP_FILE, { force: true });
  console.log("Palantir to'xtatildi");
  process.exit(0);
}

if (runningPid()) {
  console.log(`Palantir allaqachon ishlab turibdi (nazoratchi jarayoni ${runningPid()}). To'xtatish: node scripts/supervise.mjs stop`);
  process.exit(0);
}
// Eskirgan fayl o'chiriladi; «wx» — ikki nazoratchi bir vaqtda boshlansa faqat bittasi yozadi
rmSync(PID_FILE, { force: true });
try {
  writeFileSync(PID_FILE, String(process.pid), { flag: 'wx' });
} catch {
  console.log('Palantir allaqachon ishga tushirilmoqda (boshqa nazoratchi)');
  process.exit(0);
}
rmSync(STOP_FILE, { force: true });
setInterval(() => {
  const now = new Date();
  try { utimesSync(PID_FILE, now, now); } catch { /* fayl o'chirilgan — keyingi ishga tushirish o'zi hal qiladi */ }
}, BEAT_MS);

let child = null;
let stopping = false;

const PHONE_SCRIPT = join(ROOT, 'tgvoice', 'sip_live.py');
const PHONE_PYTHON = process.env.TG_CALL_PYTHON;
const phoneEnabled = !!(process.env.SIP_OWNER_PASSWORD && PHONE_PYTHON && existsSync(PHONE_PYTHON) && existsSync(PHONE_SCRIPT));
let phone = null;

/** Telefon liniyasi: to'xtab qolsa — server kabi kutib qayta yoqiladi */
async function keepPhone() {
  for (let wait = RESTART_MIN_MS; !stopping;) {
    const startedAt = Date.now();
    const out = openSync(join(LOGS, 'telefon.log'), 'a');
    phone = spawn(PHONE_PYTHON, ['-X', 'faulthandler', PHONE_SCRIPT], { cwd: dirname(PHONE_SCRIPT), stdio: ['ignore', out, out], windowsHide: true });
    const code = await new Promise(done => {
      phone.once('exit', (c, signal) => done(c ?? signal ?? 1));
      phone.once('error', e => { log(`telefon liniyasi ishga tushmadi: ${e.message}`); done(1); });
    });
    closeSync(out);
    if (stopping) break;
    if (Date.now() - startedAt >= HEALTHY_MS) wait = RESTART_MIN_MS;
    log(`telefon liniyasi to'xtadi (kod: ${code}) — ${Math.round(wait / 1000)} soniyadan keyin qayta yoqiladi`);
    await sleep(wait);
    wait = Math.min(wait * 2, RESTART_MAX_MS);
  }
}

/** Liniya o'zining yordamchi jarayonlari (WSL'ni yoqiq tutuvchi) bilan birga yopiladi */
function stopPhone() {
  if (!phone || phone.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(phone.pid), '/T', '/F'], { stdio: 'ignore' });
  else phone.kill();
  rescueCalls();
}

/** To'xtatilgan telefon xizmatining jonli qo'ng'iroqlari — administratorga ([yordam]: jiringlaydi, ko'tarilmasa uzr va so'rov); aks holda mijoz
 * go'shak qo'ymaguncha jimlikda qoladi (Asterisk 20.6 AI ulanishi uzilganini sezmaydi). Yangilanishda yangi nashr ham ishga tushganda qutqaradi */
const RESCUE_TIMEOUT_MS = 30_000;
function rescueCalls() {
  const out = openSync(join(LOGS, 'telefon.log'), 'a');
  try {
    spawnSync(PHONE_PYTHON, ['-X', 'utf8', PHONE_SCRIPT, '--rescue'], { cwd: dirname(PHONE_SCRIPT), stdio: ['ignore', out, out], windowsHide: true, timeout: RESCUE_TIMEOUT_MS });
  } catch { /* qutqarib bo'lmadi — yangi ishga tushishda qutqaradi */ } finally { closeSync(out); }
}

/** Serverga «tinch to'xta» deyiladi (yozilayotgan narsa oxiriga yetsin); vaqtida to'xtamasa — majburan */
async function stop(reason) {
  if (stopping) return;
  stopping = true;
  log(`to'xtatilmoqda: ${reason}`);
  const c = child;
  if (c && c.exitCode === null) {
    try { c.send('stop'); } catch { /* aloqa kanali yopilgan */ }
    for (let waited = 0; waited < STOP_WAIT_MS && c.exitCode === null; waited += 100) await sleep(100);
    if (c.exitCode === null) c.kill();
  }
  stopPhone();
  dropPid();
  rmSync(STOP_FILE, { force: true });
  process.exit(0);
}
process.on('SIGINT', () => { void stop("oyna yopildi yoki Ctrl+C"); });
process.on('SIGTERM', () => { void stop('tizim buyrug\'i'); });
process.on('SIGHUP', () => { void stop('oyna yopildi'); });
setInterval(() => { if (existsSync(STOP_FILE)) void stop("«stop» buyrug'i"); }, STOP_POLL_MS);

const UPDATE_HOUR = process.env.UPDATE_HOUR ? Number(process.env.UPDATE_HOUR) : 3;
const UPDATE_AUTO = process.env.UPDATE_AUTO !== '0' && !existsSync(join(ROOT, '.git'));
const UPDATE_STAMP = join(DATA, 'yangilash', 'tekshirildi.txt');
/**
 * Kechasi o'chiriladigan kompyuter UPDATE_HOUR ni hech qachon ko'rmaydi: oxirgi tekshiruvdan shuncha o'tgan bo'lsa — kompyuter
 * yonganidan UPDATE_BOOT_DELAY_MS keyin tekshiriladi (kunduzi ishlab turgan kompyuterda 3:00 dagi tekshiruv bilan ustma-ust tushmasin — 24,5 soat)
 */
const UPDATE_MISSED_MS = 24.5 * 3600_000;
const UPDATE_BOOT_DELAY_MS = 5 * 60_000;
const SUPERVISOR_STARTED = Date.now();
/** Tekshirish vaqti keldimi: belgilangan soatda kuniga bir marta yoki tekshiruv o'tkazib yuborilgan bo'lsa (sof hisob) */
const updateDue = ({ now, lastDay, lastAt, startedAt }) => {
  const two = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  if (now.getHours() === UPDATE_HOUR) return lastDay !== today;
  return now.getTime() - startedAt >= UPDATE_BOOT_DELAY_MS && now.getTime() - lastAt > UPDATE_MISSED_MS;
};
/** Kuniga bir marta, belgilangan soatda (yoki o'tkazib yuborilgan bo'lsa — yonganda): yangilovchi nazoratchidan mustaqil (detached) — u nazoratchini to'xtatganda o'zi tirik qoladi */
function maybeUpdate() {
  const now = new Date(), two = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  if (stopping) return;
  let lastDay = '', lastAt = 0;
  try { lastDay = readFileSync(UPDATE_STAMP, 'utf8').trim(); lastAt = statSync(UPDATE_STAMP).mtimeMs; } catch { /* hali tekshirilmagan */ }
  if (!updateDue({ now, lastDay, lastAt, startedAt: SUPERVISOR_STARTED })) return;
  mkdirSync(dirname(UPDATE_STAMP), { recursive: true });
  writeFileSync(UPDATE_STAMP, today);
  log('yangi nashr tekshirilmoqda (scripts/update.mjs, jurnali: logs/yangilash.log)');
  spawn(process.execPath, ['scripts/update.mjs'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
if (UPDATE_AUTO) setInterval(maybeUpdate, 60_000);

log(`nazoratchi ishga tushdi (papka: ${ROOT}, ma'lumotlar: ${DATA}${UPDATE_AUTO ? `, yangilash har kuni ${UPDATE_HOUR}:00 da` : ''})`);
if (phoneEnabled) {
  log('telefon liniyasi ham yoqiladi (tgvoice/sip_live.py)');
  void keepPhone();
}
/**
 * Server xatolari (stderr) yo'qolmasin: logs/server-xato.log ga yoziladi, oxirgi qatorlari server yiqilganda supervisor.log ga.
 * Avval stderr ko'rinmas oynaga ketardi — server yiqilsa sababi hech qayerda qolmasdi (2026-11-19)
 */
const ERR_TAIL = 15;
function keepStderr(proc) {
  const tail = [];
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', chunk => {
    try { process.stderr.write(chunk); } catch { /* oyna yo'q */ }
    const d = new Date(), two = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    const lines = chunk.split(/\r?\n/).filter(l => l.trim());
    try { appendFileSync(join(LOGS, 'server-xato.log'), lines.map(l => `${stamp} ${l}\n`).join('')); } catch { /* jurnal yozilmasa ham */ }
    tail.push(...lines.map(l => l.slice(0, 400)));
    tail.splice(0, Math.max(0, tail.length - ERR_TAIL));
  });
  return tail;
}
for (let wait = RESTART_MIN_MS; !stopping;) {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });
  const lastErr = keepStderr(child);
  const code = await new Promise(done => {
    child.once('exit', (c, signal) => done(c ?? signal ?? 1));
    child.once('error', e => { log(`server ishga tushmadi: ${e.message}`); done(1); });
  });
  if (stopping) break;
  if (code === EXIT_DO_NOT_RESTART) {
    // Shu papka bilan boshqa nusxa ishlab turibdi (masalan, oldingi nazoratchi majburan yopilgan, serveri qolgan).
    // Nazoratchi ketmaydi: o'sha nusxa to'xtasa — o'rnini oladi; ungacha siyrak tekshiradi
    if (wait !== RESTART_MAX_MS) log("shu papka bilan boshqa nusxa ishlab turibdi — u to'xtaguncha kutiladi (har daqiqada tekshiriladi)");
    wait = RESTART_MAX_MS;
    await sleep(wait);
    continue;
  }
  if (Date.now() - startedAt >= HEALTHY_MS) wait = RESTART_MIN_MS;
  const why = lastErr.length ? `; oxirgi xato (logs/server-xato.log):\n  ${lastErr.join('\n  ')}` : '';
  log(`server to'xtadi (kod: ${code}) — ${Math.round(wait / 1000)} soniyadan keyin qayta yoqiladi${why}`);
  await sleep(wait);
  wait = Math.min(wait * 2, RESTART_MAX_MS);
}
