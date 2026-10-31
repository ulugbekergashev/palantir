/**
 * Ko'ruvchi tosh (palantír) rasmi — bitta joydan: ilova ichidagi sferalar (src/assets/palantir/*.svg niqoblari, uslubi — index.css .palantir)
 * va logo/ikonka (scripts/logo.ts). Tosh: qora shisha, ichida ikki qatlam tutun (ingichka tolalar va qalin tuman), chuqurda cho'g',
 * pastida yorug' aksi, tepada deraza aksi. Tutun — qiyshiq halqalar, fraktal shovqin bilan buralgan: har gal bir xil chiqadi (seed).
 * Koordinatalar: shar markazi 0,0, radiusi 100.
 */

/** Takrorlanadigan tasodifiy sonlar: rasm har yig'ishda bir xil */
function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface SmokeLayer { seed: number; rings: number; rx0: number; step: number; flat: number; w0: number; w1: number; op0: number; op1: number; freq: number; scale: number; blur: number; fog: number }

/** Ingichka tolalar (aniq ko'rinadigan tutun) va qalin tuman (orqa fon) */
export const SMOKE: Record<'wisp' | 'fog', SmokeLayer> = {
  wisp: { seed: 11, rings: 34, rx0: 8, step: 2.4, flat: 0.42, w0: 0.5, w1: 2.2, op0: 0.12, op1: 0.7, freq: 0.022, scale: 26, blur: 1.3, fog: 0 },
  fog: { seed: 29, rings: 14, rx0: 14, step: 5, flat: 0.48, w0: 5, w1: 14, op0: 0.1, op1: 0.32, freq: 0.012, scale: 44, blur: 3.4, fog: 0.5 },
};

const f1 = (n: number) => n.toFixed(1);

/** Bir qatlam tutun: oq rang (niqob sifatida ishlatiladi), filtr id'si — bir faylda to'qnashmasin */
export function smokeGroup(kind: keyof typeof SMOKE, id: string): { defs: string; body: string } {
  const l = SMOKE[kind], r = random(l.seed);
  let rings = '';
  for (let i = 0; i < l.rings; i++) {
    const rx = l.rx0 + i * l.step + r() * l.step, ry = rx * (l.flat + r() * 0.25);
    const rot = r() * 180, cx = (r() - 0.5) * 18, cy = (r() - 0.5) * 14 + 6;
    const w = l.w0 + r() * (l.w1 - l.w0), op = l.op0 + r() * (l.op1 - l.op0);
    const len = Math.PI * (rx + ry), dash = len * (0.35 + r() * 0.5), offset = r() * len;
    rings += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" transform="rotate(${rot.toFixed(0)} ${f1(cx)} ${f1(cy)})" stroke-width="${f1(w)}" stroke-opacity="${op.toFixed(2)}" stroke-dasharray="${dash.toFixed(0)} ${len.toFixed(0)}" stroke-dashoffset="${offset.toFixed(0)}"/>`;
  }
  const defs = `<filter id="${id}T" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency="${l.freq}" numOctaves="5" seed="${l.seed}" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="${l.scale}" xChannelSelector="R" yChannelSelector="B"/>`
    + `<feGaussianBlur stdDeviation="${l.blur}"/></filter>`
    + (l.fog ? `<radialGradient id="${id}G"><stop offset="0" stop-color="#fff" stop-opacity="${l.fog}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` : '');
  const body = `<g filter="url(#${id}T)" fill="none" stroke="#fff" stroke-linecap="round">${l.fog ? `<circle r="70" fill="url(#${id}G)" stroke="none"/>` : ''}${rings}</g>`;
  return { defs, body };
}

