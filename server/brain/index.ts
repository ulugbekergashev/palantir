/**
 * Ikkinchi miya: Palantir biznes haqida bilgan narsalar va ular qayerdan keladi.
 * Yozilish yo'llari: egasi o'zi yozadi (panel, tayyor savollar), mijozga bergan javobini «eslab qol» deydi (taklif → tasdiq),
 * tayyor javobni tuzatib yuboradi (tuzatish), yoki papkadagi faylni Obsidian'da o'zgartiradi. Hammasi fayllarda turadi (vault.ts).
 */
import { packFor } from '../../src/data/industries';
import { check, isMedical } from '../../src/lib/compliance';
import { mergeOfferings, parsePrices, type PriceLine } from '../../src/lib/prices';
import type { BrainView, Knowledge } from '../../src/types';
import { crmConnected } from '../crm/index';
import { businesses, newId, type BusinessRow } from '../db';
import { LIMITS, approvedAnswers, brainPrompt, fitPages, inert, packView, plain, sameQuestion } from './logic';
import { FILE_SOURCE, facts as notes, refresh, removeSource, style, vault as knowledge, vaultPath } from './vault';
import { orders } from '../orders/store';

export { FILE_SOURCE } from './vault';

/** Egasining tasdig'ini kutayotgan javoblar bundan oshmaydi (javob bermasa, ro'yxat cheksiz o'smasin) */
const MAX_SUGGESTED = 20;
/** Javob berilmagan taklif shuncha kundan keyin o'chadi */
const SUGGESTION_DAYS = 14;
const line = plain;
const body = (s: string, max: number): string => s.trim().slice(0, max);
const pricedLines = (text: string) => parsePrices(text).items.filter(i => i.price > 0);
/** Matnni chegaragacha qisqartiradi, lekin qator o'rtasidan emas: «Implant — 4 500 000» yarmida uzilib, narx «4 500» bo'lib qolmasin */
function cutAtLine(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const at = head.lastIndexOf('\n');
  return (at > max / 2 ? head.slice(0, at) : head).trimEnd();
}

/** Tasdiq kutayotganlar to'lgan — egasi avval ularni hal qilishi kerak */
export class QueueFullError extends Error {}

export interface PriceImport { added: number; updated: number; dropped: number; free: number }
/**
 * Narxlarni jadvalga qo'shadi: nomi bir xil xizmatning narxi yangilanadi, qolgani qo'shiladi (dropped — jadvalga sig'maganlar).
 * Bepul xizmat (narxi 0) fakt bo'lib saqlanadi: profilda 0 «berilmagan» degani, model esa «bepul» deb ayta olishi kerak.
 */
export function importPrices(biz: BusinessRow, items: PriceLine[]): PriceImport {
  const fresh = businesses.byId(biz.id) ?? biz;
  const merged = mergeOfferings(fresh.profile.offerings, items.filter(i => i.price > 0), () => newId(8));
  businesses.update(biz.id, { profile: { ...fresh.profile, offerings: merged.offerings } });
  refresh(biz.id);
  const known = new Set(notes.list(biz.id).map(n => n.text));
  const free = [...new Set(items.filter(i => i.price === 0).map(i => `${i.name} — bepul`))].filter(t => !known.has(t));
  for (const fact of free) notes.add(biz.id, fact);
  return { added: merged.added, updated: merged.updated, dropped: merged.dropped, free: free.length };
}

export const packOf = (biz: BusinessRow) => packFor(biz.profile.industry, crmConnected(biz.id));

/**
 * Reklama filtri sozlamasi. Mijozga ketadigan javob (inbox/core.ts), paneldagi ogohlantirish va ovozli agent bilimi — hammasi shuni
 * ishlatadi, shunda uchalasi bir-biridan ajralib ketmaydi. DentaCRM ulangan biznes — sohasi qanday yozilgan bo'lishidan qat'i nazar klinika.
 */
export const filterOptions = (biz: BusinessRow): { medical: boolean } => ({ medical: isMedical(biz.profile.industry) || crmConnected(biz.id) });

