/**
 * Yordam so'rovlari (hub/server.ts, 13-band). Klinika egasi muammoni o'z so'zi bilan yozadi: panelda Sozlamalar → Yordam yoki botda
 * /yordam. Klinika tomoni — server/help.ts. Hub so'rovni saqlaydi va jamoaga Telegram'da aytadi. Jamoa /admin da javob yozadi.
 * Javob klinikaga navbat orqali qaytadi (help_answer): panelda ko'rinadi va egasining Telegramiga boradi.
 * Bitta so'rovga bitta javob; yangi savol — yangi so'rov. Bu modul faqat baza bilan ishlaydi: scripts/check-help.ts uni xotiradagi baza
 * bilan sinaydi.
 */
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const HELP_TEXT_MIN = 5;
const HELP_TEXT_MAX = 2000;
/** Bitta klinikadan sutkasiga: ko'p so'rov jamoaning Telegramini to'ldirib yubormasin */
export const HELP_PER_DAY = 10;
/** /admin ro'yxatida */
const HELP_SHOWN = 50;
/** Ro'yxat uchun olinadigan oxirgi so'rovlar (o'rnatuvchiga faqat o'z klinikalari qoladi) */
const HELP_SCAN = 500;
/** Shundan eski so'rovlar o'chiriladi */
const HELP_KEEP_MS = 180 * 86_400_000;
const DAY_MS = 86_400_000;

export class HelpError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export interface HelpRow {
  id: string; clinicId: string; business: string | null; businessName: string | null; by: string | null; text: string;
  /** Hubdagi diagnostika fayli (so'rov bilan birga kelgan bo'lsa): /admin/diag/<klinika>/<fayl> */
  diag: string | null;
  createdAt: string; answer: string | null; answeredAt: string | null; answeredBy: string | null;
}

/** Boshqaruv belgilari olib tashlanadi, bo'sh joylar bittaga, qator tashlash qoladi (ketma-ket ikkitadan ko'p emas) */
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, c => (c === '\t' ? ' ' : ''))
  .replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
/** Bir qatorli qisqa maydon (nom, kim) */
const line = (v: unknown, max: number): string | null => clean(v, max).replace(/\n+/g, ' ') || null;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function createHelp(db: DatabaseSync, clock = () => new Date()) {
  // alerted_at — sotuvchiga Telegram'da aytilgan payt (yetmasa — nazorat sikli qayta urinadi)
  db.exec(`CREATE TABLE IF NOT EXISTS help (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, business TEXT, business_name TEXT, by_name TEXT, text TEXT NOT NULL,
    diag TEXT, created_at TEXT NOT NULL, answer TEXT, answered_at TEXT, answered_by TEXT, alerted_at TEXT);
  CREATE INDEX IF NOT EXISTS help_clinic ON help (clinic_id, created_at);`);
  const row = (r: Record<string, unknown>): HelpRow => ({
    id: String(r.id), clinicId: String(r.clinic_id), business: str(r.business), businessName: str(r.business_name), by: str(r.by_name), text: String(r.text),
    diag: str(r.diag), createdAt: String(r.created_at), answer: str(r.answer), answeredAt: str(r.answered_at), answeredBy: str(r.answered_by),
  });
  const get = (id: string): HelpRow | null => {
    const r = db.prepare('SELECT * FROM help WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? row(r) : null;
  };

  return {
    get,
    /** Klinika yuborgan so'rov: matn tekshiriladi, sutkalik chegara — shu klinika bo'yicha */
    ask(clinicId: string, body: Record<string, unknown>): HelpRow {
      const text = clean(body.text, HELP_TEXT_MAX);
      if (text.length < HELP_TEXT_MIN) throw new HelpError(400, 'Muammoni bir-ikki gap bilan yozing');
      const now = clock();
      const since = new Date(now.getTime() - DAY_MS).toISOString();
      const today = Number((db.prepare('SELECT COUNT(*) AS n FROM help WHERE clinic_id = ? AND created_at > ?').get(clinicId, since) as { n: number }).n);
      if (today >= HELP_PER_DAY) throw new HelpError(429, `Bugun ${HELP_PER_DAY} ta so'rov yuborildi — javobni kuting yoki sotuvchiga qo'ng'iroq qiling`);
      db.prepare('DELETE FROM help WHERE created_at < ?').run(new Date(now.getTime() - HELP_KEEP_MS).toISOString());
      const id = randomBytes(6).toString('hex');
      db.prepare('INSERT INTO help (id, clinic_id, business, business_name, by_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, clinicId, line(body.business, 40), line(body.businessName, 80), line(body.by, 60), text, now.toISOString());
      return get(id)!;
    },
    /** Diagnostika so'rovdan keyin saqlanadi: chegaradan o'tmagan so'rovning fayli diskka yozilmasin */
    attachDiag(id: string, file: string): void {
      db.prepare('UPDATE help SET diag = ? WHERE id = ?').run(file, id);
    },
    /** Javobsizlari birinchi, har guruhda yangisi tepada. visible — so'rayotgan jamoa a'zosi shu klinikani ko'radimi */
    list(visible: (clinicId: string) => boolean): HelpRow[] {
      return (db.prepare('SELECT * FROM help ORDER BY answer IS NOT NULL, created_at DESC LIMIT ?').all(HELP_SCAN) as Record<string, unknown>[])
        .map(row).filter(h => visible(h.clinicId)).slice(0, HELP_SHOWN);
    },
    markAlerted(id: string): void {
      db.prepare('UPDATE help SET alerted_at = ? WHERE id = ?').run(clock().toISOString(), id);
    },
    /** Sotuvchiga hali aytilmagan oxirgi sutkadagi so'rovlar (Telegram yetmagan yoki hub qayta ishga tushgan) */
    unalerted(): HelpRow[] {
      const since = new Date(clock().getTime() - DAY_MS).toISOString();
      return (db.prepare('SELECT * FROM help WHERE alerted_at IS NULL AND created_at > ? ORDER BY created_at LIMIT 20').all(since) as Record<string, unknown>[]).map(row);
    },
    /** Jamoa javobi — bir marta. Ikkinchisi rad etiladi: egasiga bir so'rovga ikki xil javob bormasin. who — null: asosiy kalit (shaxs emas) */
    answer(id: string, who: string | null, text: unknown): HelpRow {
      const answer = clean(text, HELP_TEXT_MAX);
      if (!answer) throw new HelpError(400, "Javob bo'sh");
      const r = db.prepare('UPDATE help SET answer = ?, answered_at = ?, answered_by = ? WHERE id = ? AND answer IS NULL').run(answer, clock().toISOString(), who, id);
      if (!Number(r.changes)) throw get(id) ? new HelpError(409, "Bu so'rovga javob berilgan") : new HelpError(404, "So'rov topilmadi");
      return get(id)!;
    },
    /** Klinika yozuvi o'chirilganda */
    forget(clinicId: string): void {
      db.prepare('DELETE FROM help WHERE clinic_id = ?').run(clinicId);
    },
  };
}
