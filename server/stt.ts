/**
 * Ovozli xabar → matn. Telegram ovozi OGG/Opus bo'lib keladi.
 *
 * Zanjir: VoiceLab (Aisha, o'zbek nutqiga ixtisoslashgan, voicelab.uz) → Gemini (o'zbekchani, ism va raqamlarni
 * Whisper'dan ancha to'g'ri yozadi) → Groq Whisper. Qaysi kaliti bor bo'lsa — o'shalar, shu tartibda.
 * Lug'at (biznes nomi, xizmatlar, xodim va mijoz ismlari) ikkalasiga ham
 * beriladi: aynan shu so'zlar eng ko'p buziladi.
 */
import { randomUUID } from 'node:crypto';
import type { Lang } from '../src/types';
import { env } from './env';

const TIMEOUT_MS = 30_000;
/**
 * Gemini modellari navbati: bepul tarifda model tez-tez «band» (503), «limit tugadi» (429) deydi yoki javob bermaydi —
 * shunda keyingisiga o'tiladi. Har model o'zi qabul qiladigan o'ylash darajasi bilan. GEMINI_STT_MODEL — ro'yxat boshiga
 */
const GEMINI_MODELS: { model: string; thinking: string }[] = [
  ...(process.env.GEMINI_STT_MODEL ? [{ model: process.env.GEMINI_STT_MODEL, thinking: process.env.GEMINI_STT_THINKING || 'minimal' }] : []),
  { model: 'gemini-3-flash-preview', thinking: 'minimal' },
  { model: 'gemini-3.1-flash-lite', thinking: 'minimal' },
  { model: 'gemini-3.8-flash', thinking: 'low' },
];
/** Bitta Gemini urinishi: javob bermasa navbatdagisiga o'tish uchun qisqaroq */
const GEMINI_TIMEOUT_MS = 20_000;
const GROQ_MODEL = process.env.STT_MODEL || 'whisper-large-v3';

export class SilenceError extends Error {}

const extFor = (mime: string) => (mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm'
  : /mp4|m4a/.test(mime) ? 'm4a' : mime.includes('aac') ? 'aac' : mime.includes('flac') ? 'flac' : 'mp3');

async function post(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
    return await res.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('javob bermadi');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** VoiceLab natijani darhol bermaydi (navbatga qo'yadi): shuncha kutiladi, har shuncha vaqtda so'raladi */
const VOICELAB_WAIT_MS = 45_000, VOICELAB_POLL_MS = 1_000;
interface VoiceLabJob { id?: string; status?: string; transcript?: string; error?: { message?: string }; segments?: { start_ms: number; text: string; speaker?: string }[] }

async function voicelab(audio: Buffer, mime: string, lang: Lang): Promise<string> {
  return String((await voicelabJob(audio, mime, lang, false, VOICELAB_WAIT_MS)).transcript ?? '').trim();
}

/** VoiceLab topshirig'i: speakers — gapiruvchilarni ajratish (qo'ng'iroq yozuvi uchun), waitMs — uzun yozuvlar ko'proq kutadi */
async function voicelabJob(audio: Buffer, mime: string, lang: Lang, speakers: boolean, waitMs: number): Promise<VoiceLabJob> {
  const auth = { Authorization: `Bearer ${env.voicelabKey}` };
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: mime }), `voice.${extFor(mime)}`);
  form.append('language', lang === 'ru' ? 'ru' : 'uz');
  form.append('include_speakers', speakers ? 'true' : 'false');
  // Bir xil kalit bilan qayta yuborilsa — ikkinchi marta hisoblanmaydi va pul olinmaydi
  let job = await post(`${env.voicelabUrl}/v1/stt`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: form }) as VoiceLabJob;
  const id = job.id;
  try {
    for (const end = Date.now() + waitMs; job.status !== 'completed'; ) {
      if (job.status === 'failed') throw new Error(job.error?.message || 'tanib bo\'lmadi');
      if (!id || Date.now() > end) throw new Error('javob bermadi');
      await new Promise(r => setTimeout(r, VOICELAB_POLL_MS));
      job = await get(`${env.voicelabUrl}/v1/stt/transcriptions/${encodeURIComponent(id)}`, auth) as VoiceLabJob;
    }
    return job;
  } finally {
    // Egasining ovozi va matni VoiceLab tarixida qolmasin
    if (id) void fetch(`${env.voicelabUrl}/v1/stt/transcriptions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
  }
}

async function get(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res.json();
}

async function gemini(audio: Buffer, mime: string, lang: Lang, vocab: string[]): Promise<string> {
  let last: Error | null = null;
  for (const m of GEMINI_MODELS) {
    try {
      return await geminiModel(m, audio, mime, lang, vocab);
    } catch (e) {
      last = e as Error;
      console.warn(`[ovoz] gemini ${m.model}:`, last.message.slice(0, 120));
    }
  }
  throw last ?? new Error('Gemini javob bermadi');
}

async function geminiModel(m: { model: string; thinking: string }, audio: Buffer, mime: string, lang: Lang, vocab: string[]): Promise<string> {
  const instr = [
    "Bu ovozli xabarni SO'ZMA-SO'Z matnga aylantir. Til — o'zbekcha (lotin yozuvida) yoki ruscha; qaysi tilda aytilgan bo'lsa, shu tilda yoz.",
    lang === 'ru' ? 'Odatda ruscha gapiriladi.' : "Odatda o'zbekcha gapiriladi.",
    "Faqat matnning o'zini qaytar: izoh, tarjima, qo'shtirnoq qo'shma. Hech narsa eshitilmasa — bo'sh javob qaytar.",
    'Bu biznes egasining yordamchisiga bergan topshirig\'i: vazifa, eslatma, mijoz, hujjat, narx, sana va vaqt uchraydi.',
    vocab.length ? `Quyidagi nom va ismlar aynan shu shaklda yozilsin: ${vocab.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const data = await post(env.geminiSttUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model: m.model,
      input: [{ type: 'text', text: instr }, { type: 'audio', data: audio.toString('base64'), mime_type: mime }],
      // O'ylash transkripsiyada faqat kechikish qo'shadi
      generation_config: { thinking_level: m.thinking },
    }),
  }, GEMINI_TIMEOUT_MS) as { output_text?: string; outputText?: string; steps?: { content?: { type?: string; text?: string }[] }[] };
  // Javob shakli bir necha ko'rinishda keladi — hammasi tekshiriladi
  const fromSteps = (data.steps ?? []).flatMap(s => s.content ?? []).filter(c => c.type === 'text' && c.text).map(c => c.text).join(' ');
  return String(data.output_text || data.outputText || fromSteps || '').trim();
}

