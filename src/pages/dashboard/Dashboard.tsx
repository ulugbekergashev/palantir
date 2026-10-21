import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  ArrowDownRight, ArrowUpRight, BellRing, CalendarCheck, Camera, CircleAlert, Loader2, MessageCircle, MessageSquareReply, PhoneCall, PhoneIncoming, PhoneMissed,
  PhoneOutgoing, Send, Sparkles, Stethoscope, UserPlus, Users,
} from 'lucide-react';
import type { Camera as CameraRow, LiveStatus } from '../../types';
import { api, type PhoneStatus } from '../../data/api';
import { PERIOD_LABEL, changePct, type DashboardView, type FunnelView, type Kpi, type PeriodKey, type RecentItem } from '../../lib/dashboard';
import { prettyPhone } from '../../lib/phone';
import { iso } from '../../lib/week';
import { LineChart, Sparkline } from './Charts';
import { Funnel } from './Funnel';

type Icon = ComponentType<{ className?: string }>;
/** Instagram belgisi (lucide'da brend belgilari yo'q) */
const Instagram: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" />
  </svg>
);

const REFRESH_MS = 30_000;
const PERIOD_KEY = 'palantir_dashboard_period';
const COLORS = { instagram: '#d6336c', telegram: '#229ed9', callsIn: '#0e9f6e', callsOut: '#6d5bd0', missed: '#d97706', ink: '#d5d8de' } as const;

const readPeriod = (): PeriodKey => { try { const v = localStorage.getItem(PERIOD_KEY); return v === 'yesterday' || v === 'week' || v === 'month' ? v : 'today'; } catch { return 'today'; } };
const savePeriod = (v: PeriodKey) => { try { localStorage.setItem(PERIOD_KEY, v); } catch { /* yopiq xotira */ } };

/** Daqiqa → «4 daq», «1 soat 20 daq», «2 kun» */
export function minutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 1) return '1 daq dan kam';
  if (m < 60) return `${Math.round(m)} daq`;
  if (m < 1440) { const h = Math.floor(m / 60), r = Math.round(m % 60); return r ? `${h} soat ${r} daq` : `${h} soat`; }
  return `${Math.round(m / 1440)} kun`;
}
const ago = (at: string) => {
  const m = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (m < 1) return 'hozir';
  if (m < 60) return `${m} daq oldin`;
  if (m < 1440) return `${Math.floor(m / 60)} soat oldin`;
  return new Date(at).toLocaleDateString('uz', { day: '2-digit', month: '2-digit' });
};
const versus = (key: PeriodKey) => ({ today: 'kechagiga nisbatan', yesterday: 'oldingi kunga nisbatan', week: 'oldingi 7 kunga nisbatan', month: 'oldingi 30 kunga nisbatan', custom: 'oldingi davrga nisbatan' }[key]);

// ─── Davr ────────────────────────────────────────────────────────────────────

function PeriodPicker({ value, range, onChange }: { value: PeriodKey; range: { from: string; to: string }; onChange: (k: PeriodKey, r?: { from: string; to: string }) => void }) {
  const [from, setFrom] = useState(range.from), [to, setTo] = useState(range.to);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Davr" className="flex rounded-xl bg-slate-200/70 p-1">
        {(['today', 'yesterday', 'week', 'month'] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${value === k ? 'bg-white text-slate-900 shadow-sheet' : 'text-slate-600 hover:text-slate-900'}`}>{PERIOD_LABEL[k]}</button>
        ))}
        <button type="button" role="tab" aria-selected={value === 'custom'} onClick={() => onChange('custom', { from, to })}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${value === 'custom' ? 'bg-white text-slate-900 shadow-sheet' : 'text-slate-600 hover:text-slate-900'}`}>Oraliq</button>
      </div>
      {value === 'custom' && (
        <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (from && to && from <= to) onChange('custom', { from, to }); }}>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="Boshlanishi" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
          <span className="text-slate-400">—</span>
          <input type="date" value={to} min={from} max={iso(new Date())} onChange={e => setTo(e.target.value)} aria-label="Oxiri" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
          <button type="submit" className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800">Ko'rsatish</button>
        </form>
      )}
    </div>
  );
}

