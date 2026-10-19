/**
 * Kechki kamera hisoboti — egasining Telegram'iga, AI'siz (aniq raqamlar): kresloga o'tirganlar, kassa, kreslo bandligi, kutish,
 * xodimlar, DentaCRM bilan farqlar va bugungi kamera ogohlantirishlari. CAMERA_REPORT_HOUR dan to'rt soat ichida (server o'sha
 * soatda o'chiq bo'lsa ham kechikib boradi), kuniga bir marta. Aytadigan narsa bo'lmasa — yuborilmaydi, keyingi tekshiruvda yana qaraladi.
 */
import { iso } from '../../src/lib/week';
import { businesses, cameras, sql, type BusinessRow } from '../db';
import { env } from '../env';
import { events } from '../orders/store';
import { reportHtml } from './reportText';
import { daySummary } from './routes';

sql.exec(`CREATE TABLE IF NOT EXISTS camera_reports (
  business_id TEXT NOT NULL, date TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (business_id, date)
)`);

const REPORT_WINDOW_H = 4;
/** Yuborilmadi (Telegram yoki DentaCRM javob bermadi) — shuncha vaqtdan keyin yana uriniladi, har tekshiruvda emas */
const RETRY_MS = 5 * 60_000;
const retryAt = new Map<string, number>();

const sentToday = (bizId: string, day: string) => !!sql.one('SELECT 1 x FROM camera_reports WHERE business_id = ? AND date = ?', r => r.x, bizId, day);

/** Kunning hisoboti (aytadigan narsa bo'lmasa — null). Kamera ogohlantirishlari soni — faqat bugun uchun */
export async function cameraReport(biz: BusinessRow, date = iso(new Date()), now = new Date()): Promise<string | null> {
  const s = await daySummary(biz, date, now);
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d).toISOString();
  const alerts = date === iso(now) ? events.tally(biz.id, start).filter(t => t.member === 'kuzatuvchi' && t.level !== 'info').reduce((n, t) => n + t.n, 0) : 0;
  return reportHtml(s, alerts, new Date(y, m - 1, d));
}

let running = false;
/** Har tekshiruvda (orders/run.ts): hisobot vaqti kelgan va bugun yuborilmagan bizneslarga */
export async function reportTick(send: (biz: BusinessRow, html: string) => Promise<number | null>, now = new Date()): Promise<void> {
  const hour = now.getHours();
  if (running || hour < env.cameraReportHour || hour >= env.cameraReportHour + REPORT_WINDOW_H) return;
  running = true;
  try {
    const day = iso(now);
    for (const biz of businesses.all()) {
      if (!biz.active || !biz.ownerChatId || biz.profile.morningBrief === false || !cameras.list(biz.id).length || sentToday(biz.id, day)) continue;
      if ((retryAt.get(biz.id) ?? 0) > now.getTime()) continue;
      try {
        const html = await cameraReport(biz, day, now);
        // Aytadigan narsa yo'q — keyingi tekshiruvda yana qaraladi (faqat shu kompyuterdagi baza o'qiladi: DentaCRM ulangan bo'lsa hisobot bo'sh bo'lmaydi)
        if (!html) continue;
        // Bot ulanmagan yoki egasi chati yo'q — yuborilmadi, bugun yana uriniladi
        if ((await send(biz, html)) == null) throw new Error('Telegram bot ulanmagan');
        sql.run('INSERT OR IGNORE INTO camera_reports (business_id, date, sent_at) VALUES (?, ?, ?)', biz.id, day, sql.nowIso());
      } catch (e) {
        retryAt.set(biz.id, now.getTime() + RETRY_MS);
        console.error(`[kamera] kechki hisobot (${biz.profile.name}):`, (e as Error).message);
      }
    }
  } finally {
    running = false;
  }
}
