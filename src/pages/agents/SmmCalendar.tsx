/**
 * Panel → Marketing → SMM-menejer → Kalendar: kunlar bo'yicha postlar (vaqt, kanal, format, rasm, matn, holat). Kalendar tuzish,
 * tayyorlash (matn + shablon dizayn), tasdiqlash — tasdiqlangan post vaqti kelganda o'zi chiqadi (server/smm/publish.ts)
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Camera, Check, Send, Trash2, Wand2, X } from 'lucide-react';
import type { SmmPostView, SmmView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Panel, Quiet } from '../../components/agent';
import { ACCENT, button, field, ghost, spin } from './Content';

const primary = `${button} text-[#07080b]`;
const WEEKDAY = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const KIND = { post: 'Post', carousel: 'Karusel', story: 'Storis' } as const;
const STATUS: Record<SmmPostView['status'], { label: string; tone: string }> = {
  idea: { label: "G'oya", tone: 'bg-glass/[0.06] text-[#a3a9b5]' },
  drawing: { label: 'Tayyorlanmoqda…', tone: 'bg-[#7aa2ff]/15 text-[#b9ccff]' },
  ready: { label: 'Tasdiq kutyapti', tone: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  approved: { label: 'Tasdiqlangan — vaqtida chiqadi', tone: 'bg-[#4ade80]/12 text-[#a7f3c0]' },
  publishing: { label: 'Chiqmoqda…', tone: 'bg-[#4ade80]/12 text-[#a7f3c0]' },
  published: { label: 'Chiqdi', tone: 'bg-[#4ade80]/20 text-[#bbf7d0]' },
  failed: { label: 'Chiqmadi', tone: 'bg-[#f87171]/15 text-[#fecaca]' },
  handed: { label: "Sizga yuborildi — o'zingiz joylang", tone: 'bg-[#c084fc]/15 text-[#e9d5ff]' },
  cancelled: { label: 'Olib tashlangan', tone: 'bg-glass/[0.04] text-[#7d838f]' },
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} · ${WEEKDAY[d.getDay()]}`;
};

/** Rasm kirish tokeni bilan olinadi (img src sarlavha yubora olmaydi) */
function Thumb({ name, alt }: { name: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, stale = false;
    api.smmImage(name).then(b => { if (stale) return; url = URL.createObjectURL(b); setSrc(url); }).catch(() => {});
    return () => { stale = true; if (url) URL.revokeObjectURL(url); };
  }, [name]);
  return src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-glass/[0.04]" />;
}

