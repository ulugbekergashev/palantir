/**
 * Fayl → matn. Egasi suhbatga tashlagan hujjat (narxnoma, shartnoma namunasi, yo'riqnoma) shu yerda o'qiladi.
 * Faqat matn olinadi: makros, formula va tashqi havola bajarilmaydi. Hajm, sahifa, varaq va qator chegaralangan.
 * Skan qilingan PDF'da matn qatlami yo'q: u `scanned` deb belgilanadi.
 * Bu funksiya serverda to'g'ridan-to'g'ri emas, sandbox.ts orqali chaqiriladi: og'ir fayl alohida oqimda o'qiladi va vaqtida to'xtatiladi.
 */
import { unzipSync, zipSync } from 'fflate';
import mammoth from 'mammoth';
import readExcelFile from 'read-excel-file/node';
import { getDocumentProxy } from 'unpdf';

export type FileKind = 'pdf' | 'docx' | 'xlsx' | 'text';
export interface Extracted {
  kind: FileKind;
  /** Fayl nomidan (kengaytmasiz) */
  title: string;
  text: string;
  /** Matn chegaradan oshgani uchun kesilgan */
  cut: boolean;
  /** PDF'da matn qatlami yo'q (skan yoki rasm) */
  scanned: boolean;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40_000;
/** .docx va .xlsx — ZIP: ichidagi fayllar soni va ochilgan jami hajmi bundan oshsa ochilmaydi (zip-bomba) */
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024, MAX_ZIP_ENTRIES = 2000;
const MAX_PAGES = 60, MAX_SHEETS = 5, MAX_ROWS = 2000;
/** Skan emas deb hisoblash uchun bir sahifada o'rtacha shuncha harf bo'lishi kerak */
const MIN_CHARS_PER_PAGE = 20;
const TITLE_CHARS = 80;

/** Egasiga ko'rsatiladigan sabab bilan */
export class FileError extends Error {}
const UNKNOWN = "Bu turdagi faylni o'qiy olmayman. PDF, Word (.docx), Excel (.xlsx) yoki matn (.txt, .csv) yuboring — eski .doc va .xls bo'lsa, yangi ko'rinishda saqlab yuboring.";
const BROKEN = "Faylni ochib bo'lmadi — buzilgan yoki parol bilan himoyalangan bo'lishi mumkin.";

const startsWith = (b: Buffer, sig: number[]): boolean => sig.every((byte, i) => b[i] === byte);
const utf16 = (b: Buffer): 'utf-16le' | 'utf-16be' | null => (startsWith(b, [0xff, 0xfe]) ? 'utf-16le' : startsWith(b, [0xfe, 0xff]) ? 'utf-16be' : null);

/** Fayl turi: kengaytmaga emas, avval mazmunning boshiga qaraladi (nomi .pdf bo'lgan boshqa narsa o'qilmaydi) */
export function kindOf(name: string, bytes: Buffer): FileKind | null {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1].toLowerCase() ?? '';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return ext === 'docx' ? 'docx' : ext === 'xlsx' ? 'xlsx' : null;
  // UTF-16 matnda nol baytlar bo'ladi — u boshidagi belgisidan (BOM) taniladi; qolgan holda nol bayt — ikkilik fayl
  return ['txt', 'md', 'csv'].includes(ext) && (utf16(bytes) !== null || !bytes.subarray(0, 8192).includes(0)) ? 'text' : null;
}

/**
 * .docx va .xlsx — ZIP. Arxiv ichidagi fayllar hajmi haqida yolg'on aytishi mumkin (kichik deb e'lon qilib, ochilganda gigabaytlar):
 * o'quvchi kutubxonalar bunga ishonib, xotirani to'ldirib qo'yadi. Shuning uchun arxiv avval shu yerda chegara bilan ochiladi
 * (fayllar soni va e'lon qilingan jami hajm cheklangan; chiqish e'lon qilingan hajmdan oshmaydi) va halol hajmlar bilan qayta yig'iladi —
 * kutubxonalarga faqat shu tozalangan nusxa beriladi.
 */
export function safeZip(bytes: Buffer): Buffer {
  let count = 0, total = 0;
  const files = unzipSync(new Uint8Array(bytes), {
    filter: file => {
      count += 1;
      total += file.originalSize;
      if (count > MAX_ZIP_ENTRIES || total > MAX_UNZIPPED_BYTES) throw new FileError(BROKEN);
      return true;
    },
  });
  return Buffer.from(zipSync(files, { level: 0 }));
}

