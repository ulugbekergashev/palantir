/**
 * Obuna dvigateli (AI_ENGINE=subscription): so'rov API kalit o'rniga shu kompyuterdagi Claude obunasiga Claude Agent SDK orqali ketadi.
 * Har kim o'z obunasida: egasi o'zinikida, klinika o'zi sotib olgan obunasida (egasi o'z obunasini hech kimga bermaydi).
 * Kirish: kompyuterda `claude` ga /login qilingan yoki CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`).
 * Obunaga asbobsiz so'rovlarning hammasi o'tadi (matn, rasm, JSON javob — mijozga javob, kamera, Direktor ham), egasi bilan
 * suhbat — Palantir asboblari bilan (owner.ts). API kalitsiz ishlamaydiganlari: kompyuterda ish va chuqur tahlil (Python).
 *
 * Agent SDK ichida Claude Code ishlaydi. Unga faqat Palantir'ning o'z ko'rsatmasi va asboblari beriladi: fayl, buyruq va boshqa
 * o'rnatilgan asboblar o'chiq (tools: []), kompyuterdagi Claude Code sozlamalari, CLAUDE.md va plaginlar o'qilmaydi (settingSources: []).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { query, type EffortLevel, type McpSdkServerConfigWithInstance, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { env } from '../env';
import { APP_VERSION } from '../version';

/**
 * auth — obunaga kirilmagan; limit — obuna limiti tugagan; unsupported — bu ish obunada yo'q (API kalit kerak);
 * timeout — javob juda uzoq kutildi; failed — boshqa xato
 */
export type SubscriptionReason = 'auth' | 'limit' | 'unsupported' | 'timeout' | 'failed';
export class SubscriptionError extends Error {
  /** sessionId — xato bo'lgan SDK sessiyasi (unda bajarilgan asboblar bor bo'lishi mumkin: keyingi gap shu sessiyani davom ettiradi) */
  constructor(readonly reason: SubscriptionReason, message: string, readonly sessionId: string | null = null) { super(message); }
}

export const subscriptionOn = (): boolean => env.aiEngine === 'subscription';
/** Obuna rejimida ham API kalit bo'lsa — obunada yo'q ishlar (kompyuterda ish, chuqur tahlil) shu kalit bilan ishlaydi */
export const apiKeyPresent = (): boolean => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Bitta so'rovning eng uzoq kutilishi: asboblar bilan ko'p qadamli ish ham shu vaqtga sig'adi */
const TIMEOUT_MS = 10 * 60_000;

/**
 * Bola jarayon (Claude Code) muhiti. API kalit qolsa, Claude Code obuna o'rniga kalitni ishlatadi (u kalitni obunadan ustun qo'yadi);
 * ANTHROPIC_* (manzil, model, sarlavhalar) va CLAUDE_CODE_USE_* (Bedrock/Vertex) esa so'rovni boshqa joyga yoki modelga burardi.
 * CLAUDE_CODE_OAUTH_TOKEN (obuna tokeni) qoladi
 */
const STRIPPED = /^(ANTHROPIC_|CLAUDE_CODE_USE_)/i;
export function childEnv(src: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const kept = Object.fromEntries(Object.entries(src).filter(([k]) => !STRIPPED.test(k)));
  return { ...kept, CLAUDE_AGENT_SDK_CLIENT_APP: `palantir/${APP_VERSION}` };
}

// ─── Asbobsiz so'rov (matn, rasm, JSON javob) ─────────────────────────────────

type MessageParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>;
/** Obunaga ketadigan bloklar: matn va rasm (kesh belgilari olib tashlanadi — obuna o'zi keshlaydi) */
export type PlainBlock = { type: 'text'; text: string } | { type: 'image'; source: Anthropic.Beta.BetaBase64ImageSource };
/** schema — javob shu JSON shaklida qaytsin (mijozga javob, kamera, Direktor); null — erkin matn */
export interface PlainRequest { model: string; system: string; content: string | PlainBlock[]; schema: Record<string, unknown> | null; effort: EffortLevel | undefined }

/** Faqat matn bo'lsa — bitta satr; rasm bo'lsa — bloklar; boshqa blok (hujjat, asbob natijasi) — null */
function plainContent(c: Anthropic.Beta.BetaMessageParam['content']): string | PlainBlock[] | null {
  if (typeof c === 'string') return c;
  const blocks: PlainBlock[] = [];
  for (const b of c) {
    if (b.type === 'text') blocks.push({ type: 'text', text: b.text });
    else if (b.type === 'image' && b.source.type === 'base64') blocks.push({ type: 'image', source: b.source });
    else return null;
  }
  const texts = blocks.flatMap(b => (b.type === 'text' ? [b.text] : []));
  return texts.length === blocks.length ? texts.join('\n\n') : blocks;
}