/** Shisha: deraza aksi (sirtga yopishgan egri to'rtburchak), kichik uchqun, chetidagi yupqa yorug'lik (tepa — oq, past — iliq) */
export function glassGroup(id: string): { defs: string; body: string } {
  const defs = `<linearGradient id="${id}W" x1="-70" y1="-80" x2="-20" y2="-20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".6" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<radialGradient id="${id}S"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="${id}R" x1="0" y1="-100" x2="0" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#ffb070" stop-opacity="0"/><stop offset="1" stop-color="#ffb070" stop-opacity=".35"/></linearGradient>`
    + `<filter id="${id}B" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>`;
  const body = `<path filter="url(#${id}B)" fill="url(#${id}W)" d="M-78 -30C-76 -58 -58 -78 -30 -86C-24 -88 -20 -82 -24 -76C-46 -66 -60 -50 -64 -26C-66 -18 -79 -20 -78 -30Z"/>`
    + `<path filter="url(#${id}B)" fill="url(#${id}W)" opacity=".55" d="M-18 -88C-8 -90 4 -90 12 -88C16 -86 14 -80 8 -80C0 -81 -8 -80 -16 -79C-22 -79 -24 -86 -18 -88Z"/>`
    + `<circle cx="-38" cy="-60" r="5" fill="url(#${id}S)"/>`
    + `<circle r="98.5" fill="none" stroke="url(#${id}R)" stroke-width="3"/>`;
  return { defs, body };
}

const svgFile = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200"><defs>${defs}</defs>${body}</svg>\n`;

/** Ilova uchun fayllar (src/assets/palantir): tutun niqoblari va shisha qatlami */
export function appAssets(): Record<string, string> {
  const wisp = smokeGroup('wisp', 'w'), fog = smokeGroup('fog', 'f'), glass = glassGroup('g');
  return {
    'smoke-wisp.svg': svgFile(wisp.defs, wisp.body),
    'smoke-fog.svg': svgFile(fog.defs, fog.body),
    'glass.svg': svgFile(glass.defs, glass.body),
  };
}

/** Tagkursi: qora temir kosacha, ikki panja sharni yonidan quchoqlaydi (oldingi panjalar shar ustida chiziladi) */
function stand(id: string): { defs: string; back: string; front: string } {
  const defs = `<linearGradient id="${id}M" x1="0" y1="40" x2="0" y2="160" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5a4634"/><stop offset=".3" stop-color="#2a1f17"/><stop offset="1" stop-color="#0d0a08"/></linearGradient>`
    + `<linearGradient id="${id}E" x1="-90" y1="0" x2="90" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9a3c" stop-opacity="0"/><stop offset=".5" stop-color="#ffb062" stop-opacity=".7"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></linearGradient>`;
  // Orqadagi kosacha va oyoq — shar ortida
  const back = `<path fill="url(#${id}M)" stroke="#8a6a4a" stroke-opacity=".55" stroke-width="1.6" d="M-62 78C-40 98 40 98 62 78L56 112C34 124 -34 124 -56 112Z"/>`
    + `<path fill="url(#${id}M)" stroke="#8a6a4a" stroke-opacity=".55" stroke-width="1.6" d="M-22 118H22L30 140H-30Z"/>`
    + `<rect x="-74" y="138" width="148" height="16" rx="6" fill="url(#${id}M)" stroke="#8a6a4a" stroke-opacity=".55" stroke-width="1.6"/>`
    + `<path d="M-70 139H70" stroke="#ffb062" stroke-opacity=".25" stroke-width="1.5"/>`;
  // Oldingi ikki panja: sharni yonidan tutib turadi
  const front = `<path fill="url(#${id}M)" stroke="#8a6a4a" stroke-opacity=".55" stroke-width="1.6" d="M-60 112C-88 96 -96 70 -88 44C-86 38 -80 40 -80 46C-80 66 -72 84 -50 100Z"/>`
    + `<path fill="url(#${id}M)" stroke="#8a6a4a" stroke-opacity=".55" stroke-width="1.6" d="M60 112C88 96 96 70 88 44C86 38 80 40 80 46C80 66 72 84 50 100Z"/>`
    + `<path fill="none" stroke="url(#${id}E)" stroke-width="2" d="M-58 96C-30 112 30 112 58 96"/>`;
  return { defs, back, front };
}

