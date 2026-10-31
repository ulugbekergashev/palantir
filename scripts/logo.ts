/**
 * Palantir logo to'plami (Palantir-logo/, public/favicon.svg) va ilova ichidagi tosh qatlamlari (src/assets/palantir) — bitta joydan.
 * Belgi — ko'ruvchi tosh (palantír, rasmi: scripts/stone-art.ts): qora shisha shar, ichida tutun va cho'g', ikonkada tagkursi bilan.
 * Yozuv («palantir», Manrope 800, konturga aylantirilgan) eski to'plamdan olinadi.
 * Ishga tushirish: npx tsx scripts/logo.ts — SVG'lar yoziladi, PNG'lar ko'rinmas brauzerda chiziladi, favicon.ico (16/32/48/256).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { installedBrowser } from '../server/browserPath';
import { appAssets, stone, stoneMono } from './stone-art';

const ROOT = join(process.cwd(), 'Palantir-logo');
const INK = '#0B0D10', SILVER = '#EEF0F3', WHITE = '#FFFFFF';
/** Eski to'plamdagi yozuv konturi (belgidan o'ngda, viewBox 16.91 10.55 481.43 109.50) */
const WORD = /<path fill="#[0-9A-Fa-f]{6}" d="([^"]+)"/.exec(readFileSync(join(ROOT, 'svg', 'palantir-logo.svg'), 'utf8'))?.[1];
if (!WORD) throw new Error("Yozuv konturi topilmadi (Palantir-logo/svg/palantir-logo.svg)");

const svg = (viewBox: string, w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" role="img" aria-label="Palantir"><title>Palantir</title>${body}</svg>\n`;
const LOGO_BOX = '16.91 10.55 481.43 109.50';
const word = (fill: string) => `<path fill="${fill}" d="${WORD}"/>`;

const FILES: Record<string, string> = {
  'palantir-logo': svg(LOGO_BOX, 481, 110, stone(61, 61, 44) + word(INK)),
  'palantir-logo-qora-fon': svg(LOGO_BOX, 481, 110, stone(61, 61, 44) + word(SILVER)),
  'palantir-logo-mono-qora': svg(LOGO_BOX, 481, 110, stoneMono(61, 61, 44, INK) + word(INK)),
  'palantir-logo-mono-oq': svg(LOGO_BOX, 481, 110, stoneMono(61, 61, 44, WHITE) + word(WHITE)),
  'palantir-belgi': svg('8.00 8.00 84.00 84.00', 84, 84, stone(50, 41, 32, 'p', true)),
  'palantir-belgi-qora-fon': svg('8.00 8.00 84.00 84.00', 84, 84, stone(50, 41, 32, 'p', true)),
  'palantir-ikonka': svg('0.00 0.00 100.00 100.00', 100, 100, `<rect width="100" height="100" rx="23.6" fill="${INK}"/>${stone(50, 41, 30, 'p', true)}`),
  'palantir-ikonka-kvadrat': svg('0.00 0.00 100.00 100.00', 100, 100, `<rect width="100" height="100" fill="${INK}"/>${stone(50, 41, 30, 'p', true)}`),
  // Doira shaklida kesilganda ham to'liq ko'rinadi
  'palantir-avatar': svg('0.00 0.00 100.00 100.00', 100, 100, `<rect width="100" height="100" fill="${INK}"/>${stone(50, 40, 25, 'p', true)}`),
};

/** PNG'lar: nom → [svg, eni, bo'yi, fon] (fon berilmasa — shaffof) */
const PNGS: [string, string, number, number][] = [
  ['png/palantir-avatar-1080.png', 'palantir-avatar', 1080, 1080],
  ['png/palantir-belgi-1024.png', 'palantir-belgi', 1024, 1024],
  ['png/palantir-belgi-qora-fon-1024.png', 'palantir-belgi-qora-fon', 1024, 1024],
  ['png/palantir-ikonka-1024.png', 'palantir-ikonka', 1024, 1024],
  ['png/palantir-ikonka-512.png', 'palantir-ikonka', 512, 512],
  ['png/palantir-ikonka-kvadrat-1024.png', 'palantir-ikonka-kvadrat', 1024, 1024],
  ['png/palantir-logo.png', 'palantir-logo', 2000, 457],
  ['png/palantir-logo-qora-fon.png', 'palantir-logo-qora-fon', 2000, 457],
  ['png/palantir-logo-mono-qora.png', 'palantir-logo-mono-qora', 2000, 457],
  ['png/palantir-logo-mono-oq.png', 'palantir-logo-mono-oq', 2000, 457],
  ['favicon/android-192.png', 'palantir-ikonka', 192, 192],
  ['favicon/apple-touch-icon-180.png', 'palantir-ikonka-kvadrat', 180, 180],
  ['favicon/favicon-16.png', 'palantir-ikonka', 16, 16],
  ['favicon/favicon-32.png', 'palantir-ikonka', 32, 32],
];
const ICO_SIZES = [16, 32, 48, 256];

/** PNG ichida turgan ICO (Windows Vista va keyingilari): yorliq va o'rnatgich uchun */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(p.size >= 256 ? 0 : p.size, e); head.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(p.data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += p.data.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.data)]);
}

