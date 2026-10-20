/**
 * Hujjat (markdown) → Word fayli (.docx), hujjat turiga mos ko'rinishda:
 *   rasmiy (shartnoma, dalolatnoma, hisob-varaq, xat) — Times New Roman 12, sarlavhalar markazda, bandlar ikki chetga tekislangan,
 *     rekvizitlar va imzolar — chegarasiz ikki ustun;
 *   brend (tijorat taklifi, narxlar) — ish blanki (logo, nom, aloqa), brend rangidagi sarlavha va jadval boshi;
 *   oddiy (reja, hisobot va boshqalar) — toza Arial.
 * Har sahifa pastida «1 / 3». Belgilar: # sarlavhalar, ro'yxatlar (- va 1.), **qalin**, *qiya*, jadval (| a | b |), chiziq (---),
 * iqtibos (> — ajratilgan blok), ikki ustunli qator [[chap | o'ng]] (shahar va sana). HTML izohlar (<!-- -->) chiqmaydi.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import type { Business } from '../src/types';

type Family = 'formal' | 'brand' | 'plain';
const FAMILY: Record<string, Family> = { contract: 'formal', act: 'formal', invoice: 'formal', letter: 'formal', offer: 'brand', price_list: 'brand' };
interface Look { family: Family; font: string; size: number; color: string; muted: string }

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
/** Sarlavhalari shu so'zlar bo'lgan jadval — tomonlar rekvizitlari va imzolari (chegarasiz) */
const PARTIES = /ijrochi|buyurtmachi|yetkazib beruvchi|sotuvchi|xaridor|ijaraga|ijarachi|pudratchi|ish beruvchi|xodim|исполнитель|заказчик|поставщик|покупатель|арендодатель|арендатор|подрядчик|работодатель|работник/i;
const TOTAL = /jami|hammasi|итого|всего/i;
const isNumberCell = (s: string) => /^\**\s*[\d\s .,]+\s*(so['‘’ʻ]?m|сум|%|uzs)?\s*\**$/i.test(s.trim()) && /\d/.test(s);

/** **qalin** va *qiya* bo'laklarga ajratadi */
function runs(text: string, base: { bold?: boolean; color?: string; size?: number } = {}): TextRun[] {
  const out: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    out.push(t.startsWith('**') ? new TextRun({ text: t.slice(2, -2), ...base, bold: true }) : new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const hex = (c: string) => c.replace('#', '').toUpperCase();

function table(rows: string[][], look: Look, brand: string, parties: boolean): Table {
  const cols = Math.max(...rows.map(r => r.length));
  const line = { style: BorderStyle.SINGLE, size: 4, color: look.family === 'formal' ? '808080' : 'CBD5E1' };
  const headFill = look.family === 'brand' ? brand : look.family === 'formal' ? 'F2F2F2' : 'F1F5F9';
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: parties ? NO_BORDERS : { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: rows.map((r, i) => {
      const head = i === 0, total = !head && TOTAL.test(r.join(' '));
      return new TableRow({
        tableHeader: head && !parties,
        children: Array.from({ length: cols }, (_, c) => {
          const text = r[c] ?? '';
          const right = !head && !parties && isNumberCell(text);
          return new TableCell({
            verticalAlign: parties ? VerticalAlign.TOP : VerticalAlign.CENTER,
            shading: head && !parties ? { type: ShadingType.CLEAR, fill: headFill, color: 'auto' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: runs(text, { bold: head || total, ...(head && look.family === 'brand' && !parties ? { color: 'FFFFFF' } : {}) }),
            })],
          });
        }),
      });
    }),
  });
}

/** [[chap | o'ng]] — chegarasiz ikki ustun: chap tomonga va o'ng tomonga tekislangan */
function twoColumns(left: string, right: string): Table {
  const cell = (text: string, alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) => new TableCell({ children: [new Paragraph({ alignment, children: runs(text) })] });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows: [new TableRow({ children: [cell(left, AlignmentType.LEFT), cell(right, AlignmentType.RIGHT)] })] });
}

/** Logo (PNG/JPEG data URL) va o'lchami — sarlavhada 44 px balandlikda; boshqa format yoki buzilgan bo'lsa — logosiz */
function logoRun(dataUrl: string | undefined): ImageRun | null {
  const m = dataUrl ? /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl) : null;
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  let w = 0, h = 0;
  if (m[1] === 'png' && data.length > 24) { w = data.readUInt32BE(16); h = data.readUInt32BE(20); }
  if (m[1] === 'jpeg') {
    for (let i = 2; i + 9 < data.length;) {
      if (data[i] !== 0xff) break;
      const marker = data[i + 1], len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) { h = data.readUInt16BE(i + 5); w = data.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
  }
  if (!w || !h) return null;
  const height = 44;
  return new ImageRun({ type: m[1] === 'png' ? 'png' : 'jpg', data, transformation: { width: Math.round((w / h) * height), height } });
}

