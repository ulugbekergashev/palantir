/** WCAG nisbiy yorqinlik va kontrast (1…21) — brend-buk ranglari (server tekshiruvi, panel, video chizgichi) uchun bitta joyda */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Oddiy matn uchun 4.5:1, katta (sarlavha) matn uchun 3:1 — WCAG AA */
export const TEXT_AA = 4.5;
export const LARGE_AA = 3;
