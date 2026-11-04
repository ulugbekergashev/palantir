/**
 * Video kompozitsiyasi (HyperFrames: HTML → mp4). Ssenariy, diktor vaqtlari va brend-buk → bitta index.html: brend foni,
 * sahna rasmlari (bo'lsa), kinetik matn, sahnalar orasidagi o'tish, so'zma-so'z subtitr, jarayon chizig'i, ovoz va musiqa.
 * Sof funksiya: fayl yozmaydi, tarmoqqa chiqmaydi (render.ts loyiha papkasini yig'adi va render qiladi).
 *
 * Vaqt: kompozitsiya 0 da boshlanadi, diktor LEAD soniyadan; sahna ovozida boshlanishidan PRE soniya oldin ko'rinadi;
 * oxirgi sahna ovoz tugagach HOLD soniya turadi. Hamma matn HTML'ga xavfsiz (esc) qo'yiladi, ma'lumot — JSON'da (</ ochilmaydi).
 */
import type { BrandBook, BrandColors, VideoScene } from '../../src/types';
import { LARGE_AA, contrast } from '../../src/lib/color';
import { RUNTIME_JS } from './compositionRuntime';

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** Diktor boshlanishidan oldingi muqova */
export const LEAD = 0.3;
/** Oxirgi sahna (imzo) ovoz tugagach turadigan vaqt */
export const HOLD = 2;
/** Sahna ovozida boshlanishidan shuncha oldin chiqadi (ko'z quloqdan biroz oldin) */
const PRE = 0.15;
/** Subtitr guruhi: ko'pi bilan shuncha so'z va belgi */
const CAP_WORDS = 4;
const CAP_CHARS = 24;
const MUSIC_VOLUME = 0.14;

export interface TimedWord { text: string; start: number; end: number }

export interface CompositionInput {
  book: BrandBook;
  scenes: VideoScene[];
  /** Har sahna ovozda boshlanadigan soniya (ovoz faylining boshidan) */
  starts: number[];
  /** Ovoz uzunligi */
  duration: number;
  /** Sahnalar orasidagi jimlik (speech.ts GAP_S) — sahna ovozining tugashini hisoblash uchun */
  gap: number;
  /** Loyiha papkasidagi fayllar */
  files: { voice: string; music?: string | null; images?: (string | null)[] };
  /** Aniq so'z vaqtlari (sahnama-sahna, ovoz boshidan) — bo'lmasa harf soniga qarab taqsimlanadi */
  words?: TimedWord[][] | null;
}

export interface Composition { html: string; total: number }

const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK: BrandColors = { bg: '#14232b', deep: '#0b151a', surface: '#f2ede4', ink: '#14232b', accent: '#f08a3c', muted: '#8aa0a8' };

export const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Brend ranglari (noto'g'risi o'rniga zaxira rang) */
export function palette(c: Partial<BrandColors> | undefined): BrandColors {
  const out = { ...FALLBACK };
  for (const k of Object.keys(FALLBACK) as (keyof BrandColors)[]) if (c?.[k] && HEX.test(c[k])) out[k] = c[k];
  return out;
}

/** Fon rangida eng yaxshi o'qiladigan rang (nomzodlardan) */
export function bestOn(bg: string, candidates: string[]): string {
  return candidates.reduce((best, x) => (contrast(x, bg) > contrast(best, bg) ? x : best), candidates[0]);
}

/**
 * So'z vaqtlari: sahna ovozi [start, end] oralig'ida so'zlarga harf soniga qarab bo'linadi; tinish belgisidan keyin pauza
 * bor deb hisoblanadi (vergul — kichik, nuqta — kattaroq)
 */
export function wordTimes(text: string, start: number, end: number): TimedWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || end <= start) return [];
  const weight = words.map(w => w.length + 1.5 + (/[.!?…]$/.test(w) ? 4 : /[,;:—–-]$/.test(w) ? 2 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  let t = start;
  return words.map((w, i) => {
    const len = ((end - start) * weight[i]) / total;
    const out = { text: w, start: r3(t), end: r3(t + len) };
    t += len;
    return out;
  });
}

/** Subtitr guruhlari: gap tugashida, pauzada yoki chegarada bo'linadi */
export function captionGroups(words: TimedWord[]): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of words) {
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= CAP_WORDS || chars > CAP_CHARS || w.start - cur[cur.length - 1].end > 0.15)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?…,;:]$/.test(w.text)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** Imzodagi chaqiriq: brend-bukdagi eng qisqasi (uzuni tugmaga sig'maydi — unda qo'yilmaydi) */
const CTA_MAX = 64;
export const shortCta = (book: Pick<BrandBook, 'ctas'>): string | null =>
  [...(book.ctas ?? [])].filter(c => c && c.length <= CTA_MAX).sort((a, b) => a.length - b.length)[0] ?? null;

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'ʻ’-]/gu, '').split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** So'zlar: har biri niqobli quti ichida (pastdan chiqishi uchun); highlight — oxirgi so'z urg'u fonida */
function wordSpans(text: string, highlightLast = false): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.map((w, i) => (highlightLast && i === words.length - 1 && words.length > 1
    ? `<span class="w hl"><span class="hl-bar"></span><span class="wi">${esc(w)}</span></span>`
    : `<span class="w"><span class="wi">${esc(w)}</span></span>`)).join(' ');
}

