/**
 * Yig'ish: egasi «Qabul qilish» dan keyin «📦 Yig'ish» ni bosadi (yoki Palantir'ga «DentaLocal'ni yig'» deydi) — loyihaning o'rnatuvchisi
 * (exe) fonda yig'ilib, ish stoliga qo'yiladi va Telegram'ga ham yuboriladi (50 MB dan kattasi — inbox/bigFile.ts orqali).
 * Mijozga yuborishni egasi o'zi qiladi.
 *
 * Buyruq modeldan emas, faqat Palantir .env dan olinadi (loyiha fayllaridan ham emas — Dasturchi ularni o'zgartira oladi):
 *   DEV_BUILD_<NOM>=cd backend && npm run bundle && cd .. && npm run electron:build
 *   DEV_OUT_<NOM>=dist-electron\*.exe
 * Yig'ish loyihaning O'Z papkasida boradi (ish nusxasida emas: unda git'ga kirmaydigan resurslar — cloudflared.exe va h.k. — yo'q),
 * ya'ni papkaning hozirgi holati bilan. Bir vaqtda bitta yig'ish.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Markup } from 'telegraf';
import { newId, type BusinessRow } from '../db';
import { env } from '../env';
import { bigFileBlock, isBig } from '../inbox/bigFile';
import { editOwner, notifyOwner, notifyOwnerFile } from '../inbox/core';
import { devEnv } from './agent';
import { DevError, findProject, projects, type Project } from './projects';

export interface BuildSpec { command: string; out: string | null }

/** .env dagi nom: «X Clinic» → XCLINIC */
const envKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function buildSpec(p: Project): BuildSpec | null {
  const command = process.env[`DEV_BUILD_${envKey(p.name)}`]?.trim();
  return command ? { command, out: process.env[`DEV_OUT_${envKey(p.name)}`]?.trim() || null } : null;
}
export const buildable = (): Project[] => projects().filter(p => buildSpec(p));
export const canBuild = (projectName: string): boolean => { const p = findProject(projectName); return !!p && !!buildSpec(p); };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TAIL_MAX = 6000, SHOWN_LINES = 18, SHOWN_MAX = 2200;
/** Terminal ranglari va kursor buyruqlari — Telegram'da axlat bo'lib ko'rinadi */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

interface LiveBuild {
  id: string;
  project: Project;
  child: ChildProcess;
  startedAt: number;
  tail: string;
  statusMessage: number | null;
  lastStatusAt: number;
  stopped: boolean;
  timedOut: boolean;
  done: Promise<void>;
}
const builds = new Map<string, LiveBuild>();
export const runningBuild = (bizId: string): { id: string; project: string; minutes: number } | null => {
  const b = builds.get(bizId);
  return b ? { id: b.id, project: b.project.name, minutes: Math.floor((Date.now() - b.startedAt) / 60_000) } : null;
};

