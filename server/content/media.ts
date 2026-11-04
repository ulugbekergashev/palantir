/**
 * Video qo'shimchalari Gemini'dan (Interactions API, egasining Gemini kaliti bilan): sahna rasmlari (Nano Banana 2.1), fon
 * musiqasi (Lyria 3 Clip, 30 s) va diktor so'zlarining aniq vaqtlari (Gemini 3.5 Transcribe, uz-UZ). Render oldidan faqat
 * yetishmaganlari tayyorlanadi — qayta render pul sarflamaydi. Biror qismi chiqmasa video baribir yig'iladi (brend foni,
 * musiqasiz, taxminiy vaqtlar bilan): sabab jurnalga yoziladi.
 *
 * Narx (2026-11): rasm 2K ~5 sent, musiqa 4 sent, transcribe ~0,5 sent/daqiqa — 30 soniyalik videoga ~30 sent.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandBook, ContentVideo } from '../../src/types';
import { env } from '../env';
import type { TimedWord } from './composition';

const API_REVISION = '2026-05-20';
const IMAGE_TIMEOUT_MS = 90_000;
const MUSIC_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 90_000;
/** Bir vaqtda nechta rasm so'raladi (Gemini limiti va kompyuter tarmog'i uchun) */
const IMAGE_PARALLEL = 3;

/** Rasm chiziladigan sahnalar: da'vo (rangli panel) va imzo (brend kartasi) — rasmsiz */
export const wantsImage = (kind: string): boolean => kind === 'hook' || kind === 'point';

class GeminiFail extends Error {}

