/**
 * Ovozli xabar → matn. Telegram ovozi OGG/Opus bo'lib keladi.
 *
 * Zanjir (DentaCRM'da sinalgan): avval Gemini — o'zbekchani, ism va raqamlarni
 * Whisper'dan ancha to'g'ri yozadi; u ishlamasa — Groq Whisper.
 * Lug'at (biznes nomi, xizmatlar, xodim va mijoz ismlari) ikkalasiga ham
 * beriladi: aynan shu so'zlar eng ko'p buziladi.
 */
import type { Lang } from '../src/types';
import { env } from './env';

const TIMEOUT_MS = 30_000;
const GEMINI_MODEL = process.env.GEMINI_STT_MODEL || 'gemini-3.5-flash';
const GROQ_MODEL = process.env.STT_MODEL || 'whisper-large-v3';

export class SilenceError extends Error {}

const extFor = (mime: string) => (mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : 'mp3');

async function post(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

async function gemini(audio: Buffer, mime: string, lang: Lang, vocab: string[]): Promise<string> {
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
      model: GEMINI_MODEL,
      input: [{ type: 'text', text: instr }, { type: 'audio', data: audio.toString('base64'), mime_type: mime }],
      // O'ylash transkripsiyada faqat kechikish qo'shadi
      generation_config: { thinking_level: 'minimal' },
    }),
  }) as { output_text?: string; outputText?: string; steps?: { content?: { type?: string; text?: string }[] }[] };
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

/** Ovozni matnga aylantiradi. Jimlik — SilenceError; xizmat ishlamasa — oddiy Error */
export async function transcribe(audio: Buffer, mime: string, lang: Lang, vocab: string[] = []): Promise<string> {
  const chain = [
    ...(env.geminiKey ? [{ name: 'gemini', fn: gemini }] : []),
    ...(env.groqKey ? [{ name: 'groq', fn: groq }] : []),
  ];
  if (!chain.length) throw new Error("Ovoz xizmati sozlanmagan (GEMINI_API_KEY yoki GROQ_API_KEY)");
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
