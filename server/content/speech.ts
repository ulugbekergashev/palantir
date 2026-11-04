/**
 * Video diktori: sahna gaplari → bitta ovoz fayli va har sahna boshlanadigan soniya.
 *
 * Gemini TTS (asosiy): har sahna alohida aytiladi (3 tagacha parallel), boshidagi va oxiridagi jimlik kesiladi, sahnalar orasiga
 * qisqa nafas pauzasi qo'yilib bitta WAV yig'iladi — sahna vaqtlari aniq, taxmin emas. Kalit — GEMINI_API_KEY (ovozli xabarlar
 * uchun odatda bor), 30 soniyalik video ~0,7 sent.
 * ElevenLabs (zaxira): butun matn bir so'rovda, sahna boshlari harf vaqtlaridan. Gemini kaliti bo'lmasa yoki Gemini ovoz
 * bermasa ishlatiladi.
 */
import { env } from '../env';
import { ContentError } from './store';

export interface Voiced { audio: Buffer; mime: 'audio/wav' | 'audio/mpeg'; starts: number[]; duration: number }
/** lines — har sahnaning diktor gapi (o'qilish shaklida); narrator — Gemini ovozi (brend-bukdan) */
export type Voicer = (lines: string[], narrator: string) => Promise<Voiced>;

// ─── PCM (sof funksiyalar) ────────────────────────────────────────────────────

export const RATE = 24_000;
/** Sahnalar orasidagi nafas */
const GAP_S = 0.35;
/** Kesilgan jimlikdan qoldiriladigan zaxira: so'z boshi va oxiri yutilmasin */
const PAD_IN_S = 0.06;
const PAD_OUT_S = 0.12;
/** Shundan past amplituda — jimlik (16 bit, ~ -38 dBFS) */
const SILENCE = 400;

/** WAV (RIFF) bo'lsa — «data» bo'lagi, aks holda xom PCM o'zi (toq bayt tashlanadi) */
export function pcmOf(buf: Buffer): Buffer {
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') {
    for (let at = 12; at + 8 <= buf.length;) {
      const size = buf.readUInt32LE(at + 4);
      if (buf.toString('latin1', at, at + 4) === 'data') return buf.subarray(at + 8, Math.min(buf.length, at + 8 + size));
      at += 8 + size + (size % 2);
    }
    return Buffer.alloc(0);
  }
  return buf.subarray(0, buf.length - (buf.length % 2));
}

/** Boshidagi va oxiridagi jimlik kesiladi (ozgina zaxira bilan). Butunlay jim — bo'sh */
export function trimSilence(pcm: Buffer, rate = RATE): Buffer {
  const n = Math.floor(pcm.length / 2);
  let a = 0;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < SILENCE) a++;
  if (a >= n) return Buffer.alloc(0);
  let b = n - 1;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < SILENCE) b--;
  const from = Math.max(0, a - Math.round(PAD_IN_S * rate));
  const to = Math.min(n, b + 1 + Math.round(PAD_OUT_S * rate));
  return pcm.subarray(from * 2, to * 2);
}

/** Sahnalar ketma-ket, orasida pauza: boshlanish soniyalari va jami uzunlik */
export function joinClips(clips: Buffer[], rate = RATE, gap = GAP_S): { pcm: Buffer; starts: number[]; duration: number } {
  const silence = Buffer.alloc(Math.round(gap * rate) * 2);
  const parts: Buffer[] = [];
  const starts: number[] = [];
  let bytes = 0;
  clips.forEach((c, i) => {
    if (i) { parts.push(silence); bytes += silence.length; }
    starts.push(bytes / 2 / rate);
    parts.push(c);
    bytes += c.length;
  });
  return { pcm: Buffer.concat(parts), starts, duration: bytes / 2 / rate };
}

