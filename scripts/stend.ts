/**
 * Stend: haqiqiy server va panel, tashqi dunyo esa — qo'lda boshqariladigan soxta xizmatlar. `npm run stend`.
 * `npm run demo` dan farqi: bu yerda hech narsa ssenariy bo'yicha o'zi bo'lmaydi. Siz mijoz bo'lib Telegram'ga, egasining shaxsiy
 * Telegramiga yoki Instagram'ga yozasiz, egasi bo'lib javob berasiz va tugma bosasiz, CRM'ga qabul qo'shasiz, kreslodagi odamni
 * yoqib-o'chirasiz — javobni har safar haqiqiy server kodi beradi. Ikki oyna ochiladi:
 *   panel (egasining kabineti)  http://127.0.0.1:3220
 *   tashqi dunyo (shu stend)    http://127.0.0.1:3221
 * Haqiqiy: server, baza, bot mantiqi, yozishma, bilim papkasi, eslatmalar, CRM mijozi, kamera hisobi, ovozli agent darvozasi, panel.
 * Soxta: Telegram, shaxsiy Telegram, Instagram, DentaCRM, ovoz→matn (scripts/fakes.ts, fakeCrm.ts).
 * Model: .env'da ANTHROPIC_API_KEY bo'lsa — haqiqiy Claude; bo'lmasa — taqlid miya (scripts/stendBrain.ts): u qoidalar bo'yicha
 * ishlaydi va gapni tushunish sifatini KO'RSATMAYDI — buni faqat haqiqiy kalit ko'rsatadi.
 * Ma'lumot .stend-data papkasida, har ishga tushganda yangidan boshlanadi; `data/` ga tegilmaydi; faqat shu kompyuterdan ochiladi.
 */
import '../server/tz';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { addDays, iso } from '../src/lib/week';
import { fold } from './stendParse';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';
import { IG_VIEWER, OWNER, TG_SESSION, ai, aiServer, igWeb, igWebServer, json, listen, press, say, sendDocument, sendVoice, sent, shareContact, sleep, stt, sttServer, tgNames, tgServer, tgUser, tgUserServer, wire } from './fakes';
import { EXAMPLES, ownerTurn } from './stendBrain';
import { customerTurn } from './stendCustomer';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PANEL_PORT = Number(process.env.STEND_PORT) || 3220;
const WORLD_PORT = PANEL_PORT + 1;
const panelUrl = `http://127.0.0.1:${PANEL_PORT}`, worldUrl = `http://127.0.0.1:${WORLD_PORT}`;
/** Loyiha ildizi: qayerdan ishga tushirilishidan qat'i nazar .env, dist va .stend-data shu yerdan olinadi */
const ROOT = resolve(import.meta.dirname, '..');
/** Kirish ma'lumoti. Model taqlid bo'lsa — hammaga ma'lum parol (yo'qotadigan narsa yo'q); haqiqiy kalit bilan — har safar tasodifiy */
let account = { login: 'stend', password: 'stend-parol-1' };
const ADMIN_PASSWORD = randomBytes(12).toString('hex');
/** Stendga kiritiladigan matn va fayl chegaralari (server ham shundan kattasini olmaydi) */
const MAX_TEXT = 4000, MAX_JSON_BYTES = 1024 * 1024, MAX_FILE_BYTES = 16 * 1024 * 1024;
const OWNER_PHONE = '+998901112233';
/** Vaqt siqilgan joylar (qolgani haqiqiy vaqtda): «Sizni kutadi» sozlamasidagi bir daqiqa — shuncha soniya */
const MINUTE_SEC = 10;
const TIMING = { TICK_MS: '3000', INBOX_DEBOUNCE_MS: '2500', MINUTE_MS: String(MINUTE_SEC * 1000), IG_POLL_MS: '2000', CAMERA_ENTER_SEC: '3', CAMERA_LEAVE_SEC: '5', CAMERA_MIN_SESSION_SEC: '5' };
const FRAME_MS = 500;
const ZONE = { x: 0.3, y: 0.25, w: 0.4, h: 0.55 };
const PERSON = [{ x: 0.42, y: 0.34, w: 0.16, h: 0.36 }];
const CAMERAS = [['Kabinet 1', 'chair', 'd1'], ['Kabinet 2', 'chair', 'd2'], ['Kassa', 'desk', null]] as const;
/** Klinika o'rnatilgan kuni biladigan narsalar; qolganini stendda o'zingiz o'rgatasiz */
const KNOWN: Record<string, string> = { payment: 'Naqd, karta, Click va Payme', installment: "3 oygacha bo'lib to'lash mumkin, 2 000 000 so'mdan yuqori davolashda", children: '3 yoshdan qabul qilamiz' };
const PRICE_LIST = [{ name: 'Plomba', price: 350_000 }, { name: 'Tish olish', price: 150_000 }, { name: 'Professional tozalash', price: 250_000 }, { name: 'Implant', price: 4_500_000 }];
const ABOUT_PAGE = "# Biznes haqida\n\nTabassum Dental — oilaviy stomatologiya klinikasi.\n\n- Manzil: Toshkent, Chilonzor 7-mavze, 12-uy\n- Ish vaqti: dushanba–shanba 9:00–19:00, yakshanba dam\n- Telefon: +998 71 200 00 00\n";

// ─── Haqiqiy server bilan gaplashish ─────────────────────────────────────────

