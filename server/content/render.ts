/**
 * Video renderi (HyperFrames: HTML → mp4) Palantir'ning o'zida: ovozli video → loyiha papkasi (index.html, shriftlar, GSAP,
 * ovoz, sahna rasmlari, musiqa) → kompyuterdagi Chrome/Edge kadrma-kadr suratga oladi → FFmpeg mp4 qiladi.
 *
 * Bir vaqtda bitta render (kompyuter band bo'lib qolmasin), qolganlari navbatda. Holat xotirada; tayyor mp4 ma'lumotlar
 * papkasida, yonida — qaysi kompozitsiyadan yasalgani (iz). Ssenariy, ovoz, brend-buk yoki rasmlar o'zgarsa iz mos kelmaydi —
 * video «eskirgan» deb ko'rsatiladi va qayta yasaladi. Chrome topilmasa — panel eski yo'l bilan (brauzerda) yig'adi.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ContentVideo, VideoRender } from '../../src/types';
import { installedBrowser } from '../browserPath';
import { assetPath } from '../entry';
import { env } from '../env';
import { brandStore } from './brand';
import { FPS, buildComposition, type Composition } from './composition';
import { GAP_S } from './speech';
import { ContentError } from './store';
import { videoAssets, videoAudioFile, videoDir, videoStore } from './video';

export type RenderState = VideoRender;

/** Bitta render uchun eng uzoq vaqt (sekin kompyuterda ham): undan keyin to'xtatiladi */
const MAX_RENDER_MS = 20 * 60_000;

/** Panel shriftlari (manbada public/, yig'ilgan nashrda dist/ ham) va GSAP (kutubxonadan) */
const font = (name: string): string => [assetPath('public', 'fonts', name), assetPath('dist', 'fonts', name)].find(p => existsSync(p)) ?? assetPath('public', 'fonts', name);
const gsapFile = (): string => createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js');

interface Job { bizId: string; id: string; phase: 'queued' | 'rendering' | 'failed'; progress: number; error: string | null; abort: AbortController }
const jobs = new Map<string, Job>();
let chain: Promise<void> = Promise.resolve();

const mp4File = (id: string) => join(videoDir(), `${id.replace(/[^A-Za-z0-9_-]/g, '')}.mp4`);
const traceFile = (id: string) => `${mp4File(id)}.json`;
const posterFile = (id: string) => `${mp4File(id)}.jpg`;
/** Muqova: ilgak o'qilib bo'lgan payt (matn to'liq ko'rinadi) */
const POSTER_AT = 1.6;

/** VIDEO_RENDER=off — server mp4 yasamaydi (sinovlar, juda kuchsiz kompyuter): panel videoni brauzerda yig'adi */
export const renderAvailable = (): boolean => env.videoRender && installedBrowser() !== null;

/** Video kompozitsiyasi va uning izi (ssenariy, ovoz, brend, rasmlar — hammasi shu HTML'da) */
function compose(bizId: string, v: ContentVideo): { comp: Composition; trace: string; voice: string; images: (string | null)[]; music: string | null } {
  const book = brandStore.book(bizId);
  if (!book) throw new ContentError('Brend-buk topilmadi — avval brend-buk yarating');
  const voice = videoAudioFile(v.id);
  if (v.status !== 'voiced' || !voice) throw new ContentError('Avval diktor ovozi kerak');
  const a = videoAssets(v.id, v.scenes.length);
  const name = (p: string | null, i: number) => (p ? `img/scene-${i}${p.slice(p.lastIndexOf('.'))}` : null);
  const comp = buildComposition({
    book, scenes: v.scenes, starts: v.starts, duration: v.duration, gap: GAP_S, words: a.words,
    files: { voice: `voice${voice.slice(voice.lastIndexOf('.'))}`, images: a.images.map(name), music: a.music ? `music${a.music.slice(a.music.lastIndexOf('.'))}` : null },
  });
  const trace = createHash('sha256').update(comp.html).update(String(statSync(voice).size))
    .update(a.images.map(p => (p ? String(statSync(p).size) : '-')).join(',')).update(a.music ? String(statSync(a.music).size) : '-').digest('hex').slice(0, 24);
  return { comp, trace, voice, images: a.images, music: a.music };
}

function storedTrace(id: string): string | null {
  try {
    return (JSON.parse(readFileSync(traceFile(id), 'utf8')) as { trace?: string }).trace ?? null;
  } catch {
    return null;
  }
}

/** Panel uchun holat: navbat/render — xotiradan, tayyor/eskirgan — fayl izidan */
export function renderState(bizId: string, v: ContentVideo): RenderState {
  const available = renderAvailable();
  const job = jobs.get(v.id);
  if (job && job.bizId === bizId) return { phase: job.phase, progress: job.progress, error: job.error, available };
  if (!existsSync(mp4File(v.id))) return { phase: 'none', progress: 0, error: null, available };
  let fresh = false;
  try {
    fresh = compose(bizId, v).trace === storedTrace(v.id);
  } catch { /* ovoz yoki brend yo'q — eskirgan */ }
  return { phase: fresh ? 'done' : 'stale', progress: 100, error: null, available };
}

/** Tayyor mp4 yoki uning muqovasi (faqat o'z biznesining videosi) */
export function videoMp4(bizId: string, id: string, poster = false): string | null {
  const file = poster ? posterFile(id) : mp4File(id);
  return videoStore.get(bizId, id) && existsSync(file) ? file : null;
}

/** Ssenariy yoki ovoz o'zgarganda / video o'chirilganda: eski mp4 va ishlayotgan render to'xtaydi */
export function dropRender(id: string): void {
  const job = jobs.get(id);
  if (job?.phase === 'rendering' || job?.phase === 'queued') job.abort.abort();
  jobs.delete(id);
  rmSync(mp4File(id), { force: true });
  rmSync(traceFile(id), { force: true });
  rmSync(posterFile(id), { force: true });
}

