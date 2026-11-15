/**
 * Zaxira dvigatel: Claude obunasining limiti tugaganda (yoki tugashiga oz qolganda) oddiy ishlar — bemorlarga javob, qo'ng'iroq
 * tahlili, kamera kadri — klinikaning Gemini kalitida davom etadi (egasi qarori, 2026-11-16). Faqat asbobsiz so'rov: matn, rasm,
 * JSON shakli. Claude so'rovi Gemini Interactions so'roviga aylantiriladi, javob esa Claude javobi ko'rinishida qaytadi —
 * chaqiruvchi kod (replier, look, analysis) o'zgarmaydi. Sifati baholangan: npm run eval:gemini (2026-11-15, 3.8 Flash).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';

type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>;

const API_REVISION = '2026-05-20';
/** Bemor javobni kutyapti: bitta urinish 60 s, jami ~2 daqiqadan oshmaydi */
const TIMEOUT_MS = 60_000;
/** Model band (429/5xx) yoki tarmoq uzilsa — shuncha kutib bir marta qayta so'raladi */
const RETRY_WAITS_MS = [3_000];
const THINKING: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

export class GeminiError extends Error {}

export const geminiReady = (): boolean => !!env.geminiKey;

interface GeminiUsage { total_tokens?: number; total_input_tokens?: number; total_cached_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number }
interface GeminiStep { type?: string; content?: { type?: string; text?: string }[] }
interface GeminiReply { status?: string; error?: { message?: string }; usage?: GeminiUsage; steps?: GeminiStep[] }

type Block = { type: string; text?: string; source?: { type: string; media_type?: string; data?: string } };
const blocksOf = (content: unknown): Block[] => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content as Block[] : []);

function part(b: Block): object {
  if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
  if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image', data: b.source.data ?? '', mime_type: b.source.media_type ?? 'image/jpeg' };
  throw new GeminiError(`Gemini zaxirasida bu blok yo'q: ${b.type}`);
}

/** Claude so'rovi → Gemini so'rovi. Asbobli so'rov — zaxiraga tegishli emas (GeminiError) */
export function geminiRequest(p: Params, model = env.geminiTextModel): object {
  if (p.tools?.length) throw new GeminiError("Gemini zaxirasi asbobli so'rovni bajarmaydi");
  const system = typeof p.system === 'string' ? p.system : (p.system ?? []).map(b => b.text).join('\n\n');
  const format = p.output_config?.format;
  const input = p.messages.map(m => {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') return { type: 'model_output', content: [{ type: 'text', text: blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('') }] };
    return { type: 'user_input', content: blocks.map(part) };
  });
  return {
    model,
    // Suhbat Google tomonda saqlanmaydi: har so'rov o'zi to'liq
    store: false,
    ...(system ? { system_instruction: system } : {}),
    input,
    ...(format?.type === 'json_schema' ? { response_format: { type: 'text', mime_type: 'application/json', schema: format.schema } } : {}),
    generation_config: { thinking_level: THINKING[p.output_config?.effort ?? 'medium'] ?? 'medium', max_output_tokens: p.max_tokens },
  };
}

/** Gemini javobi → Claude javobi ko'rinishida (chaqiruvchilar content, stop_reason va usage'ni o'qiydi) */
export function claudeMessage(j: GeminiReply, model = env.geminiTextModel): Anthropic.Beta.BetaMessage {
  if (j.status === 'failed' || j.status === 'cancelled') throw new GeminiError(`Gemini javobi tugallanmadi (${j.status})${j.error?.message ? `: ${j.error.message.slice(0, 200)}` : ''}`);
  const text = (j.steps ?? []).filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'text' && c.text).map(c => c.text).join('');
  const u = j.usage ?? {};
  const cached = u.total_cached_tokens ?? 0;
  // O'ylash tokenlari ham chiqish hisobida: jami − kirish (ikki marta sanalmaydi)
  const output = u.total_tokens !== undefined ? u.total_tokens - (u.total_input_tokens ?? 0) : (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0);
  return {
    id: 'gemini', type: 'message', role: 'assistant', model, container: null, context_management: null,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: j.status === 'completed' || !j.status ? 'end_turn' : 'max_tokens', stop_sequence: null,
    usage: { input_tokens: (u.total_input_tokens ?? 0) - cached, output_tokens: output, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function once(body: object): Promise<{ reply: GeminiReply } | { error: string; retry: boolean }> {
  try {
    const r = await fetch(`${env.geminiApiRoot}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey, 'Api-Revision': API_REVISION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({})) as GeminiReply;
    if (r.ok) return { reply: j };
    return { error: `Gemini ${r.status}${j.error?.message ? `: ${j.error.message.slice(0, 200)}` : ''}`, retry: r.status === 429 || r.status >= 500 };
  } catch (e) {
    return { error: (e as Error).name === 'TimeoutError' ? 'Gemini javob bermadi' : `Gemini'ga ulanib bo'lmadi: ${(e as Error).message}`, retry: true };
  }
}

/** Asbobsiz Claude so'rovi Gemini'da. Kalit yo'q yoki Gemini yiqilsa — GeminiError */
export async function geminiMessage(p: Params): Promise<Anthropic.Beta.BetaMessage> {
  if (!geminiReady()) throw new GeminiError("Gemini kaliti yo'q");
  const body = geminiRequest(p);
  for (let attempt = 0; ; attempt++) {
    const r = await once(body);
    if ('reply' in r) return claudeMessage(r.reply);
    if (!r.retry || attempt >= RETRY_WAITS_MS.length) throw new GeminiError(r.error);
    await sleep(RETRY_WAITS_MS[attempt]);
  }
}
