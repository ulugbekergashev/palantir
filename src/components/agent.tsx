/**
 * AI xodim sahifalarining umumiy qismlari — bosh ekran (sfera) bilan bir uslubda: har xodimning o'z rangidagi sferasi,
 * katta sarlavha va bugungi raqamlar, «xodimdan so'rang» qatori (javob Palantir yordamchisidan), bo'lim kartasi, varaqlar.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { api } from '../data/api';
import { hrefOf, type Area } from '../lib/nav';
import { Markdown } from './Markdown';
import { TEAM, type Member, type MemberState } from './team';

/** Har xodimning rangi: sfera, nur va urg'u */
export const HUE: Record<Member, { a: string; b: string; glow: string; text: string }> = {
  qabulxona: { a: '#3fd6c3', b: '#6f73ff', glow: 'rgba(63,214,195,0.16)', text: '#8ff0e2' },
  yordamchi: { a: '#8b8cff', b: '#b38cff', glow: 'rgba(139,140,255,0.18)', text: '#c7c8ff' },
  kuzatuvchi: { a: '#f5b454', b: '#ff7a59', glow: 'rgba(245,180,84,0.15)', text: '#fbd38d' },
  tahlilchi: { a: '#34d399', b: '#3fb6ff', glow: 'rgba(52,211,153,0.15)', text: '#86efc4' },
};

export function AgentOrb({ member, size = 84, live = false }: { member: Member; size?: number; live?: boolean }) {
  const h = HUE[member];
  return (
    <span aria-hidden="true" className="relative inline-block shrink-0 rounded-full" style={{ width: size, height: size }}>
      <span className={`absolute inset-0 rounded-full opacity-70 blur-xl ${live ? 'animate-[spin_10s_linear_infinite]' : 'animate-[spin_24s_linear_infinite]'} motion-reduce:animate-none`}
        style={{ background: `conic-gradient(from 0deg, ${h.a}, ${h.b}, ${h.a})` }} />
      <span className="absolute inset-[6%] rounded-full" style={{ background: `radial-gradient(circle at 30% 28%, #ffffffcc, ${h.a} 38%, ${h.b} 72%, #15123a 100%)` }} />
      <span className="absolute inset-[6%] rounded-full ring-1 ring-glass/20" />
    </span>
  );
}

export interface Stat { label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'good' }

