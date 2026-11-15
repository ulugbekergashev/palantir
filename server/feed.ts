/**
 * Agentlar lentasi — «kim nima qildi», bosh ekrandagi «Bugungi jurnal». Xodimlarning o'z yozuvlari (agent_events: Direktor, kamera,
 * kontent, topshiriqlar) va AI administratorning bugungi ishi bitta ro'yxatda, yangisi tepada. AI administrator jurnalga yozmaydi —
 * uning ishi o'z jadvallarida turibdi, shu yerda o'qish paytida yig'iladi (yangi yozuv, ikki manba bo'lmasin):
 *   bemorga javob (bir bemorga bir qator — oxirgi javobi), qabulga yozish va qabulni o'zgartirish, telefon suhbati, odamga qoldirgan so'rov.
 * Avtomatik «xodimga yetkazildi» javob emas — ko'rsatilmaydi.
 */
import type { AgentEvent, LeadChannel } from '../src/types';
import { crewHas } from '../src/lib/crew';
import { sql, type BusinessRow } from './db';
import { HOLD_MARK } from './inbox/hold';
import { events } from './orders/store';

const CHANNEL: Record<string, string> = { bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: "qo'lda" };
const MAX_BODY = 300;
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const row = (id: string, at: string, title: string, body = '', level: AgentEvent['level'] = 'info'): AgentEvent =>
  ({ id, member: 'qabulxona', orderId: null, level, title: cut(title, 200), body: cut(body, MAX_BODY), cameraId: null, hasImage: false, at });

const nameOr = (name: unknown, fallback = 'Mijoz') => (typeof name === 'string' && name.trim() ? name.trim() : fallback);
const json = <T,>(v: unknown): T | null => { try { return v ? JSON.parse(String(v)) as T : null; } catch { return null; } };

interface Booking { doctorName?: string; date?: string; time?: string; name?: string }
interface Change { kind?: 'move' | 'cancel'; doctorName?: string; from?: string; date?: string; time?: string }

/** AI administratorning shu paytdan beri qilgan ishi (lenta qatorlari) */
export function receptionFeed(biz: BusinessRow, sinceIso: string, limit: number): AgentEvent[] {
  const out: AgentEvent[] = [];
  // Qabul: yozishmada yozilgan va o'zgartirilgan qabullar
  const booked = sql.many(`SELECT r.id, r.booking, r.booked_at, r.visit_change, r.changed_at, r.channel, l.name FROM replies r LEFT JOIN leads l ON l.id = r.lead_id
      WHERE r.business_id = ? AND (r.booked_at >= ? OR r.changed_at >= ?) ORDER BY COALESCE(r.booked_at, r.changed_at) DESC LIMIT ?`,
    x => x, biz.id, sinceIso, sinceIso, limit);
  const bookedLeads = new Set<string>();
  for (const x of booked) {
    const b = json<Booking>(x.booking), c = json<Change>(x.visit_change);
    if (x.booked_at && b) {
      out.push(row(`rb:${String(x.id)}`, String(x.booked_at), `Qabulga yozdi: ${nameOr(b.name || x.name)} — ${b.date} ${b.time}${b.doctorName ? `, ${b.doctorName}` : ''}`, CHANNEL[String(x.channel)] ?? ''));
    } else if (x.changed_at && c) {
      const what = c.kind === 'move' ? `qabulini ko'chirdi — ${c.from} → ${c.date} ${c.time}` : `qabulini bekor qildi — ${c.from}`;
      out.push(row(`rc:${String(x.id)}`, String(x.changed_at), `${nameOr(x.name)}: ${what}${c.doctorName ? `, ${c.doctorName}` : ''}`, CHANNEL[String(x.channel)] ?? ''));
    }
  }
  for (const x of sql.many('SELECT lead_id FROM replies WHERE business_id = ? AND (booked_at >= ? OR changed_at >= ?)', r => String(r.lead_id), biz.id, sinceIso, sinceIso)) bookedLeads.add(x);
  // Javoblar: bir bemorga bir qator (oxirgi javobi va nechta xabar); qabul qatori bo'lgan bemorga — takror yo'q
  const answers = sql.many(`SELECT i.lead_id, i.channel, MAX(i.created_at) AS at, COUNT(*) AS n,
        (SELECT text FROM inbox x WHERE x.business_id = i.business_id AND x.lead_id = i.lead_id AND x.direction = 'out' AND x.author IN ('palantir', 'cerebro') -- eski nom
          AND instr(x.text, ?) = 0 ORDER BY x.created_at DESC LIMIT 1) AS text, l.name
      FROM inbox i LEFT JOIN leads l ON l.id = i.lead_id
      WHERE i.business_id = ? AND i.direction = 'out' AND i.author IN ('palantir', 'cerebro') AND i.created_at >= ? AND instr(i.text, ?) = 0 -- eski nom
      GROUP BY i.lead_id ORDER BY at DESC LIMIT ?`, x => x, HOLD_MARK, biz.id, sinceIso, HOLD_MARK, limit);
  for (const x of answers) {
    if (bookedLeads.has(String(x.lead_id))) continue;
    const n = Number(x.n);
    out.push(row(`ra:${String(x.lead_id)}:${String(x.at)}`, String(x.at), `Javob berdi: ${nameOr(x.name)} · ${CHANNEL[String(x.channel) as LeadChannel] ?? ''}${n > 1 ? ` (${n} ta xabar)` : ''}`, String(x.text ?? '')));
  }
  // Telefon: AI javob bergan qo'ng'iroqlar (ovozli agent)
  for (const x of sql.many("SELECT id, name, phone, started_at, outcome, booked FROM calls WHERE business_id = ? AND source = 'voice' AND started_at >= ? ORDER BY started_at DESC LIMIT ?",
    r => r, biz.id, sinceIso, limit)) {
    const who = nameOr(x.name, String(x.phone ?? '') === 'yashirin' ? 'Yashirin raqam' : String(x.phone ?? 'Mijoz'));
    out.push(row(`rv:${String(x.id)}`, String(x.started_at), x.booked ? `Telefonda qabulga yozdi: ${who} — ${String(x.booked)}` : `Telefonda gaplashdi: ${who}`, String(x.outcome ?? '')));
  }
  // So'rovlar: AI o'zi hal qila olmagan, odamga qoldirgani (yozishma va telefon)
  for (const x of sql.many(`SELECT q.id, COALESCE(q.name, l.name) AS name, COALESCE(q.phone, l.phone) AS phone, q.summary, q.created_at FROM requests q LEFT JOIN leads l ON l.id = q.lead_id
      WHERE q.business_id = ? AND q.created_at >= ? AND q.source NOT IN ('owner', 'panel', 'call') ORDER BY q.created_at DESC LIMIT ?`,
    r => r, biz.id, sinceIso, limit)) {
    out.push(row(`rq:${String(x.id)}`, String(x.created_at), `So'rov qoldirdi: ${nameOr(x.name, String(x.phone ?? 'Mijoz'))}`, String(x.summary ?? ''), 'warn'));
  }
  return out;
}

/** Bosh ekran lentasi: xodimlarning yozuvlari va AI administratorning ishi, yangisi tepada. keep — jamoada bormi (olib tashlangan xodim ko'rinmaydi) */
export function teamFeed(biz: BusinessRow, sinceIso: string, limit: number, keep: (e: AgentEvent) => boolean): AgentEvent[] {
  const own = events.since(biz.id, sinceIso, limit);
  const reception = crewHas(biz, 'qabulxona') ? receptionFeed(biz, sinceIso, limit) : [];
  return [...own, ...reception].filter(keep).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