/** Rangli tosh logo uchun: markazi (cx, cy), radiusi r; withStand — tagkursi bilan (ikonka); id — gradient nomlari to'qnashmasin */
export function stone(cx: number, cy: number, r: number, id = 'p', withStand = false): string {
  const wisp = smokeGroup('wisp', `${id}w`), fog = smokeGroup('fog', `${id}f`), glass = glassGroup(`${id}g`), st = stand(`${id}s`);
  const defs = wisp.defs + fog.defs + glass.defs + (withStand ? st.defs : '')
    + `<clipPath id="${id}C"><circle r="100"/></clipPath>`
    + `<radialGradient id="${id}Base" cx="0" cy="24" r="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1b0d08"/><stop offset=".45" stop-color="#0a0506"/><stop offset=".8" stop-color="#030203"/><stop offset="1" stop-color="#000"/></radialGradient>`
    + `<radialGradient id="${id}Glow" cx="0" cy="20" r="80" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".4"/><stop offset=".45" stop-color="#8a2f0c" stop-opacity=".22"/><stop offset="1" stop-color="#8a2f0c" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="${id}Fog" cx="0" cy="16" r="110" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe6bf"/><stop offset=".26" stop-color="#ff9a3c"/><stop offset=".55" stop-color="#8a2f0c"/><stop offset=".8" stop-color="#3a2a2a"/></radialGradient>`
    + `<radialGradient id="${id}Wisp" cx="0" cy="16" r="110" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".18" stop-color="#ffe6bf"/><stop offset=".4" stop-color="#ff9a3c"/><stop offset=".75" stop-color="#7c3a1f"/></radialGradient>`
    + `<radialGradient id="${id}Core" cx="0" cy="16" r="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff7e6"/><stop offset=".1" stop-color="#ffe6bf"/><stop offset=".3" stop-color="#ff9a3c" stop-opacity=".7"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="${id}Depth" cx="0" cy="8" r="100" gradientUnits="userSpaceOnUse"><stop offset=".36" stop-color="#000" stop-opacity="0"/><stop offset=".68" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity=".95"/></radialGradient>`
    + `<radialGradient id="${id}Caustic" cx="0" cy="90" r="58" gradientTransform="translate(0 90) scale(1 .34) translate(0 -90)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".55"/><stop offset=".7" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>`
    + `<mask id="${id}WM" maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">${wisp.body}</mask>`
    + `<mask id="${id}FM" maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">${fog.body}</mask>`;
  const ball = `<g clip-path="url(#${id}C)">`
    + `<circle r="100" fill="url(#${id}Base)"/><circle r="100" fill="url(#${id}Glow)"/>`
    + `<rect x="-110" y="-110" width="220" height="220" fill="url(#${id}Fog)" mask="url(#${id}FM)" opacity=".75"/>`
    + `<rect x="-110" y="-110" width="220" height="220" fill="url(#${id}Wisp)" mask="url(#${id}WM)" opacity=".7"/>`
    + `<circle r="100" fill="url(#${id}Core)"/><circle r="100" fill="url(#${id}Depth)"/>`
    + `<circle r="100" fill="url(#${id}Caustic)"/></g>${glass.body}`;
  const body = withStand ? st.back + ball + st.front : ball;
  return `<g transform="translate(${cx} ${cy}) scale(${(r / 100).toFixed(4)})"><defs>${defs}</defs>${body}</g>`;
}

/** Bir rangli belgi (muhr, blanka): shar, deraza aksi kesib olingan; withStand — tagkursi siluet bilan */
export function stoneMono(cx: number, cy: number, r: number, color: string, id = 'p', withStand = false): string {
  const cut = 'M-78 -30C-76 -58 -58 -78 -30 -86C-24 -88 -20 -82 -24 -76C-46 -66 -60 -50 -64 -26C-66 -18 -79 -20 -78 -30Z';
  const standShape = withStand
    ? `<path fill="${color}" d="M-60 112C-88 96 -96 70 -88 44C-86 38 -80 40 -80 46C-80 66 -72 84 -50 100Z M60 112C88 96 96 70 88 44C86 38 80 40 80 46C80 66 72 84 50 100Z M-56 112C-34 124 34 124 56 112L54 104C30 116 -30 116 -54 104Z M-22 118H22L30 140H-30Z"/><rect x="-74" y="138" width="148" height="16" rx="6" fill="${color}"/>`
    : '';
  return `<g transform="translate(${cx} ${cy}) scale(${(r / 100).toFixed(4)})">
<defs><mask id="${id}M" maskUnits="userSpaceOnUse" x="-102" y="-102" width="204" height="204"><circle r="100" fill="#fff"/><path d="${cut}" fill="#000"/></mask></defs>
<circle r="100" fill="${color}" mask="url(#${id}M)"/>${standShape}
</g>`;
}
