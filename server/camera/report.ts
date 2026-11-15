/**
 * Kechki kamera hisoboti — AI'siz (aniq raqamlar): kresloga o'tirganlar, kassa, kreslo bandligi, kutish, xodimlar, DentaCRM bilan
 * farqlar va bugungi kamera ogohlantirishlari. Alohida xabar emas: kechki BITTA xabarning qismi (server/evening.ts, B6) —
 * CAMERA_REPORT_HOUR dan to'rt soat ichida, kuniga bir marta. Aytadigan narsa bo'lmasa — qo'shilmaydi, keyingi tekshiruvda yana qaraladi.
 */
import { iso } from '../../src/lib/week';
import { sql, type BusinessRow } from '../db';
import { events } from '../orders/store';
import { reportHtml } from './reportText';
import { daySummary } from './routes';

sql.exec(`CREATE TABLE IF NOT EXISTS camera_reports (
  business_id TEXT NOT NULL, date TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (business_id, date)
)`);

export const cameraSentToday = (bizId: string, day: string): boolean =>
  !!sql.one('SELECT 1 x FROM camera_reports WHERE business_id = ? AND date = ?', r => r.x, bizId, day);
export const markCameraSent = (bizId: string, day: string): void => {
  sql.run('INSERT OR IGNORE INTO camera_reports (business_id, date, sent_at) VALUES (?, ?, ?)', bizId, day, sql.nowIso());
};

/** Kunning hisoboti (aytadigan narsa bo'lmasa — null). Kamera ogohlantirishlari soni — faqat bugun uchun */
export async function cameraReport(biz: BusinessRow, date = iso(new Date()), now = new Date()): Promise<string | null> {
  const s = await daySummary(biz, date, now);
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d).toISOString();
  const alerts = date === iso(now) ? events.tally(biz.id, start).filter(t => t.member === 'kuzatuvchi' && t.level !== 'info').reduce((n, t) => n + t.n, 0) : 0;
  return reportHtml(s, alerts, new Date(y, m - 1, d));
}
