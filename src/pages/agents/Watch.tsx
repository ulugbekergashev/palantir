/**
 * Kuzatuvchi — kameralar bo'yicha AI xodim. Tuzilma (bozordagi Verkada, Rhombus, Solink kabi): kameralar → topshiriqlar → hodisalar.
 *   Hozir: kameralar devori (har birida hozir nechta odam), «kameradan so'rang» (AI ko'zi), bugungi topilmalar va hodisalar;
 *   Kameralar: har kameraning o'z sahifasi — jonli kadr, egasining tavsifi (har topshiriq va savolda AI shuni o'qiydi — kamera o'z
 *   agentiga ega bo'lgandek), shu kameraning topshiriqlari va jurnali.
 * IP kamera kadri 6 soniyada yangilanadi; odamlar soni — 5 soniyada (oxirgi kadr bo'yicha).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp, CircleAlert, CircleCheck, Loader2, ScanEye, Users, Video } from 'lucide-react';
import type { Attendance, Camera, CameraSummary } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentOrb, HUE, Panel, Quiet, clock } from '../../components/agent';
import { AgentJournal } from '../../components/Journal';
import { OrdersPanel } from '../../components/Orders';
import { hrefOf } from '../../lib/nav';
import { ZONE_KIND, hoursMin } from '../../lib/zones';

const SNAPSHOT_MS = 6_000;
const LIVE_MS = 5_000;
const ACCENT = HUE.kuzatuvchi.a;

export interface WatchData { cameras: Camera[]; summary: CameraSummary | null }
type LiveCounts = Record<string, { at: string; people: number }>;

export function useWatchData(notify: Notify, tick: number): WatchData | null {
  const [data, setData] = useState<WatchData | null>(null);
  useEffect(() => {
    let stale = false;
    Promise.all([api.cameras().then(r => r.cameras), api.cameraSummary().then(r => r.summary).catch(() => null)])
      .then(([cameras, summary]) => { if (!stale) setData({ cameras, summary }); })
      .catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

/** Har kamerada hozir nechta odam — LIVE_MS da yangilanadi */
function useLiveCounts(on: boolean): LiveCounts {
  const [live, setLive] = useState<LiveCounts>({});
  useEffect(() => {
    if (!on) return;
    let gone = false;
    const load = () => api.cameraLive().then(r => { if (!gone) setLive(r.live); }).catch(() => {});
    void load();
    const t = setInterval(() => { void load(); }, LIVE_MS);
    return () => { gone = true; clearInterval(t); };
  }, [on]);
  return live;
}

/** IP kameraning oxirgi kadri; brauzer kamerasida kadr serverda yo'q — belgisi */
function Live({ cam, people, big = false, onOpen }: { cam: Camera; people?: number; big?: boolean; onOpen?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!cam.ip) return;
    let gone = false, last: string | null = null;
    const load = () => api.cameraSnapshot(cam.id).then(b => {
      if (gone || !b.size) return;
      const url = URL.createObjectURL(b);
      setSrc(url);
      if (last) URL.revokeObjectURL(last);
      last = url;
    }).catch(() => {});
    void load();
    const t = setInterval(() => { void load(); }, SNAPSHOT_MS);
    return () => { gone = true; clearInterval(t); if (last) URL.revokeObjectURL(last); };
  }, [cam.id, cam.ip]);
  const online = !!cam.lastSeenAt && Date.now() - Date.parse(cam.lastSeenAt) < 60_000;
  const body = (
    <figure className={`relative m-0 overflow-hidden border border-glass/[0.07] bg-[#06070a] ${big ? 'rounded-[22px]' : 'rounded-2xl'}`}>
      {src ? <img src={src} alt={`${cam.name} — jonli kadr`} className="aspect-video w-full object-cover" />
        : <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-[#7d838f]"><Video className="h-8 w-8" aria-hidden="true" />{!cam.ip && <span className="text-[12px]">shu kompyuter kamerasi — kadr brauzerda</span>}</div>}
      {people !== undefined && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur"><Users className="h-3.5 w-3.5" aria-hidden="true" />{people}</span>
      )}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-[13px] text-[#f2f0ea]">
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-glass/30'}`} aria-hidden="true" />{cam.name}
        <span className="ml-auto text-[11px] text-[#a3a9b5]">{online ? 'jonli' : cam.lastSeenAt ? `oxirgi kadr ${clock(cam.lastSeenAt)}` : 'hali kadr yo‘q'}</span>
      </figcaption>
    </figure>
  );
  return onOpen ? <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`${cam.name} — kamera sahifasi`}>{body}</button> : body;
}

