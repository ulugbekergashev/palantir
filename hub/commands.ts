/**
 * Masofadan amallar (hub/server.ts, 17-band): jamoa /admin dagi mijoz kartasidan klinika kompyuteriga buyruq beradi — diagnostika olish,
 * Palantir'ni qayta ishga tushirish, hozir yangilash, egasiga xabar. Buyruq navbat orqali (command) ketadi; klinika bajarib
 * POST /api/command/<id> bilan natijani qaytaradi (server/hubCommands.ts). Bu modul faqat baza bilan ishlaydi:
 * scripts/check-hub-commands.ts uni xotiradagi baza bilan sinaydi.
 *
 * Qayta ishga tushirish va yangilash eskirsa bajarilmaydi (kompyuter kechasi o'chiq bo'lgan — ertalab kutilmaganda to'xtamasin):
 * hub COMMAND_FRESH_MS dan eskisini navbatdan bermaydi (o'z soati bilan) va kartada «muddati o'tdi» deydi.
 */
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const COMMAND_ACTIONS = ['diag', 'restart', 'update', 'message'] as const;
export type CommandAction = typeof COMMAND_ACTIONS[number];
export const isCommandAction = (v: unknown): v is CommandAction => typeof v === 'string' && (COMMAND_ACTIONS as readonly string[]).includes(v);

/** To'xtatadigan amallar: shundan eskisi bajarilmaydi (hub/server.ts /api/pull navbatdan olib tashlaydi) */
export const COMMAND_FRESH_MS = 30 * 60_000;
/** Xabar va diagnostika — navbat saqlanadigan muddat (3 kun) ichida yetsa bo'ldi */
const COMMAND_KEEP_MS = 3 * 86_400_000;
export const MESSAGE_MIN = 3;
export const MESSAGE_MAX = 1000;
const NOTE_MAX = 300;
/** Kartada ko'rinadigan oxirgi buyruqlar */
export const COMMANDS_SHOWN = 6;
/** Bir klinikaga soatiga: tugma ketma-ket bosilsa klinika qayta-qayta to'xtamasin, egasining Telegrami to'lmasin */
export const COMMANDS_PER_HOUR = 10;
const HOUR_MS = 3_600_000;
const ROWS_KEEP_MS = 90 * 86_400_000;

export class CommandError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export type CommandState = 'sent' | 'done' | 'failed' | 'expired';
export interface CommandRow {
  id: string; clinicId: string; action: CommandAction; text: string | null; by: string | null; createdAt: string;
  state: CommandState; doneAt: string | null; note: string | null;
  /** Diagnostika fayli: /admin/diag/<klinika>/<fayl> */
  diag: string | null;
}

/** Boshqaruv belgilari olib tashlanadi, bo'sh joylar bittaga, qator tashlash qoladi (ketma-ket ikkitadan ko'p emas) */
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, c => (c === '\t' ? ' ' : ''))
  .replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const str = (v: unknown): string | null => (v == null ? null : String(v));
/**
 * Shuncha vaqt javob bo'lmasa — «muddati o'tdi» (yangisini berish mumkin). Diagnostika ham 30 daqiqa: eski Palantir buyruqni tushunmay
 * navbatdan olib qo'ysa, javob hech qachon kelmaydi — yangi diagnostika 3 kun yopiq qolmasin. Xabar — navbat saqlanadigan 3 kun
 */
export const freshFor = (action: CommandAction): number => (action === 'message' ? COMMAND_KEEP_MS : COMMAND_FRESH_MS);

