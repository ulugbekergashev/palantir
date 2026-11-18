/**
 * Masofadan amallar — klinika tomoni (hub tomoni — hub/commands.ts, hub/server.ts 17-band). Palantir jamoasi /admin dagi mijoz kartasidan
 * buyruq beradi; u Hub navbati orqali keladi (command, inbox/instagramApi.ts) va shu yerda bajariladi:
 *   diag    — diagnostika (server/diagnostics.ts: holat va jurnallar, parol va kalitlarsiz; telefon raqamlari va @nomlar niqoblanadi) Hub'ga ketadi;
 *   restart — Palantir serveri tinch to'xtaydi, nazoratchi (scripts/supervise.mjs) uni 2 soniyada qayta yoqadi;
 *   update  — yangilovchi (scripts/update.mjs) hozir ishga tushadi: imzolangan relizni tekshiradi, sinaydi, ishlamasa eskisiga qaytaradi;
 *   message — egasiga Telegram'da va panel jurnalida xabar;
 *   phone   — telefon xizmatini (WSL + Asterisk) o'rnatish, administrator so'rovisiz va ekranda hech narsa ochmasdan (voice/phoneInstall.ts).
 *             Natija o'rnatish TUGAGANDA ketadi (5–15 daqiqa, sekin internetda ko'proq). Palantir shu orada qayta yonsa — yonganda kutishni
 *             davom ettiradi (resumePhoneInstall). WSL birinchi marta yoqilsa — «qayta yoqish kerak»;
 *   reboot  — kompyuterni 1 daqiqadan keyin qayta yoqish (shutdown /r). Yonganda telefon o'rnatishi o'zi davom etadi.
 * Har amal egasiga aytiladi (jamoa nima qilganini bilsin). Natija Hub'ga qaytadi (POST /api/command/<id>).
 *
 * Bir buyruq bir marta: id bazaga bajarishdan OLDIN yoziladi. Qayta ishga tushgan server navbatni boshidan o'qiydi — o'sha buyruq yana
 * kelsa bajarilmaydi, faqat avvalgi natijasi qayta yuboriladi (Hub uni navbatdan oladi). Eskirgan qayta ishga tushirish va yangilashni
 * Hub o'zi bermaydi (o'z soati bilan — klinika soati noto'g'ri bo'lishi mumkin).
 * Telefonda suhbat ketayotgan bo'lsa, qayta ishga tushirish va yangilash u tugashini kutadi (CALL_WAIT_MS); tugamasa — bajarilmaydi
 * (suhbatni uzgandan ko'ra jamoa keyinroq qayta bossin). Yangilash ketayotganda qayta ishga tushirilmaydi.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './botKit';
import { businesses, sql, type BusinessRow } from './db';
import { diagnostics } from './diagnostics';
import { env } from './env';
import { fitBytes } from './fitBytes';
import { notifyOwner } from './inbox/core';
import { events } from './orders/store';
import { lineBusy } from './voice/lineCalls';
import { markInstallFailed, readInstallState, startRemoteInstall, type InstallState } from './voice/phoneInstall';
import { isCommandAction, MESSAGE_MAX, PHONE_FRESH_MS, type CommandAction } from '../hub/commands';

/**
 * Hub so'rov tanasini 1 MB gacha qabul qiladi; JSON'da qator tashlash, qo'shtirnoq va kirill harflari (UTF-8 da 2 bayt) kengayadi —
 * zaxira bilan yarmi
 */
const DIAG_MAX_BYTES = 300_000;
const CALL_WAIT_MS = 15 * 60_000;
const CALL_POLL_MS = 15_000;
const NOTIFY_TIMEOUT_MS = 15_000;
const REPORT_TRIES = 3;
const KEEP_ROWS = 200;
/** Telefon xizmatini o'rnatish: holat fayli shu oraliqda o'qiladi; vazifa shuncha vaqtda boshlanmasa — ishga tushmagan */
const INSTALL_POLL_MS = 15_000;
const INSTALL_START_MS = 3 * 60_000;
/** Holat faylidagi vaqt bilan buyruq vaqti orasidagi farq (ikkalasi shu kompyuter soati, lekin yaxlitlash bor) */
const CLOCK_SLACK_MS = 2_000;
const REBOOT_DELAY_S = 60;