for (const dir of ['svg', 'png', 'favicon']) mkdirSync(join(ROOT, dir), { recursive: true });
for (const [name, text] of Object.entries(FILES)) writeFileSync(join(ROOT, 'svg', `${name}.svg`), text);
writeFileSync(join(ROOT, 'favicon', 'favicon.svg'), FILES['palantir-ikonka']);
writeFileSync(join(process.cwd(), 'public', 'favicon.svg'), FILES['palantir-ikonka']);
const ASSETS = join(process.cwd(), 'src', 'assets', 'palantir');
mkdirSync(ASSETS, { recursive: true });
for (const [name, text] of Object.entries(appAssets())) writeFileSync(join(ASSETS, name), text);

const exe = installedBrowser();
if (!exe) throw new Error('Chrome yoki Edge topilmadi — PNG chizilmadi');
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const render = async (svgText: string, w: number, h: number, bg = 'transparent') => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><img style="display:block;width:${w}px;height:${h}px" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}"></body></html>`);
  await page.locator('img').evaluate(i => (i as HTMLImageElement).decode());
  return page.screenshot({ omitBackground: bg === 'transparent', type: 'png' });
};
for (const [file, name, w, h] of PNGS) writeFileSync(join(ROOT, file), await render(FILES[name], w, h));
const icons = [];
for (const size of ICO_SIZES) icons.push({ size, data: await render(FILES['palantir-ikonka'], size, size) });
writeFileSync(join(ROOT, 'favicon', 'favicon.ico'), ico(icons));

// Ko'rinish: hamma variant bir varaqda (yorug', qora, rangli fon va kichik o'lchamlar)
const tile = (bg: string, name: string, w: number) => `<div style="background:${bg};display:flex;align-items:center;justify-content:center;padding:44px"><img style="width:${w}px" src="data:image/svg+xml;base64,${Buffer.from(FILES[name]).toString('base64')}"></div>`;
const sheet = `<div style="display:grid;grid-template-columns:1fr 1fr;width:1600px;font-family:sans-serif">
${tile('#EEF0F3', 'palantir-logo', 620)}${tile(INK, 'palantir-logo-qora-fon', 620)}
${tile('#FFFFFF', 'palantir-logo-mono-qora', 620)}${tile('#C2410C', 'palantir-logo-mono-oq', 620)}
${tile('#FFFFFF', 'palantir-belgi', 300)}${tile(INK, 'palantir-belgi-qora-fon', 300)}
<div style="background:#EEF0F3;display:flex;align-items:center;justify-content:space-around;padding:44px;grid-column:span 2">
${[300, 128, 64, 32, 16].map(s => `<img style="width:${s}px" src="data:image/svg+xml;base64,${Buffer.from(FILES['palantir-ikonka']).toString('base64')}">`).join('')}
</div></div>`;
await page.setViewportSize({ width: 1600, height: 1500 });
await page.setContent(`<html><body style="margin:0">${sheet}</body></html>`);
await page.waitForTimeout(300);
writeFileSync(join(ROOT, 'korinish.png'), await page.locator('body > div').screenshot({ type: 'png' }));
await browser.close();
console.log(`logo: ${Object.keys(FILES).length} SVG, ${PNGS.length} PNG, favicon.ico (${ICO_SIZES.join('/')}), korinish.png`);
