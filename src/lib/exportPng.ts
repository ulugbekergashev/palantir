import latin from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url';
import cyrillic from '@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2?url';

/**
 * Artboard SVG'sini 1080×1080 (post) yoki 1080×1920 (storis) PNG qiladi.
 * Rasm sifatida ochilgan SVG tashqi shriftni yuklay olmaydi — shuning uchun
 * Manrope ichiga (base64) joylanadi; aks holda PNG'da boshqa shrift chiqardi.
 */

const FACES: [string, string][] = [
  [latin, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  [latinExt, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  [cyrillic, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
];

const toBase64 = async (url: string): Promise<string> => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

let fontCss: Promise<string> | null = null;
const embeddedFonts = () => {
  fontCss ??= Promise.all(FACES.map(async ([url, range]) =>
    `@font-face{font-family:"Manrope Variable";font-style:normal;font-weight:200 800;src:url(data:font/woff2;base64,${await toBase64(url)}) format("woff2");unicode-range:${range};}`,
  )).then(parts => parts.join(''));
  return fontCss;
};

export async function svgToPng(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = await embeddedFonts();
  clone.insertBefore(style, clone.firstChild);

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG yaratilmadi'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
