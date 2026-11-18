/**
 * Dasturchining dvigateli: Claude Code (Agent SDK) egasining obunasida, ish nusxasi papkasida, fayl va buyruq asboblari bilan.
 * Yordamchi suhbatidan (subscription/owner.ts) farqi: bu yerda Claude Code'ning o'z asboblari yoqiq (o'qish, tahrirlash, Bash),
 * Palantir asboblari esa yo'q — kod ishida mijozlar, xabarlar va xotiraga yo'l yo'q. Har chaqiruv guard.ts dan o'tadi.
 * Egasining Claude Code sozlamalari, plaginlari va MCP serverlari yuklanmaydi (settingSources: []) — ish har kompyuterda bir xil.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { query, type HookCallback, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { env } from '../env';
import { childEnv, classify, collectResult, SubscriptionError, type TokenUsage } from '../subscription/engine';
import { agentEnv, toolDenied } from './guard';

export type AgentEvent = { kind: 'text'; text: string } | { kind: 'tool'; name: string; detail: string };
export interface AgentRun {
  workDir: string;
  prompt: string;
  /** Claude Code ko'rsatmasiga qo'shiladigan qism (jobs.ts) */
  system: string;
  /** Davom ettiriladigan suhbat (shu ish nusxasidagi oldingi ish) */
  resume: string | null;
  abort: AbortController;
  onEvent: (e: AgentEvent) => void;
}
/** cut — qadamlar tugadi (ish chala bo'lishi mumkin) */
export interface AgentResult { text: string; sessionId: string | null; cut: boolean; usage: TokenUsage }

const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];
const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const guardHook = (workDir: string): HookCallback => async input => {
  if (input.hook_event_name !== 'PreToolUse') return { continue: true };
  const why = toolDenied(workDir, { tool: input.tool_name, input: (input.tool_input ?? {}) as Record<string, unknown> });
  if (!why) return { continue: true };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Yopiq: ${why}. Aylanib o'tishga urinmang — kerak bo'lsa hisobotda egasiga ayting.` } };
};

/** Palantir .env faylidagi nomlar (env.ts shu faylni o'qigan): ular Dasturchiga o'tmaydi */
function ownEnvKeys(): string[] {
  try {
    return process.env.DOTENV !== '0' && existsSync('.env') ? Object.keys(parseEnv(readFileSync('.env', 'utf8'))) : [];
  } catch {
    return [];
  }
}

function optionsFor(r: AgentRun): Options {
  return {
    model: env.devModel || env.aiModel,
    maxTurns: env.devMaxTurns,
    abortController: r.abort,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: r.system },
    settingSources: [],
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false },
    persistSession: true,
    tools: TOOLS,
    allowedTools: TOOLS,
    permissionMode: 'dontAsk',
    cwd: r.workDir,
    env: agentEnv(childEnv(process.env), ownEnvKeys()),
    hooks: { PreToolUse: [{ hooks: [guardHook(r.workDir)] }] },
    ...(r.resume ? { resume: r.resume } : {}),
  };
}

/** Asbob chaqiruvining egasiga ko'rinadigan qisqa izohi: qaysi fayl yoki buyruq */
function detailOf(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const v = i.file_path ?? i.command ?? i.pattern ?? i.path ?? '';
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').slice(0, 120) : '';
}

function emit(m: SDKMessage, onEvent: AgentRun['onEvent']): void {
  if (m.type !== 'assistant' || m.parent_tool_use_id != null) return;
  for (const b of m.message.content) {
    if (b.type === 'text' && b.text.trim()) onEvent({ kind: 'text', text: b.text.trim() });
    else if (b.type === 'tool_use') onEvent({ kind: 'tool', name: b.name, detail: detailOf(b.input) });
  }
}

type FakeAgent = (r: AgentRun) => Promise<AgentResult>;

export async function runAgent(r: AgentRun): Promise<AgentResult> {
  if (env.devFakeAgent) {
    const mod = await import(pathToFileURL(env.devFakeAgent).href) as { default: FakeAgent };
    return mod.default(r);
  }
  // Natija uchun kerakli xabarlargina saqlanadi: asbob natijalari (fayl matnlari) uzoq ishda xotirani to'ldirmasin
  const kept: SDKMessage[] = [];
  try {
    for await (const m of query({ prompt: r.prompt, options: optionsFor(r) })) {
      if (m.type === 'assistant' || m.type === 'result' || m.type === 'rate_limit_event' || (m.type === 'system' && kept.length === 0)) kept.push(m);
      emit(m, r.onEvent);
    }
  } catch (e) {
    const sessionId = kept.find(m => 'session_id' in m && m.session_id)?.session_id ?? null;
    if (r.abort.signal.aborted) return { text: '', sessionId, cut: true, usage: NO_USAGE };
    if (!kept.some(m => m.type === 'result')) {
      const why = e instanceof Error ? e.message : String(e);
      throw new SubscriptionError(classify(why), why, sessionId);
    }
  }
  const res = collectResult(kept);
  return { text: res.text, sessionId: res.sessionId, cut: res.cut, usage: res.usage };
}
