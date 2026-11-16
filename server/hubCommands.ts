/**
 * Masofadan amallar — klinika tomoni (hub tomoni — hub/commands.ts, hub/server.ts 17-band). Palantir jamoasi /admin dagi mijoz kartasidan
 * buyruq beradi; u Hub navbati orqali keladi (command, inbox/instagramApi.ts) va shu yerda bajariladi:
 *   diag    — diagnostika (server/diagnostics.ts: holat va jurnallar, parol va kalitlarsiz; telefon raqamlari va @nomlar niqoblanadi) Hub'ga ketadi;
 *   restart — Palantir serveri tinch to'xtaydi, nazoratchi (scripts/supervise.mjs) uni 2 soniyada qayta yoqadi;
 *   update  — yangilovchi (scripts/update.mjs) hozir ishga tushadi: imzolangan relizni tekshiradi, sinaydi, ishlamasa eskisiga qaytaradi;
 *   message — egasiga Telegram'da va panel jurnalida xabar.
 * Har amal egasiga aytiladi (jamoa nima qilganini bilsin). Natija Hub'ga qaytadi (POST /api/command/<id>).
 *
 * Bir buyruq bir marta: id bazaga bajarishdan OLDIN yoziladi. Qayta ishga tushgan server navbatni boshidan o'qiydi — o'sha buyruq yana
 * kelsa bajarilmaydi, faqat avvalgi natijasi qayta yuboriladi (Hub uni navbatdan oladi). Eskirgan qayta ishga tushirish va yangilashni
 * Hub o'zi bermaydi (o'z soati bilan — klinika soati noto'g'ri bo'lishi mumkin).
 * Telefonda suhbat ketayotgan bo'lsa, qayta ishga tushirish va yangilash u tugashini kutadi (CALL_WAIT_MS); tugamasa — bajarilmaydi
 * (suhbatni uzgandan ko'ra jamoa keyinroq qayta bossin). Yangilash ketayotganda qayta ishga tushirilmaydi.
 */
import { spawn } from 'node:child_process';
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
import { isCommandAction, MESSAGE_MAX, type CommandAction } from '../hub/commands';

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
