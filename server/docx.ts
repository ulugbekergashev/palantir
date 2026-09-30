/**
 * Yordamchi yozgan hujjat (markdown) → Word fayli (.docx).
 * Qo'llanadigan belgilar: # sarlavhalar, ro'yxatlar (- va 1.), **qalin**, *qiya*,
 * jadval (| a | b |) va chiziq (---). Qolgani oddiy matn bo'lib chiqadi.
 */
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Business } from '../src/types';

/** **qalin** va *qiya* bo'laklarga ajratadi */
function runs(text: string, base: { bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    out.push(t.startsWith('**') ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function table(rows: string[][]): Table {
  const cols = Math.max(...rows.map(r => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: Array.from({ length: cols }, (_, c) => new TableCell({
        shading: i === 0 ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(r[c] ?? '', { bold: i === 0 }) })],
      })),
    })),
  });
}

export async function markdownToDocx(title: string, markdown: string, biz: Business): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let numbered = 0;
  let inNumbered = false;
  // Hujjat boshida sarlavha bo'lmasa — nomi qo'yiladi
  if (!/^#\s/.test(lines.find(l => l.trim()) ?? '')) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const num = /^(\d+)[.)]\s+(.*)$/.exec(t);
    if (!num) inNumbered = false;
    if (!t) continue;

    // Jadval: sarlavha qatori + ajratuvchi
    if (t.startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const rows = [cells(t)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      children.push(table(rows), new Paragraph({ children: [] }));
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1].length;
      children.push(new Paragraph({
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 120 },
        children: [new TextRun(h[2].replace(/\*\*/g, ''))],
      }));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, children: [] }));
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(t);
    if (bullet) {
      const level = Math.min(2, Math.floor((line.length - line.trimStart().length) / 2));
      children.push(new Paragraph({ bullet: { level }, children: runs(bullet[1]) }));
      continue;
    }
    if (num) {
      if (!inNumbered) { numbered++; inNumbered = true; }
      children.push(new Paragraph({ numbering: { reference: 'num', level: 0, instance: numbered }, children: runs(num[2]) }));
      continue;
    }
    children.push(new Paragraph({ spacing: { after: 120 }, children: runs(t) }));
  }

  const doc = new Document({
    creator: biz.name,
    title,
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    numbering: {
      config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 320 } } } }] }],
    },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

/** Fayl nomi: harf, raqam va chiziqcha (kirill ham qoladi — yuklashda UTF-8 bilan beriladi) */
export function docFileName(title: string): string {
  const base = title.replace(/[‘’ʻʼ`']/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'hujjat'}.docx`;
}
