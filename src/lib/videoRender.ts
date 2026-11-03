/**
 * Kontent-meyker videosi brauzerda: brend-buk ranglari va shrifti bilan 1080×1920 kanvasda sahnalar chiziladi, diktor ovozi
 * (ElevenLabs mp3) ostiga qo'yiladi va MediaRecorder bilan mp4 (bo'lmasa webm) qilib yozib olinadi. Klinika kompyuteriga
 * hech narsa o'rnatilmaydi; yozish real vaqtda (video qancha bo'lsa — shuncha soniya), varaq ochiq turishi kerak.
 *
 * Uslub — «plitka»: sahna yozuvi fon ustiga plitka bo'lib tushadi (ozgina sakrab), fikrlar plitkalar bo'lib teriladi,
 * da'vo — katta harflar fon ustida, oxiri — monogramma plitkasi, nom va shior. Har plitka tushganda qisqa «chiq» tovushi.
 */
import type { BrandBook, ContentVideo, VideoScene } from '../types';

export const W = 1080;
export const H = 1920;
const FPS = 30;
const MARGIN = 96;
const GRID = 120;
const LAND = 0.45;
const EXIT = 0.35;
/** Oxirgi sahna (imzo) ovoz tugagach ham shuncha turadi */
const HOLD = 1.6;
const MAX_POINTS = 4;
/** Ilgak plitkasining markazi: Reels/Shorts pastki yozuvlari va tugmalari ostida qolmasin */
const HOOK_Y = 820;

export interface RenderSpec { book: BrandBook; scenes: VideoScene[]; starts: number[]; duration: number }

export const totalLength = (s: RenderSpec): number => Math.max(s.duration + HOLD, (s.starts.at(-1) ?? 0) + HOLD + 1);

// ─── Harakat ──────────────────────────────────────────────────────────────────

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const backOut = (x: number) => { const c = 1.25, k = c + 1; return 1 + k * (x - 1) ** 3 + c * (x - 1) ** 2; };
const easeIn = (x: number) => x * x * x;
const easeOut = (x: number) => 1 - (1 - x) ** 3;

/** Plitka tushishi: 0…1 → yuqoridan pastga, kattadan asl o'lchamga, shaffofdan ko'rinarga */
function landing(t: number): { y: number; scale: number; alpha: number } {
  const p = clamp(t / LAND);
  const b = backOut(p);
  return { y: (1 - b) * -60, scale: 1 + (1 - b) * 0.06, alpha: clamp(p * 3) };
}

// ─── Chizish yordamchilari ────────────────────────────────────────────────────

const display = (b: BrandBook) => `"${b.font}", "Manrope", sans-serif`;
const TEXT_FONT = '"Manrope", sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** So'zlarni kenglikka sig'diradi; satrlar ko'payib ketsa — shrift kichrayadi (pastki chegara bilan) */
function fitText(ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, maxW: number, maxLines: number, size: number, min: number): { lines: string[]; size: number } {
  for (let s = size; s >= min; s -= 4) {
    ctx.font = `${weight} ${s}px ${family}`;
    const lines: string[] = [];
    let cur = '';
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines || s - 4 < min) return { lines, size: s };
  }
  return { lines: [text], size: min };
}

function tile(ctx: CanvasRenderingContext2D, b: BrandBook, x: number, y: number, w: number, h: number, t: number, opts: { mark?: boolean; dim?: boolean } = {}) {
  const l = landing(t);
  ctx.save();
  ctx.globalAlpha = l.alpha * (opts.dim ? 0.55 : 1);
  ctx.translate(x + w / 2, y + h / 2 + l.y);
  ctx.scale(l.scale, l.scale);
  ctx.translate(-w / 2, -h / 2);
  // Qalinlik — plitka tagidagi to'q chiziq (soya o'rniga)
  ctx.fillStyle = b.colors.deep;
  roundRect(ctx, 0, 10, w, h, 18);
  ctx.fill();
  ctx.fillStyle = b.colors.surface;
  roundRect(ctx, 0, 0, w, h, 18);
  ctx.fill();
  if (opts.mark) {
    ctx.fillStyle = b.colors.accent;
    ctx.fillRect(w - 58, 24, 34, 34);
  }
  ctx.restore();
  return l;
}

/** Fon va chok to'ri har kadrda bir xil: bir marta chiziladi, keyin rasm bo'lib qo'yiladi */
let groundCache: { key: string; canvas: HTMLCanvasElement } | null = null;
function ground(ctx: CanvasRenderingContext2D, b: BrandBook) {
  const key = `${b.colors.bg}${b.colors.deep}`;
  if (groundCache?.key !== key) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (g) paintGround(g, b);
    groundCache = { key, canvas: c };
  }
  ctx.drawImage(groundCache.canvas, 0, 0);
}

