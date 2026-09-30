/**
 * Sinov uchun soxta tashqi xizmatlar (haqiqiy token va pulsiz):
 *   Telegram Bot API — getUpdates orqali xabar beradi, yuborilganlarni yozib boradi, ovoz faylini beradi;
 *   Claude API — egasining gapidagi kalit so'zga qarab asbob chaqiradi (tool_use), natijadan keyin javob yozadi.
 *     Har so'rovda suhbat tarixi tekshiriladi: faqat oxiriga qo'shilganmi, asbob natijalari joyidami;
 *   ovoz xizmati (Gemini va Groq) — oldindan berilgan matnni qaytaradi.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const readBody = (req: IncomingMessage) => new Promise<Buffer>(res => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => res(Buffer.concat(chunks)));
});
export const listen = (srv: ReturnType<typeof createServer>) => new Promise<number>(res => srv.listen(0, '127.0.0.1', () => res((srv.address() as { port: number }).port)));
const json = (res: ServerResponse, body: unknown, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

// ─── Soxta Telegram ───────────────────────────────────────────────────────────
export interface Sent { method: string; params: Record<string, unknown>; file?: Buffer; id?: number }
export const sent: Sent[] = [];
let updates: unknown[] = [];
let updateId = 1;
let messageId = 100;
export const OWNER = 5001;
export const CUSTOMER = 7001;
export const CHANNEL = -100123;
export const VOICE_BYTES = Buffer.from('OggS-fake-voice-bytes');

export const tgServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '';
  if (url.startsWith('/file/')) { res.setHeader('content-type', 'audio/ogg'); return res.end(VOICE_BYTES); }
  const method = url.split('/').pop()!.split('?')[0];
  const body = await readBody(req);
  let params: Record<string, unknown> = {};
  let file: Buffer | undefined;
  const type = req.headers['content-type'] ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(body) }).formData();
    for (const [k, v] of form) {
      if (typeof v === 'string') params[k] = v;
      else file = Buffer.from(await v.arrayBuffer());
    }
  } else if (body.length) params = JSON.parse(body.toString());
  for (const k of ['reply_markup', 'media']) if (typeof params[k] === 'string') { try { params[k] = JSON.parse(params[k] as string); } catch { /* matn */ } }

  const reply = (result: unknown) => json(res, { ok: true, result });
  const fail = (code: number, description: string) => json(res, { ok: false, error_code: code, description }, code);

  if (method === 'getUpdates') {
    for (let i = 0; i < 10 && !updates.length; i++) await sleep(50);
    const out = updates;
    updates = [];
    return reply(out);
  }
  const entry: Sent = { method, params, file };
  if (method !== 'getMe') sent.push(entry);
  switch (method) {
    case 'getMe': return reply({ id: 999, is_bot: true, first_name: 'Cerebro', username: 'cerebro_test_bot' });
    case 'getChat':
      return params.chat_id === '@test_channel' ? reply({ id: CHANNEL, type: 'channel', title: 'Test kanal' }) : fail(400, 'Bad Request: chat not found');
    case 'getChatMember': return reply({ status: 'administrator', can_post_messages: true, user: { id: 999, is_bot: true, first_name: 'Cerebro' } });
    case 'getFile': return reply({ file_id: params.file_id, file_unique_id: 'u1', file_size: VOICE_BYTES.length, file_path: 'voice/file_1.oga' });
    case 'sendMessage': case 'sendPhoto': case 'sendDocument': case 'copyMessage':
      entry.id = ++messageId;
      return reply({ message_id: entry.id, date: 0, chat: { id: Number(params.chat_id), type: Number(params.chat_id) < 0 ? 'channel' : 'private' }, text: params.text, caption: params.caption });
    case 'editMessageCaption': case 'editMessageText':
      return reply({ message_id: Number(params.message_id), date: 0, chat: { id: Number(params.chat_id), type: 'private' } });
    default: return reply(true);
  }
});

const user = (id: number) => ({ id, is_bot: false, first_name: id === OWNER ? 'Aziz' : 'Mijoz', username: id === OWNER ? 'aziz' : 'mijoz1' });
const chat = (id: number) => ({ id, type: 'private', first_name: 'X' });
const push = (message: Record<string, unknown>) => { const id = ++messageId; updates.push({ update_id: updateId++, message: { message_id: id, date: Math.floor(Date.now() / 1000), ...message } }); return id; };
export const say = (from: number, text: string, replyTo?: number) => {
  const cmd = text.match(/^\/\w+/)?.[0];
  return push({ from: user(from), chat: chat(from), text, ...(cmd ? { entities: [{ type: 'bot_command', offset: 0, length: cmd.length }] } : {}), ...(replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat: chat(from) } } : {}) });
};
export const sendVoice = (from: number) => push({ from: user(from), chat: chat(from), voice: { file_id: 'voice-1', file_unique_id: 'u1', duration: 3, mime_type: 'audio/ogg' } });
export const press = (from: number, data: string, onMessage: number, text = '') =>
  updates.push({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: user(from), chat_instance: '1', data, message: { message_id: onMessage, date: 0, chat: chat(from), text } } });
