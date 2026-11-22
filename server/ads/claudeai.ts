/**
 * Reklama kabineti egasining claude.ai'dagi «Meta Ads» ulagichi orqali (o'z Meta ilovasi ham, Pipeboard ham kerak emas): egasi
 * claude.ai → Settings → Connectors → Add custom connector → https://mcp.facebook.com/ads qo'shib, Facebook bilan ruxsat beradi.
 * Meta claude.ai'ni o'z ro'yxatidagi mijoz sifatida taniydi; Palantir esa shu obunada Agent SDK orqali ishlaydi — SDK claude.ai
 * ulagichlarini o'zi yuklaydi (strictMcpConfig va disableClaudeAiConnectors o'chiq bo'lsa). Token Palantir'ga kelmaydi.
 *
 * Palantir serverining o'zi bu ulagichga to'g'ridan-to'g'ri ulana olmaydi. Pul qo'riqchisiga kerak amallar (sarf, holat, to'xtatish,
 * egasi tasdiqlagan amal) «ijrochi» orqali: kichik model faqat berilgan chaqiruvlarni AYNAN berilgan argumentlar bilan qiladi —
 * PreToolUse boshqa har qanday chaqiruvni rad etadi (model argumentni o'zgartirsa ham), natijani model emas, PostToolUse yozib oladi.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { query, type HookCallbackMatcher, type McpServerStatus, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { env } from '../env';
import { childEnv, toolServer } from '../subscription/engine';
import { McpCallError } from './mcpClient';

/** Meta'ning rasmiy reklama MCP serveri (claude.ai ulagichi shu manzilga) */
export const META_MCP_URL = 'https://mcp.facebook.com/ads';
/** Ulagich ulanishini shuncha kutamiz (odatda ~5 s) */
const CONNECT_WAIT_MS = 30_000;
const POLL_MS = 1_000;
/** Ijrochi: bitta ish (bir nechta chaqiruv) shuncha vaqtdan oshmasin */
const RUN_TIMEOUT_MS = 3 * 60_000;

export const toolPrefix = (name: string): string => `mcp__${toolServer(name)}__`;

export type ConnectorState = 'connected' | 'needs-auth' | 'failed' | 'missing';
/**
 * others — egasining boshqa claude.ai ulagichlari (Targetolog suhbatida yashiriladi); tools — Meta ulagichining asboblari (nomlari).
 * Meta'ning 100+ asbobi tavsiflari bilan bitta so'rovda ~350 ming token: ishda faqat kerakligi ko'rsatiladi, qolgani yashiriladi
 */
export interface Connector { name: string; state: ConnectorState; others: string[]; tools: string[] }

/** Chaqiruv argumentlari: Meta har chaqiruvda «qaysi ish» va suhbat raqamini kutadi */
export const callMeta = (job: 'report_measure_or_look_up' | 'update_existing_campaigns'): Record<string, string> =>
  ({ advertiser_job: job, client_conversation_id: randomBytes(10).toString('hex') });

/** Obuna sozlamalari: claude.ai ulagichlari yuklanadi, kompyuterdagi Claude Code sozlamalari, CLAUDE.md va plaginlar — yo'q */
export function connectorOptions(): Pick<Options, 'settingSources' | 'strictMcpConfig' | 'settings'> {
  return { settingSources: [], strictMcpConfig: false, settings: { disableClaudeAiConnectors: false, autoMemoryEnabled: false } };
}

/** Faqat egasining claude.ai ulagichi (source — SDK aytadi; nomiga ishonilmaydi) va aynan Meta manzili */
const isMeta = (s: McpServerStatus): boolean => {
  const url = (s.config as { url?: unknown } | undefined)?.url;
  return s.source === 'claudeai' && typeof url === 'string' && url.replace(/\/+$/, '') === META_MCP_URL;
};