/** «Kameradan so'rang»: AI ko'zi kadrga qarab javob beradi (kadr AI'ga yuboriladi) */
function AskCamera({ cameraId, notify, placeholder }: { cameraId?: string; notify: Notify; placeholder: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ cameraId: string; name: string; answer: string }[] | null>(null);
  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2 || busy) return;
    setBusy(true);
    try { setAnswers((await api.askCamera(q.trim(), cameraId)).answers); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={ask} className="flex items-center gap-2 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 pl-4 focus-within:border-glass/25">
        <ScanEye className="h-5 w-5 shrink-0 text-[#fbd38d]" aria-hidden="true" />
        <label htmlFor={`ask-cam-${cameraId ?? 'all'}`} className="sr-only">Kameradan so'rang</label>
        <input id={`ask-cam-${cameraId ?? 'all'}`} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
        <button type="submit" disabled={q.trim().length < 2 || busy} aria-label="So'rash" className="flex h-11 w-11 items-center justify-center rounded-xl text-[#07080b] disabled:opacity-40" style={{ background: ACCENT }}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-5 w-5" aria-hidden="true" />}
        </button>
      </form>
      {busy && <p className="flex items-center gap-2 text-[13px] text-[#a3a9b5]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Kuzatuvchi kadrga qarayapti…</p>}
      {answers && (
        <ul className="flex flex-col gap-2">
          {answers.map(a => (
            <li key={a.cameraId} className="animate-rise rounded-2xl border border-[#f5b454]/20 bg-[#f5b454]/[0.05] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#fbd38d]">{a.name}</p>
              <p className="mt-1 text-[14.5px] leading-relaxed text-[#e4e3de]">{a.answer}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Findings({ s }: { s: CameraSummary | null | undefined }) {
  return s?.findings.length ? (
    <ul className="flex flex-col gap-2">
      {s.findings.map((f, i) => (
        <li key={i} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[14px] leading-snug ${f.level === 'crit' ? 'bg-rose-400/[0.07] text-rose-200' : f.level === 'warn' ? 'bg-[#f5b454]/[0.07] text-[#fde2b0]' : 'bg-emerald-400/[0.06] text-emerald-200'}`}>
          {f.level === 'ok' ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}{f.text}
        </li>
      ))}
    </ul>
  ) : <Quiet>{s?.crm ? "Bugun kamera va DentaCRM o'rtasida farq yo'q." : "DentaCRM ulansa, kamera ko'rganini qabul va to'lovlar bilan solishtiradi."}</Quiet>;
}

function Stat({ label, value, hint, warn = false }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="order-2 text-[12px] leading-snug text-[#8a909c]">{label}{hint && <span className="block text-[#7d838f]">{hint}</span>}</dt>
      <dd className={`order-1 text-[20px] font-semibold tabular-nums ${warn ? 'text-[#fbd38d]' : 'text-[#f2f0ea]'}`}>{value}</dd>
    </div>
  );
}

/** Kreslolar bugun qancha band bo'ldi va kutish joyida qancha kutishyapti */
function Occupancy({ s }: { s: CameraSummary | null | undefined }) {
  const chairs = s?.chairUse ?? [], w = s?.waiting;
  if (!chairs.length && !w) return <Quiet>Kamerada kreslo yoki kutish joyini belgilasangiz, bu yerda kreslo bandligi va bemorlar qancha kutgani chiqadi.</Quiet>;
  return (
    <div className="flex flex-col gap-4">
      {chairs.length > 0 && (
        <ul className="flex flex-col gap-3.5">
          {chairs.map(c => (
            <li key={c.zoneId}>
              <div className="flex items-baseline gap-2 text-[14px] text-[#d9dbe1]">
                <span className="truncate">{c.name}</span><span className="truncate text-[12px] text-[#7d838f]">{c.cameraName}</span>
                <span className="ml-auto font-semibold tabular-nums text-[#f2f0ea]">{c.pct === null ? '—' : `${c.pct}%`}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-glass/[0.06]" role="img" aria-label={c.pct === null ? `${c.name}: hali hisoblanmadi` : `${c.name}: ${c.pct}% band`}>
                <div className="h-full rounded-full" style={{ width: `${c.pct ?? 0}%`, background: ACCENT }} />
              </div>
              <p className="mt-1 text-[12px] text-[#7d838f]">{c.pct === null ? 'Kamera hali yetarlicha kuzatmadi' : `${hoursMin(c.busyMin)} band · ${hoursMin(c.watchedMin)} kuzatildi`}</p>
            </li>
          ))}
        </ul>
      )}
      {w && (
        <dl className={`grid grid-cols-3 gap-3 ${chairs.length ? 'border-t border-glass/[0.06] pt-4' : ''}`}>
          <Stat label="Hozir kutyapti" value={w.nowWaiting ? `${w.nowWaiting} kishi` : "hech kim"} hint={w.nowWaiting ? `eng uzog'i ${hoursMin(w.nowLongestMin)}` : undefined} warn={w.nowWaiting > 0 && w.nowLongestMin >= w.alertMin} />
          <Stat label="O'rtacha kutish" value={w.count ? hoursMin(w.avgMin) : '—'} hint={`bugun ${w.count} kishi kutdi`} />
          <Stat label="Eng uzoq kutish" value={w.count ? hoursMin(w.maxMin) : '—'} hint={w.longCount ? `${w.longCount} kishi ${w.alertMin} daqiqadan ko'p` : undefined} warn={w.longCount > 0} />
        </dl>
      )}
    </div>
  );
}

/** Xodim joylari: kim qachon keldi, ketdi va qancha joyida bo'ldi (kamera kimligini bilmaydi — joy nomi bo'yicha) */
function Staff({ list }: { list: Attendance[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {list.map(a => (
        <li key={a.zoneId} className="flex flex-col gap-1 border-b border-glass/[0.04] pb-3 last:border-0 last:pb-0">
          <div className="flex items-center gap-2 text-[14px] text-[#f2f0ea]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${a.here ? 'bg-emerald-400' : 'bg-glass/30'}`} aria-hidden="true" />
            <span className="truncate font-medium">{a.name}</span>
            <span className="truncate text-[12px] text-[#7d838f]">{a.cameraName}</span>
            <span className="ml-auto shrink-0 text-[12px] text-[#a3a9b5]">{a.here ? 'joyida' : a.firstAt ? 'ketgan' : 'kelmagan'}</span>
          </div>
          <p className="text-[12.5px] tabular-nums text-[#a3a9b5]">
            {a.firstAt ? `Keldi ${clock(a.firstAt)} · ${a.here || !a.lastAt ? 'hozir ham joyida' : `ketdi ${clock(a.lastAt)}`} · joyida ${hoursMin(a.presentMin)}` : "Bugun hali joyida ko'rinmadi"}
          </p>
          {a.longestAway && <p className="text-[12px] tabular-nums text-[#8a909c]">Eng uzoq yo'qligi: {clock(a.longestAway.from)}–{clock(a.longestAway.to)} ({hoursMin(a.longestAway.min)})</p>}
        </li>
      ))}
    </ul>
  );
}

export function WatchEmpty() {
  return (
    <section className="flex flex-col items-center gap-6 rounded-[28px] border border-glass/[0.07] bg-[#0b0c10] px-6 py-14 text-center">
      <AgentOrb member="kuzatuvchi" size={120} />
      <div className="max-w-xl">
        <h2 className="text-[26px] font-bold tracking-tight text-[#f2f0ea]">Kuzatuvchi hali hech narsani ko'rmayapti</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[#a3a9b5]">Kamerani ulasangiz: kreslo va kassa oldidagi odamlarni sanaydi, DentaCRM bilan solishtiradi, siz bergan topshiriqlarni bajaradi («kechasi odam ko'rinsa xabar ber») va «hozir qabulxonada kim bor?» kabi savolga kadrga qarab javob beradi.</p>
      </div>
      <ol className="grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
        {['Kamera qo‘shing — IP kamera yoki shu kompyuter kamerasi', 'Kameraga tavsif yozing: nimaga qaraydi, kim turadi', 'Topshiriq bering — natija Telegram’ga va jurnalga'].map((s, i) => (
          <li key={s} className="rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4"><span className="tabular-nums text-[12px] text-[#fbd38d]">0{i + 1}</span><p className="mt-1.5 text-[14px] leading-snug text-[#d9dbe1]">{s}</p></li>
        ))}
      </ol>
      <a href={hrefOf('kuzatuvchi', 'ulash')} className="flex min-h-12 items-center rounded-2xl bg-[#f5b454] px-6 text-[15px] font-semibold text-[#07080b] no-underline">Kamera ulash</a>
    </section>
  );
}

/** «Hozir»: kameralar devori, kameradan so'rang, bugungi topilmalar va hodisalar */
export function WatchNow({ data, notify, tick }: { data: WatchData | null; notify: Notify; tick: number }) {
  const live = useLiveCounts(!!data?.cameras.length);
  if (data && !data.cameras.length) return <WatchEmpty />;
  const s = data?.summary;
  const today = s?.sessions.filter(x => x.kind !== 'waiting').sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 8) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <AskCamera notify={notify} placeholder="Kameralardan so'rang: «Hozir qabulxonada nechta odam bor?»" />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.cameras.map(c => <Live key={c.id} cam={c} people={live[c.id]?.people} onOpen={() => { window.location.hash = hrefOf('kuzatuvchi', `kamera-${c.id}`); }} />)}
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="Hodisalar" action={<a href={hrefOf('kuzatuvchi', 'jurnal')} className="text-[13px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">Jurnal →</a>}>
            <div className="max-h-[420px] overflow-y-auto pr-1"><AgentJournal member="kuzatuvchi" notify={notify} tick={tick} empty="Hali hodisa yo'q. «Topshiriqlar»da yozing — masalan, kechasi odam ko'rinsa xabar bersin." /></div>
          </Panel>
          <Panel title="DentaCRM bilan solishtirish"><Findings s={s} /></Panel>
          <Panel title="Kreslo va kutish"><Occupancy s={s} /></Panel>
          {s?.attendance?.length ? <Panel title="Xodimlar"><Staff list={s.attendance} /></Panel> : null}
        </div>
      </div>
      <Panel title="Bugun kuzatilgan">
        {today.length ? (
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {today.map(x => (
              <li key={x.id} className="flex items-center gap-3 border-b border-glass/[0.04] py-2 text-[14px] text-[#d9dbe1]">
                <span className="w-24 shrink-0 tabular-nums text-[12px] text-[#7d838f]">{clock(x.startedAt)}–{x.endedAt ? clock(x.endedAt) : 'hozir'}</span>
                <span className="truncate">{x.zoneName}</span>
                {!x.endedAt && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" aria-label="hozir band" />}
              </li>
            ))}
          </ul>
        ) : <Quiet>Bugun hali hech kim kreslo yoki kassa oldida bo'lmadi.</Quiet>}
      </Panel>
    </div>
  );
}

/** Kamera tavsifi — egasi yozadi; har topshiriq va savolda AI shuni o'qiydi */
function Profile({ cam, notify, onSaved }: { cam: Camera; notify: Notify; onSaved: (c: Camera) => void }) {
  const [text, setText] = useState(cam.profile ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(cam.profile ?? ''); }, [cam.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = text.trim() !== (cam.profile ?? '').trim();
  const save = async () => {
    setBusy(true);
    try { onSaved((await api.setCameraProfile(cam.id, text.trim())).camera); notify('Tavsif saqlandi'); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Panel title="Bu kamera nimaga qaraydi">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={600} aria-label="Kamera tavsifi"
        placeholder="Masalan: Qabulxona va kassa. Ish vaqti 9:00–20:00, kassada administrator Dilnoza turadi. Kechasi hech kim bo'lmasligi kerak."
        className="w-full resize-none rounded-xl border border-glass/10 bg-glass/[0.03] px-3 py-2.5 text-[14px] leading-relaxed text-[#f2f0ea] outline-none placeholder:text-[#7d838f] focus:border-glass/25" />
      <div className="mt-2 flex items-center gap-3">
        <p className="mr-auto text-[12px] text-[#7d838f]">Topshiriq va savollarda Kuzatuvchi shuni biladi.</p>
        <button type="button" disabled={!dirty || busy} onClick={() => { void save(); }} className="flex min-h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-40" style={{ background: ACCENT }}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Saqlash
        </button>
      </div>
    </Panel>
  );
}

/** «Kameralar»: chapda ro'yxat, o'ngda tanlangan kameraning sahifasi */
export function WatchCameras({ data, selected, notify, tick }: { data: WatchData | null; selected: string | null; notify: Notify; tick: number }) {
  const live = useLiveCounts(!!data?.cameras.length);
  const [cams, setCams] = useState<Camera[]>([]);
  useEffect(() => { if (data) setCams(data.cameras); }, [data]);
  if (data && !data.cameras.length) return <WatchEmpty />;
  const cam = cams.find(c => c.id === selected) ?? cams[0];
  if (!cam) return <Loader2 className="h-6 w-6 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Kameralar" className="flex flex-col gap-1.5">
        {cams.map(c => {
          const on = c.id === cam.id, online = !!c.lastSeenAt && Date.now() - Date.parse(c.lastSeenAt) < 60_000;
          return (
            <a key={c.id} href={hrefOf('kuzatuvchi', `kamera-${c.id}`)} aria-current={on ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 no-underline transition-colors ${on ? 'border-[#f5b454]/35 bg-[#f5b454]/[0.07]' : 'border-glass/[0.06] hover:bg-glass/[0.03]'}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-glass/30'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-[#f2f0ea]">{c.name}</span>
                <span className="block truncate text-[12px] text-[#7d838f]">{c.profile ? c.profile : 'tavsif yozilmagan'}</span>
              </span>
              {live[c.id] && <span className="flex items-center gap-1 text-[12px] tabular-nums text-[#d9dbe1]"><Users className="h-3.5 w-3.5" aria-hidden="true" />{live[c.id].people}</span>}
            </a>
          );
        })}
        <a href={hrefOf('kuzatuvchi', 'ulash')} className="mt-1 rounded-2xl border border-dashed border-glass/10 px-3.5 py-3 text-center text-[13px] text-[#a3a9b5] no-underline hover:bg-glass/[0.03]">+ Kamera qo'shish</a>
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Live cam={cam} people={live[cam.id]?.people} big />
          <div className="flex flex-col gap-5">
            <Profile cam={cam} notify={notify} onSaved={c => setCams(list => list.map(x => (x.id === c.id ? { ...x, profile: c.profile } : x)))} />
            {cam.zones.length > 0 && (
              <Panel title="Belgilangan joylar">
                <ul className="flex flex-wrap gap-2">{cam.zones.map(z => <li key={z.id} className="rounded-full border border-glass/10 px-3 py-1 text-[13px] text-[#d9dbe1]">{ZONE_KIND[z.kind]} · {z.name}</li>)}</ul>
              </Panel>
            )}
          </div>
        </div>
        <AskCamera cameraId={cam.id} notify={notify} placeholder={`«${cam.name}»dan so'rang: «Hozir u yerda nima bo'lyapti?»`} />
        <div className="flex flex-col gap-5">
          <OrdersPanel member="kuzatuvchi" notify={notify} cameras={cams} cameraId={cam.id} />
          <Panel title={`Jurnal · ${cam.name}`}><AgentJournal member="kuzatuvchi" notify={notify} cameraId={cam.id} tick={tick} empty="Bu kamerada hali hodisa yo'q." /></Panel>
        </div>
      </div>
    </div>
  );
}
