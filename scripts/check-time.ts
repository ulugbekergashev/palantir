/**
 * Vaqt: bazadagi UTC vaqt mahalliy kunga to'g'ri o'tadimi (G7 — «Bugun N qo'ng'iroq» tungi qo'ng'iroqlarni yo'qotardi).
 * Ishga tushirish: npm run test:time
 */
export {};
// Soat mintaqasi sanalar hisoblanishidan oldin qo'yiladi (shuning uchun import — keyin, dinamik)
process.env.TZ = 'Asia/Tashkent';
const { localDay } = await import('../src/lib/week');

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}

// Toshkent = UTC+5: 14-noyabr 02:30 (Toshkent) = 13-noyabr 21:30 UTC
ok("tungi 02:30 dagi qo'ng'iroq — Toshkentda bugungi kun (UTC bo'yicha kecha edi)", localDay('2026-11-13T21:30:00.000Z') === '2026-11-14', localDay('2026-11-13T21:30:00.000Z'));
ok('kunduzgi 15:00 — o\'sha kun', localDay('2026-11-14T10:00:00.000Z') === '2026-11-14');
ok('23:59 (Toshkent) — hali bugun, ertaga emas', localDay('2026-11-14T18:59:00.000Z') === '2026-11-14');
ok('00:00 (Toshkent) — yangi kun', localDay('2026-11-14T19:00:00.000Z') === '2026-11-15');

if (failed) {
  console.error(`\n${failed} ta sinov yiqildi`);
  process.exit(1);
}
console.log("\nHammasi o'tdi");
