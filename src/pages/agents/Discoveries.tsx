/**
 * Tahlilchi → «Kashfiyotlar»: chuqur tahlil — model hamma ma'lumotni (DentaCRM qabullari va to'lovlari, kamera, qo'ng'iroq, yozishma)
 * Python'da o'zi kesib-kesib ko'radi va faqat raqam bilan isbotlangan topilmalarni beradi: nima, qancha, qanday hisoblangan, nima qilish
 * kerak, grafik. Fonda bir necha daqiqa ishlaydi — sahifa holatni o'zi so'rab turadi; oxirgi natija saqlanadi (ochilganda pul ketmaydi).
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Database, FlaskConical, Info, Lightbulb, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { api, type DeepFinding, type DeepInsights } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Panel, Quiet } from '../../components/agent';
import { addDays, iso } from '../../lib/week';

const POLL_MS = 10_000;
const IMPACT: Record<DeepFinding['impact'], { text: string; cls: string }> = {
  high: { text: 'Muhim', cls: 'bg-rose-400/15 text-rose-300' },
  medium: { text: "O'rta", cls: 'bg-[#f5b454]/15 text-[#fbd38d]' },
  low: { text: 'Kichik', cls: 'bg-glass/10 text-[#a3a9b5]' },
};
const when = (s: string) => new Date(s).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Chart({ run, file, alt }: { run: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url = '', gone = false;
    api.deepChart(run, file).then(b => { if (!gone && b.size) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [run, file]);
  return src ? <img src={src} alt={alt} className="w-full rounded-xl border border-glass/[0.08] bg-white" /> : <div className="h-40 animate-pulse rounded-xl bg-glass/[0.04]" />;
}

function Finding({ f, run, onTask }: { f: DeepFinding; run: string; onTask: (f: DeepFinding) => void }) {
  const [open, setOpen] = useState(false);
  const imp = IMPACT[f.impact];
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${imp.cls}`}>{imp.text}</span>
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-[#f2f0ea]">{f.title}</h3>
        {f.metric && <span className="text-[20px] font-bold tabular-nums tracking-tight text-[#86efc4]">{f.metric}</span>}
      </div>
      <p className="text-[13.5px] leading-relaxed text-[#c9ccd4]">{f.detail}</p>
      {f.chart && <Chart run={run} file={f.chart} alt={f.title} />}
      <div className="flex flex-col gap-2 rounded-xl bg-[#f5b454]/[0.06] px-3 py-2.5 sm:flex-row sm:items-start">
        <span className="flex min-w-0 flex-1 items-start gap-2 text-[13.5px] leading-relaxed text-[#f2f0ea]"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#f5b454]" aria-hidden="true" />{f.action}</span>
        <button type="button" onClick={() => onTask(f)} className="flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-glass/10 px-2.5 text-[12px] text-[#d9dbe1] hover:bg-glass/5"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Topshiriq</button>
      </div>
      {f.evidence && (
        <div>
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1 text-[12.5px] text-[#8a909c] hover:text-[#d9dbe1]">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />Qanday hisoblandi
          </button>
          {open && <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8a909c]">{f.evidence}</p>}
        </div>
      )}
    </li>
  );
}

export function DiscoveriesBody({ notify }: { notify: Notify }) {
  const [data, setData] = useState<DeepInsights | null | undefined>(undefined);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stale = false;
    const load = () => api.deepInsights().then(r => { if (!stale) { setData(r.result); setRunning(r.running); setError(r.error); setNotice(r.notice); } }).catch(e => notify((e as Error).message, true));
    void load();
    const t = setInterval(() => { setNow(Date.now()); if (running) void load(); }, POLL_MS);
    return () => { stale = true; clearInterval(t); };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async (force = false) => {
    try { setRunning((await api.runDeepInsights(force)).running); setError(null); setNotice(null); } catch (e) { notify((e as Error).message, true); }
  };
  const task = async (f: DeepFinding) => {
    try { await api.addTask({ title: f.action.slice(0, 200) || f.title, dueAt: `${iso(addDays(new Date(), 1))}T10:00`, notes: `${f.title}: ${f.detail}`.slice(0, 1000) }); notify('Topshiriq qo‘shildi — ertaga 10:00'); } catch (e) { notify((e as Error).message, true); }
  };
  const elapsed = running ? Math.max(0, Math.round((now - Date.parse(running)) / 60_000)) : 0;

  const head = (
    <section className="flex flex-col gap-3 rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5 sm:flex-row sm:items-center">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#34d399]/12 text-[#86efc4]"><FlaskConical className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-semibold text-[#f2f0ea]">Chuqur tahlil</h2>
        <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">Tahlilchi hamma ma'lumotni — qabullar, to'lovlar, kamera, qo'ng'iroqlar, yozishmalar — o'zi kesib-kesib ko'radi: kim, qachon keladi va ketadi, o'rtacha vaqt va summa, qaysi guruhda nima farq qiladi, qayerda g'ayrioddiy narsa bor. Har topilma raqam bilan isbotlanadi. 3–8 daqiqa; har tahlilning narxi natija ostida yoziladi. Ma'lumot deyarli o'zgarmagan bo'lsa, qayta tahlil qilinmaydi — pul ketmaydi.</p>
      </div>
      <button type="button" onClick={() => { void start(); }} disabled={!!running} className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#f2f0ea] px-5 text-[13.5px] font-semibold text-[#07080b] disabled:opacity-50">
        {running ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Tahlil qilinyapti… {elapsed} daq</> : data ? 'Qayta tahlil qilish' : 'Chuqur tahlil qilish'}
      </button>
    </section>
  );

  if (data === undefined) return <div className="flex flex-col gap-5">{head}<div className="h-40 animate-pulse rounded-[22px] bg-glass/[0.03]" /></div>;
  return (
    <div className="flex flex-col gap-5">
      {head}
      {error && !running && <p className="flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-[13.5px] text-rose-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}
      {notice && !running && (
        <div className="flex flex-col gap-3 rounded-2xl border border-glass/[0.08] bg-glass/[0.03] px-4 py-3 sm:flex-row sm:items-center">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-[13.5px] leading-snug text-[#c9ccd4]"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#86efc4]" aria-hidden="true" />{notice}</p>
          <button type="button" onClick={() => { void start(true); }} className="h-9 shrink-0 rounded-lg border border-glass/[0.12] px-3 text-[12.5px] font-medium text-[#c9ccd4] hover:bg-glass/[0.06]">Baribir qayta tahlil qilish</button>
        </div>
      )}
      {!data ? <Quiet>Hali chuqur tahlil qilinmagan. «Chuqur tahlil qilish»ni bosing — natija shu yerda saqlanadi.</Quiet> : (
        <>
          <section className="rounded-[22px] border border-[#34d399]/20 bg-[#34d399]/[0.05] p-5">
            <p className="text-[16px] leading-relaxed text-[#f2f0ea]">{data.headline}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#8a909c]">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />{data.from} — {data.to}
              {data.data.map(d => <span key={d.name}>{d.name.replace('.csv', '')}: {d.rows}</span>)}
              <span>· {when(data.createdAt)} da</span>
              {data.cost !== undefined && <span>· narxi ≈ ${data.cost.toFixed(2)}</span>}
            </p>
            {data.notes.length > 0 && <p className="mt-1 text-[12px] text-[#7d838f]">{data.notes.join(' · ')}</p>}
          </section>
          <ol className="flex flex-col gap-3">{data.findings.map((f, i) => <Finding key={`${i}${f.title}`} f={f} run={data.id} onTask={f2 => { void task(f2); }} />)}</ol>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {data.quality.length > 0 && <Panel className="min-w-0" title="Ma'lumot sifati"><ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-[#c9ccd4]">{data.quality.map(q => <li key={q}>• {q}</li>)}</ul></Panel>}
            {data.next.length > 0 && <Panel className="min-w-0" title="Keyin tekshirish kerak"><ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-[#c9ccd4]">{data.next.map(q => <li key={q}>• {q}</li>)}</ul></Panel>}
          </div>
        </>
      )}
    </div>
  );
}