/**
 * Bilimdagi matnda reklama filtri ushlaydigan so'z bo'lsa («kafolat», «og'riqsiz»…), egasi buni bilishi kerak. Filtr bilimni emas,
 * Palantir yozgan javobni tekshiradi: javobda shu so'z chiqsa, xabar o'zi ketmaydi — tasdiqqa keladi («o'rgatdim, lekin baribir
 * mendan so'rayapti»). Telefonda tasdiqlatib bo'lmaydi, shuning uchun bunday bilim ovozli agentga berilmaydi (knowledgeText).
 */
export function filterWarning(text: string, opts: { medical: boolean }): string | undefined {
  const issue = check(text, opts)[0];
  return issue ? `«${issue.phrase}» — reklama filtri ushlaydigan so'z (${issue.why.toLowerCase()}). Palantir javobida shu so'z chiqsa, xabar mijozga o'zi ketmaydi — sizga tasdiqqa keladi; telefonda esa bu aytilmaydi. Maslahat: ${issue.hint}.` : undefined;
}

export function brainView(biz: BusinessRow): BrainView {
  // Mundarija egasi Obsidian'da qo'shgan va o'chirgan fayllarni ham aks ettirsin
  refresh(biz.id);
  const all = knowledge.list(biz.id);
  const opts = filterOptions(biz);
  const warned = (k: Knowledge): Knowledge => { const warning = filterWarning(k.answer, opts); return warning ? { ...k, warning } : k; };
  const qa = all.filter(k => k.kind === 'qa').map(warned);
  const pack = packView(packOf(biz), qa);
  const inPack = new Set(pack.flatMap(q => (q.answer ? [q.answer.id] : [])));
  return {
    facts: notes.list(biz.id),
    qa: qa.filter(k => k.status === 'active' && !inPack.has(k.id)),
    // Fayldan kelgan sahifa takliflari ham shu ro'yxatda: narxi bo'lsa — «narxlar jadvaliga» taklif qilinadi
    suggested: [...qa.filter(k => k.status === 'suggested'), ...all.filter(k => k.kind === 'page' && k.status === 'suggested').map(k => ({ ...warned(k), prices: pricedLines(k.answer).length }))],
    fixes: all.filter(k => k.kind === 'fix'),
    samples: all.filter(k => k.kind === 'sample'),
    pages: all.filter(k => k.kind === 'page' && k.status === 'active').map(k => ({ ...warned(k), answer: k.answer.slice(0, 300) })),
    pagesLeftOut: fitPages(all).left,
    vault: vaultPath(biz.id),
    style: style.get(biz.id),
    pack,
    prices: biz.profile.offerings.map(o => ({ id: o.id, name: o.name, price: o.price })),
    priced: biz.profile.offerings.filter(o => o.price > 0).length,
    offerings: biz.profile.offerings.length,
  };
}

/** Mijozlarga javob beradigan modelga qo'shiladigan bilim (bo'lmasa — bo'sh satr) */
export function replierBrain(biz: BusinessRow): string {
  // Papka bir marta o'qiladi (har mijoz xabarida chaqiriladi)
  const all = knowledge.list(biz.id);
  const of = (kind: Knowledge['kind']) => all.filter(k => k.kind === kind);
  const rules = orders.standing(biz.id, 'qabulxona');
  return [
    brainPrompt({ qa: of('qa'), fixes: of('fix'), pages: of('page'), style: style.get(biz.id) }),
    rules.length ? `<owner_standing_orders>\nThe owner's standing orders for answering customers — always follow them:\n${rules.map(r => `- ${r}`).join('\n')}\n</owner_standing_orders>` : '',
  ].filter(Boolean).join('\n\n');
}