interface SceneWindow { start: number; end: number }

function sceneHtml(s: VideoScene, i: number, win: SceneWindow, book: BrandBook, pointNo: number, points: number): string {
  const timing = `id="sc${i}" class="clip scene ${s.kind}" data-start="${r3(win.start)}" data-duration="${r3(win.end - win.start)}"`;
  if (s.kind === 'hook') {
    return `<section ${timing}><div class="in"><div class="stage"><h1 class="fit" data-max="108" data-min="56" data-lines="4" data-lh="1.08">${wordSpans(s.text, true)}</h1></div></div></section>`;
  }
  if (s.kind === 'point') {
    const dots = Array.from({ length: points }, (_, k) => `<i${k === pointNo - 1 ? ' class="on"' : ''}></i>`).join('');
    return `<section ${timing}><div class="in"><div class="stage"><div class="num">${String(pointNo).padStart(2, '0')}</div><div class="card"><div class="card-mark"></div><p class="fit" data-max="80" data-min="44" data-lines="4" data-lh="1.12">${wordSpans(s.text)}</p>${points > 1 ? `<div class="dots">${dots}</div>` : ''}</div></div></div></section>`;
  }
  if (s.kind === 'claim') {
    return `<section ${timing}><div class="in"><div class="panel"></div><div class="stage"><h2 class="fit" data-max="124" data-min="60" data-lines="5" data-lh="1.06">${wordSpans(s.text)}</h2><div class="rule"></div></div></div></section>`;
  }
  const name = s.text || book.name;
  // Har so'z harflari bitta bo'linmas qutida: qator faqat so'zlar orasida bo'linadi
  const chars = name.split(/\s+/).filter(Boolean).map(w => `<span class="nw">${[...w].map(ch => `<span class="ch">${esc(ch)}</span>`).join('')}</span>`).join(' ');
  const cta = shortCta(book) ? `<div class="cta">${esc(shortCta(book)!)}</div>` : '';
  return `<section ${timing}><div class="in"><div class="stage"><div class="mono"><svg viewBox="0 0 300 300"><circle class="ring" cx="150" cy="150" r="140"/></svg><span class="mono-text">${esc(initials(book.name))}</span></div><div class="name fit" data-max="104" data-min="56" data-lines="2" data-lh="1.08">${chars}</div>${book.tagline ? `<div class="tag fit" data-max="46" data-min="32" data-lines="3" data-lh="1.25">${esc(book.tagline)}</div>` : ''}${cta}</div></div></section>`;
}

