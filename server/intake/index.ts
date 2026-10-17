/**
 * Fayl qabul qilish: egasi suhbatga tashlagan hujjat o'qiladi, asli papkaning Manbalar/ bo'limiga, matni esa «Kutyapti»ga
 * sahifa taklifi bo'lib tushadi. Egasi bir tugma bilan hal qiladi: bilimga qo'shish, narxlarni jadvalga olish, hujjat namunasi
 * qilish yoki rad etish. Bu yo'lda model ishtirok etmaydi — fayl ichidagi matn hech kimga ko'rsatma bo'la olmaydi.
 */
import { MIN_FILE_PRICES, parsePrices, priceChanges, pricedCount, type PriceChanges } from '../../src/lib/prices';
import type { Knowledge } from '../../src/types';
import { FILE_SOURCE, QueueFullError, freeTitle, suggestPage } from '../brain/index';
import { LIMITS, PAGE_CHARS } from '../brain/logic';
import { removeSource, saveSource, type SourceExt } from '../brain/vault';
import { businesses, type BusinessRow } from '../db';
import { FileError, type FileKind } from './extract';
import { extractSafely } from './sandbox';

export { FileError, MAX_FILE_BYTES } from './extract';

/** Bir biznes kuniga shuncha fayl tashlay oladi (har biri diskda joy oladi va o'qishga vaqt ketadi) */
const MAX_FILES_PER_DAY = 40;
const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', text: 'matn' };

export interface Intake {
  /** «Kutyapti»dagi sahifa taklifi */
  suggestion: Knowledge;
  kind: FileKind;
  /** Fayldan o'qilgan matn uzunligi */
  chars: number;
  /** Matnning hammasi taklifga sig'madi */
  cut: boolean;
  /** Taklif matnida topilgan narxlar soni */
  prices: number;
  /** Shu nomli sahifa bor: tasdiqlansa, fayl shu yangi nom bilan alohida sahifa bo'ladi (eskisiga tegilmaydi). Bo'lmasa — null */
  renamed: string | null;
  /** Narxlar jadvalga olinsa nima o'zgaradi (egasi bosishdan oldin ko'rsin) */
  changes: PriceChanges;
  /** Suhbat tarixida ko'rinadigan nom: tozalangan sarlavha va tur (faylning asl nomi emas — u begona matn bo'lishi mumkin) */
  label: string;
}

/** Egasiga ko'rsatiladigan matn boshi: nimani tasdiqlayotganini ko'rsin */
const PREVIEW_CHARS = 600;
const CHANGES_SHOWN = 5;
const som = (n: number): string => n.toLocaleString('ru').replace(/\s/g, ' ');

const days = new Map<string, { day: string; count: number }>();
function countFile(bizId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const used = days.get(bizId)?.day === today ? days.get(bizId)!.count : 0;
  if (used >= MAX_FILES_PER_DAY) throw new FileError(`Bugun ${MAX_FILES_PER_DAY} ta fayl qabul qilindi — qolganini ertaga yuboring.`);
  days.set(bizId, { day: today, count: used + 1 });
}

/** Faylni o'qiydi va taklif qilib qo'yadi. O'qib bo'lmasa — FileError (xabari egasiga ko'rsatiladi) */
export async function takeFile(biz: BusinessRow, name: string, bytes: Buffer): Promise<Intake> {
  countFile(biz.id);
  const file = await extractSafely(name, bytes);
  if (file.scanned) throw new FileError("Bu PDF — skan (rasm): ichida matn qatlami yo'q. Sahifalarni rasm qilib yuboring — o'qib beraman.");
  // Matn fayli .txt (yoki .csv) bo'lib saqlanadi: .md ni Obsidian sahifa sifatida ochib, ichidagi rasm havolasi va HTML'ni yuklab olardi
  const ext: SourceExt = file.kind === 'text' ? (/\.csv$/i.test(name) ? 'csv' : 'txt') : file.kind;
  const source = saveSource(biz.id, file.title, ext, bytes);
  try {
    const suggestion = suggestPage(biz, file.title, file.text, `${FILE_SOURCE}${source}`);
    const title = freeTitle(biz, suggestion.question);
    return {
      suggestion, kind: file.kind, chars: file.text.length, cut: file.cut || file.text.length > LIMITS.sample, prices: pricedCount(suggestion.answer),
      renamed: title === suggestion.question ? null : title,
      changes: priceChanges((businesses.byId(biz.id) ?? biz).profile.offerings, parsePrices(suggestion.answer).items),
      label: `${suggestion.question}.${ext}`,
    };
  } catch (err) {
    // Taklif yozilmadi — faylning asli ham qolmaydi. Navbat to'lgani egasiga aytiladi; boshqa xato (disk, band fayl) yuqoriga chiqadi
    removeSource(biz.id, source);
    throw err instanceof QueueFullError ? new FileError(err.message) : err;
  }
}

/** Egasiga javob: nima o'qildi va endi nima qilish mumkin */
export function intakeText(i: Intake): string {
  const size = som(i.chars);
  const text = i.suggestion.answer;
  const head = text.length > PREVIEW_CHARS ? `${text.slice(0, text.lastIndexOf('\n', PREVIEW_CHARS) > PREVIEW_CHARS / 2 ? text.lastIndexOf('\n', PREVIEW_CHARS) : PREVIEW_CHARS).trimEnd()}\n…` : text;
  const changed = i.changes.changed.slice(0, CHANGES_SHOWN).map(c => `${c.name}: ${som(c.from)} → ${som(c.to)}`).join('; ');
  return [
    `📎 «${i.suggestion.question}» o'qildi (${KIND_LABEL[i.kind]}, ${size} belgi${i.cut ? ", uzun bo'lgani uchun boshi olindi" : ''}).`,
    i.prices >= MIN_FILE_PRICES ? `Ichida ${i.prices} ta narx topildi — ularni narxlar jadvaliga qo'sha olaman: ${i.changes.fresh} ta yangi xizmat${i.changes.changed.length ? `, ${i.changes.changed.length} tasining narxi o'zgaradi (${changed}${i.changes.changed.length > CHANGES_SHOWN ? '…' : ''})` : ''}.${i.cut ? ' Diqqat: fayl uzun, narxlarning faqat boshi o\'qildi — qolganini alohida fayl qilib yuboring.' : ''}` : '',
    i.renamed ? `Shu nomli sahifa allaqachon bor — bilimga qo'shsangiz, bu «${i.renamed}» nomi bilan alohida sahifa bo'ladi (eskisiga tegilmaydi).` : '',
    `Hozircha bu bilim emas: tasdig'ingizni kutyapti («Ikkinchi miya»). Bilimga qo'shsangiz, mijozlarga shu ma'lumotdan javob beraman${i.suggestion.answer.length > PAGE_CHARS ? ` (birinchi ${PAGE_CHARS} belgisidan)` : ''}.`,
    `\nFayl shunday boshlanadi (tasdiqlashdan oldin ko'zdan kechiring; to'liq matn — «Ikkinchi miya»da):\n${head}`,
  ].filter(Boolean).join('\n');
}
