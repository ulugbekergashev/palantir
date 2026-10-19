/**
 * Topshiriqlar — egasi AI xodimga o'z so'zi bilan beradi («kechasi klinikada odam ko'rinsa xabar ber»). Ikki qadam: xodim qanday
 * tushunganini ko'rsatadi (tushunarsiz bo'lsa — savol beradi), egasi saqlaydi. Ro'yxatda: yoqish/o'chirish, «Sinab ko'rish»
 * (jadvaldagi ish va AI ko'zi — hozir bajariladi, kamera qoidasi — hozirgi kadrda tekshiriladi), oxirgi natija.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Clock, Eye, Loader2, Play, Plus, ScanEye, ScrollText, Sparkles, Trash2 } from 'lucide-react';
import type { AgentOrder, Camera, OrderMember, OrderSpec } from '../types';
import { api } from '../data/api';
import type { Notify } from './Artifacts';
import { HUE, Quiet, ago } from './agent';
import { TEAM } from './team';
import { cameraPresets, type Preset } from '../lib/presets';

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
/** Har xodimga tayyor misollar — bosilsa matn maydoniga tushadi */
export const TEMPLATES: Record<OrderMember, string[]> = {
  kuzatuvchi: [
    "Kechasi 21:00 dan 07:00 gacha klinikada odam ko'rinsa — darhol xabar ber",
    "Qabulxonada 10 daqiqadan ko'p hech kim bo'lmasa ayt",
    "Kutish zalida 5 kishidan ko'p yig'ilsa xabar ber",
    "Har kuni 9:00 da qabulxona toza va tartibli ekanini tekshir",
  ],
  qabulxona: [
    'Narx so‘rasa, birinchi konsultatsiya bepul ekanini ham ayt',
    'Chegirma va‘da qilma — administrator aniqlab aytadi de',
    'Har kuni 19:00 da bugungi murojaatlar xulosasini yubor',
  ],
  yordamchi: [
    'Har kuni 8:30 da kun rejamni yubor',
    'Har juma 17:00 da haftaning qilingan va qolgan ishlarini yubor',
    'Menga doim qisqa va aniq javob ber',
  ],
  tahlilchi: [
    "Har dushanba 9:00 da o'tgan hafta qabullari va tushumi hisobotini yubor",
    'Har kuni 21:00 da bugungi tushum va qabullarni yubor',
    'Hisobotda doim o‘tgan davr bilan solishtir',
  ],
};

const KIND: Record<OrderSpec['kind'], { label: string; icon: typeof Clock }> = {
  standing: { label: 'Doimiy qoida', icon: ScrollText },
  schedule: { label: 'Jadval', icon: Clock },
  watch: { label: 'Kamera qoidasi', icon: Eye },
  look: { label: "AI ko'zi", icon: ScanEye },
};

const days = (d: number[]) => (d.length ? d.map(x => DAYS[x - 1]).join(', ') : 'har kuni');
const hours = (from: string | null, to: string | null) => (from && to ? `${from}–${to}` : 'har doim');
/** Tuzilmaning qisqa tafsiloti: qayerda, qachon, qancha */
export function specDetails(spec: OrderSpec, cams: Camera[]): string {
  const cam = 'cameraId' in spec ? cams.find(c => c.id === spec.cameraId) : null;
  // Kamera o'chirilgan bo'lsa — «hamma kamera» deb adashtirmaslik uchun aniq aytiladi
  const where = 'cameraId' in spec ? (cam ? cam.name : spec.cameraId ? "o'chirilgan kamera" : 'hamma kamera') : '';
  if (spec.kind === 'schedule') return `${spec.at} · ${days(spec.days)}`;
  if (spec.kind === 'watch') {
    const zone = cam?.zones.find(z => z.id === spec.zoneId);
    return [zone ? `${where} · ${zone.name}` : where, hours(spec.from, spec.to), spec.minutes ? `${spec.minutes} daqiqa davom etsa` : 'darhol'].join(' · ');
  }
  if (spec.kind === 'look') return [where, spec.at ? `${spec.at} · ${days(spec.days)}` : `har ${spec.everyMin} daqiqada · ${hours(spec.from, spec.to)}`, 'kadr AI\'ga yuboriladi'].join(' · ');
  return 'har ishida amal qiladi';
}

