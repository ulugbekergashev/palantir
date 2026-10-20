/**
 * Boshqaruv paneli hisob-kitobi: davr va oldingi davr uchun ko'rsatkichlar, soat/kun bo'yicha dinamika, jamoa kesimi, so'nggi murojaatlar.
 * Hammasi shu kompyuterdagi bazadan (yozishmalar, qo'ng'iroqlar, so'rovlar, mijozlar, javoblar) — tashqi xizmatga murojaat yo'q.
 *
 * Murojaat: mijoz bir kunda yozgan xabarlari — bitta murojaat (bir odam uch kun yozsa — uchta); kiruvchi qo'ng'iroq — bitta.
 * Javob vaqti: murojaatdagi birinchi xabardan biz yozgan birinchi javobgacha (egasi, xodim yoki Palantir).
 */
import { daysIn, previousPeriod, type DashboardView, type Kpi, type Period, type RecentItem, type TeamRow } from '../src/lib/dashboard';
import { iso } from '../src/lib/week';
import { leads, sql, type BusinessRow } from './db';
import { staff } from './requests/store';
// Qo'ng'iroqlar jadvalining MicroSIP ustunlari shu yerda tayyor bo'lsin
import './phone/store';

const HOUR_MS = 3_600_000, DAY_MS = 24 * HOUR_MS;
/** Javob shundan kech yozilsa — «javob» emas, keyingi gap (murojaat javobsiz qolgan) */
const ANSWER_WITHIN_MS = DAY_MS;
const RECENT = 25;
/** Javob talab qilmaydigan yakunlovchi gap (o'zbek, rus) */
const CLOSING = /^(rahmat|raxmat|katta rahmat|ok|okey|ок|окей|xo'?p|хоп|хорошо|yaxshi|tushundim|понятно|спасибо|спс|👍|🙏|❤️)[\s!.)]*$/iu;

/** Mahalliy kun boshi (00:00) ISO ko'rinishida — bazadagi UTC vaqtlar bilan solishtirish uchun */
const startOf = (day: string) => new Date(`${day}T00:00:00`).getTime();
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

interface Range { from: number; to: number; bucket: 'hour' | 'day'; size: number }
const rangeOf = (p: { from: string; to: string }): Range => {
  const n = daysIn(p);
  return { from: startOf(p.from), to: startOf(p.to) + DAY_MS, bucket: n === 1 ? 'hour' : 'day', size: n === 1 ? 24 : n };
};
/** Vaqt qaysi bo'lakka tushadi (mahalliy soat yoki kun) */
const slot = (r: Range, t: number): number => {
  if (r.bucket === 'hour') return new Date(t).getHours();
  return Math.round((startOf(iso(new Date(t))) - r.from) / DAY_MS);
};
const zeros = (r: Range) => Array.from({ length: r.size }, () => 0);

interface Msg { lead: string; channel: string; dir: 'in' | 'out'; at: number }
interface CallRow { phone: string; key: string | null; source: string; direction: string | null; status: string | null; at: number; booked: boolean; analysisBooked: boolean; name: string | null; outcome: string; leadId: string | null }

function load(bizId: string, r: Range) {
  const fromIso = new Date(r.from).toISOString(), toIso = new Date(r.to).toISOString();
  // Javobni topish uchun davrdan keyingi bir kun ham olinadi
  const msgs = sql.many('SELECT lead_id, channel, direction, created_at FROM inbox WHERE business_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at',
    (x): Msg => ({ lead: String(x.lead_id), channel: String(x.channel), dir: String(x.direction) as Msg['dir'], at: Date.parse(String(x.created_at)) }),
    bizId, fromIso, new Date(r.to + ANSWER_WITHIN_MS).toISOString());
  const calls = sql.many(`SELECT phone, phone_key, source, direction, status, started_at, booked, analysis, name, outcome, lead_id FROM calls WHERE business_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at`,
    (x): CallRow => ({
      phone: String(x.phone), key: sql.str(x.phone_key), source: String(x.source ?? 'voice'), direction: sql.str(x.direction), status: sql.str(x.status),
      at: Date.parse(String(x.started_at)), booked: !!x.booked, analysisBooked: /"outcome":"booked"/.test(String(x.analysis ?? '')),
      name: sql.str(x.name), outcome: String(x.outcome ?? ''), leadId: sql.str(x.lead_id),
    }), bizId, fromIso, toIso);
  const later = sql.many("SELECT phone_key, started_at FROM calls WHERE business_id = ? AND source = 'microsip' AND status = 'ended' AND started_at >= ?",
    x => ({ key: sql.str(x.phone_key), at: Date.parse(String(x.started_at)) }), bizId, fromIso);
  const opened = sql.many('SELECT created_at FROM requests WHERE business_id = ? AND created_at >= ? AND created_at < ?', x => Date.parse(String(x.created_at)), bizId, fromIso, toIso);
  const closed = sql.many("SELECT created_at, closed_at, done_by, status FROM requests WHERE business_id = ? AND closed_at >= ? AND closed_at < ? AND status = 'done'",
    x => ({ created: Date.parse(String(x.created_at)), closed: Date.parse(String(x.closed_at)), by: sql.str(x.done_by) }), bizId, fromIso, toIso);
  const bookedReplies = sql.many('SELECT booked_at FROM replies WHERE business_id = ? AND booked_at >= ? AND booked_at < ?', x => Date.parse(String(x.booked_at)), bizId, fromIso, toIso);
  const newLeads = sql.many('SELECT created_at FROM leads WHERE business_id = ? AND created_at >= ? AND created_at < ?', x => Date.parse(String(x.created_at)), bizId, fromIso, toIso);
  return { msgs, calls, later, opened, closed, bookedReplies, newLeads };
}

const TELEGRAM = new Set(['bot', 'telegram']);
const isInboundCall = (c: CallRow) => c.source === 'voice' || c.direction === 'in';

interface Computed {
  inquiries: number[]; instagram: number; telegram: number; callsIn: number;
  answered: number[]; responseMin: number | null;
  unanswered: number[]; unansweredMsgs: number; missedCalls: number;
  opened: number[]; closed: number; closeMins: number[];
  booked: number[]; newLeads: number[];
  dyn: DashboardView['dynamics'];
}

function compute(bizId: string, r: Range, now: number): Computed {
  const d = load(bizId, r);
  const out: Computed = {
    inquiries: zeros(r), instagram: 0, telegram: 0, callsIn: 0, answered: zeros(r), responseMin: null, unanswered: zeros(r), unansweredMsgs: 0, missedCalls: 0,
    opened: zeros(r), closed: d.closed.length, closeMins: d.closed.map(c => (c.closed - c.created) / 60_000), booked: zeros(r), newLeads: zeros(r),
    dyn: { instagram: zeros(r), telegram: zeros(r), callsIn: zeros(r), callsOut: zeros(r), missed: zeros(r) },
  };
  // Murojaatlar: (mijoz, kun) — birinchi kiruvchi xabar; javob — undan keyingi birinchi chiquvchi (24 soat ichida)
  const byLead = new Map<string, Msg[]>();
  for (const m of d.msgs) byLead.set(m.lead, [...(byLead.get(m.lead) ?? []), m]);
  const waits: number[] = [];
  for (const list of byLead.values()) {
    const seenDays = new Set<string>();
    for (const m of list) {
      if (m.dir !== 'in' || m.at < r.from || m.at >= r.to) continue;
      const day = iso(new Date(m.at));
      if (seenDays.has(day)) continue;
      seenDays.add(day);
      const s = slot(r, m.at);
      out.inquiries[s]++;
      if (m.channel === 'instagram') { out.instagram++; out.dyn.instagram[s]++; } else if (TELEGRAM.has(m.channel)) { out.telegram++; out.dyn.telegram[s]++; }
      const reply = list.find(x => x.dir === 'out' && x.at > m.at && x.at - m.at <= ANSWER_WITHIN_MS);
      if (reply) { out.answered[s]++; waits.push((reply.at - m.at) / 60_000); } else if (now - m.at > 0) { out.unanswered[s]++; out.unansweredMsgs++; }
    }
  }
  out.responseMin = median(waits);
  for (const c of d.calls) {
    const s = slot(r, c.at);
    if (isInboundCall(c)) {
      out.inquiries[s]++; out.callsIn++; out.dyn.callsIn[s]++;
      if (c.status === 'missed') {
        out.dyn.missed[s]++;
        // Keyin shu raqam bilan gaplashilgan bo'lsa — qayta qo'ng'iroq qilingan
        if (!d.later.some(x => x.key && x.key === c.key && x.at > c.at)) { out.unanswered[s]++; out.missedCalls++; }
      } else out.answered[s]++;
    } else if (c.direction === 'out') out.dyn.callsOut[s]++;
    if (c.booked || c.analysisBooked) out.booked[s]++;
  }
  for (const t of d.opened) out.opened[slot(r, t)]++;
  for (const t of d.bookedReplies) out.booked[slot(r, t)]++;
  for (const t of d.newLeads) out.newLeads[slot(r, t)]++;
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const kpi = (series: number[], prev: number[]): Kpi => ({ value: sum(series), prev: sum(prev), series });

function team(biz: BusinessRow, r: Range): TeamRow[] {
  const fromIso = new Date(r.from).toISOString(), toIso = new Date(r.to).toISOString();
  const rows = sql.many("SELECT done_by, status, created_at, closed_at, attempts, updated_at FROM requests WHERE business_id = ? AND updated_at >= ? AND updated_at < ? AND done_by IS NOT NULL",
    x => ({ by: String(x.done_by), status: String(x.status), created: Date.parse(String(x.created_at)), closed: x.closed_at ? Date.parse(String(x.closed_at)) : null, attempts: Number(x.attempts), updated: String(x.updated_at) }),
    biz.id, fromIso, toIso);
  const of = (match: (by: string) => boolean) => {
    const mine = rows.filter(x => match(x.by));
    const done = mine.filter(x => x.status === 'done' && x.closed);
    return {
      closed: done.length, noAnswer: mine.reduce((n, x) => n + x.attempts, 0), closeMin: median(done.map(x => (x.closed! - x.created) / 60_000)),
      lastActiveAt: mine.map(x => x.updated).sort().at(-1) ?? null,
    };
  };
  const ownerName = biz.profile.ownerName || 'Egasi';
  const members: TeamRow[] = staff.list(biz.id).map(s => ({ id: s.id, name: s.name, role: 'reception', linked: s.linked, ...of(by => by === s.name) }));
  return [...members, { id: null, name: ownerName, role: 'owner', linked: !!biz.ownerChatId, ...of(by => by === ownerName || by.startsWith(`${ownerName} (`) || by === 'Panel') }];
}

function recent(bizId: string): RecentItem[] {
  const who = (leadId: string | null, fallback: string) => {
    const l = leadId ? leads.get(bizId, leadId) : undefined;
    return l?.name || (l?.username ? `@${l.username}` : null) || l?.phone || fallback;
  };
  // Oxirgi xabarga javob yozilgan bo'lsa — javob berildi; javob yo'q, lekin bu «rahmat», «ok» kabi yakunlovchi gap va undan oldin
  // (6 soat ichida) javob yozilgan bo'lsa — javob kutilmaydi; qolgani — javobsiz
  const msgs = sql.many(`SELECT i.lead_id, i.channel, i.text, i.created_at,
      EXISTS (SELECT 1 FROM inbox o WHERE o.business_id = i.business_id AND o.lead_id = i.lead_id AND o.direction = 'out' AND o.created_at > i.created_at) AS after,
      EXISTS (SELECT 1 FROM inbox o WHERE o.business_id = i.business_id AND o.lead_id = i.lead_id AND o.direction = 'out' AND o.created_at < i.created_at
        AND o.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', i.created_at, '-6 hours')) AS before
    FROM inbox i WHERE i.business_id = ? AND i.direction = 'in'
      AND i.created_at = (SELECT MAX(created_at) FROM inbox x WHERE x.business_id = i.business_id AND x.lead_id = i.lead_id AND x.direction = 'in')
    ORDER BY i.created_at DESC LIMIT ?`,
  (x): RecentItem => {
    const text = String(x.text);
    const done = Number(x.after) === 1 || (Number(x.before) === 1 && CLOSING.test(text.trim()));
    return { kind: 'message', at: String(x.created_at), leadId: String(x.lead_id), who: who(String(x.lead_id), 'Mijoz'), channel: String(x.channel), text: text.slice(0, 160), state: done ? 'answered' : 'waiting' };
  },
  bizId, RECENT);
  const calls = sql.many('SELECT lead_id, phone, name, source, direction, status, outcome, started_at, duration_sec FROM calls WHERE business_id = ? ORDER BY started_at DESC LIMIT ?',
    (x): RecentItem => ({
      kind: 'call', at: String(x.started_at), leadId: sql.str(x.lead_id), who: sql.str(x.name) ?? who(sql.str(x.lead_id), String(x.phone)), channel: String(x.source) === 'voice' ? 'voice' : 'call',
      text: String(x.outcome || ''), state: String(x.source) === 'voice' ? 'ended' : `${String(x.direction ?? 'in')}:${String(x.status ?? 'ended')}`,
    }), bizId, RECENT);
  const reqs = sql.many('SELECT lead_id, name, phone, kind, source, summary, status, created_at FROM requests WHERE business_id = ? ORDER BY created_at DESC LIMIT ?',
    (x): RecentItem => ({ kind: 'request', at: String(x.created_at), leadId: sql.str(x.lead_id), who: sql.str(x.name) ?? who(sql.str(x.lead_id), String(x.phone ?? 'Mijoz')), channel: String(x.source), text: `${String(x.kind)}: ${String(x.summary)}`.slice(0, 160), state: String(x.status) }),
    bizId, RECENT);
  return [...msgs, ...calls, ...reqs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT);
}

/** Boshqaruv paneli: davr ko'rsatkichlari (oldingi davr bilan), dinamika, jamoa, so'nggi murojaatlar */
export function dashboard(biz: BusinessRow, period: Period, now = new Date()): DashboardView {
  const r = rangeOf(period), p = rangeOf(previousPeriod(period));
  const cur = compute(biz.id, r, now.getTime()), prev = compute(biz.id, p, now.getTime());
  const labels = r.bucket === 'hour'
    ? Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
    : Array.from({ length: r.size }, (_, i) => iso(new Date(r.from + i * DAY_MS + 12 * HOUR_MS)));
  const open = Number(sql.one("SELECT COUNT(*) n FROM requests WHERE business_id = ? AND status = 'open'", x => x.n, biz.id) ?? 0);
  return {
    period: { ...period, bucket: r.bucket, labels },
    kpi: {
      inquiries: { ...kpi(cur.inquiries, prev.inquiries), instagram: cur.instagram, telegram: cur.telegram, calls: cur.callsIn },
      answered: { ...kpi(cur.answered, prev.answered), responseMin: cur.responseMin, prevResponseMin: prev.responseMin },
      unanswered: { ...kpi(cur.unanswered, prev.unanswered), messages: cur.unansweredMsgs, missedCalls: cur.missedCalls },
      requests: { ...kpi(cur.opened, prev.opened), closed: cur.closed, open, closeMin: median(cur.closeMins) },
      booked: kpi(cur.booked, prev.booked),
      newLeads: kpi(cur.newLeads, prev.newLeads),
    },
    dynamics: cur.dyn,
    team: team(biz, r),
    recent: recent(biz.id),
  };
}
