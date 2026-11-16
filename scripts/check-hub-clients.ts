/**
 * Hub: mijoz kartalari va kunlik ko'rsatkichlar (hub/clients.ts) — xotiradagi baza bilan, tarmoqsiz.
 * Ishga tushirish: npm run test:hub-clients
 */
import { DatabaseSync } from 'node:sqlite';
import { CardError, createClients } from '../hub/clients.ts';

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}
const rejects = (fn: () => unknown, text: string) => {
  try { fn(); return false; } catch (e) { return e instanceof CardError && e.code === 400 && e.message.includes(text); }
};

let clock = new Date('2026-11-16T10:00:00Z');
const db = new DatabaseSync(':memory:');
const clients = createClients(db, () => clock);

console.log('\n# Karta');
{
  const card = clients.save('c1', { owner: '  Akmal   Karimov ', phone: '+998 90 123-45-67', city: 'Toshkent', kind: 'clinic', plan: '500 000', paidUntil: '2026-12-01', note: 'Yillik\n\n\n\nkelishuv' }, 'Ulug\'bek');
  ok("yoziladi va tozalanadi (bo'sh joylar, «500 000» → son, ortiqcha qatorlar)", card.owner === 'Akmal Karimov' && card.plan === 500000 && card.note === 'Yillik\n\nkelishuv' && card.updatedBy === "Ulug'bek", JSON.stringify(card));
  ok("o'qiladi — cards() va card()", clients.cards().get('c1')?.phone === '+998 90 123-45-67' && clients.card('c1')?.city === 'Toshkent');
  const cleared = clients.save('c1', { owner: '', kind: '', plan: '', paidUntil: '' }, 'X');
  ok("bo'sh maydon — null (karta to'liq almashadi)", cleared.owner === null && cleared.kind === null && cleared.plan === null && cleared.paidUntil === null && cleared.phone === null);
  ok("noto'g'ri sana — rad", rejects(() => clients.save('c1', { paidUntil: '2026-02-30' }, 'X'), 'sana'));
  ok("noto'g'ri tur — rad", rejects(() => clients.save('c1', { kind: 'bank' }, 'X'), 'turi'));
  ok("manfiy yoki kasr tarif — rad", rejects(() => clients.save('c1', { plan: -5 }, 'X'), 'Tarif') && rejects(() => clients.save('c1', { plan: '12.5' }, 'X'), 'Tarif'));
  ok("telefon o'rniga matn — rad", rejects(() => clients.save('c1', { phone: 'ertaga qo\'ng\'iroq' }, 'X'), 'Telefon'));
  ok("boshqaruv belgilari olib tashlanadi", clients.save('c1', { owner: 'A\u0000B\u0007C' }, 'X').owner === 'A B C');
  clients.remove('c1');
  ok("o'chiriladi", clients.card('c1') === null);
}

console.log("\n# Ishlash holati (to'lov nazorati)");
{
  const M = 'AAAA-BBBB-CCCC-DDDD';
  ok("yozuv yo'q — active", clients.access('k1').state === 'active' && clients.grantFor('k1', M).state === 'active');
  ok("noto'g'ri holat — rad", rejects(() => clients.setAccess('k1', { state: 'yopiq' }, 'X'), 'Holat'));
  const blocked = clients.setAccess('k1', { state: 'blocked', message: "  To'lov   yo'q " }, 'Asoschi', M);
  ok("to'xtatildi: matn tozalanadi, kim qo'ygani yoziladi", blocked.state === 'blocked' && blocked.message === "To'lov yo'q" && blocked.updatedBy === 'Asoschi');
  ok("ro'yxatda (accessAll)", clients.accessAll().get('k1')?.state === 'blocked');
  ok("o'sha kompyuter yangi yozuv olsa (qayta o'rnatish) — baribir to'xtatilgan", clients.grantFor('k2', M).state === 'blocked' && clients.grantFor('k3', 'EEEE-0000-0000-0000').state === 'active');
  clients.remove('k1');
  ok("to'xtatilgan yozuv o'chirilsa ham kompyuter to'xtatilganligicha qoladi", clients.grantFor('k2', M).state === 'blocked');
  clients.setAccess('k2', { state: 'active' }, 'Asoschi', M);
  ok("yangi yozuvda «Ochish» — kompyuterning eski to'xtatishi ham olib tashlanadi", clients.grantFor('k2', M).state === 'active');
  clients.setAccess('k4', { state: 'warn', message: 'Muddat yaqin' }, 'Asoschi');
  clients.noteMachine('k4', 'FFFF-0000-0000-0000');
  clients.setAccess('k4', { state: 'blocked' }, 'Asoschi');
  ok("kompyuter kodi heartbeat'dan yoziladi (qo'lda ochilgan yozuv) va to'xtatishda saqlanib qoladi", clients.grantFor('k9', 'FFFF-0000-0000-0000').state === 'blocked');
  const opened = clients.setAccess('k4', { state: 'active', message: 'kerak emas' }, 'Asoschi', 'FFFF-0000-0000-0000');
  ok("«active» da matn saqlanmaydi", opened.message === null);
}