sql.exec('CREATE TABLE IF NOT EXISTS hub_commands (id TEXT PRIMARY KEY, action TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER, note TEXT)');

export interface HubCommand { id: string; action: CommandAction; text: string | null; by: string | null }
export interface CommandResult { ok: boolean; note: string; diag?: string }

/** Tashqi ishlar — sinovda almashtiriladi */
export interface CommandDeps {
  /** Natijani Hub'ga yuborish */
  report: (id: string, r: CommandResult) => Promise<void>;
  /** Nazoratchi ostida ishlayaptimi (u server to'xtasa qayta yoqadi) */
  supervised: () => boolean;
  /** Tinch to'xtash (server/main.ts shutdown) — nazoratchi qayta yoqadi */
  restart: () => void;
  /** Yangilovchi hozir ishlayaptimi (fayllar almashtirilayotgan bo'lishi mumkin) */
  updating: () => boolean;
  /** Yangilovchini alohida jarayonda ishga tushirish; bo'lmasa — sababi */
  startUpdate: () => string | null;
  lineBusy: () => boolean;
  sleep: (ms: number) => Promise<void>;
  /** Egasiga Telegram'da; yetkazilmasa — null */
  notify: (biz: BusinessRow, html: string) => Promise<unknown>;
  /** Telefon xizmatini o'rnatish vazifasini ishga tushirish; bo'lmasa — sababi */
  phoneStart: () => Promise<string | null>;
  /** O'rnatish holati (tgvoice/telefon-ornatish.json); hali o'rnatilmagan bo'lsa — null */
  phoneState: () => InstallState | null;
  /** Holatni «o'rnatilmadi» qilib yopish (davom ettirib bo'lmadi) */
  phoneFail: (note: string) => void;
  /** Kompyuterni REBOOT_DELAY_S soniyadan keyin qayta yoqish; bo'lmasa — sababi */
  reboot: () => string | null;
  now: () => number;
}

