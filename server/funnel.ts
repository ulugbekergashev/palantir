/**
 * Voronka pul bilan: davrda murojaat qilganlar → javob olganlar → qabulga yozilganlar → kelganlar → to'laganlar (tushum),
 * qaysi kanaldan kelgani bo'yicha (Instagram, Telegram, qo'ng'iroq). «Yozildi, keldi, to'ladi» — DentaCRM'dan: mijoz kartasi
 * bemorga bog'langan bo'lsa (telefon va ism bo'yicha yoki Palantir o'zi yozgan). CRM ulanmagan bo'lsa — faqat Palantir bilgani.
 *
 * Bir odam — bir marta (davrda bir necha marta yozgan bo'lsa ham); kanali — davrdagi birinchi murojaati.
 */
import type { FunnelView } from '../src/lib/dashboard';
import { addDays, iso } from '../src/lib/week';
import { leads, sql, type BusinessRow } from './db';
import { crmConnected, withCrm } from './crm/index';
import { datesBetween } from './crm/report';
import type { DayData } from './crm/report';

const DAY_MS = 86_400_000;
/** Murojaatdan keyin shuncha kun ichidagi qabul — shu murojaatniki */
const BOOKED_AHEAD_DAYS = 30;
/** CRM'dan bir vaqtda shuncha kun so'raladi (keshda bo'lmaganlari) */
const CONCURRENCY = 6;
const CAME = new Set(['Completed', 'Checked-In']);
type Channel = 'instagram' | 'telegram' | 'call';

interface Who { lead: string; channel: Channel; first: number; answered: boolean; booked: boolean; patientId: string | null }

/**
 * Palantir o'zi yozgan qabullar (yozishma, ovozli agent, qo'ng'iroq tahlili) — shu davr ichida, KPI «Qabulga yozildi» bilan
 * bir xil manba: chiquvchi qo'ng'iroqda yozilgani ham (G6)
 */
function palantirBooked(bizId: string, fromIso: string, toIso: string): Set<string> {
  return new Set([
    ...sql.many('SELECT DISTINCT lead_id FROM replies WHERE business_id = ? AND booked_at >= ? AND booked_at < ?', x => String(x.lead_id), bizId, fromIso, toIso),
    ...sql.many(`SELECT DISTINCT lead_id FROM calls WHERE business_id = ? AND lead_id IS NOT NULL AND started_at >= ? AND started_at < ?
      AND (booked IS NOT NULL AND booked != '' OR analysis LIKE '%"outcome":"booked"%')`, x => String(x.lead_id), bizId, fromIso, toIso),
  ]);
}

/** Davrdagi murojaat qilgan odamlar (yozgan yoki qo'ng'iroq qilgan) */
function people(bizId: string, from: number, to: number): Map<string, Who> {
  const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
  const out = new Map<string, Who>();
  const add = (lead: string, channel: Channel, at: number) => {
    const cur = out.get(lead);
    if (!cur || at < cur.first) out.set(lead, { lead, channel, first: at, answered: cur?.answered ?? false, booked: cur?.booked ?? false, patientId: null });
  };
  const msgs = sql.many("SELECT lead_id, channel, created_at FROM inbox WHERE business_id = ? AND direction = 'in' AND created_at >= ? AND created_at < ?",
    x => ({ lead: String(x.lead_id), channel: String(x.channel), at: Date.parse(String(x.created_at)) }), bizId, fromIso, toIso);
  for (const m of msgs) add(m.lead, m.channel === 'instagram' ? 'instagram' : 'telegram', m.at);
  const calls = sql.many("SELECT lead_id, status, started_at FROM calls WHERE business_id = ? AND lead_id IS NOT NULL AND (source = 'voice' OR direction = 'in') AND started_at >= ? AND started_at < ?",
    x => ({ lead: String(x.lead_id), ended: String(x.status ?? 'ended') !== 'missed', at: Date.parse(String(x.started_at)) }), bizId, fromIso, toIso);
  for (const c of calls) add(c.lead, 'call', c.at);
  // Javob: yozganiga 24 soat ichida javob yozilgan yoki qo'ng'irog'i ko'tarilgan
  const answeredMsg = new Set(sql.many(`SELECT DISTINCT i.lead_id FROM inbox i WHERE i.business_id = ? AND i.direction = 'in' AND i.created_at >= ? AND i.created_at < ?
      AND EXISTS (SELECT 1 FROM inbox o WHERE o.business_id = i.business_id AND o.lead_id = i.lead_id AND o.direction = 'out' AND o.created_at > i.created_at
        AND o.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', i.created_at, '+1 day'))`, x => String(x.lead_id), bizId, fromIso, toIso));
  for (const w of out.values()) w.answered = answeredMsg.has(w.lead) || calls.some(c => c.lead === w.lead && c.ended);
  const bookedLeads = palantirBooked(bizId, fromIso, toIso);
  for (const w of out.values()) w.booked = bookedLeads.has(w.lead);
  for (const w of out.values()) w.patientId = leads.get(bizId, w.lead)?.patientId ?? null;
  return out;
}