function OrderCard({ o, cams, notify, onChange, accent }: { o: AgentOrder; cams: Camera[]; notify: Notify; onChange: (o: AgentOrder | null) => void; accent: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const K = KIND[o.spec.kind];
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border p-4 transition-opacity ${o.active ? 'border-glass/[0.08] bg-glass/[0.02]' : 'border-glass/[0.05] opacity-60'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}><K.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8a909c]">{K.label} · {specDetails(o.spec, cams)}</p>
          <p className="mt-1 text-[15px] font-medium leading-snug text-[#f2f0ea]">{o.summary}</p>
          <p className="mt-1 text-[13px] text-[#7d838f]">«{o.text}»</p>
        </div>
        <label className="relative mt-1 inline-flex shrink-0 cursor-pointer items-center" title={o.active ? "O'chirish" : 'Yoqish'}>
          <input type="checkbox" className="peer sr-only" checked={o.active} disabled={!!busy}
            onChange={e => { const v = e.target.checked; void act('toggle', async () => onChange((await api.setOrderActive(o.id, v)).order)); }} />
          <span className="sr-only">{o.active ? 'Yoqilgan' : "O'chirilgan"}</span>
          <span aria-hidden="true" className="h-6 w-11 rounded-full bg-glass/15 transition-colors peer-checked:bg-emerald-400/80 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
      {(o.lastRunAt || result) && (
        <div className="rounded-xl bg-glass/[0.03] px-3 py-2 text-[13px] leading-relaxed text-[#c9cbd2]">
          <p className="text-[11px] text-[#7d838f]">{result ? 'Hozirgi sinov' : `Oxirgi marta ${ago(o.lastRunAt!)} · jami ${o.hits} marta`}</p>
          <p className="mt-0.5 line-clamp-4 whitespace-pre-line">{result ?? o.lastResult}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy || !o.active} onClick={() => { void act('run', async () => setResult((await api.runOrder(o.id)).result)); }}
          className="flex min-h-9 items-center gap-1.5 rounded-xl border border-glass/10 px-3 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-40">
          {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}{o.spec.kind === 'watch' ? 'Hozir tekshirish' : o.spec.kind === 'standing' ? 'Qanday ishlaydi' : 'Hozir bajarish'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => { void act('del', async () => { await api.deleteOrder(o.id); onChange(null); }); }} aria-label={`O'chirish: ${o.summary}`}
          className="ml-auto flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] text-[#8a909c] hover:bg-rose-400/10 hover:text-rose-200 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />O'chirish
        </button>
      </div>
    </li>
  );
}