/** Dastur ildizi — scripts/update.mjs bilan bir xil usulda (ish papkasiga bog'liq emas): server/ yoki app/ ning bir yuqorisi */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(env.dataDir, 'yangilash', 'yangilash.lock');

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Yangilovchi qulfi bor va uning jarayoni tirik (yiqilgan yangilovchining qulfi — eskirgan, update.mjs o'zi tozalaydi) */
function updating(): boolean {
  try { const pid = Number(readFileSync(LOCK, 'utf8')); return !!pid && alive(pid); } catch { return false; }
}

/** Yangilovchini ishga tushirish sharti — nazoratchidagi kechki yangilash bilan bir xil (scripts/supervise.mjs UPDATE_AUTO) */
function startUpdate(): string | null {
  if (existsSync(join(ROOT, '.git'))) return "Bu dasturchi nusxasi (.git bor) — u o'zi yangilanmaydi";
  if (process.env.UPDATE_AUTO === '0') return "Bu kompyuterda yangilash o'chirilgan (UPDATE_AUTO=0)";
  if (updating()) return 'Yangilash allaqachon ketyapti';
  const script = join(ROOT, 'scripts', 'update.mjs');
  if (!existsSync(script)) return 'Yangilovchi topilmadi (scripts/update.mjs)';
  const child = spawn(process.execPath, [script], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', e => console.error("[hub buyrug'i] yangilovchi ishga tushmadi:", e.message));
  child.unref();
  return null;
}

async function report(id: string, r: CommandResult): Promise<void> {
  const hub = env.hub;
  if (!hub) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${hub.url}/api/command/${id}`, {
        method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify(r), signal: AbortSignal.timeout(30_000),
      });
      // 404 — Hub bu buyruqni bilmaydi (mijoz o'chirilgan): qayta urinishning foydasi yo'q
      if (res.ok || res.status === 404) return;
      throw new Error(`hub ${res.status}`);
    } catch (e) {
      if (attempt >= REPORT_TRIES) throw e;
      await new Promise(done => setTimeout(done, attempt * 2_000));
    }
  }
}

/**
 * Kompyuterni qayta yoqish: 1 daqiqa kutib (natija Hub'ga yetib boradi, ekranda ogohlantirish chiqadi). Oddiy foydalanuvchi ham qila oladi
 * (Windows ish stoli nashrlarida). Dasturchi nusxasida — yo'q: sinov yoki Hub xatosi dasturchining kompyuterini o'chirmasin
 */
function reboot(): string | null {
  if (process.platform !== 'win32') return "Kompyuterni qayta yoqish faqat Windows klinika kompyuterida";
  if (existsSync(join(ROOT, '.git'))) return "Bu dasturchi nusxasi (.git bor) — kompyuter qayta yoqilmaydi";
  const r = spawnSync('shutdown.exe', ['/r', '/t', String(REBOOT_DELAY_S), '/d', 'p:4:1', '/c', 'Palantir: kompyuter 1 daqiqadan keyin qayta yonadi (Palantir jamoasi)'], { windowsHide: true, timeout: 15_000 });
  if (r.error) return `Qayta yoqib bo'lmadi: ${r.error.message}`;
  // 1190 — qayta yoqish allaqachon rejalashtirilgan
  return r.status === 0 || r.status === 1190 ? null : `Windows qayta yoqishni rad etdi (shutdown kodi ${r.status})`;
}

const defaults: CommandDeps = {
  report,
  supervised: () => typeof process.send === 'function' && process.connected,
  // server/main.ts nazoratchidan kelgan «stop» xabarini shu yo'l bilan tinglaydi — o'sha tinch to'xtash (yozilayotgani oxiriga yetadi)
  restart: () => { process.emit('message', 'stop', undefined); },
  updating,
  startUpdate,
  lineBusy: () => lineBusy(),
  sleep: ms => new Promise(done => setTimeout(done, ms)),
  notify: (biz, html) => notifyOwner(biz, html),
  phoneStart: startRemoteInstall,
  phoneState: readInstallState,
  phoneFail: note => markInstallFailed(note),
  reboot,
  now: () => Date.now(),
};

/** Navbatdagi yuk: noto'g'ri bo'lsa — null (eski yoki buzilgan) */
export function parseCommand(payload: unknown): HubCommand | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const id = String(p.id ?? '');
  if (!/^[0-9a-f]{12}$/.test(id) || !isCommandAction(p.action)) return null;
  const text = typeof p.text === 'string' ? p.text.trim().slice(0, MESSAGE_MAX) : '';
  if (p.action === 'message' && !text) return null;
  const by = typeof p.by === 'string' ? p.by.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || null : null;
  return { id, action: p.action, text: text || null, by };
}

/**
 * Diagnostika egasining so'rovisiz olinadi — jurnallarda mijozni tanitadigan narsa qolmasin: telefon raqamlari (oxirgi 2 raqami qoladi)
 * va Telegram/Instagram @nomlari niqoblanadi. Parol va kalitlarni diagnostics.ts o'zi tozalaydi
 */
const hide = (m: string) => `•••${m.replace(/\D/g, '').slice(-2)}`;
export const maskPeople = (text: string): string => text
  // Xalqaro (+ bilan): +998 90 123-45-67, +7 (912) 345-67-89
  .replace(/\+\d[\d ()-]{7,}\d/g, hide)
  // O'zbek raqami yozilgan ko'rinishda (90 123 45 67, 998 90 123-45-67) — sana va vaqt (2026-11-16 10:00:01) bunga o'xshamaydi
  .replace(/(?<![\d-])(?:998[ -]?)?\(?\d{2}\)?[ -]\d{3}[ -]\d{2}[ -]\d{2}(?![\d-])/g, hide)
  // Qo'shib yozilgan: 901234567, 998901234567
  .replace(/(?<![\w.:-])(?:998)?\d{9}(?![\w.:-])/g, hide)
  .replace(/(^|[^\w@.])@[A-Za-z][\w.]{3,}/g, '$1@•••');

const team = (by: string | null) => (by ? `Palantir jamoasidan ${esc(by)}` : 'Palantir jamoasi');
const active = () => businesses.all().filter(b => b.active);
/** Telegram osilib qolsa ham buyruq kutib qolmasin */
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>(done => setTimeout(() => done(null), ms))]);

