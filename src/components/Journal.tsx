/**
 * Xodim jurnali — u nimani ko'rdi va nima qildi: kamera hodisasi (kadri bilan), jadval bo'yicha bajargan ishi va natijasi.
 * Eng yangisi tepada; kunlar bo'yicha. Kadr bosilsa — kattalashadi.
 */
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info, Loader2, X } from 'lucide-react';
import type { AgentEvent, OrderMember } from '../types';
import { api } from '../data/api';
import type { Notify } from './Artifacts';
import { Quiet, clock } from './agent';
import { iso } from '../lib/week';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const dayOf = (at: string) => {
  const d = new Date(at);
  return iso(d) === iso(new Date()) ? 'Bugun' : `${d.getDate()}-${MONTHS[d.getMonth()]}`;
};
const TONE: Record<AgentEvent['level'], { cls: string; icon: typeof Info }> = {
  crit: { cls: 'text-rose-300 bg-rose-400/10', icon: CircleAlert },
  warn: { cls: 'text-[#f5b454] bg-[#f5b454]/10', icon: CircleAlert },
  info: { cls: 'text-emerald-300 bg-emerald-400/10', icon: CircleCheck },
};

function Frame({ id, onOpen }: { id: string; onOpen: (url: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    let url: string | null = null, gone = false;
    api.eventImage(id).then(b => { if (!gone && b.size) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => { if (!gone) setLost(true); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (lost) return <span className="flex h-[72px] w-[128px] shrink-0 items-center justify-center rounded-xl border border-dashed border-glass/10 text-center text-[11px] text-[#7d838f]">kadr o'chirilgan</span>;
  if (!src) return <span className="block h-[72px] w-[128px] shrink-0 animate-pulse rounded-xl bg-glass/[0.05]" aria-hidden="true" />;
  return (
    <button type="button" onClick={() => onOpen(src)} className="shrink-0 overflow-hidden rounded-xl border border-glass/10" aria-label="Kadrni kattalashtirish">
      <img src={src} alt="Hodisa kadri" className="h-[72px] w-[128px] object-cover" />
    </button>
  );
}

export function AgentJournal({ member, notify, cameraId, tick = 0, empty }: { member: OrderMember; notify: Notify; cameraId?: string; tick?: number; empty?: string }) {
  const [list, setList] = useState<AgentEvent[] | null>(null);
  const [big, setBig] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    api.agentEvents(member, cameraId).then(r => { if (!stale) setList(r.events); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [member, cameraId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  if (!list.length) return <Quiet>{empty ?? "Hali yozuv yo'q. Topshiriq bersangiz, nima ko'rgani va nima qilgani shu yerda turadi."}</Quiet>;
  const days: { title: string; items: AgentEvent[] }[] = [];
  for (const e of list) { const t = dayOf(e.at); if (days.at(-1)?.title === t) days.at(-1)!.items.push(e); else days.push({ title: t, items: [e] }); }
  return (
    <div className="flex flex-col gap-5">
      {days.map(d => (
        <section key={d.title} aria-label={d.title} className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#7d838f]">{d.title}</h3>
          <ul className="flex flex-col gap-2">
            {d.items.map(e => {
              const T = TONE[e.level];
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${T.cls}`}><T.icon className="h-4 w-4" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2 text-[14.5px] font-medium leading-snug text-[#f2f0ea]"><span className="min-w-0 flex-1">{e.title}</span><span className="shrink-0 tabular-nums text-[12px] font-normal text-[#7d838f]">{clock(e.at)}</span></p>
                    {e.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[13px] leading-relaxed text-[#a3a9b5]">{e.body}</p>}
                  </div>
                  {e.hasImage && <Frame id={e.id} onOpen={setBig} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {big && (
        <div role="dialog" aria-label="Kadr" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={() => setBig(null)}>
          <img src={big} alt="Hodisa kadri" className="max-h-full max-w-full rounded-2xl" />
          <button type="button" onClick={() => setBig(null)} aria-label="Yopish" className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}
