/**
 * SVG matnni o'zi qatorga bo'lmaydi — shu yerda o'lchab bo'linadi.
 * O'lchash haqiqiy shrift (Manrope) bilan: sahifa shrifti yuklangach App
 * qayta chiziladi, shunda qatorlar PNG'dagi bilan bir xil chiqadi.
 */

export const FONT_FAMILY = '"Manrope Variable", Manrope, "Segoe UI", Arial, sans-serif';

type Measure = (text: string, size: number, weight: number) => number;

/** Serverda (Telegramga rasm yuborishda) brauzer yo'q — o'lchagich tashqaridan beriladi */
let external: Measure | null = null;
export const setTextMeasurer = (m: Measure) => { external = m; };

let ctx: CanvasRenderingContext2D | null = null;
export const textWidth = (text: string, size: number, weight: number): number => {
  if (external) return external(text, size, weight);
  if (typeof document === 'undefined') return text.length * size * 0.55;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  return ctx.measureText(text).width;
};

/** Oxirgi qatorni "…" bilan qisqartiradi */
const ellipsize = (line: string, maxWidth: number, size: number, weight: number): string => {
  let s = line;
  while (s.length > 1 && textWidth(`${s}…`, size, weight) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
};

export function wrap(text: string, maxWidth: number, size: number, weight = 500, maxLines = 99): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(next, size, weight) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxWidth, size, weight);
  return kept;
}

/** Sarlavha uchun: berilgan qatorlarga sig'adigan eng katta o'lcham */
export function fit(text: string, maxWidth: number, sizes: number[], weight = 800, maxLines = 2): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrap(text, maxWidth, size, weight, 99);
    if (lines.length <= maxLines && lines.every(l => textWidth(l, size, weight) <= maxWidth)) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, maxWidth, size, weight, maxLines) };
}

/** "Marvarid Dent" → "MD" */
export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || 'D';

/** 1250000 → "1 250 000" */
export const money = (n: number): string => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');

/** 1250000 → "1 250 000 so'm" */
export const som = (n: number): string => `${money(n)} so'm`;

const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Sana hamma joyda bir xil: «29-okt» (boshqa yil bo'lsa «29-okt 2025») */
export function dateShort(isoTime: string, now = new Date()): string {
  const d = new Date(isoTime);
  return `${d.getDate()}-${MONTHS_SHORT[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** Vaqt bilan: «bugun 17:08», «kecha 09:30», «27-okt 14:00» */
export function when(isoTime: string, now = new Date()): string {
  const d = new Date(isoTime), time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return `bugun ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `kecha ${time}`;
  return `${dateShort(isoTime, now)} ${time}`;
}
