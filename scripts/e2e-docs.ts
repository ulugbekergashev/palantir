/**
 * Hujjat ustasi (server/docs, server/docx.ts): summa so'z bilan, jadval hisobi va boshqa avtomatik tekshiruvlar, Word ko'rinishi —
 * sof funksiyalar; keyin serverda: rekvizitlar (panel va yordamchi orqali), yozuvchi → tekshiruv → tekshiruvchi zanjiri soxta model bilan.
 */
import JSZip from 'jszip';
import type { Business } from '../src/types';
import { blanks, missingKnown, missingSections, parseDraft, tableMath, textProblems } from '../server/docs/checks';
import { legalFields, legalText, vatText } from '../server/docs/legal';
import { playbook, reviewSystem, writerSystem } from '../server/docs/playbooks';
import { amountWords, fillWords, numberWords } from '../server/docs/words';
import { markdownToDocx } from '../server/docx';
import { ai } from './fakes';
import type { Harness } from './e2e-crm';

type Ok = (name: string, cond: unknown, info?: string) => void;

const BIZ: Business = {
  name: 'Mebel Uyi', ownerName: 'Aziz', industry: "mebel do'koni", phone: '+998 90 123 45 67', address: 'Toshkent, Chilonzor 5',
  brand: { primary: '#0F766E', accent: '#F59E0B' }, offerings: [], team: [],
  legal: { name: '«Mebel Uyi» MChJ', stir: '305123456', bank: '«Kapitalbank» ATB', account: '20208000900123456001', mfo: '01088', director: 'Karimov Aziz', basis: 'Ustav', vatRate: 0 },
};

const xml = async (buf: Buffer, file = 'word/document.xml') => (await (await JSZip.loadAsync(buf)).file(file)?.async('string')) ?? '';

