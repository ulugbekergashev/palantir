/**
 * «Bugun jamoa nima qildi» — bosh ekranda har AI xodimning bugungi ishi, haqiqiy yozuvlardan (AI'siz: arzon, tez, har doim bir xil):
 *   Qabulxona — murojaatlar, javoblar, qabulga yozilganlar, qoldirilgan so'rovlar (analytics.ts bilan bir xil hisob), mijozlarga tayyorlangan xabarlar;
 *   Yordamchi — ertalabki reja, eslatmalar, bajarilgan ishlar;
 *   Kuzatuvchi — kameralar va bugungi hodisalar; Tahlilchi — hisobotlar (haftalik talab tahlili va topshiriqlar); Marketolog — Meta AI'dan olgan tahlillari;
 *   Kontent-meyker — postlar, videolar, joylangani; Targetolog — ishlayotgan reklama va yangi rejalar.
 * Bajarilmagan urinish («Bajarilmadi: …») ish deb sanalmaydi — alohida aytiladi.
 * Pastida — bugungi jurnal (hamma xodim yozuvlari), yangisi tepada.
 */
import type { Express, Request, Response } from 'express';
import type { AgentEvent, OrderMember } from '../src/types';
import { periodDays } from '../src/lib/dashboard';
import { iso } from '../src/lib/week';
import { dashboard } from './analytics';
import { cameras, connections, outbound, sql, tasks, type BusinessRow } from './db';
import { adsStore } from './ads/store';
import { contentStore } from './content/store';
import { insightsStore } from './insights/analyze';
// Sanaladigan jadvallar (marketing_posts, content_videos) shu modullar yuklanganda yaratiladi
import './marketing/posts';
import './content/video';
import { isClinic } from '../src/data/industries';
import { crmConnected } from './crm/index';
import { events } from './orders/store';
import { crewHas } from '../src/lib/crew';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

export interface DayFact { label: string; value: number }
export interface DayMember { member: OrderMember; summary: string; facts: DayFact[] }
export interface TeamDay { date: string; members: DayMember[]; timeline: AgentEvent[] }

const TIMELINE = 12;

const sentence = (parts: (string | false | 0)[]) => { const p = parts.filter(Boolean).join(', '); return p ? `${p.replace(/^./, c => c.toUpperCase())}.` : ''; };