function paintGround(ctx: CanvasRenderingContext2D, b: BrandBook) {
  ctx.fillStyle = b.colors.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = b.colors.deep;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = GRID / 2; x < W; x += GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = GRID / 2; y < H; y += GRID) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function centeredLines(ctx: CanvasRenderingContext2D, lines: string[], size: number, cx: number, top: number, lh = 1.12) {
  lines.forEach((ln, i) => ctx.fillText(ln, cx, top + i * size * lh));
}

// ─── Sahnalar ─────────────────────────────────────────────────────────────────

function drawHook(ctx: CanvasRenderingContext2D, b: BrandBook, s: VideoScene, t: number) {
  const w = W - MARGIN * 2;
  const fit = fitText(ctx, s.text, display(b), 800, w - 96, 4, 92, 56);
  const h = Math.max(320, fit.lines.length * fit.size * 1.12 + 140);
  const y = HOOK_Y - h / 2;
  const l = tile(ctx, b, MARGIN, y, w, h, t, { mark: true });
  ctx.save();
  ctx.globalAlpha = l.alpha;
  ctx.fillStyle = b.colors.ink;
  ctx.font = `800 ${fit.size}px ${display(b)}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  fit.lines.forEach((ln, i) => ctx.fillText(ln, MARGIN + 48, y + l.y + 70 + i * fit.size * 1.12));
  ctx.restore();
}

function drawPoints(ctx: CanvasRenderingContext2D, b: BrandBook, points: { s: VideoScene; t: number }[], fall: number) {
  const w = W - MARGIN * 2, h = 210, gap = 36;
  const shown = points.slice(-MAX_POINTS);
  const top = (H - (shown.length * h + (shown.length - 1) * gap)) / 2 - 80;
  shown.forEach((p, i) => {
    const y = top + i * (h + gap) + easeIn(fall) * (1400 + i * 120);
    const current = i === shown.length - 1;
    const l = tile(ctx, b, MARGIN, y, w, h, p.t, { mark: current, dim: !current });
    ctx.save();
    ctx.globalAlpha = l.alpha * (current ? 1 : 0.6);
    ctx.fillStyle = b.colors.ink;
    const fit = fitText(ctx, p.s.text, display(b), 700, w - 150, 2, 60, 40);
    ctx.font = `700 ${fit.size}px ${display(b)}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const mid = y + l.y + h / 2, lh = fit.size * 1.12;
    fit.lines.forEach((ln, k) => ctx.fillText(ln, MARGIN + 48, mid + (k - (fit.lines.length - 1) / 2) * lh));
    ctx.restore();
  });
}

