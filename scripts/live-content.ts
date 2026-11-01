/**
 * Jonli tekshiruv: Kontent-meyker haqiqiy ochiq kanal sahifasini o'qib, AI bilan qoralama yozadimi. Vaqtinchalik bazada; kanalga
 * hech narsa joylanmaydi (bot ulanmagan). AI — .env dagi AI_ENGINE (obuna yoki API kalit).
 * Ishga tushirish: npx tsx scripts/live-content.ts [kanal_nomi]
 */
import './isolate';
import assert from 'node:assert/strict';

process.env.AI_ENGINE ||= 'subscription';
const source = process.argv[2] ?? 'hyperprostranstvo';

const { businesses } = await import('../server/db');
const { contentStore } = await import('../server/content/store');
const { runFactory } = await import('../server/content/factory');

const biz = businesses.create(`jonli${Date.now()}`, 'x', { name: 'Palantir', ownerName: "Ulug'bek", industry: 'dasturiy taʼminot', phone: '', address: 'Toshkent', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
contentStore.addSource(biz.id, source);
contentStore.saveSettings(biz.id, { perRun: 2, lang: 'uz', style: "Klinika va kichik biznes egalari uchun. «Siz» bilan. Qisqa gaplar." });

const t0 = Date.now();
const r = await runFactory(biz);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s → ${r.note}`);
for (const d of contentStore.drafts(biz.id)) console.log(`\n──── (${d.sourceUrl}) ────\n${d.text}`);
const src = contentStore.sources(biz.id)[0];
console.log(`\nManba: @${src.handle} «${src.title}», oxirgi o'qilgan post №${src.lastPost}`);
assert.ok(r.made >= 1, 'qoralama yozilmadi');
assert.ok(src.lastPost > 0);
console.log('\nJonli tekshiruv o\'tdi');
process.exit(0);
