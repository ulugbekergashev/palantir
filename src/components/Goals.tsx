/**
 * Maqsadlar: Direktor ko'rsatkichlariga egasi qo'ygan maqsad va bajarilishi (server/director/goals.ts — foizni server hisoblaydi).
 * GoalsPanel — Direktor sahifasida (qo'yish va o'chirish), GoalsStrip — bosh ekranda ixcham chiziq (maqsad bo'lmasa — ko'rinmaydi).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Flag, Loader2, Plus, Target, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { hrefOf } from '../lib/nav';
import type { DirectorNumber, GoalView } from '../types';
import type { Notify } from './Artifacts';
import { Panel, Quiet } from './agent';

const num = (v: number, unit = '') => `${Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ')}${unit}`;

function Bar({ g }: { g: GoalView }) {
  const pct = g.pct ?? 0;
  const tone = g.reached ? 'bg-emerald-400' : pct >= 70 ? 'bg-[#e8c37a]' : 'bg-[#ff9a3c]';
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-glass/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct ?? undefined} aria-label={`${g.label}: ${g.pct ?? 0}%`}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${Math.max(pct, g.pct === null ? 0 : 3)}%` }} />
    </div>
  );
}

function GoalLine({ g, onRemove }: { g: GoalView; onRemove?: () => void }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#d9dbe1]">{g.label}{g.good === 'down' && <span className="text-[#6c727e]"> · kamaysa yaxshi</span>}</span>
        <span className="text-[13px] tabular-nums text-[#f2f0ea]">{g.now === null ? "ma'lumot yo'q" : num(g.now, g.unit)}<span className="text-[#6c727e]"> / {num(g.target, g.unit)}</span></span>
        <span className={`w-11 text-right text-[12.5px] font-semibold tabular-nums ${g.reached ? 'text-emerald-400' : 'text-[#a3a9b5]'}`}>{g.pct === null ? '—' : g.reached ? '✓' : `${g.pct}%`}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={`${g.label} maqsadini o'chirish`} title="O'chirish"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#6c727e] hover:bg-glass/[0.06] hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
        )}
      </div>
      <div className="mt-2"><Bar g={g} /></div>
    </li>
  );
}

/** Direktor sahifasi: maqsadlar ro'yxati va yangi maqsad (faqat o'lchanadigan ko'rsatkichlar — numbers'da borlari) */
export function GoalsPanel({ notify, numbers, tick = 0 }: { notify: Notify; numbers: DirectorNumber[]; tick?: number }) {
  const [list, setList] = useState<GoalView[] | null>(null);
  const [metric, setMetric] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  useEffect(() => { api.goals().then(r => setList(r.goals)).catch(fail); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = numbers.filter(n => !list?.some(g => g.metric === n.key));
  const chosen = numbers.find(n => n.key === (metric || free[0]?.key));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(target.replace(/\s/g, '').replace(',', '.'));
    if (!chosen || !target.trim() || !Number.isFinite(value)) return;
    setBusy(true);
    api.setGoal(chosen.key, value).then(r => { setList(r.goals); setTarget(''); setMetric(''); notify('Maqsad qo\'yildi — Direktor shunga qarab tahlil qiladi'); }).catch(fail).finally(() => setBusy(false));
  };
  const remove = (g: GoalView) => api.deleteGoal(g.id).then(() => setList(l => l?.filter(x => x.id !== g.id) ?? null)).catch(fail);
  return (
    <Panel title="Maqsadlar">
      {!list ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#8a909c]" aria-label="Yuklanmoqda" /> : (
        <>
          {list.length ? <ul className="-mt-2 divide-y divide-glass/[0.06]">{list.map(g => <GoalLine key={g.id} g={g} onRemove={() => { void remove(g); }} />)}</ul>
            : <Quiet>Maqsad qo'ying — Direktor eng katta muammoni maqsaddan eng ko'p ortda qolgan joydan qidiradi.</Quiet>}
          {chosen && (
            <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2 border-t border-glass/[0.06] pt-4">
              <label htmlFor="goal-metric" className="sr-only">Ko'rsatkich</label>
              <select id="goal-metric" value={chosen.key} onChange={e => setMetric(e.target.value)}
                className="h-9 w-full min-w-0 basis-full rounded-lg border border-glass/[0.08] bg-[#07080b] px-2 text-[13px] text-[#f2f0ea] outline-none focus:border-[#ff9a3c]/50">
                {free.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
              </select>
              <label htmlFor="goal-target" className="sr-only">Maqsad</label>
              <input id="goal-target" inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder={`Maqsad${chosen.unit ? `, ${chosen.unit.trim()}` : ''} (hozir ${num(chosen.now, chosen.unit)})`}
                className="h-9 min-w-0 flex-1 rounded-lg border border-glass/[0.08] bg-[#07080b] px-3 text-[13px] text-[#f2f0ea] outline-none placeholder:text-[#6c727e] focus:border-[#ff9a3c]/50" />
              <button type="submit" disabled={busy || !target.trim()} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#ff9a3c] px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Qo'yish
              </button>
              <p className="basis-full text-[12px] text-[#6c727e]">{chosen.good === 'down' ? 'Bu ko\'rsatkich kamaysa yaxshi — maqsad yuqori chegara.' : 'Soni — 7 kunlik (haftalik).'}</p>
            </form>
          )}
        </>
      )}
    </Panel>
  );
}

/** Bosh ekran: maqsadlar bitta qatorda (maqsad yo'q yoki ochiq emas — hech narsa ko'rsatilmaydi) */
export function GoalsStrip({ tick = 0 }: { tick?: number }) {
  const [list, setList] = useState<GoalView[]>([]);
  useEffect(() => { api.goals().then(r => setList(r.goals)).catch(() => setList([])); }, [tick]);
  if (!list.length) return null;
  const reached = list.filter(g => g.reached).length;
  return (
    <section aria-label="Maqsadlar" className="rounded-2xl border border-glass/[0.08] bg-glass/[0.03] px-5 py-4 text-left">
      <div className="mb-1 flex items-center gap-2">
        <Flag className="h-4 w-4 text-[#e8c37a]" aria-hidden="true" />
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a3a9b5]">Maqsadlar · {reached}/{list.length}</h2>
        <a href={hrefOf('direktor')} className="ml-auto flex items-center gap-1 text-[12.5px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]"><Target className="h-3.5 w-3.5" aria-hidden="true" />Direktor</a>
      </div>
      <ul className="grid gap-x-8 sm:grid-cols-2">{list.map(g => <GoalLine key={g.id} g={g} />)}</ul>
    </section>
  );
}
