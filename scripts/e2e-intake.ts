/**
 * Fayl qabul qilish sinovlari: hujjatdan matn olish (Word, Excel, PDF, matn) va uni bilimga joylash.
 * Sinov fayllari shu yerning o'zida yasaladi — omborda ikkilik fayl saqlanmaydi.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_OFFERINGS, parsePrices } from '../src/lib/prices';
import { unzipSync, zipSync } from 'fflate';
import { FileError, MAX_FILE_BYTES, MAX_TEXT_CHARS, extract, kindOf, safeZip, titleOf } from '../server/intake/extract';
import { extractSafely } from '../server/intake/sandbox';
import type { BrainView } from '../src/types';
import type { Harness } from './e2e-crm';
import { docxFile, pdfFile, xlsxFile } from './sampleFiles';

export { docxFile, pdfFile, xlsxFile } from './sampleFiles';
import { OWNER, ai, press, sendDocument, sent, waitFor, type Sent } from './fakes';

type Ok = (name: string, cond: unknown, info?: string) => void;

const rejects = async (work: Promise<unknown>): Promise<string> => work.then(() => '', e => (e instanceof FileError ? e.message : `boshqa xato: ${String(e)}`));

// ─── Matn olish ──────────────────────────────────────────────────────────────

export async function intakeExtractTests(ok: Ok): Promise<void> {
  console.log('\n# Fayl: hujjatdan matn olish');
  const PRICES: [string, string][] = [['Plomba', '350 000'], ['Tish olish', '150 000'], ['Implant', '4 500 000']];

  const word = await extract('Narxnoma_2026.docx', await docxFile(PRICES));
  const wordPrices = parsePrices(word.text);
  ok('Word: abzas va jadval o\'qildi — har qator «nom — narx», tartib raqami tashlangan', word.kind === 'docx' && word.title === 'Narxnoma 2026' && word.text.includes('Narxlar 2026-yil uchun') && word.text.includes('Plomba — 350 000') && !/^1 — /m.test(word.text), word.text);
  ok('Word: jadvaldagi narxlar narx o\'quvchiga tushunarli (3 ta, to\'g\'ri summa)', wordPrices.items.length === 3 && wordPrices.items.find(i => i.name === 'Implant')?.price === 4_500_000, JSON.stringify(wordPrices));

  const sheet = await extract('narxlar.xlsx', xlsxFile([['Xizmat', 'Narx'], ['Plomba', 350000], ['Breket <metall>', 9000000], ['Konsultatsiya', 'bepul']]));
  const sheetPrices = parsePrices(sheet.text);
  ok('Excel: qatorlar o\'qildi, son va matn kataklari bilan', sheet.kind === 'xlsx' && sheet.text.includes('Plomba — 350000') && sheet.text.includes('Breket <metall> — 9000000') && sheet.text.includes('Konsultatsiya — bepul'), sheet.text);
  ok('Excel: narxlar o\'qiladi (2 ta narx; «bepul» — narx emas)', sheetPrices.items.filter(i => i.price > 0).length === 2 && sheetPrices.items.find(i => i.name === 'Plomba')?.price === 350_000, JSON.stringify(sheetPrices));

  const pdf = await extract('Qoidalar.pdf', pdfFile([['Qabul qoidalari', 'Kechikkan bemor navbatdan keyin qabul qilinadi'], ['Ikkinchi sahifa: tolov naqd yoki karta']]));
  ok('PDF: ikki sahifaning matni o\'qildi, skan emas', pdf.kind === 'pdf' && !pdf.scanned && pdf.text.includes('Kechikkan bemor navbatdan keyin qabul qilinadi') && pdf.text.includes('Ikkinchi sahifa'), pdf.text);
  const scan = await extract('skan.pdf', pdfFile([[], []]));
  ok('PDF: matn qatlami yo\'q — «skan» deb belgilanadi (xato emas)', scan.scanned && scan.text === '', JSON.stringify(scan));

  const note = await extract('eslatma.txt', Buffer.from('\ufeffIsh vaqti:\r\n\r\n\r\n\r\ndushanba–shanba   9:00–19:00\u200b\r\n', 'utf8'));
  ok('matn: BOM, ko\'rinmas belgi va ortiqcha bo\'sh qatorlarsiz', note.kind === 'text' && note.text === 'Ish vaqti:\n\ndushanba–shanba 9:00–19:00', JSON.stringify(note.text));
  const long = await extract('katta.txt', Buffer.from('qator matni\n'.repeat(6000)));
  ok('uzun matn kesiladi va bu belgilanadi', long.cut && long.text.length === MAX_TEXT_CHARS);

  console.log('\n# Fayl: o\'qilmaydiganlar');
  ok('tur mazmunidan bilinadi: nomi .pdf bo\'lgan boshqa fayl — yo\'q; nomi noto\'g\'ri PDF — PDF', kindOf('x.pdf', Buffer.from('MZ\u0090\u0000')) === null && kindOf('hisobot.bin', pdfFile([['a']])) === 'pdf' && kindOf('arxiv.zip', xlsxFile([['a']])) === null && kindOf('a.txt', Buffer.from([0x41, 0, 0x42])) === null);
  ok('dastur fayli (.exe) — tushunarli rad javobi', (await rejects(extract('virus.exe', Buffer.from('MZ\u0090\u0000\u0003')))).includes("o'qiy olmayman"));
  ok('eski .doc — qanday saqlash aytiladi', (await rejects(extract('eski.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))).includes('.doc'));
  ok('buzilgan Word — «ochib bo\'lmadi»', (await rejects(extract('buzuq.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)])))).includes("ochib bo'lmadi"));
  ok('buzilgan PDF — «ochib bo\'lmadi» yoki «matn topilmadi»', /ochib bo'lmadi|matn topilmadi/.test(await rejects(extract('buzuq.pdf', Buffer.from('%PDF-1.4\nbu pdf emas')))));
  ok("bo'sh va haddan katta fayl — rad", (await rejects(extract('a.txt', Buffer.alloc(0)))).includes("bo'sh") && (await rejects(extract('a.txt', Buffer.alloc(MAX_FILE_BYTES + 1, 65)))).includes('MB'));
  // Zip-bomba 1: yaroqli Word fayli, lekin ichidagi bitta qismning ochilgan hajmi 2 GB deb e'lon qilingan — ochishga urinilmaydi
  const real = await docxFile(PRICES);
  const central = [0x50, 0x4b, 0x01, 0x02];
  const bomb = Buffer.from(real);
  bomb.writeUInt32LE(0x7fffffff, bomb.indexOf(Buffer.from(central)) + 24);
  ok("shishirilgan arxiv: asl fayl o'qiladi, o'sha faylning hajmi 2 GB deb e'lon qilingani — ochilmaydi", (await extract('asl.docx', real)).text.includes('Plomba') && (await rejects(extract('bomba.docx', bomb))).includes("ochib bo'lmadi"));
  // Zip-bomba 2: arxiv yolg'on aytadi — 1 KB deb e'lon qilingan, aslida 30 MB. O'quvchi kutubxonalarga e'lon qilingandan ortig'i yetib bormaydi
  const liar = Buffer.from(zipSync({ 'word/document.xml': new Uint8Array(30 * 1024 * 1024) }));
  liar.writeUInt32LE(1000, liar.indexOf(Buffer.from(central)) + 24);
  let passed = 0;
  try { passed = unzipSync(new Uint8Array(safeZip(liar)))['word/document.xml']?.length ?? 0; } catch { passed = 0; }
  ok("yolg'onchi arxiv (1 KB deb e'lon qilingan 30 MB): tozalangan nusxada e'lon qilingan hajmdan ortig'i yo'q", liar.length < 100_000 && passed <= 1000, `${liar.length} bayt arxiv → ${passed} bayt`);

  // Juda ko'p sahifali PDF: faqat birinchi sahifalar o'qiladi — server daqiqalab band bo'lib qolmaydi
  const thick = pdfFile(Array.from({ length: 3000 }, (_, i) => [`Sahifa ${i + 1} matni yetarlicha uzun bolsin`]));
  const started = Date.now();
  const read = await extract('qalin.pdf', thick);
  ok("3000 sahifali PDF: birinchi sahifalar o'qiladi, qolgani tashlab ketilgani belgilanadi — bir necha soniyada", read.cut && read.text.includes('Sahifa 1 matni') && !read.text.includes('Sahifa 500 ') && Date.now() - started < 8000, `${Date.now() - started} ms, ${read.text.length} belgi`);

  // Alohida oqimda o'qish: natija bir xil; vaqt chegarasidan oshgan o'qish majburan to'xtatiladi
  const viaWorker = await extractSafely('narx.docx', real);
  ok("fayl alohida oqimda o'qiladi (natija o'sha), dastur fayli u yerda ham rad etiladi, vaqti tugagan o'qish to'xtatiladi", viaWorker.text.includes('Plomba — 350 000') && (await rejects(extractSafely('virus.exe', Buffer.from('MZ--------')))).includes("o'qiy olmayman")
    && (await rejects(extractSafely('qalin.pdf', thick, 1))).includes("juda og'ir") && (await extractSafely('narx.docx', real)).kind === 'docx');

  const wide = await extract('narx.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Plomba;350000\r\nИмплант;4500000', 'utf16le')]));
  const ansi = await extract('narx.csv', Buffer.from([0xcf, 0xeb, 0xee, 0xec, 0xe1, 0xe0, 0x20, 0x33, 0x35, 0x30, 0x30, 0x30, 0x30]));
  ok("matn: UTF-16 va Windows-1251 (Excel'dan saqlangan CSV) ham to'g'ri o'qiladi", wide.text.includes('Имплант;4500000') && ansi.text === 'Пломба 350000', `${wide.text} | ${ansi.text}`);
  const units = await extract('birlik.xlsx', xlsxFile([['Xizmat', 'Narx', 'Birlik'], ['Plomba', 350000, 'dona'], ['Tozalash', '250 000', 'seans']]));
  ok("Excel: narx oxirgi ustunda bo'lmasa ham («Xizmat | Narx | Birlik») narxlar o'qiladi", parsePrices(units.text).items.filter(i => i.price > 0).length === 2 && parsePrices(units.text).items.some(i => i.price === 350_000), units.text);
  ok("fayl nomidan sarlavha: kengaytma va pastki chiziqsiz; bo'sh bo'lsa — «Fayl»", titleOf('Shartnoma_namunasi (yangi).DOCX') === 'Shartnoma namunasi (yangi)' && titleOf('.pdf') === 'Fayl');
}

// ─── Suhbatga tashlash → taklif → egasining qarori ───────────────────────────

const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');

export async function intakeFlowTests(h: Harness): Promise<void> {
  const { ok, api, base, token, otherToken, dataDir } = h;
  console.log('\n# Fayl: suhbatga tashlash → taklif → egasining qarori');
  const upload = async (name: string, bytes: Buffer, as = token) => {
    const r = await fetch(`${base}/api/chat/file?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...(as ? { authorization: `Bearer ${as}` } : {}) }, body: new Uint8Array(bytes) });
    return { status: r.status, json: await r.json().catch(() => ({})) as { entries?: { text: string }[]; error?: string } };
  };
  const brain = async () => (await api('/api/brain', { token })).json.brain as BrainView;
  const before = await brain();
  const root = join(dataDir, before.vault);
  const sources = () => (existsSync(join(root, 'Manbalar')) ? readdirSync(join(root, 'Manbalar')) : []);
  const waitingOf = async (title: string) => (await brain()).suggested.find(k => k.kind === 'page' && k.question === title);
  const systemNow = async () => { await api('/api/chat/reset', { token, body: {} }); await api('/api/chat', { token, body: { text: 'Salom' } }); return ai.requests.at(-1)!.system; };

  // Excel narxnoma → narxlar jadvaliga
  const sheet = xlsxFile([['Xizmat', 'Narx'], ['Vinir sinov', 1900000], ['Tosh tozalash sinov', 250000], ['Maslahat', 'bepul']]);
  const up = await upload('Narxnoma_kuz.xlsx', sheet);
  const s1 = await waitingOf('Narxnoma kuz');
  ok("fayl: Excel tashlandi — suhbatda javob (2 ta narx, 2 ta yangi xizmat, matn boshi bilan), «Kutyapti»da sahifa taklifi, asli Manbalar'da baytma-bayt", up.status === 200 && up.json.entries?.length === 2 && up.json.entries[0].text === '📎 Narxnoma kuz.xlsx' && up.json.entries[1].text.includes('2 ta narx') && up.json.entries[1].text.includes('2 ta yangi xizmat') && up.json.entries[1].text.includes('Vinir sinov — 1900000') && s1?.prices === 2
    && sources().some(f => f.endsWith('Narxnoma kuz.xlsx') && readFileSync(join(root, 'Manbalar', f)).equals(sheet)), JSON.stringify({ up: up.json, s1, sources: sources() }));
  const waitingFile = existsSync(join(root, 'Kutyapti', 'Narxnoma kuz.md')) ? readFileSync(join(root, 'Kutyapti', 'Narxnoma kuz.md'), 'utf8') : '';
  // Yordamchi fayl tashlanganini biladi (oldingi suhbatdan: nomi), lekin mazmuni unga berilmaydi
  ok("fayl: tasdiqlanmaguncha bilim emas — sahifalar orasida yo'q; nomi ham, mazmuni ham yordamchiga berilmaydi; faylda «tur: sahifa» va manbasi yozilgan", !(await brain()).pages.some(p => p.question === 'Narxnoma kuz') && !(await systemNow()).includes('Narxnoma')
    && waitingFile.includes('tur: sahifa') && waitingFile.includes('fayl:Manbalar/') && waitingFile.includes('Vinir sinov — 1900000'), waitingFile);
  const foreign = await api(`/api/brain/${s1?.id}/prices`, { token: otherToken, body: {} });
  const priced = await api(`/api/brain/${s1?.id}/prices`, { token, body: {} });
  const afterPrices = priced.json.brain as BrainView;
  ok("fayl: «Narxlar jadvaliga» — 2 ta narx qo'shildi, «bepul» xizmat faktga yozildi, taklif o'chdi, asli qoldi; begona biznes qila olmaydi; qayta urinish — 404", foreign.status === 404 && priced.status === 200 && priced.json.added === 2 && priced.json.free === 1 && afterPrices.facts.some(f => f.text === 'Maslahat — bepul') && afterPrices.prices.some(o => o.name === 'Vinir sinov' && o.price === 1_900_000)
    && !afterPrices.suggested.some(k => k.id === s1?.id) && sources().length === 1 && !existsSync(join(root, 'Kutyapti', 'Narxnoma kuz.md')) && (await api(`/api/brain/${s1?.id}/prices`, { token, body: {} })).status === 404, JSON.stringify(priced.json).slice(0, 300));

  // Word → bilim sahifasi
  const rules = await upload('Qabul qoidalari.docx', await docxFile([['Kechikish', '15 daqiqa']], 'Kechikkan bemor navbatdan keyin qabul qilinadi. <img src=x> ![iz](https://e.uz/p.png)'));
  const s2 = await waitingOf('Qabul qoidalari');
  ok("fayl: Word matni papkaga zararsiz ko'rinishda tushadi (rasm havolasi va teg ochilmaydi)", rules.status === 200 && !!s2 && s2.answer.includes('Kechikkan bemor') && !s2.answer.includes('![') && !s2.answer.includes('<img'), s2?.answer);
  const kept = await api(`/api/brain/${s2?.id}`, { method: 'PATCH', token, body: { remember: true } });
  ok("fayl: «Bilimga qo'sh» — sahifa Bilim'ga ko'chdi; endi panel ham, yordamchi ham uni ko'radi", kept.status === 200 && (kept.json.brain as BrainView).pages.some(p => p.question === 'Qabul qoidalari') && existsSync(join(root, 'Bilim', 'Qabul qoidalari.md'))
    && !existsSync(join(root, 'Kutyapti', 'Qabul qoidalari.md')) && (await systemNow()).includes('Kechikkan bemor navbatdan keyin'));

  // Shu nomli sahifa bor: ustidan yozilmaydi
  const twin = before.pages[0];
  const sameName = await upload(`${twin.question}.txt`, Buffer.from('Bu fayldan kelgan boshqa matn: filial Yunusobodda ochildi.'));
  const s5 = await waitingOf(twin.question);
  const added = await api(`/api/brain/${s5?.id}`, { method: 'PATCH', token, body: { remember: true } });
  ok("fayl: shu nomli sahifa bor bo'lsa — oldindan aytiladi; tasdiqlanganda alohida «… (2)» sahifa bo'ladi, eskisining matniga tegilmaydi", !!twin && !!sameName.json.entries?.[1]?.text.includes(`«${twin.question} (2)»`)
    && (added.json.brain as BrainView).pages.some(p => p.question === `${twin.question} (2)`) && (added.json.brain as BrainView).pages.find(p => p.id === twin.id)?.answer === twin.answer, sameName.json.entries?.[1]?.text);

  // Uzun narxnoma: qator o'rtasidan kesilmaydi; jadval to'lsa — taklif joyida qoladi
  const longUp = await upload('Uzun narxnoma.txt', Buffer.from(Array.from({ length: 400 }, (_, i) => `Xizmat ${i + 1} sinov — 1 000 000`).join('\n')));
  const s6 = await waitingOf('Uzun narxnoma');
  ok("fayl: uzun narxnoma qator o'rtasidan kesilmaydi (oxirgi narx butun) va narxlarning faqat boshi o'qilgani aytiladi", !!s6 && /sinov — 1 000 000$/.test(s6.answer) && s6.answer.length <= 6000 && !!longUp.json.entries?.[1]?.text.includes('narxlarning faqat boshi'), s6?.answer.slice(-60));
  const longFile = join(root, 'Kutyapti', 'Uzun narxnoma.md');
  writeFileSync(longFile, readFileSync(longFile, 'utf8').replace(/^tur: .*\r?\n/m, ''));
  ok("fayl: egasi Obsidian'da «tur» qatorini o'chirsa ham taklif sahifa bo'lib qoladi (butun matn bitta savolning javobiga aylanmaydi)", (await waitingOf('Uzun narxnoma'))?.kind === 'page');
  const room = MAX_OFFERINGS - (await brain()).prices.length;
  const full = await api(`/api/brain/${s6?.id}/prices`, { token, body: {} });
  ok("fayl: jadval to'lsa — sig'gani qo'shiladi, sig'magani sanab aytiladi va taklif joyida qoladi", full.status === 200 && full.json.added === room && full.json.dropped > 0 && (full.json.brain as BrainView).prices.length === MAX_OFFERINGS && (full.json.brain as BrainView).suggested.some(k => k.id === s6?.id), JSON.stringify({ added: full.json.added, dropped: full.json.dropped, room }));
  await api(`/api/brain/${s6?.id}`, { method: 'DELETE', token });
  // Jadvalni to'ldirgan sinov qatorlari olib tashlanadi (keyingi sinovlarga joy kerak)
  for (const o of (full.json.brain as BrainView).prices.filter(p => /^Xizmat \d+ sinov$/.test(p.name))) await api(`/api/brain/prices/${o.id}`, { method: 'DELETE', token });

  // Ikki hafta javobsiz qolgan taklif
  await upload('eskirgan.txt', Buffer.from('Bu taklif ikki hafta kutib, javobsiz qoladigan matn.'));
  const oldFile = join(root, 'Kutyapti', 'eskirgan.md');
  writeFileSync(oldFile, readFileSync(oldFile, 'utf8').replace(/^sana: .*$/m, 'sana: 2020-01-01T00:00:00.000Z'));
  await upload('yangi fayl.txt', Buffer.from('Yangi fayl matni: yetarlicha uzun bir gap.'));
  const fresh = await waitingOf('yangi fayl');
  ok("fayl: ikki haftadan beri kutayotgan taklif o'chadi — faylining asli bilan birga", !(await waitingOf('eskirgan')) && !sources().some(f => f.includes('eskirgan')) && !!fresh, sources().join(', '));
  await api(`/api/brain/${fresh?.id}`, { method: 'DELETE', token });

  // Markdown fayl va zararli nom: Obsidian ochganda hech narsa yuklanmasin
  await upload('![](https://e.uz/p.png) eslatma.md', Buffer.from('Eslatma matni ![iz](https://e.uz/x.png) va <iframe src="https://e.uz"></iframe> oxiri.'));
  const s7 = (await brain()).suggested.find(k => k.question.includes('eslatma'));
  const noteFile = readdirSync(join(root, 'Kutyapti')).find(f => f.includes('eslatma')) ?? '';
  ok("fayl: .md matn .txt bo'lib saqlanadi (Obsidian uni sahifa qilib ochmaydi); nomidagi va ichidagi rasm havolasi, teg — zararsiz", !!s7 && sources().some(f => f.includes('eslatma') && f.endsWith('.txt')) && !sources().some(f => f.endsWith('.md'))
    && !!noteFile && !/!\[|<iframe/.test(readFileSync(join(root, 'Kutyapti', noteFile), 'utf8')), `${noteFile} | ${sources().join(', ')}`);
  await api(`/api/brain/${s7?.id}`, { method: 'DELETE', token });
  const asJson = await fetch(`${base}/api/chat/file?name=a.txt`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"a":1}' });
  ok("fayl: tana JSON deb yuborilsa — kutib qolmaydi, 400", asJson.status === 400);

  // PDF → hujjat namunasi
  const tpl = await upload('Shartnoma namunasi.pdf', pdfFile([['SHARTNOMA', 'Buyurtmachi: ________', 'Summa: ________']]));
  const s3 = await waitingOf('Shartnoma namunasi');
  const sampled = await api(`/api/brain/${s3?.id}/sample`, { token, body: {} });
  // Namunani o'qigan navbatda yordamchi bilimga yoza olmaydi: fayl matni shu yo'l bilan mijozlarga ketadigan sahifaga aylanmasin
  const sampleId = (sampled.json.brain as BrainView | undefined)?.samples.find(k => k.question === 'Shartnoma namunasi')?.id;
  await api('/api/chat/reset', { token, body: {} });
  const laundered = ((await api('/api/chat', { token, body: { text: `Namunadan sahifa yoz {"sample_id":"${sampleId}"}` } })).json.entries ?? []) as { text: string }[];
  ok("fayl: namuna o'qilgan navbatda bilimga yozish rad etiladi (fayl matni tasdiqsiz sahifaga aylanmaydi)", !!sampleId && !!laundered[1]?.text.includes('XATO') && !(await brain()).pages.some(p => p.question === 'Namunadan olingan'), laundered[1]?.text);
  ok("fayl: PDF — «Hujjat namunasi» qilindi: namunalar orasida, taklif o'chdi", tpl.status === 200 && sampled.status === 200 && (sampled.json.brain as BrainView).samples.some(k => k.question === 'Shartnoma namunasi' && k.answer.includes('Buyurtmachi'))
    && !(sampled.json.brain as BrainView).suggested.some(k => k.id === s3?.id), JSON.stringify(sampled.json).slice(0, 300));

  // Rad etish va qayta tashlash
  await upload('keraksiz.txt', Buffer.from('Bu keraksiz fayl, shunchaki sinov uchun yozilgan matn.'));
  const s4 = await waitingOf('keraksiz');
  const had = sources().some(f => f.includes('keraksiz'));
  const gone = await api(`/api/brain/${s4?.id}`, { method: 'DELETE', token });
  ok("fayl: «Kerak emas» — taklif ham, faylning asli ham o'chadi", !!s4 && had && gone.status === 200 && !sources().some(f => f.includes('keraksiz')) && !(gone.json.brain as BrainView).suggested.some(k => k.id === s4?.id));
  await upload('takror.txt', Buffer.from('Birinchi nusxa matni, yetarlicha uzun.'));
  await upload('takror.txt', Buffer.from('Ikkinchi nusxa matni, yetarlicha uzun.'));
  const twins = (await brain()).suggested.filter(k => k.question === 'takror');
  const keptSource = sources().filter(f => f.includes('takror'));
  ok("fayl: shu nomli fayl qayta tashlansa — bitta taklif (yangisi) qoladi, eskisining asli o'chadi", twins.length === 1 && twins[0].answer.includes('Ikkinchi') && keptSource.length === 1 && readFileSync(join(root, 'Manbalar', keptSource[0]), 'utf8').includes('Ikkinchi'), JSON.stringify({ twins: twins.map(t => t.answer), sources: sources() }));
  await api(`/api/brain/${twins[0]?.id}`, { method: 'DELETE', token });

  // O'qilmaydigan fayllar iz qoldirmaydi
  const files = sources().length, waiting = (await brain()).suggested.length;
  const exe = await upload('dastur.exe', Buffer.from(`MZ${'x'.repeat(60)}`));
  const scan = await upload('skan.pdf', pdfFile([[]]));
  const big = await upload('katta.txt', Buffer.alloc(MAX_FILE_BYTES + 10, 65));
  const anonymous = await upload('a.txt', Buffer.from('matn matn matn'), '');
  ok("fayl: dastur — 400 va sababi; skan PDF — rasm qilib yuborish aytiladi; 10 MB dan kattasi — 413; kirmagan odam — 401; hech biri iz qoldirmaydi", exe.status === 400 && String(exe.json.error).includes("o'qiy olmayman") && scan.status === 400 && String(scan.json.error).includes('skan')
    && big.status === 413 && anonymous.status === 401 && sources().length === files && (await brain()).suggested.length === waiting, JSON.stringify({ exe: exe.status, scan: scan.json, big: big.status, anonymous: anonymous.status }));

  console.log('\n# Fayl: Telegram orqali');
  let mark = sent.length;
  sendDocument(OWNER, 'Yangi_narxlar.docx', await docxFile([['Vinir sinov', '2 100 000'], ['Oqartirish sinov', '900 000']]));
  const card = await waitFor('fayl javobi', () => sent.slice(mark).find(s => Number(s.params.chat_id) === OWNER && textOf(s).includes("o'qildi")));
  ok("Telegram: egasi hujjat yubordi — o'qildi, to'rtta tugma (bilimga, narxlar (2), namuna, kerak emas)", !!card && buttons(card).map(b => b.callback_data?.slice(0, 2)).join() === 'ky,kp,ks,kn' && buttons(card)[1].text.includes('(2)'), JSON.stringify(buttons(card)));
  ok("Telegram: bosishdan oldin nima o'zgarishi va fayl nima deyishi ko'rsatiladi (qaysi narx o'zgaradi, matn boshi)", textOf(card).includes("1 ta yangi xizmat, 1 tasining narxi o'zgaradi (Vinir sinov: 1 900 000 → 2 100 000)") && textOf(card).includes('Oqartirish sinov — 900 000'), textOf(card));
  mark = sent.length;
  press(OWNER, buttons(card)[1]?.callback_data ?? '', card?.id ?? 0);
  const edited = await waitFor('narxlar', () => sent.slice(mark).find(s => s.method === 'editMessageText' && textOf(s).includes('Narxlar jadvalga tushdi')));
  const prices = (await brain()).prices;
  ok("Telegram: «Narxlar jadvaliga» — bor xizmatning narxi yangilandi, yangisi qo'shildi", !!edited && textOf(edited).includes('1 ta yangi, 1 tasi yangilandi') && prices.find(o => o.name === 'Vinir sinov')?.price === 2_100_000 && prices.some(o => o.name === 'Oqartirish sinov'), textOf(edited));
  mark = sent.length;
  press(OWNER, buttons(card)[1]?.callback_data ?? '', card?.id ?? 0);
  ok("Telegram: hal qilingan taklifning tugmasi qayta bosilsa — «eskirgan»", !!(await waitFor('eskirgan', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery' && textOf(s).includes('eskirgan')))));
  mark = sent.length;
  sendDocument(OWNER, 'ulkan.pdf', Buffer.from('%PDF-1.4'), MAX_FILE_BYTES + 1);
  ok("Telegram: 10 MB dan katta deb e'lon qilingan hujjat yuklab olinmaydi", !!(await waitFor('katta', () => sent.slice(mark).find(s => Number(s.params.chat_id) === OWNER && textOf(s).includes('MB dan katta')))));

  // Boshqa sinovlarga iz qolmasin: qo'shilgan narx, sahifa va namuna olib tashlanadi
  for (const o of (await brain()).prices.filter(p => p.name.endsWith('sinov'))) await api(`/api/brain/prices/${o.id}`, { method: 'DELETE', token });
  const left = await brain();
  for (const k of [...left.pages.filter(p => p.question === 'Qabul qoidalari' || p.question.endsWith(' (2)')), ...left.samples.filter(s => s.question === 'Shartnoma namunasi')]) await api(`/api/brain/${k.id}`, { method: 'DELETE', token });
  for (const f of left.facts.filter(n => n.text === 'Maslahat — bepul')) await api(`/api/notes/${f.id}`, { method: 'DELETE', token });
  const after = await brain();
  ok("fayl sinovlaridan keyin miya avvalgi holatida", after.prices.length === before.prices.length && after.pages.length === before.pages.length && after.samples.length === before.samples.length && after.suggested.length === before.suggested.length && after.facts.length === before.facts.length,
    JSON.stringify({ prices: [before.prices.length, after.prices.length], pages: [before.pages.length, after.pages.length], samples: [before.samples.length, after.samples.length], suggested: [before.suggested.length, after.suggested.length] }));
}