/** Tayyor fayllar: «papka\*.exe» ga mos va shu yig'ishda yozilgan (eski nusxalar emas) */
export function builtFiles(projectDir: string, out: string, since: number): string[] {
  const full = resolve(projectDir, out), dir = dirname(full);
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${basename(full).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return readdirSync(dir).filter(n => pattern.test(n)).map(n => join(dir, n)).filter(p => { const s = statSync(p); return s.isFile() && s.mtimeMs >= since - 2000; });
}

/** Tayyor fayl qo'yiladigan joy: DEV_DELIVER_DIR, bo'lmasa ish stoli */
const deliverDir = (): string => process.env.DEV_DELIVER_DIR?.trim() || join(homedir(), 'Desktop');
const sizeOf = (path: string) => { const mb = statSync(path).size / 1024 / 1024; return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`; };

function killTree(child: ChildProcess): void {
  // Windows'da buyruq cmd ichida ishlaydi: faqat cmd o'ldirilsa, npm va electron-builder ishlab qolaveradi
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}

const stopKeyboard = (id: string) => Markup.inlineKeyboard([[Markup.button.callback("⏹ To'xtatish", `bq|${id}`)]]).reply_markup;

async function status(biz: BusinessRow, b: LiveBuild, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - b.lastStatusAt < 15_000) return;
  b.lastStatusAt = now;
  const minutes = Math.floor((now - b.startedAt) / 60_000);
  const line = b.tail.trimEnd().split('\n').at(-1)?.trim().slice(0, 200) ?? '';
  const html = `📦 <b>Yig'yapman</b> · ${esc(b.project.name)}${minutes ? ` · ${minutes} daq` : ''}${line ? `\n<i>${esc(line)}</i>` : ''}`;
  if (b.statusMessage === null) b.statusMessage = await notifyOwner(biz, html, stopKeyboard(b.id)).catch(() => null);
  else await editOwner(biz, b.statusMessage, html, stopKeyboard(b.id)).catch(() => {});
}

/** Yig'ish boshlanadi (fonda). Boshlab bo'lmasa — DevError */
export function startBuild(biz: BusinessRow, projectName: string): { id: string; project: string } {
  const project = findProject(projectName);
  if (!project) throw new DevError(`«${projectName}» degan loyiha yo'q. Loyihalar: ${projects().map(p => p.name).join(', ')}`);
  const spec = buildSpec(project);
  if (!spec) throw new DevError(`«${project.name}» uchun yig'ish buyrug'i sozlanmagan (.env: DEV_BUILD_${envKey(project.name)}). Yig'iladigan loyihalar: ${buildable().map(p => p.name).join(', ') || "yo'q"}`);
  if (!existsSync(project.dir)) throw new DevError(`«${project.name}» papkasi topilmadi: ${project.dir}`);
  const busy = builds.get(biz.id);
  if (busy) throw new DevError(`Hozir «${busy.project.name}» yig'ilyapti — tugashini kuting yoki to'xtating`);

  const id = newId(8), startedAt = Date.now();
  const logDir = join(env.dataDir, 'dasturchi');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `yigish-${envKey(project.name).toLowerCase()}-${id}.log`);
  const log = createWriteStream(logFile);
  const child = spawn(spec.command, { cwd: project.dir, shell: true, windowsHide: true, env: devEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const b: LiveBuild = { id, project, child, startedAt, tail: '', statusMessage: null, lastStatusAt: 0, stopped: false, timedOut: false, done: Promise.resolve() };
  builds.set(biz.id, b);
  const onData = (chunk: Buffer) => {
    log.write(chunk);
    b.tail = (b.tail + chunk.toString('utf8').replace(ANSI, '').replace(/\r\n?/g, '\n')).slice(-TAIL_MAX);
    void status(biz, b);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  const timer = setTimeout(() => { b.timedOut = true; killTree(child); }, env.devBuildMinutes * 60_000);
  const exited = new Promise<number | string>(done => {
    child.once('error', e => done(e.message));
    child.once('close', (code, signal) => done(code ?? signal ?? 1));
  });
  b.done = (async () => {
    await status(biz, b, true);
    const code = await exited;
    clearTimeout(timer);
    await new Promise<void>(done => log.end(done));
    await report(biz, b, spec, code, logFile);
  })().catch(e => console.error("[dasturchi] yig'ish:", e)).finally(() => { if (builds.get(biz.id) === b) builds.delete(biz.id); });
  return { id, project: project.name };
}

async function report(biz: BusinessRow, b: LiveBuild, spec: BuildSpec, code: number | string, logFile: string): Promise<void> {
  const minutes = Math.max(1, Math.round((Date.now() - b.startedAt) / 60_000));
  const name = esc(b.project.name);
  if (b.statusMessage !== null) await editOwner(biz, b.statusMessage, `📦 Yig'ish tugadi · ${name}`).catch(() => {});
  if (code !== 0) {
    const why = b.timedOut ? `${env.devBuildMinutes} daqiqa tugadi — to'xtatildi` : b.stopped ? "To'xtatildi" : `kod ${code}`;
    const lines = b.tail.trimEnd().split('\n').filter(l => l.trim()).slice(-SHOWN_LINES).join('\n').slice(-SHOWN_MAX);
    const html = b.stopped && !b.timedOut
      ? `📦 <b>Yig'ish to'xtatildi</b> · ${name}`
      : `📦 <b>Yig'ilmadi</b> · ${name} (${esc(why)})${lines ? `\n\n<pre>${esc(lines)}</pre>` : ''}\n\nTo'liq jurnal: <code>${esc(logFile)}</code>\n<i>Tuzatish uchun Palantir'ga yozing: «${name} yig'ilmayapti, xatoni tuzat».</i>`;
    await notifyOwner(biz, html).catch(() => null);
    return;
  }
  const files = spec.out ? builtFiles(b.project.dir, spec.out, b.startedAt) : [];
  if (!files.length) {
    await notifyOwner(biz, `📦 <b>Yig'ildi</b> · ${name} (${minutes} daq)${spec.out ? `\nLekin tayyor fayl topilmadi: <code>${esc(spec.out)}</code>` : ''}\nJurnal: <code>${esc(logFile)}</code>`).catch(() => null);
    return;
  }
  const dir = deliverDir();
  const rows = files.map(src => {
    // Ish stolidagi eski nusxa shu nom bilan almashtiriladi (egasi so'ramasdan — o'zi shunday xohlagan)
    try {
      if (!existsSync(dir)) throw new Error(`papka yo'q: ${dir}`);
      const to = join(dir, basename(src));
      copyFileSync(src, to);
      return { path: to, html: `✅ <b>${esc(basename(src))}</b> — ${sizeOf(src)}\n<code>${esc(to)}</code>` };
    } catch (e) {
      return { path: src, html: `⚠️ <b>${esc(basename(src))}</b> — ${sizeOf(src)}; ish stoliga ko'chirilmadi (${esc((e as Error).message.slice(0, 120))})\n<code>${esc(src)}</code>` };
    }
  });
  await notifyOwner(biz, `📦 <b>Tayyor</b> · ${name} (${minutes} daq)\n\n${rows.map(r => r.html).join('\n\n')}`).catch(() => null);
  // Fayl Telegram'ga ham: egasi kompyuter oldida bo'lmasa ham mijozga uzata oladi
  for (const r of rows) await sendBuilt(biz, b.project.name, r.path);
}

const PROGRESS_EVERY_MS = 10_000;

/** Tayyor fayl egasining Telegram'iga hujjat bo'lib boradi; yuborilmasa — sababi aytiladi (fayl baribir kompyuterda) */
async function sendBuilt(biz: BusinessRow, projectName: string, path: string): Promise<void> {
  const label = `<b>${esc(basename(path))}</b> — ${sizeOf(path)}`;
  const failed = (why: string) => `⚠️ Telegram'ga yuborilmadi: ${label}\n${esc(why.slice(0, 200))}\nFayl kompyuterda: <code>${esc(path)}</code>`;
  const big = isBig(path), block = big ? bigFileBlock(path) : null;
  if (block) { await notifyOwner(biz, failed(block)).catch(() => null); return; }
  // Katta fayl bir-ikki daqiqa yuklanadi — egasi kutayotganini bilsin
  const note = big ? await notifyOwner(biz, `📤 Telegram'ga yuboryapman: ${label}`).catch(() => null) : null;
  let shownAt = Date.now();
  // Foiz yozuvi yakuniy yozuvdan keyin yetib kelib, uni bosib ketmasin — yakuniydan oldin kutiladi
  let progressEdit: Promise<void> = Promise.resolve();
  const onProgress = note === null ? undefined : (fraction: number) => {
    if (Date.now() - shownAt < PROGRESS_EVERY_MS) return;
    shownAt = Date.now();
    progressEdit = editOwner(biz, note, `📤 Telegram'ga yuboryapman: ${label} · ${Math.floor(fraction * 100)}%`).catch(() => {});
  };
  try {
    await notifyOwnerFile(biz, path, `${projectName}: ${basename(path)}`, onProgress);
    await progressEdit;
    if (note !== null) await editOwner(biz, note, `📤 Telegram'ga yuborildi: ${label}`).catch(() => {});
  } catch (e) {
    console.error("[dasturchi] faylni Telegram'ga yuborish:", e);
    await progressEdit;
    const html = failed((e as Error).message);
    if (note !== null) await editOwner(biz, note, html).catch(() => {});
    else await notifyOwner(biz, html).catch(() => null);
  }
}

/** Egasi to'xtatdi */
export function stopBuild(bizId: string, id?: string): boolean {
  const b = builds.get(bizId);
  if (!b || b.stopped || (id && b.id !== id)) return false;
  b.stopped = true;
  killTree(b.child);
  return true;
}

export async function stopAllBuilds(): Promise<void> {
  const running = [...builds.values()].map(b => b.done);
  for (const bizId of [...builds.keys()]) stopBuild(bizId);
  await Promise.allSettled(running);
}
