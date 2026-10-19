/**
 * Tahlilchi: davr (bugun / kecha / hafta / oy) bo'yicha raqamlar, kanallar grafigi, murojaatdan to'lovgacha voronka va jamoa —
 * hammasi bitta qorong'i sahifada. Ma'lumot — /api/dashboard va /api/dashboard/funnel (DentaCRM bilan — keldi va to'ladi ham).
 */
import { useEffect, useState } from 'react';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentAsk, HUE, Panel, Quiet, type Stat } from '../../components/agent';
import { PERIOD_LABEL, type DashboardView, type FunnelView, type PeriodKey } from '../../lib/dashboard';

export interface AnalystData { dashboard: DashboardView | null; funnel: FunnelView | null }
type Period = Exclude<PeriodKey, 'custom'>;

export function useAnalystData(period: Period, notify: Notify): AnalystData | null {
  const [data, setData] = useState<AnalystData | null>(null);
  useEffect(() => {
    let stale = false;
    setData(null);
    Promise.all([api.dashboard(period).then(r => r.dashboard).catch(() => null), api.funnel(period).then(r => r.funnel).catch(() => null)])
      .then(([dashboard, funnel]) => { if (!stale) setData({ dashboard, funnel }); })
      .catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

const delta = (v: number, prev: number) => (prev ? `${v >= prev ? '+' : ''}${Math.round(((v - prev) / prev) * 100)}% oldingi davrga` : v ? 'oldingi davrda yo‘q edi' : undefined);
const som = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '')} mln` : n.toLocaleString('uz-UZ'));

export function analystStats(d: DashboardView | null, f: FunnelView | null): Stat[] {
  if (!d) return [];
  const k = d.kpi;
  return [
    { label: 'Murojaat', value: k.inquiries.value, hint: delta(k.inquiries.value, k.inquiries.prev) },
    { label: 'Javob berildi', value: k.answered.value, hint: k.answered.responseMin != null ? `o'rtacha ${k.answered.responseMin} daq ichida` : delta(k.answered.value, k.answered.prev) },
    { label: 'Qabulga yozildi', value: k.booked.value, hint: delta(k.booked.value, k.booked.prev), tone: k.booked.value ? 'good' : undefined },
    f?.revenue ? { label: "Tushum, so'm", value: som(f.revenue.total), hint: 'murojaat qilganlardan' } : { label: 'Javobsiz qoldi', value: k.unanswered.value, tone: k.unanswered.value ? 'warn' : undefined, hint: `${k.unanswered.messages} xabar · ${k.unanswered.missedCalls} qo'ng'iroq` },
  ];
}

export function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div role="radiogroup" aria-label="Davr" className="inline-flex gap-1 rounded-full border border-glass/10 bg-glass/[0.03] p-1">
      {(Object.keys(PERIOD_LABEL) as Period[]).map(p => (
        <button key={p} type="button" role="radio" aria-checked={value === p} onClick={() => onChange(p)}
          className={`min-h-9 rounded-full px-4 text-sm font-medium transition-colors ${value === p ? 'bg-[#f2f0ea] text-[#07080b]' : 'text-[#a3a9b5] hover:text-[#f2f0ea]'}`}>{PERIOD_LABEL[p]}</button>
      ))}
    </div>
  );
}

const SERIES = [
  { key: 'instagram', label: 'Instagram', color: '#f472b6' },
  { key: 'telegram', label: 'Telegram', color: '#60a5fa' },
  { key: 'callsIn', label: "Qo'ng'iroq", color: HUE.tahlilchi.a },
] as const;

