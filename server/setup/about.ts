/**
 * «Biznes haqida» sahifasi (ikkinchi miya): manzil, ish vaqti, telefon. Palantir mijozlarga shu sahifadan javob beradi.
 * Anketa va egasining javoblari shu yerga qator-qator yoziladi; egasining o'zi yozgan matniga tegilmaydi.
 */
import { ABOUT_TITLE, sameQuestion } from '../brain/logic';
import { COMMENT, vault } from '../brain/vault';

const entry = (bizId: string) => vault.list(bizId, 'page').find(k => sameQuestion(k.question, ABOUT_TITLE));

/** Sahifa matni; bo'sh namunadagi izoh (%% … %%) hisobga olinmaydi */
export function aboutBody(bizId: string): string {
  const body = entry(bizId)?.answer ?? '';
  return body.replace(COMMENT, '').trim() ? body.trim() : '';
}

export function writeAbout(bizId: string, body: string): void {
  const e = entry(bizId);
  if (e) vault.update(bizId, e.id, { answer: body.trim() });
  else vault.add(bizId, { kind: 'page', question: ABOUT_TITLE, answer: body.trim(), status: 'active', source: 'anketa' });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CONTACT_LINE = /^- [^:\n]{2,30}: /;

/** «- Manzil: …» qatori: bor bo'lsa — almashtiriladi, yo'q bo'lsa — boshqa aloqa qatorlari yoniga (yoki sahifa oxiriga) qo'shiladi */
export function setAboutLine(body: string, label: string, value: string): string {
  const line = `- ${label}: ${value.replace(/\s+/g, ' ').trim()}`;
  const same = new RegExp(`^- ${escapeRe(label)}:.*$`, 'm');
  if (same.test(body)) return body.replace(same, () => line);
  const lines = body ? body.split('\n') : [];
  const firstHeading = lines.findIndex(l => l.startsWith('## '));
  const top = firstHeading === -1 ? lines.length : firstHeading;
  let last = -1;
  for (let i = 0; i < top; i++) if (CONTACT_LINE.test(lines[i])) last = i;
  if (last !== -1) return [...lines.slice(0, last + 1), line, ...lines.slice(last + 1)].join('\n');
  if (!lines.length) return line;
  return [...lines.slice(0, top), ...(lines[top - 1]?.trim() ? [''] : []), line, ...(top < lines.length ? ['', ...lines.slice(top)] : [])].join('\n');
}

/** Bir nechta qatorni birdan yozadi (bo'sh qiymatlar o'tkazib yuboriladi) */
export function updateAbout(bizId: string, lines: [label: string, value: string][]): void {
  let body = aboutBody(bizId);
  for (const [label, value] of lines) if (value.trim()) body = setAboutLine(body, label, value);
  writeAbout(bizId, body);
}
