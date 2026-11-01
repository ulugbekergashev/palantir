/**
 * Jonli tekshiruv: Targetolog AI'si egasining topshirig'idan reja tuzadi (Meta'ga hech narsa yuborilmaydi). Byudjet aytilmagan
 * topshiriqda byudjet o'ylab topilmasligi tekshiriladi. AI — .env dagi AI_ENGINE (obuna yoki API kalit).
 * Ishga tushirish: npx tsx scripts/live-ads-plan.ts
 */
import './isolate';
import assert from 'node:assert/strict';

process.env.AI_ENGINE ||= 'subscription';
const { businesses } = await import('../server/db');
const { planFromTask } = await import('../server/ads/planner');

const biz = businesses.create(`reja${Date.now()}`, 'x', { name: 'Tabassum stomatologiya', ownerName: 'Dilshod', industry: 'stomatologiya', phone: '', address: 'Toshkent', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);

const t0 = Date.now();
const p1 = await planFromTask(biz, "Implant bo'yicha bepul konsultatsiya reklamasi. Jami 60 dollar, 6 kun, Toshkent, 30-60 yosh. Odamlar Instagram Direct'ga yozsin.");
console.log(`\n1) ${((Date.now() - t0) / 1000).toFixed(1)} s\n${JSON.stringify(p1, null, 2)}`);
assert.equal(p1.budget, 60);
assert.equal(p1.days, 6);
assert.equal(p1.destination, 'instagram');
assert.ok(p1.ageMin >= 30 && p1.ageMax <= 60);
assert.ok(p1.cities.some(c => /tash|tosh/i.test(c.name)));

const t1 = Date.now();
const p2 = await planFromTask(biz, "Tish oqartirish aksiyasini reklama qil, WhatsApp'ga yozishsin, Samarqandda");
console.log(`\n2) ${((Date.now() - t1) / 1000).toFixed(1)} s → budget: ${p2.budget}, destination: ${p2.destination}, notes: ${p2.notes.join(' | ')}`);
assert.equal(p2.budget, null, "byudjet o'ylab topilmasligi kerak");
assert.equal(p2.destination, 'whatsapp');

console.log('\nJonli tekshiruv o\'tdi');
process.exit(0);
