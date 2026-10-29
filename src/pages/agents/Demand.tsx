/**
 * Tahlilchi → «Talab»: mijozlar nimani so'rayapti (mavzular, ulushi va mijozning o'z gapi), nimaga javob topilmadi (Miya'ga qo'shish),
 * nima to'xtatdi, qachon murojaat ko'p (soat va kun) va egasi shu hafta nima qilsin (bir bosishda topshiriq).
 * Tahlil bazada saqlanadi: sahifa ochilganda oxirgisi ko'rinadi (bepul), «Qayta tahlil» — model bilan yangisi (~1 daqiqa).
 */
import { useEffect, useState } from 'react';
import { CircleHelp, Lightbulb, Loader2, Plus, RefreshCw, ThumbsDown } from 'lucide-react';
import { api, type DemandGroup, type Insights } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';
import { addDays, iso } from '../../lib/week';
import { when } from '../../lib/text';

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Themes({ list, total }: { list: DemandGroup[]; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...list.map(t => t.count));
  return (
    <ul className="flex flex-col gap-2">
      {list.map(t => (
        <li key={t.name}>
          <button type="button" onClick={() => setOpen(o => (o === t.name ? null : t.name))} aria-expanded={open === t.name} className="w-full text-left">
            <span className="flex items-baseline gap-2 text-[14px]">
              <span className="min-w-0 flex-1 truncate text-[#f2f0ea]">{t.name}</span>
              <span className="tabular-nums text-[#f2f0ea]">{t.count}</span>
              <span className="w-10 text-right tabular-nums text-[12px] text-[#7d838f]">{pct(t.share)}</span>
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-glass/[0.05]"><span className="block h-full rounded-full bg-[#34d399]" style={{ width: `${(t.count / max) * 100}%` }} /></span>
          </button>
          {open === t.name && (
            <ul className="mt-2 flex flex-col gap-1.5 border-l border-glass/10 pl-3">
              {t.examples.map(e => <li key={e} className="text-[13px] italic leading-relaxed text-[#a3a9b5]">«{e}»</li>)}
            </ul>
          )}
        </li>
      ))}
      <li className="pt-1 text-[12px] text-[#7d838f]">Jami {total} ta murojaat · mavzuni bosing — mijozlarning o'z gapi</li>
    </ul>
  );
}

function Rows({ list, icon: Icon, tone, action }: { list: DemandGroup[]; icon: typeof CircleHelp; tone: string; action?: (g: DemandGroup) => React.ReactNode }) {
  return (
    <ul className="flex flex-col gap-2">
      {list.map(g => (
        <li key={g.name} className="flex items-start gap-3 rounded-xl border border-glass/[0.06] bg-glass/[0.02] px-3 py-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tone }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] text-[#f2f0ea]">{g.name}</span>
            {g.examples[0] && <span className="mt-0.5 block text-[12.5px] italic text-[#8a909c]">«{g.examples[0]}»</span>}
          </span>
          <span className="shrink-0 tabular-nums text-[13px] text-[#d9dbe1]">{g.count} kishi</span>
          {action?.(g)}
        </li>
      ))}
    </ul>
  );
}

function Peaks({ hours, days }: { hours: number[]; days: number[] }) {
  const hMax = Math.max(1, ...hours), dMax = Math.max(1, ...days);
  const top = hours.indexOf(Math.max(...hours));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Murojaatlar soat bo'yicha; eng ko'pi ${top}:00 da`}>
          {hours.map((n, h) => <span key={h} title={`${h}:00 — ${n}`} className={`flex-1 rounded-t ${h === top && n ? 'bg-[#34d399]' : 'bg-glass/15'}`} style={{ height: `${Math.max(3, (n / hMax) * 100)}%` }} />)}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[#7d838f]"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((n, d) => (
          <span key={d} className="flex flex-col items-center gap-1 text-[11px] text-[#8a909c]">
            <span className="w-full rounded-md py-1.5 text-center tabular-nums text-[12px] text-[#f2f0ea]" style={{ background: `rgba(52,211,153,${0.08 + (n / dMax) * 0.45})` }}>{n}</span>{DAYS[d]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DemandBody({ notify }: { notify: Notify }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Insights | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    setData(undefined);
    api.insights(days).then(r => { if (!stale) { setData(r.insights); setBusy(r.running); } }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy(true);
    try { setData((await api.runInsights(days)).insights); notify('Tahlil tayyor'); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const task = async (title: string, why: string) => {
    try { await api.addTask({ title: title.slice(0, 200), dueAt: `${iso(addDays(new Date(), 1))}T10:00`, notes: why }); notify('Topshiriq qo‘shildi — ertaga 10:00'); } catch (e) { notify((e as Error).message, true); }
  };

  const head = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Davr" className="flex rounded-xl border border-glass/10 p-0.5">
        {[7, 30].map(d => <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`h-9 rounded-lg px-3 text-[13px] ${days === d ? 'bg-glass/10 text-[#f2f0ea]' : 'text-[#8a909c]'}`}>{d === 7 ? 'So‘nggi 7 kun' : 'So‘nggi 30 kun'}</button>)}
      </div>
      <button type="button" onClick={() => { void run(); }} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-[#f2f0ea] px-4 text-[13px] font-semibold text-[#07080b] disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{busy ? 'Tahlil qilinyapti… (~1 daqiqa)' : data ? 'Qayta tahlil' : 'Tahlil qilish'}
      </button>
      {data && <span className="text-[12px] text-[#7d838f]">{data.from} — {data.to} · {when(data.createdAt)} da tahlil qilingan</span>}
    </div>
  );

  if (data === undefined) return <div className="flex flex-col gap-5">{head}<div className="h-40 animate-pulse rounded-[22px] bg-glass/[0.03]" /></div>;
  if (!data) return <div className="flex flex-col gap-5">{head}<Quiet>Tahlilchi mijozlarning yozishmalari, qo'ng'iroqlari va so'rovlarini o'qib chiqadi: ular nimani ko'p so'rayapti, qaysi savolga javob topilmadi, nimadan to'xtab qolishdi va siz shu hafta nima qilsangiz bo'ladi. «Tahlil qilish»ni bosing.</Quiet></div>;
  return (
    <div className="flex flex-col gap-5">
      {head}
      <section className="rounded-[22px] border border-[#34d399]/20 bg-[#34d399]/[0.05] p-5">
        <p className="text-[16px] leading-relaxed text-[#f2f0ea]">{data.headline}</p>
        <p className="mt-2 text-[12.5px] text-[#8a909c]">{data.totals.messages} yozishma · {data.totals.calls} qo‘ng‘iroq · {data.totals.requests} so‘rov</p>
      </section>
      {!!data.themes.length && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel className="min-w-0" title="Mijozlar nimani so'rayapti"><Themes list={data.themes} total={data.totals.items} /></Panel>
          <Panel className="min-w-0" title="Qachon murojaat ko'p"><Peaks hours={data.hours} days={data.days7} /></Panel>
        </div>
      )}
      {!!data.actions.length && (
        <Panel title="Shu hafta nima qilish kerak">
          <ol className="flex flex-col gap-2.5">
            {data.actions.map(a => (
              <li key={a.title} className="flex flex-col gap-2.5 rounded-xl border border-glass/[0.06] bg-glass/[0.02] px-3 py-3 sm:flex-row sm:items-start sm:gap-3">
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#f5b454]" aria-hidden="true" />
                  <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-[#f2f0ea]">{a.title}</span><span className="mt-0.5 block text-[13px] leading-relaxed text-[#a3a9b5]">{a.why}</span></span>
                </span>
                <button type="button" onClick={() => { void task(a.title, a.why); }} className="ml-7 flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl border border-glass/10 px-3 text-[12.5px] text-[#d9dbe1] hover:bg-glass/5 sm:ml-0"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Topshiriq</button>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {!!data.unanswered.length && (
          <Panel className="min-w-0" title="Javob topilmagan savollar" action={<a href={hrefOf('miya', 'savollar')} className="text-[12.5px] text-[#8b8cff] no-underline">Miya'ga javob qo'shish →</a>}>
            <Rows list={data.unanswered} icon={CircleHelp} tone="#f5b454" />
          </Panel>
        )}
        {!!data.objections.length && <Panel className="min-w-0" title="Nima to'xtatdi"><Rows list={data.objections} icon={ThumbsDown} tone="#fb7185" /></Panel>}
      </div>
    </div>
  );
}
