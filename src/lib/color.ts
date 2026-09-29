/** Brend ranglari bilan ishlash: shaffoflik, aralashtirish, matn rangi */

const parse = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
};

const toHex = (rgb: number[]): string =>
  `#${rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** Ikki rangni aralashtiradi: t=0 — a, t=1 — b */
export const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [parse(a), parse(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

export const alpha = (hex: string, a: number): string => {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Nisbiy yorqinlik (WCAG) */
const luminance = (hex: string): number => {
  const [r, g, b] = parse(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Shu fon ustida o'qiladigan matn rangi */
export const onColor = (bg: string): string => (luminance(bg) > 0.45 ? '#0F172A' : '#FFFFFF');

/** Oq fonda matn uchun yetarlicha to'q variant */
export const deepen = (hex: string): string => (luminance(hex) > 0.25 ? mix(hex, '#0F172A', 0.45) : hex);