/** Hamma faol biznes egasiga (bitta kompyuterda bir nechta biznes bo'lishi mumkin) — Telegram va panel jurnali. Qaytaradi: Telegram'da yetganlar soni */
async function tellOwners(deps: CommandDeps, html: string, title: string, body = ''): Promise<number> {
  let delivered = 0;
  for (const biz of active()) {
    try { events.add(biz.id, { member: 'yordamchi', orderId: null, level: 'info', title, body, cameraId: null }); } catch (e) { console.error("[hub buyrug'i] jurnalga yozilmadi:", (e as Error).message); }
    if (await withTimeout(Promise.resolve().then(() => deps.notify(biz, html)), NOTIFY_TIMEOUT_MS) != null) delivered++;
  }
  return delivered;
}

/** Suhbat tugashini kutadi (CALL_WAIT_MS gacha). Qaytaradi: kutgan daqiqalar; tugamagan bo'lsa — null */
async function waitForCall(deps: CommandDeps): Promise<number | null> {
  let waited = 0;
  while (deps.lineBusy()) {
    if (waited >= CALL_WAIT_MS) return null;
    await deps.sleep(CALL_POLL_MS);
    waited += CALL_POLL_MS;
  }
  return Math.round(waited / 60_000);
}
const STILL_TALKING = `Telefonda suhbat ${CALL_WAIT_MS / 60_000} daqiqadan beri tugamadi — uzmaslik uchun bajarilmadi, keyinroq qayta bosing`;
const waitedNote = (m: number) => (m ? ` (qo'ng'iroq tugashini ${m} daqiqa kutdi)` : '');

interface InstallOutcome { result: CommandResult; owner: string | null }
/** O'rnatish holatidan — Hub'ga natija va egasiga xabar */
function installOutcome(s: InstallState): InstallOutcome {
  const at = s.step ? ` («${s.step}» qadamida)` : '';
  if (s.phase === 'done') return { result: { ok: true, note: s.note || "Telefon xizmati o'rnatildi" }, owner: "✅ Telefon xizmati o'rnatildi — endi shahar raqami ulanishi mumkin." };
  if (s.phase === 'failed') return { result: { ok: false, note: `O'rnatilmadi${at}: ${s.note}` }, owner: null };
  if (s.phase === 'reboot') {
    return { result: { ok: true, note: "WSL yoqildi — kompyuterni qayta yoqish kerak: «Kompyuterni qayta yoqish» ni bosing. Yonganidan keyin o'rnatish o'zi davom etadi, natija kartadagi «Telefon xizmati» qatorida" }, owner: null };
  }
  return { result: { ok: false, note: `O'rnatish to'xtab qoldi${at} — kompyuter o'chgan yoki jarayon yopilgan. Qayta bosing: qolgan joyidan davom etadi` }, owner: null };
}

/**
 * O'rnatish tugashini kutadi. since — shu paytdan keyin yozilgan holatgina hisobga olinadi (eski «tugadi» yangi o'rnatishning natijasi emas).
 * INSTALL_START_MS da yangi holat yozilmasa — vazifa ishga tushmagan
 */
async function awaitInstall(deps: CommandDeps, since: number): Promise<InstallOutcome> {
  for (let waited = 0; ; waited += INSTALL_POLL_MS) {
    const s = deps.phoneState();
    const fresh = !!s && Date.parse(s.at) >= since - CLOCK_SLACK_MS;
    if (s && fresh && s.phase !== 'running') return installOutcome(s);
    if (!fresh && waited >= INSTALL_START_MS) return { result: { ok: false, note: "O'rnatish boshlanmadi — Windows vazifasi (PalantirTelefon) ishga tushmadi. Diagnostikani oling" }, owner: null };
    if (waited >= PHONE_FRESH_MS) return { result: { ok: false, note: `O'rnatish ${PHONE_FRESH_MS / 3_600_000} soatda tugamadi${s?.step ? ` («${s.step}» qadamida)` : ''} — diagnostikani oling` }, owner: null };
    await deps.sleep(INSTALL_POLL_MS);
  }
}

