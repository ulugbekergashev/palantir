/**
 * Sinov uchun soxta tashqi xizmatlar (haqiqiy token va pulsiz):
 *   Telegram Bot API — getUpdates orqali xabar beradi, yuborilganlarni yozib boradi;
 *   Claude API — JSON matn qaytaradi (bittasi ataylab qoidani buzadi).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const readBody = (req: IncomingMessage) => new Promise<Buffer>(res => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => res(Buffer.concat(chunks)));
});
export const listen = (srv: ReturnType<typeof createServer>) => new Promise<number>(res => srv.listen(0, '127.0.0.1', () => res((srv.address() as { port: number }).port)));

// ─── Soxta Telegram ───────────────────────────────────────────────────────────
export interface Sent { method: string; params: Record<string, unknown>; file?: Buffer }
export const sent: Sent[] = [];
let updates: unknown[] = [];
let updateId = 1;
let messageId = 100;
export const OWNER = 5001;
export const PATIENT = 7001;
export const CHANNEL = -100123;

export const tgServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = (req.url ?? '').split('/').pop()!.split('?')[0];
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

  const reply = (result: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
  const fail = (code: number, description: string) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: code, description })); };

  if (method === 'getUpdates') {
    for (let i = 0; i < 10 && !updates.length; i++) await sleep(50);
    const out = updates;
    updates = [];
    return reply(out);
  }
  if (method !== 'getMe') sent.push({ method, params, file });
  switch (method) {
    case 'getMe': return reply({ id: 999, is_bot: true, first_name: 'Cerebro', username: 'cerebro_test_bot' });
    case 'getChat':
      return params.chat_id === '@test_channel' ? reply({ id: CHANNEL, type: 'channel', title: 'Test kanal' }) : fail(400, 'Bad Request: chat not found');
    case 'getChatMember': return reply({ status: 'administrator', can_post_messages: true, user: { id: 999, is_bot: true, first_name: 'Cerebro' } });
    case 'sendMessage': case 'sendPhoto': case 'sendDocument':
      return reply({ message_id: ++messageId, date: 0, chat: { id: Number(params.chat_id), type: Number(params.chat_id) < 0 ? 'channel' : 'private' }, text: params.text, caption: params.caption });
    case 'editMessageCaption': case 'editMessageMedia':
      return reply({ message_id: Number(params.message_id), date: 0, chat: { id: Number(params.chat_id), type: 'private' } });
    default: return reply(true);
  }
});

const user = (id: number) => ({ id, is_bot: false, first_name: id === OWNER ? 'Aziz' : 'Bemor', username: id === OWNER ? 'aziz' : 'bemor1' });
const chat = (id: number) => ({ id, type: 'private', first_name: 'X' });
export const say = (from: number, text: string) => {
  const cmd = text.match(/^\/\w+/)?.[0];
  updates.push({ update_id: updateId++, message: { message_id: ++messageId, from: user(from), chat: chat(from), date: Math.floor(Date.now() / 1000), text, ...(cmd ? { entities: [{ type: 'bot_command', offset: 0, length: cmd.length }] } : {}) } });
};
export const press = (from: number, data: string, onMessage: number) =>
  updates.push({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: user(from), chat_instance: '1', data, message: { message_id: onMessage, date: 0, chat: chat(from) } } });
export const shareContact = (from: number, phone: string) =>
  updates.push({ update_id: updateId++, message: { message_id: ++messageId, from: user(from), chat: chat(from), date: 0, contact: { phone_number: phone, first_name: 'Bemor', user_id: from } } });

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

// ─── Soxta Claude ─────────────────────────────────────────────────────────────
export const ai = { calls: 0 };
const lt = (o: Partial<{ hook: string; title: string; lines: string[]; closer: string }>) => ({ hook: '', title: '', lines: [], closer: '', ...o });
export const aiServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString());
  ai.calls++;
  let text: string;
  if (body.output_config?.format) {
    const request = JSON.parse(body.messages[0].content);
    text = JSON.stringify({
      items: request.items.map((it: { id: string; template: string }) => {
        switch (it.template) {
          case 'promo': return { id: it.id, uz: lt({ hook: "Tabassumingizni qaytarish vaqti keldi.", lines: ['Chaynash qulayligi qaytadi', "Reja ko'rikdan so'ng tuziladi"] }), ru: lt({ hook: 'Пора вернуть улыбку.', lines: ['Возвращает комфорт жевания', 'План — после осмотра'] }) };
          case 'tip': return { id: it.id, uz: lt({ title: 'Tishlarni kechqurun yuvish nega muhim?', lines: ["Kechasi so'lak kam ajraladi", 'Bakteriyalar tez ko\'payadi', 'Uxlashdan oldin 2 daqiqa yuving'], closer: "Savollaringizni izohda yozing." }), ru: lt({ title: 'Почему важно чистить зубы вечером?', lines: ['Ночью меньше слюны', 'Бактерии размножаются быстрее', 'Чистите 2 минуты перед сном'], closer: 'Задавайте вопросы в комментариях.' }) };
          // Ataylab qoidani buzadi — rad etilishi kerak
          case 'doctor': return { id: it.id, uz: lt({ closer: "100% kafolat bilan davolaydi!" }), ru: lt({ closer: 'Лечит с гарантией!' }) };
          case 'holiday': return { id: it.id, uz: lt({ lines: ['Tabassumingiz doim porlasin', "Sog'lik tilaymiz"] }), ru: lt({ lines: ['Пусть улыбка сияет', 'Желаем здоровья'] }) };
          default: return { id: it.id, uz: lt({ title: 'Tishingiz sovuqdan sezadimi?', lines: ['Ha', "Yo'q"] }), ru: lt({ title: 'Зубы реагируют на холод?', lines: ['Да', 'Нет'] }) };
        }
      }),
    });
  } else text = 'Bu hafta 1 kishi raqam qoldirdi (AI javobi).';
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: `msg_${ai.calls}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
});

