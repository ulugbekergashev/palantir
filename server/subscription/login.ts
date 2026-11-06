/**
 * Claude obunasiga kirish: klinika o'z sotib olgan obunasiga panel orqali kiradi — terminal ham, .env ham kerak emas.
 * Palantir bilan kelgan Claude Code (`claude.exe`, Agent SDK paketi) ishlatiladi:
 *   `claude auth login --claudeai` — server kompyuterida brauzer ochiladi, kirilgach o'zi tugaydi. Boshqa qurilmada esa
 *   chiqargan havolani ochib, sahifa ko'rsatgan kodni («kod#state») panelga qo'yadi — u dasturning kirishiga (stdin) yoziladi.
 *   `claude auth status --json` — kirilganmi, qaysi obuna (pro, max, team…).
 * Kirilgach AI o'zi obunaga o'tadi. Tanlov bazada saqlanadi va .env dagi AI_ENGINE dan ustun (kalitlar kabi: keys.ts).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { AiEngine, ObunaLogin, ObunaStatus } from '../../src/types';
import { env } from '../env';
import { settings } from '../serviceStore';
import { apiKeyPresent, childEnv } from './engine';

const ENGINE_SETTING = 'ai_engine';
/** Kirish oynasi shuncha kutadi (egasi parolini eslab, telefoniga kelgan kodni kiritguncha) */
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const STATUS_TIMEOUT_MS = 20_000;
/** Holat qisqa vaqt eslab qolinadi: sahifa har ochilganda dastur qayta ishga tushmasin */
const STATUS_CACHE_MS = 10_000;

/** Claude Code dasturi: CLAUDE_BIN (sinovda — soxta .mjs) yoki Agent SDK bilan kelgan claude.exe. Topilmasa — null */
export function claudeCommand(): { cmd: string; args: string[] } | null {
  const custom = process.env.CLAUDE_BIN?.trim();
  if (custom) return /\.m?js$/i.test(custom) ? { cmd: process.execPath, args: [custom] } : { cmd: custom, args: [] };
  try {
    const pkg = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const bin = join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
    return existsSync(bin) ? { cmd: bin, args: [] } : null;
  } catch {
    return null;
  }
}

const aiEnabledNow = (): boolean =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || env.aiEngine === 'subscription') && process.env.AI_DISABLED !== '1';

/** AI qayerdan ishlaydi — darhol kuchga kiradi (server to'xtamaydi) va bazada saqlanadi */
export function setEngine(engine: AiEngine): void {
  env.aiEngine = engine;
  env.aiEnabled = aiEnabledNow();
  settings.set(ENGINE_SETTING, engine);
}

// Panelda tanlangani .env dagidan ustun
const saved = settings.all().find(r => r.name === ENGINE_SETTING)?.value;
if (saved === 'api' || saved === 'subscription') {
  env.aiEngine = saved;
  env.aiEnabled = aiEnabledNow();
}

// ─── Holat ────────────────────────────────────────────────────────────────────

interface Account { loggedIn: boolean; plan: string | null; email: string | null }

/** `claude auth status --json` javobi. Kirilmagan, dastur topilmadi yoki tushunarsiz javob — kirilmagan */
export function parseStatus(text: string): Account {
  try {
    const j = JSON.parse(text) as { loggedIn?: unknown; subscriptionType?: unknown; email?: unknown };
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { loggedIn: j.loggedIn === true, plan: str(j.subscriptionType), email: str(j.email) };
  } catch {
    return { loggedIn: false, plan: null, email: null };
  }
}

function runClaude(args: string[], timeoutMs: number): Promise<string> {
  const c = claudeCommand();
  if (!c) return Promise.resolve('');
  return new Promise(resolve => {
    const proc = spawn(c.cmd, [...c.args, ...args], { env: childEnv(process.env), windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += String(d); });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    proc.on('error', () => { clearTimeout(timer); resolve(''); });
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

let cached: { at: number; account: Account } | null = null;
async function account(fresh: boolean): Promise<Account> {
  if (!fresh && cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.account;
  const a = parseStatus(await runClaude(['auth', 'status', '--json'], STATUS_TIMEOUT_MS));
  cached = { at: Date.now(), account: a };
  return a;
}

export async function obunaStatus(fresh = false): Promise<ObunaStatus> {
  const available = !!claudeCommand();
  const a = available ? await account(fresh) : { loggedIn: false, plan: null, email: null };
  return { available, ...a, engine: env.aiEngine, apiKey: apiKeyPresent(), login: loginView() };
}

// ─── Kirish ───────────────────────────────────────────────────────────────────

interface LoginRun { proc: ChildProcessWithoutNullStreams; out: string; url: string | null; done: boolean; ok: boolean; error: string | null; cancelled: boolean }
let run: LoginRun | null = null;

/** Havola terminal uchun belgilar bilan o'ralgan bo'lishi mumkin (OSC 8): ular havolaga qo'shilmaydi */
const URL_RE = /visit:\s*(?:\x1b\]8;;)?(https:\/\/[^\s\x07\x1b]+)/i;
/** Xato matni: «Login failed: …» yoki oxirgi bo'sh bo'lmagan qator */
function errorOf(out: string): string {
  const failed = out.match(/Login failed:\s*([^\n]+)/i)?.[1]?.trim();
  if (failed) return failed;
  const last = out.split('\n').map(l => l.trim()).filter(Boolean).at(-1);
  return last && !/Paste code here/i.test(last) ? last : 'Kirish tugamadi';
}

export function loginView(): ObunaLogin | null {
  return run ? { running: !run.done, url: run.url, ok: run.ok, error: run.error } : null;
}

/** Kirishni boshlaydi (allaqachon boshlangan bo'lsa — o'shani qaytaradi). Kirilsa — AI o'zi obunaga o'tadi */
export function startLogin(): ObunaLogin {
  if (run && !run.done) return loginView()!;
  const c = claudeCommand();
  if (!c) throw new Error("Claude dasturi topilmadi — Palantir'ni qayta o'rnating");
  const proc = spawn(c.cmd, [...c.args, 'auth', 'login', '--claudeai'], { env: childEnv(process.env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const r: LoginRun = { proc, out: '', url: null, done: false, ok: false, error: null, cancelled: false };
  const onData = (d: Buffer) => {
    r.out = (r.out + String(d)).slice(-8000);
    r.url ??= r.out.match(URL_RE)?.[1] ?? null;
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  // Yozish xatosi (dastur yopilgan) jarayonni yiqitmasin — natija «close» da
  proc.stdin.on('error', () => {});
  const timer = setTimeout(() => proc.kill(), LOGIN_TIMEOUT_MS);
  const finish = (ok: boolean, error: string | null) => {
    if (r.done) return;
    clearTimeout(timer);
    Object.assign(r, { done: true, ok, error });
    cached = null;
    if (ok) setEngine('subscription');
  };
  proc.on('error', e => finish(false, e.message));
  proc.on('close', code => finish(code === 0, code === 0 ? null : r.cancelled ? 'Bekor qilindi' : errorOf(r.out)));
  run = r;
  return loginView()!;
}

/** Boshqa qurilmada kirilganda sahifa ko'rsatgan kod («kod#state») — kutayotgan dasturga yuboriladi */
export function sendCode(code: string): ObunaLogin {
  if (!run || run.done) throw new Error("Kirish boshlanmagan — «Claude obunasiga kirish» tugmasini qayta bosing");
  run.proc.stdin.write(`${code}\n`);
  return loginView()!;
}

export function cancelLogin(): void {
  if (!run || run.done) return;
  run.cancelled = true;
  run.proc.kill();
}
