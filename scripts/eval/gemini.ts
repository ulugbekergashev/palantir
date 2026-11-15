/**
 * AI ishlarini Gemini'da baholash — model almashtirish qaroridan oldin, raqamlar bilan.
 * Shu jarayonda ko'prik ochiladi: Claude'ga ketadigan so'rov (matn, rasm, JSON shakli, asboblar) Gemini'ga (Interactions API)
 * aylantiriladi, keyin odatdagi baholash (eval-ai.ts) shu ko'prik orqali o'tadi — holatlar ham, tekshiruvlar ham bir xil.
 *   npm run eval:gemini -- gemini-3.8-flash --yes --only mijoz-narx,mijoz-qabul
 *   npm run eval:gemini -- gemini-3.8-flash --script scripts/eval-tasks.ts --yes     (boshqa baholash skripti)
 * Asboblar: faqat Palantir'ning o'zi bajaradiganlari (egasining yordamchisi); internet qidiruvi kabi Claude tomonidagilari — yo'q.
 * GEMINI_API_KEY — .env dan (pullik kalitda pul ketadi, bepulida limit). Baholash skripti ko'rsatgan narx Claude narxida sanaladi —
 * Gemini'ning haqiqiy xarajati oxirida shu yerdan chiqadi.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/** Million token uchun dollar: kirish, chiqish (o'ylash ham), keshdan o'qish. next — e'lon qilingan yangi narx (from sanasidan) */
type Price = [input: number, output: number, cached: number];
const PRICES: Record<string, { now: Price; next?: Price; from?: string }> = {
  'gemini-3.8-flash': { now: [0.75, 3.75, 0.075], next: [1.5, 7.5, 0.15], from: '2027-01-01' },
  'gemini-3.5-flash-lite': { now: [0.3, 2.5, 0.03] },
  'gemini-3.1-flash-lite': { now: [0.25, 1.5, 0.025] },
  'gemini-4-hydrogen': { now: [1.5, 7.5, 0.075] },
  'gemini-4-argon': { now: [2, 10, 0.1], next: [4, 20, 0.2], from: '2026-12-01' },
  'gemini-4-carbon': { now: [2, 10, 0.1], next: [4, 20, 0.2], from: '2026-12-01' },
};
const API_REVISION = '2026-05-20';
const TIMEOUT_MS = 120_000;
/** Model band (429/5xx) bo'lsa — shuncha kutib qayta so'raladi */
const RETRY_WAITS_MS = [2_000, 6_000, 15_000];
const THINKING: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const [model, ...evalArgs] = process.argv.slice(2);
if (!model || model.startsWith('-')) {
  console.error(`Model kerak: npm run eval:gemini -- <model> [--yes --only …]\nNarxi ma'lum modellar: ${Object.keys(PRICES).join(', ')}`);
  process.exit(1);
}
const key: string = process.env.GEMINI_API_KEY || (existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')).GEMINI_API_KEY : '') || '';
if (!key) { console.error("GEMINI_API_KEY yo'q (.env yoki muhitda)"); process.exit(1); }
// eval-ai.ts --model ni AI_MODEL ga yozadi: hisobotda bir model, ko'prikda boshqasi bo'lib qolmasin
if (evalArgs.includes('--model')) { console.error("--model kerak emas: model birinchi so'z bilan beriladi"); process.exit(1); }
const root = (process.env.GEMINI_API_ROOT || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
// --script <fayl>: eval-ai.ts o'rniga boshqa baholash skripti shu ko'prik orqali o'tadi
const scriptAt = evalArgs.indexOf('--script');
const script = scriptAt >= 0 ? evalArgs.splice(scriptAt, 2)[1] : 'scripts/eval-ai.ts';
if (!script || !existsSync(script)) { console.error(`--script: fayl topilmadi (${script ?? ''})`); process.exit(1); }

interface ClaudeBlock {
  type: string; text?: string; source?: { type: string; media_type: string; data: string };
  /** tool_use */
  id?: string; name?: string; input?: unknown;
  /** tool_result */
  tool_use_id?: string; content?: string | ClaudeBlock[]; is_error?: boolean;
}
interface ClaudeTool { type?: string; name: string; description?: string; input_schema?: unknown }
interface ClaudeRequest {
  system?: string | { text: string }[];
  messages: { role: string; content: string | ClaudeBlock[] }[];
  tools?: ClaudeTool[];
  max_tokens: number;
  output_config?: { effort?: string; format?: { type: string; schema: unknown } };
}
interface GeminiUsage { total_tokens?: number; total_input_tokens?: number; total_cached_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number }
interface GeminiStep { type?: string; id?: string; name?: string; arguments?: Record<string, unknown>; content?: { type?: string; text?: string }[] }
interface GeminiReply { status?: string; error?: { message?: string }; usage?: GeminiUsage; steps?: GeminiStep[] }

class Unsupported extends Error {}

function geminiBlock(b: ClaudeBlock): object {
  if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
  if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image', data: b.source.data, mime_type: b.source.media_type };
  throw new Unsupported(`ko'prikda yo'q blok: ${b.type}`);
}
const blocksOf = (content: string | ClaudeBlock[]): ClaudeBlock[] => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);

/**
 * Gemini o'z javobining qadamlarini (o'ylash imzosi bilan) keyingi so'rovda aynan qaytarishni talab qiladi, Claude shaklidagi
 * suhbatda esa ular yo'q: asbob chaqiruvi id'si → o'sha javobning hamma qadamlari va asbob nomi shu yerda turadi
 */
const stepsByCall = new Map<string, GeminiStep[]>();
const nameByCall = new Map<string, string>();

/** Gemini asbob sxemasida qabul qilmaydigan kalit so'zlar (xossa nomlariga tegilmaydi) */
const DROPPED_KEYWORDS = new Set<string>([]);
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !DROPPED_KEYWORDS.has(k)).map(([k, v]) => [
    k,
    k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([name, s]) => [name, cleanSchema(s)])) : cleanSchema(v),
  ]));
}

