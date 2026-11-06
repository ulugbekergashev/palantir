/**
 * Hub'dagi yordam so'rovlari (hub/help.ts) — toza sinov, xotiradagi baza bilan:  npm run test:help
 *   matn tekshiruvi va tozalanishi, bitta klinikadan sutkasiga chegara, bitta so'rovga bitta javob, ro'yxat tartibi va kim ko'radi.
 * Butun yo'l (klinika → hub → jamoa → egasining Telegrami) — npm run test:hub.
 */
import { DatabaseSync } from 'node:sqlite';
import { HELP_PER_DAY, HelpError, createHelp } from '../hub/help';
import { fitBytes } from '../server/fitBytes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const code = (fn: () => unknown): number | null => { try { fn(); return null; } catch (e) { return e instanceof HelpError ? e.code : -1; } };

let clock = Date.parse('2026-11-07T09:00:00Z');
const help = createHelp(new DatabaseSync(':memory:'), () => new Date(clock));
const A = 'aaaaaaaaaa', B = 'bbbbbbbbbb';

console.log("\n# So'rov matni");
ok("bo'sh yoki juda qisqa matn — 400", code(() => help.ask(A, { text: '' })) === 400 && code(() => help.ask(A, { text: ' ha ' })) === 400);
ok("matn emas — 400", code(() => help.ask(A, { text: 42 })) === 400);
const first = help.ask(A, { text: "  Kechadan beri\u0007 Instagram'ga\t\tjavob\n\n\n\nketmayapti  ", business: 'b1', businessName: 'Shifo\nDent', by: 'Ulug\u0000bek' });
ok("boshqaruv belgilari olib tashlanadi, qator tashlash qoladi (ko'pi bilan bitta bo'sh qator)", first.text === "Kechadan beri Instagram'ga javob\n\nketmayapti", JSON.stringify(first.text));
ok('nom va kim — bir qatorga', first.businessName === 'Shifo Dent' && first.by === 'Ulugbek' && first.business === 'b1', JSON.stringify(first));
ok('juda uzun matn qisqartiriladi', help.ask(B, { text: 'x'.repeat(5000) }).text.length === 2000);
ok("yangi so'rov: javobsiz, diagnostikasiz", first.answer === null && first.diag === null && /^[0-9a-f]{12}$/.test(first.id));
help.attachDiag(first.id, '2026-11-07T09-00-00-000Z.txt');
ok("diagnostika fayli so'rovga bog'lanadi", help.get(first.id)?.diag === '2026-11-07T09-00-00-000Z.txt');

console.log('\n# Chegara: bitta klinikadan sutkasiga');
for (let i = 1; i < HELP_PER_DAY; i++) help.ask(A, { text: `So'rov raqam ${i}` });
ok(`${HELP_PER_DAY} tadan keyin — 429`, code(() => help.ask(A, { text: "Yana bitta so'rov" })) === 429);
ok("boshqa klinikaga ta'sir qilmaydi", code(() => help.ask(B, { text: "Boshqa klinika so'rovi" })) === null);
clock += 86_400_000 + 1000;
ok('sutka o\'tgach — yana qabul qilinadi', code(() => help.ask(A, { text: "Ertasi kungi so'rov" })) === null);

console.log('\n# Javob');
ok("bo'sh javob — 400", code(() => help.answer(first.id, 'Ulug\'bek', '  ')) === 400);
ok("noma'lum so'rov — 404", code(() => help.answer('000000000000', 'Ulug\'bek', 'Javob')) === 404);
const done = help.answer(first.id, "Ulug'bek", 'Tekshirdik: token yangilandi');
ok("javob yoziladi: kim va qachon", done.answer === 'Tekshirdik: token yangilandi' && done.answeredBy === "Ulug'bek" && !!done.answeredAt);
ok("ikkinchi javob — 409 (birinchisi o'zgarmaydi)", code(() => help.answer(first.id, 'Boshqa', 'Boshqa javob')) === 409 && help.get(first.id)?.answer === done.answer);
const C = 'cccccccccc';
ok("asosiy kalit bilan javob — ism yozilmaydi (egasiga «Palantir jamoasi» deb boradi)", help.answer(help.ask(C, { text: 'Kalit bilan javob' }).id, null, 'Javob').answeredBy === null);

console.log('\n# Sotuvchiga Telegram xabari');
const fresh = help.ask(C, { text: "Xabar yetmagan so'rov" });
ok("yangi so'rov — sotuvchiga hali aytilmaganlar ro'yxatida (nazorat sikli qayta urinadi)", help.unalerted().some(h => h.id === fresh.id));
help.markAlerted(fresh.id);
ok("aytilgandan keyin — ro'yxatdan chiqadi", !help.unalerted().some(h => h.id === fresh.id));
ok("bir sutkadan eskisi qayta urinilmaydi", !help.unalerted().some(h => h.id === first.id));

console.log("\n# Ro'yxat");
const all = help.list(() => true);
const firstAnswered = all.findIndex(h => h.answer !== null);
ok('javobsizlari birinchi, javob berilgani oxirida', firstAnswered > 0 && all.slice(firstAnswered).every(h => h.answer !== null), `${firstAnswered}/${all.length}`);
ok('javobsizlari ichida yangisi birinchi', all[0].text === "Ertasi kungi so'rov", all[0].text);
ok("faqat ko'rishi mumkin bo'lgan klinikalar (o'rnatuvchi — o'zinikini)", help.list(c => c === B).every(h => h.clinicId === B) && help.list(c => c === B).length === 2);
help.forget(B);
ok("klinika o'chirilsa — so'rovlari ham", help.list(c => c === B).length === 0 && help.list(c => c === A).length > 0);

console.log("\n# Katta diagnostika (klinika tomoni, server/fitBytes.ts)");
const big = `## Holat\nversiya 0.4.7\n${'jurnal qatori — xato izi '.repeat(40_000)}\nBUGUNGI OXIRGI QATOR`;
const fitted = fitBytes(big, 600_000);
ok('kichik matn o\'zgarmaydi', fitBytes('qisqa', 600_000) === 'qisqa');
ok("katta matn chegaraga sig'adi: boshi (holat) va oxiri (bugungi jurnal) qoladi, o'rtasi qisqartirilgani yoziladi",
  Buffer.byteLength(fitted) <= 600_200 && fitted.startsWith('## Holat') && fitted.endsWith('BUGUNGI OXIRGI QATOR') && fitted.includes('qisqartirildi'), `${Buffer.byteLength(big)} → ${Buffer.byteLength(fitted)}`);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
