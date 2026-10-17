import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Loader2, RefreshCw, Trash2, Video, Wifi } from 'lucide-react';
import type { Camera, CameraFeed, CameraSummary, CameraTiming, CameraZone, ZoneKind, ZoneNow } from '../types';
import { loadPersonDetector, type PersonBox } from '../lib/personDetector';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, PageHeader, inputClass } from '../components/ui';

type Draft = Omit<CameraZone, 'id'> & { id?: string };
const KIND: Record<ZoneKind, string> = { chair: 'Kreslo', desk: 'Kassa stoli' };
const LEVEL = { ok: 'bg-emerald-500', warn: 'bg-amber-500', crit: 'bg-rose-500' };
const FEED: Record<CameraFeed['state'], { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'kadr kelyapti' },
  connecting: { dot: 'bg-amber-500', text: 'ulanmoqda…' },
  error: { dot: 'bg-rose-500', text: 'kadr kelmayapti' },
};
const RTSP_SAMPLE = 'rtsp://admin:parol@192.168.1.64:554/Streaming/Channels/102';
const clock = (isoTime: string) => new Date(isoTime).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });
const box = (z: { x: number; y: number; w: number; h: number }) => ({ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` });

/** Kameralar: kunlik hisob (kamera ko'rgani va CRM), kameralar ro'yxati va zonalarni chizish */
export function CamerasPage({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Camera[] | null>(null);
  const [summary, setSummary] = useState<CameraSummary | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [timing, setTiming] = useState<CameraTiming | null>(null);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => Promise.all([api.cameras(), api.cameraSummary()]).then(([c, s]) => { setList(c.cameras); setTiming(c.timing); setSummary(s.summary); }).catch(fail);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, []);

  const add = () => api.addCamera(name.trim()).then(r => { setName(''); setPicked(r.camera.id); return load(); }).catch(fail);
  const camera = list?.find(c => c.id === picked) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="Kameralar" description="Kamera ko'rganini DentaCRM bilan solishtiradi: kresloda kim o'tirdi, kassa oldida kim turdi, qayerda farq bor." />

      {!summary || !list ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
        <>
          <Card title="Bugungi hisob" description={summary.crm ? "Kamera ko'rgani va DentaCRM yonma-yon" : "DentaCRM ulanmagan — hozircha faqat kamera ko'rgani"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Count n={summary.seated} label="bemor kresloga o'tirdi" crm={summary.crm && `CRM'da ${summary.crm.visits} ta «keldi»`} />
              <Count n={summary.deskVisits} label="kishi kassa oldida turdi" crm={summary.crm && `CRM'da ${summary.crm.payments} ta to'lov`} />
            </div>
            {summary.findings.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm">
                {summary.findings.map((f, i) => <li key={i} className="flex gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL[f.level]}`} />{f.text}</li>)}
              </ul>
            )}
            {summary.sessions.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 text-sm">
                {summary.sessions.map(s => <li key={s.id} className="flex justify-between gap-3 py-1.5"><span>{s.zoneName}</span><span className="tabular-nums text-slate-500">{clock(s.startedAt)} – {s.endedAt ? clock(s.endedAt) : 'hozir'}</span></li>)}
              </ul>
            )}
            {!summary.sessions.length && <p className="mt-4 text-sm text-slate-500">Bugun hali hech narsa ko'rilmadi. Kamera qo'shing va zonalarni belgilang — kadrlar kelishi bilan seanslar shu yerda paydo bo'ladi.</p>}
          </Card>

          <Card title="Kameralar" description="Har kamerada kreslo va kassa stolini belgilang: Cerebro aynan shu joylarni vaqtlaydi.">
            <div className="flex flex-wrap gap-2">
              {list.map(c => (
                <Button key={c.id} size="sm" variant={c.id === picked ? 'primary' : 'secondary'} onClick={() => setPicked(c.id)}>
                  {c.ip ? <Wifi className="h-4 w-4" /> : <Video className="h-4 w-4" />} {c.name}
                  {c.feed && <span className={`h-2 w-2 rounded-full ${FEED[c.feed.state].dot}`} aria-label={FEED[c.feed.state].text} />}
                </Button>
              ))}
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) void add(); }}>
                <input className={inputClass} value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Yangi kamera nomi" aria-label="Yangi kamera nomi" />
                <Button size="sm" type="submit" disabled={!name.trim()}>Qo'shish</Button>
              </form>
            </div>
            {camera && <ZoneEditor key={`${camera.id}|${camera.ip ?? ''}`} camera={camera} timing={timing} notify={notify} onSaved={load} onRemoved={() => { setPicked(null); void load(); }} />}
          </Card>
        </>
      )}
    </div>
  );
}

function Count({ n, label, crm }: { n: number; label: string; crm: string | null }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-3xl font-extrabold tabular-nums">{n}</div>
      <div className="font-semibold">{label}</div>
      {crm && <div className="text-sm text-slate-500">{crm}</div>}
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
      {problem && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{problem}</p>}
      {isIp && camera.feed && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${FEED[camera.feed.state].dot}`} />
          <span className="font-semibold">IP kamera {camera.ip}: {FEED[camera.feed.state].text}</span>
          {camera.feed.message && <span className="text-slate-500">— {camera.feed.message}</span>}
          <span className="text-slate-500">Odamlarni server o'zi sanaydi — bu sahifa ochiq turishi shart emas.</span>
        </p>
      )}
      {counting === 'on' && <p role="status" className="text-sm font-semibold text-emerald-700">Sanash yoqilgan: topilgan odamlar oq ramkada, zona holati uning yorlig'ida.</p>}
      <div className="relative touch-none select-none overflow-hidden rounded-xl bg-slate-900" onPointerDown={e => { if (counting !== 'off') return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x0: p.x, y0: p.y, ...p }); }}
        onPointerMove={e => { if (drag) setDrag({ ...drag, ...at(e) }); }} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
{isIp
          ? shot ? <img src={shot} alt={`${camera.name} kamerasi kadri`} draggable={false} className="block min-h-40 w-full" /> : <div className="flex min-h-40 items-center justify-center text-sm text-slate-400">Kadr olinmoqda…</div>
          : <video ref={video} autoPlay muted playsInline onLoadedData={() => setReady(true)} aria-label={`${camera.name} kamerasi tasviri`} className="block min-h-40 w-full" />}
        {zones.map((z, i) => <div key={i} className={`absolute border-2 ${z.kind === 'chair' ? 'border-emerald-400' : 'border-amber-400'}`} style={box(z)}><span className="bg-slate-900/70 px-1 text-xs font-semibold text-white">{z.name}{seen && z.id && seen.zones[z.id] ? ` · ${NOW[seen.zones[z.id]]}` : ''}</span></div>)}
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
          <label htmlFor={`rtsp-${camera.id}`} className="block text-sm font-semibold">Devordagi (IP) kamerani ulash</label>
          <div className="flex flex-wrap gap-2">
            <input id={`rtsp-${camera.id}`} className={`${inputClass} min-w-0 flex-1`} value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder={RTSP_SAMPLE} autoComplete="off" spellCheck={false} />
            <Button type="submit" disabled={linking || !address.trim()}>{linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Ulash</Button>
          </div>
          <p className="text-sm text-slate-500">Kamera yoki videoregistratorning RTSP manzili (login va paroli bilan). Yengil oqimni oling — Hikvision'da oxiri <code>102</code>, Dahua'da <code>subtype=1</code>. Ulangach odamlarni server o'zi, kechayu kunduz sanaydi; manzil shifrlab saqlanadi.</p>
        </form>
      )}
    </div>
  );
}
