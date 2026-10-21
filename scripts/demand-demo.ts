/**
 * Talab tahlili — haqiqiy model bilan namoyish (pulli: ~0,2–0,4 $). Alohida bo'sh bazaga stomatologiya klinikasiga o'xshash murojaatlar
 * (yozishmalar, qo'ng'iroqlar, so'rovlar — oxirgi 6 kun) yoziladi va server/insights/analyze.ts ishga tushadi; natija ekranga va
 * tmp/talab-namuna.json ga. Haqiqiy ma'lumotga tegmaydi (baza — tmp/talab-demo). Ishga tushirish: npx tsx scripts/demand-demo.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tmp/talab-demo — panelni shu baza bilan ochib ko'rish uchun (login: talab-demo / demo-parol-1); har ishga tushganda yangidan
process.env.DATA_DIR = resolve('tmp/talab-demo');
rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.env.ASTERISK_WSL = '0';
const SANDBOX = process.env.DATA_DIR;
const { env } = await import('../server/env');
if (resolve(env.dataDir) !== resolve(SANDBOX)) throw new Error(`Sinov bazasi emas: ${env.dataDir}`);
const { businesses, calls, inbox } = await import('../server/db');
const { sql } = await import('../server/db');
await import('../server/requests/store');   // requests jadvali shu modulda yaratiladi
const { analyzeDemand } = await import('../server/insights/analyze');
const { hashPassword } = await import('../server/auth');

const biz = businesses.create('talab-demo', hashPassword('demo-parol-1'), {
  name: 'Tabassum Dental', ownerName: 'Dilshod', industry: 'stomatologiya', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 9-kvartal',
  contentLang: 'uz', brand: { primary: '#0F766E', accent: '#F59E0B' },
  offerings: [{ id: 'a', name: 'Implant (Koreya)', price: 4_500_000 }, { id: 'b', name: 'Tish oqartirish', price: 1_200_000 }, { id: 'c', name: 'Breket (metall)', price: 6_000_000 }],
  team: [],
});

/** n kun oldin, soat h:m (mahalliy vaqt) */
const at = (n: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const ASK = "Aniqlab, sizga tez orada javob beramiz.";
type Chat = [string, string, string | null, number, number];   // kanal, mijoz gapi, bizning javob (null — javobsiz), necha kun oldin, soat
const CHATS: Chat[] = [
  ['instagram', 'Implant qancha turadi?', "Implant (Koreya) — 4 500 000 so'm.", 5, 21],
  ['telegram', 'Implant necha pul, kafolat beriladimi?', ASK, 5, 22],
  ['instagram', "Osstem implant bormi? Narxi qancha?", ASK, 4, 20],
  ['telegram', "2 ta implant qo'ydirsam qancha bo'ladi? Koronka bilan", "Implant 4 500 000 so'mdan, koronka narxini aniqlab beramiz.", 3, 13],
  ['instagram', 'Implant + koronka hammasi qancha?', ASK, 2, 23],
  ['instagram', "Implant qimmat ekan, Yunusobodda 3 mln ga qo'yishyapti", null, 2, 21],
  ['telegram', "Bolalar doktori bormi? 5 yoshli o'g'limning tishi og'riyapti", "Ha, bolalar stomatologimiz bor. Qachon kelasiz?", 5, 9],
  ['instagram', 'Bolalarni narkoz bilan davolaysizlarmi?', ASK, 4, 22],
  ['telegram', 'Sut tishini davolaysizlarmi yoki olib tashlaysizlarmi?', ASK, 1, 20],
  ['instagram', 'Bola tishini olish qancha?', null, 0, 21],
  ['telegram', 'Shanba kuni ishlaysizlarmi?', "Shanba 9:00–15:00 ishlaymiz.", 5, 18],
  ['instagram', 'Yakshanba ochiqmi?', null, 6, 11],
  ['telegram', "Kechqurun 19:00 dan keyin qabul bormi? Ishdan keyin kelaman", "Afsuski, 18:00 gacha ishlaymiz.", 3, 19],
  ['instagram', 'Kechqurun ishlamas ekansizlar, rahmat', null, 3, 19],
  ['instagram', 'Tish oqartirish qancha?', "Tish oqartirish — 1 200 000 so'm.", 4, 12],
  ['telegram', "Oqartirishdan keyin og'riq bo'ladimi?", ASK, 2, 22],
  ['instagram', "Zoom oqartirish qilasizlarmi?", ASK, 1, 21],
  ['telegram', "Bo'lib to'lash bormi?", ASK, 5, 20],
  ['instagram', "Uzum nasiya orqali to'lasa bo'ladimi?", ASK, 3, 22],
  ['telegram', "Breketni bo'lib to'lasa bo'ladimi? Oyma-oy", ASK, 1, 19],
  ['instagram', "Implantni bo'lib to'lab qo'ydirsa bo'ladimi?", null, 0, 22],
  ['instagram', 'Breket qancha?', "Metall breket — 6 000 000 so'm.", 4, 17],
  ['telegram', 'Keramik breket narxi qancha?', ASK, 2, 21],
  ['telegram', "Tishim qattiq og'riyapti, bugun qabul qilasizmi?", "Bugun 16:30 ga kelishingiz mumkin.", 3, 8],
  ['instagram', "Navbat bir haftaga ekan, kuta olmayman", null, 2, 10],
  ['telegram', 'Manzilingiz qayerda? Mashina qo‘yish joyi bormi?', "Chilonzor 9-kvartal. Mashina joyi — aniqlab aytamiz.", 1, 13],
  ['instagram', 'Uzoq ekan, Yunusobodda filialingiz yo‘qmi?', null, 1, 14],
];
const CALLS: [string, string | null, string, number, number][] = [
  ['+998901000001', 'Implant narxini bilmoqchi edim, kafolati necha yil?', "Narx aytildi, kafolatni aniqlab qayta qo'ng'iroq", 4, 11],
  ['+998901000002', null, 'missed', 5, 21],
  ['+998901000003', null, 'missed', 3, 20],
  ['+998901000004', "Yuzim shishib ketdi, tishim og'riyapti, hozir kelsam bo'ladimi?", 'Shoshilinch — bugunga yozildi', 2, 9],
  ['+998901000005', null, 'missed', 1, 22],
  ['+998901000006', "Bolam uchun bolalar doktoriga yozilmoqchiman, shanba kuni", "Shanba 10:00 ga yozildi", 0, 12],
];
let i = 0;
for (const [channel, said, reply, n, h] of CHATS) {
  const lead = `L${++i}`;
  inbox.add(biz.id, { leadId: lead, channel: channel as 'telegram', direction: 'in', by: 'customer', text: said, at: at(n, h, 5) });
  if (reply) inbox.add(biz.id, { leadId: lead, channel: channel as 'telegram', direction: 'out', by: 'palantir', text: reply, at: at(n, h, 7) });
}
for (const [phone, said, outcome, n, h] of CALLS) {
  const c = calls.create(biz.id, { phone, name: null, startedAt: at(n, h, 15), durationSec: said ? 90 : 0, outcome, booked: null, transcript: said ? [{ who: 'ai', text: 'Assalomu alaykum, Tabassum Dental' }, { who: 'caller', text: said }] : [] });
  if (!said) sql.run("UPDATE calls SET status = 'missed', direction = 'in' WHERE id = ?", c.id);
}
sql.run("INSERT INTO requests (id, business_id, kind, status, phone, summary, source, created_at, updated_at) VALUES ('q1', ?, 'complaint', 'open', '+998901000007', 'Qabulda 40 daqiqa kutdim, vaqtimga chaqirishmadi', 'telegram', ?, ?)", biz.id, at(2, 15), at(2, 15));
sql.run("INSERT INTO requests (id, business_id, kind, status, phone, summary, source, created_at, updated_at) VALUES ('q2', ?, 'callback', 'open', '+998901000008', 'Implant bo‘yicha konsultatsiya, kechqurun qo‘ng‘iroq qilinsin', 'call', ?, ?)", biz.id, at(1, 20), at(1, 20));

const t0 = Date.now();
const x = await analyzeDemand(biz, 7);
console.log(`tahlil: ${Math.round((Date.now() - t0) / 1000)} s · ${x.totals.items} band (${x.totals.messages} yozishma, ${x.totals.calls} qo'ng'iroq, ${x.totals.requests} so'rov)\n`);
console.log(`XULOSA: ${x.headline}\n`);
console.log('MIJOZLAR NIMANI SO\'RAYAPTI:');
for (const t of x.themes) console.log(`  ${String(t.count).padStart(2)} (${Math.round(t.share * 100)}%)  ${t.name}  — «${t.examples[0] ?? ''}»`);
console.log('\nJAVOB TOPILMAGAN SAVOLLAR:');
for (const g of x.unanswered) console.log(`  ${g.count} kishi — ${g.name}`);
console.log("\nNIMA TO'XTATDI:");
for (const g of x.objections) console.log(`  ${g.count} kishi — ${g.name}`);
console.log('\nSHU HAFTA NIMA QILISH KERAK:');
for (const a of x.actions) console.log(`  • ${a.title}\n    ${a.why}`);
console.log(`\nsoat bo'yicha: ${x.hours.map((n, h) => (n ? `${h}:00=${n}` : '')).filter(Boolean).join(' ')}`);
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/talab-namuna.json', JSON.stringify(x, null, 2));