function geminiTool(t: ClaudeTool): object {
  if (t.type && t.type !== 'custom') throw new Unsupported(`ko'prikda yo'q asbob turi: ${t.type}`);
  return { type: 'function', name: t.name, description: t.description ?? '', parameters: cleanSchema(t.input_schema ?? { type: 'object', properties: {} }) };
}

/** Yordamchining oldingi javobi → Gemini qadamlari: asbob chaqirgan javob — saqlangan asl qadamlari bilan, matnligi — matn qadami */
function assistantSteps(blocks: ClaudeBlock[]): object[] {
  const calls = blocks.filter(b => b.type === 'tool_use');
  if (!calls.length) {
    const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    return text ? [{ type: 'model_output', content: [{ type: 'text', text }] }] : [];
  }
  const kept = stepsByCall.get(calls[0].id ?? '');
  if (!kept) throw new Unsupported("suhbatda boshqa modelning asbob chaqiruvi bor — ko'prik faqat o'zi orqali o'tgan suhbatni davom ettiradi");
  return kept;
}

function userSteps(blocks: ClaudeBlock[]): object[] {
  const results = blocks.filter(b => b.type === 'tool_result').map(b => ({
    type: 'function_result', name: nameByCall.get(b.tool_use_id ?? '') ?? '', call_id: b.tool_use_id,
    result: blocksOf(b.content ?? '').map(c => (c.type === 'text' ? { type: 'text', text: `${b.is_error ? 'ERROR: ' : ''}${c.text ?? ''}` } : geminiBlock(c))),
  }));
  const rest = blocks.filter(b => b.type !== 'tool_result');
  return [...results, ...(rest.length ? [{ type: 'user_input', content: rest.map(geminiBlock) }] : [])];
}