async function installPhone(cmd: HubCommand, deps: CommandDeps): Promise<CommandResult> {
  if (deps.updating()) return { ok: false, note: "Yangilash ketyapti — tugagach qayta bosing" };
  // Allaqachon o'rnatilyapti (boshqa buyruq yoki qayta yonganda davom etgani) — ikkinchisi boshlanmaydi, o'shaning natijasi kutiladi
  let since = 0;
  if (deps.phoneState()?.phase !== 'running') {
    // Qayta o'rnatish Asterisk'ni qayta yoqadi — jonli suhbat uzilmasin
    const waited = await waitForCall(deps);
    if (waited === null) return { ok: false, note: STILL_TALKING };
    if (deps.updating()) return { ok: false, note: "Yangilash ketyapti — tugagach qayta bosing" };
    since = deps.now();
    if (deps.phoneState()?.phase !== 'running') {
      const refused = await deps.phoneStart();
      if (refused) return { ok: false, note: refused };
    } else since = 0;
  }
  await tellOwners(deps, `📞 ${team(cmd.by)} telefon xizmatini o'rnatyapti — odatda 5–15 daqiqa, ekranda hech narsa ochilmaydi. Kompyuterni o'chirmang.`, "Palantir jamoasi telefon xizmatini o'rnatyapti");
  const { result, owner } = await awaitInstall(deps, since);
  if (owner) await tellOwners(deps, owner, "Telefon xizmati o'rnatildi");
  return result;
}

async function rebootPc(cmd: HubCommand, deps: CommandDeps): Promise<CommandResult> {
  if (deps.updating()) return { ok: false, note: "Yangilash ketyapti — tugagach qayta bosing" };
  if (deps.phoneState()?.phase === 'running') return { ok: false, note: "Telefon xizmati o'rnatilyapti — tugashini kuting" };
  const waited = await waitForCall(deps);
  if (waited === null) return { ok: false, note: STILL_TALKING };
  // Kutish paytida yangilash yoki o'rnatish boshlangan bo'lishi mumkin — yarim yo'lda o'chirilmasin
  if (deps.updating()) return { ok: false, note: "Yangilash boshlandi — tugagach qayta bosing" };
  if (deps.phoneState()?.phase === 'running') return { ok: false, note: "Telefon xizmati o'rnatilyapti — tugashini kuting" };
  const continues = deps.phoneState()?.phase === 'reboot';
  const refused = deps.reboot();
  if (refused) return { ok: false, note: refused };
  await tellOwners(deps, `🔁 ${team(cmd.by)} kompyuterni qayta yoqyapti (1 daqiqadan keyin) — Palantir 2–3 daqiqada o'zi qaytadi. Ochiq dasturlardagi ishni saqlang.`, 'Palantir jamoasi kompyuterni qayta yoqdi');
  return { ok: true, note: `Kompyuter 1 daqiqada qayta yonadi${waitedNote(waited)}${continues ? " — yonganidan keyin telefon xizmatini o'rnatish o'zi davom etadi" : ''}` };
}

