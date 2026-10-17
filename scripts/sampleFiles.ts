/**
 * Sinov va demo uchun hujjatlar: Word, Excel va PDF shu yerning o'zida yasaladi — omborda ikkilik fayl saqlanmaydi.
 */
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import { strToU8, zipSync } from 'fflate';

/** Word: bitta abzas va narxlar jadvali (tartib raqami ustuni bilan) */
export function docxFile(rows: [string, string][], intro = 'Narxlar 2026-yil uchun'): Promise<Buffer> {
  const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
  const table = new Table({ rows: [new TableRow({ children: [cell('№'), cell('Xizmat'), cell("Narx (so'm)")] }), ...rows.map(([name, price], i) => new TableRow({ children: [cell(String(i + 1)), cell(name), cell(price)] }))] });
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(intro), table] }] }));
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Excel: bitta varaq; satr — matn, son — son katagi */
export function xlsxFile(rows: (string | number)[][]): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => (typeof v === 'number' ? `<c r="${col(x)}${y + 1}"><v>${v}</v></c>` : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('')}</row>`).join('');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Narxlar" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`),
  }));
}

/** PDF: har sahifada berilgan qatorlar (lotin harflari); qatorlar bo'sh bo'lsa — matnsiz sahifa (skan kabi) */
export function pdfFile(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  const pagesId = pages.length * 2 + 2;
  for (const lines of pages) {
    const stream = lines.length ? `BT /F1 12 Tf 50 780 Td 16 TL ${lines.map(l => `(${l.replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ')} ET` : '';
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
