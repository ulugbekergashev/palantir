import type { Offering } from '../types';

/**
 * Narx ro'yxatini matndan o'qish (egasi Excel, Word yoki Telegram'dan nusxalab tashlaydi). Sof mantiq, modelsiz.
 * Har qatorda — nom va oxirida narx: «Plomba — 350 000 so'm», «Implant 4,5 mln», «Tozalash 200 ming», «Konsultatsiya — bepul».
 * «Bepul» — narx 0: profilda 0 «narx berilmagan» degani, shuning uchun server uni xizmat emas, fakt qilib saqlaydi.
 * Tushunilmagan qatorlar alohida qaytadi: taxmin qilib noto'g'ri narx yozgandan ko'ra egasiga ko'rsatgan yaxshi.
 */
export interface PriceLine { name: string; price: number }
export interface ParsedPrices { items: PriceLine[]; unclear: string[] }

/** Profildagi xizmatlar chegarasi (server/validate.ts dagi bilan bir xil) */
export const MAX_OFFERINGS = 100;
/** Bitta narxning yuqori chegarasi (server ham shundan kattasini olmaydi) */
export const MAX_PRICE = 100_000_000_000;
const MAX_NAME = 80;
/** Birliksiz bundan kichik son narx deb olinmaydi («Breket 350» — 350 so'mmi, 350 mingmi, noma'lum) */
const MIN_PLAIN = 1000;

const NUM = String.raw`\d[\d\s.,']*`;
const UNIT = String.raw`(?:mln|million|млн|ming|тыс\.?|k|к)`;
const CURRENCY = String.raw`(?:so['‘’ʻ]?m|sum|сум|сўм|uzs)`;
const TAIL = new RegExp(String.raw`(?:(${NUM})\s*(${UNIT})?\s*(?:[-–—]|dan)\s*)?(${NUM})\s*(${UNIT})?\s*(${CURRENCY})?\.?\s*$`, 'i');
const MILLIONS_BEFORE = /(\d[\d.,]*)\s*(?:mln|million|млн)\s*$/i;
const FREE = /\b(bepul|tekin)\b|бесплатно/i;
/** Sana («01.03.2025») yoki telefon («+998 90…», «Tel: …») — narx emas */
const NOT_A_PRICE = /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\+\s*\d|998[\s-]?\d{2}|\b(tel|telefon)\b|(^|\s)тел(ефон)?[\s.:]/i;
/** Birliksiz va valyutasiz yozilgan yil («Narxlar 2025») — narx emas */
const yearLike = (digits: string): boolean => /^(19|20)\d\d$/.test(digits.trim());

