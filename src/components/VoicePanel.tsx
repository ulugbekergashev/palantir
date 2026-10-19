/**
 * Ixcham ovoz paneli (xodim sahifasida): xodim rangidagi sfera — bosing va gapiring; jonli matn va natija kartalari.
 * kind: owner — egasining yordamchisi; customer — qabulxonani mijoz bo'lib sinash (jadvalga yozilmaydi, so'rov ochilmaydi).
 */
import { Mic, Square } from 'lucide-react';
import { Markdown } from './Markdown';
import { HUE } from './agent';
import type { Member } from './team';
import { useVoice, type VoiceMode } from '../lib/useVoice';

export function VoicePanel({ kind, member, title, hint, labels }: {
  kind: 'owner' | 'customer'; member: Member; title: string; hint: string; labels: { start: string; stop: string; speaking: string };
}) {
  const v = useVoice(kind);
  const h = HUE[member];
  const state: Record<VoiceMode, string> = { idle: hint, connecting: 'Ulanmoqda…', listening: 'Eshityapti — gapiring', thinking: 'Bajaryapti…', speaking: labels.speaking };
  return (
    <section aria-label={title} className="relative overflow-hidden rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full" style={{ background: `radial-gradient(closest-side, ${h.glow}, transparent)` }} />
      <div className="relative flex items-center gap-5">
        <button type="button" onClick={() => { void v.toggle(); }} aria-pressed={v.active} aria-label={v.active ? labels.stop : labels.start}
          className="group relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-glass/60">
          <div ref={v.orb} aria-hidden="true" style={{ transform: 'scale(calc(1 + var(--mic, 0) * 0.18 + var(--ai, 0) * 0.1))', filter: 'brightness(calc(1 + var(--ai, 0) * 0.5))' }} className="absolute inset-0 transition-transform duration-100">
            <span className="absolute inset-0 animate-[spin_12s_linear_infinite] rounded-full opacity-70 blur-xl motion-reduce:animate-none" style={{ background: `conic-gradient(from 0deg, ${h.a}, ${h.b}, ${h.a})` }} />
            <span className="absolute inset-[7%] rounded-full" style={{ background: `radial-gradient(circle at 30% 28%, #ffffffcc, ${h.a} 38%, ${h.b} 72%, #15123a 100%)` }} />
          </div>
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm">
            {v.active ? <Square className="h-4 w-4 fill-current" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-[#f2f0ea]">{title}</h2>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-[#a3a9b5]" aria-live="polite">
            {v.active && <span className={`h-2 w-2 shrink-0 rounded-full ${v.mode === 'thinking' ? 'bg-amber-400' : v.mode === 'connecting' ? 'bg-glass/40' : 'bg-emerald-400'}`} aria-hidden="true" />}
            {state[v.mode]}
          </p>
        </div>
      </div>
      {v.error && <p role="alert" className="relative mt-4 rounded-xl bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{v.error}</p>}
      {(v.you || v.ai) && (
        <div className="relative mt-5 flex flex-col gap-2" aria-live="polite">
          {v.you && <p className="text-[14px] text-[#8a909c]">«{v.you}»</p>}
          {v.ai && <p className="text-[18px] font-medium leading-snug text-[#f2f0ea]">{v.ai}</p>}
        </div>
      )}
      {v.cards.length > 0 && (
        <ul className="relative mt-4 flex flex-col gap-2">
          {v.cards.map(c => (
            <li key={c.id} className={`animate-rise rounded-2xl border px-4 py-3 ${c.kind === 'booked' ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : c.kind === 'working' ? 'border-amber-300/20 bg-amber-300/[0.05]' : 'border-glass/[0.08] bg-glass/[0.03]'}`}>
              <p className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${c.kind === 'booked' ? 'text-emerald-300' : 'text-[#a3a9b5]'}`}>{c.title}</p>
              {c.items && (
                <ul className="mt-2 flex flex-col gap-1">
                  {c.items.map((it, i) => <li key={i} className="flex justify-between gap-3 text-[14px] text-[#e4e3de]"><span>{it.title}</span>{it.when && <span className={`shrink-0 tabular-nums text-[12px] ${it.late ? 'text-[#f5b454]' : 'text-[#7d838f]'}`}>{it.when}</span>}</li>)}
                </ul>
              )}
              {c.body && (c.kind === 'answer' ? <Markdown text={c.body} className="mt-1.5 text-[14px] leading-relaxed text-[#e4e3de]" /> : <p className="mt-1.5 text-[14px] text-[#e4e3de]">{c.body}</p>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