function Chart({ d }: { d: DashboardView }) {
  const totals = d.period.labels.map((_, i) => SERIES.reduce((n, s) => n + (d.dynamics[s.key][i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  if (!totals.some(Boolean)) return <Quiet>Bu davrda murojaat bo'lmadi.</Quiet>;
  const every = Math.ceil(d.period.labels.length / 12);
  return (
    <figure className="m-0">
      <div role="img" aria-label={`Murojaatlar: jami ${totals.reduce((a, b) => a + b, 0)}`} className="flex h-48 items-end gap-[3px]">
        {d.period.labels.map((label, i) => (
          <div key={label} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label}: ${totals[i]}`}>
            {SERIES.map(s => {
              const v = d.dynamics[s.key][i] ?? 0;
              return v ? <div key={s.key} style={{ height: `${(v / max) * 100}%`, background: s.color }} className="w-full first:rounded-t-[4px]" /> : null;
            })}
            {!totals[i] && <div className="h-[3px] w-full rounded-full bg-glass/[0.06]" />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px]" aria-hidden="true">
        {d.period.labels.map((label, i) => <span key={label} className="min-w-0 flex-1 truncate text-center tabular-nums text-[10px] text-[#6e7582]">{i % every ? '' : label}</span>)}
      </div>
      <figcaption className="mt-4 flex flex-wrap gap-4">
        {SERIES.map(s => <span key={s.key} className="flex items-center gap-2 text-[12px] text-[#a3a9b5]"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </figcaption>
    </figure>
  );
}

function Funnel({ f }: { f: FunnelView }) {
  const steps = [
    { label: 'Murojaat qildi', v: f.inquiries.total },
    { label: 'Javob oldi', v: f.answered.total },
    { label: 'Qabulga yozildi', v: f.booked.total },
    ...(f.came ? [{ label: 'Keldi', v: f.came.total }] : []),
    ...(f.paid ? [{ label: "To'ladi", v: f.paid.total }] : []),
  ];
  const top = Math.max(1, steps[0].v);
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-4">
          <span className="w-32 shrink-0 text-[14px] text-[#d9dbe1]">{s.label}</span>
          <span className="h-9 min-w-0 flex-1 overflow-hidden rounded-xl bg-glass/[0.04]">
            {s.v > 0 && <span className="block h-full rounded-xl" style={{ width: `${Math.max(6, (s.v / top) * 100)}%`, background: `linear-gradient(90deg, ${HUE.tahlilchi.a}, ${HUE.tahlilchi.b})`, opacity: 1 - i * 0.12 }} />}
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-[15px] font-semibold text-[#f2f0ea]">{s.v}{i > 0 && steps[0].v ? <span className="ml-1.5 text-[12px] font-normal text-[#7d838f]">{Math.round((s.v / steps[0].v) * 100)}%</span> : null}</span>
        </li>
      ))}
      {!f.crm && <li className="pt-1 text-[12px] text-[#7d838f]">DentaCRM ulansa — kim kelgani va qancha to'lagani ham (qaysi kanal pul olib kelayotgani).</li>}
    </ol>
  );
}

export function AnalystBody({ data }: { data: AnalystData | null }) {
  const d = data?.dashboard, f = data?.funnel;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Panel title="Murojaatlar">{d ? <Chart d={d} /> : <div className="h-48 animate-pulse rounded-xl bg-glass/[0.03]" />}</Panel>
        <Panel title="Voronka">{f ? <Funnel f={f} /> : <div className="h-40 animate-pulse rounded-xl bg-glass/[0.03]" />}</Panel>
      </div>
      <div className="flex flex-col gap-5">
        <Panel title="Jamoa">
          {d?.team.length ? (
            <ul className="flex flex-col gap-2">
              {d.team.map(t => (
                <li key={t.id ?? t.name} className="flex items-center gap-3 rounded-xl border border-glass/[0.06] bg-glass/[0.02] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-glass/[0.07] text-[12px] font-bold text-[#f2f0ea]">{t.name.slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-[#f2f0ea]">{t.name}</span>
                    <span className="block text-[12px] text-[#7d838f]">{t.role === 'owner' ? 'egasi' : 'qabulxona'}{t.closeMin != null ? ` · ${t.closeMin} daqiqada hal qiladi` : ''}</span>
                  </span>
                  <span className="text-right"><span className="block tabular-nums text-[18px] font-semibold text-[#f2f0ea]">{t.closed}</span><span className="block text-[11px] text-[#7d838f]">hal qildi</span></span>
                </li>
              ))}
            </ul>
          ) : <Quiet>Jamoa ma'lumoti yo'q.</Quiet>}
        </Panel>
        <AgentAsk member="tahlilchi" placeholder="So'rang: «Qaysi kanal ko'p mijoz olib keldi?»" />
      </div>
    </div>
  );
}