/** Claude so'rovi → Gemini Interactions so'rovi (suhbat to'liq yuboriladi, Google tomonda saqlanmaydi) */
function toGemini(q: ClaudeRequest): object {
  const system = typeof q.system === 'string' ? q.system : (q.system ?? []).map(b => b.text).join('\n\n');
  const format = q.output_config?.format;
  return {
    model,
    store: false,
    ...(system ? { system_instruction: system } : {}),
    input: q.messages.flatMap(m => (m.role === 'assistant' ? assistantSteps(blocksOf(m.content)) : userSteps(blocksOf(m.content)))),
    ...(q.tools?.length ? { tools: q.tools.map(geminiTool) } : {}),
    ...(format?.type === 'json_schema' ? { response_format: { type: 'text', mime_type: 'application/json', schema: format.schema } } : {}),
    generation_config: { thinking_level: THINKING[q.output_config?.effort ?? 'medium'] ?? 'medium', max_output_tokens: q.max_tokens },
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Bitta urinish: javob yoki qayta urinsa bo'ladigan xato (model band, tarmoq uzildi, javob bermadi) — retry: true */
async function askOnce(body: object): Promise<{ reply: GeminiReply } | { error: string; retry: boolean }> {
  try {
    const r = await fetch(`${root}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': API_REVISION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({})) as GeminiReply;
    if (r.ok) return { reply: j };
    return { error: `Gemini ${r.status}${j.error?.message ? `: ${j.error.message.slice(0, 300)}` : ''}`, retry: r.status === 429 || r.status >= 500 };
  } catch (e) {
    return { error: (e as Error).name === 'TimeoutError' ? 'Gemini javob bermadi' : `Gemini'ga ulanib bo'lmadi: ${(e as Error).message}`, retry: true };
  }
}

async function askGemini(body: object): Promise<GeminiReply> {
  for (let attempt = 0; ; attempt++) {
    const r = await askOnce(body);
    if ('reply' in r) return r.reply;
    if (!r.retry || attempt >= RETRY_WAITS_MS.length) throw new Error(r.error);
    await sleep(RETRY_WAITS_MS[attempt]);
  }
}

const total = { calls: 0, input: 0, cached: 0, output: 0 };
/** Ko'prikning o'z xatolari (asbobli so'rov, limit, tarmoq): eval-ai.ts ularni holat «o'tmadi» deb sanaydi — bu modelning xatosi emas */
const bridgeErrors: string[] = [];

/** Gemini javobi → Claude xabari shaklida (eval-ai.ts va server kodi shuni kutadi) */
function toClaude(j: GeminiReply): object {
  const steps = j.steps ?? [];
  const text = steps.flatMap(s => s.content ?? []).filter(c => c.type === 'text' && c.text).map(c => c.text).join('');
  const calls = steps.filter(s => s.type === 'function_call');
  // Bular modelning javobi emas — ko'prik xatosi bo'lib sanalsin (bo'sh javob «model adashdi» deb o'tib ketmasin)
  if (j.status === 'failed' || j.status === 'cancelled') throw new Error(`Gemini javobi tugallanmadi (${j.status})${j.error?.message ? `: ${j.error.message.slice(0, 300)}` : ''}`);
  if (calls.some(c => !c.id || !c.name)) throw new Error("Gemini asbob chaqiruvi id yoki nomsiz keldi");
  for (const c of calls) { stepsByCall.set(c.id!, steps); nameByCall.set(c.id!, c.name!); }
  const u = j.usage ?? {};
  const cached = u.total_cached_tokens ?? 0, input = (u.total_input_tokens ?? 0) - cached;
  // O'ylash tokenlari ham chiqish narxida. Jami − kirish: o'ylash chiqish ichida sanalsa ham, alohida sanalsa ham ikki marta qo'shilmaydi
  const output = u.total_tokens !== undefined ? u.total_tokens - (u.total_input_tokens ?? 0) : (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0);
  total.input += input; total.cached += cached; total.output += output;
  return {
    id: 'msg_gemini', type: 'message', role: 'assistant', model,
    content: [...(text || !calls.length ? [{ type: 'text', text }] : []), ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} }))],
    stop_reason: calls.length ? 'tool_use' : j.status === 'completed' ? 'end_turn' : 'max_tokens', stop_sequence: null,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 },
  };
}

async function readJson(req: IncomingMessage): Promise<ClaudeRequest> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ClaudeRequest;
}

/** Ko'prik faqat shu jarayonning so'rovlarini o'tkazadi: kompyuterdagi boshqa dastur yoki sahifa Gemini kaliti hisobidan so'ray olmasin */
const bridgeToken = randomUUID();

const bridge = createServer(async (req, res) => {
  if (req.headers['x-api-key'] !== bridgeToken) { res.writeHead(401).end(); return; }
  total.calls++;
  try {
    const reply = toClaude(await askGemini(toGemini(await readJson(req))));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
  } catch (e) {
    bridgeErrors.push((e as Error).message);
    // 400 — Claude mijozi qayta urinmaydi: ko'prik o'zi qayta so'rab bo'lgan
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: (e as Error).message } }));
  }
});
await new Promise<void>(done => bridge.listen(0, '127.0.0.1', done));

const cost = ([inPrice, outPrice, cachedPrice]: Price) => (total.input * inPrice + total.cached * cachedPrice + total.output * outPrice) / 1_000_000;
process.on('exit', () => {
  if (!total.calls) return;
  const p = PRICES[model];
  console.log(`\nGemini (${model}): ${total.calls} so'rov · kirish ${total.input}, keshdan ${total.cached}, chiqish ${total.output} token`);
  if (bridgeErrors.length) {
    console.log(`DIQQAT: ${bridgeErrors.length} ta so'rov ko'prikda yiqildi — yuqoridagi «o'tmadi»larning shunchasi modelniki EMAS, natijani solishtirmang:`);
    for (const e of [...new Set(bridgeErrors)].slice(0, 5)) console.log(`  ${e}`);
  }
  if (!p) { console.log("Bu modelning narxi jadvalda yo'q (PRICES) — xarajatni tokenlardan o'zingiz sanang"); return; }
  const ok = total.calls - bridgeErrors.length || 1;
  console.log(`Haqiqiy xarajat: $${cost(p.now).toFixed(4)} · bir so'rov o'rtacha $${(cost(p.now) / ok).toFixed(5)}${p.next ? ` · ${p.from} dan: $${cost(p.next).toFixed(4)} ($${(cost(p.next) / ok).toFixed(5)})` : ''}`);
});

Object.assign(process.env, {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`, ANTHROPIC_API_KEY: bridgeToken, ANTHROPIC_AUTH_TOKEN: '',
  AI_MODEL: model, AI_ENGINE: 'api',
});
process.argv = [process.argv[0], process.argv[1], ...evalArgs];
await import(pathToFileURL(resolve(script)).href);
bridge.close();