/** Tayyor kamera qoidalari: bir bosishda yoqiladi; yoqilgani belgilanadi (o'sha matnli topshiriq bor) */
function Presets({ presets, orders, busy, onAdd }: { presets: Preset[]; orders: AgentOrder[]; busy: string | null; onAdd: (p: Preset) => void }) {
  return (
    <section aria-label="Tayyor qoidalar" className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">Tayyor qoidalar — bir bosishda</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {presets.map(p => {
          const on = orders.some(o => o.text === p.text);
          return (
            <li key={p.key} className="flex items-center gap-3 rounded-2xl border border-glass/[0.07] bg-glass/[0.02] px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-[#f2f0ea]">{p.title}</span>
                <span className="block text-[12px] text-[#8a909c]">{p.hint}</span>
              </span>
              {on
                ? <span className="flex min-h-9 items-center gap-1.5 px-2 text-[13px] text-emerald-300"><Check className="h-4 w-4" aria-hidden="true" />Yoqilgan</span>
                : (
                  <button type="button" disabled={!!busy} onClick={() => onAdd(p)} aria-label={`Yoqish: ${p.title}`}
                    className="flex min-h-9 items-center gap-1.5 rounded-xl border border-glass/10 px-3 text-[13px] font-semibold text-[#f2f0ea] hover:bg-glass/5 disabled:opacity-50">
                    {busy === p.key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Yoqish
                  </button>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OrdersPanel({ member, notify, cameras = [], cameraId }: { member: OrderMember; notify: Notify; cameras?: Camera[]; /** Faqat shu kameraning topshiriqlari (kamera sahifasi) */ cameraId?: string }) {
  const [list, setList] = useState<AgentOrder[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'parse' | 'save' | null>(null);
  const [draft, setDraft] = useState<{ spec: OrderSpec; summary: string; text: string } | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const accent = HUE[member].a;
  const name = TEAM[member].name;

  useEffect(() => {
    let stale = false;
    api.orders(member).then(r => { if (!stale) setList(r.orders); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps

  const camName = cameraId ? cameras.find(c => c.id === cameraId)?.name : null;
  const parse = async (e?: FormEvent) => {
    e?.preventDefault();
    const clean = text.trim();
    if (clean.length < 3 || busy) return;
    setBusy('parse'); setDraft(null); setQuestion(null);
    try {
      // Kamera sahifasida berilgan topshiriq — shu kamera uchun
      const r = await api.parseOrder(member, camName && !clean.includes(camName) ? `${clean} (kamera: ${camName})` : clean);
      if (r.parsed.ok) setDraft({ spec: r.parsed.spec, summary: r.parsed.summary, text: clean }); else setQuestion(r.parsed.question);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const r = await api.createOrder({ member, ...draft });
      setList(l => [...(l ?? []), r.order]);
      setDraft(null); setText('');
      notify(`${name} topshiriqni oldi`);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(null); }
  };
  const presets = member === 'kuzatuvchi' ? cameraPresets(cameras, cameraId) : [];
  const addPreset = async (p: Preset) => {
    setAdding(p.key);
    try {
      const r = await api.createOrder({ member, text: p.text, spec: p.spec, summary: p.summary });
      setList(l => [...(l ?? []), r.order]);
      notify(`${name}: «${p.title}» yoqildi`);
    } catch (err) { notify((err as Error).message, true); } finally { setAdding(null); }
  };
  const shown = (list ?? []).filter(o => !cameraId || ('cameraId' in o.spec && (o.spec.cameraId === cameraId || o.spec.cameraId === null)));

  return (
    <section aria-label={`${name}ga topshiriqlar`} className="flex flex-col gap-4">
      <form onSubmit={parse} className="relative overflow-hidden rounded-[22px] border border-glass/[0.08] bg-[#0b0c10] p-5">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full" style={{ background: `radial-gradient(closest-side, ${HUE[member].glow}, transparent)` }} />
        <label htmlFor={`order-${member}`} className="relative block text-[17px] font-semibold text-[#f2f0ea]">{cameraId ? `«${camName}» uchun topshiriq` : `${name}ga topshiriq bering`}</label>
        <p className="relative mt-1 text-[13px] text-[#8a909c]">O'z so'zingiz bilan yozing — {name} qanday tushunganini ko'rsatadi, siz saqlaysiz. Keyin o'zi bajaradi va natijani Telegram'ga yuboradi.</p>
        <div className="relative mt-4 flex flex-col gap-1 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 focus-within:border-glass/25">
          <textarea id={`order-${member}`} value={text} onChange={e => { setText(e.target.value); setDraft(null); setQuestion(null); }} rows={2} maxLength={600}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void parse(); } }}
            placeholder={`Masalan: ${TEMPLATES[member][0]}`} className="min-h-14 w-full resize-none bg-transparent px-3 py-2 text-[15px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
          <button type="submit" disabled={text.trim().length < 3 || !!busy} className="flex min-h-10 items-center gap-2 self-end rounded-xl px-4 text-[14px] font-semibold text-[#07080b] disabled:opacity-40" style={{ background: accent }}>
            {busy === 'parse' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}Tushunish
          </button>
        </div>
        {!draft && !question && !presets.length && (
          <div className="relative mt-3 flex flex-wrap gap-2">
            {TEMPLATES[member].slice(0, cameraId ? 2 : undefined).map(t => <button key={t} type="button" onClick={() => setText(t)} className="min-h-8 rounded-full border border-glass/10 px-3 text-[12.5px] text-[#c9cbd2] hover:bg-glass/5">{t}</button>)}
          </div>
        )}
        {question && <p role="alert" className="relative mt-4 rounded-xl bg-[#f5b454]/10 px-4 py-3 text-[14px] text-[#fde2b0]">{name}: {question}</p>}
        {draft && (
          <div className="relative mt-4 animate-rise rounded-2xl border p-4" style={{ borderColor: `${accent}55`, background: `${accent}0f` }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: accent }}>{name} shunday tushundi · {KIND[draft.spec.kind].label}</p>
            <p className="mt-1.5 text-[16px] font-medium leading-snug text-[#f2f0ea]">{draft.summary}</p>
            <p className="mt-1 text-[13px] text-[#a3a9b5]">{specDetails(draft.spec, cameras)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => { void save(); }} disabled={busy === 'save'} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#f2f0ea] px-4 text-[14px] font-semibold text-[#07080b] disabled:opacity-50">
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}To'g'ri — saqlash
              </button>
              <button type="button" onClick={() => setDraft(null)} className="min-h-10 rounded-xl border border-glass/10 px-4 text-[14px] text-[#d9dbe1] hover:bg-glass/5">Boshqacha yozaman</button>
            </div>
          </div>
        )}
      </form>
      {presets.length > 0 && list && <Presets presets={presets} orders={list} busy={adding} onAdd={p => { void addPreset(p); }} />}
      {list === null ? <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />
        : shown.length ? (
          <ul className="flex flex-col gap-3">
            {shown.map(o => <OrderCard key={o.id} o={o} cams={cameras} notify={notify} accent={accent}
              onChange={next => setList(l => (next ? l?.map(x => (x.id === next.id ? next : x)) : l?.filter(x => x.id !== o.id)) ?? l)} />)}
          </ul>
        ) : <Quiet>Hali topshiriq yo'q. Yuqorida yozing yoki misollardan birini tanlang.</Quiet>}
    </section>
  );
}