export async function docsLogicTests(ok: Ok): Promise<void> {
  console.log("\n# Hujjat ustasi: summa so'z bilan, tekshiruvlar, Word ko'rinishi");
  ok("so'z bilan (o'zbekcha): 1 500 000 — «Bir million besh yuz ming so'm»", amountWords(1_500_000, 'uz') === "Bir million besh yuz ming so'm", amountWords(1_500_000, 'uz'));
  ok("so'z bilan (o'zbekcha): 2 021, 110, 0", numberWords(2021, 'uz') === 'ikki ming yigirma bir' && numberWords(110, 'uz') === "bir yuz o'n" && numberWords(0, 'uz') === 'nol');
  ok("so'z bilan (ruscha): son shakllari — 1 сум, 2 сума, 5/11/112 сумов", amountWords(1, 'ru') === 'Один сум' && amountWords(2, 'ru') === 'Два сума' && amountWords(5, 'ru') === 'Пять сумов'
    && amountWords(11, 'ru') === 'Одиннадцать сумов' && amountWords(112, 'ru') === 'Сто двенадцать сумов', [1, 2, 5, 11, 112].map(n => amountWords(n, 'ru')).join(' | '));
  ok("so'z bilan (ruscha): ming — ayol jinsi (двадцать одна тысяча, две тысячи)", amountWords(21_000, 'ru') === 'Двадцать одна тысяча сумов' && numberWords(2_000, 'ru') === 'две тысячи' && amountWords(1_500_000, 'ru') === 'Один миллион пятьсот тысяч сумов', amountWords(21_000, 'ru'));
  ok("belgi o'rniga so'z: {{words:…}} (bo'shliq bilan ham), noto'g'ri belgi qoladi", fillWords('Jami: 30 000 000 so\'m ({{words:30000000}}), {{ words: 1 500 000 }}', 'uz') === "Jami: 30 000 000 so'm (O'ttiz million so'm), Bir million besh yuz ming so'm"
    && fillWords('{{words:abc}}', 'uz') === '{{words:abc}}');
  ok("belgidan keyin yana valyuta yozilsa — takrorlanmaydi («so'm so'm», «сумов сум»)", fillWords("({{words:2000}} so'm)", 'uz') === "(Ikki ming so'm)" && fillWords('({{words:5}} сум)', 'ru') === '(Пять сумов)', fillWords("({{words:2000}} so'm)", 'uz'));
  ok("taklif va xatga qonunlar berilmaydi (moslik da'vosi bo'lmasin), shartnomaga — beriladi", !writerSystem('offer', 'uz', '2026-10-20').includes('670-I') && writerSystem('offer', 'uz', '2026-10-20').includes('VAT')
    && writerSystem('invoice', 'uz', '2026-10-20').includes('670-I') && writerSystem('offer', 'uz', '2026-10-20').includes('No legal or security claims'));

  const good = "| № | Nomi | Soni | Narxi | Summasi |\n|---|---|---|---|---|\n| 1 | Stol | 20 | 1 500 000 | 30 000 000 |\n| 2 | Stul | 4 | 250 000 so'm | 1 000 000 so'm |\n| | **Jami** | | | **31 000 000** |";
  ok('jadval hisobi: to\'g\'ri jadval — xato yo\'q', tableMath(good).length === 0, tableMath(good).join('; '));
  const wrongRow = good.replace('| 30 000 000 |', '| 31 000 000 |');
  ok('jadval hisobi: soni × narx ≠ summa — topiladi', tableMath(wrongRow).some(p => p.includes('Stol') && p.includes('30 000 000')), tableMath(wrongRow).join('; '));
  const wrongTotal = good.replace('**31 000 000**', '**32 000 000**');
  ok("jadval hisobi: «Jami» qatorlar yig'indisiga teng emas — topiladi", tableMath(wrongTotal).some(p => p.includes('Jami')), tableMath(wrongTotal).join('; '));
  const withVat = good.replace('| | **Jami** |', '| | QQS 12% | | | 3 720 000 |\n| | **Jami** |').replace('**31 000 000**', '**34 720 000**');
  ok("jadval hisobi: QQS qatori bor — «Jami» noto'g'ri deb hisoblanmaydi", tableMath(withVat).length === 0, tableMath(withVat).join('; '));

  ok("ma'lum rekvizit: bo'shliq bilan yozilgan STIR ham topiladi, yo'q bo'lsa — aytiladi", missingKnown('STIR: 305 123 456', [{ label: 'STIR', value: '305123456' }]).length === 0
    && missingKnown('STIR: ________', [{ label: 'STIR', value: '305123456' }]).length === 1);
  const contractHeads = '## 1. PREDMET\n## 2. NARX VA TO\'LOV\n## 3. HUQUQ VA MAJBURIYATLAR\n## 4. JAVOBGARLIK\n## 5. FORS-MAJOR\n## 6. NIZOLAR\n## 7. REKVIZITLAR';
  ok("shartnoma: majburiy bo'limlar bor — xato yo'q; fors-major olib tashlansa — aytiladi", missingSections(contractHeads, playbook('contract').sections).length === 0
    && missingSections(contractHeads.replace('## 5. FORS-MAJOR\n', ''), playbook('contract').sections).join() === "Bo'lim yo'q: fors-major");
  ok("ruscha shartnoma sarlavhalari ham taniladi", missingSections('## ПРЕДМЕТ\n## ЦЕНА\n## ОБЯЗАННОСТИ СТОРОН\n## ОТВЕТСТВЕННОСТЬ\n## ФОРС-МАЖОР\n## СПОРЫ\n## РЕКВИЗИТЫ', playbook('contract').sections).length === 0);
  ok("o'zbekcha hujjatda kirill so'zlar — aytiladi, ruschada — yo'q", textProblems('Договор и обязательства сторон, оплата производится', 'uz').length === 1 && textProblems('Договор и обязательства сторон, оплата', 'ru').length === 0);
  ok("modeldan: ```markdown o'rami olinadi, «missing» ro'yxati ajratiladi", JSON.stringify(parseDraft('```markdown\n# Taklif\nMatn\n<!-- missing: mijoz STIR; shartnoma raqami -->\n```')) === JSON.stringify({ markdown: '# Taklif\nMatn', missing: ['mijoz STIR', 'shartnoma raqami'] })
    && parseDraft('# A\n<!-- missing: none -->').missing.length === 0);
  ok("bo'sh joylar sanaladi", blanks('STIR: ________, h/r: ________, ___') === 2);

  ok("rekvizitlar: to'ldirilgani modelga ro'yxat bo'lib boradi, QQS holati bilan", legalText(BIZ).includes('STIR: 305123456') && legalText(BIZ).includes("QQS to'lovchisi emas"));
  ok("rekvizitlar: bo'sh — modelga «to'qima» deyiladi", legalText({ ...BIZ, legal: undefined }).includes('not filled in') && vatText({ ...BIZ, legal: { vatRate: 12 } }) === "QQS to'lovchisi, stavka 12%");
  ok("rekvizitlar: yuridik manzil bo'lmasa — biznes manzili", legalFields(BIZ).find(f => f.key === 'address')?.value === 'Toshkent, Chilonzor 5');
  const sys = writerSystem('contract', 'uz', '2026-10-20');
  ok('yozuvchi ko\'rsatmasi: tekshirilgan normalar (670-I: 0,5% va 0,4%, 50%; ZRU-547), tuzilma, til', sys.includes('No. 670-I') && sys.includes('0.5%') && sys.includes('0.4%') && sys.includes('ZRU-547')
    && sys.includes('FORS-MAJOR') && sys.includes('Uzbek, Latin script') && sys.includes('{{words:'));
  ok("tekshiruvchi ko'rsatmasi: «OK» yoki to'liq tuzatilgan hujjat", reviewSystem('offer', 'ru', '2026-10-20').includes('reply with exactly: OK') && reviewSystem('offer', 'ru', '2026-10-20').includes('validity only if the brief gives it'));

  const contract = await markdownToDocx('Shartnoma', "# XIZMAT KO'RSATISH SHARTNOMASI № 12\n[[Toshkent sh. | «20» oktyabr 2026 y.]]\n## 1. SHARTNOMA PREDMETI\n1.1. Ijrochi xizmat ko'rsatadi.\n## 13. TOMONLARNING REKVIZITLARI\n| IJROCHI | BUYURTMACHI |\n|---|---|\n| STIR: 305123456 | STIR: ________ |\n<!-- missing: mijoz STIR -->", BIZ, 'contract');
  const cx = await xml(contract);
  ok("Word (shartnoma): Times New Roman, ikki ustunli qator, rekvizitlar jadvali, izoh chiqmaydi", cx.includes('Times New Roman') && cx.includes('Toshkent sh.') && cx.includes('«20» oktyabr 2026 y.') && cx.includes('305123456') && !cx.includes('missing'));
  const footer = (await JSZip.loadAsync(contract)).file(/word\/footer\d*\.xml/)[0];
  ok('Word: har sahifada «1 / 3» — sahifa raqami maydoni', !!footer && /PAGE|NUMPAGES/.test(await footer.async('string')));
  const offer = await markdownToDocx('Taklif', "# TIJORAT TAKLIFI\n> Muhim: narxlar 14 kun amal qiladi\n## Narx\n| № | Nomi | Soni | Narxi | Summasi |\n|---|---|---|---|---|\n| 1 | Stol | 20 | 1 500 000 | 30 000 000 |", BIZ, 'offer');
  const zip = await JSZip.loadAsync(offer);
  const header = zip.file(/word\/header\d*\.xml/)[0];
  const hx = header ? await header.async('string') : '';
  ok("Word (taklif): ish blanki — yuridik nom va aloqa, brend rangi", hx.includes('«Mebel Uyi» MChJ') && hx.includes('+998 90 123 45 67') && hx.includes('0F766E'));
  const ox = await xml(offer);
  ok("Word (taklif): jadval boshi brend rangida, raqam o'ngga tekislangan", ox.includes('w:fill="0F766E"') && /<w:jc w:val="(right|end)"\/>/.test(ox));
}