async function groq(audio: Buffer, mime: string, lang: Lang, vocab: string[]): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voice.${extFor(mime)}`);
  form.append('model', GROQ_MODEL);
  // Tilni aytmasa, Whisper o'zbekchani turkcha deb o'ylaydi
  form.append('language', lang);
  // Whisper prompt'i ~224 token: lug'at qisqa bo'lsin
  const hint = (lang === 'ru' ? 'Задача, клиент, напоминание, документ. ' : "Vazifa, mijoz, eslatma, hujjat, so'm. ") + vocab.join(', ');
  form.append('prompt', hint.slice(0, 600));
  const data = await post(env.groqSttUrl, { method: 'POST', headers: { Authorization: `Bearer ${env.groqKey}` }, body: form }) as { text?: string };
  return String(data.text ?? '').trim();
}

/** Uzun yozuv (qo'ng'iroq) uchun kutish: bir necha daqiqalik suhbat navbatda ko'proq turadi */
const DIALOG_WAIT_MS = 4 * 60_000;
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * Qo'ng'iroq yozuvi → «kim nima dedi» matni: VoiceLab gapiruvchilarni ajratadi («1-ovoz», «2-ovoz» — kim ekanini tahlil o'zi aniqlaydi).
 * VoiceLab yo'q yoki ishlamasa — oddiy matn (gapiruvchilarsiz). Jimlik — SilenceError
 */
export async function transcribeDialog(audio: Buffer, mime: string, lang: Lang): Promise<{ text: string; speakers: boolean }> {
  if (env.voicelabKey) {
    try {
      const job = await voicelabJob(audio, mime, lang, true, DIALOG_WAIT_MS);
      const segs = (job.segments ?? []).filter(x => x.text?.trim());
      const labels = [...new Set(segs.map(x => x.speaker).filter((x): x is string => !!x))];
      const name = (sp?: string) => (sp ? `${labels.indexOf(sp) + 1}-ovoz` : '?');
      const text = segs.length && labels.length
        ? segs.map(x => `[${clock(x.start_ms)}] ${name(x.speaker)}: ${x.text.trim()}`).join('\n')
        : String(job.transcript ?? '').trim();
      if (!text) throw new SilenceError('Hech narsa eshitilmadi');
      return { text, speakers: labels.length > 1 };
    } catch (e) {
      if (e instanceof SilenceError) throw e;
      console.warn("[ovoz] qo'ng'iroq yozuvi (voicelab):", (e as Error).message);
    }
  }
  return { text: await transcribe(audio, mime, lang), speakers: false };
}

/** Ovozni matnga aylantiradi. Jimlik — SilenceError; xizmat ishlamasa — oddiy Error */
export async function transcribe(audio: Buffer, mime: string, lang: Lang, vocab: string[] = []): Promise<string> {
  const chain = [
    ...(env.voicelabKey ? [{ name: 'voicelab', fn: voicelab }] : []),
    ...(env.geminiKey ? [{ name: 'gemini', fn: gemini }] : []),
    ...(env.groqKey ? [{ name: 'groq', fn: groq }] : []),
  ];
  if (!chain.length) throw new Error("Ovoz xizmati sozlanmagan (VOICELAB_API_KEY, GEMINI_API_KEY yoki GROQ_API_KEY)");
  let last: Error | null = null;
  for (const p of chain) {
    try {
      const text = await p.fn(audio, mime, lang, vocab.slice(0, 200));
      // Jimlik — xizmat ishladi, ikkinchisiga o'tish shart emas
      if (!text) throw new SilenceError('Hech narsa eshitilmadi');
      return text;
    } catch (e) {
      if (e instanceof SilenceError) throw e;
      console.warn(`[ovoz] ${p.name} ishlamadi:`, (e as Error).message);
      last = e as Error;
    }
  }
  throw last ?? new Error("Ovozni tanib bo'lmadi");
}
