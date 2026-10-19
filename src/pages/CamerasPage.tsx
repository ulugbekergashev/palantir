import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Loader2, Radar, RefreshCw, Trash2, Video, Wifi } from 'lucide-react';
import type { Camera, CameraFeed, CameraTiming, CameraZone, FoundCamera, ZoneKind, ZoneNow } from '../types';
import { ZONE_BORDER, ZONE_KIND } from '../lib/zones';
import { loadPersonDetector, type PersonBox } from '../lib/personDetector';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, inputClass } from '../components/ui';

type Draft = Omit<CameraZone, 'id'> & { id?: string };
const KIND = ZONE_KIND;
const FEED: Record<CameraFeed['state'], { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'kadr kelyapti' },
  connecting: { dot: 'bg-amber-500', text: 'ulanmoqda…' },
  error: { dot: 'bg-rose-500', text: 'kadr kelmayapti' },
};
const RTSP_SAMPLE = 'rtsp://admin:parol@192.168.1.64:554/Streaming/Channels/102';
const box = (z: { x: number; y: number; w: number; h: number }) => ({ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` });

/** Kamera nomi — u qayerda turgani: shu nom bilan jurnal va topshiriqlarda ko'rinadi */
const PLACES = ['Qabulxona', '1-kabinet', '2-kabinet', '3-kabinet', 'Kirish eshigi', 'Kassa', 'Kutish zali'];

function Block({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0"><h3 className="text-[16px] font-semibold text-[#f2f0ea]">{title}</h3><p className="mt-0.5 max-w-2xl text-[13px] leading-snug text-[#8a909c]">{hint}</p></div>
        {action}
      </header>
      {children}
    </section>
  );
}
const field = 'h-11 w-full rounded-xl border border-glass/10 bg-glass/[0.03] px-3 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6b717c] focus:border-glass/25';
const label = 'flex flex-col gap-1.5 text-[12px] font-medium text-[#a3a9b5]';

/**
 * Kuzatuvchi → Ulash: kamera qo'shish va zonalarni chizish. Ikki yo'l:
 *   IP kamera (devordagi, klinika uchun) — tarmoqdan qidirib yoki RTSP manzil bilan; kadrni server oladi, kechayu kunduz ishlaydi;
 *   shu kompyuter kamerasi — faqat sinash uchun: odamlarni brauzer sanaydi, sahifa ochiq turgandagina.
 * Kunlik hisob va hodisalar — «Hozir» varag'ida.
 */
export function CamerasPage({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Camera[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [timing, setTiming] = useState<CameraTiming | null>(null);
  const [found, setFound] = useState<FoundCamera[] | null>(null);
  const [ffmpeg, setFfmpeg] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cred, setCred] = useState({ login: 'admin', password: '' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({ name: '', url: '' });
  const [local, setLocal] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => api.cameras().then(c => { setList(c.cameras); setTiming(c.timing); }).catch(fail);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const placeFor = (i: number) => PLACES[(list?.length ?? 0) + i] ?? `${(list?.length ?? 0) + i + 1}-kamera`;
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); } catch (e) { fail(e); } finally { setBusy(null); } };
  const scan = () => act('scan', async () => {
    setScanning(true);
    try {
      const r = await api.discoverCameras();
      setFound(r.found);
      setFfmpeg(r.ffmpeg);
      setNames(Object.fromEntries(r.found.filter(c => !c.connected).map((c, i) => [c.ip, placeFor(i)])));
    } finally { setScanning(false); }
  });
  const connect = (c: FoundCamera) => act(c.ip, async () => {
    const r = await api.connectCamera({ ip: c.ip, port: c.rtspPort, brand: c.brand, onvif: c.onvif, login: cred.login, password: cred.password, name: names[c.ip] || placeFor(0) });
    setFound(f => f?.map(x => (x.ip === c.ip ? { ...x, connected: true } : x)) ?? null);
    setPicked(r.camera.id);
    await load();
    notify(`${r.camera.name} ulandi — endi kreslo va kassani belgilang`);
  });
  /** RTSP manzil bilan: kamera yaratiladi va manzil ulanadi; ulanmasa — kamera o'chiriladi (yarim qolmasin) */
  const connectUrl = () => act('url', async () => {
    const name = manual.name.trim() || placeFor(0);
    const id = (await api.addCamera(name)).camera.id;
    try { await api.setCameraStream(id, manual.url.trim()); } catch (e) { await api.removeCamera(id).catch(() => {}); throw e; }
    setManual({ name: '', url: '' });
    setPicked(id);
    await load();
    notify(`${name} ulandi`);
  });
  const addLocal = () => act('local', async () => {
    const r = await api.addCamera(local.trim() || 'Shu kompyuter');
    setLocal('');
    setPicked(r.camera.id);
    await load();
  });
  const camera = list?.find(c => c.id === picked) ?? null;

  if (!list) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  return (
    <div className="flex flex-col gap-5">
      {!ffmpeg && <p role="alert" className="rounded-2xl bg-[#f5b454]/10 px-4 py-3 text-[14px] text-[#fde2b0]">Bu kompyuterda ffmpeg yo'q — IP kameralar ishlamaydi. O'rnating: <code>winget install Gyan.FFmpeg</code>, keyin Cerebro'ni qayta ishga tushiring.</p>}

      {list.length > 0 && (
        <Block title={`Kameralar · ${list.length}`} hint="Kamerani tanlang — kadr ustida kreslo va kassa stolini belgilaysiz. Kuzatuvchi aynan shu joylarni sanaydi.">
          <div className="flex flex-wrap gap-2">
            {list.map(c => (
              <button key={c.id} type="button" onClick={() => setPicked(p => (p === c.id ? null : c.id))} aria-pressed={c.id === picked}
                className={`flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-[14px] transition-colors ${c.id === picked ? 'border-[#f5b454]/40 bg-[#f5b454]/[0.08] text-[#f2f0ea]' : 'border-glass/10 text-[#d9dbe1] hover:bg-glass/5'}`}>
                {c.ip ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <Video className="h-4 w-4" aria-hidden="true" />}{c.name}
                {c.feed && <span className={`h-2 w-2 rounded-full ${FEED[c.feed.state].dot}`} aria-label={FEED[c.feed.state].text} />}
                {!c.ip && <span className="text-[11px] text-[#7d838f]">kompyuter</span>}
              </button>
            ))}
          </div>
          {camera && <ZoneEditor key={`${camera.id}|${camera.ip ?? ''}`} camera={camera} timing={timing} notify={notify} onSaved={load} onRemoved={() => { setPicked(null); void load(); }} />}
        </Block>
      )}

      <Block title="IP kamera qo'shish (klinika uchun)" hint="Devordagi kamera yoki videoregistrator — shu kompyuter bilan bitta tarmoqda. Kadrni server o'zi oladi: kechayu kunduz ishlaydi, «Kameradan so'rang» va AI ko'zi ham ishlaydi."
        action={(
          <button type="button" onClick={() => { void scan(); }} disabled={!!busy} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#f5b454] px-4 text-[14px] font-semibold text-[#07080b] disabled:opacity-50">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Radar className="h-4 w-4" aria-hidden="true" />}{found ? 'Qayta qidirish' : 'Tarmoqdan qidirish'}
          </button>
        )}>
        {scanning && <p className="mb-3 flex items-center gap-2 text-[13px] text-[#a3a9b5]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />ONVIF so'rovi va 554-port tekshirilmoqda — bir necha soniya…</p>}
        {found && !scanning && (found.length === 0
          ? <p className="mb-4 rounded-xl border border-dashed border-glass/10 px-4 py-3 text-[13px] text-[#a3a9b5]">Tarmoqda kamera topilmadi. Kamera yoqilganmi va shu routerga ulanganmi? Bo'lmasa — pastda manzili bilan ulang.</p>
          : (
            <div className="mb-5 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>Kamera logini (hammasiga bir xil)<input className={field} value={cred.login} onChange={e => setCred({ ...cred, login: e.target.value })} autoComplete="off" /></label>
                <label className={label}>Kamera paroli<input className={field} type="password" value={cred.password} onChange={e => setCred({ ...cred, password: e.target.value })} autoComplete="off" /></label>
              </div>
              <ul className="flex flex-col gap-2">
                {found.map(c => (
                  <li key={c.ip} className="flex flex-wrap items-center gap-3 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] px-4 py-3">
                    <Video className="h-5 w-5 text-[#7d838f]" aria-hidden="true" />
                    <div className="min-w-40 flex-1">
                      <p className="text-[14px] font-semibold text-[#f2f0ea]">{c.brand || "Noma'lum marka"} · <span className="tabular-nums">{c.ip}</span></p>
                      <p className="text-[12px] text-[#7d838f]">{c.model || (c.onvif ? 'ONVIF' : `faqat RTSP porti ${c.rtspPort}`)}</p>
                    </div>
                    {c.connected ? <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-300">Ulangan</span> : (
                      <>
                        <input className={`${field} w-40`} aria-label="Qayerda turibdi" value={names[c.ip] ?? ''} onChange={e => setNames({ ...names, [c.ip]: e.target.value })} list="camera-places" />
                        <button type="button" onClick={() => { void connect(c); }} disabled={!!busy} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#f2f0ea] px-4 text-[14px] font-semibold text-[#07080b] disabled:opacity-50">
                          {busy === c.ip && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Ulash
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        <datalist id="camera-places">{PLACES.map(p => <option key={p} value={p} />)}</datalist>
        <form onSubmit={e => { e.preventDefault(); if (manual.url.trim()) void connectUrl(); }} className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end">
          <label className={label}>Qayerda turibdi<input className={field} value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} placeholder={placeFor(0)} maxLength={40} list="camera-places" /></label>
          <label className={label}>Yoki RTSP manzil (login va paroli bilan)<input className={field} value={manual.url} onChange={e => setManual({ ...manual, url: e.target.value })} placeholder={RTSP_SAMPLE} autoComplete="off" spellCheck={false} maxLength={300} /></label>
          <button type="submit" disabled={!!busy || !manual.url.trim()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f2f0ea] px-5 text-[14px] font-semibold text-[#07080b] disabled:opacity-40">
            {busy === 'url' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wifi className="h-4 w-4" aria-hidden="true" />}Ulash
          </button>
          <p className="text-[12px] text-[#7d838f] sm:col-span-3">Yengil oqimni oling — Hikvision'da oxiri <code>102</code>, Dahua'da <code>subtype=1</code>. Manzil shifrlab saqlanadi.</p>
        </form>
      </Block>

      <Block title="Shu kompyuter kamerasi (faqat sinash uchun)" hint="Odamlarni brauzer sanaydi — bu sahifa ochiq turgandagina. Kadr serverga bormaydi: «Kameradan so'rang» va AI ko'zi bu kamerada ishlamaydi.">
        <form onSubmit={e => { e.preventDefault(); void addLocal(); }} className="flex flex-wrap gap-2">
          <input className={`${field} max-w-xs`} value={local} onChange={e => setLocal(e.target.value)} maxLength={40} placeholder="Shu kompyuter" aria-label="Kompyuter kamerasi nomi" />
          <button type="submit" disabled={!!busy} className="flex min-h-11 items-center gap-2 rounded-xl border border-glass/10 px-4 text-[14px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50"><Video className="h-4 w-4" aria-hidden="true" />Qo'shish</button>
        </form>
      </Block>
    </div>
  );
}

/**
 * Kamera tasviri ustida zonalarni sichqoncha bilan chizish. Ikki xil kamera:
 *   IP kamera (devordagi) — tasvir serverdan kadr bo'lib keladi, odamlarni server o'zi sanaydi (sahifa ochiq turishi shart emas);
 *   shu kompyuter kamerasi — tasvir brauzerda, sanash ham shu sahifada (sahifa ochiq turganda).
 */
/** Kadrlar orasidagi tanaffus; ketma-ket shuncha xato bo'lsa sanash to'xtaydi */
const FRAME_MS = 600, MAX_MISSES = 5;
const NOW: Record<ZoneNow, string> = { empty: "bo'sh", entering: 'kiryapti…', open: "o'tiribdi" };

function ZoneEditor({ camera, timing, notify, onSaved, onRemoved }: { camera: Camera; timing: CameraTiming | null; notify: Notify; onSaved: () => unknown; onRemoved: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [zones, setZones] = useState<Draft[]>(camera.zones);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Sanash: off — o'chiq; loading — odam topuvchi yuklanmoqda; on — har kadrda odamlar topilib, serverga joyi yuboriladi
  const [counting, setCounting] = useState<'off' | 'loading' | 'on'>('off');
  const [seen, setSeen] = useState<{ people: PersonBox[]; zones: Record<string, ZoneNow> } | null>(null);
  const [ready, setReady] = useState(false);
  // IP kamera: serverdan olingan kadr (vaqtinchalik manzil), ulash formasi
  const [shot, setShot] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [linking, setLinking] = useState(false);
  const isIp = !!camera.ip;
  const running = useRef(false);
  // Sahifadan chiqilganda yoki boshqa kamera tanlanganda false bo'ladi: kechikib tugagan so'rov sanashni qayta yoqib yubormasin
  const alive = useRef(true);
  const fail = (e: unknown) => { if (alive.current) notify((e as Error).message, true); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; running.current = false; }; }, []);

  const count = async () => {
    setCounting('loading');
    try {
      // Sanash saqlangan zonalar bo'yicha ketadi — avval ekrandagi zonalar saqlanadi
      const saved = await api.saveZones(camera.id, zones);
      if (!alive.current) return;
      setZones(saved.camera.zones);
      const detector = await loadPersonDetector();
      if (!alive.current) return;
      running.current = true;
      setCounting('on');
      let before = '', misses = 0;
      while (running.current && alive.current) {
        const v = video.current;
        try {
          if (v && v.readyState >= 2) {
            const people = await detector.detect(v);
            const r = await api.observe(camera.id, people);
            if (!running.current || !alive.current) break;
            misses = 0;
            setSeen({ people, zones: r.zones });
            // Seans boshlanganda yoki tugaganda yuqoridagi hisob darhol yangilanadi
            const now = JSON.stringify(r.zones);
            if (now !== before) { before = now; void onSaved(); }
          }
        } catch (e) {
          // Bitta uzilgan so'rov sanashni to'xtatmaydi; ketma-ket bir nechtasi — to'xtatadi
          misses += 1;
          if (misses >= MAX_MISSES) throw e;
        }
        await new Promise(done => setTimeout(done, FRAME_MS));
      }
    } catch (e) {
      fail(e);
    }
    running.current = false;
    if (!alive.current) return;
    setCounting('off');
    setSeen(null);
  };

  const loadShot = () => api.cameraSnapshot(camera.id).then(blob => {
    if (!alive.current) return;
    setProblem(null);
    setShot(old => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
  }).catch(e => { if (alive.current) setProblem(`${(e as Error).message} Zonalarni baribir chizishingiz mumkin.`); });
  useEffect(() => {
    if (isIp) void loadShot();
    return () => setShot(old => { if (old) URL.revokeObjectURL(old); return null; });
  }, []);

  const link = (url: string) => {
    setLinking(true);
    api.setCameraStream(camera.id, url).then(() => { notify(url ? 'IP kamera ulandi' : 'IP kamera uzildi'); return onSaved(); }).catch(fail).finally(() => { if (alive.current) setLinking(false); });
  };

  useEffect(() => {
    if (isIp) return;
    let stream: MediaStream | null = null, gone = false;
    const noCamera = () => setProblem("Kameraga ruxsat berilmadi yoki bu kompyuterda kamera yo'q. Devordagi (IP) kamerani pastda manzili bilan ulang; zonalarni baribir chizishingiz mumkin.");
    if (!navigator.mediaDevices) { noCamera(); return; }
    navigator.mediaDevices.getUserMedia({ video: true }).then(s => {
      if (gone) return s.getTracks().forEach(t => t.stop());
      stream = s;
      if (video.current) video.current.srcObject = s;
    }).catch(noCamera);
    return () => { gone = true; stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rect = (d: NonNullable<typeof drag>) => ({ x: Math.min(d.x0, d.x), y: Math.min(d.y0, d.y), w: Math.abs(d.x - d.x0), h: Math.abs(d.y - d.y0) });
  const finish = () => {
    if (!drag) return;
    const r = rect(drag);
    setDrag(null);
    if (r.w < 0.04 || r.h < 0.04) return;
    if (zones.length >= 8) return notify("Bitta kamerada ko'pi bilan 8 ta zona", true);
    setZones([...zones, { ...r, kind: 'chair', name: `Kreslo ${zones.filter(z => z.kind === 'chair').length + 1}`, doctorId: null }]);
  };
  const patch = (i: number, p: Partial<Draft>) => setZones(zones.map((z, j) => (j === i ? { ...z, ...p } : z)));
  const save = () => api.saveZones(camera.id, zones).then(r => { setZones(r.camera.zones); notify('Zonalar saqlandi'); return onSaved(); }).catch(fail);
  const remove = () => { if (window.confirm(`«${camera.name}» kamerasi va uning seanslari o'chirilsinmi?`)) api.removeCamera(camera.id).then(onRemoved).catch(fail); };

  return (
    <div className="mt-4 space-y-3">
      {problem && <p role="alert" className="rounded-xl bg-[#f5b454]/10 p-3 text-sm text-[#fde2b0]">{problem}</p>}
      {isIp && camera.feed && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${FEED[camera.feed.state].dot}`} />
          <span className="font-semibold">IP kamera {camera.ip}: {FEED[camera.feed.state].text}</span>
          {camera.feed.message && <span className="text-slate-500">— {camera.feed.message}</span>}
          <span className="text-slate-500">Odamlarni server o'zi sanaydi — bu sahifa ochiq turishi shart emas.</span>
        </p>
      )}
      {counting === 'on' && <p role="status" className="text-sm font-semibold text-emerald-300">Sanash yoqilgan: topilgan odamlar oq ramkada, zona holati uning yorlig'ida.</p>}
      <div className="relative mx-auto max-w-3xl touch-none select-none overflow-hidden rounded-xl bg-[#06070a]" onPointerDown={e => { if (counting !== 'off') return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x0: p.x, y0: p.y, ...p }); }}
        onPointerMove={e => { if (drag) setDrag({ ...drag, ...at(e) }); }} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
{isIp
          ? shot ? <img src={shot} alt={`${camera.name} kamerasi kadri`} draggable={false} className="block min-h-40 w-full" /> : <div className="flex min-h-40 items-center justify-center text-sm text-[#7d838f]">Kadr olinmoqda…</div>
          : <video ref={video} autoPlay muted playsInline onLoadedData={() => setReady(true)} aria-label={`${camera.name} kamerasi tasviri`} className="block min-h-40 w-full" />}
        {zones.map((z, i) => <div key={i} className={`absolute border-2 ${ZONE_BORDER[z.kind]}`} style={box(z)}><span className="bg-black/70 px-1 text-xs font-semibold text-white">{z.name}{seen && z.id && seen.zones[z.id] ? ` · ${NOW[seen.zones[z.id]]}` : ''}</span></div>)}
        {seen?.people.map((p, i) => <div key={`p${i}`} className="absolute border-2 border-dashed border-white/90" style={box(p)} />)}
        {drag && <div className="absolute border-2 border-dashed border-white" style={box(rect(drag))} />}
      </div>
      <p className="text-sm text-slate-500">Kreslo yoki kassa stoli ustidan sichqoncha bilan to'rtburchak torting.{timing ? ` Sanash qoidasi: zonada ${timing.enterSec} soniya tursa — seans boshlanadi, ${timing.leaveSec} soniya ko'rinmasa — tugaydi; ${timing.minSessionSec} soniyadan qisqa o'tirish bemor deb sanalmaydi.` : ''}</p>
      {zones.map((z, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select className={inputClass} disabled={counting !== 'off'} value={z.kind} onChange={e => patch(i, { kind: e.target.value as ZoneKind })} aria-label="Zona turi">
            {(Object.keys(KIND) as ZoneKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}
          </select>
          <input className={inputClass} disabled={counting !== 'off'} value={z.name} maxLength={40} onChange={e => patch(i, { name: e.target.value })} aria-label="Zona nomi" />
          {z.kind === 'chair' ? <input className={inputClass} disabled={counting !== 'off'} value={z.doctorId ?? ''} maxLength={60} onChange={e => patch(i, { doctorId: e.target.value || null })} placeholder="Shifokor id (DentaCRM)" aria-label="Shifokor id" /> : <span className="hidden sm:block" />}
          <Button size="sm" variant="ghost" disabled={counting !== 'off'} onClick={() => setZones(zones.filter((_, j) => j !== i))} aria-label={`${z.name} zonasini o'chirish`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={counting !== 'off' || zones.some(z => !z.name.trim())}>Zonalarni saqlash</Button>
        {isIp ? (
          <>
            <Button onClick={() => void loadShot()}><RefreshCw className="h-4 w-4" /> Kadrni yangilash</Button>
            <Button onClick={() => { if (window.confirm('IP kamera uzilsinmi? Zonalar qoladi.')) link(''); }} disabled={linking}>IP kamerani uzish</Button>
          </>
        ) : counting === 'on'
          ? <Button onClick={() => { running.current = false; }}>Sanashni to'xtatish</Button>
          : <Button onClick={() => void count()} disabled={counting === 'loading' || !zones.length || zones.some(z => !z.name.trim()) || !!problem || !ready}>{counting === 'loading' ? 'Yuklanmoqda…' : 'Shu kamera bilan sanash'}</Button>}
        <Button variant="danger" onClick={remove} disabled={counting !== 'off'}>Kamerani o'chirish</Button>
      </div>
      {!isIp && counting === 'off' && (
        <form className="space-y-2 rounded-xl border border-slate-200 p-3" onSubmit={e => { e.preventDefault(); if (address.trim()) link(address.trim()); }}>
          <label htmlFor={`rtsp-${camera.id}`} className="block text-sm font-semibold">IP kamera yoki telefonni ulash</label>
          <div className="flex flex-wrap gap-2">
            <input id={`rtsp-${camera.id}`} className={`${inputClass} min-w-0 flex-1`} value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder={RTSP_SAMPLE} autoComplete="off" spellCheck={false} />
            <Button type="submit" disabled={linking || !address.trim()}>{linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Ulash</Button>
          </div>
          <p className="text-sm text-slate-500">Kamera yoki videoregistratorning RTSP manzili (login va paroli bilan). Yengil oqimni oling — Hikvision'da oxiri <code>102</code>, Dahua'da <code>subtype=1</code>. RTSP'siz kamera — HTTP manzili (MJPEG oqim yoki <code>…/snapshot.jpg</code>). Eski Android telefon ham kamera bo'ladi: «IP Webcam» ilovasini o'rnatib, «Start server» bosing va <code>http://telefon-IP:8080/video</code> ni yozing. Ulangach odamlarni server o'zi, kechayu kunduz sanaydi; manzil shifrlab saqlanadi.</p>
        </form>
      )}
    </div>
  );
}
