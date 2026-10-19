/**
 * «Bugun jamoa nima qildi» — bosh ekranda har AI xodimning bugungi ishi, haqiqiy yozuvlardan (AI'siz: arzon, tez, har doim bir xil):
 *   Qabulxona — murojaatlar, javoblar, qabulga yozilganlar, qoldirilgan so'rovlar (analytics.ts bilan bir xil hisob);
 *   Yordamchi — ertalabki reja, eslatmalar, bajarilgan ishlar, mijozlarga tayyorlangan xabarlar;
 *   Kuzatuvchi — kameralar va bugungi hodisalar; Tahlilchi — vaqtli topshiriqlar bo'yicha hisobotlar.
 * Pastida — bugungi jurnal (hamma xodim yozuvlari), yangisi tepada.
 */
import type { Express, Request, Response } from 'express';
import type { AgentEvent, OrderMember } from '../src/types';
import { periodDays } from '../src/lib/dashboard';
import { iso } from '../src/lib/week';
import { dashboard } from './analytics';
import { cameras, outbound, tasks, type BusinessRow } from './db';
import { events } from './orders/store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

export interface DayFact { label: string; value: number }
export interface DayMember { member: OrderMember; summary: string; facts: DayFact[] }
export interface TeamDay { date: string; members: DayMember[]; timeline: AgentEvent[] }

const TIMELINE = 12;

function reception(biz: BusinessRow, now: Date): DayMember {
  const k = dashboard(biz, periodDays('today', now), now).kpi;
  const inq = k.inquiries.value, ans = k.answered.value, booked = k.booked.value, left = k.unanswered.value;
  const summary = !inq ? "Bugun hali murojaat bo'lmadi — navbatchilikda."
    : `${inq} murojaatdan ${ans} tasiga javob berdi${k.answered.responseMin != null ? ` (o'rtacha ${k.answered.responseMin} daqiqada)` : ''}`
      + `${booked ? `, ${booked} kishini qabulga yozdi` : ''}.${left ? ` ${left} tasi hali javobsiz.` : ''}`;
  return { member: 'qabulxona', summary, facts: [
    { label: 'Murojaat', value: inq }, { label: 'Javob berdi', value: ans }, { label: 'Qabulga yozdi', value: booked }, { label: "So'rov qoldirdi", value: k.requests.value },
  ] };
}

function assistant(biz: BusinessRow, from: string, to: string, today: string): DayMember {
  const done = tasks.doneBetween(biz.id, from, to), reminded = tasks.remindedBetween(biz.id, from, to);
  const drafts = outbound.countSince(biz.id, from);
  const plan = biz.briefSentDate === today;
  const parts = [plan && 'ertalabki rejani yubordi', reminded && `${reminded} ta eslatma qildi`, done && `${done} ta ish bajarildi`, drafts && `mijozlarga ${drafts} ta xabar tayyorladi`].filter(Boolean);
  const summary = parts.length ? `${String(parts.join(', ')).replace(/^./, c => c.toUpperCase())}.` : "Bugun hali ish bo'lmadi — eslatma yoki topshiriq bering.";
  return { member: 'yordamchi', summary, facts: [{ label: 'Eslatma', value: reminded }, { label: 'Bajarildi', value: done }, { label: 'Xabar tayyorladi', value: drafts }] };
}

type Tally = { member: OrderMember; level: AgentEvent['level']; n: number }[];
const count = (t: Tally, member: OrderMember, alertsOnly = false) => t.filter(x => x.member === member && (!alertsOnly || x.level !== 'info')).reduce((a, x) => a + x.n, 0);

function watcher(biz: BusinessRow, t: Tally): DayMember {
  const cams = cameras.list(biz.id).length;
  const all = count(t, 'kuzatuvchi'), alerts = count(t, 'kuzatuvchi', true);
  const summary = !cams ? "Kamera ulanmagan — kuzatadigan narsa yo'q."
    : !all ? `${cams} kamera kuzatyapti — bugun alohida hodisa bo'lmadi.`
      : `${cams} kamera kuzatyapti: ${all} ta yozuv${alerts ? `, shundan ${alerts} tasi diqqat talab` : ''}.`;
  return { member: 'kuzatuvchi', summary, facts: [{ label: 'Kamera', value: cams }, { label: 'Yozuv', value: all }, { label: 'Diqqat', value: alerts }] };
}

function analyst(t: Tally): DayMember {
  const done = count(t, 'tahlilchi');
  const summary = done ? `Bugun ${done} ta hisobot tayyorladi.` : "Raqamlarni yig'ib turibdi — vaqtli hisobot uchun topshiriq bering.";
  return { member: 'tahlilchi', summary, facts: [{ label: 'Hisobot', value: done }] };
}

export function teamDay(biz: BusinessRow, now = new Date()): TeamDay {
  const today = iso(now);
  const from = new Date(`${today}T00:00:00`).toISOString(), to = new Date(now.getTime() + 1000).toISOString();
  const t = events.tally(biz.id, from);
  return {
    date: today,
    members: [reception(biz, now), assistant(biz, from, to, today), watcher(biz, t), analyst(t)],
    timeline: events.since(biz.id, from, TIMELINE),
  };
}

export function mountTeamDay(app: Express, { asBiz }: Deps): void {
  app.get('/api/team/day', asBiz((_req, res, biz) => { res.json(teamDay(biz)); }));
}