const factor = (unit: string | undefined): number => (!unit ? 1 : /^(mln|million|млн)/i.test(unit) ? 1_000_000 : 1000);
/** Birlik bo'lsa — o'nlik son («4,5 mln»); bo'lmasa — nuqta, vergul va bo'sh joy minglik ajratgich («1.200.000») */
const amount = (digits: string, unit: string | undefined): number =>
  (unit ? Math.round(parseFloat(digits.replace(/[\s']/g, '').replace(',', '.')) * factor(unit)) : Number(digits.replace(/\D/g, '')));
const tidy = (name: string): string => name.replace(/^\s*(?:\d+[.)]\s+|[-•*]\s+)/, '').replace(/[\s—–\-:=.|,;]+$/, '').replace(/\s+/g, ' ').trim();
const named = (name: string): boolean => /\p{L}{2}/u.test(name) && name.length <= MAX_NAME;

function parseLine(line: string): PriceLine | null {
  if (NOT_A_PRICE.test(line)) return null;
  const m = TAIL.exec(line);
  if (!m) {
    // «Konsultatsiya — bepul». Raqamli yoki inkorli gap («bepul emas», «200 000 so'mdan bepul») — shart, narx emas: egasi fakt qilib yozadi
    if (!FREE.test(line) || /\d/.test(line) || /\bemas\b|(^|\s)не\s/i.test(line)) return null;
    const name = tidy(line.replace(FREE, ''));
    return named(name) ? { name, price: 0 } : null;
  }
  const [whole, fromDigits, fromUnit, digits, unit, currency] = m;
  if (!unit && !currency && yearLike(digits)) return null;
  let price = amount(digits, unit);
  let name = line.slice(0, m.index);
  // «350–500 ming»: oraliqning boshi olinadi. Boshi narxga o'xshamasa («Koronka 2 — 350 000», «E-max 2000 — 1 200 000») — u nomning bir qismi
  const from = fromDigits ? amount(fromDigits, fromUnit ?? unit) : 0;
  const ranged = !!fromDigits && from >= MIN_PLAIN && from <= price && from >= price / 10;
  if (ranged) price = from;
  else if (fromDigits) name = line.slice(0, m.index + whole.indexOf(digits, fromDigits.length));
  // «1 mln 200 ming»
  const millions = unit && factor(unit) === 1000 ? MILLIONS_BEFORE.exec(name) : null;
  if (millions) {
    price += amount(millions[1], 'mln');
    name = name.slice(0, millions.index);
  }
  // Oraliq bitta narx bilan yozilsa, model uni aniq narx deb aytib yuboradi — shuning uchun nomida belgilanadi
  name = tidy(name) + (ranged ? " (boshlang'ich narx)" : '');
  if (!named(name) || !Number.isFinite(price) || price > MAX_PRICE || (!unit && price < MIN_PLAIN)) return null;
  return { name, price };
}

/** Faylda shuncha narx topilsa — «narxlar jadvaliga» olish taklif qilinadi (bitta son tasodif bo'lishi mumkin) */
export const MIN_FILE_PRICES = 2;

/** Matndagi narxi bor qatorlar soni */
export const pricedCount = (text: string): number => parsePrices(text).items.filter(i => i.price > 0).length;

export function parsePrices(text: string): ParsedPrices {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = lines.map(line => ({ line, item: parseLine(line) }));
  return { items: parsed.flatMap(p => (p.item ? [p.item] : [])), unclear: parsed.filter(p => !p.item).map(p => p.line) };
}

const key = (name: string): string => name.toLowerCase().replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, ' ').trim();
/** Ikki nom bitta xizmatmi (jadvalga qo'shishdagi qoida bilan bir xil) */
export const priceKey = key;

export interface PriceConflict { name: string; prices: number[] }
/**
 * Bitta xizmatga bir nechta narx («Tish tozalash — 250 000» va pastroqda «Tish tozalash — 300 000»). Jadvalga olishda oxirgisi
 * g'olib bo'lib qolardi — mijozga noto'g'ri narx aytilmasin, egasidan so'raladi. Qolganlari — ziddiyatsiz narxlar
 */
export function splitConflicts(items: PriceLine[]): { clean: PriceLine[]; conflicts: PriceConflict[] } {
  const groups = new Map<string, PriceLine[]>();
  for (const i of items) groups.set(key(i.name), [...(groups.get(key(i.name)) ?? []), i]);
  const conflicts: PriceConflict[] = [];
  const clean: PriceLine[] = [];
  for (const group of groups.values()) {
    const prices = [...new Set(group.map(i => i.price))];
    if (prices.length > 1) conflicts.push({ name: group[0].name, prices });
    else clean.push(group[0]);
  }
  return { clean, conflicts };
}

export interface PriceChanges { /** Jadvalda yo'q yangi xizmatlar soni */ fresh: number; /** Narxi o'zgaradigan mavjud xizmatlar */ changed: { name: string; from: number; to: number }[] }
/** Yangi narxlar jadvalga olinsa nima o'zgaradi (mergeOfferings bilan bir xil qoida) — egasiga oldindan ko'rsatish uchun */
export function priceChanges(existing: Offering[], incoming: PriceLine[]): PriceChanges {
  const fresh = new Map(incoming.filter(i => i.price > 0).map(i => [key(i.name), i]));
  const known = new Set(existing.map(o => key(o.name)));
  return {
    fresh: [...fresh.keys()].filter(k => !known.has(k)).length,
    changed: existing.flatMap(o => { const hit = fresh.get(key(o.name)); return hit && hit.price !== o.price ? [{ name: o.name, from: o.price, to: hit.price }] : []; }),
  };
}

/**
 * Yangi narxlarni mavjud xizmatlarga qo'shadi: nomi bir xil bo'lsa narxi yangilanadi, qolganlari qo'shiladi. Mavjudlari o'chirilmaydi.
 * dropped — chegaradan (MAX_OFFERINGS) oshgani uchun qo'shilmagan yangi xizmatlar soni.
 */
export function mergeOfferings(existing: Offering[], incoming: PriceLine[], makeId: () => string): { offerings: Offering[]; added: number; updated: number; dropped: number } {
  const fresh = new Map(incoming.map(i => [key(i.name), i]));
  const updated = existing.map(o => { const hit = fresh.get(key(o.name)); return hit && hit.price !== o.price ? { ...o, price: hit.price } : o; });
  const known = new Set(existing.map(o => key(o.name)));
  const novel = [...fresh.entries()].filter(([k]) => !known.has(k)).map(([, i]): Offering => ({ id: makeId(), name: i.name, price: i.price }));
  const added = novel.slice(0, Math.max(0, MAX_OFFERINGS - existing.length));
  return { offerings: [...updated, ...added], added: added.length, updated: updated.filter((o, n) => o !== existing[n]).length, dropped: novel.length - added.length };
}