function css(c: BrandColors, onAccent: string, accentOnSurface: string): string {
  // CSS blur, mix-blend-mode va to'liq kadrli shovqin qatlami ishlatilmaydi: Chrome kadrni dasturiy chizganda ular renderni
  // bir necha baravar sekinlashtiradi (36 s video: 13,7 daqiqa → 3 daqiqa)
  return `
@font-face { font-family: "PDisplay"; src: url("fonts/display.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "PText"; src: url("fonts/text.woff2") format("woff2"); font-weight: 200 800; font-display: block; }
html, body { margin: 0; background: ${c.deep}; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${c.bg}; color: ${c.surface}; font-family: "PText", sans-serif; }
#bg, #bg > div, .shot, .shot-in, .scrim, #sweep { position: absolute; inset: 0; }
#bg { background: linear-gradient(165deg, ${c.bg} 0%, ${c.bg} 45%, ${c.deep} 100%); overflow: hidden; }
#bg .glow { inset: auto; width: 1500px; height: 1500px; border-radius: 50%; }
#g1 { left: -560px; top: -380px; background: radial-gradient(circle, ${c.accent}59 0%, ${c.accent}00 62%); }
#g2 { left: 180px; top: 900px; background: radial-gradient(circle, ${c.surface}2e 0%, ${c.surface}00 60%); }
#bg #grid { inset: -240px; background-image: linear-gradient(${c.deep}66 2px, transparent 2px), linear-gradient(90deg, ${c.deep}66 2px, transparent 2px); background-size: 120px 120px; }
#vignette { background: radial-gradient(ellipse at 50% 42%, ${c.deep}00 38%, ${c.deep}d9 100%); }
.shot { overflow: hidden; }
.shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.scrim { background: linear-gradient(180deg, ${c.deep}cc 0%, ${c.deep}33 30%, ${c.deep}40 55%, ${c.deep}f2 100%), linear-gradient(0deg, ${c.bg}55, ${c.bg}55); }
.scene, .scene .in { position: absolute; inset: 0; }
.stage { position: absolute; left: 96px; right: 96px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.w { display: inline-block; overflow: hidden; vertical-align: top; padding: 0.06em 0.02em 0.1em; margin: -0.06em -0.02em -0.1em; position: relative; }
.wi { display: inline-block; position: relative; }
.fit { margin: 0; width: 100%; overflow-wrap: normal; word-break: keep-all; }
.hook .stage { top: 380px; bottom: 700px; }
.hook h1 { font-family: "PDisplay", sans-serif; font-weight: 800; line-height: 1.08; letter-spacing: -0.02em; color: ${c.surface}; }
.hl-bar { position: absolute; left: 0; right: 0; top: 0.08em; bottom: 0.06em; background: ${c.accent}; border-radius: 0.12em; transform-origin: 0 50%; }
.point .stage { top: 330px; bottom: 680px; justify-content: flex-start; }
.num { font-family: "PDisplay", sans-serif; font-weight: 800; font-size: 230px; line-height: 1; color: transparent; -webkit-text-stroke: 4px ${c.accent}; margin-bottom: 28px; }
.card { position: relative; background: ${c.surface}; color: ${c.ink}; border-radius: 40px; border-bottom: 16px solid ${c.deep}; padding: 64px 64px 56px; }
.card p { font-family: "PDisplay", sans-serif; font-weight: 700; line-height: 1.12; letter-spacing: -0.01em; }
.card-mark { position: absolute; right: 34px; top: 34px; width: 38px; height: 38px; background: ${c.accent}; border-radius: 8px; }
.dots { display: flex; gap: 14px; margin-top: 40px; }
.dots i { display: block; width: 18px; height: 18px; border-radius: 50%; background: ${c.ink}33; }
.dots i.on { width: 52px; border-radius: 9px; background: ${c.accent}; }
.claim .panel { position: absolute; inset: 0; background: ${c.surface}; }
.claim .stage { top: 300px; bottom: 640px; align-items: center; text-align: center; }
.claim h2 { font-family: "PDisplay", sans-serif; font-weight: 800; line-height: 1.06; letter-spacing: -0.02em; color: ${c.ink}; }
.claim .w:nth-last-child(-n+2) .wi { color: ${accentOnSurface}; }
.rule { width: 260px; height: 14px; border-radius: 7px; background: ${c.accent}; margin-top: 48px; transform-origin: 50% 50%; }
.sign .stage { top: 240px; bottom: 640px; align-items: center; text-align: center; justify-content: center; }
.mono { position: relative; width: 300px; height: 300px; margin-bottom: 56px; }
.mono svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ring { fill: ${c.deep}66; stroke: ${c.accent}; stroke-width: 10; stroke-dasharray: 880; stroke-linecap: round; }
.mono-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: "PDisplay", sans-serif; font-weight: 800; font-size: 120px; color: ${c.surface}; }
.name { font-family: "PDisplay", sans-serif; font-weight: 800; line-height: 1.08; color: ${c.surface}; }
.nw { white-space: nowrap; }
.ch { display: inline-block; }
.tag { font-weight: 600; line-height: 1.25; color: ${c.surface}; opacity: 0.88; margin-top: 30px; max-width: 860px; }
.cta { margin-top: 56px; display: inline-block; padding: 22px 44px; border-radius: 999px; background: ${c.accent}; color: ${onAccent}; font-weight: 800; font-size: 40px; }
#sweep { overflow: hidden; pointer-events: none; }
.band { position: absolute; left: -300px; width: 1680px; top: 2000px; height: 380px; background: ${c.accent}; }
#caps { position: absolute; left: 0; right: 0; top: 1290px; height: 260px; }
.cap { position: absolute; left: 70px; right: 70px; top: 0; text-align: center; opacity: 0; }
.cap .box { display: inline; font-weight: 800; font-size: 58px; line-height: 1.5; padding: 10px 24px; border-radius: 22px; background: ${c.deep}c7; color: ${c.surface}; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.cw { display: inline-block; color: ${c.surface}; }
#top { position: absolute; left: 0; right: 0; top: 0; height: 200px; }
#bar { position: absolute; left: 0; top: 0; width: 100%; height: 10px; background: ${c.accent}; transform-origin: 0 50%; }
#mark { position: absolute; left: 96px; top: 96px; display: flex; align-items: center; gap: 18px; font-weight: 700; font-size: 34px; color: ${c.surface}; letter-spacing: 0.01em; }
#mark i { display: block; width: 26px; height: 26px; border-radius: 6px; background: ${c.accent}; }
`;
}

