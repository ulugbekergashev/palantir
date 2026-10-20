/**
 * Chuqur tahlil uchun ma'lumot to'plami (CSV): DentaCRM (qabullar, to'lovlar, bemorlar), kamera seanslari, qo'ng'iroqlar, yozishmalar,
 * mijozlar va so'rovlar. Shaxsiy belgisiz: bemor va mijoz — shu biznesga xos kod (P…, L…), ism, telefon va xabar matni yo'q; shifokor —
 * ismi bilan (xodim). Mijoz DentaCRM bemoriga bog'langan bo'lsa (leads.patient_id), kodi qabullar bilan birlashadi: murojaat → qabul → to'lov.
 * Vaqt — Toshkent (server mintaqasi).
 */
import { createHash } from 'node:crypto';
import { iso } from '../../src/lib/week';
import { crmConnected, withCrm } from '../crm/index';
import { sql, type BusinessRow } from '../db';
import '../phone/store';
import { crmTables, local, minutes, toCsv, type DataFile, type Dataset } from './tables';

export type { DataFile, Dataset } from './tables';

/** Oxirgi `days` kunning to'plami; DentaCRM ulanmagan yoki javob bermasa — u qismsiz (sababi notes'da) */
export async function buildDataset(biz: BusinessRow, days = 365, now = new Date()): Promise<Dataset> {
  const to = iso(now), from = iso(new Date(now.getTime() - (days - 1) * 86_400_000));
  const fromIso = new Date(`${from}T00:00:00`).toISOString(), toIso = new Date(now.getTime() + 1000).toISOString();
  const code = (kind: string, id: string) => `${kind}${createHash('sha256').update(`${biz.id}:${kind === 'L' ? 'lead' : 'crm'}:${id}`).digest('hex').slice(0, 10)}`;
  // Mijoz bemorga bog'langan bo'lsa — bemor kodi bilan bir xil (jadvallar shu ustun bilan birlashadi)
  const patientCode = (id: string) => code('P', id);
  const files: DataFile[] = [], notes: string[] = [];

  if (crmConnected(biz.id)) {
    try {
      const stats = await withCrm(biz.id, crm => crm.statsExport());
      files.push(...crmTables(stats, (k, id) => code(k, id), from, to));
    } catch (e) {
      notes.push(`DentaCRM ma'lumoti olinmadi: ${(e as Error).message}`);
    }
  } else notes.push("DentaCRM ulanmagan — qabul va to'lovlarsiz");

  const sessions = sql.many(`SELECT s.kind, s.zone_name, s.started_at, s.ended_at, c.name AS camera FROM camera_sessions s LEFT JOIN cameras c ON c.id = s.camera_id
    WHERE s.business_id = ? AND s.started_at >= ? AND s.started_at < ? ORDER BY s.started_at`,
  r => ({ kind: String(r.kind), zone: String(r.zone_name), start: String(r.started_at), end: sql.str(r.ended_at), camera: sql.str(r.camera) }), biz.id, fromIso, toIso);
  if (sessions.length) {
    files.push({ name: 'camera_sessions.csv', rows: sessions.length, about: 'Camera: each period a person stayed in a zone — zone kind (chair = dental chair, desk = cash desk, waiting = waiting area, staff = staff place), zone name, camera, start, end, minutes.',
      csv: toCsv(['camera', 'zone', 'zone_kind', 'date', 'weekday', 'start', 'hour', 'end', 'minutes'], sessions.map(s => { const a = local(s.start); return [s.camera, s.zone, s.kind, a?.date, a?.weekday, a?.time, a?.hour, local(s.end)?.time, minutes(s.start, s.end)]; })) });
  } else notes.push("Kamera seanslari yo'q");

  const calls = sql.many('SELECT started_at, direction, status, duration_sec, source, booked, lead_id FROM calls WHERE business_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at',
    r => ({ at: String(r.started_at), dir: sql.str(r.direction), status: sql.str(r.status), sec: Number(r.duration_sec ?? 0), source: sql.str(r.source), booked: !!sql.str(r.booked), lead: sql.str(r.lead_id) }), biz.id, fromIso, toIso);
  if (calls.length) {
    files.push({ name: 'calls.csv', rows: calls.length, about: 'Phone calls: date, time, direction (in/out), status (ended, missed — nobody answered, no_answer — they did not pick up), duration in seconds, source (voice = AI receptionist, microsip = staff phone), booked during the call, customer code.',
      csv: toCsv(['date', 'weekday', 'time', 'hour', 'direction', 'status', 'duration_sec', 'source', 'booked', 'lead'], calls.map(c => { const a = local(c.at); return [a?.date, a?.weekday, a?.time, a?.hour, c.dir ?? 'in', c.status ?? 'ended', c.sec, c.source, c.booked, c.lead ? code('L', c.lead) : null]; })) });
  }

  // Yozishma: mijoz bo'yicha har kun — nechta xabar, birinchi javobgacha necha daqiqa, kim javob berdi
  const msgs = sql.many('SELECT lead_id, channel, direction, author, created_at FROM inbox WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, rowid',
    r => ({ lead: String(r.lead_id), channel: String(r.channel), dir: String(r.direction), by: String(r.author), at: String(r.created_at) }), biz.id, fromIso, toIso);
  const convs = new Map<string, { lead: string; channel: string; first: string; inn: number; out: number; reply: string | null; by: string | null }>();
  for (const m of msgs) {
    const key = `${m.lead}|${local(m.at)?.date}`;
    const c = convs.get(key);
    if (m.dir === 'in') { if (c) c.inn++; else convs.set(key, { lead: m.lead, channel: m.channel, first: m.at, inn: 1, out: 0, reply: null, by: null }); }
    else if (c) { c.out++; if (!c.reply) { c.reply = m.at; c.by = m.by; } }
  }
  if (convs.size) {
    files.push({ name: 'conversations.csv', rows: convs.size, about: 'Customer messages (Telegram, Instagram…) grouped per customer per day: first message time, messages in/out, minutes to the first reply, who replied (cerebro = AI, owner, staff) — no message text.',
      csv: toCsv(['lead', 'channel', 'date', 'weekday', 'time', 'hour', 'messages_in', 'messages_out', 'first_reply_min', 'replied_by'], [...convs.values()].map(c => { const a = local(c.first); return [code('L', c.lead), c.channel, a?.date, a?.weekday, a?.time, a?.hour, c.inn, c.out, minutes(c.first, c.reply), c.by]; })) });
  }

  const leads = sql.many('SELECT id, channel, stage, source, created_at, patient_id FROM leads WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    r => ({ id: String(r.id), channel: sql.str(r.channel), stage: String(r.stage), source: sql.str(r.source), at: String(r.created_at), patient: sql.str(r.patient_id) }), biz.id, fromIso, toIso);
  if (leads.length) {
    files.push({ name: 'leads.csv', rows: leads.length, about: 'Customers (inquiries): channel, stage, source, when they first appeared, and the DentaCRM patient code if linked — join with visits.csv/payments.csv on patient to follow inquiry → visit → payment.',
      csv: toCsv(['lead', 'channel', 'stage', 'source', 'date', 'weekday', 'hour', 'patient'], leads.map(l => { const a = local(l.at); return [code('L', l.id), l.channel, l.stage, l.source, a?.date, a?.weekday, a?.hour, l.patient ? patientCode(l.patient) : null]; })) });
  }

  const reqs = sql.many('SELECT kind, source, status, created_at, closed_at FROM requests WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    r => ({ kind: String(r.kind), source: String(r.source), status: String(r.status), at: String(r.created_at), closed: sql.str(r.closed_at) }), biz.id, fromIso, toIso);
  if (reqs.length) {
    files.push({ name: 'requests.csv', rows: reqs.length, about: 'Requests left for the administrator (callback, booking, change, complaint…): source, status, when created and minutes until closed.',
      csv: toCsv(['kind', 'source', 'status', 'date', 'weekday', 'hour', 'minutes_to_close'], reqs.map(r => { const a = local(r.at); return [r.kind, r.source, r.status, a?.date, a?.weekday, a?.hour, minutes(r.at, r.closed)]; })) });
  }
  return { files, from, to, notes };
}
