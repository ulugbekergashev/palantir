/**
 * Hujjat tekshiruvi — AI'siz, sof funksiyalar: model yozgan matndagi xatolarni topadi, tuzatish bosqichiga (writer.ts) sabab bo'lib boradi.
 *   - jadval hisobi: «soni × narx = summa» va «Jami» qatori summalar yig'indisiga tengmi;
 *   - egasining ma'lum rekvizitlari (STIR, h/r…) hujjatga tushganmi (bo'sh «____» bilan qoldirilmaganmi);
 *   - majburiy bo'limlar bormi (playbooks.ts); so'z bilan summa belgisi to'g'rimi; o'zbekcha matnda kirill aralashmaganmi.
 */
import type { Lang } from '../../src/types';

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Markdown jadvallari: sarlavha qatori va qolgan qatorlar */
export function tables(markdown: string): { head: string[]; rows: string[][] }[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: { head: string[]; rows: string[][] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || i + 1 >= lines.length || !isDivider(lines[i + 1])) continue;
    const head = cells(lines[i]), rows: string[][] = [];
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
    out.push({ head, rows });
  }
  return out;
}

/** «1 500 000 so'm», «1,500,000», «**3 000 000**» → 1500000; son bo'lmasa — null (bo'sh joy «____» ham) */
export function money(cell: string): number | null {
  const t = cell.replace(/\*\*/g, '').replace(/so['‘’ʻ]?m|сум(ов|а)?|uzs/gi, '').replace(/[\s ]/g, '').trim();
  if (!/^\d{1,3}([,.]?\d{3})*$|^\d+$/.test(t)) return null;
  return Number(t.replace(/[,.]/g, ''));
}

const QTY = /soni|miqdor|кол-?во|количеств/i;
const PRICE = /narx|baho|цена|стоимость\s*ед/i;
const SUM = /summa|summasi|qiymat|сумма|стоимость(?!\s*ед)/i;
const TOTAL = /jami|hammasi|итого|всего/i;
const TAX = /qqs|ндс/i;

/** Jadval hisob-kitobi xatolari: qator «soni × narx ≠ summa», «Jami» ≠ qatorlar yig'indisi */
export function tableMath(markdown: string): string[] {
  const problems: string[] = [];
  for (const t of tables(markdown)) {
    const qi = t.head.findIndex(h => QTY.test(h));
    const pi = t.head.findIndex(h => PRICE.test(h) && !SUM.test(h));
    const si = t.head.findIndex((h, i) => SUM.test(h) && i !== pi);
    if (si < 0) continue;
    let sum = 0, items = 0, taxRows = 0;
    for (const r of t.rows) {
      const label = r.join(' ');
      const amount = money(r[si] ?? '');
      if (TOTAL.test(label)) {
        // «Jami» bitta bo'lsa va soliq qatorlari yo'q bo'lsa — qatorlar yig'indisiga teng bo'lishi kerak
        if (amount !== null && items && !taxRows && amount !== sum) problems.push(`Jadvalda «${r.find(c => TOTAL.test(c)) ?? 'Jami'}» ${fmt(amount)}, lekin qatorlar yig'indisi ${fmt(sum)}`);
        continue;
      }
      if (TAX.test(label)) { taxRows++; continue; }
      if (amount === null) continue;
      const qty = qi >= 0 ? money(r[qi] ?? '') : null, price = pi >= 0 ? money(r[pi] ?? '') : null;
      if (qty !== null && price !== null && Math.abs(qty * price - amount) > 1) problems.push(`«${r.find(c => c && money(c) === null) ?? r[0]}»: ${fmt(qty)} × ${fmt(price)} = ${fmt(qty * price)}, jadvalda esa ${fmt(amount)}`);
      sum += amount;
      items++;
    }
  }
  return problems;
}

const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');

/** Egasining ma'lum ma'lumoti hujjatda bormi (raqamlar bo'shliqsiz solishtiriladi) */
export function missingKnown(markdown: string, known: { label: string; value: string }[]): string[] {
  const flat = markdown.replace(/[\s ]/g, '').toLowerCase();
  return known.filter(k => k.value.trim() && !flat.includes(k.value.replace(/[\s ]/g, '').toLowerCase()))
    .map(k => `${k.label} ma'lum (${k.value}), lekin hujjatda yo'q — «____» o'rniga shuni yozing`);
}

/** Majburiy bo'limlar: har biri — sarlavhalardan birida uchrashi kerak bo'lgan so'zlar (birortasi bo'lsa yetadi) */
export function missingSections(markdown: string, required: { name: string; any: RegExp }[]): string[] {
  const heads = markdown.split('\n').filter(l => /^#{1,3}\s/.test(l.trim())).join('\n');
  return required.filter(r => !r.any.test(heads)).map(r => `Bo'lim yo'q: ${r.name}`);
}

/** Qolgan belgilar va til: noto'g'ri {{words:…}}, o'zbekcha (lotin) hujjatda kirill so'zlar */
export function textProblems(markdown: string, lang: Lang): string[] {
  const out: string[] = [];
  if (/\{\{/.test(markdown)) out.push("Noto'g'ri belgi qolgan: {{words:SUMMA}} faqat butun son bilan");
  if (lang === 'uz') {
    const cyr = markdown.match(/[Ѐ-ӿ]{3,}/g) ?? [];
    if (cyr.length > 2) out.push(`O'zbekcha (lotin) hujjatda kirill so'zlar bor: ${[...new Set(cyr)].slice(0, 5).join(', ')}`);
  }
  return out;
}

/** Hujjatdagi bo'sh joylar soni («________») — egasiga nima to'ldirish kerakligini aytish uchun */
export const blanks = (markdown: string): number => (markdown.match(/_{4,}/g) ?? []).length;

/** Model hujjatni ```markdown ichiga o'rab yuborsa — o'rami olib tashlanadi */
const unwrap = (s: string) => s.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();
const MISSING = /<!--\s*missing:\s*([\s\S]*?)-->/i;

/** Yozilgan hujjatni modeldan ajratish: o'ram va oxiridagi «missing» izohi (egasi nimani to'ldirishi kerak) */
export function parseDraft(raw: string): { markdown: string; missing: string[] } {
  const body = unwrap(raw);
  const m = MISSING.exec(body);
  const missing = m ? m[1].split(/[;\n]/).map(s => s.trim()).filter(s => s && !/^(none|yo'q|нет)$/i.test(s)) : [];
  return { markdown: body.replace(MISSING, '').trim(), missing };
}