export const shareContact = (from: number, phone: string) => push({ from: user(from), chat: chat(from), contact: { phone_number: phone, first_name: 'Mijoz', user_id: from } });
export const addedToChannel = (by: number) => updates.push({
  update_id: updateId++,
  my_chat_member: {
    chat: { id: CHANNEL - 1, type: 'channel', title: 'Ikkinchi kanal' }, from: user(by), date: 0,
    old_chat_member: { status: 'left', user: { id: 999, is_bot: true, first_name: 'Cerebro' } },
    new_chat_member: { status: 'administrator', can_post_messages: true, user: { id: 999, is_bot: true, first_name: 'Cerebro' } },
  },
});

export async function waitFor<T>(what: string, fn: () => T | undefined | false, ms = 20000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}

// ─── Soxta ovoz xizmati ───────────────────────────────────────────────────────
export const stt = { text: 'Bugun nima qilishim kerak?', geminiFails: false, gemini: 0, groq: 0, lastAudio: Buffer.alloc(0), lastMime: '' };
export const sttServer = createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.url?.startsWith('/gemini')) {
    stt.gemini++;
    if (stt.geminiFails) return json(res, { error: 'overloaded' }, 503);
    const b = JSON.parse(body.toString());
    stt.lastAudio = Buffer.from(b.input[1].data, 'base64');
    stt.lastMime = b.input[1].mime_type;
    return json(res, { steps: [{ content: [{ type: 'text', text: stt.text }] }] });
  }
  stt.groq++;
  return json(res, { text: stt.text });
});

// ─── Soxta Claude ─────────────────────────────────────────────────────────────
type Block = Record<string, any>;
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export const ai = { calls: 0, requests: [] as { system: string; messages: Msg[]; tools: Block[]; beta: string; thinking: unknown }[], violations: [] as string[] };

/** Tarix tekshiruvi uchun: biznes → oxirgi so'rov+javob va oxirgi tugagan suhbat */
const sessions = new Map<string, { system: string; last: Msg[]; committed: Msg[] }>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isPrefix = (prefix: Msg[], full: Msg[]) => prefix.length <= full.length && prefix.every((m, i) => same(m, full[i]));

const ownerText = (m: Msg): string | null => {
  if (typeof m.content === 'string') return m.content;
  const texts = m.content.filter(b => b.type === 'text').map(b => b.text as string);
  return texts.length ? texts[texts.length - 1] : null;
};
const lastOwnerText = (messages: Msg[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i].role === 'user' ? ownerText(messages[i]) : null;
    if (t) return t;
  }
  return '';
};

let toolSeq = 0;
const toolUse = (name: string, input: unknown): Block => ({ type: 'tool_use', id: `toolu_${++toolSeq}`, name, input });
const THINK: Block = { type: 'thinking', thinking: '', signature: 'sig-fake' };