async function crmDays(bizId: string, dates: string[]): Promise<DayData[]> {
  return withCrm(bizId, async crm => {
    const out: DayData[] = [];
    for (let i = 0; i < dates.length; i += CONCURRENCY) out.push(...await Promise.all(dates.slice(i, i + CONCURRENCY).map(d => crm.day(d))));
    return out;
  });
}

const empty = () => ({ instagram: 0, telegram: 0, call: 0 });

export async function funnel(biz: BusinessRow, period: { from: string; to: string }, now = new Date()): Promise<FunnelView> {
  const from = new Date(`${period.from}T00:00:00`).getTime(), to = new Date(`${period.to}T00:00:00`).getTime() + DAY_MS;
  const who = [...people(biz.id, from, to).values()];
  // Davrda o'zi murojaat qilmagan, lekin biz o'zimiz (chiquvchi qo'ng'iroq, qayta yozish) qabulga yozgan bemorlar: voronkaga kirmaydi,
  // lekin KPI «Qabulga yozildi»da bor — farq panelda shu son bilan tushuntiriladi (G6)
  const inFunnel = new Set(who.map(w => w.lead));
  const outreach = [...palantirBooked(biz.id, new Date(from).toISOString(), new Date(to).toISOString())].filter(l => !inFunnel.has(l)).length;
  const step = (pick: (w: Who) => boolean) => {
    const byChannel = empty();
    for (const w of who) if (pick(w)) byChannel[w.channel]++;
    return { total: byChannel.instagram + byChannel.telegram + byChannel.call, byChannel };
  };
  const base = { inquiries: step(() => true), answered: step(w => w.answered) };
  const linked = who.filter(w => w.patientId);
  if (!crmConnected(biz.id)) {
    return { crm: false, linked: 0, outreach, ...base, booked: step(w => w.booked), came: null, paid: null, revenue: null };
  }
  // Qabullar: murojaat kunidan keyingi oy ichida; kelgan va to'lagani — bugungacha
  const today = iso(now);
  const last = iso(addDays(new Date(`${period.to}T12:00:00`), BOOKED_AHEAD_DAYS));
  let days: DayData[];
  try {
    days = await crmDays(biz.id, datesBetween(period.from, last));
  } catch (e) {
    return { crm: true, linked: linked.length, outreach, ...base, booked: step(w => w.booked), came: null, paid: null, revenue: null, problem: (e as Error).message };
  }
  const byPatient = new Map<string, Who>();
  for (const w of linked) byPatient.set(w.patientId!, w);
  const booked = new Set<string>(), came = new Set<string>();
  const revenue = empty();
  const paidBy = new Set<string>();
  for (const d of days) {
    for (const a of d.appointments) {
      const w = byPatient.get(a.patientId);
      if (!w || a.date < iso(new Date(w.first))) continue;
      if (a.status !== 'Cancelled') booked.add(w.lead);
      if (CAME.has(a.status) && a.date <= today) came.add(w.lead);
    }
    for (const t of d.transactions) {
      const w = t.patientId ? byPatient.get(t.patientId) : undefined;
      // Balansdan to'lov — yangi pul emas (oldin to'langan avans)
      if (!w || d.date < iso(new Date(w.first)) || d.date > today || t.status !== 'Paid' || t.type === 'Balance') continue;
      revenue[w.channel] += t.amount;
      paidBy.add(w.lead);
    }
  }
  return {
    crm: true, linked: linked.length, outreach, ...base,
    booked: step(w => w.booked || booked.has(w.lead)), came: step(w => came.has(w.lead)), paid: step(w => paidBy.has(w.lead)),
    revenue: { total: revenue.instagram + revenue.telegram + revenue.call, byChannel: revenue },
  };
}

export interface ServiceMoney { name: string; revenue: number; count: number }
/** Xizmat nomi bo'lmagan to'lov shu nom bilan */
const NO_SERVICE = "Xizmat ko'rsatilmagan";
/**
 * Davrdagi tushum xizmatlar bo'yicha (DentaCRM to'lovlari, klinikaning hamma bemorlari — faqat murojaat qilganlar emas):
 * kamayish tartibida. Balansdan to'lov — yangi pul emas. CRM ulanmagan bo'lsa — null
 */
export async function serviceRevenue(biz: BusinessRow, period: { from: string; to: string }): Promise<ServiceMoney[] | null> {
  if (!crmConnected(biz.id)) return null;
  const days = await crmDays(biz.id, datesBetween(period.from, period.to));
  const by = new Map<string, ServiceMoney>();
  for (const d of days) {
    for (const t of d.transactions) {
      if (t.status !== 'Paid' || t.type === 'Balance' || t.amount <= 0) continue;
      const name = t.service?.trim() || NO_SERVICE;
      const cur = by.get(name) ?? { name, revenue: 0, count: 0 };
      by.set(name, { name, revenue: cur.revenue + t.amount, count: cur.count + 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue);
}
