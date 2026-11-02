/**
 * Xotira yozuvi — Bilim/Faktlar.md dagi bitta qator. Obsidian'da ham o'qiladi va tahrirlanadi:
 *
 *   - Matn #teg1 #teg2 [tur:: qaror] [sana:: 2026-11-03] [kim:: Siz] [manba:: panel] [eskirgan:: 2026-12-01] ^id
 *
 * [kalit:: qiymat] — Obsidian'ning (Dataview) ichki maydonlari; oxiridagi #so'zlar — teglar. Maydonsiz eski qator — oddiy fakt.
 * Toza funksiyalar (baza va fayl yo'q): server ham (brain/vault.ts), sahifa ham ishlatadi; sinov — scripts/check-xotira.ts.
 */
import type { MemoryKind } from '../types';

export const MEMORY_KINDS: MemoryKind[] = ['qaror', 'qoida', 'fakt', 'afzallik', 'odat', 'kontakt'];
export const KIND_LABEL: Record<MemoryKind, { one: string; many: string; hint: string }> = {
  qaror: { one: 'Qaror', many: 'Qarorlar', hint: 'Nima hal qilindi va nega' },
  qoida: { one: 'Qoida', many: 'Qoidalar', hint: 'Har doim shunday qilinadi' },
  fakt: { one: 'Fakt', many: 'Faktlar', hint: 'Shartlar, rekvizitlar, ish tartibi' },
  afzallik: { one: 'Afzallik', many: 'Afzalliklar', hint: 'Nimani yoqtirasiz, qanday yozilsin' },
  odat: { one: 'Odat', many: 'Odatlar', hint: 'Takrorlanadigan ish va ritm' },
  kontakt: { one: 'Kontakt', many: 'Kontaktlar', hint: 'Hamkorlar, yetkazuvchilar, kerakli odamlar' },
};
export const isMemoryKind = (s: unknown): s is MemoryKind => typeof s === 'string' && (MEMORY_KINDS as string[]).includes(s);

/** Bitta yozuvning chegaralari */
export const MEMORY_LIMITS = { text: 500, tags: 6, tag: 30, by: 60, source: 60 };

export interface MemoryFields {
  text: string;
  kind: MemoryKind;
  tags: string[];
  /** YYYY-MM-DD yoki '' (eski qatorlarda sana yo'q) */
  date: string;
  by: string;
  source: string;
  /** YYYY-MM-DD yoki '' — eskirmagan */
  stale: string;
}

const FIELD = /\s*\[(tur|sana|kim|manba|eskirgan)::\s*([^\]\n]*)\]/g;
const TRAILING_TAGS = /((?:\s+#[\p{L}\p{N}_/-]+)+)\s*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Teg: kichik harf, bo'shliqsiz, # siz; yaroqsizi tashlanadi */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase().replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, MEMORY_LIMITS.tag);
}
export const cleanTags = (raw: readonly string[]): string[] => [...new Set(raw.map(cleanTag).filter(Boolean))].slice(0, MEMORY_LIMITS.tags);

/** Maydon qiymati: bir qator, kvadrat qavssiz (qatorni buzmasin) */
const fieldValue = (s: string, max: number): string => s.replace(/[[\]\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Yozuv matni: bir qator; kvadrat qavs — oddiy qavsga (maydon bo'lib o'qilmasin), oxiridagi «^» — olib tashlanadi (belgi bo'lib o'qilmasin) */
export const cleanText = (s: string): string =>
  s.replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+\^[A-Za-z0-9-]*$/, '').trim().slice(0, MEMORY_LIMITS.text);

/** Qatorning «- » va «^id» siz qismini o'qiydi */
export function parseMemory(body: string): MemoryFields {
  const out: MemoryFields = { text: '', kind: 'fakt', tags: [], date: '', by: '', source: '', stale: '' };
  let rest = body.replace(FIELD, (_all, key: string, value: string) => {
    const v = value.trim();
    if (key === 'tur' && isMemoryKind(v)) out.kind = v;
    else if (key === 'sana' && DATE.test(v)) out.date = v;
    else if (key === 'kim') out.by = v.slice(0, MEMORY_LIMITS.by);
    else if (key === 'manba') out.source = v.slice(0, MEMORY_LIMITS.source);
    else if (key === 'eskirgan') out.stale = DATE.test(v) ? v : (v ? '0000-00-00' : '');
    return '';
  }).trim();
  const tags = TRAILING_TAGS.exec(rest);
  if (tags) {
    out.tags = cleanTags(tags[1].trim().split(/\s+/));
    rest = rest.slice(0, tags.index).trim();
  }
  out.text = rest.slice(0, MEMORY_LIMITS.text);
  return out;
}

/** Qatorning «- » va «^id» orasidagi qismi (parseMemory ning teskarisi) */
export function formatMemory(m: MemoryFields): string {
  const parts = [cleanText(m.text), ...cleanTags(m.tags).map(t => `#${t}`), `[tur:: ${m.kind}]`];
  if (m.date) parts.push(`[sana:: ${m.date}]`);
  if (m.by) parts.push(`[kim:: ${fieldValue(m.by, MEMORY_LIMITS.by)}]`);
  if (m.source) parts.push(`[manba:: ${fieldValue(m.source, MEMORY_LIMITS.source)}]`);
  if (m.stale) parts.push(`[eskirgan:: ${m.stale}]`);
  return parts.join(' ');
}
