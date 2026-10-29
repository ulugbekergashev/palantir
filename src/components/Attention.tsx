/**
 * «Sizni kutyapti» — bosh ekranda: hamma AI xodimdan egasining qarorini kutayotgan narsalar bitta ro'yxatda, har biri bitta tugma bilan
 * hal qilinadi (javobni yuborish, so'rovni yopish, kamera hodisasini «ko'rdim», ishni bajarildi yoki ertaga surish). Hal qilingani
 * ro'yxatdan darhol tushadi; ro'yxat har 30 soniyada yangilanadi. Bo'sh bo'lsa — «hammasi joyida».
 */
import { useEffect, useState } from 'react';
import { Camera, Check, CircleCheck, Clock, ExternalLink, Headset, Loader2, Phone, Send, Sparkles, X, type LucideIcon } from 'lucide-react';
import { api, type AttentionItem } from '../data/api';
import { iso, addDays } from '../lib/week';
import { hrefOf } from '../lib/nav';
import { HUE, ago } from './agent';
import type { Notify } from './Artifacts';

const POLL_MS = 30_000;
const ICON: Record<AttentionItem['kind'], LucideIcon> = { camera: Camera, request: Headset, reply: Send, task: Clock, order: Sparkles };
const WHERE: Record<AttentionItem['kind'], (i: AttentionItem) => string> = {
  camera: () => hrefOf('kuzatuvchi', 'jurnal'),
  request: () => hrefOf('qabulxona', 'sorovlar'),
  reply: () => hrefOf('qabulxona'),
  task: () => hrefOf('yordamchi', 'jurnal'),
  order: i => hrefOf(i.member, 'topshiriqlar'),
};
const tomorrow9 = () => `${iso(addDays(new Date(), 1))}T09:00`;

function Item({ it, onDone, notify }: { it: AttentionItem; onDone: (key: string) => void; notify: Notify }) {
  const [busy, setBusy] = useState<string | null>(null);
  const Icon = ICON[it.kind];
  const h = HUE[it.member];
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); notify(done); onDone(it.key); } catch (e) { notify((e as Error).message, true); setBusy(null); }
  };
  const button = (key: string, label: string, icon: LucideIcon, fn: () => Promise<unknown>, done: string, primary = false) => {
    const B = icon;
    return (
      <button key={key} type="button" disabled={!!busy} onClick={() => { void act(key, fn, done); }}
        className={`flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium disabled:opacity-50 ${primary ? 'bg-[#f2f0ea] text-[#07080b]' : 'border border-glass/10 text-[#d9dbe1] hover:bg-glass/5'}`}>
        {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <B className="h-3.5 w-3.5" aria-hidden="true" />}{label}
      </button>
    );
  };
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border p-4 text-left ${it.urgent ? 'border-rose-400/30 bg-rose-400/[0.05]' : 'border-glass/[0.08] bg-glass/[0.03]'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${h.a}1f`, color: h.text }}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2"><span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-[#f2f0ea]">{it.title}</span><span className="shrink-0 text-[12px] text-[#7d838f]">{ago(it.at)}</span></p>
          {it.body && <p className="mt-1 line-clamp-3 text-[13.5px] leading-relaxed text-[#a3a9b5]">{it.body}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-12">
        {it.kind === 'reply' && [
          button('send', 'Yuborish', Send, () => api.sendReply(it.refId), 'Yuborildi', true),
          button('dismiss', 'Kerak emas', X, () => api.dismissReply(it.refId), 'Olib tashlandi'),
        ]}
        {it.kind === 'request' && button('done', 'Hal qilindi', Check, () => api.requestAction(it.refId, 'done'), 'Hal qilindi', true)}
        {it.kind === 'request' && it.phone && <a href={`tel:${it.phone}`} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-glass/10 px-3 text-[13px] text-[#d9dbe1] no-underline hover:bg-glass/5"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{it.phone}</a>}
        {it.kind === 'camera' && button('seen', "Ko'rdim", Check, () => api.seeEvent(it.refId), "Ko'rildi", true)}
        {it.kind === 'task' && [
          button('done', 'Bajarildi', Check, () => api.updateTask(it.refId, { status: 'done' }), 'Bajarildi', true),
          button('later', 'Ertaga 9:00', Clock, () => api.updateTask(it.refId, { dueAt: tomorrow9() }), 'Ertaga 9:00 ga surildi'),
        ]}
        <a href={WHERE[it.kind](it)} className="flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] text-[#a3a9b5] no-underline hover:bg-glass/5 hover:text-[#f2f0ea]"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Ochish</a>
      </div>
    </li>
  );
}

export function Attention({ notify, tick = 0, onChanged }: { notify: Notify; tick?: number; /** Hal qilindi — xodimlar holati (nishonlar) ham yangilansin */ onChanged?: () => void }) {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  useEffect(() => {
    let stale = false;
    const load = () => api.attention().then(r => { if (!stale) setItems(r.items); }).catch(() => {});
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { stale = true; clearInterval(t); };
  }, [tick]);
  if (!items) return null;
  return (
    <section aria-labelledby="kutyapti" className="mt-10 w-full max-w-3xl">
      <h2 id="kutyapti" className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9ba1ad]">
        Sizni kutyapti{items.length > 0 && <span className="rounded-full bg-[#f5b454] px-2 py-0.5 text-[11px] font-bold tracking-normal text-[#06070a]">{items.length}</span>}
      </h2>
      {items.length ? (
        <ul className="flex flex-col gap-2.5">{items.slice(0, 8).map(it => <Item key={it.key} it={it} notify={notify} onDone={key => { setItems(list => list?.filter(x => x.key !== key) ?? list); onChanged?.(); }} />)}</ul>
      ) : (
        <p className="flex items-center gap-2.5 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] px-4 py-3.5 text-[14px] text-[#a3a9b5]"><CircleCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />Hammasi joyida — sizning qaroringizni kutayotgan narsa yo'q.</p>
      )}
      {items.length > 8 && <p className="mt-2 text-[13px] text-[#7d838f]">Yana {items.length - 8} ta — xodimlar sahifalarida.</p>}
    </section>
  );
}