/** Renderni navbatga qo'yish (allaqachon navbatda yoki ishlayotgan bo'lsa — o'sha holat) */
export function startRender(bizId: string, id: string): RenderState {
  const v = videoStore.get(bizId, id);
  if (!v) throw new ContentError('Video topilmadi');
  if (!renderAvailable()) throw new ContentError("Bu kompyuterda Chrome yoki Edge topilmadi — video panelda (brauzerda) yig'iladi");
  compose(bizId, v); // ovoz va brend-buk borligini darrov tekshiradi
  const cur = jobs.get(id);
  if (cur && cur.phase !== 'failed') return renderState(bizId, v);
  const job: Job = { bizId, id, phase: 'queued', progress: 0, error: null, abort: new AbortController() };
  jobs.set(id, job);
  chain = chain.then(() => run(job)).catch(() => undefined);
  return renderState(bizId, v);
}

async function run(job: Job): Promise<void> {
  if (job.abort.signal.aborted || jobs.get(job.id) !== job) return;
  job.phase = 'rendering';
  const work = mkdtempSync(join(tmpdir(), 'palantir-video-'));
  try {
    const v = videoStore.get(job.bizId, job.id);
    if (!v) throw new ContentError("Video o'chirilgan");
    const c = compose(job.bizId, v);
    const proj = join(work, 'loyiha');
    mkdirSync(join(proj, 'fonts'), { recursive: true });
    mkdirSync(join(proj, 'img'), { recursive: true });
    const book = brandStore.book(job.bizId);
    copyFileSync(font(`${book?.font === 'Manrope' ? 'Manrope' : 'Unbounded'}.woff2`), join(proj, 'fonts', 'display.woff2'));
    copyFileSync(font('Manrope.woff2'), join(proj, 'fonts', 'text.woff2'));
    copyFileSync(gsapFile(), join(proj, 'gsap.min.js'));
    copyFileSync(c.voice, join(proj, `voice${c.voice.slice(c.voice.lastIndexOf('.'))}`));
    c.images.forEach((p, i) => { if (p) copyFileSync(p, join(proj, 'img', `scene-${i}${p.slice(p.lastIndexOf('.'))}`)); });
    if (c.music) copyFileSync(c.music, join(proj, `music${c.music.slice(c.music.lastIndexOf('.'))}`));
    writeFileSync(join(proj, 'index.html'), c.comp.html);

    pointFfmpeg();
    const { createRenderJob, executeRenderJob } = await import('@hyperframes/producer');
    const { resolveConfig } = await import('@hyperframes/engine');
    const out = join(work, 'video.mp4');
    const rj = createRenderJob({
      fps: FPS, quality: 'standard', maxRenderMs: MAX_RENDER_MS, logger: QUIET,
      producerConfig: resolveConfig({ chromePath: installedBrowser() ?? undefined, browserGpuMode: 'auto' }),
    } as Parameters<typeof createRenderJob>[0]);
    await executeRenderJob(rj, proj, out, j => { job.progress = Math.min(99, Math.round(j.progress)); }, job.abort.signal);
    if (job.abort.signal.aborted || jobs.get(job.id) !== job) return;
    // Render paytida ssenariy yoki brend o'zgarmaganmi: o'zgargan bo'lsa natija baribir saqlanadi, lekin «eskirgan» ko'rinadi
    mkdirSync(videoDir(), { recursive: true });
    copyFileSync(out, mp4File(job.id));
    writeFileSync(traceFile(job.id), JSON.stringify({ trace: c.trace, at: new Date().toISOString(), seconds: c.comp.total }));
    makePoster(mp4File(job.id), posterFile(job.id));
    jobs.delete(job.id);
  } catch (e) {
    if (job.abort.signal.aborted) return;
    const why = e instanceof ContentError ? e.message : `Video yig'ilmadi: ${(e as Error).message}`.slice(0, 300);
    if (!(e instanceof ContentError)) console.error('[kontent] render:', e);
    job.phase = 'failed';
    job.error = why;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** HyperFrames jurnali: har kadr bosqichi server jurnalini to'ldirmasin — faqat xatolar */
const QUIET = {
  error: (m: string) => console.error('[kontent] render:', m.slice(0, 300)),
  warn: () => undefined, info: () => undefined, debug: () => undefined,
};

/** Panel kartasidagi muqova (kichik jpg): bo'lmasa panel o'z chizgan muqovasini ko'rsatadi */
function makePoster(mp4: string, jpg: string): void {
  const bin = process.env.HYPERFRAMES_FFMPEG_PATH || env.ffmpeg;
  const r = spawnSync(bin, ['-v', 'error', '-y', '-ss', String(POSTER_AT), '-i', mp4, '-frames:v', '1', '-vf', 'scale=432:-2', '-q:v', '4', jpg], { windowsHide: true, timeout: 30_000 });
  if (r.status !== 0) console.error('[kontent] muqova yasalmadi:', r.error?.message ?? r.stderr?.toString().slice(0, 200));
}

/** Palantir o'z ffmpeg'ini ishlatsa (o'rnatgich runtime\ffmpeg) — HyperFrames ham shuni oladi; yonida ffprobe bo'lsa u ham */
function pointFfmpeg(): void {
  if (!/[\\/]/.test(env.ffmpeg) || !existsSync(env.ffmpeg)) return;
  process.env.HYPERFRAMES_FFMPEG_PATH = env.ffmpeg;
  const probe = join(dirname(env.ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (existsSync(probe)) process.env.HYPERFRAMES_FFPROBE_PATH = probe;
}