const cellText = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim());
/** Jadval qatori → «nom — qiymat»: narxnoma shu ko'rinishda narx o'quvchiga (prices.ts) tushunarli. Boshidagi tartib raqami tashlanadi */
function rowLine(cells: unknown[]): string {
  const all = cells.map(cellText).filter(Boolean);
  const shown = all.length > 2 && /^\d{1,3}[.)]?$/.test(all[0]) ? all.slice(1) : all;
  // Narx oxirgi ustunda bo'lmasa («Xizmat | Narx | Birlik») — oxiriga suriladi: narx o'quvchi qatordagi oxirgi sonni oladi
  const priceAt = shown.findLastIndex(c => PRICE_CELL.test(c));
  const ordered = priceAt >= 0 && priceAt < shown.length - 1 && shown.slice(priceAt + 1).every(c => !/\d/.test(c)) ? [...shown.slice(0, priceAt), ...shown.slice(priceAt + 1), shown[priceAt]] : shown;
  return ordered.join(' — ');
}
/** Faqat narxdan iborat katak: «350 000», «4,5 mln», «250000 so'm» */
const PRICE_CELL = /^\d[\d\s.,]*(?:ming|mln|so'm|sum|сум|uzs)?\.?$/i;

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
/** mammoth bergan HTML → oddiy matn: jadval qatori bitta qatorga, ro'yxat «- » bilan */
function htmlToText(html: string): string {
  return html
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => `${rowLine([...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g, ' ')))}\n`)
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|li|h[1-6]|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ENTITY[e]);
}

async function docxText(bytes: Buffer): Promise<string> {
  // Rasmlar matnga kerak emas: HTML ichiga joylanmaydi (aks holda bitta surat megabaytlab satr bo'lib ketadi)
  const { value } = await mammoth.convertToHtml({ buffer: bytes }, { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) });
  return htmlToText(value);
}

interface Read { text: string; /** Chegaradan oshgan varaq, qator yoki sahifa tashlab ketildi */ more: boolean; scanned?: boolean }

async function xlsxText(bytes: Buffer): Promise<Read> {
  const book = await readExcelFile(bytes);
  const sheets = book.slice(0, MAX_SHEETS);
  const text = sheets.map(s => {
    const lines = s.data.slice(0, MAX_ROWS).map(rowLine).filter(Boolean);
    return [...(sheets.length > 1 ? [`## ${cellText(s.sheet)}`] : []), ...lines].join('\n');
  }).filter(Boolean).join('\n\n');
  return { text, more: book.length > MAX_SHEETS || sheets.some(s => s.data.length > MAX_ROWS) };
}

async function pdfText(bytes: Buffer): Promise<Read> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    // Faqat kerakli sahifalar o'qiladi. Kutubxonaning tayyor funksiyasi hamma sahifani oladi: 20 000 sahifali (1,5 MB) fayl serverni daqiqalab band qilardi
    const count = Math.min(pdf.numPages, MAX_PAGES);
    const pages: string[] = [];
    for (let n = 1; n <= count; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
    }
    const joined = pages.join('\n\n');
    return { text: joined, more: pdf.numPages > MAX_PAGES, scanned: joined.replace(/\s/g, '').length < count * MIN_CHARS_PER_PAGE };
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

/**
 * Matn fayli: UTF-8 (odatdagi), UTF-16 (boshidagi belgisidan taniladi) yoki — UTF-8 sifatida o'qib bo'lmasa — Windows-1251:
 * Excel'dan «CSV» qilib saqlangan ruscha va kirillcha narxnomalar shu ko'rinishda keladi.
 */
function plainText(bytes: Buffer): string {
  const wide = utf16(bytes);
  let text: string;
  if (wide) text = new TextDecoder(wide).decode(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1251').decode(bytes); }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Ko'rinmas va boshqaruv belgilarisiz, ortiqcha bo'sh joysiz (qator uzilishlari saqlanadi) */
const tidy = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/[\p{Cc}\p{Cf}]/gu, c => (c === '\n' ? c : ' ')).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export const titleOf = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_CHARS) || 'Fayl';

/** Faylni o'qiydi. O'qib bo'lmasa — FileError (xabari egasiga ko'rsatiladi). Serverda sandbox.ts orqali chaqiriladi */
export async function extract(name: string, bytes: Buffer): Promise<Extracted> {
  if (!bytes.length) throw new FileError("Fayl bo'sh.");
  if (bytes.length > MAX_FILE_BYTES) throw new FileError(`Fayl ${MAX_FILE_BYTES / 1024 / 1024} MB dan katta — kichikroq qilib yuboring.`);
  const kind = kindOf(name, bytes);
  if (!kind) throw new FileError(UNKNOWN);
  let read: Read;
  try {
    read = kind === 'pdf' ? await pdfText(bytes) : kind === 'xlsx' ? await xlsxText(safeZip(bytes)) : { text: kind === 'docx' ? await docxText(safeZip(bytes)) : plainText(bytes), more: false };
  } catch (err) {
    if (err instanceof FileError) throw err;
    throw new FileError(BROKEN);
  }
  const text = tidy(read.text), scanned = read.scanned ?? false;
  if (!text && !scanned) throw new FileError('Faylda matn topilmadi.');
  return { kind, title: titleOf(name), text: text.slice(0, MAX_TEXT_CHARS), cut: read.more || text.length > MAX_TEXT_CHARS, scanned };
}
