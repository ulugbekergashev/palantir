/**
 * Kuzatuvchi — «Kuzatuv» varag'i: kameralardan jonli kadr (IP kamera — 6 soniyada yangilanadi), kunlik hisob (kreslo, kassa,
 * DentaCRM bilan solishtirish), topilmalar va bugungi seanslar. Kamera yo'q bo'lsa — nima qilishi va qanday ulanishi.
 */
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Video } from 'lucide-react';
import type { Camera, CameraSummary } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentOrb, Panel, Quiet, clock } from '../../components/agent';
import { hrefOf } from '../../lib/nav';

const SNAPSHOT_MS = 6_000;

export interface WatchData { cameras: Camera[]; summary: CameraSummary | null }

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

/** IP kameraning oxirgi kadri; brauzer kamerasida kadr serverda yo'q — belgisi */
function Live({ cam }: { cam: Camera }) {
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
  return (
    <figure className="relative m-0 overflow-hidden rounded-2xl border border-glass/[0.07] bg-[#06070a]">
      {src ? <img src={src} alt={`${cam.name} — jonli kadr`} className="aspect-video w-full object-cover" />
        : <div className="flex aspect-video w-full items-center justify-center text-[#7d838f]"><Video className="h-8 w-8" aria-hidden="true" /></div>}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-[13px] text-[#f2f0ea]">
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-glass/30'}`} aria-hidden="true" />{cam.name}
        <span className="ml-auto text-[11px] text-[#a3a9b5]">{online ? 'jonli' : cam.lastSeenAt ? `oxirgi kadr ${clock(cam.lastSeenAt)}` : 'hali kadr yo‘q'}</span>
      </figcaption>
    </figure>
  );
}

export function WatchToday({ data }: { data: WatchData | null }) {
  if (data && !data.cameras.length) {
    return (
      <section className="flex flex-col items-center gap-6 rounded-[28px] border border-glass/[0.07] bg-[#0b0c10] px-6 py-14 text-center">
        <AgentOrb member="kuzatuvchi" size={120} />
        <div className="max-w-xl">
          <h2 className="text-[26px] font-bold tracking-tight text-[#f2f0ea]">Kuzatuvchi hali hech narsani ko'rmayapti</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#a3a9b5]">Kamerani ulasangiz, u kreslolarda nechta bemor o'tirganini va kassa oldiga kim kelganini sanaydi, keyin DentaCRM'dagi qabullar bilan solishtiradi: yozilmagan bemor yoki to'lanmagan qabul bo'lsa — sizga aytadi.</p>
        </div>
        <ol className="grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
          {['Kamera qo‘shing — IP kamera manzili yoki shu kompyuter kamerasi', 'Kadrda kreslo va kassa joyini belgilang', 'Hisob shu yerda va ertalabki xulosada'].map((s, i) => (
            <li key={s} className="rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4"><span className="tabular-nums text-[12px] text-[#fbd38d]">0{i + 1}</span><p className="mt-1.5 text-[14px] leading-snug text-[#d9dbe1]">{s}</p></li>
          ))}
        </ol>
        <a href={hrefOf('kuzatuvchi', 'sozlash')} className="flex min-h-12 items-center rounded-2xl bg-[#f5b454] px-6 text-[15px] font-semibold text-[#07080b] no-underline">Kamera ulash</a>
      </section>
    );
  }
  const s = data?.summary;
  const today = s?.sessions.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 10) ?? [];
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-4 sm:grid-cols-2">{data?.cameras.map(c => <Live key={c.id} cam={c} />)}</div>
      <div className="flex flex-col gap-5">
        <Panel title="Topilmalar">
          {s?.findings.length ? (
            <ul className="flex flex-col gap-2">
              {s.findings.map((f, i) => (
                <li key={i} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[14px] leading-snug ${f.level === 'crit' ? 'bg-rose-400/[0.07] text-rose-200' : f.level === 'warn' ? 'bg-[#f5b454]/[0.07] text-[#fde2b0]' : 'bg-emerald-400/[0.06] text-emerald-200'}`}>
                  {f.level === 'ok' ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}{f.text}
                </li>
              ))}
            </ul>
          ) : <Quiet>Bugun hech qanday nomuvofiqlik yo'q.</Quiet>}
        </Panel>
        <Panel title="Bugun kuzatilgan">
          {today.length ? (
            <ul className="flex flex-col">
              {today.map(x => (
                <li key={x.id} className="flex items-center gap-3 py-2 text-[14px] text-[#d9dbe1]">
                  <span className="w-24 shrink-0 tabular-nums text-[12px] text-[#7d838f]">{clock(x.startedAt)}–{x.endedAt ? clock(x.endedAt) : 'hozir'}</span>
                  <span className="truncate">{x.zoneName}</span>
                  {!x.endedAt && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" aria-label="hozir band" />}
                </li>
              ))}
            </ul>
          ) : <Quiet>Bugun hali hech kim kreslo yoki kassa oldida bo'lmadi.</Quiet>}
        </Panel>
      </div>
    </div>
  );
}