/**
 * API so'rovi obunaga o'tadimi: asbobsiz, bitta foydalanuvchi xabari — matn, rasm, JSON shakli bo'lishi mumkin.
 * Asboblar yoki bir necha xabarli so'rov (kompyuterda ish, chuqur tahlil) — null: u API kalit bilan ishlaydi
 */
export function plainRequest(p: MessageParams): PlainRequest | null {
  if (p.tools?.length || p.messages.length !== 1) return null;
  const [m] = p.messages;
  if (m.role !== 'user') return null;
  const content = plainContent(m.content);
  if (content === null) return null;
  const system = typeof p.system === 'string' ? p.system : (p.system ?? []).map(b => b.text).join('\n\n');
  const format = p.output_config?.format;
  return { model: p.model, system, content, schema: format?.type === 'json_schema' ? format.schema : null, effort: p.output_config?.effort ?? undefined };
}

/** Rasmli so'rov SDK'ga oqim ko'rinishida beriladi (bitta xabar): satr ko'rinishidagi so'rovga rasm sig'maydi */
async function* oneMessage(content: PlainBlock[]): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content } };
}

// ─── Natija ───────────────────────────────────────────────────────────────────

export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
/** cut — qadamlar tugadi (ish chala); refused — model so'rovni rad etdi; structured — JSON shakli so'ralganda SDK tekshirgan javob */
export interface TurnResult { text: string; sessionId: string; cut: boolean; refused: boolean; usage: TokenUsage; structured?: unknown }

// Limit avval tekshiriladi: limit xabarida «OAuth» so'zi ham uchraydi
const LIMIT_RE = /usage limit|rate limit|limit reached|hit your .*limit|\b429\b/i;
const AUTH_RE = /\/login|not logged in|invalid api key|invalid .*token|token .*expired|\b401\b/i;
const classify = (message: string): SubscriptionReason => (LIMIT_RE.test(message) ? 'limit' : AUTH_RE.test(message) ? 'auth' : 'failed');

/** Egasiga ko'rinadigan oxirgi matn (asosiy agentniki — ichki yordamchilarniki emas) */
function lastText(msgs: readonly SDKMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== 'assistant' || m.parent_tool_use_id != null) continue;
    const text = m.message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('').trim();
    if (text) return text;
  }
  return '';
}

/** SDK xabarlari → javob. Qadamlar tugasa — xato emas (oxirgi aytilgan matn, cut); kirish va limit xatolari alohida */
export function collectResult(msgs: readonly SDKMessage[]): TurnResult {
  const sessionId = msgs.find(m => 'session_id' in m && m.session_id)?.session_id ?? null;
  // Obuna limiti haqidagi aniq belgi (xato matni har xil bo'lishi mumkin)
  const limited = msgs.some(m => m.type === 'rate_limit_event' && m.rate_limit_info.status === 'rejected');
  const fail = (why: string): SubscriptionError => new SubscriptionError(limited ? 'limit' : classify(why), why, sessionId);
  const res = msgs.findLast(m => m.type === 'result');
  if (!res || res.type !== 'result') throw fail('Obuna javob bermadi');
  const u = res.usage;
  const usage: TokenUsage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  if (res.subtype === 'error_max_turns') return { text: lastText(msgs), sessionId: res.session_id, cut: true, refused: false, usage };
  if (res.subtype !== 'success') throw fail(res.errors.join('; ') || res.subtype);
  if (res.is_error) throw fail(`${res.api_error_status ?? ''} ${res.result}`.trim());
  const structured = res.structured_output !== undefined ? { structured: res.structured_output } : {};
  return { text: res.result.trim() || lastText(msgs), sessionId: res.session_id, cut: false, refused: res.stop_reason === 'refusal', usage, ...structured };
}

// ─── So'rov ───────────────────────────────────────────────────────────────────

export interface QueryOptions {
  system: string;
  model: string;
  effort?: EffortLevel;
  maxTurns: number;
  /** Davom ettiriladigan suhbat (SDK sessiyasi) */
  resume?: string;
  /** Palantir asboblari (subscription/tools.ts) */
  mcp?: McpSdkServerConfigWithInstance;
  /** Internetdan qidirish yoqilsin (Claude Code'ning o'z WebSearch asbobi) */
  webSearch?: boolean;
  /** Qidiruv natijasi begona matn: chaqirilganda belgi qo'yiladi (toolkit.ts readStrangers) */
  onWebSearch?: () => void;
  /** Sessiya diskka yozilsinmi (davom ettiriladigan suhbat uchun kerak; bir martalik matnli so'rovda — yo'q) */
  persist: boolean;
  /** Javob shu JSON shaklida qaytsin (SDK o'zi tekshiradi va noto'g'ri bo'lsa qayta so'raydi) */
  schema?: Record<string, unknown>;
}

