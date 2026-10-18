/**
 * Qo'ng'iroqlar jadvali (calls) — MicroSIP qismi: yo'nalish, holat, telefon kaliti, ko'tarilgan va tugagan payti, yozuv fayli,
 * tahlil, so'rov. Ovozli agent qo'ng'iroqlari ham shu jadvalda (source = 'voice').
 */
import type { CallAnalysis } from '../../src/types';
import { phoneKey } from '../../src/lib/phone';
import { newId, sql, type Row } from '../db';
import type { CallDirection, CallState, OpenCall } from './journal';

sql.ensureColumns('calls', {
  lead_id: 'TEXT', source: "TEXT NOT NULL DEFAULT 'voice'", direction: 'TEXT', status: 'TEXT', phone_key: 'TEXT',
  answered_at: 'TEXT', ended_at: 'TEXT', recording: 'TEXT', analysis: 'TEXT', review: 'TEXT', request_id: 'TEXT',
});
sql.exec('CREATE INDEX IF NOT EXISTS calls_open ON calls (business_id, phone_key, ended_at)');

export interface PhoneCallRow extends OpenCall {
  businessId: string;
  phone: string;
  leadId: string | null;
  recording: string | null;
  /** none — tahlil kerak emas; pending — navbatda; done; failed */
  review: 'none' | 'pending' | 'done' | 'failed';
  analysis: CallAnalysis | null;
  requestId: string | null;
}

const ms = (v: unknown) => (v == null ? null : Date.parse(String(v)));
const toPhoneCall = (r: Row): PhoneCallRow => ({
  id: String(r.id), businessId: String(r.business_id), phone: String(r.phone), leadId: sql.str(r.lead_id), direction: String(r.direction ?? 'in') as CallDirection,
  state: String(r.status ?? 'ended') as CallState, startedAt: Date.parse(String(r.started_at)), answeredAt: ms(r.answered_at), endedAt: ms(r.ended_at),
  recording: sql.str(r.recording), review: (sql.str(r.review) ?? 'none') as PhoneCallRow['review'], requestId: sql.str(r.request_id),
  analysis: r.analysis ? safeJson<CallAnalysis>(String(r.analysis)) : null,
});
const safeJson = <T,>(s: string): T | null => { try { return JSON.parse(s) as T; } catch { return null; } };
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

export const phoneCalls = {
  create(businessId: string, v: { phone: string; direction: CallDirection; state: CallState; at: number; answered: boolean }): PhoneCallRow {
    const id = newId(12);
    sql.run(`INSERT INTO calls (id, business_id, phone, name, started_at, duration_sec, outcome, transcript, booked, created_at, source, direction, status, phone_key, answered_at)
      VALUES (?, ?, ?, NULL, ?, 0, '', '[]', NULL, ?, 'microsip', ?, ?, ?, ?)`,
      id, businessId, v.phone, iso(v.at), sql.nowIso(), v.direction, v.state, phoneKey(v.phone) ?? v.phone.toLowerCase(), v.answered ? iso(v.at) : null);
    return phoneCalls.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => sql.one('SELECT * FROM calls WHERE business_id = ? AND id = ?', toPhoneCall, businessId, id),
  /** Shu raqamdagi yopilmagan oxirgi yozuv */
  open: (businessId: string, key: string) =>
    sql.one("SELECT * FROM calls WHERE business_id = ? AND source = 'microsip' AND phone_key = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", toPhoneCall, businessId, key),
  /** Shu raqamdagi, at'dan oldingi lookBack ichida yopilgan oxirgi kiruvchi yozuv */
  recentIn: (businessId: string, key: string, at: number, lookBack: number) =>
    sql.one("SELECT * FROM calls WHERE business_id = ? AND source = 'microsip' AND phone_key = ? AND direction = 'in' AND ended_at >= ? ORDER BY started_at DESC LIMIT 1",
      toPhoneCall, businessId, key, iso(at - lookBack)),
  allOpen: (businessId: string) => sql.many("SELECT * FROM calls WHERE business_id = ? AND source = 'microsip' AND ended_at IS NULL", toPhoneCall, businessId),
  setState(businessId: string, id: string, state: CallState, at: number, opts: { answered?: boolean; ended?: boolean; reopened?: boolean }): PhoneCallRow {
    const cur = phoneCalls.get(businessId, id)!;
    const answeredAt = opts.answered ? cur.answeredAt ?? at : cur.answeredAt;
    const endedAt = opts.reopened ? null : opts.ended ? at : cur.endedAt;
    const duration = endedAt && answeredAt && state === 'ended' ? Math.max(0, Math.round((endedAt - answeredAt) / 1000)) : 0;
    sql.run('UPDATE calls SET status = ?, answered_at = ?, ended_at = ?, duration_sec = ? WHERE business_id = ? AND id = ?', state, iso(answeredAt), iso(endedAt), duration, businessId, id);
    return phoneCalls.get(businessId, id)!;
  },
  setLead: (businessId: string, id: string, leadId: string, name: string | null) =>
    sql.run('UPDATE calls SET lead_id = ?, name = COALESCE(name, ?) WHERE business_id = ? AND id = ?', leadId, name, businessId, id),
  setRequest: (businessId: string, id: string, requestId: string) => sql.run('UPDATE calls SET request_id = ? WHERE business_id = ? AND id = ?', requestId, businessId, id),
  setRecording: (businessId: string, id: string, file: string) => sql.run("UPDATE calls SET recording = ?, review = 'pending' WHERE business_id = ? AND id = ?", file, businessId, id),
  setReview: (businessId: string, id: string, review: PhoneCallRow['review'], analysis?: CallAnalysis) =>
    sql.run(`UPDATE calls SET review = ?, analysis = COALESCE(?, analysis), outcome = COALESCE(?, outcome), name = COALESCE(name, ?) WHERE business_id = ? AND id = ?`,
      review, analysis ? JSON.stringify(analysis) : null, analysis?.summary ?? null, analysis?.customerName || null, businessId, id),
  /** Tahlil navbatida qolganlari (server to'xtab qolgan bo'lsa — qayta ishlanadi) */
  pending: () => sql.many("SELECT * FROM calls WHERE source = 'microsip' AND review = 'pending' AND recording IS NOT NULL ORDER BY started_at LIMIT 20", toPhoneCall),
  forLead: (businessId: string, leadId: string, limit = 30) => sql.many('SELECT * FROM calls WHERE business_id = ? AND lead_id = ? ORDER BY started_at DESC LIMIT ?', toPhoneCall, businessId, leadId, limit),
};