/** Egasi yozgan javob. Shu savol (yoki shu tayyor savol) avval bo'lsa — javobi yangilanadi, takror yozuv bo'lmaydi */
export function saveAnswer(biz: BusinessRow, question: string, answer: string, source: string): Knowledge {
  const q = line(question, LIMITS.question), a = body(answer, LIMITS.answer);
  const active = knowledge.list(biz.id, 'qa').filter(k => k.status === 'active');
  const old = active.find(k => (source.startsWith('pack:') && k.source === source) || sameQuestion(k.question, q));
  if (old) return knowledge.update(biz.id, old.id, { question: q, answer: a })!;
  if (active.length >= LIMITS.qa) throw new Error(`Savol-javoblar ${LIMITS.qa} tadan oshmaydi — keraksizini o'chiring`);
  return knowledge.add(biz.id, { kind: 'qa', question: q, answer: a, status: 'active', source });
}

/**
 * Egasi mijozning savoliga javob berdi. Bu hali bilim emas — taklif: javob shu mijozning o'ziga atalgan bo'lishi mumkin
 * («sizga 20% qilaman»). Egasi «eslab qol» desa bilimga aylanadi. Qaytgan yozuv — egasidan so'raladigan taklif; null — so'rash shart emas.
 */
export function suggestAnswer(biz: BusinessRow, question: string, answer: string): Knowledge | null {
  // Savol mijozning gapidan olingan — faylga zararsiz ko'rinishda tushadi
  const q = inert(line(question, LIMITS.question)), a = line(answer, LIMITS.answer);
  if (q.length < 3 || !a) return null;
  knowledge.expireSuggested(biz.id, new Date(Date.now() - SUGGESTION_DAYS * 86_400_000).toISOString());
  const qa = knowledge.list(biz.id, 'qa');
  // Aynan shu javob allaqachon bilimda — so'ralmaydi
  if (qa.some(k => k.status === 'active' && sameQuestion(k.question, q) && sameQuestion(k.answer, a))) return null;
  // Shu savol bo'yicha eski taklif kutib turgan bo'lsa — o'rniga yangisi (eski xabardagi tugmalar eskiradi: ko'rsatilgan javob bilan saqlanadigani bir xil bo'lsin)
  const waiting = qa.filter(k => k.status === 'suggested');
  for (const old of waiting.filter(k => sameQuestion(k.question, q))) knowledge.remove(biz.id, old.id);
  if (waiting.filter(k => !sameQuestion(k.question, q)).length >= MAX_SUGGESTED) return null;
  return knowledge.add(biz.id, { kind: 'qa', question: q, answer: a, status: 'suggested', source: 'relay' });
}

/** Egasi «eslab qol» dedi. Shu savolning eski javobi bo'lsa — o'sha yangilanadi (tayyor savolga bog'lanishi saqlanadi) */
export function confirmSuggestion(biz: BusinessRow, id: string): Knowledge | null {
  const s = knowledge.get(biz.id, id);
  if (!s || s.kind === 'sample') return null;
  if (s.status === 'active') return s;
  // Tuzatish: egasi «o'rgan» dedi
  if (s.kind === 'fix') return knowledge.update(biz.id, id, { status: 'active' });
  if (s.kind === 'page') {
    // Shu nomli sahifa bor bo'lsa (masalan, egasining «Biznes haqida»si) — ustidan yozilmaydi: fayl o'z nomi bilan, raqam qo'shilib alohida sahifa bo'ladi
    return knowledge.update(biz.id, id, { status: 'active', question: freeTitle(biz, s.question) });
  }
  const old = knowledge.list(biz.id, 'qa').find(k => k.status === 'active' && sameQuestion(k.question, s.question));
  if (!old) return knowledge.update(biz.id, id, { status: 'active' });
  // Avval javob yoziladi, keyin taklif o'chiriladi: yozish muvaffaqiyatsiz bo'lsa, taklif yo'qolib qolmaydi
  const merged = knowledge.update(biz.id, old.id, { answer: s.answer });
  knowledge.remove(biz.id, id);
  return merged;
}

/**
 * Egasi tayyor javobni o'zgartirib yubordi: juftlik taklif bo'lib saqlanadi. Unda shu mijozning ismi yoki unga berilgan va'da bo'lishi mumkin —
 * egasi panelda «O'rgan» demaguncha modelga berilmaydi.
 */
