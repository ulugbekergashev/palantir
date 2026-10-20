/**
 * Baza nashri (PRAGMA user_version). Jadval va ustun qo'shish — har modulning o'zida («CREATE … IF NOT EXISTS», ensureColumns):
 * u har ishga tushishda bajariladi va nashr talab qilmaydi. Nomni o'zgartirish, ustun yoki jadvalni olib tashlash kabi
 * qo'shimcha bo'lmagan o'zgarish — MIGRATIONS ga keyingi raqam bilan yoziladi va har bazada bir marta bajariladi:
 *   - yangi (bo'sh) baza darhol oxirgi nashrni oladi — tuzilmani joriy kod yaratadi;
 *   - eski bazada avval to'liq nusxa olinadi (<backupDir>/oldin-v<N>-<vaqt>.db), har migratsiya o'z tranzaksiyasida;
 *   - baza dasturdan yangiroq bo'lsa (dastur eski nashrga qaytarilgan) — SchemaTooNew: eski kod yangi tuzilmani buzmasin.
 * Bazaning boshqa jadvallaridan oldin (db.ts boshida) chaqiriladi: nomi o'zgargan jadvalni CREATE bo'sh holda qayta yaratib qo'ymasin.
 * Modul env'ga bog'liq emas — sinov uni bazani ochmasdan import qila oladi.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

interface Migration { version: number; about: string; up: (db: DatabaseSync) => void }

export const MIGRATIONS: Migration[] = [
  { version: 1, about: "bazaning nashri shu yerdan yuritiladi (tuzilma o'zgarmaydi)", up: () => {} },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export class SchemaTooNew extends Error {
  constructor(readonly found: number) {
    super(`Baza yangiroq nashrniki (v${found}), bu dastur esa v${SCHEMA_VERSION} gacha biladi. Dasturni yangilang yoki bazani shu nashrdagi zaxiradan qaytaring`);
  }
}

export function migrate(db: DatabaseSync, backupDir: string): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > SCHEMA_VERSION) throw new SchemaTooNew(current);
  if (current === SCHEMA_VERSION) return;
  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
  if (!fresh) {
    mkdirSync(backupDir, { recursive: true });
    const file = join(backupDir, `oldin-v${SCHEMA_VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`[baza] v${current} → v${SCHEMA_VERSION}: avval nusxa olindi — ${file}`);
    for (const m of MIGRATIONS.filter(x => x.version > current)) {
      db.exec('BEGIN');
      try {
        m.up(db);
        db.exec(`PRAGMA user_version = ${m.version}`);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      console.log(`[baza] v${m.version}: ${m.about}`);
    }
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