/** Qabulxona: murojaatlar va javoblar; mijozlarga qayta yozish xabarlari ham uniki (kim so'rasa ham — tools.ts QABULXONA_DEFS) */
function reception(biz: BusinessRow, now: Date, from: string): DayMember {
  const k = dashboard(biz, periodDays('today', now), now).kpi;
  const inq = k.inquiries.value, ans = k.answered.value, booked = k.booked.value, left = k.unanswered.value;
  const drafts = outbound.countSince(biz.id, from);
  const clinic = isClinic(biz.profile.industry, crmConnected(biz.id));
  const wrote = drafts ? ` Mijozlarga ${drafts} ta qayta yozish xabarini tayyorladi.` : '';
  const summary = !inq ? `Bugun hali murojaat bo'lmadi — navbatchilikda.${wrote}`
    : `${inq} murojaatdan ${ans} tasiga javob berdi${k.answered.responseMin != null ? ` (o'rtacha ${k.answered.responseMin} daqiqada)` : ''}`
      + `${booked ? (clinic ? `, ${booked} kishini qabulga yozdi` : `, ${booked} ta kelishuv`) : ''}.${left ? ` ${left} tasi hali javobsiz.` : ''}${wrote}`;
  return { member: 'qabulxona', summary, facts: [
    { label: 'Murojaat', value: inq }, { label: 'Javob berdi', value: ans }, { label: clinic ? 'Qabulga yozdi' : 'Kelishildi', value: booked }, { label: "So'rov qoldirdi", value: k.requests.value },
    { label: 'Xabar tayyorladi', value: drafts },
  ] };
}

function assistant(biz: BusinessRow, from: string, to: string, today: string): DayMember {
  const done = tasks.doneBetween(biz.id, from, to), reminded = tasks.remindedBetween(biz.id, from, to);
  const plan = biz.briefSentDate === today;
  const summary = sentence([plan && 'ertalabki rejani yubordi', reminded && `${reminded} ta eslatma qildi`, done && `${done} ta ish bajarildi`])
    || "Bugun hali ish bo'lmadi — eslatma yoki topshiriq bering.";
  return { member: 'yordamchi', summary, facts: [{ label: 'Eslatma', value: reminded }, { label: 'Bajarildi', value: done }] };
}

type Tally = { member: OrderMember; level: AgentEvent['level']; kind: 'done' | 'failed' | 'assigned'; n: number }[];
/** all — hamma yozuv; alerts — diqqat talab (info emas); done — xodim qilgan ish (Direktor topshirig'i va bajarilmagani emas); failed — bajarilmagan urinish */
type Pick = 'all' | 'alerts' | 'done' | 'failed';
const count = (t: Tally, member: OrderMember, pick: Pick = 'all') => t.filter(x => x.member === member
  && (pick === 'alerts' ? x.level !== 'info' : pick === 'all' ? true : x.kind === pick)).reduce((a, x) => a + x.n, 0);
const failedNote = (n: number) => (n ? ` ${n} ta urinish bajarilmadi — sababi jurnalda.` : '');
/** Bugun (from'dan beri) shu ustunga vaqt yozilgan qatorlar soni. Jadval va ustun nomlari — shu fayldagi o'zgarmaslar */
const since = (table: string, column: string, bizId: string, from: string, where = '') =>
  sql.one(`SELECT COUNT(*) AS n FROM ${table} WHERE business_id = ? AND ${column} >= ?${where}`, r => Number(r.n), bizId, from) ?? 0;

function watcher(biz: BusinessRow, t: Tally): DayMember {
  const cams = cameras.list(biz.id).length;
  const all = count(t, 'kuzatuvchi'), alerts = count(t, 'kuzatuvchi', 'alerts');
  const summary = !cams ? "Kamera ulanmagan — kuzatadigan narsa yo'q."
    : !all ? `${cams} kamera kuzatyapti — bugun alohida hodisa bo'lmadi.`
      : `${cams} kamera kuzatyapti: ${all} ta yozuv${alerts ? `, shundan ${alerts} tasi diqqat talab` : ''}.`;
  return { member: 'kuzatuvchi', summary, facts: [{ label: 'Kamera', value: cams }, { label: 'Yozuv', value: all }, { label: 'Diqqat', value: alerts }] };
}

function analyst(biz: BusinessRow, t: Tally): DayMember {
  const done = count(t, 'tahlilchi', 'done'), failed = count(t, 'tahlilchi', 'failed');
  const last = insightsStore.latest(biz.id, 7);
  const weekly = last && (last.themes.length || last.unanswered.length) ? ` Oxirgisi — ${last.createdAt.slice(8, 10)}.${last.createdAt.slice(5, 7)}.` : '';
  const summary = done ? `Bugun ${done} ta hisobot tayyorladi.${failedNote(failed)}`
    : `Har hafta mijozlar nimani so'rayotganini o'zi tahlil qiladi.${weekly}${failedNote(failed)}`;
  return { member: 'tahlilchi', summary, facts: [{ label: 'Hisobot', value: done }] };
}

function marketer(biz: BusinessRow, t: Tally): DayMember {
  const done = count(t, 'marketolog', 'done'), failed = count(t, 'marketolog', 'failed');
  const summary = done ? `Bugun Meta AI orqali ${done} ta tahlil tayyorladi.${failedNote(failed)}`
    : connections.get(biz.id, 'meta_ai') ? `Meta AI ulangan — raqobatchilar yoki kontent bo'yicha so'rang yoki jadval bering.${failedNote(failed)}` : "Meta AI ulanmagan — Marketolog → Ulash.";
  return { member: 'marketolog', summary, facts: [{ label: 'Tahlil', value: done }] };
}

/** Kontent-meyker: bugun tayyorlagan postlar (kanal va Instagram), videolar va joylangani; tasdiq kutayotgan qoralamalar */
function content(biz: BusinessRow, from: string): DayMember {
  const posts = since('content_drafts', 'created_at', biz.id, from) + since('marketing_posts', 'created_at', biz.id, from);
  const videos = since('content_videos', 'created_at', biz.id, from);
  const published = since('content_drafts', 'published_at', biz.id, from) + since('marketing_posts', 'published_at', biz.id, from) + since('content_videos', 'channel_at', biz.id, from);
  const waiting = contentStore.waiting(biz.id) + (sql.one("SELECT COUNT(*) AS n FROM marketing_posts WHERE business_id = ? AND status = 'draft'", r => Number(r.n), biz.id) ?? 0);
  const did = sentence([posts && `${posts} ta post tayyorladi`, videos && `${videos} ta video`, published && `${published} tasi joylandi`]);
  const wait = waiting ? ` ${waiting} ta qoralama tasdiqingizni kutyapti.` : '';
  const summary = did ? `${did}${wait}` : wait.trim() || "Bugun hali post tayyorlanmadi — reja tuzing yoki mavzu bering.";
  return { member: 'kontent', summary, facts: [{ label: 'Post', value: posts }, { label: 'Video', value: videos }, { label: 'Joylandi', value: published }] };
}

/** Targetolog: ishlayotgan reklama va bugun tuzilgan rejalar (natija — jami, bugungi emas: faktlarga qo'yilmaydi) */
function ads(biz: BusinessRow, from: string): DayMember {
  const live = adsStore.live(biz.id);
  const active = live.filter(c => c.status === 'active'), paused = live.length - active.length;
  const planned = since('ads_campaigns', 'created_at', biz.id, from);
  const results = active.reduce((a, c) => a + c.results, 0);
  const summary = (active.length ? `${active.length} ta reklama ishlayapti${results ? ` (boshlanganidan beri ${results} ta natija)` : ''}.` : 'Hozir reklama ishlamayapti.')
    + (paused ? ` ${paused} tasi to'xtatilgan.` : '') + (planned ? ` Bugun ${planned} ta reklama rejasi tuzdi.` : '');
  return { member: 'target', summary, facts: [{ label: 'Ishlayapti', value: active.length }, { label: 'Yangi reja', value: planned }] };
}

const usesCameras = (biz: BusinessRow) => cameras.list(biz.id).length > 0 || isClinic(biz.profile.industry, crmConnected(biz.id));

export function teamDay(biz: BusinessRow, now = new Date()): TeamDay {
  const today = iso(now);
  const from = new Date(`${today}T00:00:00`).toISOString(), to = new Date(now.getTime() + 1000).toISOString();
  const t = events.tally(biz.id, from);
  return {
    date: today,
    // Faqat jamoadagi xodimlar; kamerasi yo'q, klinika emas — Kuzatuvchi ro'yxatda yo'q (bo'sh «Kamera 0» ko'rsatilmaydi)
    members: [
      ...(crewHas(biz, 'qabulxona') ? [reception(biz, now, from)] : []), assistant(biz, from, to, today),
      ...(crewHas(biz, 'kuzatuvchi') && usesCameras(biz) ? [watcher(biz, t)] : []),
      ...(crewHas(biz, 'tahlilchi') ? [analyst(biz, t)] : []), ...(crewHas(biz, 'marketolog') ? [marketer(biz, t)] : []),
      ...(crewHas(biz, 'kontent') ? [content(biz, from)] : []), ...(crewHas(biz, 'target') ? [ads(biz, from)] : []),
    ],
    timeline: events.since(biz.id, from, TIMELINE),
  };
}

export function mountTeamDay(app: Express, { asBiz }: Deps): void {
  app.get('/api/team/day', asBiz((_req, res, biz) => { res.json(teamDay(biz)); }));
}
