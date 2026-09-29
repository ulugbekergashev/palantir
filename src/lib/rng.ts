/** Takrorlanadigan tasodif: bir xil urug' — bir xil natija (variantlar va namuna raqamlar uchun) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Matndan barqaror son (FNV-1a) */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ro'yxatdan n-elementi (aylanib) */
export const pickAt = <T,>(list: readonly T[], n: number): T => list[((n % list.length) + list.length) % list.length];