function drawClaim(ctx: CanvasRenderingContext2D, b: BrandBook, s: VideoScene, t: number, out: number) {
  const fit = fitText(ctx, s.text, display(b), 800, W - MARGIN * 2, 4, 120, 64);
  const lastLine = fit.lines.length - 1;
  ctx.save();
  ctx.globalAlpha = 1 - easeIn(out);
  ctx.font = `800 ${fit.size}px ${display(b)}`;
  ctx.textBaseline = 'top';
  const lh = fit.size * 1.1;
  const top = H / 2 - (fit.lines.length * lh) / 2 - 60;
  let wi = 0;
  fit.lines.forEach((ln, li) => {
    const lineW = ctx.measureText(ln).width;
    let x = W / 2 - lineW / 2;
    for (const w of ln.split(' ')) {
      const p = easeOut(clamp((t - wi * 0.12) / 0.25));
      ctx.globalAlpha = p * (1 - easeIn(out));
      ctx.fillStyle = li === lastLine ? b.colors.accent : b.colors.surface;
      ctx.fillText(w, x, top + li * lh + (1 - p) * 30);
      x += ctx.measureText(`${w} `).width;
      wi++;
    }
  });
  ctx.restore();
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'ʻ’-]/gu, '').split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

function drawSign(ctx: CanvasRenderingContext2D, b: BrandBook, s: VideoScene, t: number) {
  const size = 280, x = (W - size) / 2, y = 470;
  const l = tile(ctx, b, x, y, size, size, t, { mark: true });
  ctx.save();
  ctx.globalAlpha = l.alpha;
  ctx.fillStyle = b.colors.ink;
  ctx.font = `800 128px ${display(b)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(b.name), W / 2, y + l.y + size / 2 + 6);
  ctx.textBaseline = 'top';
  const name = fitText(ctx, s.text || b.name, display(b), 800, W - MARGIN * 2, 2, 104, 64);
  ctx.globalAlpha = easeOut(clamp((t - 0.3) / 0.4));
  ctx.fillStyle = b.colors.surface;
  ctx.font = `800 ${name.size}px ${display(b)}`;
  centeredLines(ctx, name.lines, name.size, W / 2, 850);
  const tagTop = 850 + name.lines.length * name.size * 1.12 + 40;
  const tag = fitText(ctx, b.tagline, TEXT_FONT, 700, W - MARGIN * 2, 2, 52, 36);
  ctx.globalAlpha = easeOut(clamp((t - 0.9) / 0.4));
  ctx.fillStyle = b.colors.surface;
  ctx.font = `700 ${tag.size}px ${TEXT_FONT}`;
  centeredLines(ctx, tag.lines, tag.size, W / 2, tagTop, 1.2);
  ctx.restore();
}

/** Bitta kadr: t — videoning boshidan soniya */
export function drawFrame(ctx: CanvasRenderingContext2D, spec: RenderSpec, t: number): void {
  const { book: b, scenes, starts } = spec;
  ground(ctx, b);
  const at = (i: number) => (starts[i] ?? 0) - 0.08;
  let cur = 0;
  for (let i = 0; i < scenes.length; i++) if (t >= at(i)) cur = i;
  const s = scenes[cur];
  // Birinchi kadr — muqova: ilgak plitkasi boshidanoq to'liq ko'rinadi (lentada shu kadr ko'rinadi)
  const local = cur === 0 && s.kind === 'hook' ? Math.max(t - at(cur), LAND) : t - at(cur);
  const prev = cur > 0 ? scenes[cur - 1] : null;
  const exiting = prev && local < EXIT ? local / EXIT : null;

  // Ketma-ket fikrlar bir joyda teriladi; boshqa turdagi sahna kelganda plitkalar pastga tushib ketadi
  if (s.kind === 'point') {
    if (prev && prev.kind !== 'point' && exiting !== null) drawOut(ctx, b, prev, cur - 1, t, exiting, spec);
    drawPoints(ctx, b, pointRun(spec, cur, t), 0);
    return;
  }
  if (prev && exiting !== null) drawOut(ctx, b, prev, cur - 1, t, exiting, spec);
  // Yangi sahna eskisi ketib bo'lgach tushadi: ikki yozuv bir-birining ustida qolmasin
  const after = prev ? local - EXIT * 0.8 : local;
  if (s.kind === 'hook') drawHook(ctx, b, s, after);
  else if (s.kind === 'claim') drawClaim(ctx, b, s, after, 0);
  else drawSign(ctx, b, s, after);
}

/** i-sahnagacha uzluksiz ketgan fikrlar (har biri o'z tushish vaqti bilan) */
function pointRun(spec: RenderSpec, i: number, t: number): { s: VideoScene; t: number }[] {
  const run: { s: VideoScene; t: number }[] = [];
  for (let k = i; k >= 0 && spec.scenes[k].kind === 'point'; k--) run.unshift({ s: spec.scenes[k], t: t - ((spec.starts[k] ?? 0) - 0.08) });
  return run;
}

/** Oldingi sahna ketishi (yangisining birinchi EXIT soniyasida) */
function drawOut(ctx: CanvasRenderingContext2D, b: BrandBook, s: VideoScene, i: number, t: number, p: number, spec: RenderSpec) {
  const local = t - ((spec.starts[i] ?? 0) - 0.08);
  if (s.kind === 'point') drawPoints(ctx, b, pointRun(spec, i, t), p); else if (s.kind === 'claim') drawClaim(ctx, b, s, local, p);
  else {
    ctx.save();
    ctx.translate(0, easeIn(p) * 1500);
    if (s.kind === 'hook') drawHook(ctx, b, s, local);
    else drawSign(ctx, b, s, local);
    ctx.restore();
  }
}

/** Plitka tushadigan paytlar (tovush uchun): ilgak, har fikr va imzo */
export const tapTimes = (spec: RenderSpec): number[] =>
  spec.scenes.flatMap((s, i) => (s.kind === 'claim' ? [] : [Math.max(0, (spec.starts[i] ?? 0) - 0.08 + LAND * 0.55)]));

// ─── Ovoz va yozish ───────────────────────────────────────────────────────────

let fontsReady: Promise<void> | null = null;
/** Panel bilan keladigan shriftlar (public/fonts) — kanvasga kerak */
export function loadFonts(): Promise<void> {
  fontsReady ??= Promise.all([
    new FontFace('Unbounded', 'url(/fonts/Unbounded.woff2)', { weight: '200 900' }).load(),
    new FontFace('Manrope', 'url(/fonts/Manrope.woff2)', { weight: '200 800' }).load(),
  ]).then(faces => { for (const f of faces) document.fonts.add(f); }).catch(e => { fontsReady = null; throw e; });
  return fontsReady;
}

/** Plitka tovushi: qisqa, past «chiq» (WebAudio — fayl kerak emas) */
function tap(ac: AudioContext, out: AudioNode, at: number) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, at);
  o.frequency.exponentialRampToValueAtTime(180, at + 0.09);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.22, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + 0.14);
}

const MIME = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
export const recordMime = (): string | null => MIME.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? null;

export interface Playback { done: Promise<Blob | null>; stop: () => void }

/**
 * Ijro: record=false — karnayga (ko'rib chiqish); record=true — karnaysiz, kanvas va ovoz yozib olinadi (natija — fayl).
 * onTime — har kadrda (jarayon chizig'i uchun)
 */
export function play(canvas: HTMLCanvasElement, spec: RenderSpec, mp3: ArrayBuffer, record: boolean, onTime?: (t: number, total: number) => void): Playback {
  let stopped = false;
  const stop = () => { stopped = true; };
  const done = (async () => {
    await loadFonts();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Kanvas ochilmadi');
    const ac = new AudioContext();
    try {
      // Brauzer ovozni to'xtatib qo'ygan bo'lsa (avtoijro qoidasi) — soat yurmaydi, kadrlar joyida qotadi
      if (ac.state === 'suspended') await ac.resume();
      const voice = await ac.decodeAudioData(mp3.slice(0));
      drawFrame(ctx, spec, 0);
      const dest = record ? ac.createMediaStreamDestination() : null;
      const out: AudioNode = dest ?? ac.destination;
      const total = totalLength({ ...spec, duration: spec.duration || voice.duration });
      let recorder: MediaRecorder | null = null;
      // Kadr o'zi olinmaydi (captureStream(0)): har chizilgan kadr requestFrame bilan beriladi — brauzer kanvasni kam yangilasa ham video silliq
      let push: (() => void) | null = null;
      const chunks: Blob[] = [];
      if (record && dest) {
        const mime = recordMime();
        if (!mime) throw new Error("Bu brauzer videoni yozib ololmaydi — Chrome yoki Edge'da oching");
        const track = canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        push = () => track.requestFrame();
        const stream = new MediaStream([track, ...dest.stream.getAudioTracks()]);
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.start(250);
      }
      const t0 = ac.currentTime + 0.15;
      const src = ac.createBufferSource();
      src.buffer = voice;
      src.connect(out);
      src.start(t0 + 0.3);
      for (const at of tapTimes(spec)) tap(ac, out, t0 + 0.3 + at);
      await new Promise<void>(resolve => {
        const frame = () => {
          const began = performance.now();
          const t = ac.currentTime - t0 - 0.3;
          drawFrame(ctx, spec, Math.max(0, t));
          push?.();
          onTime?.(clamp(t, 0, total), total);
          if (stopped || t >= total) { resolve(); return; }
          // Taymer (requestAnimationFrame emas): ekran yangilanishiga bog'liq emas, sekundiga FPS kadr
          setTimeout(frame, Math.max(0, 1000 / FPS - (performance.now() - began)));
        };
        frame();
      });
      src.stop();
      if (!recorder) return null;
      const rec = recorder;
      return await new Promise<Blob | null>(resolve => {
        rec.onstop = () => resolve(stopped ? null : new Blob(chunks, { type: rec.mimeType }));
        rec.stop();
      });
    } finally {
      await ac.close().catch(() => undefined);
    }
  })();
  return { done, stop };
}

/** Ovozi hali yo'q video (faqat ssenariy) — har sahnaga 3 soniyadan: muqova va ko'rinish chizilishi uchun */
const SCENE_GUESS = 3;
export const specOf = (book: BrandBook, v: ContentVideo): RenderSpec => (v.starts.length === v.scenes.length
  ? { book, scenes: v.scenes, starts: v.starts, duration: v.duration }
  : { book, scenes: v.scenes, starts: v.scenes.map((_, i) => i * SCENE_GUESS), duration: v.scenes.length * SCENE_GUESS });
