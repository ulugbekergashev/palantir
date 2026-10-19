/**
 * «Cerebro» deb chaqirilganda istalgan sahifada pastda chiqadigan suhbat oynasi: sfera (ovozga qarab), egasi nima dedi, Cerebro
 * nima deyapti va bajargan ishlari (karta). Suhbat tugagach bir necha soniya turib yopiladi; quloq yana tinglashga qaytadi.
 */
import { Square, X } from 'lucide-react';
import { Markdown } from './Markdown';
import { HUE } from './agent';
import type { Wake } from '../lib/useWake';

export function WakeOverlay({ wake }: { wake: Wake }) {
  if (!wake.shown) return null;
  const h = HUE.yordamchi;
  const live = wake.phase === 'live';
  return (
    <section role="dialog" aria-label="Cerebro bilan ovozli suhbat" aria-live="polite"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-[560px] animate-rise overflow-hidden rounded-[26px] border border-[#8b8cff]/25 bg-[#0b0c12]/95 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur lg:bottom-8 lg:left-[92px]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full" style={{ background: `radial-gradient(closest-side, ${h.glow}, transparent)` }} />
      <div className="relative flex items-center gap-4">
        <div ref={wake.orb} aria-hidden="true" className="relative h-14 w-14 shrink-0 transition-transform duration-100"
          style={{ transform: 'scale(calc(1 + var(--mic, 0) * 0.22 + var(--ai, 0) * 0.14))', filter: 'brightness(calc(1 + var(--ai, 0) * 0.5))' }}>
          <span className="absolute inset-0 animate-[spin_10s_linear_infinite] rounded-full opacity-70 blur-lg motion-reduce:animate-none" style={{ background: `conic-gradient(from 0deg, ${h.a}, ${h.b}, ${h.a})` }} />
          <span className="absolute inset-[7%] rounded-full" style={{ background: `radial-gradient(circle at 30% 28%, #ffffffcc, ${h.a} 38%, ${h.b} 72%, #15123a 100%)` }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c7c8ff]">{live ? `«${wake.word}» — eshityapman` : 'Suhbat tugadi'}</p>
          {wake.you && <p className="mt-0.5 truncate text-[14px] text-[#8a909c]">«{wake.you}»</p>}
        </div>
        {live
          ? <button type="button" onClick={wake.hangUp} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#f2f0ea] px-3.5 text-[13px] font-semibold text-[#07080b]"><Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />Tugatish</button>
          : <button type="button" onClick={wake.hide} aria-label="Yopish" className="flex h-10 w-10 items-center justify-center rounded-xl text-[#a3a9b5] hover:bg-glass/5"><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      {wake.ai && <p className="relative mt-4 text-[18px] font-medium leading-snug text-[#f2f0ea]">{wake.ai}</p>}
      {wake.error && <p role="alert" className="relative mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">{wake.error}</p>}
      {wake.cards.length > 0 && (
        <ul className="relative mt-3 flex flex-col gap-2">
          {wake.cards.map(c => (
            <li key={c.id} className={`rounded-2xl border px-4 py-2.5 ${c.kind === 'working' ? 'border-amber-300/20 bg-amber-300/[0.05]' : 'border-glass/[0.08] bg-glass/[0.03]'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#a3a9b5]">{c.title}</p>
              {c.items && <ul className="mt-1.5 flex flex-col gap-0.5">{c.items.map((it, i) => <li key={i} className="flex justify-between gap-3 text-[13.5px] text-[#e4e3de]"><span>{it.title}</span>{it.when && <span className={`shrink-0 tabular-nums text-[12px] ${it.late ? 'text-[#f5b454]' : 'text-[#7d838f]'}`}>{it.when}</span>}</li>)}</ul>}
              {c.body && (c.kind === 'answer' ? <Markdown text={c.body} className="mt-1 text-[13.5px] leading-relaxed text-[#e4e3de]" /> : <p className="mt-1 text-[13.5px] text-[#e4e3de]">{c.body}</p>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