export function createCommands(db: DatabaseSync, clock = () => new Date()) {
  // ok: NULL — hali javob yo'q, 1 — bajarildi, 0 — bajarilmadi
  db.exec(`CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, action TEXT NOT NULL, text TEXT, by_name TEXT,
    created_at TEXT NOT NULL, done_at TEXT, ok INTEGER, note TEXT, diag TEXT);
  CREATE INDEX IF NOT EXISTS commands_clinic ON commands (clinic_id, created_at);`);
  const row = (r: Record<string, unknown>): CommandRow => {
    const action = String(r.action) as CommandAction, createdAt = String(r.created_at);
    const answered = r.ok !== null && r.ok !== undefined;
    const stale = !answered && clock().getTime() - Date.parse(createdAt) > freshFor(action);
    return {
      id: String(r.id), clinicId: String(r.clinic_id), action, text: str(r.text), by: str(r.by_name), createdAt,
      state: answered ? (Number(r.ok) === 1 ? 'done' : 'failed') : stale ? 'expired' : 'sent',
      doneAt: str(r.done_at), note: str(r.note), diag: str(r.diag),
    };
  };
  const get = (id: string): CommandRow | null => {
    const r = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? row(r) : null;
  };

  return {
    get,
    /**
     * Jamoa a'zosi bergan buyruq. Shu amaldan javob kutilayotgani bo'lsa — yangisi berilmaydi (ikki marta qayta ishga tushmasin);
     * qayta ishga tushirish va yangilash bir-birini ham kutadi (yangilash fayllarni almashtirayotganda server qayta yoqilmasin)
     */
    create(clinicId: string, body: Record<string, unknown>, by: string | null): CommandRow {
      if (!isCommandAction(body.action)) throw new CommandError(400, "Noma'lum amal");
      const action = body.action;
      const text = action === 'message' ? clean(body.text, MESSAGE_MAX) : null;
      if (action === 'message' && (!text || text.length < MESSAGE_MIN)) throw new CommandError(400, 'Xabar matnini yozing');
      const now = clock();
      if (action !== 'message') {
        const blocking = action === 'diag' ? ['diag'] : ['restart', 'update'];
        const waiting = (db.prepare(`SELECT * FROM commands WHERE clinic_id = ? AND ok IS NULL AND action IN (${blocking.map(() => '?').join(', ')}) ORDER BY created_at DESC`)
          .all(clinicId, ...blocking) as Record<string, unknown>[]).map(row).find(c => c.state === 'sent');
        if (waiting) throw new CommandError(409, waiting.action === action ? 'Oldingi shunday buyruq hali bajarilmadi — klinika javobini kuting'
          : `Avval «${waiting.action === 'update' ? 'yangilash' : 'qayta ishga tushirish'}» natijasini kuting`);
      }
      const hour = Number((db.prepare('SELECT COUNT(*) AS n FROM commands WHERE clinic_id = ? AND created_at > ?')
        .get(clinicId, new Date(now.getTime() - HOUR_MS).toISOString()) as { n: number }).n);
      if (hour >= COMMANDS_PER_HOUR) throw new CommandError(429, `Bu mijozga bir soatda ${COMMANDS_PER_HOUR} ta buyruq berildi — keyinroq`);
      db.prepare('DELETE FROM commands WHERE created_at < ?').run(new Date(now.getTime() - ROWS_KEEP_MS).toISOString());
      const id = randomBytes(6).toString('hex');
      db.prepare('INSERT INTO commands (id, clinic_id, action, text, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, clinicId, action, text, clean(by, 60).replace(/\n+/g, ' ') || null, now.toISOString());
      return get(id)!;
    },
    /** Klinika natijasi: faqat o'z buyrug'iga va bir marta (takror javob — e'tiborsiz). null — bunday buyruq yo'q */
    finish(clinicId: string, id: string, body: Record<string, unknown>, diag: string | null = null): CommandRow | null {
      const c = get(id);
      if (!c || c.clinicId !== clinicId) return null;
      if (c.state === 'done' || c.state === 'failed') return c;
      db.prepare('UPDATE commands SET ok = ?, note = ?, done_at = ?, diag = ? WHERE id = ?')
        .run(body.ok === true ? 1 : 0, clean(body.note, NOTE_MAX) || null, clock().toISOString(), diag, id);
      return get(id);
    },
    /** Kartada: shu mijozning oxirgi buyruqlari, yangisi tepada */
    recent(clinicId: string, limit = COMMANDS_SHOWN): CommandRow[] {
      return (db.prepare('SELECT * FROM commands WHERE clinic_id = ? ORDER BY created_at DESC LIMIT ?').all(clinicId, limit) as Record<string, unknown>[]).map(row);
    },
    remove(clinicId: string): void {
      db.prepare('DELETE FROM commands WHERE clinic_id = ?').run(clinicId);
    },
  };
}
export type Commands = ReturnType<typeof createCommands>;