export function recordFix(biz: BusinessRow, draft: string, sent: string): void {
  // Qoralamani model mijoz bilan suhbatdan yozgan — faylga zararsiz ko'rinishda tushadi
  const d = inert(body(draft, LIMITS.answer)), s = body(sent, LIMITS.answer);
  if (!d || !s || sameQuestion(d, s)) return;
  knowledge.add(biz.id, { kind: 'fix', question: d, answer: s, status: 'suggested', source: 'edit' });
  knowledge.trim(biz.id, 'fix', LIMITS.fixes);
}

/**
 * Egasi tashlagan fayl matni — sahifa taklifi: egasi tasdiqlamaguncha hech qaysi modelga berilmaydi.
 * Shu nomli eski taklif bo'lsa — o'rniga yangisi (fayl qayta tashlangan).
 */
export function suggestPage(biz: BusinessRow, title: string, text: string, source: string): Knowledge {
  // Sarlavha fayl nomidan olinadi (begona matn bo'lishi mumkin) — sahifa boshiga zararsiz ko'rinishda yoziladi
  const t = inert(line(title, LIMITS.title)) || 'Fayl';
  knowledge.expireSuggested(biz.id, new Date(Date.now() - SUGGESTION_DAYS * 86_400_000).toISOString());
  // Navbat: savol-javob va fayl takliflari (tuzatishlar o'z chegarasida — ular fayl tashlashni to'sib qo'ymaydi)
  const waiting = knowledge.list(biz.id).filter(k => k.status === 'suggested' && k.kind !== 'fix');
  const same = (k: Knowledge) => k.kind === 'page' && sameQuestion(k.question, t);
  if (waiting.filter(k => !same(k)).length >= MAX_SUGGESTED) throw new QueueFullError(`Tasdig'ingizni kutayotgan narsalar ${MAX_SUGGESTED} taga yetdi — avval «Ikkinchi miya»da ularni hal qiling.`);
  for (const old of waiting.filter(same)) dropSuggestion(biz, old.id);
  return knowledge.add(biz.id, { kind: 'page', question: t, answer: inert(cutAtLine(text, LIMITS.sample)), status: 'suggested', source });
}

/** Faol sahifalar orasida band bo'lmagan nom: «Qoidalar» band bo'lsa — «Qoidalar (2)» */
export function freeTitle(biz: BusinessRow, title: string): string {
  const taken = knowledge.list(biz.id, 'page').filter(k => k.status === 'active').map(k => k.question);
  const free = (t: string) => !taken.some(q => sameQuestion(q, t));
  for (let n = 1; n < 100; n++) { const t = n === 1 ? title : `${title} (${n})`; if (free(t)) return t; }
  return `${title} (${newId(4)})`;
}

/** Yozuv o'chiriladi. Fayldan kelgan taklif rad etilgan bo'lsa, faylning asli ham o'chadi (egasi «kerak emas» dedi) */
export function dropSuggestion(biz: BusinessRow, id: string): boolean {
  const s = knowledge.get(biz.id, id);
  if (!s || !knowledge.remove(biz.id, id)) return false;
  if (s.status === 'suggested' && s.source.startsWith(FILE_SOURCE)) removeSource(biz.id, s.source.slice(FILE_SOURCE.length));
  return true;
}

const fileSuggestion = (biz: BusinessRow, id: string): Knowledge | null => {
  const s = knowledge.get(biz.id, id);
  return s && s.kind === 'page' && s.status === 'suggested' ? s : null;
};

/**
 * Fayldan kelgan taklifdagi narxlar jadvalga qo'shiladi. Narxlar matndan qoida bilan o'qiladi (model ishtirokisiz), shuning uchun
 * fayl ichidagi gap ko'rsatma bo'la olmaydi. Taklifning o'zi o'chadi (narxlar endi jadvalda), faylning asli Manbalar'da qoladi.
 */
