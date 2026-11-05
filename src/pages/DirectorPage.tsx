/**
 * Direktor sahifasi: bugungi tahlil (raqamlar, eng katta muammo), tasdiq kutayotgan takliflar («Topshirish» / «Kerak emas»)
 * va Qarorlar jurnali — nima topshirildi, qachon tekshiriladi, natija qanday bo'ldi. Hamma raqamni server hisoblaydi.
 */
import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Loader2, Minus, RefreshCw, X } from 'lucide-react';
import { api } from '../data/api';
import { iso } from '../lib/week';
import type { Notify } from '../components/Artifacts';
import { AgentHero, AgentTabs, Panel, Quiet } from '../components/agent';
import { GoalsPanel } from '../components/Goals';
import type { MemberState } from '../components/team';
import type { DirectorMoveView, DirectorNumber, DirectorView } from '../types';

const MEMBER_NAME: Record<DirectorMoveView['member'], string> = { qabulxona: 'Qabulxona', yordamchi: 'Yordamchi', tahlilchi: 'Tahlilchi', marketolog: 'Marketolog', kontent: 'Kontent-meyker', target: 'Targetolog', kuzatuvchi: 'Kuzatuvchi', egasi: 'Siz' };
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const day = (d: string | null) => (d ? `${Number(d.slice(8, 10))}-${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}` : '');
const num = (v: number, unit = '') => `${Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ')}${unit}`;
const metricLabel = (v: DirectorView | null, key: string) => v?.numbers.find(n => n.key === key)?.label ?? key;
const metricUnit = (v: DirectorView | null, key: string) => v?.numbers.find(n => n.key === key)?.unit ?? '';

interface Props { notify: Notify; state: MemberState | null; tab: string | null; tick: number; onChanged: () => void }