/** 16 bit mono PCM → WAV fayl (brauzer decodeAudioData o'qiydi) */
export function wavOf(pcm: Buffer, rate = RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

const GEMINI_TIMEOUT_MS = 60_000;
const PARALLEL = 3;
/** Asosiy model band (429/5xx) yoki javob bermasa — arzonroq va tezroq Flash-Lite */
const geminiModels = () => [...new Set([env.geminiTtsModel, 'gemini-3.8-flash-lite-tts'])];

class Retryable extends Error {}

async function geminiOnce(model: string, line: string, voice: string): Promise<Buffer> {
  const r = await fetch(`${env.geminiApiRoot}/v1beta/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model,
      input: [{ type: 'user_input', content: [{ type: 'text', text: line }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  }).catch((e: Error) => {
    throw new Retryable(e.name === 'TimeoutError' ? 'Gemini javob bermadi' : `Gemini'ga ulanib bo'lmadi: ${e.message}`);
  });
  const j = await r.json().catch(() => ({})) as { error?: { message?: string }; steps?: { content?: { type?: string; data?: string }[] }[] };
  if (!r.ok) {
    const why = j.error?.message?.slice(0, 160) ?? '';
    console.error('[kontent] Gemini TTS:', model, r.status, why);
    // 404 — model nomi eskirgan yoki noto'g'ri (GEMINI_TTS_MODEL): zaxira modelga o'tiladi
    if (r.status === 429 || r.status === 404 || r.status >= 500) {
      throw new Retryable(r.status === 429 ? 'Gemini limiti tugadi — birozdan keyin qayta urining' : r.status === 404 ? `Gemini ovoz modeli topilmadi (${model})` : `Gemini band (${r.status})`);
    }
    if (r.status === 401 || r.status === 403 || /api key/i.test(why)) throw new ContentError(`Gemini kalitni qabul qilmadi${why ? `: ${why}` : ''}`);
    throw new ContentError(`Gemini ovoz bermadi (${r.status}${why ? `: ${why}` : ''})`);
  }
  const data = (j.steps ?? []).flatMap(s => s.content ?? []).filter(c => c.type === 'audio' && c.data).map(c => c.data!).at(-1);
  if (!data) throw new Retryable("Gemini bo'sh javob qaytardi");
  return pcmOf(Buffer.from(data, 'base64'));
}

/** Bitta sahna: modellar navbat bilan; kutilgan xato (kalit, so'rov) darhol egasiga */
async function geminiLine(line: string, voice: string): Promise<Buffer> {
  let last: Error | null = null;
  for (const model of geminiModels()) {
    try {
      return await geminiOnce(model, line, voice);
    } catch (e) {
      if (!(e instanceof Retryable)) throw e;
      last = e;
    }
  }
  throw new ContentError(last?.message ?? 'Gemini ovoz bermadi');
}

/** Bir vaqtda limit tagacha; bittasi yiqilsa qolganlari yangisini boshlamaydi (pullik so'rovlar behuda ketmasin) */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0, failed = false;
  const worker = async () => {
    for (let i = next++; i < items.length && !failed; i = next++) {
      try { out[i] = await fn(items[i]); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const geminiVoicer: Voicer = async (lines, narrator) => {
  if (!env.geminiKey) throw new ContentError("Gemini kaliti yo'q: Sozlamalar → Kalitlar → «Gemini kaliti»");
  const clips = (await mapLimit(lines, PARALLEL, line => geminiLine(line, narrator))).map(c => trimSilence(c));
  if (clips.some(c => !c.length)) throw new ContentError("Gemini bir sahnani jim qaytardi — qayta urinib ko'ring");
  const { pcm, starts, duration } = joinClips(clips);
  return { audio: wavOf(pcm), mime: 'audio/wav', starts, duration };
};

// ─── ElevenLabs (zaxira) ─────────────────────────────────────────────────────

const SPEAK_TIMEOUT_MS = 120_000;
/** Harf vaqtlari kelmasa — mp3 uzunligi bit tezligidan (128 kbit/s) */
const MP3_BYTES_PER_SEC = 128_000 / 8;

export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export interface Speech { audio: Buffer; alignment: Alignment | null }
export type Speaker = (text: string) => Promise<Speech>;

/** Diktorga boradigan to'liq matn va har sahnaning shu matndagi boshlanish o'rni */
export function joinLines(lines: string[]): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  for (const l of lines) {
    if (text) text += ' ';
    offsets.push(text.length);
    text += l;
  }
  return { text, offsets };
}

/** Har sahna boshlanadigan soniya va ovoz uzunligi. Harf vaqtlari bo'lmasa — matn uzunligiga mutanosib */
export function sceneTimes(offsets: number[], textLength: number, alignment: Alignment | null, fallbackDuration: number): { starts: number[]; duration: number } {
  const ends = alignment?.character_end_times_seconds ?? [];
  const begins = alignment?.character_start_times_seconds ?? [];
  if (alignment && begins.length && begins.length === ends.length) {
    const duration = Math.max(...ends);
    return { starts: offsets.map(o => begins[Math.min(o, begins.length - 1)] ?? 0), duration };
  }
  const len = Math.max(1, textLength);
  return { starts: offsets.map(o => (o / len) * fallbackDuration), duration: fallbackDuration };
}

/** ElevenLabs: matn → mp3 va harf vaqtlari (/with-timestamps) */
export async function speakEleven(text: string): Promise<Speech> {
  if (!env.elevenKey) throw new ContentError("ElevenLabs kaliti yo'q: Sozlamalar → Kalitlar → «ElevenLabs kaliti»");
  const url = `${env.elevenUrl}/v1/text-to-speech/${encodeURIComponent(env.elevenVoice)}/with-timestamps?output_format=mp3_44100_128`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': env.elevenKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: env.elevenModel }),
    signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
  }).catch((e: Error) => {
    throw new ContentError(e.name === 'TimeoutError' ? 'ElevenLabs javob bermadi — keyinroq qayta urining' : `ElevenLabs'ga ulanib bo'lmadi: ${e.message}`);
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { detail?: { message?: string; status?: string } | string };
    const why = typeof j.detail === 'object' ? j.detail?.message ?? j.detail?.status : j.detail;
    console.error('[kontent] ElevenLabs:', r.status, why);
    if (r.status === 401) throw new ContentError(`ElevenLabs kalitni qabul qilmadi: ${why ?? 'ruxsat yo\'q'}`);
    if (r.status === 402 || /quota|credits/i.test(String(why))) throw new ContentError("ElevenLabs hisobida kredit tugadi — elevenlabs.io'da to'ldiring");
    throw new ContentError(`ElevenLabs ovoz bermadi (${r.status}${why ? `: ${why}` : ''})`);
  }
  const j = await r.json() as { audio_base64?: string; alignment?: Alignment | null };
  if (!j.audio_base64) throw new ContentError('ElevenLabs bo\'sh javob qaytardi');
  return { audio: Buffer.from(j.audio_base64, 'base64'), alignment: j.alignment ?? null };
}

/** ElevenLabs bitta so'rovda butun matnni o'qiydi; sahna boshlari harf vaqtlaridan (diktor — sozlamadagi ovoz) */
export const elevenVoicer = (speak: Speaker = speakEleven): Voicer => async lines => {
  const { text, offsets } = joinLines(lines);
  const s = await speak(text);
  return { audio: s.audio, mime: 'audio/mpeg', ...sceneTimes(offsets, text.length, s.alignment, s.audio.length / MP3_BYTES_PER_SEC) };
};

// ─── Tanlov ──────────────────────────────────────────────────────────────────

export type VoiceProvider = 'gemini' | 'elevenlabs';
/** Panelda ko'rsatiladi: qaysi xizmat ovoz beradi (kalit yo'q — null) */
export const voiceProvider = (): VoiceProvider | null => (env.geminiKey ? 'gemini' : env.elevenKey ? 'elevenlabs' : null);

/** Gemini → (ovoz bermasa va kaliti bo'lsa) ElevenLabs */
export const liveVoicer: Voicer = async (lines, narrator) => {
  if (env.geminiKey) {
    try {
      return await geminiVoicer(lines, narrator);
    } catch (e) {
      if (!env.elevenKey) throw e;
      console.warn('[kontent] Gemini ovoz bermadi, ElevenLabs bilan:', (e as Error).message);
    }
  }
  if (env.elevenKey) return elevenVoicer()(lines, narrator);
  throw new ContentError("Ovoz uchun kalit yo'q: Sozlamalar → Kalitlar → «Gemini kaliti»");
};
