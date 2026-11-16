/**
 * Javobdagi biznes faktlari (server/inbox/factGuard.ts, E8) — AI'siz: ma'lumotda yo'q ish vaqti, manzil, shifokor ismi ushlanadi;
 * ma'lumotdagisi (boshqacha yozilgan bo'lsa ham) va oddiy gap o'tadi.
 * Ishga tushirish: npm run test:facts
 */
import { unknownFact } from '../server/inbox/factGuard';

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}
const all = (replies: string[], known: string, want: string | null) => {
  const bad = replies.filter(r => unknownFact(r, known) !== want);
  return { pass: !bad.length, info: bad.map(r => `«${r}» → ${unknownFact(r, known)}`).join('; ') };
};

const K = [
  'Name: Tabassum', 'Team:', '- Rustam Karimov — Stomatolog, 10 years (member_id: m1)', '- Dilnoza Aliyeva — Ortodont (member_id: m2)',
  'Ish vaqti: dushanba–shanba 9:00–18:00, yakshanba dam olish kuni', "Manzil: Toshkent, Navoiy ko'chasi 12, mo'ljal — Anhor",
].join('\n');
const SCHEDULE = 'd1 Rustam Karimov: 2026-11-17 11:00–17:30';

console.log('\n# Ish vaqti');
{
  const pass = all(["Biz 9:00 dan 18:00 gacha ishlaymiz", 'Работаем с 9:00 до 18:00', "Ish vaqtimiz 09.00–18.00", '18:00 gacha ochiqmiz'], K, null);
  ok("ma'lumotdagi ish vaqti (boshqacha yozilgan bo'lsa ham) — o'tadi", pass.pass, pass.info);
  const bad = all(["Har kuni 10:00 dan 20:00 gacha ishlaymiz", 'Работаем до 21:00', "8:00–17:00 ochiqmiz"], K, 'ish vaqti');
  ok("ma'lumotda yo'q ish vaqti — ushlanadi", bad.pass, bad.info);
  const none = all(["Ish vaqti: har kuni 10:00 dan 20:00 gacha"], 'Name: Mebel Uyi', 'ish vaqti');
  ok("ish vaqti umuman saqlanmagan — o'ylab topilgani ushlanadi (jonli sinovda shunday bo'lgan)", none.pass, none.info);
  const plain = all(['Davolash 1-2 soat davom etadi', "2-3 kunda tayyor bo'ladi", 'Ertaga keling'], K, null);
  ok("soat emas («1-2 soat», «2-3 kun») — tegilmaydi", plain.pass, plain.info);
  const slot = all(["Doktor Karimov 11:00 dan 17:30 gacha bo'sh"], `${K}\n${SCHEDULE}`, null);
  ok("CRM jadvalidagi bo'sh soatlar — o'tadi", slot.pass, slot.info);
  ok('daqiqasiz oraliq ma\'lumotda («9–18») — «9:00–18:00» o\'tadi', unknownFact('9:00 dan 18:00 gacha', 'Ish vaqti 9–18') === null);
  // Sana soat emas: jadvaldagi «2026-11-20» dan «11–20» oralig'i (20:00 «ma'lum») chiqib, o'ylab topilgan ish vaqti o'tib ketardi —
  // e2e E8 faqat oyning 10/20-kunlari yaqin bo'lganda yiqilardi
  const dated = all(["Har kuni 10:00 dan 20:00 gacha ishlaymiz"],
    'Name: X\n  2026-11-10 (dushanba): 10:00–10:30\n  2026-11-20 (juma): 11:00–17:30\n  20.11.2026 kuni bayram\n  Yangilandi 2026-11-16T20:00', 'ish vaqti');
  ok("sana va vaqt belgisi («2026-11-20», «20.11.2026», «…T20:00») soat deb olinmaydi", dated.pass, dated.info);
  const datedReply = all(["2026-11-17 kuni 11:00 dan 17:30 gacha bo'sh"], `${K}\n${SCHEDULE}`, null);
  ok("javobdagi sana soat oralig'i deb ushlanmaydi", datedReply.pass, datedReply.info);
}

console.log('\n# Manzil');
{
  const pass = all(["Manzilimiz: Navoiy ko'chasi 12", 'Мы на ул. Навои 12'.replace('Навои', 'Navoiy')], K, null);
  ok("ma'lumotdagi ko'cha — o'tadi", pass.pass, pass.info);
  const bad = all(["Biz Amir Temur shoh ko'chasida emas, Bobur ko'chasi 5 da", 'Chilonzor mavzesi 9-kvartal', 'ул. Пушкина 10'], K, 'manzil');
  ok("ma'lumotda yo'q ko'cha yoki mavze — ushlanadi", bad.pass, bad.info);
}

console.log('\n# Shifokor');
{
  const pass = all(['Doktor Karimov sizni qabul qiladi', 'Shifokor Aliyeva ortodont', 'Врач Rustam будет завтра'], K, null);
  ok("jamoadagi shifokor (ayol shakli ham) — o'tadi", pass.pass, pass.info);
  const bad = all(['Doktor Usmonov sizni qabul qiladi', 'Врач Петрова примет вас'], K, 'shifokor ismi');
  ok("jamoada ham, jadvalda ham yo'q shifokor — ushlanadi", bad.pass, bad.info);
  ok('faqat CRM jadvalidagi shifokor — o\'tadi', unknownFact('Doktor Karimov bo\'sh', `Name: X\n${SCHEDULE}`) === null);
}

console.log('\n# Oddiy javob');
{
  const plain = all(['Assalomu alaykum! Qanday yordam bera olaman?', "Rahmat, tez orada javob beramiz.", 'Shifokor sizni ko\'rib chiqadi'], K, null);
  ok('fakt yo\'q — tegilmaydi', plain.pass, plain.info);
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
