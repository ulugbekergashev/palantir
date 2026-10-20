/**
 * Hujjat sifati — haqiqiy model bilan solishtirish (pulli: ~1–2 $). Bir xil topshiriq ikki usulda yoziladi:
 *   eski — yordamchi hujjatni o'zi, bitta urinishda yozardi (effort medium, qo'llanmasiz);
 *   yangi — server/docs/writer.ts: qo'llanma + rekvizitlar + avtomatik tekshiruv + tekshiruvchi model.
 * Keyin uchinchi model qaysi biri qaysi usul ekanini bilmay (A/B tasodifiy) baholaydi. Natija va Word fayllari — tmp/hujjat-sinov/.
 * Alohida bo'sh bazada ishlaydi (haqiqiy ma'lumotga tegmaydi). Ishga tushirish: npx tsx scripts/doc-bench.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { iso } from '../src/lib/week';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cerebro-docbench-'));
process.env.ASTERISK_WSL = '0';

const OUT = resolve('tmp/hujjat-sinov');
mkdirSync(OUT, { recursive: true });

const SANDBOX = process.env.DATA_DIR;
const { env } = await import('../server/env');
// .env dagi DATA_DIR ustun kelib qolsa — haqiqiy bazaga yozmaslik uchun darhol to'xtaydi
if (resolve(env.dataDir) !== resolve(SANDBOX)) throw new Error(`Sinov bazasi emas: ${env.dataDir}`);
const { businesses } = await import('../server/db');
const { think } = await import('../server/claude');
const { writeDocument, factsText } = await import('../server/docs/writer');
const { autoProblems } = await import('../server/docs/writer');
const { markdownToDocx } = await import('../server/docx');
const { fillWords } = await import('../server/docs/words');
const { parseDraft } = await import('../server/docs/checks');
type Kind = import('../server/docs/playbooks').DocKind;

const biz = businesses.create(`bench${Date.now()}`, 'x', {
  name: 'Palantir', ownerName: "Ulug'bek", industry: 'IT: klinikalar uchun AI yordamchi va DentaCRM',
  description: "Klinikalar uchun AI qabulxona: telefon, Telegram va Instagram'dagi murojaatlarga kunu tun javob beradi, DentaCRM'ga qabul yozadi, egasiga kunlik hisobot beradi; kameralar bilan kreslo bandligini CRM bilan solishtiradi. Hamma ma'lumot klinika kompyuterida saqlanadi.",
  phone: '+998 90 000 00 00', address: "Toshkent sh., Mirzo Ulug'bek tumani", website: 'palantir.uz', contentLang: 'uz',
  brand: { primary: '#4F46E5', accent: '#F59E0B' },
  offerings: [
    { id: 'o1', name: "O'rnatish va sozlash (bir martalik)", price: 3_000_000 },
    { id: 'o2', name: 'Oylik xizmat (AI qabulxona, qo\'llab-quvvatlash)', price: 1_500_000 },
    { id: 'o3', name: 'Kamera moduli (oylik)', price: 500_000 },
  ],
  team: [],
});
// Rekvizitlar — miyada (egasi fayl tashlagan yoki yozgandek), profilda emas
const { vaultDir } = await import('../server/brain/vault');
mkdirSync(join(vaultDir(biz.id), 'Bilim'), { recursive: true });
writeFileSync(join(vaultDir(biz.id), 'Bilim', 'Kompaniya kartasi.md'), "# Kompaniya kartasi\n\n«Palantir AI» MChJ\nSTIR: 311 222 333 · OKED: 62010\nBank: «Kapitalbank» ATB Toshkent filiali, MFO 01088\nH/r: 20208000400111222001\nDirektor: Ergashev Ulug'bek (Ustav asosida)\nQQS to'lovchisi emas.\n");

const CASES: { kind: Kind; title: string; brief: string }[] = [
  {
    kind: 'contract', title: 'Palantir xizmat ko\'rsatish shartnomasi — Tabassum Dental',
    brief: "«Tabassum Dental» MChJ stomatologiya klinikasi bilan shartnoma: Palantir'ni klinika kompyuteriga o'rnatish va sozlash (3 000 000 so'm, bir martalik) va oylik xizmat (1 500 000 so'm/oy). O'rnatishga 50% oldindan to'lov, qolgani dalolatnomadan keyin 5 bank kunida. Oylik to'lov har oyning 10-sanasigacha. O'rnatish muddati — oldindan to'lovdan keyin 7 ish kuni. Qo'llab-quvvatlash: ish kunlari 9:00–18:00, javob 4 soat ichida. Shartnoma 12 oyga, avtomatik uzayadi. Klinika bemorlari ma'lumoti (ism, telefon, qabul) bilan ishlaymiz. Klinika direktori: ________.",
  },
  {
    kind: 'offer', title: "«Shifo Dent» uchun tijorat taklifi",
    brief: "«Shifo Dent» klinikasi (Chilonzor, 4 kreslo) egasi Dilshod aka: kechqurun va dam olish kunlari qo'ng'iroqlar javobsiz qoladi, Instagram'ga kech javob berishadi, administrator bitta. Taklif: Palantir AI qabulxona — o'rnatish 3 000 000 so'm, oylik 1 500 000 so'm; kamera moduli ixtiyoriy, oyiga 500 000 so'm. Birinchi oy 20% chegirma (faqat oylik xizmatga). Ishga tushirish 7 ish kuni. Keyingi qadam — klinikada 30 daqiqalik demo.",
  },
];

/** Eski usul: yordamchi hujjatni o'zi, bitta urinishda (asbob tavsifidagi qoidalar bilan) */
async function oldWay(kind: Kind, title: string, brief: string): Promise<string> {
  const res = await think(biz.id, 'owner', {
    model: env.aiModel, max_tokens: 16_000,
    system: `You are Palantir, the business owner's assistant. Write a business document and give it to the owner as a Word file. Use Markdown: # headings, - lists, 1. lists, **bold**, tables with | cells |. Fill in everything you know from the business profile; for unknown details leave a visible blank like "________" — never invent them. Reply with the document only.`,
    messages: [{ role: 'user', content: `${factsText(biz, { kind, customerId: null, title, brief })}\n\nOwner: ${title}. ${brief}` }],
    thinking: { type: 'adaptive', display: 'omitted' },
    output_config: { effort: 'medium' },
  });
  return parseDraft(res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')).markdown;
}

const JUDGE = `You are a strict reviewer: a senior Uzbek commercial lawyer and a B2B sales director. You get the facts, the owner's brief and two versions (A and B) of the same document. Score each from 1 to 10 on:
completeness (all parts this document needs), legal (correct for Uzbekistan, enforceable, protects our side; for an offer — no risky promises), specificity (uses this deal's facts, not boilerplate; for an offer — persuasive for this client), accuracy (no invented facts, correct arithmetic, consistent), language (correct official Uzbek Latin), ready (could be signed or sent after filling the other party's details).
Reply with JSON only: {"A":{"completeness":n,"legal":n,"specificity":n,"accuracy":n,"language":n,"ready":n,"weaknesses":"one sentence"},"B":{...},"better":"A"|"B","why":"one sentence"}
Context for fair judging: today is ${iso(new Date())} in Tashkent (a document dated today is not invented). Both versions are printed on the same letterhead with the company's legal name, address, phone and website. These citations are verified on lex.uz and correct: Law 670-I arts. 10, 11, 25 (0.5%/day, ≤50%), 32 (0.4%/day, ≤50%); Law ZRU-547 art. 27¹. A blank or a standard procedural value the document lists for the owner to confirm is acceptable; an invented business figure is not.`;

const report: string[] = [];
// npx tsx scripts/doc-bench.ts offer — faqat shu turdagi hujjat
const only = process.argv[2];
for (const c of CASES.filter(x => !only || x.kind === only)) {
  const t0 = Date.now();
  const [old, fresh] = await Promise.all([oldWay(c.kind, c.title, c.brief), writeDocument(biz, { title: c.title, kind: c.kind, lang: 'uz', brief: c.brief })]);
  const seconds = Math.round((Date.now() - t0) / 1000);
  const oldMd = fillWords(old, 'uz');
  const newIsA = Math.random() < 0.5;
  const [A, B] = newIsA ? [fresh.markdown, oldMd] : [oldMd, fresh.markdown];
  const judged = await think(biz.id, 'owner', {
    model: env.aiModel, max_tokens: 4000, system: JUDGE,
    messages: [{ role: 'user', content: `${factsText(biz, { kind: c.kind, customerId: null, title: c.title, brief: c.brief })}\n\n<brief>${c.brief}</brief>\n\n<A>\n${A}\n</A>\n\n<B>\n${B}\n</B>` }],
    thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'high' },
  });
  const raw = judged.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
  const verdict = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as Record<string, Record<string, number | string>> & { better?: string; why?: string };
  const score = (k: 'A' | 'B') => { const v = verdict[k] ?? {}; return ['completeness', 'legal', 'specificity', 'accuracy', 'language', 'ready'].map(x => Number(v[x]) || 0); };
  const [newScore, oldScore] = newIsA ? [score('A'), score('B')] : [score('B'), score('A')];
  const avg = (a: number[]) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
  const winner = verdict.better === (newIsA ? 'A' : 'B') ? 'YANGI' : 'ESKI';
  const base = c.kind === 'contract' ? 'shartnoma' : 'taklif';
  writeFileSync(join(OUT, `${base}-eski.md`), oldMd);
  writeFileSync(join(OUT, `${base}-yangi.md`), fresh.markdown);
  writeFileSync(join(OUT, `${base}-eski.docx`), await markdownToDocx(c.title, oldMd, biz.profile, c.kind));
  writeFileSync(join(OUT, `${base}-yangi.docx`), await markdownToDocx(c.title, fresh.markdown, biz.profile, c.kind));
  report.push([
    `## ${c.title}`,
    `vaqt (ikkalasi parallel): ${seconds} s · hajm: eski ${oldMd.length} belgi, yangi ${fresh.markdown.length} belgi · bo'sh joy: eski ${(oldMd.match(/_{4,}/g) ?? []).length}, yangi ${fresh.blanks}`,
    `avtomatik tekshiruv: eski — ${autoProblems(oldMd, biz.profile, c.kind, 'uz').length} ta topilma, yangi — ${fresh.problems.length} ta (tekshiruvchi: ${fresh.reviewed ? 'ishladi' : "yo'q"})`,
    `baho (to'liqlik, huquqiy, aniqlik/moslik, faktlar, til, tayyorlik): yangi ${newScore.join(' / ')} = ${avg(newScore)}; eski ${oldScore.join(' / ')} = ${avg(oldScore)}`,
    `yaxshirog'i: ${winner} — ${verdict.why ?? ''}`,
    `yangisining kamchiligi: ${(newIsA ? verdict.A : verdict.B)?.weaknesses ?? ''}`,
    `eskisining kamchiligi: ${(newIsA ? verdict.B : verdict.A)?.weaknesses ?? ''}`,
    `egasi to'ldirishi kerak (yangi): ${fresh.missing.join('; ') || '—'}`,
  ].join('\n'));
  console.log(report.at(-1), '\n');
}
writeFileSync(join(OUT, 'natija.md'), `# Hujjat sifati: eski va yangi usul (${new Date().toISOString().slice(0, 16)})\n\n${report.join('\n\n')}\n`);
console.log(`fayllar: ${OUT}`);