export function DirectorArea({ notify, state, tab, tick, onChanged }: Props) {
  const active = tab === 'jurnal' ? 'jurnal' : 'bugun';
  const [view, setView] = useState<DirectorView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => notify((e as Error).message, true);
  useEffect(() => { api.director().then(setView).catch(fail); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    setBusy('run');
    api.directorRun().then(v => { setView(v); onChanged(); notify(v.waiting.length ? `${v.waiting.length} ta taklif tayyor` : 'Tahlil tayyor'); }).catch(fail).finally(() => setBusy(null));
  };
  const decide = (id: string, decision: 'approve' | 'decline') => {
    setBusy(id);
    api.directorDecide(id, decision).then(r => { setView(r); onChanged(); notify(r.message); }).catch(fail).finally(() => setBusy(null));
  };

  const inWork = view?.journal.filter(m => m.status === 'topshirildi') ?? [];
  const checked = view?.journal.filter(m => m.status === 'tekshirildi') ?? [];
  const better = checked.filter(m => m.verdict === 'yaxshi').length;
  const stats = [
    { label: 'Taklif kutyapti', value: view?.waiting.length ?? '—', tone: view?.waiting.length ? 'warn' as const : undefined },
    { label: 'Qaror ishda', value: view ? inWork.length : '—' },
    { label: 'Tekshirildi', value: view ? checked.length : '—' },
    { label: 'Yaxshilandi', value: view ? better : '—', tone: better ? 'good' as const : undefined },
  ];

  return (
    <div className="space-y-6">
      <AgentHero member="direktor" state={state} stats={stats}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AgentTabs area="direktor" active={active} tabs={[{ id: 'bugun', label: 'Bugun', count: view?.waiting.length || undefined }, { id: 'jurnal', label: 'Qarorlar jurnali' }]} />
          <button type="button" onClick={run} disabled={busy === 'run'}
            className="flex min-h-10 items-center gap-2 rounded-full border border-glass/10 px-4 text-[13.5px] font-semibold text-[#e4e3de] hover:bg-glass/5 disabled:opacity-50">
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {busy === 'run' ? 'Tahlil qilyapman…' : 'Hozir tahlil qil'}
          </button>
        </div>
      </AgentHero>
      {!view ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#8a909c]" aria-label="Yuklanmoqda" />
        : active === 'bugun' ? <Today view={view} busy={busy} onDecide={decide} notify={notify} /> : <Journal view={view} />}
    </div>
  );
}

function Today({ view, busy, onDecide, notify }: { view: DirectorView; busy: string | null; onDecide: (id: string, d: 'approve' | 'decline') => void; notify: Notify }) {
  const { run } = view;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Panel title={run ? `Tahlil · ${day(run.day)}` : 'Tahlil'}>
          {!run ? <Quiet>Direktor har tong raqamlarni o'qiydi. Hozir ko'rmoqchi bo'lsangiz — «Hozir tahlil qil».</Quiet> : (
            <div className="space-y-3">
              {run.problem && (
                <div className="rounded-xl border border-[#e8c37a]/20 bg-[#e8c37a]/[0.06] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#e8c37a]">Eng katta muammo</p>
                  <p className="mt-1 text-[15.5px] font-semibold text-[#f2f0ea]">{run.problem}</p>
                  {run.evidence && <p className="mt-1 text-[13px] text-[#a3a9b5]">{run.evidence}</p>}
                </div>
              )}
              {run.summary && <p className="text-[14px] leading-relaxed text-[#c9ced8]">{run.summary}</p>}
            </div>
          )}
        </Panel>
        <Panel title={`Takliflar${view.waiting.length ? ` · ${view.waiting.length}` : ''}`}>
          {!view.waiting.length ? <Quiet>Hozir tasdiq kutayotgan taklif yo'q.</Quiet> : (
            <ul className="space-y-3">
              {view.waiting.map((m, i) => (
                <li key={m.id} className="rounded-xl border border-glass/[0.08] bg-glass/[0.02] p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#8a909c]">{i + 1} · {MEMBER_NAME[m.member]}</p>
                  <p className="mt-1 text-[15px] leading-snug text-[#f2f0ea]">{m.task}</p>
                  <p className="mt-1.5 text-[12.5px] text-[#8a909c]">
                    {m.why && <>{m.why} · </>}o'lchanadi: {metricLabel(view, m.metric).toLowerCase()} (hozir {num(m.baseline, metricUnit(view, m.metric))}), {m.checkDays} kundan keyin
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onDecide(m.id, 'approve')} disabled={!!busy}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg bg-[#ff9a3c] px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-50">
                      {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                      {m.member === 'egasi' ? "Vazifamga qo'sh" : 'Topshirish'}
                    </button>
                    <button type="button" onClick={() => onDecide(m.id, 'decline')} disabled={!!busy}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-glass/10 px-3.5 text-[13px] text-[#c9ced8] hover:bg-glass/5 disabled:opacity-50">
                      <X className="h-4 w-4" aria-hidden="true" />Kerak emas
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="space-y-5">
      <GoalsPanel notify={notify} numbers={view.numbers} />
      <Panel title="Raqamlar · oxirgi 7 kun">
        {!view.numbers.length ? <Quiet>Hali raqam yo'q.</Quiet> : (
          <ul className="divide-y divide-glass/[0.06]">
            {view.numbers.map(n => <NumberRow key={n.key} n={n} />)}
          </ul>
        )}
      </Panel>
      </div>
    </div>
  );
}

function NumberRow({ n }: { n: DirectorNumber }) {
  const same = Math.round(n.now) === Math.round(n.prev);
  const good = same ? null : n.good === 'up' ? n.now > n.prev : n.now < n.prev;
  const Icon = same ? Minus : n.now > n.prev ? ArrowUpRight : ArrowDownRight;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1 text-[13.5px] text-[#c9ced8]">{n.label}</span>
      <span className="text-[12px] tabular-nums text-[#6c727e]">oldin {num(n.prev, n.unit)}</span>
      <span className="w-20 text-right text-[15px] font-semibold tabular-nums text-[#f2f0ea]">{num(n.now, n.unit)}</span>
      <Icon aria-label={same ? "o'zgarmadi" : good ? 'yaxshilandi' : 'yomonlashdi'} className={`h-4 w-4 shrink-0 ${same ? 'text-[#6c727e]' : good ? 'text-emerald-400' : 'text-rose-400'}`} />
    </li>
  );
}

const STATUS: Record<Exclude<DirectorMoveView['status'], 'taklif'>, { label: string; cls: string }> = {
  topshirildi: { label: 'ishda', cls: 'bg-sky-400/[0.12] text-sky-300' },
  tekshirildi: { label: 'tekshirildi', cls: 'bg-glass/[0.07] text-[#c9ced8]' },
  rad: { label: 'kerak emas', cls: 'bg-glass/[0.05] text-[#8a909c]' },
};
const VERDICT: Record<NonNullable<DirectorMoveView['verdict']>, { label: string; cls: string }> = {
  yaxshi: { label: 'yaxshilandi', cls: 'text-emerald-400' },
  yomon: { label: 'yomonlashdi', cls: 'text-rose-400' },
  ozgarmadi: { label: "o'zgarmadi", cls: 'text-[#a3a9b5]' },
};

function Journal({ view }: { view: DirectorView }) {
  if (!view.journal.length) return <Panel title="Qarorlar jurnali"><Quiet>Hali qaror yo'q. Direktor taklifini «Topshirish» bilan tasdiqlasangiz — shu yerda paydo bo'ladi va muddati kelganda natijasi yoziladi.</Quiet></Panel>;
  return (
    <Panel title="Qarorlar jurnali">
      <ul className="divide-y divide-glass/[0.06]">
        {view.journal.map(m => {
          const st = STATUS[m.status as keyof typeof STATUS];
          const unit = metricUnit(view, m.metric);
          return (
            <li key={m.id} className={`py-3.5 ${m.status === 'rad' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8a909c]">
                <span>{day(iso(new Date(m.createdAt)))}</span>
                <span>·</span>
                <span className="font-semibold text-[#c9ced8]">{MEMBER_NAME[m.member]}</span>
                {st && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>}
              </div>
              <p className="mt-1 text-[14.5px] leading-snug text-[#e4e3de]">{m.task}</p>
              <p className="mt-1 text-[12.5px] text-[#8a909c]">
                {metricLabel(view, m.metric)}: {num(m.baseline, unit)}
                {m.status === 'topshirildi' && m.checkAt && <> · tekshiriladi {day(m.checkAt)}</>}
                {m.status === 'tekshirildi' && m.after !== null && m.verdict && (
                  <> → {num(m.after, unit)} <span className={`font-semibold ${VERDICT[m.verdict].cls}`}>{VERDICT[m.verdict].label}</span></>
                )}
                {m.why && <> · {m.why}</>}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
