/**
 * Umumiy telefon (F12): bir raqamda bir nechta karta (oila) — ism noma'lum qo'ng'iroq eng so'nggi faol kartaga yoziladi
 * (avval doim eng eskisiga); ism ma'lum bo'lsa — mos karta. AI'siz, vaqtinchalik bazada.
 * Ishga tushirish: npx tsx scripts/check-people.ts
 */
import './isolate';
import assert from 'node:assert/strict';

const { businesses, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { hashPassword } = await import('../server/auth');
const { leadForPhone } = await import('../server/people');
const { sql } = await import('../server/db');

let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`); }
}

const biz = businesses.create('oila', hashPassword('sinov-parol-1'), emptyBusiness('Tabassum', 'Stomatologiya'));
const phone = '+998901112233';
const mother = leads.add(biz.id, { name: 'Malika Yusupova', phone, note: null, source: "Qo'ng'iroq" });
const son = leads.add(biz.id, { name: 'Sardor Yusupov', phone, note: null, source: 'Telegram' });
// Ona — eski karta, o'g'li — bugun yozgan
sql.run('UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?', '2026-01-01T09:00:00.000Z', '2026-01-02T09:00:00.000Z', mother.id);
sql.run('UPDATE leads SET created_at = ?, updated_at = ?, last_inbound_at = ? WHERE id = ?', '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z', '2026-11-15T08:00:00.000Z', son.id);

await check("ism noma'lum (MicroSIP) — eng so'nggi faol karta, eng eskisi emas", () => {
  assert.equal(leadForPhone(biz, phone, { name: null, source: "Qo'ng'iroq" }).id, son.id);
});
await check("ism ma'lum — o'sha odamning kartasi", () => {
  assert.equal(leadForPhone(biz, phone, { name: 'Malika Yusupova', source: "Qo'ng'iroq" }).id, mother.id);
});
await check('bitta karta — o\'sha; yangi raqam — yangi karta', () => {
  const solo = leads.add(biz.id, { name: 'Ali', phone: '+998935550000', note: null, source: "Qo'ng'iroq" });
  assert.equal(leadForPhone(biz, '+998935550000', { name: null, source: "Qo'ng'iroq" }).id, solo.id);
  const fresh = leadForPhone(biz, '+998935559999', { name: null, source: "Qo'ng'iroq" });
  assert.ok(fresh.id !== solo.id && fresh.phone?.endsWith('935559999'));
});

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
