/**
 * Bitta kompyuter — bitta profil: «bitta-profil» qoidasidan (ONE_PROFILE) oldin ochilib qolgan ortiqcha profillarni butunlay o'chirish.
 * Faqat NOFAOL (active = 0) profillar o'chiriladi va faqat bitta faol profil qolgan bo'lsa (qaysi biri qolishini egasi oldin tanlaydi:
 * ortiqchasini nofaol qiladi). O'chirishdan oldin baza nusxasi olinadi, profilning «miya» papkalari nusxa papkasiga ko'chiriladi.
 * Palantir to'xtatilgan bo'lishi kerak (node scripts/supervise.mjs stop).
 *
 * Ishga tushirish:  npx tsx scripts/remove-extra-profiles.ts --data C:\PalantirData          (faqat ko'rsatadi)
 *                   npx tsx scripts/remove-extra-profiles.ts --data C:\PalantirData --yes    (o'chiradi)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data');
const apply = process.argv.includes('--yes');
if (!dataDir || !existsSync(join(dataDir, 'palantir.db'))) {
  console.error('Foydalanish: npx tsx scripts/remove-extra-profiles.ts --data <DATA_DIR> [--yes]');
  process.exit(2);
}
const dbPath = join(dataDir, 'palantir.db');

interface Biz { id: string; login: string; active: number; name: string | null; tg: number }
const db = new DatabaseSync(dbPath, { readOnly: !apply });
const all = db.prepare("SELECT id, login, active, json_extract(profile, '$.name') AS name, owner_chat_id IS NOT NULL AS tg FROM businesses").all() as unknown as Biz[];
const keep = all.filter(b => b.active), drop = all.filter(b => !b.active);
console.log('Profillar:');
for (const b of all) console.log(`  ${b.active ? 'qoladi ' : "o'chadi"}  ${b.login} — ${b.name ?? ''}${b.tg ? ' (Telegram ulangan)' : ''}`);
if (keep.length !== 1) {
  console.error(`\nFaol profil ${keep.length} ta — bittasi qolishi kerak. Avval ortiqchasini nofaol qiling (active = 0).`);
  process.exit(1);
}
if (!drop.length) { console.log('\nOrtiqcha profil yo\'q.'); process.exit(0); }

// business_id ustuni bor hamma jadvallar — o'chiriladigan profilning yozuvlari
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(r => r.name)
  .filter(t => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).some(c => c.name === 'business_id'));
const counts = drop.map(b => tables.map(t => ({ t, n: Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE business_id = ?`).get(b.id) as { n: number }).n) })).filter(x => x.n > 0));
const miya = join(dataDir, 'miya');
const folders = (b: Biz) => (existsSync(miya) ? readdirSync(miya).filter(f => f === `${b.login}-${b.id}` || f.startsWith(`${b.login}-${b.id}.`)) : []);
drop.forEach((b, i) => {
  console.log(`\n${b.login}: ${counts[i].map(x => `${x.t} ${x.n}`).join(', ') || 'bazada yozuv yo\'q'}; miya: ${folders(b).join(', ') || "yo'q"}`);
});
if (!apply) { console.log('\nFaqat ko\'rsatildi. O\'chirish: --yes'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(dataDir, `zaxira-profil-ochirish-${stamp}`);
mkdirSync(backup, { recursive: true });
db.exec('PRAGMA wal_checkpoint(FULL)');
copyFileSync(dbPath, join(backup, 'palantir.db'));
db.exec('BEGIN');
try {
  for (const b of drop) {
    for (const t of tables) db.prepare(`DELETE FROM "${t}" WHERE business_id = ?`).run(b.id);
    db.prepare('DELETE FROM businesses WHERE id = ? AND active = 0').run(b.id);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error("\nO'chirilmadi:", (e as Error).message);
  process.exit(1);
}
for (const b of drop) for (const f of folders(b)) { mkdirSync(join(backup, 'miya'), { recursive: true }); renameSync(join(miya, f), join(backup, 'miya', f)); }
db.close();
console.log(`\nO'chirildi: ${drop.map(b => b.login).join(', ')}. Nusxa: ${backup}`);