/** Egasining gapi → keyingi qadam (asbob chaqirish yoki javob) */
function decide(messages: Msg[]): { content: Block[]; stop: string } {
  const last = messages[messages.length - 1];
  const said = lastOwnerText(messages).toLowerCase();
  const results = Array.isArray(last.content) ? last.content.filter(b => b.type === 'tool_result') : [];
  const done = (text: string) => ({ content: [THINK, { type: 'text', text }], stop: 'end_turn' });
  const call = (name: string, input: unknown, text?: string) => ({ content: [THINK, ...(text ? [{ type: 'text', text }] : []), toolUse(name, input)], stop: 'tool_use' });
  // Egasi yuborgan vaqt: "[2026-09-30 14:05, …]" — ertangi sanani shundan hisoblaymiz
  const stampMatch = /\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(lastOwnerText(messages));
  const tomorrow = stampMatch ? new Date(new Date(`${stampMatch[1]}T12:00:00`).getTime() + 86_400_000).toISOString().slice(0, 10) : '2000-01-01';

  if (results.length) {
    const r = results[results.length - 1];
    const content = String(typeof r.content === 'string' ? r.content : JSON.stringify(r.content));
    if (said.includes('rahmat xabar') && content.includes('"leads"')) {
      const ids = [...content.matchAll(/"id":"([a-z0-9]+)"/g)].map(m => m[1]);
      return call('draft_followup', { lead_ids: ids, text: "Assalomu alaykum! Bizni tanlaganingiz uchun rahmat. Savollar bo'lsa, shu yerga yozing." });
    }
    if (said.includes('post') && r.is_error) {
      // Birinchi urinish filtrdan o'tmadi — toza matn bilan qayta
      return call('make_post', { template: 'promo', kicker: 'Aksiya', title: 'Dam olish kunlari', badge: '-15%', lines: ["Shanba va yakshanba barcha stollarga 15% chegirma", 'Yetkazib berish bepul'], caption: "Dam olish kunlari barcha stollarga 15% chegirma. Buyurtma uchun yozing!" });
    }
    if (said.includes('bugun nima')) {
      const s = JSON.parse(content);
      return done(`Bugun: **${s.tasks.today.length}** ta vazifa, kechikkan: ${s.tasks.overdue.length}. Yangi mijozlar (7 kun): ${s.customers.new_last_7_days}.`);
    }
    return done(r.is_error ? `XATO: ${content}` : `Bajarildi (${content.slice(0, 60)})`);
  }

  if (said.includes('rad et')) return { content: [], stop: 'refusal' };
  if (said.includes('internetdan')) {
    const paused = messages[messages.length - 1].role === 'assistant';
    return paused ? done("Dollar kursi: 12 650 so'm (manba: cbu.uz).") : { content: [THINK, { type: 'text', text: 'Qidiryapman…' }], stop: 'pause_turn' };
  }
  if (said.includes('eslat')) return call('create_task', { title: 'Bankka borish', due_at: `${tomorrow}T10:00` });
  if (said.includes("mijoz qo'sh")) return call('save_lead', { name: 'Aziz Karimov', phone: '+998901234567', note: "2 ta stol so'radi", source: 'tanish orqali' });
  if (said.includes('rahmat xabar')) return call('list_leads', { days: 7 });
  if (said.includes('taklif')) {
    return call('create_document', {
      title: 'Tijorat taklifi — Aliyev', kind: 'offer',
      markdown: "# Tijorat taklifi\n\nHurmatli **Aliyev** janoblari!\n\n| Mahsulot | Soni | Narx |\n|---|---|---|\n| Stol | 20 | ________ |\n\n1. Yetkazib berish: 3 kun\n2. To'lov: ________\n\n- Imzo: ________",
    });
  }
  if (said.includes('post')) {
    return call('make_post', { template: 'promo', kicker: 'Aksiya', title: 'Dam olish kunlari', lines: ['Shahardagi eng yaxshi narxlar'], caption: 'Eng yaxshi narxlar faqat bizda!' });
  }
  if (said.includes('eslab qol')) return call('remember', { fact: "500 ming so'mdan yuqori buyurtmaga yetkazish bepul" });
  if (said.includes('bugun nima')) return call('get_summary', {});
  return done(`Tushundim: ${said.split('\n').pop()}`);
}

export const aiServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as { system: string; messages: Msg[]; tools: Block[]; thinking: unknown; model: string };
  ai.calls++;
  const beta = String(req.headers['anthropic-beta'] ?? '');
  ai.requests.push({ system: body.system, messages: body.messages, tools: body.tools, beta, thinking: body.thinking });
  const fail = (why: string) => { ai.violations.push(why); return json(res, { type: 'error', error: { type: 'invalid_request_error', message: why } }, 400); };

  // Asbob chaqiruvlarining hammasiga natija bormi (keyingi xabarda, bittadan)
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const ids = m.content.filter(b => b.type === 'tool_use').map(b => b.id);
    if (!ids.length) continue;
    const next = body.messages[i + 1];
    const got = next && Array.isArray(next.content) ? next.content.filter(b => b.type === 'tool_result').map(b => b.tool_use_id) : [];
    if (!ids.every(id => got.includes(id))) return fail(`tool_use ${ids.join(',')} natijasiz qoldi`);
  }

  // Suhbat faqat oxiriga qo'shiladimi (tizim ko'rsatmasi o'zgarmaydimi)
  const key = /Name: (.*)/.exec(body.system)?.[1] ?? '?';
  const said = lastOwnerText(body.messages).toLowerCase();
  const s = sessions.get(key);
  if (body.messages.length > 1) {
    if (!s) return fail('yangi sessiya birinchi xabardan boshlanmadi');
    // Sinov: eski suhbat API'ga yoqmay qolsa — server yangi sessiya bilan qayta urinishi kerak
    if (said.includes('buzuq')) return json(res, { type: 'error', error: { type: 'invalid_request_error', message: 'eski suhbat' } }, 400);
    if (s.system !== body.system) return fail("sessiya ichida tizim ko'rsatmasi o'zgardi");
    if (!isPrefix(s.last, body.messages) && !isPrefix(s.committed, body.messages)) return fail("tarix o'zgartirilgan (faqat oxiriga qo'shilishi kerak)");
  }

  // Sinov: AI sekin javob bersa ham bot boshqalarga javob beraversin
  if (said.includes('sekin')) await sleep(3000);
  const { content, stop } = decide(body.messages);
  const response = { role: 'assistant' as const, content };
  sessions.set(key, {
    system: body.system,
    last: [...body.messages, response],
    committed: stop === 'end_turn' ? [...body.messages, response] : body.messages.length === 1 ? [] : (s?.committed ?? []),
  });
  json(res, {
    id: `msg_${ai.calls}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null,
    stop_details: null, usage: { input_tokens: 10, output_tokens: 20 },
  });
});
