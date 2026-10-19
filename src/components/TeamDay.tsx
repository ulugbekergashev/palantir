/**
 * «Bugun jamoa nima qildi» — bosh ekranda, AI jamoa kartalari ostida: har xodimning bugungi ishi bir jumlada va raqamlarda,
 * yonida bugungi jurnal (hamma xodim yozuvlari). Ma'lumot serverda haqiqiy yozuvlardan yig'iladi (server/teamDay.ts), AI'siz.
 * Har daqiqada va biror ish bajarilganda (tick) yangilanadi.
 */
import { useEffect, useState } from 'react';
import { api, type TeamDay as Day } from '../data/api';
import { hrefOf } from '../lib/nav';
import { HUE, clock } from './agent';
import { TEAM } from './team';

const POLL_MS = 60_000;

export function TeamDay({ tick = 0 }: { tick?: number }) {
  const [day, setDay] = useState<Day | null>(null);
  useEffect(() => {
    let stale = false;
    const load = () => api.teamDay().then(r => { if (!stale) setDay(r); }).catch(() => {});
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { stale = true; clearInterval(t); };
  }, [tick]);
  if (!day) return null;
  return (
    <section aria-labelledby="jamoa-bugun" className="mt-10 w-full text-left">
      <h2 id="jamoa-bugun" className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[#9ba1ad]">Bugun jamoa nima qildi</h2>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ul className="flex flex-col divide-y divide-glass/[0.06] rounded-2xl border border-glass/[0.08] bg-glass/[0.03]">
          {day.members.map(m => {
            const h = HUE[m.member], meta = TEAM[m.member];
            return (
              <li key={m.member}>
                <a href={hrefOf(m.member)} className="flex items-start gap-3 px-4 py-3.5 no-underline transition-colors hover:bg-glass/[0.03]">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${h.a}1f`, color: h.text }}><meta.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#f2f0ea]">{meta.name}</span>
                    <span className="mt-0.5 block text-[13.5px] leading-relaxed text-[#a3a9b5]">{m.summary}</span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {m.facts.map(f => (
                        <span key={f.label} className={`rounded-lg border px-2 py-0.5 text-[12px] ${f.value ? 'border-glass/10 text-[#d9dbe1]' : 'border-glass/[0.05] text-[#6b717d]'}`}>
                          <b className="tabular-nums font-semibold" style={f.value ? { color: h.text } : undefined}>{f.value}</b> {f.label.toLowerCase()}
                        </span>
                      ))}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="rounded-2xl border border-glass/[0.08] bg-glass/[0.03] p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-[#d9dbe1]">Bugungi jurnal</h3>
          {day.timeline.length ? (
            <ol className="flex flex-col gap-2.5">
              {day.timeline.map(e => (
                <li key={e.id} className="flex gap-2.5 text-[13px]">
                  <span className="w-10 shrink-0 tabular-nums text-[#7d838f]">{clock(e.at)}</span>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: e.level === 'crit' ? '#fb7185' : e.level === 'warn' ? '#f5b454' : HUE[e.member].a }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 leading-snug text-[#d9dbe1]"><span className="text-[#7d838f]">{TEAM[e.member].name} · </span>{e.title}</span>
                </li>
              ))}
            </ol>
          ) : <p className="m-0 text-[13px] leading-relaxed text-[#7d838f]">Bugun hali yozuv yo'q. Xodimlarga topshiriq bersangiz, bajargani shu yerda chiqadi.</p>}
        </div>
      </div>
    </section>
  );
}
