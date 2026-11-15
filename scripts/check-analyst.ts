/**
 * Tahlilchining haftalik hisobi (server/analyst/weekly.ts, B4) — AI'siz:
 *   matn: kanallar «murojaat → yozildi → to'ladi · pul», xizmatlar bo'yicha tushum, kodda chiqarilgan xulosa;
 *   ertalab: Tahlilchi jamoada bo'lsa — o'tgan hafta bir marta hisoblanadi, saqlanadi, jurnalga yoziladi; Direktorga xulosa.
 * Ishga tushirish: npx tsx scripts/check-analyst.ts
 */
import './isolate';
import assert from 'node:assert/strict';

const { businesses, inbox, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { hashPassword } = await import('../server/auth');
const { analystMorning, analystWeeks, weekFindings, weekHtml, weekVerdict } = await import('../server/analyst/weekly');
const { periodRange } = await import('../server/crm/report');
const { iso } = await import('../src/lib/week');
const { events } = await import('../server/orders/store');

let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const week = { from: '2026-11-02', to: '2026-11-08', createdAt: '2026-11-09T05:00:00Z' };

await check("matn: kanal bo'yicha murojaatdan pulgacha, xizmatlar, eng ko'p pul bergan kanal", async () => {
  const w = {
    ...week, crm: true, demand: 'Implant narxini ko\'p so\'rashdi',
    channels: [
      { channel: 'instagram' as const, inquiries: 12, booked: 5, paid: 3, revenue: 6_000_000 },
      { channel: 'telegram' as const, inquiries: 4, booked: 0, paid: 0, revenue: 0 },
      { channel: 'call' as const, inquiries: 3, booked: 2, paid: 1, revenue: 2_000_000 },
    ],
    services: [{ name: 'Implant', revenue: 12_000_000, count: 3 }, { name: '<b>Plomba</b>', revenue: 900_000, count: 3 }],
  };
  const html = weekHtml(w)!;
  assert.match(html, /o'tgan hafta<\/b> \(02\.11–08\.11\)/);
  assert.match(html, /Instagram: 12 murojaat → 5 yozildi → 3 to'ladi · 6 mln so'm/);
  assert.match(html, /klinika jami: 12,9 mln so'm/);
  assert.match(html, /Implant — 12 mln so'm \(3 to'lov\)/);
  assert.ok(!html.includes('<b>Plomba'), 'xizmat nomi HTML sifatida chiqmaydi');
  assert.deepEqual(weekVerdict(w), ["💡 Eng ko'p pul — Instagramdan (75%)", '⚠️ Telegramdan 4 murojaat — birortasi qabulga yozilmadi']);
  assert.match(html, /🗣 Mijozlar so'radi: Implant narxini/);
});

await check("CRM'siz: to'lov yo'q — eng ko'p qabul bergan kanal va «DentaCRM ulansa»; raqam yo'q — xabar yo'q", async () => {
  const w = { ...week, crm: false, demand: null, services: null, channels: [{ channel: 'telegram' as const, inquiries: 5, booked: 2, paid: null, revenue: null }] };
  const html = weekHtml(w)!;
  assert.match(html, /Telegram: 5 murojaat → 2 yozildi$/m);
  assert.match(html, /DentaCRM ulansa/);
  assert.deepEqual(weekVerdict(w), ["💡 Eng ko'p qabul — Telegramdan (2 ta)"]);
  assert.equal(weekHtml({ ...w, channels: [] }), null);
});

await check("ertalab: Tahlilchi jamoada — o'tgan hafta bir marta hisoblanadi, jurnalga yoziladi, Direktorga xulosa; olinmagan — yo'q", async () => {
  const now = new Date();
  const last = periodRange('last_week', iso(now));
  const biz = businesses.create('tahlil', hashPassword('sinov-parol-1'), emptyBusiness('Tabassum', 'Stomatologiya'));
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  const lead = leads.add(biz.id, { name: 'Ali', phone: null, note: null, source: 'Instagram' });
  inbox.add(biz.id, { leadId: lead.id, channel: 'instagram', direction: 'in', by: 'customer', text: 'Narxi qancha?', at: new Date(`${last.from}T10:00:00`).toISOString() });
  assert.equal(await analystMorning(businesses.byId(biz.id)!, now), null, 'Tahlilchi olinmagan');
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona', 'tahlilchi'], dismissed: [] }) });
  const html = await analystMorning(businesses.byId(biz.id)!, now);
  assert.ok(html?.includes('Instagram: 1 murojaat → 0 yozildi'), String(html));
  assert.equal(analystWeeks.latest(biz.id)?.from, last.from);
  assert.equal(await analystMorning(businesses.byId(biz.id)!, now), null, 'shu hafta qayta yuborilmaydi');
  assert.ok(events.list(biz.id, 'tahlilchi').some(e => e.title.startsWith('Haftalik hisobot')), 'jurnalda');
  assert.match(weekFindings(biz.id), /instagram: 1 → 0/);
});

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