async function execute(cmd: HubCommand, deps: CommandDeps): Promise<CommandResult & { after?: () => void }> {
  const who = team(cmd.by);
  if (cmd.action === 'diag') {
    const text = fitBytes(maskPeople(diagnostics().text), DIAG_MAX_BYTES);
    await tellOwners(deps, `🔧 ${who} dastur holatini tekshirdi (diagnostika: holat va jurnallar — mijozlar ro'yxati, parol va kalitlarsiz).`, 'Palantir jamoasi diagnostika oldi');
    return { ok: true, note: `Diagnostika yuborildi (${Math.round(Buffer.byteLength(text) / 1024)} KB)`, diag: text };
  }
  if (cmd.action === 'message') {
    const text = cmd.text ?? '';
    const owners = active().length;
    const delivered = await tellOwners(deps, `📩 <b>${who}</b>\n\n${esc(text)}`, cmd.by ? `Palantir jamoasidan xabar (${cmd.by})` : 'Palantir jamoasidan xabar', text);
    if (!owners) return { ok: false, note: "Faol biznes yo'q — xabar hech kimga bormadi" };
    return delivered
      ? { ok: true, note: delivered === owners ? "Egasiga Telegram'da yetkazildi" : `Telegram'da ${delivered}/${owners} egaga yetdi, qolgani — faqat panel jurnalida` }
      : { ok: true, note: "Telegram'ga yetmadi (egasi botga ulanmagan yoki aloqa yo'q) — faqat panel jurnalida" };
  }
  if (cmd.action === 'restart') {
    if (!deps.supervised()) return { ok: false, note: "Palantir nazoratchisiz ishlayapti (qo'lda ishga tushirilgan) — qayta yoqadigan yo'q, qayta ishga tushirilmadi" };
    if (deps.updating()) return { ok: false, note: 'Yangilash ketyapti — u o\'zi qayta ishga tushiradi' };
    const waited = await waitForCall(deps);
    if (waited === null) return { ok: false, note: STILL_TALKING };
    // Kutish paytida yangilash boshlangan bo'lishi mumkin
    if (deps.updating()) return { ok: false, note: 'Yangilash ketyapti — u o\'zi qayta ishga tushiradi' };
    await tellOwners(deps, `🔄 ${who} Palantir'ni qayta ishga tushiryapti — panel bir daqiqada qaytadi.`, 'Palantir jamoasi dasturni qayta ishga tushirdi');
    return { ok: true, note: `Qayta ishga tushirilmoqda${waitedNote(waited)}`, after: deps.restart };
  }
  if (cmd.action === 'phone') return installPhone(cmd, deps);
  if (cmd.action === 'reboot') return rebootPc(cmd, deps);
  // update
  const waited = await waitForCall(deps);
  if (waited === null) return { ok: false, note: STILL_TALKING };
  const refused = deps.startUpdate();
  if (refused) return { ok: false, note: refused };
  await tellOwners(deps, `⬆️ ${who} yangi nashrni tekshiryapti — bo'lsa, o'rnatiladi va bir necha daqiqa panel ochilmasligi mumkin. Yangi nashr ishlamasa, eskisiga o'zi qaytadi.`, 'Palantir jamoasi yangilashni boshladi');
  return { ok: true, note: `Yangilovchi ishga tushdi${waitedNote(waited)} — natijasi «Yangilanish» qatorida ko'rinadi` };
}

/** Hub navbatidan kelgan buyruq. Xatolar ichida ushlanadi va Hub'ga «bajarilmadi» bo'lib boradi */
export async function onCommand(payload: unknown, deps: CommandDeps = defaults): Promise<void> {
  const cmd = parseCommand(payload);
  if (!cmd) return void console.warn("[hub buyrug'i] tushunilmadi — e'tiborsiz");
  const seen = sql.one('SELECT ok, note FROM hub_commands WHERE id = ?', r => r, cmd.id);
  if (seen) {
    // Allaqachon bajarilgan (server qayta yongandan keyin navbat takrorlandi) — natija qayta yuboriladi, amal takrorlanmaydi.
    // Hali bajarilayotgan bo'lsa (ok yo'q — qo'ng'iroqni kutyapti) — hech narsa: natijani o'sha birinchisi yuboradi
    if (seen.ok !== null && seen.ok !== undefined) await deps.report(cmd.id, { ok: Number(seen.ok) === 1, note: String(seen.note ?? 'Avval bajarilgan') }).catch(() => null);
    return;
  }
  sql.run('INSERT INTO hub_commands (id, action, at) VALUES (?, ?, ?)', cmd.id, cmd.action, sql.nowIso());
  sql.run('DELETE FROM hub_commands WHERE id NOT IN (SELECT id FROM hub_commands ORDER BY at DESC LIMIT ?)', KEEP_ROWS);
  let result: CommandResult & { after?: () => void };
  try {
    result = await execute(cmd, deps);
  } catch (e) {
    result = { ok: false, note: `Xato: ${(e as Error).message}`.slice(0, 300) };
  }
  sql.run('UPDATE hub_commands SET ok = ?, note = ? WHERE id = ?', result.ok ? 1 : 0, result.note, cmd.id);
  console.log(`[hub buyrug'i] ${cmd.action}${cmd.by ? ` (${cmd.by})` : ''}: ${result.ok ? 'bajarildi' : 'bajarilmadi'} — ${result.note}`);
  const { after, ...sent } = result;
  // Natija avval Hub'ga: qayta ishga tushirishdan keyin uni yuboradigan yo'q
  await deps.report(cmd.id, sent).catch(e => console.warn("[hub buyrug'i] natija Hub'ga yetmadi:", (e as Error).message));
  after?.();
}