export function pricesFromSuggestion(biz: BusinessRow, id: string): PriceImport | null {
  const s = fileSuggestion(biz, id);
  const items = s ? parsePrices(s.answer).items : [];
  if (!s || !items.some(i => i.price > 0)) return null;
  const result = importPrices(biz, items);
  // Hammasi sig'di — taklif yopiladi (narxlar endi jadvalda). Sig'magani bo'lsa qoladi: egasi joy ochib, yana bosadi
  if (!result.dropped) knowledge.remove(biz.id, id);
  return result;
}

/** Fayldan kelgan taklif — hujjat namunasi: yordamchi shu turdagi hujjatni yozishdan oldin unga qaraydi. Mijozlarga javobda ishlatilmaydi */
export function sampleFromSuggestion(biz: BusinessRow, id: string): Knowledge | null {
  const s = fileSuggestion(biz, id);
  if (!s) return null;
  const sample = addSample(biz, s.question, s.answer);
  knowledge.remove(biz.id, id);
  return sample;
}

export function addSample(biz: BusinessRow, title: string, text: string): Knowledge {
  if (knowledge.list(biz.id, 'sample').length >= LIMITS.samples) throw new Error(`Namunalar ${LIMITS.samples} tadan oshmaydi — keraksizini o'chiring`);
  return knowledge.add(biz.id, { kind: 'sample', question: line(title, LIMITS.title), answer: body(text, LIMITS.sample), status: 'active', source: 'owner' });
}

/** Ovozli agent uchun: biznes haqida mijozga aytsa bo'ladigan hamma narsa bitta matnda */
export function knowledgeText(biz: BusinessRow): string {
  const p = biz.profile;
  // Yozishmada filtr ushlagan javob egasiga tasdiqqa boradi; telefonda bunday yo'l yo'q — shuning uchun filtr ushlaydigan
  // javob, fakt va xizmat nomi agentga umuman berilmaydi, sahifadan esa faqat o'sha qator olib tashlanadi (manzil va ish vaqti qolsin).
  // Matn agentga qanday ko'rinishda ketsa (plain: ko'rinmas belgilar va qator uzilishlarisiz), shu ko'rinishda tekshiriladi
  const opts = filterOptions(biz);
  const sayable = (text: string) => check(plain(text, 100_000), opts).length === 0;
  const priced = p.offerings.filter(o => o.price > 0 && sayable(o.name));
  const all = knowledge.list(biz.id).flatMap(k => (k.kind === 'page' ? (sayable(k.question) ? [{ ...k, answer: k.answer.split('\n').filter(sayable).join('\n') }] : []) : k.kind === 'qa' && !sayable(k.answer) ? [] : [k]));
  const qa = approvedAnswers(all);
  // Qatorlar birlashtirilgach paydo bo'lgan ibora ham («eng» bir qatorda, «yaxshi» keyingisida) o'tib ketmasin
  const pages = fitPages(all).lines.filter(sayable);
  const facts = notes.list(biz.id).filter(f => sayable(f.text));
  const rules = orders.standing(biz.id, 'qabulxona').filter(sayable);
  return [
    `Nomi: ${p.name}`,
    priced.length ? `Narxlar (so'm):\n${priced.map(o => `- ${o.name}: ${o.price}`).join('\n')}` : "Narxlar: kiritilmagan — narxni aytmang, administrator aniqlab qayta qo'ng'iroq qiladi deng.",
    facts.length ? `Faktlar:\n${facts.map(f => `- ${f.text}`).join('\n')}` : '',
    qa.length ? `Savol-javoblar (egasi tasdiqlagan):\n${qa.map(k => `- Savol: ${line(k.question, LIMITS.question)}\n  Javob: ${line(k.answer, LIMITS.answer)}`).join('\n')}` : '',
    pages.length ? `Biznes haqida sahifalar (manzil, ish vaqti va boshqalar):\n${pages.map(p => `- ${p}`).join('\n')}` : '',
    rules.length ? `Egasining doimiy ko'rsatmalari (har doim amal qiling):\n${rules.map(r => `- ${r}`).join('\n')}` : '',
    "Bu yerda yo'q narsani o'ylab topmang: bilmasangiz, administrator aniqlab aytishini ayting.",
  ].filter(Boolean).join('\n');
}