// ─── Ko'rsatkich kartasi ─────────────────────────────────────────────────────

function Delta({ value, prev, good = 'up' }: { value: number; prev: number; good?: 'up' | 'down' }) {
  const pct = changePct(value, prev);
  if (pct === null) return <span className="text-xs font-semibold text-slate-500">{value ? 'yangi' : '—'}</span>;
  const up = pct > 0, fine = pct === 0 || (up ? good === 'up' : good === 'down');
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${pct === 0 ? 'bg-slate-100 text-slate-600' : fine ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {pct !== 0 && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}{Math.abs(pct)}%
    </span>
  );
}

function KpiCard({ icon: Icon, label, kpi, color, good, sub, href, compare, tone }: {
  icon: Icon; label: string; kpi: Kpi; color: string; good?: 'up' | 'down'; sub: ReactNode; href?: string; compare: string; tone?: 'alert';
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${color}14`, color }}><Icon className="h-4 w-4" aria-hidden="true" /></span>{label}
        </span>
        {tone === 'alert' && kpi.value > 0 && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-label="diqqat" />}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-slate-900">{kpi.value}</span>
        <Sparkline values={kpi.series} color={color} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta value={kpi.value} prev={kpi.prev} good={good} /><span className="text-xs text-slate-500">{compare} ({kpi.prev})</span>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">{sub}</div>
    </>
  );
  const cls = `block rounded-2xl border bg-white p-4 shadow-sheet transition ${tone === 'alert' && kpi.value > 0 ? 'border-rose-200' : 'border-slate-200'}`;
  return href ? <a href={href} className={`${cls} hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-indigo-500`}>{body}</a> : <div className={cls}>{body}</div>;
}

// ─── O'ng ustun: kanallar va jamoa ───────────────────────────────────────────

type Dot = 'ok' | 'warn' | 'off';
const DOT: Record<Dot, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', off: 'bg-slate-300' };

function Rail({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sheet">
      <header className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-900">{title}</h2>{action}</header>
      {children}
    </section>
  );
}

function ChannelRow({ icon: Icon, name, dot, state, count }: { icon: Icon; name: string; dot: Dot; state: string; count?: number }) {
  return (
    <li className={`flex items-center gap-3 rounded-xl border-l-[3px] bg-slate-50/70 px-3 py-2 ${dot === 'ok' ? 'border-l-emerald-500' : dot === 'warn' ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
      <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${DOT[dot]}`} />{state}</span>
      </span>
      {count !== undefined && <span className="text-sm font-bold tabular-nums text-slate-900" title="Shu davrdagi murojaatlar">{count}</span>}
    </li>
  );
}

function Channels({ status, phone, cameras, d, clinic }: { status: LiveStatus; phone: PhoneStatus | null; cameras: CameraRow[]; d: DashboardView; clinic: boolean }) {
  const ig = status.instagramApi.account ? { dot: (status.instagramApi.problem ? 'warn' : 'ok') as Dot, state: `${status.instagramApi.account} · rasmiy` }
    : status.instagram.account ? { dot: (status.instagram.problem ? 'warn' : 'ok') as Dot, state: `${status.instagram.account} · brauzer` } : { dot: 'off' as Dot, state: 'ulanmagan' };
  const live = cameras.filter(c => c.lastSeenAt && Date.now() - Date.parse(c.lastSeenAt) < 3 * 60_000).length;
  const k = d.kpi.inquiries;
  return (
    <Rail title="Kanallar" action={<a href="#/telegram" className="text-xs font-semibold text-indigo-700 hover:underline">Ulanishlar</a>}>
      <ul className="space-y-2">
        <ChannelRow icon={Instagram} name="Instagram Direct" dot={ig.dot} state={ig.state} count={k.instagram} />
        <ChannelRow icon={Send} name="Telegram" dot={status.bot ? (status.ownerLinked ? 'ok' : 'warn') : 'off'} state={status.bot ? `@${status.bot}${status.telegramUser.account || status.telegramBusiness.account ? ' + shaxsiy' : ''}` : 'bot ulanmagan'} count={k.telegram} />
        <ChannelRow icon={PhoneCall} name="Telefon" dot={phone?.mine ? (phone.noAccount ? 'warn' : 'ok') : 'off'} state={phone?.mine ? `MicroSIP${phone.recording ? ' · yozib olinadi' : ''}` : 'ulanmagan'} count={k.calls} />
        {(clinic || status.crm.account) && <ChannelRow icon={Stethoscope} name="DentaCRM" dot={status.crm.account ? (status.crm.problem ? 'warn' : 'ok') : 'off'} state={status.crm.problem ? 'muammo' : status.crm.account ? 'ulangan' : 'ulanmagan'} />}
        <ChannelRow icon={Camera} name="Kameralar" dot={!cameras.length ? 'off' : live === cameras.length ? 'ok' : 'warn'} state={cameras.length ? `${live}/${cameras.length} onlayn` : "qo'shilmagan"} />
        <ChannelRow icon={Sparkles} name="AI yordamchi" dot={status.ai ? 'ok' : 'warn'} state={status.ai ? (status.voice ? 'ishlayapti · ovoz bilan' : 'ishlayapti') : "kalit yo'q"} />
      </ul>
    </Rail>
  );
}

function Team({ d }: { d: DashboardView }) {
  return (
    <Rail title={`Jamoa · ${d.team.length}`} action={<a href="#/requests" className="text-xs font-semibold text-indigo-700 hover:underline">Xodim qo'shish</a>}>
      <ul className="space-y-2">
        {d.team.map(m => (
          <li key={m.id ?? 'owner'} className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{m.name.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{m.name} <span className="font-normal text-slate-500">· {m.role === 'owner' ? 'egasi' : 'qabulxona'}</span></span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${m.linked ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {m.linked ? (m.lastActiveAt ? `faol: ${ago(m.lastActiveAt)}` : 'Telegram ulangan') : 'Telegram ulanmagan'}
              </span>
            </span>
            <span className="text-right text-xs text-slate-500">
              <span className="block text-sm font-bold tabular-nums text-slate-900">{m.closed}</span>
              {m.closeMin !== null ? minutes(m.closeMin) : 'yopdi'}
            </span>
          </li>
        ))}
      </ul>
    </Rail>
  );
}

// ─── So'nggi murojaatlar ─────────────────────────────────────────────────────

const CHANNEL: Record<string, string> = { instagram: 'Instagram', telegram: 'Telegram', bot: 'Telegram bot', manual: "qo'lda", call: "qo'ng'iroq", voice: 'ovozli agent', owner: 'egasi', panel: 'panel' };
const STATE: Record<string, [string, string]> = {
  answered: ['javob berildi', 'bg-emerald-50 text-emerald-700'], waiting: ['javobsiz', 'bg-amber-50 text-amber-800'], open: ['ochiq', 'bg-amber-50 text-amber-800'],
  done: ['bajarildi', 'bg-emerald-50 text-emerald-700'], cancelled: ['bekor', 'bg-slate-100 text-slate-600'], ended: ['gaplashildi', 'bg-emerald-50 text-emerald-700'],
  missed: ["o'tkazib yuborildi", 'bg-rose-50 text-rose-700'], no_answer: ["ko'tarmadi", 'bg-slate-100 text-slate-600'], talking: ['suhbatda', 'bg-sky-50 text-sky-700'],
  ringing: ['jiringlayapti', 'bg-sky-50 text-sky-700'], dialing: ['terilmoqda', 'bg-sky-50 text-sky-700'],
};
function itemIcon(r: RecentItem): Icon {
  if (r.kind === 'request') return BellRing;
  if (r.kind === 'message') return r.channel === 'instagram' ? Instagram : MessageCircle;
  const [dir, st] = r.state.split(':');
  return st === 'missed' || st === 'no_answer' ? PhoneMissed : dir === 'out' ? PhoneOutgoing : PhoneIncoming;
}
const hrefOf = (r: RecentItem) => (r.kind === 'call' ? '#/calls' : r.kind === 'request' ? '#/requests' : '#/inbox');

function Recent({ items }: { items: RecentItem[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sheet">
      <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4"><h2 className="text-base font-bold text-slate-900">So'nggi murojaatlar</h2><a href="#/inbox" className="text-sm font-semibold text-indigo-700 hover:underline">Hammasi →</a></header>
      {!items.length ? <p className="px-5 pb-5 text-sm text-slate-500">Hali murojaat yo'q — mijozlar yozsa yoki qo'ng'iroq qilsa, shu yerda ko'rinadi.</p> : (
        <ul className="divide-y divide-slate-100">
          {items.map((r, i) => {
            const Icon = itemIcon(r);
            const st = STATE[r.kind === 'call' ? r.state.split(':').at(-1)! : r.state] ?? [r.state, 'bg-slate-100 text-slate-600'];
            return (
              <li key={`${r.kind}-${r.at}-${i}`}>
                <a href={hrefOf(r)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 sm:px-5">
                  <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{/^\+?\d[\d\s]{8,}$/.test(r.who) ? prettyPhone(r.who) : r.who}</span>
                      <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{CHANNEL[r.channel] ?? r.channel}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500"><span className="sm:hidden">{CHANNEL[r.channel] ?? r.channel}{r.text ? ' · ' : ''}</span>{r.text}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${st[1]}`}>{st[0]}</span>
                    <span className="text-right text-xs tabular-nums text-slate-400 sm:w-20">{ago(r.at)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * Boshqaruv paneli: davr bo'yicha ko'rsatkichlar (oldingi davrga nisbatan), dinamika grafigi, kanallar va jamoa holati,
 * so'nggi murojaatlar. Har 30 soniyada yangilanadi
 */
export function Dashboard({ status, clinic, notify }: { status: LiveStatus; clinic: boolean; notify: (t: string, e?: boolean) => void }) {
  const [period, setPeriod] = useState<PeriodKey>(readPeriod);
  const [range, setRange] = useState({ from: iso(new Date(Date.now() - 6 * 86_400_000)), to: iso(new Date()) });
  const [d, setD] = useState<DashboardView | null>(null);
  const [f, setF] = useState<FunnelView | null>(null);
  const [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  useEffect(() => {
    let gone = false;
    const load = () => api.dashboard(period, period === 'custom' ? range : undefined).then(r => { if (!gone) setD(r.dashboard); }).catch(e => { if (!gone) notify((e as Error).message, true); });
    // Voronka DentaCRM'dan kunma-kun yig'iladi — sekinroq, alohida va siyrakroq
    const loadFunnel = () => api.funnel(period, period === 'custom' ? range : undefined).then(r => { if (!gone) setF(r.funnel); }).catch(() => {});
    setF(null);
    void load();
    void loadFunnel();
    const t = setInterval(load, REFRESH_MS);
    const tf = setInterval(loadFunnel, REFRESH_MS * 4);
    return () => { gone = true; clearInterval(t); clearInterval(tf); };
  }, [period, range.from, range.to]);
  useEffect(() => {
    api.phone().then(r => setPhone(r.phone)).catch(() => {});
    api.cameras().then(r => setCameras(r.cameras)).catch(() => {});
  }, []);
  const change = (k: PeriodKey, r?: { from: string; to: string }) => { setPeriod(k); if (r) setRange(r); if (k !== 'custom') savePeriod(k); };
  const k = d?.kpi;
  const compare = versus(period);
  const dayLabel = (l: string) => (l.length === 10 ? `${l.slice(8)}.${l.slice(5, 7)}` : l);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">Murojaatlar sharhi</h2>
        <PeriodPicker value={period} range={range} onChange={change} />
      </div>
      {!d || !k ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" aria-label="Yuklanmoqda" /> : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              <KpiCard icon={Users} label="Murojaatlar" kpi={k.inquiries} color={COLORS.ink} compare={compare} href="#/inbox"
                sub={<>Instagram <b>{k.inquiries.instagram}</b> · Telegram <b>{k.inquiries.telegram}</b> · Qo'ng'iroq <b>{k.inquiries.calls}</b></>} />
              <KpiCard icon={MessageSquareReply} label="Javob berildi" kpi={k.answered} color={COLORS.callsIn} compare={compare}
                sub={<>O'rtacha birinchi javob: <b>{minutes(k.answered.responseMin)}</b>{k.answered.prevResponseMin !== null && <span className="text-slate-400"> (oldin {minutes(k.answered.prevResponseMin)})</span>}</>} />
              <KpiCard icon={CircleAlert} label="Javobsiz qoldi" kpi={k.unanswered} color="#e11d48" good="down" tone="alert" compare={compare} href="#/inbox"
                sub={<>Xabar <b>{k.unanswered.messages}</b> · O'tkazib yuborilgan qo'ng'iroq <b>{k.unanswered.missedCalls}</b></>} />
              <KpiCard icon={BellRing} label="So'rovlar" kpi={k.requests} color={COLORS.missed} compare={compare} href="#/requests"
                sub={<>Yopildi <b>{k.requests.closed}</b> · Hozir ochiq <b>{k.requests.open}</b> · O'rtacha hal qilish <b>{minutes(k.requests.closeMin)}</b></>} />
              <KpiCard icon={CalendarCheck} label={clinic ? 'Qabulga yozildi' : 'Kelishildi'} kpi={k.booked} color={COLORS.callsOut} compare={compare}
                sub={<>Yozishmada, ovozli agent va qo'ng'iroqlar tahlili bo'yicha</>} />
              <KpiCard icon={UserPlus} label="Yangi mijozlar" kpi={k.newLeads} color={COLORS.telegram} compare={compare} href="#/inbox"
                sub={<>Birinchi marta yozgan yoki qo'ng'iroq qilganlar</>} />
            </div>
            <Funnel f={f} clinic={clinic} />
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sheet">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">Murojaatlar dinamikasi</h2>
                <span className="text-xs text-slate-500">{d.period.bucket === 'hour' ? 'soat bo\'yicha' : 'kun bo\'yicha'} · {dayLabel(d.period.from)}{d.period.to !== d.period.from ? ` — ${dayLabel(d.period.to)}` : ''}</span>
              </header>
              <LineChart labels={d.period.labels} formatLabel={dayLabel} series={[
                { key: 'instagram', label: 'Instagram', color: COLORS.instagram, values: d.dynamics.instagram },
                { key: 'telegram', label: 'Telegram', color: COLORS.telegram, values: d.dynamics.telegram },
                { key: 'callsIn', label: "Kiruvchi qo'ng'iroq", color: COLORS.callsIn, values: d.dynamics.callsIn },
                { key: 'callsOut', label: "Chiquvchi qo'ng'iroq", color: COLORS.callsOut, values: d.dynamics.callsOut },
                { key: 'missed', label: "O'tkazib yuborilgan", color: COLORS.missed, values: d.dynamics.missed },
              ]} />
            </section>
            <Recent items={d.recent} />
          </div>
          <div className="space-y-5">
            <Channels status={status} phone={phone} cameras={cameras} d={d} clinic={clinic} />
            <Team d={d} />
          </div>
        </div>
      )}
    </div>
  );
}
