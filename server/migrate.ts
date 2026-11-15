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

const tableHas = (db: DatabaseSync, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column);
const parse = (raw: string | null): Record<string, unknown> | null => {
  try { const v = JSON.parse(raw ?? 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * B1: AI administrator (qabulxona) endi olib tashlanmaydi. Oldin egasi uni olib tashlagan bo'lsa, yangilanish bemorlarga javobni
 * o'zidan yoqib yubormasin — o'sha holat aniq sozlamaga ko'chiriladi: mijozlarga javob «o'chiq», telefon liniyasi (sozlangan bo'lsa)
 * «faqat administrator». Direktor endi qo'shimcha xodim: tarkibi hisoblangan har jamoada u ishga olinganlar ro'yxatiga yoziladi
 * (avval asosiy bo'lgani uchun ro'yxatda yo'q edi) — yangilanishdan keyin jamoadan yo'qolmaydi
 */
function migrateCoreReception(db: DatabaseSync): void {
  if (!tableHas(db, 'businesses', 'crew')) return;
  const rows = db.prepare('SELECT id, crew, profile FROM businesses').all() as { id: string; crew: string | null; profile: string }[];
  const lines = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connections'").get() as { name: string } | undefined) !== undefined;
  for (const r of rows) {
    const crew = parse(r.crew);
    if (!crew) continue;
    const hired = list(crew.hired), dismissed = list(crew.dismissed);
    const next = {
      hired: [...hired.filter(m => m !== 'qabulxona'), ...(hired.includes('direktor') || dismissed.includes('direktor') ? [] : ['direktor'])],
      dismissed: dismissed.filter(m => m !== 'qabulxona'),
    };
    db.prepare('UPDATE businesses SET crew = ? WHERE id = ?').run(JSON.stringify(next), r.id);
    if (!dismissed.includes('qabulxona')) continue;
    const profile = parse(r.profile);
    if (profile) {
      const reply = parse(JSON.stringify(profile.autoReply ?? null)) ?? { contacts: false, delayMin: 2 };
      db.prepare('UPDATE businesses SET profile = ? WHERE id = ?').run(JSON.stringify({ ...profile, autoReply: { ...reply, mode: 'off' } }), r.id);
    }
    if (!lines) continue;
    const line = db.prepare("SELECT meta FROM connections WHERE business_id = ? AND kind = 'sip_line'").get(r.id) as { meta: string } | undefined;
    if (line) db.prepare("UPDATE connections SET meta = ? WHERE business_id = ? AND kind = 'sip_line'").run(JSON.stringify({ ...parse(line.meta), mode: 'human' }), r.id);
  }
}

export const MIGRATIONS: Migration[] = [
  { version: 1, about: "bazaning nashri shu yerdan yuritiladi (tuzilma o'zgarmaydi)", up: () => {} },
  {
    version: 2,
    about: 'postlar va Telegram kanal olib tashlandi: posts jadvali, businesses.channel_id va channel_title',
    up: db => {
      db.exec('DROP TABLE IF EXISTS posts');
      const have = new Set((db.prepare('PRAGMA table_info(businesses)').all() as { name: string }[]).map(c => c.name));
      for (const column of ['channel_id', 'channel_title']) if (have.has(column)) db.exec(`ALTER TABLE businesses DROP COLUMN ${column}`);
    },
  },
  {
    version: 3,
    about: "AI administrator — asosiy xodim, Direktor — qo'shimcha (B1): uni olib tashlagan klinikada javob «o'chiq», telefon «faqat administrator»",
    up: db => migrateCoreReception(db),
  },
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