/** SDK sessiyalari saqlanadigan papka: egasining boshqa Claude Code loyihalari bilan aralashmasin */
function sessionDir(): string {
  const dir = join(env.dataDir, 'obuna');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function optionsFor(o: QueryOptions, abort: AbortController): Options {
  const builtins = o.webSearch ? ['WebSearch'] : [];
  const onSearch = o.onWebSearch;
  return {
    model: o.model,
    ...(o.effort ? { effort: o.effort } : {}),
    ...(o.schema ? { outputFormat: { type: 'json_schema' as const, schema: o.schema } } : {}),
    maxTurns: o.maxTurns,
    abortController: abort,
    systemPrompt: o.system,
    settingSources: [],
    // Egasining o'z MCP serverlari va claude.ai ulagichlari ham yuklanmaydi: faqat Palantir asboblari
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false },
    persistSession: o.persist,
    tools: builtins,
    mcpServers: o.mcp ? { palantir: o.mcp } : {},
    allowedTools: [...builtins, ...(o.mcp ? ['mcp__palantir'] : [])],
    // Ruxsat berilmagan narsa so'ralmaydi — darhol rad etiladi (kuzatuvchi yo'q)
    permissionMode: 'dontAsk',
    cwd: sessionDir(),
    env: childEnv(process.env),
    ...(o.resume ? { resume: o.resume } : {}),
    ...(onSearch ? { hooks: { PreToolUse: [{ matcher: 'WebSearch', hooks: [async () => { onSearch(); return { continue: true }; }] }] } } : {}),
  };
}

export async function runQuery(prompt: string | AsyncIterable<SDKUserMessage>, o: QueryOptions): Promise<TurnResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const msgs: SDKMessage[] = [];
  try {
    for await (const m of query({ prompt, options: optionsFor(o, abort) })) msgs.push(m);
  } catch (e) {
    const sessionId = msgs.find(m => 'session_id' in m && m.session_id)?.session_id ?? null;
    if (abort.signal.aborted) throw new SubscriptionError('timeout', 'Obuna javobi juda uzoq kutildi', sessionId);
    // Natija kelgan bo'lsa (jarayon yopilishidagi xato) — o'shani o'qiymiz
    if (!msgs.some(m => m.type === 'result')) {
      const why = e instanceof Error ? e.message : String(e);
      throw new SubscriptionError(classify(why), why, sessionId);
    }
  } finally {
    clearTimeout(timer);
  }
  return collectResult(msgs);
}

/** JSON javobda SDK javobni shaklga moslab qayta so'rashi mumkin: bunga bir necha qadam kerak */
const SCHEMA_TURNS = 3;

/**
 * Asbobsiz so'rov obuna orqali; javob API javobi ko'rinishida (chaqiruvchilar faqat content, stop_reason va usage'ni o'qiydi).
 * JSON shakli so'ralgan bo'lsa — matn bloki SDK tekshirgan JSON (chaqiruvchi API'dagidek JSON.parse qiladi)
 */
export async function subscriptionMessage(req: PlainRequest): Promise<Anthropic.Beta.BetaMessage> {
  const prompt = typeof req.content === 'string' ? req.content : oneMessage(req.content);
  const r = await runQuery(prompt, {
    system: req.system, model: req.model, effort: req.effort, persist: false,
    maxTurns: req.schema ? SCHEMA_TURNS : 1, ...(req.schema ? { schema: req.schema } : {}),
  });
  const text = r.structured !== undefined ? JSON.stringify(r.structured) : r.text;
  const message = {
    id: `obuna_${r.sessionId}`, type: 'message', role: 'assistant', model: req.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: r.refused ? 'refusal' : r.cut ? 'max_tokens' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_input_tokens: r.usage.cacheRead, cache_creation_input_tokens: r.usage.cacheWrite },
  };
  return message as unknown as Anthropic.Beta.BetaMessage;
}

// ─── Suhbat kaliti ────────────────────────────────────────────────────────────

/** Saqlangan suhbatning tools_key maydoni: «sdk:<asboblar kaliti>:<SDK sessiyasi>» — API rejimidagi kalit bilan adashmaydi */
const PREFIX = 'sdk:';
export const sessionKey = (setKey: string, sessionId: string): string => `${PREFIX}${setKey}:${sessionId}`;
export function sessionOf(toolsKey: string, setKey: string): string | null {
  const head = `${PREFIX}${setKey}:`;
  return toolsKey.startsWith(head) ? toolsKey.slice(head.length) || null : null;
}