function PostCard({ p, busy, act }: { p: SmmPostView; busy: string | null; act: (what: string, fn: () => Promise<SmmView>, done?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(p.caption);
  const [time, setTime] = useState(p.time);
  const s = STATUS[p.status];
  const editable = ['idea', 'ready', 'approved', 'failed'].includes(p.status);
  const Icon = p.channel === 'instagram' ? Camera : Send;
  return (
    <li className="flex gap-4 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-3.5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Rasmlarni ko'rish" className={`shrink-0 overflow-hidden rounded-xl bg-[#0b0c10] ${p.format === 'story' ? 'h-[128px] w-[72px]' : p.channel === 'telegram' && p.format === 'post' ? 'h-[72px] w-[128px]' : 'h-[112px] w-[90px]'}`}>
        {p.images[0] ? <Thumb name={p.images[0]} alt={p.title} /> : <div className="grid h-full w-full place-items-center text-[#5b616d]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></div>}
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#a3a9b5]">
          <b className="text-[#f2f0ea]">{p.time}</b>
          <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{p.channel === 'instagram' ? 'Instagram' : 'Telegram'} · {KIND[p.format]}</span>
          {p.images.length > 1 && <span>{p.images.length} slayd</span>}
          <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${s.tone}`}>{s.label}</span>
        </div>
        <p className="text-[14px] font-semibold leading-snug text-[#f2f0ea]">{p.title}</p>
        {p.error && <p className="text-[12.5px] text-[#fca5a5]">{p.error}</p>}
        {!open && p.caption && <p className="line-clamp-2 text-[13px] text-[#a3a9b5]">{p.caption}</p>}
        {!open && !p.caption && p.angle && <p className="line-clamp-2 text-[13px] text-[#7d838f]">{p.angle}</p>}
        {open && (
          <div className="space-y-3 pt-1">
            {p.images.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">{p.images.map(n => <div key={n} className={`shrink-0 overflow-hidden rounded-xl ${p.format === 'story' ? 'h-[320px] w-[180px]' : p.channel === 'telegram' && p.format === 'post' ? 'h-[180px] w-[320px]' : 'h-[300px] w-[240px]'}`}><Thumb name={n} alt={p.title} /></div>)}</div>}
            {editable && p.caption ? (
              <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={7} maxLength={2200} aria-label="Post matni" className={`${field} w-full`} />
            ) : p.caption ? <p className="whitespace-pre-wrap text-[13.5px] text-[#d6d8de]">{p.caption}</p> : null}
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[13px] text-[#a3a9b5]">Vaqt <input type="time" value={time} onChange={e => setTime(e.target.value)} className={`${field} w-28`} /></label>
                <button type="button" disabled={!!busy || (caption === p.caption && time === p.time)} onClick={() => act(`edit:${p.id}`, () => api.smmEdit(p.id, { ...(time !== p.time ? { time } : {}), ...(caption !== p.caption ? { caption } : {}) }), 'Saqlandi')} className={ghost}>Saqlash</button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {p.status === 'failed' && p.images.length > 0 && <button type="button" disabled={!!busy} onClick={() => act(`re:${p.id}`, () => api.smmReopen(p.id), 'Qayta tasdiqlashga qaytdi — vaqtini tekshirib, tasdiqlang')} className={ghost}><Check className="h-4 w-4" aria-hidden="true" /> Qayta tasdiqlashga</button>}
          {(p.status === 'idea' || (p.status === 'failed' && !p.images.length)) && <button type="button" disabled={!!busy} onClick={() => act(`prep:${p.id}`, () => api.smmPreparePost(p.id), 'Tayyorlanmoqda — bir-ikki daqiqa')} className={ghost}><Wand2 className="h-4 w-4" aria-hidden="true" /> Tayyorlash</button>}
          {p.status === 'ready' && <button type="button" disabled={!!busy} onClick={() => act(`ok:${p.id}`, () => api.smmApprove(p.id), "Tasdiqlandi — vaqtida o'zi chiqadi")} className={primary} style={{ background: ACCENT }}><Check className="h-4 w-4" aria-hidden="true" /> Tasdiqlash</button>}
          {editable && <button type="button" disabled={!!busy} onClick={() => act(`x:${p.id}`, () => api.smmReject(p.id), 'Olib tashlandi')} className={ghost} aria-label="Olib tashlash"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
          {p.caption && <button type="button" onClick={() => setOpen(o => !o)} className={ghost}>{open ? <><X className="h-4 w-4" aria-hidden="true" /> Yopish</> : "Ko'rish va tahrirlash"}</button>}
        </div>
      </div>
    </li>
  );
}

export function SmmCalendar({ notify }: { notify: Notify }) {
  const [view, setView] = useState<SmmView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState(14);
  const [perWeek, setPerWeek] = useState(4);
  const [wish, setWish] = useState('');
  const act = (what: string, fn: () => Promise<SmmView>, done?: string) => {
    setBusy(what);
    fn().then(v => { setView(v); if (done) notify(done); }, e => notify((e as Error).message, true)).finally(() => setBusy(null));
  };
  // Tayyorlanayotganda — tez-tez (rasmlar paydo bo'lsin)
  const working = !!view && (view.preparing || view.posts.some(p => p.status === 'drawing'));
  useEffect(() => {
    let alive = true;
    const load = () => api.smm().then(v => { if (alive) setView(v); }).catch(() => {});
    load();
    const t = setInterval(load, working ? 6000 : 30000);
    return () => { alive = false; clearInterval(t); };
  }, [working]);
  if (!view) return <Quiet>Yuklanmoqda…</Quiet>;
  const make = (e: FormEvent) => {
    e.preventDefault();
    if (view.posts.some(p => p.status === 'idea') && !window.confirm("Yangi kalendar hali tayyorlanmagan g'oyalarni almashtiradi (tayyor va tasdiqlanganlari qoladi). Davom etilsinmi?")) return;
    act('plan', () => api.smmCalendar(days, perWeek, wish), 'Kalendar tayyor — endi «Postlarni tayyorlash»');
  };
  const ideas = view.posts.filter(p => p.status === 'idea' || p.status === 'failed').length;
  const ready = view.posts.filter(p => p.status === 'ready');
  const byDay = view.posts.reduce<Map<string, SmmPostView[]>>((m, p) => m.set(p.day, [...(m.get(p.day) ?? []), p]), new Map());
  const today = iso(new Date());
  return (
    <div className="space-y-5">
      <Panel title="Kontent kalendari">
        <form onSubmit={make} className="space-y-3">
          <p className="text-[13.5px] leading-relaxed text-[#a3a9b5]">SMM-menejer kunlar bo'yicha post, karusel va storislarni rejalaydi (brend-buk ustunlari, bayramlar), keyin har biriga matn yozadi va brend shablonida rasm tayyorlaydi. Siz tasdiqlagan post vaqti kelganda o'zi chiqadi.</p>
          <div className="flex flex-wrap items-end gap-3 text-[13.5px] text-[#c9cbd2]">
            <label className="flex items-center gap-2"><select value={days} onChange={e => setDays(Number(e.target.value))} className={`${field} w-auto`}>{[7, 14, 30].map(n => <option key={n} value={n}>{n}</option>)}</select> kunga</label>
            <label className="flex items-center gap-2">haftasiga <select value={perWeek} onChange={e => setPerWeek(Number(e.target.value))} className={`${field} w-auto`}>{[3, 4, 5, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}</select> ta</label>
            <input value={wish} onChange={e => setWish(e.target.value)} maxLength={600} placeholder="Nimaga urg'u bersin (ixtiyoriy): masalan, implant va bolalar stomatologiyasi" aria-label="Kalendar istagi" className={`${field} min-w-0 flex-1 basis-72`} />
            <button type="submit" disabled={!!busy} className={primary} style={{ background: ACCENT }}>{busy === 'plan' ? spin : <CalendarDays className="h-4 w-4" aria-hidden="true" />} {busy === 'plan' ? 'Tuzyapti… (2 daqiqagacha)' : 'Kalendar tuzish'}</button>
          </div>
          {(ideas > 0 || ready.length > 0 || view.preparing) && (
            <div className="flex flex-wrap gap-2 border-t border-glass/[0.06] pt-3">
              {ideas > 0 && <button type="button" disabled={!!busy || view.preparing} onClick={() => act('prep', () => api.smmPrepare(days), 'Tayyorlash boshlandi — har post bir-ikki daqiqa, tayyorlari Telegram\'ga ham keladi')} className={ghost}>{view.preparing ? spin : <Wand2 className="h-4 w-4" aria-hidden="true" />} {view.preparing ? 'Tayyorlanmoqda…' : `Postlarni tayyorlash (${ideas})`}</button>}
              {ready.length > 0 && <button type="button" disabled={!!busy} onClick={() => act('all', () => api.smmApproveRange(ready[0].day, ready[ready.length - 1].day, ready.map(p => p.id)), `${ready.length} ta post tasdiqlandi`)} className={primary} style={{ background: ACCENT }}><Check className="h-4 w-4" aria-hidden="true" /> Hammasini tasdiqlash ({ready.length})</button>}
            </div>
          )}
          {!view.picture && <p className="text-[12.5px] text-[#7d838f]">Rasm chizadigan xizmat (Gemini yoki Meta AI) ulanmagan — fon brend rangida bo'ladi, matn baribir shablonda.</p>}
        </form>
      </Panel>
      {!view.posts.length ? <Quiet>Kalendar bo'sh. «Kalendar tuzish»ni bosing yoki Palantir'ga ayting: «keyingi 2 haftaga kontent kalendari tuz».</Quiet> : (
        [...byDay.entries()].map(([day, posts]) => (
          <Panel key={day} title={`${dayLabel(day)}${day === today ? ' · bugun' : ''}`}>
            <ul className="flex flex-col gap-2.5">{posts.map(p => <PostCard key={`${p.id}:${p.status}:${p.caption.length}`} p={p} busy={busy} act={act} />)}</ul>
          </Panel>
        ))
      )}
    </div>
  );
}