/**
 * Server yonganda (server/main.ts): telefon xizmatini o'rnatish davom ettiriladi.
 *  — Kompyuter «qayta yoqish kerak»dan keyin yongan: o'rnatish o'zi qayta boshlanadi (jamoa yana bosishi shart emas).
 *  — O'rnatish paytida Palantir qayta yongan (skript .env o'zgarsa uni o'zi qayta yoqadi, yoki svet o'chgan): javobsiz qolgan «phone»
 *    buyrug'i natijasi kutiladi va Hub'ga yuboriladi — aks holda kartada «kutilmoqda» bo'lib qolardi.
 */
/** Kompyuter yonganda internet (Wi-Fi, router) bir oz keyin keladi — o'rnatish Ubuntu va Asterisk'ni yuklaydi */
const RESUME_DELAY_MS = 60_000;

/** Ochiq «phone» buyruqlarini yopib, natijani Hub'ga yuboradi */
async function closeOpen(deps: CommandDeps, open: { id: string }[], result: CommandResult): Promise<void> {
  for (const o of open) {
    sql.run('UPDATE hub_commands SET ok = ?, note = ? WHERE id = ?', result.ok ? 1 : 0, result.note, o.id);
    await deps.report(o.id, result).catch(e => console.warn("[hub buyrug'i] natija Hub'ga yetmadi:", (e as Error).message));
  }
}

export async function resumePhoneInstall(deps: CommandDeps = defaults): Promise<void> {
  const state = deps.phoneState();
  const now = deps.now();
  const open = sql.many("SELECT id, at FROM hub_commands WHERE action = 'phone' AND ok IS NULL AND at > ?", r => ({ id: String(r.id), at: String(r.at) }),
    new Date(now - PHONE_FRESH_MS).toISOString());
  // Buyruq olingan, lekin o'rnatish holat yozmasdan server qayta yongan — Hub'da 2 soat «kutilmoqda» bo'lib qolmasin
  if (!state) return closeOpen(deps, open, { ok: false, note: "O'rnatish boshlanmadi (Palantir shu orada qayta yondi) — qayta bosing" });
  let since = open.length ? Math.min(...open.map(o => Date.parse(o.at))) : now;
  if (state.phase === 'rebooted') {
    await deps.sleep(RESUME_DELAY_MS);
    const refused = await deps.phoneStart();
    if (refused) {
      console.warn("[telefon] qayta yongandan keyin o'rnatish davom etmadi:", refused);
      // Bir marta: keyingi yonishlarda qayta urinmaydi va egasiga yana yozmaydi
      deps.phoneFail(`Qayta yongandan keyin davom etmadi: ${refused}`);
      await tellOwners(deps, `⚠️ Kompyuter qayta yondi, lekin telefon xizmatini o'rnatish davom etmadi: ${esc(refused)}`, "Telefon xizmatini o'rnatish davom etmadi", refused);
      return closeOpen(deps, open, { ok: false, note: refused });
    }
    console.log("[telefon] kompyuter qayta yondi — telefon xizmatini o'rnatish davom etyapti");
    since = deps.now();
  } else if (!open.length) return;
  const { result, owner } = await awaitInstall(deps, since);
  console.log(`[telefon] o'rnatish: ${result.ok ? 'tugadi' : 'bajarilmadi'} — ${result.note}`);
  if (owner) await tellOwners(deps, owner, "Telefon xizmati o'rnatildi");
  else if (!result.ok && state.phase === 'rebooted') await tellOwners(deps, `⚠️ Telefon xizmati o'rnatilmadi: ${esc(result.note)}`, "Telefon xizmati o'rnatilmadi", result.note);
  await closeOpen(deps, open, result);
}