/** Ish blanki: logo, nom (brend rangida), aloqa satri va ostidan chiziq */
function letterhead(biz: Business, look: Look, brand: string): Header {
  const logo = logoRun(biz.brand.logo);
  const contacts = [biz.address, biz.phone, biz.website].filter(Boolean).join('  ·  ');
  return new Header({
    children: [
      new Paragraph({ children: [...(logo ? [logo, new TextRun('  ')] : []), new TextRun({ text: biz.name, bold: true, size: 28, color: brand, font: look.font })] }),
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: brand, space: 4 } },
        spacing: { after: 120 },
        children: [new TextRun({ text: contacts, size: 16, color: look.muted, font: look.font })],
      }),
    ],
  });
}

const pageFooter = (look: Look, note: string) => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [...(note ? [`${note}   ·   `] : []), PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: look.muted, font: look.font })],
  })],
});

export async function markdownToDocx(title: string, markdown: string, biz: Business, kind = 'other'): Promise<Buffer> {
  const family = FAMILY[kind] ?? 'plain';
  const look: Look = family === 'formal'
    ? { family, font: 'Times New Roman', size: 24, color: '000000', muted: '666666' }
    : { family, font: 'Arial', size: family === 'brand' ? 21 : 22, color: '1F2937', muted: '6B7280' };
  const brand = hex(biz.brand.primary || '#4F46E5');
  const children: (Paragraph | Table)[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let numbered = 0;
  let inNumbered = false;
  /** Oxirgi bo'lim sarlavhasi — rekvizitlar bo'limidagi jadval chegarasiz chiqadi */
  let section = '';
  // Hujjat boshida sarlavha bo'lmasa — nomi qo'yiladi
  const titlePara = (text: string) => new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: family === 'formal' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: family === 'brand' ? 80 : 200 },
    border: family === 'brand' ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: brand, space: 6 } } : undefined,
    children: [new TextRun({ text: family === 'formal' ? text.toUpperCase() : text, bold: true, size: family === 'formal' ? 28 : family === 'brand' ? 40 : 34, color: family === 'brand' ? brand : look.color, font: look.font })],
  });
  if (!/^#\s/.test(lines.find(l => l.trim()) ?? '')) children.push(titlePara(title));

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
      const parties = PARTIES.test(rows[0].join(' ')) || /rekvizit|реквизит|imzo|подпис/i.test(section);
      children.push(table(rows, look, brand, parties), new Paragraph({ children: [] }));
      continue;
    }
    const two = /^\[\[(.+?)\|(.+?)\]\]$/.exec(t);
    if (two) {
      children.push(twoColumns(two[1].trim(), two[2].trim()), new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1].length, text = h[2].replace(/\*\*/g, '');
      if (level === 1) { children.push(titlePara(text)); continue; }
      section = text;
      children.push(new Paragraph({
        heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        alignment: family === 'formal' && level === 2 ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 240, after: 120 },
        keepNext: true,
        children: [new TextRun({ text, bold: true, size: level === 2 ? (family === 'brand' ? 26 : 24) : 22, color: family === 'brand' ? brand : look.color, font: look.font })],
      }));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, children: [] }));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(t);
    if (quote) {
      children.push(new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: 'F5F7FB', color: 'auto' },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: brand, space: 8 } },
        spacing: { before: 60, after: 60 },
        indent: { left: 160 },
        children: runs(quote[1]),
      }));
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(t);
    if (bullet) {
      const level = Math.min(2, Math.floor((line.length - line.trimStart().length) / 2));
      children.push(new Paragraph({ bullet: { level }, alignment: family === 'formal' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, children: runs(bullet[1]) }));
      continue;
    }
    if (num) {
      if (!inNumbered) { numbered++; inNumbered = true; }
      children.push(new Paragraph({ numbering: { reference: 'num', level: 0, instance: numbered }, alignment: family === 'formal' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, children: runs(num[2]) }));
      continue;
    }
    children.push(new Paragraph({ spacing: { after: family === 'formal' ? 80 : 120 }, alignment: family === 'formal' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, children: runs(t) }));
  }

  const doc = new Document({
    creator: biz.name,
    title,
    styles: {
      default: { document: { run: { font: look.font, size: look.size, color: look.color }, paragraph: { spacing: { line: 276 } } } },
    },
    numbering: {
      config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 320 } } } }] }],
    },
    sections: [{
      properties: { page: { margin: { top: family === 'brand' ? 1300 : 1134, bottom: 1134, left: family === 'formal' ? 1418 : 1134, right: family === 'formal' ? 851 : 1134 } } },
      headers: family === 'brand' || kind === 'invoice' || kind === 'letter' ? { default: letterhead(biz, look, brand) } : undefined,
      footers: { default: pageFooter(look, family === 'brand' ? [biz.phone, biz.website].filter(Boolean).join('  ·  ') : '') },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

/** Fayl nomi: harf, raqam va chiziqcha (kirill ham qoladi — yuklashda UTF-8 bilan beriladi) */
export function docFileName(title: string): string {
  const base = title.replace(/[‘’ʻʼ`']/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'hujjat'}.docx`;
}