/** Bitta Interactions so'rovi: xatoda tushunarli sabab; javobdan kerakli turdagi oxirgi blok */
async function interact(body: object, kind: 'image' | 'audio' | 'text', timeoutMs: number): Promise<{ data?: string; text?: string; annotations?: unknown[] }> {
  const r = await fetch(`${env.geminiApiRoot}/v1beta/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey, 'Api-Revision': API_REVISION },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: Error) => { throw new GeminiFail(e.name === 'TimeoutError' ? 'Gemini javob bermadi' : `Gemini'ga ulanib bo'lmadi: ${e.message}`); });
  const j = await r.json().catch(() => ({})) as { error?: { message?: string }; steps?: { content?: { type?: string; data?: string; text?: string; annotations?: unknown[] }[] }[] };
  if (!r.ok) throw new GeminiFail(`Gemini ${r.status}${j.error?.message ? `: ${j.error.message.slice(0, 160)}` : ''}`);
  const block = (j.steps ?? []).flatMap(s => s.content ?? []).filter(c => c.type === kind).at(-1);
  if (!block) throw new GeminiFail("Gemini bo'sh javob qaytardi");
  return block;
}

// ─── Sahna rasmi ──────────────────────────────────────────────────────────────

/** Rasm so'rovi: sahna tavsifi + brendning vizual qoidalari; matnsiz (o'zbekcha harflarni model to'g'ri chizmaydi — matnni video o'zi yozadi) */
export function imagePrompt(visual: string, book: BrandBook): string {
  const c = book.colors;
  const rules = [book.motif, ...(book.visualRules ?? [])].filter(Boolean).join('; ');
  const avoid = (book.dont ?? []).filter(Boolean).join('; ');
  return [
    `Vertical 9:16 background image for one scene of a short brand video: ${visual}`,
    rules && `Brand visual language: ${rules}.`,
    `Colour palette: ${c.bg} and ${c.deep} as the dominant tones, ${c.accent} as a small accent, ${c.surface} for highlights.`,
    'Cinematic editorial look, soft natural light, shallow depth of field, calm and uncluttered upper and middle area so large captions can sit on top.',
    'No text, letters, numbers, signs, logos or watermarks anywhere. No recognizable faces.',
    avoid && `Avoid: ${avoid}.`,
  ].filter(Boolean).join(' ');
}

export async function sceneImage(prompt: string): Promise<Buffer> {
  const models = [env.geminiImageModel, 'gemini-3.1-flash-lite-image'].filter((m, i, a) => a.indexOf(m) === i);
  let last: Error = new GeminiFail('rasm chiqmadi');
  for (const model of models) {
    try {
      const b = await interact({
        model,
        input: [{ type: 'user_input', content: [{ type: 'text', text: prompt }] }],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '9:16', image_size: '2K' },
        generation_config: { thinking_level: 'minimal' },
      }, 'image', IMAGE_TIMEOUT_MS);
      if (b.data) return Buffer.from(b.data, 'base64');
    } catch (e) {
      last = e as Error;
    }
  }
  throw last;
}

// ─── Fon musiqasi ─────────────────────────────────────────────────────────────

/** Musiqa so'rovi: ssenariydagi kayfiyat (bo'lmasa brend harakat uslubidan) — har doim cholg'u, diktorni bosmaydigan */
export function musicPrompt(mood: string | null | undefined, book: BrandBook): string {
  const base = mood?.trim() || `Background music for a short brand video. Mood: ${book.motion || 'calm, confident, modern'}${book.archetype?.name ? `; brand archetype: ${book.archetype.name}` : ''}.`;
  return `${base} Soft and steady, unobtrusive under a narrator, no sudden drops. Instrumental only, no vocals, no lyrics.`;
}

export async function musicClip(prompt: string): Promise<Buffer> {
  const b = await interact({ model: env.geminiMusicModel, input: [{ type: 'user_input', content: [{ type: 'text', text: prompt }] }] }, 'audio', MUSIC_TIMEOUT_MS);
  if (!b.data) throw new GeminiFail("musiqa bo'sh keldi");
  return Buffer.from(b.data, 'base64');
}

// ─── So'z vaqtlari ────────────────────────────────────────────────────────────

/** Transcribe javobidagi so'z: «0.800s» kabi vaqtlar soniyaga */
export interface HeardWord { text: string; start: number; end: number }
const secs = (s: unknown): number => Number.parseFloat(String(s ?? '').replace(/s$/, ''));

export function heardWords(annotations: unknown[]): HeardWord[] {
  return annotations.flatMap(a => {
    const x = a as { type?: string; text?: string; start_offset?: unknown; end_offset?: unknown };
    const start = secs(x.start_offset), end = secs(x.end_offset);
    return x.type === 'word_info' && x.text && Number.isFinite(start) && Number.isFinite(end) && end >= start ? [{ text: x.text, start, end }] : [];
  });
}

/**
 * Eshitilgan so'zlar → ssenariy so'zlarining vaqtlari. Har sahna o'z oynasida (sahnalar ovozda jimlik bilan ajralgan, boshlanishi
 * aniq): so'z soni teng bo'lsa — tartib bo'yicha; bo'lmasa (raqam «18:00», qo'shilib ketgan so'z) — harf ulushi bo'yicha eshitilgan
 * vaqt chizig'iga moslanadi. Sahnada hech narsa eshitilmasa — null (taxminiy vaqtlar ishlatiladi).
 */
export function alignWords(voices: string[], starts: number[], duration: number, heard: HeardWord[]): TimedWord[][] | null {
  const out: TimedWord[][] = [];
  for (let i = 0; i < voices.length; i++) {
    const from = starts[i] - 0.15, to = i + 1 < starts.length ? starts[i + 1] - 0.15 : duration + 0.5;
    const h = heard.filter(w => w.start >= from && w.start < to);
    const words = voices[i].split(/\s+/).filter(Boolean);
    if (!h.length || !words.length) return null;
    if (h.length === words.length) {
      out.push(words.map((text, k) => ({ text, start: h[k].start, end: h[k].end })));
      continue;
    }
    // Eshitilganlar harf ulushi → vaqt (bo'lakli chiziq); ssenariy so'zlari shu chiziqqa qo'yiladi
    const hLen = h.map(w => w.text.length + 1), hTotal = hLen.reduce((a, b) => a + b, 0);
    const knots: [number, number][] = [[0, h[0].start]];
    let acc = 0;
    h.forEach((w, k) => { acc += hLen[k]; knots.push([acc / hTotal, w.end]); });
    const at = (f: number): number => {
      for (let k = 1; k < knots.length; k++) {
        if (f <= knots[k][0]) {
          const [f0, t0] = knots[k - 1], [f1, t1] = knots[k];
          return t0 + ((t1 - t0) * (f - f0)) / Math.max(1e-6, f1 - f0);
        }
      }
      return knots[knots.length - 1][1];
    };
    const wLen = words.map(w => w.length + 1), wTotal = wLen.reduce((a, b) => a + b, 0);
    let pos = 0;
    out.push(words.map((text, k) => {
      const start = at(pos / wTotal);
      pos += wLen[k];
      return { text, start: Math.round(start * 1000) / 1000, end: Math.round(at(pos / wTotal) * 1000) / 1000 };
    }));
  }
  return out;
}

export async function transcribe(audio: Buffer, mime: string, lang: 'uz' | 'ru'): Promise<HeardWord[]> {
  const b = await interact({
    model: env.geminiTranscribeModel,
    input: [{ type: 'user_input', content: [{ type: 'audio', data: audio.toString('base64'), mime_type: mime }] }],
    generation_config: { transcription_config: { language_codes: [lang === 'ru' ? 'ru-RU' : 'uz-UZ'], mode: { type: 'verbatim', timestamp_granularities: ['word'] } } },
  }, 'text', TRANSCRIBE_TIMEOUT_MS);
  return heardWords(b.annotations ?? []);
}

// ─── Yetishmaganini tayyorlash ────────────────────────────────────────────────

export interface MediaDeps { image: (prompt: string) => Promise<Buffer>; music: (prompt: string) => Promise<Buffer>; transcribe: typeof transcribe }
export const LIVE_MEDIA: MediaDeps = { image: sceneImage, music: musicClip, transcribe };

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * Video uchun yetishmagan rasmlar, musiqa va so'z vaqtlari (Gemini kaliti bo'lsa). Hammasi parallel; har biri o'zicha —
 * birining xatosi boshqasini to'xtatmaydi. onStep — panelga qisqa holat
 */
export async function ensureMedia(
  v: ContentVideo, book: BrandBook, lang: 'uz' | 'ru', dir: string, voice: { file: string; mime: string },
  onStep: (step: string) => void, deps: MediaDeps = LIVE_MEDIA,
): Promise<void> {
  if (!env.geminiKey || !env.videoMedia) return;
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir);
  const has = (name: RegExp) => files.some(f => name.test(f));
  const jobs: Promise<void>[] = [];

  const missing = v.scenes.map((s, i) => ({ s, i })).filter(({ s, i }) => wantsImage(s.kind) && !has(new RegExp(`^scene-${i}\\.(jpe?g|png|webp)$`)));
  if (missing.length) {
    onStep('Sahna rasmlari chizilmoqda');
    jobs.push(mapLimit(missing, IMAGE_PARALLEL, async ({ s, i }) => {
      try {
        const visual = s.visual || `an evocative scene illustrating «${s.text}» — from a short video about: ${v.topic.split('\n')[0].slice(0, 200)}`;
        writeFileSync(join(dir, `scene-${i}.jpg`), await deps.image(imagePrompt(visual, book)));
      } catch (e) {
        console.error(`[kontent] sahna rasmi (${i + 1}):`, (e as Error).message);
      }
    }));
  }
  if (!has(/^music\.(mp3|wav|ogg|m4a)$/)) {
    jobs.push(deps.music(musicPrompt(v.music, book))
      .then(b => writeFileSync(join(dir, 'music.mp3'), b))
      .catch(e => console.error('[kontent] musiqa:', (e as Error).message)));
  }
  if (!existsSync(join(dir, 'words.json'))) {
    jobs.push(deps.transcribe(readFileSync(voice.file), voice.mime, lang)
      .then(heard => {
        const words = alignWords(v.scenes.map(s => s.voice), v.starts, v.duration, heard);
        if (words) writeFileSync(join(dir, 'words.json'), JSON.stringify(words));
      })
      .catch(e => console.error("[kontent] so'z vaqtlari:", (e as Error).message)));
  }
  await Promise.all(jobs);
}