/** Ulagich ulanguncha kutadi: holati (yo'q bo'lsa — missing) */
export async function waitConnector(q: Pick<Query, 'mcpServerStatus'>, waitMs = CONNECT_WAIT_MS): Promise<Connector> {
  const until = Date.now() + waitMs;
  let last: McpServerStatus | undefined;
  let all: McpServerStatus[] = [];
  for (;;) {
    all = await q.mcpServerStatus().catch(() => [] as McpServerStatus[]);
    last = all.find(isMeta);
    if (last && last.status !== 'pending') break;
    // claude.ai ulagichlari ro'yxati ham kechikib keladi — ro'yxat bo'sh bo'lsa ham kutiladi
    if (Date.now() >= until) break;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  const others = all.filter(s => s !== last && s.source === 'claudeai').map(s => s.name);
  if (!last) return { name: '', state: 'missing', others, tools: [] };
  const state: ConnectorState = last.status === 'connected' ? 'connected' : last.status === 'needs-auth' ? 'needs-auth' : 'failed';
  return { name: last.name, state, others, tools: (last.tools ?? []).map(t => t.name) };
}

function runDir(): string {
  const dir = join(env.dataDir, 'obuna');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Hech narsa so'ramaydigan, kutib turadigan kirish (faqat ulagich holatini o'qish uchun) */
function idle(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  const done = (): Promise<IteratorResult<SDKUserMessage>> =>
    new Promise(r => {
      if (signal.aborted) r({ done: true, value: undefined });
      else signal.addEventListener('abort', () => r({ done: true, value: undefined }), { once: true });
    });
  return { [Symbol.asyncIterator]: () => ({ next: done }) };
}

/** Ulagich bormi va ulanganmi (model chaqirilmaydi) */
async function probeConnector(): Promise<Connector> {
  const abort = new AbortController();
  const q = query({ prompt: idle(abort.signal), options: { ...connectorOptions(), tools: [], maxTurns: 1, persistSession: false, permissionMode: 'dontAsk', abortController: abort, cwd: runDir(), env: childEnv(process.env) } });
  const drain = (async () => { try { for await (const _ of q) { /* xabarlar kerak emas */ } } catch { /* to'xtatildi */ } })();
  try {
    return await waitConnector(q);
  } finally {
    abort.abort();
    await drain;
  }
}

// ─── Ijrochi ──────────────────────────────────────────────────────────────────

export interface CaiCall { tool: string; args: Record<string, unknown> }
/** Bitta chaqiruv natijasi: Meta javobi matni yoki xato (error — Meta rad etdi) */
export interface CaiResult { text: string; error: boolean }
/** server — ulagich nomi (mcpServerStatus'dagi); natijalar chaqiruvlar tartibida. Chaqiruv bajarilmasa — McpCallError */
/** hide — ijrochiga ko'rinmaydigan asboblar va ulagichlar (to'liq nomlar: mcp__server yoki mcp__server__tool): kontekst to'lib, obuna yeyilmasin */
export type CaiRunner = (server: string, calls: readonly CaiCall[], hide: readonly string[]) => Promise<CaiResult[]>;

/** Ikki JSON qiymat bir xilmi (kalitlar tartibi muhim emas) */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameJson(x, (b as unknown[])[i]));
  const ka = Object.keys(a), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b as object, k) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Asbob javobi → matn (satr yoki MCP bloklari) */
export function responseText(r: unknown): string {
  if (typeof r === 'string') return r;
  const blocks = Array.isArray(r) ? r : r && typeof r === 'object' && Array.isArray((r as { content?: unknown }).content) ? (r as { content: unknown[] }).content : null;
  if (blocks) return blocks.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('\n').trim();
  return r === undefined || r === null ? '' : JSON.stringify(r);
}

const RUNNER_SYSTEM = `You are a precise tool runner for Palantir. Call the listed tools in order, each exactly once, with exactly the JSON arguments given — the same keys and the same values, nothing added, removed or changed. Call nothing else. If a call is refused, follow the reason and call it again correctly. After the last call reply only "done".`;

/**
 * Bitta «ish»: kerakli chaqiruvlar ketma-ket. PreToolUse — navbatdagi chaqiruvning o'zi bo'lsagina ruxsat; PostToolUse — natijani
 * yozadi (modelga qisqa «ok» boradi: ijrochi kontekstini to'ldirmasin)
 */