/** Kompozitsiya: total — videoning to'liq uzunligi (soniya) */
export function buildComposition(input: CompositionInput): Composition {
  const { book, scenes, starts, duration, gap, files } = input;
  if (!scenes.length || starts.length !== scenes.length) throw new Error('Sahnalar va ovoz vaqtlari mos emas');
  const c = palette(book.colors);
  const total = r3(LEAD + duration + HOLD);
  // Sahna oynalari: ovozdan PRE oldin boshlanadi, keyingisi boshlanguncha turadi
  const wins: SceneWindow[] = scenes.map((_, i) => ({ start: i === 0 ? 0 : LEAD + starts[i] - PRE, end: 0 }));
  wins.forEach((w, i) => { w.end = i + 1 < wins.length ? wins[i + 1].start : total; });
  // Har sahna ovozining tugashi (keyingi sahnadan oldingi jimlikkacha)
  const speechEnd = (i: number) => (i + 1 < starts.length ? starts[i + 1] - gap : duration);

  const onAccent = bestOn(c.accent, [c.ink, c.deep, c.surface, '#111111', '#ffffff']);
  const accentOnSurface = contrast(c.accent, c.surface) >= LARGE_AA ? c.accent : c.deep;
  const capHi = contrast(c.accent, c.deep) >= LARGE_AA ? c.accent : bestOn(c.deep, [c.surface, '#ffffff']);

  const totalPoints = scenes.filter(s => s.kind === 'point').length;
  let pointNo = 0;
  const sceneMarkup = scenes.map((s, i) => sceneHtml(s, i, wins[i], book, s.kind === 'point' ? ++pointNo : 0, totalPoints)).join('\n');

  // Sahna rasmlari: o'z sahnasidan biroz oldin chiqib, oldingisi ustiga yumshoq o'tadi
  const shots = (files.images ?? []).flatMap((img, i) => (img && wins[i]
    ? [{ id: `shot${i}`, img, start: r3(Math.max(0, wins[i].start - 0.25)), end: r3(wins[i].end) }]
    : []));
  const shotMarkup = shots.map(s => `<div id="${s.id}" class="clip shot" data-start="${s.start}" data-duration="${r3(s.end - s.start)}"><div class="shot-in"><img src="${esc(s.img)}" alt=""></div><div class="scrim"></div></div>`).join('\n');

  // Subtitr: aniq so'z vaqtlari bo'lsa — shular, bo'lmasa taxminiy; vaqtlar kompozitsiyaga (LEAD qo'shib) o'tkaziladi
  const caps: { id: string; start: number; end: number; words: { id: string; start: number; end: number }[] }[] = [];
  const capMarkup: string[] = [];
  scenes.forEach((s, i) => {
    const words = input.words?.[i]?.length ? input.words[i] : wordTimes(s.voice, starts[i], speechEnd(i));
    captionGroups(words).forEach(g => {
      const id = `cap${caps.length}`;
      const nextStart = (k: number) => (k + 1 < g.length ? g[k + 1].start : g[k].end);
      caps.push({
        id, start: r3(LEAD + g[0].start - 0.08), end: r3(LEAD + g[g.length - 1].end + 0.12),
        words: g.map((w, k) => ({ id: `${id}w${k}`, start: r3(LEAD + w.start), end: r3(LEAD + nextStart(k)) })),
      });
      capMarkup.push(`<div class="cap" id="${id}"><span class="box">${g.map((w, k) => `<span class="cw" id="${id}w${k}">${esc(w.text)}</span>`).join(' ')}</span></div>`);
    });
  });
  // Guruhlar bir-birini yopmasin: keyingisi boshlanganda oldingisi yo'qoladi
  caps.forEach((cap, k) => { if (k + 1 < caps.length) cap.end = Math.min(cap.end, caps[k + 1].start); });

  const cuts = wins.slice(1).map(w => r3(w.start + PRE));
  const data = {
    total,
    colors: { capText: c.surface, capHi, onBg: c.surface, onAccent },
    scenes: scenes.map((s, i) => ({ kind: s.kind, start: r3(wins[i].start), end: r3(wins[i].end) })),
    shots, cuts, caps,
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const voiceEnd = r3(LEAD + duration);
  const music = files.music
    ? `<audio id="music" src="${esc(files.music)}" data-start="0" data-duration="${total}" data-volume="${MUSIC_VOLUME}" data-automation='${JSON.stringify({
      version: 1,
      lanes: [{ target: 'volume', points: [{ t: 0, v: 0 }, { t: 0.8, v: MUSIC_VOLUME }, { t: voiceEnd, v: MUSIC_VOLUME }, { t: Math.min(total - 0.6, voiceEnd + 0.4), v: MUSIC_VOLUME * 2.2 }, { t: total, v: 0 }] }],
    })}'></audio>`
    : '';

  const lang = /[а-яё]/i.test(scenes.map(s => s.voice).join(' ')) ? 'ru' : 'uz';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<title>${esc(book.name)}</title>
<script src="gsap.min.js"></script>
<style>${css(c, onAccent, accentOnSurface)}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
<div id="bg"><div id="g1" class="glow"></div><div id="g2" class="glow"></div><div id="grid"></div><div id="vignette"></div></div>
${shotMarkup}
${sceneMarkup}
<div id="sweep">${cuts.map((_, i) => `<div class="band" id="band${i}"></div>`).join('')}</div>
<div id="caps">${capMarkup.join('\n')}</div>
<div id="top"><div id="bar"></div><div id="mark"><i></i><span>${esc(book.name)}</span></div></div>
<audio id="voice" src="${esc(files.voice)}" data-start="${LEAD}" data-duration="${r3(duration)}" data-volume="1"></audio>
${music}
</div>
<script type="application/json" id="hf-data">${json}</script>
<script>${RUNTIME_JS}</script>
</body>
</html>
`;
  return { html, total };
}