let token = '', voiceKey = '', bizId = '', adminToken = '';
async function panel<T = Json>(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<T> {
  const r = await fetch(panelUrl + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token ?? token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await r.json().catch(() => ({})) as Json;
  if (!r.ok) throw Object.assign(new Error(String(body.error ?? r.status)), { status: r.status, body });
  return body as T;
}

// ─── Tashqi dunyo holati ─────────────────────────────────────────────────────

interface Chat { id: number; kind: 'owner' | 'customer'; name: string; username: string; phone: string }
interface Incoming { id: number; chat: number; at: number; text: string; kind: 'text' | 'voice' | 'file' | 'contact'; replyTo?: number }
interface TgMessage { id: number; mine: boolean; at: number; text: string; html: boolean; kind: string; buttons: { text: string; data: string }[][]; askContact: boolean; edited: boolean; replyTo?: number; file?: string }
interface Line { mine: boolean; by: string; text: string; at: number }

const chats = new Map<number, Chat>();
const incoming: Incoming[] = [];
/** Bosilgan tugma → qaysi suhbatda (bot javobidagi ogohlantirish shu suhbatga ko'rsatiladi) */
const presses = new Map<string, number>();
let nextCustomer = 8001;
/** Egasining shaxsiy Telegramiga yozganlar */
const persons = new Map<string, { userId: string; name: string; username: string; lines: Line[] }>();
let personalSeen = 0, nextPerson = 61001, nextThread = 1;
const cameras: { id: string; name: string; present: boolean; state: string }[] = [];
const live = { summary: null as Json, mode: null as Json };
const wireLog: { n: number; at: number; service: string; summary: string; detail: unknown }[] = [];
let wireSeq = 0;
/** Model haqiqiymi (kalit .env'dan) yoki taqlid */
let realModel = false;
/** Stendni server bilan birga to'xtatadi (Windows'da jarayon o'ldirilsa, bola jarayon — server — qolib ketadi) */
let shutdown: () => void = () => process.exit(0);

/** Bot API usullari jurnalda oddiy tilda ko'rinadi */
const TG_ACTION: Record<string, string> = {
  sendMessage: 'xabar', sendDocument: 'fayl', sendPhoto: 'rasm', copyMessage: 'xabar nusxasi', editMessageText: 'xabar tahrirlandi', editMessageCaption: 'xabar tahrirlandi',
  answerCallbackQuery: 'tugma bosilishiga javob', getFile: 'fayl yuklab olindi', setMyCommands: "buyruqlar ro'yxati o'rnatildi", deleteWebhook: 'ulanish tekshirildi',
};
function logWire(service: string, summary: string, detail?: unknown): void {
  let line = summary;
  if (service === 'Telegram bot') {
    const p = (detail ?? {}) as Json, method = summary.split(' ')[0];
    const to = chats.get(Number(p.chat_id))?.name, text = String(p.text ?? p.caption ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    line = `${TG_ACTION[method] ?? method}${to ? ` → ${to}` : ''}${text ? `: ${text}` : ''}`;
  }
  wireLog.push({ n: ++wireSeq, at: Date.now(), service, summary: line, detail });
  if (wireLog.length > 600) wireLog.splice(0, 100);
}

const plainText = (m: { text: string; html: boolean }): string => (m.html ? m.text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : m.text);

/** Telegram suhbatlari: mijoz va egasi yozganlari (stend o'zi yuborgan) + bot yuborganlari va tahrirlari (soxta Bot API yozib borgan) */
function telegramView(): { chats: (Chat & { messages: TgMessage[]; typing: boolean })[]; toasts: { chat: number; text: string; alert: boolean; at: number }[] } {
  const all = new Map<number, TgMessage & { chat: number }>();
  for (const i of incoming) all.set(i.id, { id: i.id, chat: i.chat, mine: true, at: i.at, text: i.text, html: false, kind: i.kind, buttons: [], askContact: false, edited: false, replyTo: i.replyTo });
  // Har ogohlantirishning tartib raqami bor: sahifa qaysi birini ko'rsatganini shundan biladi (ro'yxat oxirgi 20 tasi bilan qaytadi)
  const toasts: { n: number; chat: number; text: string; alert: boolean; at: number }[] = [];
  const typing = new Map<number, number>();
  for (const s of sent) {
    const p = s.params, chat = Number(p.chat_id), markup = (p.reply_markup ?? {}) as Json;
    const buttons = ((markup.inline_keyboard ?? []) as Json[][]).map(row => row.map(b => ({ text: String(b.text), data: String(b.callback_data ?? '') })));
    switch (s.method) {
      case 'sendMessage': case 'sendPhoto': case 'sendDocument': case 'copyMessage': {
        const copied = s.method === 'copyMessage' ? all.get(Number(p.message_id)) : undefined;
        all.set(s.id!, {
          id: s.id!, chat, mine: false, at: s.at ?? 0, text: copied ? copied.text : String(p.text ?? p.caption ?? ''), html: p.parse_mode === 'HTML', kind: s.method, buttons,
          askContact: ((markup.keyboard ?? []) as Json[][]).some(row => row.some(b => b.request_contact)), edited: false, ...(s.file ? { file: s.fileName ?? 'fayl' } : {}),
        });
        break;
      }
      case 'editMessageText': case 'editMessageCaption': {
        const m = all.get(Number(p.message_id));
        if (m) Object.assign(m, { text: String(p.text ?? p.caption ?? ''), html: p.parse_mode === 'HTML', buttons, edited: true });
        break;
      }
      case 'answerCallbackQuery': {
        const to = presses.get(String(p.callback_query_id));
        if (to && p.text) toasts.push({ n: toasts.length + 1, chat: to, text: String(p.text), alert: !!p.show_alert, at: s.at ?? 0 });
        break;
      }
      case 'sendChatAction': typing.set(chat, s.at ?? 0); break;
      default: break;
    }
  }
  const byChat = new Map<number, TgMessage[]>();
  for (const { chat, ...m } of [...all.values()].sort((a, b) => a.id - b.id)) {
    const list = byChat.get(chat) ?? [];
    list.push(m);
    byChat.set(chat, list);
  }
  return {
    chats: [...chats.values()].map(c => {
      const messages = byChat.get(c.id) ?? [];
      // «Yozmoqda…»: bot oxirgi marta shu belgini yuborgandan beri javob kelmagan bo'lsa
      const last = messages.findLast(m => !m.mine)?.at ?? 0;
      return { ...c, messages, typing: (typing.get(c.id) ?? 0) > Math.max(last, Date.now() - 6000) };
    }),
    toasts: toasts.slice(-20),
  };
}

/** Soxta shaxsiy Telegram yuborilgan xabarlarni vaqtsiz yig'adi — shu yerda suhbatlarga taqsimlanadi */
function pumpPersonal(): void {
  for (const s of tgUser.sent.slice(personalSeen)) {
    // Kimga ketgani — soxta Telegram aniqlagan suhbatdosh (qo'lda qo'shilgan mijozga telefon bo'yicha yuborilsa, to.userId bo'sh bo'ladi)
    const id = String(s.userId ?? s.to.userId ?? '');
    const person = persons.get(id) ?? persons.set(id, { userId: id, name: String(s.to.name ?? s.to.username ?? s.to.phone ?? id), username: String(s.to.username ?? ''), lines: [] }).get(id)!;
    person.lines.push({ mine: false, by: 'Cerebro (egasining akkauntidan)', text: s.text, at: s.at ?? Date.now() });
  }
  personalSeen = tgUser.sent.length;
}

function instagramView(): { id: string; username: string; name: string; pending: boolean; lines: Line[] }[] {
  return [...igWeb.threads].map(([id, t]) => {
    const typed = new Set(igWeb.typed.filter(x => x.threadIds[0] === t.v2).map(x => x.text));
    return {
      id, username: t.user.username, name: t.user.full_name, pending: t.pending,
      lines: [...t.items].reverse().map(i => {
        const ours = i.user_id === IG_VIEWER.pk;
        return { mine: !ours, by: !ours ? 'mijoz' : typed.has(i.text ?? '') ? 'Cerebro (egasining akkauntidan)' : 'egasi (telefonidan)', text: i.text ?? '', at: Math.round(Number(i.timestamp) / 1000) };
      }),
    };
  });
}

/** CRM'ga kim yozgani id boshidan bilinadi: an/m/pn — tarmoq orqali (ya'ni Cerebro), st — stenddagi «administrator» */
const origin = (id: unknown): string => (/^(an|m|pn)\d/.test(String(id)) ? 'cerebro' : /^st/.test(String(id)) ? 'stend' : '');
function crmView(): Json {
  const today = iso(new Date());
  const row = (r: Json) => ({ ...r, origin: origin(r.id) });
  return {
    today,
    doctors: crm.doctors.map(d => ({ id: d.id, name: `${String(d.firstName)} ${String(d.lastName)}`, specialty: d.specialty })),
    appointments: crm.appointments.filter(a => String(a.date) >= today).sort((a, b) => `${String(a.date)} ${String(a.time)}`.localeCompare(`${String(b.date)} ${String(b.time)}`)).map(row),
    transactions: crm.transactions.filter(t => String(t.date).startsWith(today)).map(row),
    expenses: crm.expenses.map(row),
    patients: crm.patients.map(row),
  };
}

function state(): Json {
  pumpPersonal();
  return {
    panel: { url: panelUrl, ...account }, model: realModel ? 'haqiqiy' : 'taqlid', examples: EXAMPLES, minuteSec: MINUTE_SEC, bizId, mode: live.mode,
    telegram: telegramView(), owner: OWNER,
    personal: [...persons.values()], instagram: instagramView(), crm: crmView(),
    cameras: { list: cameras, summary: live.summary },
    wire: wireLog.slice(-150).map(({ detail, ...w }) => ({ ...w, more: detail !== undefined })),
  };
}

// ─── Tashqi dunyoni boshqarish yo'llari ──────────────────────────────────────

function newCustomer(name: string, phone: string): Chat {
  const id = nextCustomer++;
  const clean = name.trim().slice(0, 60) || `Mijoz ${id - 8000}`;
  const chat: Chat = { id, kind: 'customer', name: clean, username: clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || `mijoz${id}`, phone: phone.trim() || `+99890${String(1000000 + id).slice(-7)}` };
  chats.set(id, chat);
  tgNames.set(id, { first_name: chat.name, username: chat.username });
  // Mijoz biznes havolasini bosdi: bot uni shu biznesga bog'laydi
  record(id, say(id, `/start l-${bizId}`), `/start l-${bizId}`, 'text');
  return chat;
}
const record = (chat: number, id: number, text: string, kind: Incoming['kind'], replyTo?: number): void => { incoming.push({ id, chat, at: Date.now(), text, kind, ...(replyTo ? { replyTo } : {}) }); };

type Handler = (body: Json, req: IncomingMessage, url: URL) => Promise<Json> | Json;
const need = (cond: unknown, message: string): void => { if (!cond) throw Object.assign(new Error(message), { status: 400 }); };
/** Sahifadan kelgan matn: chegaralangan uzunlikda (juda uzun matn taqlid miyadagi qidiruvlarni soniyalab band qilardi) */
const typed = (value: unknown): string => String(value ?? '').trim().slice(0, MAX_TEXT);
/** So'rov tanasi, chegara bilan: oshsa — 413 */
async function readLimited(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error(`Juda katta (${Math.round(max / 1024 / 1024)} MB dan oshmasin)`), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const chatOf = (id: unknown): Chat => { const c = chats.get(Number(id)); need(c, 'Bunday suhbat yo\'q'); return c!; };

const routes: Record<string, Handler> = {
  'GET /api/state': () => state(),
  'GET /api/wire': (_b, _r, url) => ({ entry: wireLog.find(w => w.n === Number(url.searchParams.get('n'))) ?? null }),
  'POST /api/stop': () => { setTimeout(() => shutdown(), 100); return { ok: true }; },

  'POST /api/tg/customer': b => ({ chat: newCustomer(String(b.name ?? ''), String(b.phone ?? '')) }),
  'POST /api/tg/send': b => {
    const chat = chatOf(b.chat), text = typed(b.text);
    need(text, "Xabar bo'sh");
    record(chat.id, say(chat.id, text, b.replyTo ? Number(b.replyTo) : undefined), text, 'text', b.replyTo ? Number(b.replyTo) : undefined);
    return { ok: true };
  },
  'POST /api/tg/press': b => {
    const chat = chatOf(b.chat);
    const message = telegramView().chats.find(c => c.id === chat.id)?.messages.find(m => m.id === Number(b.id));
    need(message, 'Xabar topilmadi');
    presses.set(press(chat.id, String(b.data), message!.id, plainText(message!)), chat.id);
    return { ok: true };
  },
  'POST /api/tg/contact': b => {
    const chat = chatOf(b.chat);
    record(chat.id, shareContact(chat.id, chat.phone), `📞 ${chat.phone}`, 'contact');
    return { ok: true };
  },
  // Ovozli xabar: haqiqiy ovoz tanish (Gemini) kalit bilan ishlaydi — stendda «nima deyilgani» matn bilan beriladi
  'POST /api/tg/voice': b => {
    const chat = chatOf(b.chat), text = typed(b.text);
    need(text, 'Ovozli xabarda nima deyilganini yozing');
    stt.queue.push(text);
    record(chat.id, sendVoice(chat.id), `🎙 ${text}`, 'voice');
    return { ok: true };
  },
  'POST /api/tg/file': async (_b, req, url) => {
    const chat = chatOf(url.searchParams.get('chat')), name = String(url.searchParams.get('name') ?? 'fayl').slice(0, 120);
    const bytes = await readLimited(req, MAX_FILE_BYTES);
    need(bytes.length, "Fayl bo'sh");
    record(chat.id, sendDocument(chat.id, name, bytes), `📎 ${name}`, 'file');
    return { ok: true };
  },

  // Egasining shaxsiy Telegrami: unga notanish odam (mijoz) yozadi
  'POST /api/personal/send': b => {
    // Avval Cerebro yuborganlari joyiga qo'yiladi — suhbatda tartib buzilmasin
    pumpPersonal();
    const text = typed(b.text);
    need(text, "Xabar bo'sh");
    const id = String(b.userId ?? nextPerson++);
    const person = persons.get(id) ?? persons.set(id, { userId: id, name: String(b.name ?? '').trim() || `Mijoz ${id}`, username: String(b.username ?? '').replace(/^@/, '').trim(), lines: [] }).get(id)!;
    person.lines.push({ mine: true, by: 'mijoz', text, at: Date.now() });
    tgUser.incoming(TG_SESSION, id, text, { name: person.name, username: person.username || undefined });
    return { userId: id };
  },
  // Egasi telefonidan o'zi javob yozdi (Cerebro buni ko'rib, o'z taklifini bekor qilishi kerak)
  'POST /api/personal/owner': b => {
    pumpPersonal();
    const person = persons.get(String(b.userId)), text = typed(b.text);
    need(person && text, 'Suhbat yoki matn yo\'q');
    person!.lines.push({ mine: false, by: 'egasi (telefonidan)', text, at: Date.now() });
    tgUser.ownerTyped(TG_SESSION, person!.userId, text);
    return { ok: true };
  },

  'POST /api/instagram/send': b => {
    const text = typed(b.text);
    need(text, "Xabar bo'sh");
    const id = String(b.thread ?? `t${nextThread++}`);
    igWeb.incoming(id, text, { username: String(b.username ?? '').replace(/^@/, '').trim() || undefined, name: String(b.name ?? '').trim(), pending: !!b.pending });
    return { thread: id };
  },
  'POST /api/instagram/owner': b => {
    const text = typed(b.text);
    need(igWeb.threads.has(String(b.thread)) && text, 'Suhbat yoki matn yo\'q');
    igWeb.ownerTyped(String(b.thread), text);
    return { ok: true };
  },

  // Klinika administratori CRM'ning o'zida ishlaydi (Cerebro'siz): qabul qo'shadi, «keldi» qiladi, to'lov kiritadi
  'POST /api/crm/appointment': b => {
    const doctor = crm.doctors.find(d => d.id === b.doctorId);
    const name = typed(b.patientName).slice(0, 60);
    need(doctor && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) && /^\d{2}:\d{2}$/.test(String(b.time)) && name, "Bemor, shifokor, sana va vaqt kerak");
    // Bazada bor bemor — o'sha karta; yo'q bo'lsa yangi karta ochiladi (aks holda yordamchi uni keyin «topilmadi» der edi)
    const known = crm.patients.find(p => fold(`${String(p.firstName)} ${String(p.lastName)}`) === fold(name));
    const [firstName, ...family] = name.split(' ');
    const patient = known ?? { id: `st-p${Date.now()}`, firstName, lastName: family.join(' '), phone: '', secondaryPhone: null, lastVisit: null, balance: 0, clinicId: doctor!.clinicId };
    if (!known) crm.patients.push(patient);
    crm.appointments.push({
      id: `st-a${Date.now()}`, patientId: patient.id, patientName: name, doctorId: doctor!.id, doctorName: `${String(doctor!.firstName)} ${String(doctor!.lastName)}`,
      type: "Ko'rik", date: b.date, time: b.time, duration: 30, status: 'Confirmed', notes: null, clinicId: doctor!.clinicId, reminderSent: false,
    });
    return { ok: true };
  },
  'POST /api/crm/status': b => {
    const hit = crm.appointments.find(a => a.id === b.id);
    need(hit && ['Pending', 'Confirmed', 'Checked-In', 'Completed', 'No-Show', 'Cancelled'].includes(String(b.status)), "Qabul yoki holat noto'g'ri");
    hit!.status = b.status;
    return { ok: true };
  },
  'POST /api/crm/payment': b => {
    const doctor = crm.doctors.find(d => d.id === b.doctorId) ?? crm.doctors[0];
    need(Number(b.amount) > 0 && String(b.patientName ?? '').trim(), 'Bemor va summa kerak');
    crm.transactions.push({
      id: `st-t${Date.now()}`, patientName: String(b.patientName).trim(), date: iso(new Date()), amount: Number(b.amount), type: ['Cash', 'Card', 'Click', 'Transfer'].includes(String(b.type)) ? b.type : 'Cash',
      service: String(b.service ?? '').trim() || 'Plomba', status: 'Paid', clinicId: doctor.clinicId, doctorId: doctor.id, doctorName: `${String(doctor.firstName)} ${String(doctor.lastName)}`, discountAmount: 0,
    });
    return { ok: true };
  },

  // Kunlik xabarni hozir yuborish (odatda ertalab va kechqurun o'zi keladi): reja, dushanbadagi reja yoki kechki savol
  'POST /api/daily': async b => {
    const kind = b.kind === 'evening' ? 'evening' : 'morning';
    const r = await panel<{ sent: boolean }>(`/api/admin/businesses/${bizId}/daily`, { token: adminToken, body: { kind, weekly: b.weekly === true } });
    return { sent: r.sent };
  },
  'POST /api/camera': b => {
    const cam = cameras.find(c => c.id === b.id);
    need(cam, 'Kamera topilmadi');
    cam!.present = !!b.present;
    return { ok: true };
  },
  'POST /api/mode': async b => {
    await panel('/api/business/auto-reply', { method: 'PUT', body: { mode: b.mode, contacts: !!b.contacts, delayMin: Number(b.delayMin ?? 1) } });
    live.mode = (await panel('/api/inbox')).settings;
    return { ok: true };
  },

  // Ovozli agent (tashqi xizmat) Cerebro'dan nimani oladi va unga nimani yozadi — shu darvoza orqali
  'GET /api/voice/knowledge': () => panel('/api/voice/knowledge', { token: voiceKey }),
  'GET /api/voice/slots': () => panel('/api/voice/slots', { token: voiceKey }),
  'POST /api/voice/book': b => panel('/api/voice/book', { token: voiceKey, body: b }),
  'POST /api/voice/call': b => panel('/api/voice/calls', { token: voiceKey, body: b }),
};

/**
 * Stend sahifasining o'zidan kelgan so'rovmi. Brauzerda ochiq boshqa sayt stendga buyruq bera olmasin:
 *   Host — aynan shu manzil (DNS almashtirish hujumi o'tmaydi); Origin — bo'lsa, o'zimizniki;
 *   Sec-Fetch-Site — brauzer o'zi qo'yadi, sahifa soxtalashtira olmaydi (boshqa saytdagi rasm yoki ramka «cross-site» bo'lib keladi).
 */
const HOSTS = [`127.0.0.1:${WORLD_PORT}`, `localhost:${WORLD_PORT}`];
const ownHost = (req: IncomingMessage): boolean => HOSTS.includes(String(req.headers.host));
function fromConsole(req: IncomingMessage): boolean {
  const { origin } = req.headers, site = req.headers['sec-fetch-site'];
  return ownHost(req) && (!origin || HOSTS.some(h => origin === `http://${h}`)) && (!site || site === 'same-origin' || site === 'none');
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  const own = fromConsole(req);
  // Sahifaning o'zini havola orqali ochish mumkin (boshqa joydagi havola bosilsa ham) — lekin faqat alohida oynada, ramka ichida emas
  const opened = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' && ownHost(req);
  if (!own && !opened) return json(res, { error: "Ruxsat yo'q" }, 403);
  // Manzil tekshiruvdan keyin o'qiladi: buzuq manzil («//a:b») ham shunchaki «topilmadi»
  let url: URL;
  try { url = new URL(req.url ?? '/', worldUrl); } catch { return json(res, { error: 'Topilmadi' }, 404); }
  if (req.method === 'GET' && url.pathname === '/') {
    // Sahifadagi skript faqat shu javobdagi belgi bilan ishlaydi: xabar ichiga tushib qolgan begona skript bajarilmaydi
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.end(readFileSync(join(ROOT, 'scripts', 'stend.html'), 'utf8').replace('<script>', `<script nonce="${nonce}">`));
    return;
  }
  if (!own) return json(res, { error: "Ruxsat yo'q" }, 403);
  try {
    // Bot yuborgan fayl (masalan, yordamchi tayyorlagan .docx)
    if (req.method === 'GET' && url.pathname === '/api/tg/download') {
      const hit = sent.find(s => s.id === Number(url.searchParams.get('id')) && s.file);
      if (!hit) return json(res, { error: 'Fayl topilmadi' }, 404);
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(hit.fileName ?? 'fayl')}`);
      res.end(hit.file);
      return;
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return json(res, { error: 'Topilmadi' }, 404);
    const body = req.method === 'POST' && url.pathname !== '/api/tg/file' ? JSON.parse((await readLimited(req, MAX_JSON_BYTES)).toString() || '{}') as Json : {};
    json(res, await handler(body, req, url));
  } catch (e) {
    const err = e as Error & { status?: number; body?: Json };
    json(res, { error: err.message, ...(err.body ?? {}) }, err.status && err.status < 600 ? err.status : 500);
  }
}
/** Kutilmagan xato stendni to'xtatmaydi (ushlanmagan rad etish butun jarayonni — server bilan birga — yiqitardi) */
const world = createServer((req, res) => {
  void serve(req, res).catch(e => {
    console.error('[stend]', (e as Error).message);
    if (res.headersSent) res.destroy(); else json(res, { error: 'Ichki xato' }, 500);
  });
});

/** Soxta xizmatlar faqat serverning o'zidan so'rov oladi: brauzerdagi sahifa ularga yoza olmaydi, buzuq so'rov esa stendni yiqitmaydi */
function guard(server: ReturnType<typeof createServer>): void {
  const [handle] = server.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => unknown)[];
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(String(req.headers.host))) { res.statusCode = 403; res.end(); return; }
    void Promise.resolve().then(() => handle(req, res)).catch(() => { if (!res.headersSent) res.statusCode = 400; res.end(); });
  });
}

// ─── Ishga tushirish ─────────────────────────────────────────────────────────

const portBusy = (port: number): Promise<boolean> => new Promise(done => {
  const probe = connect(port, '127.0.0.1');
  probe.once('connect', () => { probe.destroy(); done(true); });
  probe.once('error', () => done(false));
});

async function until<T>(what: string, check: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms = 30_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    const v = await check();
    if (v) return v;
  }
  throw new Error(`kutildi, bo'lmadi: ${what}`);
}

/** Biznes, egasining Telegrami, shaxsiy Telegram, Instagram, DentaCRM, kameralar, ovozli agent kaliti va boshlang'ich bilim */
async function setUp(dataDir: string): Promise<string> {
  const admin = (await panel<{ token: string }>('/api/admin/login', { token: '', body: { password: ADMIN_PASSWORD } })).token;
  adminToken = admin;
  await panel('/api/admin/businesses', { token: admin, body: { name: 'Tabassum Dental', industry: 'Stomatologiya', ...account } });
  token = (await panel<{ token: string }>('/api/login', { token: '', body: account })).token;
  const me = await panel('/api/me');
  bizId = String(me.status.generalLink).split('start=l-')[1];
  await panel('/api/business', { method: 'PUT', body: { ...me.business, ownerName: 'Aziz', offeringsRev: me.offeringsRev } });

  // Egasi ulanishidan oldin — klinikaning «hayoti»: ertalabki reja birinchi kuniyoq bo'sh kelmasin
  await seedDay(dataDir);

  // Egasi paneldagi havolani bosib, botni o'ziga ulaydi
  chats.set(OWNER, { id: OWNER, kind: 'owner', name: 'Aziz (egasi)', username: 'aziz_owner', phone: OWNER_PHONE });
  tgNames.set(OWNER, { first_name: 'Aziz', username: 'aziz_owner' });
  const start = `/start o-${String(me.status.linkUrl).split('start=o-')[1]}`;
  record(OWNER, say(OWNER, start), start, 'text');
  await until('egasi ulandi', async () => (await panel('/api/me')).status.ownerLinked);

  await panel('/api/crm', { body: { url: `http://127.0.0.1:${(crmServer.address() as { port: number }).port}`, ...CRM_LOGIN } });
  await panel('/api/telegram-user/start', { body: { phone: OWNER_PHONE } });
  await panel('/api/telegram-user/code', { body: { code: '12345' } });
  igWeb.loggedIn = true;
  await panel('/api/instagram/login', { body: {} });
  await until('Instagram ulandi', async () => (await panel('/api/me')).status.instagram.account);
  await panel('/api/business/auto-reply', { method: 'PUT', body: { mode: 'draft', contacts: false, delayMin: 1 } });
  live.mode = (await panel('/api/inbox')).settings;

  for (const [name, kind, doctorId] of CAMERAS) {
    const { id } = (await panel<{ camera: { id: string } }>('/api/cameras', { body: { name } })).camera;
    await panel(`/api/cameras/${id}/zones`, { method: 'PUT', body: { zones: [{ ...ZONE, kind, name: kind === 'desk' ? 'Kassa stoli' : name, doctorId }] } });
    cameras.push({ id, name, present: false, state: 'empty' });
  }
  voiceKey = (await panel<{ key: string }>('/api/voice/key', { body: {} })).key;
  // Telefon liniyasi (tgvoice/sip_live.py) stendga ulanib, AI qabulxonani soxta DentaCRM bilan sinashi uchun: kalit faqat shu papkada
  writeFileSync(join(dataDir, 'ovozli-agent-kaliti.txt'), voiceKey, { mode: 0o600 });

  for (const [packId, answer] of Object.entries(KNOWN)) await panel('/api/brain/qa', { body: { packId, answer } });
  await panel('/api/brain/prices', { body: { items: PRICE_LIST } });
  const vault = join(dataDir, (await panel<{ brain: { vault: string } }>('/api/brain')).brain.vault);
  writeFileSync(join(vault, 'Bilim', 'Biznes haqida.md'), ABOUT_PAGE);
  return vault;
}

/**
 * Klinika kuni: botga yozgan mijozlar (Cerebro ularga yoza oladi) va qo'lda kiritilgan mijoz (faqat telefon), bugungi va kechikkan
 * keyingi qadamlar, bir necha kundan beri jim turganlar, qo'ng'iroq vazifasi; DentaCRM'da 6–12 oy oldin kelgan bemorlar.
 * Ertalabki rejada «bugungi qadamlar», «unutilganlar» va (dushanba tugmasi bilan) «qaytarish» bo'limlari to'la ko'rinadi
 */
async function seedDay(dataDir: string): Promise<void> {
  const now = new Date();
  const local = (d: Date, hhmm: string) => `${iso(d)}T${hhmm}`;
  const who: { name: string; phone: string; note: string; stage: 'new' | 'contacted'; idleDays?: number; nextStep?: string; nextAt?: string }[] = [
    { name: 'Dilnoza Karimova', phone: '+998901234567', note: "Implant narxini so'radi, «o'ylab ko'raman» dedi", stage: 'contacted', idleDays: 4 },
    { name: 'Malika Yusupova', phone: '+998935557711', note: "6 yoshli o'g'liga tish tozalash so'radi", stage: 'new', idleDays: 2 },
    { name: 'Jasur Aliyev', phone: '+998977001122', note: 'Breket qo\'ydirmoqchi', stage: 'contacted', nextStep: 'breket konsultatsiyasiga vaqt kelishish', nextAt: local(now, '11:00') },
  ];
  for (const w of who) newCustomer(w.name, w.phone);
  const leadsNow = await until('mijozlar botga yozdi', async () => {
    const list = (await panel<{ leads: { id: string; name: string | null }[] }>('/api/leads')).leads;
    return list.length >= who.length ? list : null;
  });
  const db = new DatabaseSync(join(dataDir, 'cerebro.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  for (const w of who) {
    const l = leadsNow.find(x => x.name === w.name);
    if (!l) continue;
    await panel(`/api/leads/${l.id}`, { method: 'PATCH', body: { note: w.note, stage: w.stage, ...(w.nextStep ? { nextStep: w.nextStep, nextAt: w.nextAt } : {}) } });
    if (w.idleDays) {
      const at = new Date(now.getTime() - w.idleDays * 86_400_000).toISOString();
      db.prepare('UPDATE leads SET updated_at = ?, created_at = ?, last_inbound_at = ? WHERE id = ?').run(at, at, at, l.id);
    }
  }
  // Qo'lda kiritilgan (telefon orqali kelgan) — Cerebro unga yoza olmaydi: tayyorgarlikda qo'ng'iroq matni chiqadi
  const manual = (await panel<{ lead: { id: string } }>('/api/leads', { body: { name: 'Sardor Toshmatov', phone: '+998935554433', note: "Ildiz davolash, narx so'ragan" } })).lead;
  await panel(`/api/leads/${manual.id}`, { method: 'PATCH', body: { stage: 'contacted', nextStep: 'davolash rejasi va narxini yuborish', nextAt: local(addDays(now, -1), '10:00') } });
  db.close();

  const soon = new Date(now.getTime() + 3600_000);
  await panel('/api/tasks', { body: { title: "Dilnoza Karimova bilan implant bo'yicha qo'ng'iroq", dueAt: local(soon, `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`) } });
  await panel('/api/tasks', { body: { title: 'Laboratoriyadan koronkalarni olish', dueAt: local(now, '16:00') } });

  // DentaCRM: oxirgi kelgani 7–10 oy oldin — «qaytarish» ro'yxati uchun
  const months = (n: number) => iso(addDays(now, -n * 30));
  crm.patients = [...crm.patients,
    ...[['r1', 'Nodira', 'Rahimova', '+998901110011', 7], ['r2', 'Bekzod', 'Usmonov', '+998935550022', 8], ['r3', 'Gulnora', 'Saidova', '+998977770033', 10]]
      .map(([id, firstName, lastName, phone, m]) => ({ id, firstName, lastName, phone, secondaryPhone: null, lastVisit: months(Number(m)), balance: 0, clinicId: 'c1' }))];
}

async function main(): Promise<void> {
  // Server .env va dist ni ishchi papkadan oladi — qayerdan ishga tushirilsa ham loyiha ildizida ishlaydi
  process.chdir(ROOT);
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error("Panel yig'ilmagan — avval: npm run build");
  for (const port of [PANEL_PORT, WORLD_PORT]) if (await portBusy(port)) throw new Error(`${port}-port band — oldingi stend ochiq qolgan bo'lishi mumkin (uni yoping yoki STEND_PORT bering)`);
  // Har ishga tushganda o'chiriladigan papka — faqat loyiha ichidagi shu nomli papka
  const dataDir = join(ROOT, PANEL_PORT === 3220 ? '.stend-data' : `.stend-data-${PANEL_PORT}`);
  try {
    // Papka ichidagi bilim Obsidian'da ochiq turgan bo'lishi mumkin — Windows faylni bir zum band qiladi
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    throw new Error(`${dataDir} ni tozalab bo'lmadi (${(e as Error).message}) — shu papkani ochib turgan Obsidian yoki oldingi stendni yoping`);
  }
  mkdirSync(dataDir, { recursive: true });

  const now = new Date();
  crm.seed(iso(now), iso(addDays(now, 1)));
  crm.seedHistory(days => iso(addDays(now, -days)));
  // Sinovlar uchun qo'shilgan ikki ming «to'ldiruvchi» va ataylab buzilgan bemorlar stendda kerak emas. Bugungi qabuli bor ikkitasi
  // qoladi va odam ismini oladi («Bemor1 Test1» o'rniga) — bazada ham, jadvalda ham bir xil: yordamchi ularni topa olsin
  const today = iso(now), renamed: Record<string, [string, string]> = { f1: ['Kamola', 'Tursunova'], f2: ['Jasur', 'Toshmatov'] };
  crm.patients = crm.patients.filter(p => !/^f\d+$/.test(String(p.id)) || renamed[String(p.id)]).map(p => (renamed[String(p.id)] ? { ...p, firstName: renamed[String(p.id)][0], lastName: renamed[String(p.id)][1] } : p));
  crm.oddPatients = [];
  crm.appointments = crm.appointments.map(a => (renamed[String(a.patientId)] ? { ...a, patientName: renamed[String(a.patientId)].join(' ') } : a));
  const payers = ['Ali Valiyev', 'Vali Valiyev', 'Kamola Tursunova', 'Sardor Aliyev', 'Dilnoza Karimova', "O'ktam Karimov"];
  crm.transactions = crm.transactions.map((t, i) => (t.date === today && t.patientName === 'Bemor' ? { ...t, patientName: payers[i % payers.length] } : t));

  // Kalit haqiqiy bo'lsa (.env yoki muhitda) — model haqiqiy; bo'lmasa taqlid miya soxta API ortida ishlaydi
  const fileEnv = existsSync(join(ROOT, '.env')) ? parseEnv(readFileSync(join(ROOT, '.env'), 'utf8')) : {};
  realModel = !!(process.env.ANTHROPIC_API_KEY || fileEnv.ANTHROPIC_API_KEY) && process.env.STEND_FAKE_AI !== '1';
  // Haqiqiy kalit — pul: panelga hammaga ma'lum parol bilan kirib bo'lmasin (brauzerdagi begona sahifa DNS almashtirib kirishi mumkin edi)
  if (realModel) account = { ...account, password: randomBytes(6).toString('hex') };
  for (const fake of [tgServer, sttServer, tgUserServer, igWebServer, crmServer, aiServer]) guard(fake);
  const [tgPort, sttPort, tgUserPort, igPort] = await Promise.all([tgServer, sttServer, tgUserServer, igWebServer].map(listen));
  await listen(crmServer);
  const aiPort = realModel ? 0 : await listen(aiServer);
  ai.owner = ownerTurn;
  ai.customer = customerTurn;
  wire.log = logWire;

  const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env, ...TIMING, PORT: String(PANEL_PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, DB_FILE: join(dataDir, 'cerebro.db'), ADMIN_PASSWORD, SESSION_SECRET: randomBytes(32).toString('hex'),
      BOT_TOKEN: '123:STEND', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, TG_PERSONAL: '1', IG_VIA_BROWSER: '1', TG_USER_FAKE_URL: `http://127.0.0.1:${tgUserPort}`, IG_FAKE_URL: `http://127.0.0.1:${igPort}`,
      // Ovoz xizmatining ikkala manzili ham soxtaga qaraydi: haqiqiy kalit .env'da bo'lsa ham tashqariga chiqmaydi
      VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', GEMINI_API_KEY: 'stend', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, GROQ_API_KEY: '', GROQ_STT_URL: `http://127.0.0.1:${sttPort}/groq`, CRM_ALLOW_PRIVATE: '1',
      // Ertalabki xulosa odatda 08:00 da keladi — stendda ishga tushgan soatda bir marta keladi
      MORNING_HOUR: String(now.getHours()),
      ...(realModel ? {} : { ANTHROPIC_API_KEY: 'stend-kalit', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, WEB_SEARCH: '0' }),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.on('exit', () => { server.kill(); });
  let started = false, stopping = false;
  const stop = (code: number): never => { stopping = true; server.kill(); process.exit(code); };
  shutdown = () => stop(0);
  server.stdout.on('data', d => { if (String(d).includes('Cerebro server')) started = true; });
  server.on('exit', code => { if (!stopping) { if (code) console.error(`Server to'xtab qoldi (kod ${code})`); stop(code ? 1 : 0); } });
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  for (let i = 0; i < 160 && !started; i++) await sleep(250);
  if (!started) { console.error('Server ishga tushmadi'); stop(1); }

  const vault = await setUp(dataDir);
  await new Promise<void>(done => world.listen(WORLD_PORT, '127.0.0.1', done));

  // Kameralar: stenddagi uchta kamera kadr o'rniga «odam bor / yo'q» yuboradi (haqiqiy veb-kamera — panelda, «Kameralar» bo'limida)
  const frames = setInterval(() => {
    for (const cam of cameras) {
      void panel(`/api/cameras/${cam.id}/observe`, { body: { people: cam.present ? PERSON : [] } })
        .then(r => { cam.state = String(Object.values(r.zones as Record<string, string>)[0] ?? 'empty'); })
        .catch(() => { /* server qayta ishga tushayotgan bo'lishi mumkin */ });
    }
  }, FRAME_MS);
  const refresh = setInterval(() => {
    void panel('/api/cameras/summary').then(r => { live.summary = r.summary; }).catch(() => {});
    void panel('/api/inbox').then(r => { live.mode = r.settings ?? live.mode; }).catch(() => {});
    // Soxta model har so'rovni saqlab boradi (sinovlar uchun) — uzoq ishlaganda xotira to'lib ketmasin
    ai.requests.length = 0;
    ai.replier.length = 0;
  }, 3000);
  frames.unref();
  refresh.unref();

  console.log(`\nStend tayyor.\n  Tashqi dunyo (siz boshqarasiz):  ${worldUrl}\n  Panel (egasining kabineti):      ${panelUrl}    login: ${account.login}    parol: ${account.password}\n`);
  console.log(realModel
    ? "Model: HAQIQIY Claude (.env'dagi kalit) — javob sifati haqiqiy, har so'rov pul turadi."
    : "Model: TAQLID MIYA (ANTHROPIC_API_KEY yo'q). Tizim qanday ishlashini ko'rsatadi; gapni qanchalik yaxshi tushunishini KO'RSATMAYDI.");
  console.log(`Miya papkasi (Obsidian'da «Open folder as vault»):\n  ${vault}\n`);
  console.log(`Vaqt: «Sizni kutadi» sozlamasidagi 1 daqiqa — ${MINUTE_SEC} soniya; kamera seansi 3 soniyada boshlanadi. Qolgani haqiqiy vaqtda.\nTo'xtatish: Ctrl+C\n`);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
