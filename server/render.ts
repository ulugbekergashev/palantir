/**
 * Telegramga yuboriladigan rasm: brauzerdagi SVG shablonning o'zi serverda
 * chiziladi (React → SVG matn → resvg → PNG).
 *
 * Shrift: server/fonts dagi to'liq Manrope TTF (lotin, kirill — bitta faylda,
 * har og'irlik alohida). Chizish (resvg) ham, qatorlarni o'lchash (opentype.js)
 * ham shu fayllardan — matn rasmga to'g'ri sig'adi.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import type { Clinic, ContentItem, Lang } from '../src/types';
import { Artboard, heightOf } from '../src/templates/Artboard';
import { setTextMeasurer } from '../src/lib/text';

const FONTS: Record<number, string> = {
  500: 'Manrope_500Medium.ttf',
  600: 'Manrope_600SemiBold.ttf',
  700: 'Manrope_700Bold.ttf',
  800: 'Manrope_800ExtraBold.ttf',
};
const fontPath = (file: string) => fileURLToPath(new URL(`./fonts/${file}`, import.meta.url));
const WEIGHTS = Object.keys(FONTS).map(Number);

let fontFiles: string[] = [];
let ready = false;

function init(): void {
  if (ready) return;
  ready = true;
  fontFiles = Object.values(FONTS).map(fontPath);
  const faces = new Map<number, opentype.Font>();
  for (const w of WEIGHTS) {
    const buf = readFileSync(fontPath(FONTS[w]));
    faces.set(w, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  setTextMeasurer((text, size, weight) => {
    // Eng yaqin og'irlik (400 → 500)
    const w = WEIGHTS.reduce((best, x) => (Math.abs(x - weight) < Math.abs(best - weight) ? x : best), WEIGHTS[0]);
    return faces.get(w)!.getAdvanceWidth(text, size, { kerning: true });
  });
}

export function renderSvg(item: ContentItem, lang: Lang, clinic: Clinic): string {
  init();
  return renderToStaticMarkup(createElement(Artboard, { item, lang, clinic }));
}

export function renderPng(item: ContentItem, lang: Lang, clinic: Clinic): Buffer {
  const svg = renderSvg(item, lang, clinic);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1080 },
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Manrope', sansSerifFamily: 'Manrope' },
  });
  if (Math.round(resvg.height) !== heightOf(item)) throw new Error(`Rasm o'lchami noto'g'ri: ${resvg.width}×${resvg.height}`);
  return resvg.render().asPng();
}
