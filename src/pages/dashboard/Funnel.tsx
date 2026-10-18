import type { FunnelStep, FunnelView } from '../../lib/dashboard';

const CH = [
  { key: 'instagram', label: 'Instagram', color: '#d6336c' },
  { key: 'telegram', label: 'Telegram', color: '#229ed9' },
  { key: 'call', label: "Qo'ng'iroq", color: '#0e9f6e' },
] as const;
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function Row({ label, step, top, prev }: { label: string; step: FunnelStep; top: number; prev: number | null }) {
  const w = top ? Math.max(4, (step.total / top) * 100) : 0;
  return (
    <li className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_5.5rem]">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="relative h-8 overflow-hidden rounded-lg bg-slate-100" title={CH.map(c => `${c.label}: ${step.byChannel[c.key]}`).join(' · ')}>
        <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-lg" style={{ width: `${w}%` }}>
          {CH.map(c => step.byChannel[c.key] > 0 && <span key={c.key} style={{ background: c.color, flexGrow: step.byChannel[c.key] }} />)}
        </span>
        <span className="absolute inset-y-0 left-2 flex items-center text-sm font-extrabold tabular-nums text-white mix-blend-normal drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]">{step.total}</span>
      </span>
      <span className="text-right text-xs tabular-nums text-slate-500" title="Oldingi bosqichdagilardan">{prev === null ? '' : <>→ <b className="text-slate-800">{pct(step.total, prev)}</b></>}</span>
    </li>
  );
}

/**
 * Voronka: murojaat → javob → qabul → keldi → to'ladi, kanallar bo'yicha rangda. DentaCRM bo'lsa — kim kelgani va qancha to'lagani,
 * ya'ni qaysi kanal pul olib kelayotgani
 */
export function Funnel({ f, clinic }: { f: FunnelView | null; clinic: boolean }) {
  if (!f) return <section className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sheet" aria-label="Voronka yuklanmoqda" />;
  const top = f.inquiries.total;
  const rows: [string, FunnelStep | null][] = [
    ['Murojaat qildi', f.inquiries], ['Javob oldi', f.answered], [clinic ? 'Qabulga yozildi' : 'Kelishildi', f.booked], ['Keldi', f.came], ["To'ladi", f.paid],
  ];
  const shown = rows.filter((r): r is [string, FunnelStep] => !!r[1]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sheet">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">Voronka{f.revenue ? ' va tushum' : ''}</h2>
        <ul className="flex flex-wrap gap-3">{CH.map(c => <li key={c.key} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}</li>)}</ul>
      </header>
      {!top ? <p className="text-sm text-slate-500">Bu davrda murojaat bo'lmadi.</p> : (
        <ol className="space-y-2.5">
          {shown.map(([label, step], i) => <Row key={label} label={label} step={step} top={top} prev={i ? shown[i - 1][1].total : null} />)}
        </ol>
      )}
      {f.revenue && (
        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div><p className="text-xs font-semibold text-slate-500">Tushum (shu murojaatlardan)</p><p className="text-2xl font-extrabold tabular-nums text-slate-900">{money(f.revenue.total)}</p></div>
          {CH.map(c => (
            <div key={c.key}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{money(f.revenue!.byChannel[c.key])}</p>
            </div>
          ))}
        </div>
      )}
      {f.crm && f.problem && <p className="mt-3 text-sm text-amber-700">DentaCRM javob bermadi — «keldi» va «to'ladi» hozircha yo'q: {f.problem}</p>}
      {!f.crm && clinic && <p className="mt-3 text-xs text-slate-500">DentaCRM ulansa — kim kelgani va qancha to'lagani ham ko'rinadi (qaysi kanal pul olib kelayotgani).</p>}
      {f.crm && !f.problem && top > 0 && <p className="mt-3 text-xs text-slate-500">Murojaat qilgan {top} kishidan {f.linked} tasi DentaCRM bemoriga bog'langan (telefon va ism bo'yicha).</p>}
    </section>
  );
}
