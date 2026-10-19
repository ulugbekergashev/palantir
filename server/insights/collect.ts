/**
 * Talab tahlili uchun davrdagi murojaatlarni yig'ish: har mijozning yozishmasi (uning gaplari + bizning birinchi javobimiz — javob
 * topilmagan savollarni ko'rish uchun), qo'ng'iroqlar (mijozning gaplari va natija) va so'rovlar. Har biri — qisqa raqamli band
 * (m1, c2, r3): model bandlarni mavzuga biriktiradi, sanash kodda (analyze.ts) — raqamlar aniq va tekshirsa bo'ladi.
 */
import { sql } from '../db';
// calls jadvalining qo'shimcha ustunlari (status, direction, analysis) shu modulda qo'shiladi
import '../phone/store';

export interface DemandItem { id: string; kind: 'message' | 'call' | 'request'; channel: string; at: string; text: string }
export interface DemandData {
  items: DemandItem[];
  /** Murojaatlar soat bo'yicha (0–23) va hafta kuni bo'yicha (0 — dushanba) */
  hours: number[];
  days: number[];
  totals: { messages: number; calls: number; requests: number };
}

const MAX_ITEMS = 300;
const CUSTOMER_CHARS = 500;
const REPLY_CHARS = 200;
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function collectDemand(bizId: string, fromIso: string, toIso: string): DemandData {
  const items: DemandItem[] = [];
  const hours = Array<number>(24).fill(0), days = Array<number>(7).fill(0);
  const mark = (iso: string) => { const d = new Date(iso); hours[d.getHours()]++; days[(d.getDay() + 6) % 7]++; };

  // Yozishmalar: mijoz bo'yicha — uning gaplari va bizning birinchi javobimiz
  const msgs = sql.many('SELECT lead_id, channel, direction, text, created_at FROM inbox WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, rowid',
    r => ({ lead: String(r.lead_id), channel: String(r.channel), dir: String(r.direction), text: String(r.text ?? ''), at: String(r.created_at) }), bizId, fromIso, toIso);
  const byLead = new Map<string, { channel: string; at: string; said: string[]; reply: string | null }>();
  for (const m of msgs) {
    const t = byLead.get(m.lead);
    if (m.dir === 'in') {
      if (t) t.said.push(m.text);
      else byLead.set(m.lead, { channel: m.channel, at: m.at, said: [m.text], reply: null });
    } else if (t && t.reply === null) t.reply = m.text;
  }
  for (const t of byLead.values()) {
    mark(t.at);
    items.push({ id: `m${items.length + 1}`, kind: 'message', channel: t.channel, at: t.at, text: `Customer: ${clip(t.said.join(' / '), CUSTOMER_CHARS)}${t.reply ? ` | Our reply: ${clip(t.reply, REPLY_CHARS)}` : ' | (no reply)'}` });
  }

  // Qo'ng'iroqlar: mijozning gaplari (yozuv bo'lsa) va natija
  const calls = sql.many('SELECT outcome, transcript, started_at, status, direction, analysis FROM calls WHERE business_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at',
    r => ({ outcome: String(r.outcome ?? ''), transcript: String(r.transcript ?? '[]'), at: String(r.started_at), status: sql.str(r.status), dir: sql.str(r.direction), analysis: sql.str(r.analysis) }), bizId, fromIso, toIso);
  let callCount = 0;
  for (const c of calls) {
    if (c.dir === 'out') continue;
    callCount++;
    mark(c.at);
    let caller = '', wants = '';
    try { caller = (JSON.parse(c.transcript) as { who: string; text: string }[]).filter(l => l.who === 'caller').map(l => l.text).join(' / '); } catch { /* yozuvsiz */ }
    // Yozib olingan qo'ng'iroq tahlili (phone/analysis.ts): mijoz nima istagani
    try { wants = c.analysis ? String((JSON.parse(c.analysis) as { wants?: unknown }).wants ?? '') : ''; } catch { /* tahlilsiz */ }
    const what = c.status === 'missed' ? '(missed call, nobody answered)'
      : caller ? `Caller: ${clip(caller, CUSTOMER_CHARS)}` : wants ? `Caller wanted: ${clip(wants, CUSTOMER_CHARS)}` : '(no transcript)';
    items.push({ id: `c${items.length + 1}`, kind: 'call', channel: 'call', at: c.at, text: `${what} | Outcome: ${clip(c.outcome, REPLY_CHARS)}` });
  }

  // So'rovlar: administratorga qoldirilgan ish (qayta qo'ng'iroq, yozilish, shikoyat…)
  const reqs = sql.many('SELECT kind, summary, quote, source, created_at FROM requests WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    r => ({ kind: String(r.kind), summary: String(r.summary ?? ''), quote: sql.str(r.quote), source: String(r.source), at: String(r.created_at) }), bizId, fromIso, toIso);
  for (const r of reqs) items.push({ id: `r${items.length + 1}`, kind: 'request', channel: r.source, at: r.at, text: `Request (${r.kind}): ${clip(r.summary, 300)}${r.quote ? ` | Customer's words: ${clip(r.quote, 200)}` : ''}` });

  // Juda ko'p bo'lsa — eng yangilari (oxirgilar muhimroq)
  const kept = items.length > MAX_ITEMS ? items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS) : items;
  return { items: kept, hours, days, totals: { messages: byLead.size, calls: callCount, requests: reqs.length } };
}