async function sdkRunner(server: string, calls: readonly CaiCall[], hide: readonly string[]): Promise<CaiResult[]> {
  const prefix = toolPrefix(server);
  const results: (CaiResult | undefined)[] = calls.map(() => undefined);
  let next = 0;
  /** Ruxsat berilgan, lekin natijasi kelmagan chaqiruv bor (bajarilgan bo'lishi mumkin) */
  let inFlight = false;
  const expected = (i: number) => `Call ${prefix}${calls[i].tool} with exactly these arguments: ${JSON.stringify(calls[i].args)}`;
  const guard: HookCallbackMatcher = {
    matcher: '.*',
    hooks: [async input => {
      if (input.hook_event_name !== 'PreToolUse') return { continue: true };
      const want = calls[next];
      const ok = want !== undefined && !inFlight && input.tool_name === `${prefix}${want.tool}` && sameJson(input.tool_input, want.args);
      if (ok) { inFlight = true; return { continue: true }; }
      const why = want ? `Wrong call. ${expected(next)}` : 'All calls are done — reply "done".';
      return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: why } };
    }],
  };
  const record = (text: string, error: boolean) => {
    if (next < calls.length && inFlight) { results[next] = { text, error }; next++; inFlight = false; }
  };
  const post: HookCallbackMatcher = {
    matcher: `${prefix}.*`,
    hooks: [async input => {
      if (input.hook_event_name === 'PostToolUse') {
        record(responseText(input.tool_response), false);
        return { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, updatedToolOutput: 'ok' } };
      }
      if (input.hook_event_name === 'PostToolUseFailure') record(input.error, true);
      return { continue: true };
    }],
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RUN_TIMEOUT_MS);
  let q: Query | null = null;
  let notReady: ConnectorState | null = null;
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    // SDK kirishni query() qaytmasdan o'qiy boshlaydi — q tayyor bo'lguncha
    while (!q) await new Promise(r => setTimeout(r, 20));
    // Ulagich ulanmasdan modelga so'rov ketsa — asboblar hali yo'q bo'ladi
    const c = await waitConnector(q);
    if (c.state !== 'connected' || c.name !== server) { notReady = c.state === 'connected' ? 'failed' : c.state; abort.abort(); return; }
    yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: calls.map((_, i) => `${i + 1}. ${expected(i)}`).join('\n') } };
  }
  try {
    q = query({
      prompt: prompt(),
      options: {
        ...connectorOptions(), model: env.adsRunnerModel, systemPrompt: RUNNER_SYSTEM, tools: [], maxTurns: calls.length * 3 + 2,
        allowedTools: [`mcp__${toolServer(server)}`], disallowedTools: [...hide], permissionMode: 'dontAsk', persistSession: false, abortController: abort,
        cwd: runDir(), env: childEnv(process.env), hooks: { PreToolUse: [guard], PostToolUse: [post], PostToolUseFailure: [post] },
      },
    });
  } catch (e) {
    if (e instanceof McpCallError) throw e;
    if (!notReady && next === 0 && !inFlight) throw new McpCallError(`Meta ulagichi bilan ish bajarilmadi: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }
  if (notReady) { cached = null; throw new McpCallError(stateText(notReady), true); }
  const missing = results.findIndex(r => r === undefined);
  if (missing >= 0) {
    // Ruxsat berilmagan chaqiruv bajarilmagan (aniq); ruxsat berilib javobi kelmagani — bajarilgan bo'lishi mumkin
    const ran = missing < next || (missing === next && inFlight);
    throw new McpCallError(`Meta ulagichi ${calls[missing].tool} natijasini bermadi`, !ran);
  }
  return results as CaiResult[];
}

let runner: CaiRunner = sdkRunner;
let probe: () => Promise<Connector> = probeConnector;
/** Sinov uchun: soxta ijrochi va ulagich */
export function setCaiForTests(r: CaiRunner | null, p?: (() => Promise<Connector>) | null): void {
  runner = r ?? sdkRunner;
  probe = p ?? probeConnector;
  cached = null;
}

export const stateText = (s: ConnectorState): string => ({
  connected: '',
  'needs-auth': "claude.ai'dagi Meta Ads ulagichiga qayta kirish kerak — claude.ai → Settings → Connectors → Meta Ads → Connect",
  failed: "claude.ai'dagi Meta Ads ulagichi ulanmadi — birozdan keyin qayta urining yoki claude.ai → Settings → Connectors'da tekshiring",
  missing: "claude.ai'da Meta Ads ulagichi topilmadi — claude.ai → Settings → Connectors → Add custom connector: https://mcp.facebook.com/ads",
}[s]);

const READY_OK_MS = 6 * 3600_000;
const READY_FAIL_MS = 5 * 60_000;
let cached: { c: Connector; at: number } | null = null;

/** Ulagich holati (saqlanadi: ishlasa — 6 soat, ishlamasa — 5 daqiqa). fresh — qayta tekshirish */
export async function connector(fresh = false): Promise<Connector> {
  const now = Date.now();
  if (!fresh && cached && now - cached.at < (cached.c.state === 'connected' ? READY_OK_MS : READY_FAIL_MS)) return cached.c;
  const c = await probe().catch((): Connector => ({ name: '', state: 'failed', others: [], tools: [] }));
  cached = { c, at: now };
  return c;
}

/** Shu ishda ko'rinmaydiganlar: boshqa ulagichlar butunlay va Meta'ning keraksiz asboblari */
export function hiddenFor(c: Pick<Connector, 'name' | 'others' | 'tools'>, keep: ReadonlySet<string>): string[] {
  const server = toolServer(c.name);
  return [...c.others.map(n => `mcp__${toolServer(n)}`), ...c.tools.filter(t => !keep.has(t)).map(t => `mcp__${server}__${t}`)];
}

/** Meta ulagichida chaqiruvlar (ulagich topilmasa yoki ulanmagan bo'lsa — McpCallError, hech narsa bajarilmagan) */
export async function caiCall(calls: readonly CaiCall[]): Promise<CaiResult[]> {
  const c = await connector();
  if (c.state !== 'connected') { cached = null; throw new McpCallError(stateText(c.state), true); }
  return runner(c.name, calls, hiddenFor(c, new Set(calls.map(x => x.tool))));
}

/** Bitta chaqiruv: matn; Meta rad etsa — McpCallError(refused) */
export async function caiOne(tool: string, args: Record<string, unknown>): Promise<string> {
  const [r] = await caiCall([{ tool, args }]);
  if (r.error || /^\s*\{\s*"error"/.test(r.text)) throw new McpCallError(r.text.slice(0, 400) || `Meta ${tool} amalini bajarmadi`, true);
  return r.text;
}