/** Xodim sarlavhasi: sfera, ismi, nima qiladi, jonli holati va bugungi raqamlar; ostida — varaqlar */
export function AgentHero({ member, state, stats, children, compact = false }: { member: Member; state: MemberState | null; stats: Stat[]; children?: ReactNode; /** Ixcham: ism va varaqlar bir qatorda (suhbat kabi ekranni to'ldiradigan varaq) */ compact?: boolean }) {
  const m = TEAM[member], h = HUE[member];
  if (compact) {
    return (
      <header className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[22px] border border-glass/[0.07] bg-[#0a0b0f] px-5 py-3.5">
        <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-24 h-60 w-60 rounded-full" style={{ background: `radial-gradient(closest-side, ${h.glow}, transparent)` }} />
        <AgentOrb member={member} size={40} live={state?.live} />
        <div className="relative mr-auto min-w-0">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-[#f2f0ea]">{m.name}</h1>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: h.text }}>{m.role}</p>
        </div>
        {children && <div className="relative">{children}</div>}
      </header>
    );
  }
  return (
    <header className="relative overflow-hidden rounded-[28px] border border-glass/[0.07] bg-[#0a0b0f] p-6 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-32 h-[420px] w-[420px] rounded-full" style={{ background: `radial-gradient(closest-side, ${h.glow}, transparent)` }} />
      <div className="relative flex flex-wrap items-center gap-6">
        <AgentOrb member={member} live={state?.live} />
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: h.text }}>{m.role}</p>
          <h1 className="mt-1 text-[38px] font-bold leading-[1.05] tracking-[-0.02em] text-[#f2f0ea]">{m.name}</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#a3a9b5]">{m.about}</p>
        </div>
        {state && (
          <span className="flex items-center gap-2 rounded-full border border-glass/10 bg-glass/[0.04] px-4 py-2 text-sm font-medium text-[#f2f0ea]">
            <span className={`h-2 w-2 rounded-full ${state.live ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]' : 'bg-glass/30'}`} aria-hidden="true" />{state.status}
          </span>
        )}
      </div>
      {stats.length > 0 && (
        <dl className="relative mt-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          {stats.map(s => (
            <div key={s.label} className="flex flex-col gap-1 border-l border-glass/10 pl-4">
              <dt className="order-2 text-[13px] text-[#a3a9b5]">{s.label}</dt>
              <dd className={`order-1 m-0 tabular-nums text-[34px] font-semibold leading-none tracking-tight ${s.tone === 'warn' ? 'text-[#f5b454]' : s.tone === 'good' ? 'text-emerald-300' : 'text-[#f2f0ea]'}`}>{s.value}</dd>
              {s.hint && <dd className="order-3 m-0 text-[12px] text-[#7d838f]">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
      {children && <div className="relative mt-7">{children}</div>}
    </header>
  );
}

export function AgentTabs({ area, tabs, active }: { area: Area; tabs: { id: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Varaqlar" className="flex flex-wrap gap-1.5">
      {tabs.map(t => (
        <a key={t.id} href={hrefOf(area, t.id)} aria-current={t.id === active ? 'page' : undefined}
          className={`flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium no-underline transition-colors ${t.id === active ? 'bg-[#f2f0ea] text-[#07080b]' : 'text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]'}`}>
          {t.label}{!!t.count && <span className={`rounded-full px-1.5 text-[11px] font-bold ${t.id === active ? 'bg-[#07080b]/10' : 'bg-[#f5b454] text-[#07080b]'}`}>{t.count}</span>}
        </a>
      ))}
    </nav>
  );
}

/** Bo'lim kartasi */
export function Panel({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5 ${className}`}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

/** Bo'sh holat: nima bo'lishi kerakligi, sokin */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-glass/10 px-4 py-6 text-center text-[14px] leading-relaxed text-[#8a909c]">{children}</p>;
}

/** «Xodimdan so'rang»: savol Palantir yordamchisiga, shu xodim haqida ekani aytiladi; javob shu yerda */
export function AgentAsk({ member, placeholder, chips = [] }: { member: Member; placeholder: string; /** Tez buyruqlar: bosilsa — darhol yuboriladi */ chips?: string[] }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); void run(q); };
  const run = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setAnswer(null);
    try {
      const r = await api.say(`(${TEAM[member].name} haqida) ${text}`);
      setAnswer([...r.entries].reverse().find(x => x.role === 'assistant')?.text ?? '');
      setQ('');
    } catch (err) {
      setAnswer((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 pl-4 focus-within:border-glass/25">
        <label htmlFor={`ask-${member}`} className="sr-only">{TEAM[member].name}dan so'rang</label>
        <input id={`ask-${member}`} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
        <button type="submit" disabled={!q.trim() || busy} aria-label="So'rash" className="flex h-11 w-11 items-center justify-center rounded-xl text-[#07080b] transition-opacity disabled:opacity-40" style={{ background: HUE[member].a }}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-5 w-5" aria-hidden="true" />}
        </button>
      </form>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map(c => <button key={c} type="button" disabled={busy} onClick={() => { void run(c); }} className="min-h-9 rounded-full border border-glass/10 px-3.5 text-[13px] text-[#c9cbd2] transition-colors hover:bg-glass/5 disabled:opacity-50">{c}</button>)}
        </div>
      )}
      {busy && <p className="flex items-center gap-2 text-[13px] text-[#a3a9b5]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{TEAM[member].name} bajaryapti…</p>}
      {answer !== null && (
        <div className="animate-rise rounded-2xl border border-glass/[0.08] bg-glass/[0.03] px-5 py-4">
          <Markdown text={answer} className="text-[15px] leading-relaxed text-[#e4e3de]" />
        </div>
      )}
    </div>
  );
}

export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
export const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? 'hozir' : min < 60 ? `${min} daq oldin` : min < 1440 ? `${Math.round(min / 60)} soat oldin` : `${Math.round(min / 1440)} kun oldin`;
};
