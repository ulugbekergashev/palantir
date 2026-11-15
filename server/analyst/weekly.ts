/**
 * Tahlilchining o'z ishi (B4, egasi qarori): haftasiga bir marta — o'tgan hafta QAYSI KANAL va QAYSI XIZMAT pul keltirdi.
 * Raqamlar kodda (AI'siz): kanal bo'yicha murojaat → qabul → to'lov → tushum (server/funnel.ts), xizmatlar bo'yicha tushum
 * (DentaCRM to'lovlari). Shu bilan birga «mijozlar nimani so'radi» talab tahlili (AI, director/team.ts: weeklyDemand).
 *
 * Natija: dushanba ertalabki xabarida (Direktordan oldin), Tahlilchi sahifasida va jurnalida; Direktor tahliliga xulosa bo'lib
 * beriladi (director/team.ts: teamFindings). Bir hafta — bir yozuv: qayta hisoblanmaydi va qayta yuborilmaydi.
 */
import { crewHas } from '../../src/lib/crew';
import { iso } from '../../src/lib/week';
import { money } from '../../src/lib/text';
import { sql, type BusinessRow } from '../db';
import { periodRange } from '../crm/report';
import { funnel, serviceRevenue, type ServiceMoney } from '../funnel';
import { insightsStore } from '../insights/analyze';
import { events } from '../orders/store';

sql.exec(`CREATE TABLE IF NOT EXISTS analyst_weeks (
  business_id TEXT NOT NULL, week_from TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (business_id, week_from)
)`);

type Channel = 'instagram' | 'telegram' | 'call';
export interface ChannelMoney { channel: Channel; inquiries: number; booked: number; paid: number | null; revenue: number | null }
export interface AnalystWeek {
  from: string; to: string; crm: boolean; channels: ChannelMoney[]; services: ServiceMoney[] | null;
  /** «Mijozlar nimani so'radi» — oxirgi talab tahlilining bir gapi (bo'lmasa — null) */
  demand: string | null; createdAt: string;
}

const CHANNEL_LABEL: Record<Channel, string> = { instagram: 'Instagram', telegram: 'Telegram', call: "Qo'ng'iroq" };
const CHANNELS: Channel[] = ['instagram', 'telegram', 'call'];
/** Shundan kam murojaat bo'lgan kanal haqida «hech kim yozilmadi» deyilmaydi (tasodif) */
const MIN_FOR_WARNING = 3;
const TOP_SERVICES = 5;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const som = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} mln so'm` : `${money(n)} so'm`);
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export const analystWeeks = {
  get: (bizId: string, from: string): AnalystWeek | null =>
    sql.one('SELECT data FROM analyst_weeks WHERE business_id = ? AND week_from = ?', r => JSON.parse(String(r.data)) as AnalystWeek, bizId, from) ?? null,
  latest: (bizId: string): AnalystWeek | null =>
    sql.one('SELECT data FROM analyst_weeks WHERE business_id = ? ORDER BY week_from DESC LIMIT 1', r => JSON.parse(String(r.data)) as AnalystWeek, bizId) ?? null,
  put: (bizId: string, w: AnalystWeek) =>
    sql.run('INSERT OR REPLACE INTO analyst_weeks (business_id, week_from, data, created_at) VALUES (?, ?, ?, ?)', bizId, w.from, JSON.stringify(w), w.createdAt),
};

const hasNumbers = (w: AnalystWeek) => w.channels.some(c => c.inquiries > 0) || !!w.services?.length;

/** O'tgan haftaning hisobi (raqamlar — kodda) */
export async function buildWeek(biz: BusinessRow, now = new Date()): Promise<AnalystWeek> {
  const week = periodRange('last_week', iso(now));
  const [f, services] = await Promise.all([funnel(biz, week, now), serviceRevenue(biz, week).catch(() => null)]);
  const channels = CHANNELS.map(ch => ({
    channel: ch, inquiries: f.inquiries.byChannel[ch], booked: f.booked.byChannel[ch],
    paid: f.paid ? f.paid.byChannel[ch] : null, revenue: f.revenue ? f.revenue.byChannel[ch] : null,
  })).filter(c => c.inquiries > 0);
  const d = insightsStore.latest(biz.id, 7);
  const demand = d && (d.themes.length || d.unanswered.length) ? d.headline : null;
  return { from: week.from, to: week.to, crm: f.crm, channels, services, demand, createdAt: new Date().toISOString() };
}

/** Kodda chiqarilgan xulosa: qaysi kanal eng ko'p pul (yoki qabul) berdi, qaysi kanaldan murojaat bor-u yozilgan yo'q */
export function weekVerdict(w: AnalystWeek): string[] {
  const out: string[] = [];
  const paid = w.channels.filter(c => (c.revenue ?? 0) > 0).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const total = paid.reduce((n, c) => n + (c.revenue ?? 0), 0);
  if (paid.length) out.push(`💡 Eng ko'p pul — ${CHANNEL_LABEL[paid[0].channel]}dan (${Math.round(((paid[0].revenue ?? 0) / total) * 100)}%)`);
  else {
    const booked = w.channels.filter(c => c.booked > 0).sort((a, b) => b.booked - a.booked);
    if (booked.length) out.push(`💡 Eng ko'p qabul — ${CHANNEL_LABEL[booked[0].channel]}dan (${booked[0].booked} ta)`);
  }
  for (const c of w.channels) if (c.inquiries >= MIN_FOR_WARNING && c.booked === 0) out.push(`⚠️ ${CHANNEL_LABEL[c.channel]}dan ${c.inquiries} murojaat — birortasi qabulga yozilmadi`);
  return out;
}