export async function docsApiTests(h: Harness): Promise<void> {
  const { ok, api, token, otherToken } = h;
  console.log('\n# Hujjat ustasi: rekvizitlar va yozuvchi zanjiri (soxta model)');
  const me = (await api('/api/me', { token })).json;
  const biz = me.business as Business;
  const rev = me.offeringsRev as string;
  ok("rekvizit: STIR'da harf — 400", (await api('/api/business', { method: 'PUT', token, body: { ...biz, offeringsRev: rev, legal: { stir: '30A' } } })).status === 400);

  const say = async (text: string) => (await api('/api/chat', { token, body: { text } })).json;
  await say("Rekvizitlarimni saqla: STIR 305 123 456, Kapitalbank, h/r 20208000900123456001, MFO 01088, direktor Karimov Aziz");
  const saved = ((await api('/api/me', { token })).json.business as Business).legal;
  ok("rekvizit: yordamchi saqladi (save_requisites) — STIR, bank, QQSsiz", saved?.stir === '305 123 456' && saved.bank === '«Kapitalbank» ATB' && saved.vatRate === 0, JSON.stringify(saved));
  ok("rekvizit: boshqa biznesda yo'q", !((await api('/api/me', { token: otherToken })).json.business as Business).legal?.stir);

  ai.docs.length = 0;
  await say('Aliyevga tijorat taklifi tayyorla, xato');
  const write = ai.docs.find(d => d.stage === 'write'), review = ai.docs.find(d => d.stage === 'review');
  ok("yozuvchiga: qo'llanma, normalar, rekvizitlar, brief; chuqur o'ylab (effort high)", !!write && write.system.includes('commercial offer') && write.user.includes('<legal_details>') && write.user.includes('305 123 456')
    && write.user.includes('20 ta stol') && write.effort === 'high', write?.effort);
  ok("tekshiruvchiga: avtomatik topilma — jadvaldagi hisob xatosi", !!review && review.user.includes('<automatic_findings>') && /31 000 000|30 000 000/.test(/<automatic_findings>[\s\S]*?<\/automatic_findings>/.exec(review.user)?.[0] ?? ''));
  const doc = (await api('/api/documents', { token })).json.documents?.[0] as { markdown: string; title: string } | undefined;
  ok("natija: hisob tuzatilgan, summa so'z bilan yozilgan, belgi va izoh qolmagan", !!doc && doc.markdown.includes('30 000 000') && !doc.markdown.includes('31 000 000')
    && doc.markdown.includes("O'ttiz million so'm") && !doc.markdown.includes('{{') && !doc.markdown.includes('<!--'), doc?.markdown.slice(-300));
  const owner = ai.requests.at(-1);
  ok("yordamchiga: egasi nimani to'ldirishi kerakligi (missing) qaytdi", JSON.stringify(owner?.messages ?? []).includes('mijozning manzili'));
}