console.log('\n# Tarif (modullar)');
{
  const M = '1111-2222-3333-4444', M2 = '5555-6666-7777-8888';
  ok("tanlanmagan — hammasi (null), «tanlangan» emas", clients.access('t1').modules === null && !clients.access('t1').modulesSet);
  ok("noma'lum modul yoki noto'g'ri shakl — rad", rejects(() => clients.setModules('t1', { modules: ['bank'] }, 'X'), 'Modullar') && rejects(() => clients.setModules('t1', {}, 'X'), 'Modullar'));
  const set = clients.setModules('t1', { modules: ['telefon', 'tahlilchi'] }, 'Asoschi', M);
  ok("saqlanadi (MODULES tartibida), holat o'zgarmaydi", JSON.stringify(set.modules) === '["tahlilchi","telefon"]' && set.modulesSet && set.state === 'active', JSON.stringify(set));
  clients.setAccess('t1', { state: 'warn', message: "To'lov" }, 'Asoschi', M);
  ok("holat almashsa tarif qoladi", JSON.stringify(clients.access('t1').modules) === '["tahlilchi","telefon"]' && clients.access('t1').state === 'warn');
  clients.setAccess('t1', { state: 'active' }, 'Asoschi', M);
  ok("o'sha kompyuter yangi yozuv olsa (qayta o'rnatish) — o'sha tarif", JSON.stringify(clients.grantFor('t2', M).modules) === '["tahlilchi","telefon"]' && clients.grantFor('t3', M2).modules === null);
  clients.remove('t1');
  ok("cheklangan tarifli yozuv o'chirilsa ham kompyuter tarifi qoladi", JSON.stringify(clients.grantFor('t2', M).modules) === '["tahlilchi","telefon"]');
  clients.setModules('t2', { modules: 'all' }, 'Asoschi', M);
  ok("yangi yozuvda «hammasi» tanlansa — o'shasi (eski cheklov emas)", clients.grantFor('t2', M).modules === null && clients.grantFor('t2', M).modulesSet);
  clients.setModules('t4', { modules: [] }, 'Asoschi', M2);
  ok("bo'sh ro'yxat — faqat asosiy xodimlar", JSON.stringify(clients.grantFor('t4', M2).modules) === '[]');
  clients.setModules('t5', { modules: 'all' }, 'Asoschi', 'AAAA-0000-0000-0000');
  clients.remove('t5');
  ok("«hammasi» bo'lgan (cheklovsiz) yozuv o'chirilsa — qoldiq yo'q", clients.grantFor('t6', 'AAAA-0000-0000-0000').modulesSet === false);
  clients.setAccess('t7', { state: 'blocked' }, 'Asoschi', 'BBBB-0000-0000-0000');
  clients.setModules('t8', { modules: ['direktor'] }, 'Asoschi', 'BBBB-0000-0000-0000');
  const g = clients.grantFor('t8', 'BBBB-0000-0000-0000');
  ok("to'xtatish boshqa yozuvdan, tarif o'zinikidan — ikkalasi birga", g.state === 'blocked' && JSON.stringify(g.modules) === '["direktor"]', JSON.stringify(g));
  // Eski yozuv: to'xtatilgan + cheklangan tarif; kompyuter qayta o'rnatib yangi yozuv oldi, sotuvchi yangisini «Ochish» qildi
  const C = 'CCCC-0000-0000-0000';
  clients.setModules('o1', { modules: ['tahlilchi'] }, 'Ali', C);
  clients.setAccess('o1', { state: 'blocked' }, 'Ali', C);
  clients.setAccess('o2', { state: 'active' }, 'Vali', C);
  const o = clients.grantFor('o2', C);
  ok("«Ochish» boshqa yozuvdagi to'xtatishni oladi, lekin o'sha kompyuter tarifi qoladi", o.state === 'active' && JSON.stringify(o.modules) === '["tahlilchi"]', JSON.stringify(o));
  clients.setAccess('o3', { state: 'blocked', message: "To'lov" }, 'Ali');
  clients.setModules('o3', { modules: 'all' }, 'Vali');
  const a3 = clients.access('o3');
  ok("tarif o'zgarsa holat muallifi o'zgarmaydi (tarifniki alohida)", a3.updatedBy === 'Ali' && a3.modulesBy === 'Vali' && a3.state === 'blocked', JSON.stringify(a3));
}

console.log("\n# Ko'rsatkichlar");
{
  clock = new Date('2026-11-14T08:10:00Z');
  clients.snapshot(4, 4, 0);
  clock = new Date('2026-11-14T08:50:00Z');
  clients.snapshot(4, 2, 1);
  clock = new Date('2026-11-14T09:05:00Z');
  clients.snapshot(4, 4, 3);
  clock = new Date('2026-11-16T12:00:00Z');
  clients.snapshot(5, 5, 0);
  const h = clients.history(14);
  ok("bir soatda bitta qator (oxirgisi), kunlik o'rtacha va eng ko'p muammo", h.length === 2 && h[0].day === '2026-11-14' && h[0].online === 3 && h[0].problems === 3 && h[1].total === 5, JSON.stringify(h));
  clock = new Date('2026-12-20T12:00:00Z');
  clients.snapshot(6, 6, 0);
  ok("30 kundan eskisi o'chadi, 14 kundan eskisi grafikka tushmaydi", clients.history(14).length === 1 && (db.prepare('SELECT COUNT(*) AS n FROM client_stats').get() as { n: number }).n === 1);
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