/** Egasiga xabar (Telegram HTML). Aytadigan narsa bo'lmasa — null */
export function weekHtml(w: AnalystWeek): string | null {
  if (!hasNumbers(w)) return null;
  const lines = [`📊 <b>Tahlilchi — o'tgan hafta</b> (${dm(w.from)}–${dm(w.to)})`];
  if (w.channels.length) {
    lines.push('', '<b>Kanallar: murojaatdan pulgacha</b>');
    for (const c of w.channels) {
      const steps = [`${c.inquiries} murojaat`, `${c.booked} yozildi`, ...(c.paid !== null ? [`${c.paid} to'ladi`] : [])].join(' → ');
      lines.push(`• ${CHANNEL_LABEL[c.channel]}: ${steps}${c.revenue ? ` · ${som(c.revenue)}` : ''}`);
    }
    if (!w.crm) lines.push("<i>Kim kelib to'lagani — DentaCRM ulansa ko'rinadi.</i>");
  }
  if (w.services?.length) {
    const total = w.services.reduce((n, s) => n + s.revenue, 0);
    lines.push('', `<b>Xizmatlar bo'yicha tushum</b> (klinika jami: ${som(total)})`);
    for (const s of w.services.slice(0, TOP_SERVICES)) lines.push(`• ${esc(s.name)} — ${som(s.revenue)} (${s.count} to'lov)`);
  }
  const verdict = weekVerdict(w);
  if (verdict.length) lines.push('', ...verdict);
  if (w.demand) lines.push('', `🗣 Mijozlar so'radi: ${esc(w.demand)}`);
  return lines.join('\n');
}

/** Direktor so'roviga: Tahlilchining oxirgi haftalik xulosasi (mijoz matni yo'q — faqat raqamlar va xizmat nomlari) */
export function weekFindings(bizId: string): string {
  const w = analystWeeks.latest(bizId);
  if (!w || !hasNumbers(w)) return '';
  const fence = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');
  return [
    `Analyst — money by channel, ${w.from}…${w.to} (inquiries → booked → paid, revenue in so'm):`,
    ...w.channels.map(c => `- ${c.channel}: ${c.inquiries} → ${c.booked}${c.paid !== null ? ` → ${c.paid}` : ''}${c.revenue !== null ? `, ${c.revenue}` : ''}`),
    ...(w.services?.length ? [`Analyst — revenue by service: ${w.services.slice(0, TOP_SERVICES).map(s => `${fence(s.name)} ${s.revenue}`).join('; ')}`] : []),
  ].join('\n');
}

/**
 * Ertalab (scheduler.ts: morningMessage, Direktordan oldin): Tahlilchi jamoada va o'tgan hafta hali hisoblanmagan bo'lsa — hisoblaydi,
 * saqlaydi, jurnalga yozadi va egasiga bo'lak qaytaradi. Shu hafta allaqachon bor — null (qayta yuborilmaydi)
 */
export async function analystMorning(biz: BusinessRow, now = new Date()): Promise<string | null> {
  // Faqat jamoaga olingan Tahlilchi (menyuda bor) — olinmagan bo'lsa egasiga haftalik xabar kelmaydi
  if (!crewHas(biz, 'tahlilchi')) return null;
  const week = periodRange('last_week', iso(now));
  if (analystWeeks.get(biz.id, week.from)) return null;
  const w = await buildWeek(biz, now);
  analystWeeks.put(biz.id, w);
  const html = weekHtml(w);
  if (!html) return null;
  const verdict = weekVerdict(w);
  events.add(biz.id, {
    member: 'tahlilchi', orderId: null, level: 'info', cameraId: null,
    title: `Haftalik hisobot ${dm(w.from)}–${dm(w.to)}${verdict[0] ? `: ${verdict[0].replace(/^\S+\s/, '')}` : ''}`.slice(0, 200),
    body: html.replace(/<[^>]+>/g, '').split('\n').slice(1).filter(Boolean).join('\n').slice(0, 1500),
  });
  return html;
}
