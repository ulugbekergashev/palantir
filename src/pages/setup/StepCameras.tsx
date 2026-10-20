import { useEffect, useState } from 'react';
import { Camera as CameraIcon, Loader2, Radar, Video } from 'lucide-react';
import { api } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import { maskSecret } from '../../lib/secrets';
import type { Camera, FoundCamera, SetupView } from '../../types';
import type { Routed } from './StepKeys';

type Notify = (text: string, error?: boolean) => void;
/** Kamera nomi — u qayerda turgani: shu nom bilan hisobotda ko'rinadi */
const PLACES = ['Qabulxona', '1-kabinet', '2-kabinet', '3-kabinet', 'Kirish eshigi', 'Kassa'];

/** Ulangan kameraning hozirgi kadri (ulanish haqiqatan ishlayotganini ko'rsatadi) */
function Frame({ cam }: { cam: Camera }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null, stale = false;
    api.cameraSnapshot(cam.id).then(b => { if (!stale) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => { if (!stale) setFailed(true); });
    return () => { stale = true; if (url) URL.revokeObjectURL(url); };
  }, [cam.id]);
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex aspect-video items-center justify-center bg-ink-900 text-xs text-ink-300">
        {src ? <img src={src} alt={`${cam.name} kamerasidan kadr`} className="h-full w-full object-cover" /> : failed ? 'Kadr kelmadi' : <Loader2 className="h-5 w-5 animate-spin" aria-label="kadr olinmoqda" />}
      </div>
      <figcaption className="px-3 py-2 text-sm"><b>{cam.name}</b> <span className="text-xs text-slate-500">{cam.ip}</span></figcaption>
    </figure>
  );
}

export function StepCameras({ setup, routed, onCount, notify }: { setup: SetupView | null; routed: Routed; onCount: (n: number) => void; notify: Notify }) {
  const [list, setList] = useState<Camera[] | null>(null);
  const [found, setFound] = useState<FoundCamera[] | null>(null);
  const [ffmpeg, setFfmpeg] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cred, setCred] = useState({ login: 'admin', password: '' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    const cams = (await api.cameras()).cameras;
    setList(cams);
    onCount(cams.filter(c => c.ip).length);
  };
  useEffect(() => { void reload().catch(e => notify((e as Error).message, true)); }, []);

  const placeFor = (i: number) => PLACES[(list?.length ?? 0) + i] ?? `${(list?.length ?? 0) + i + 1}-kamera`;
  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.discoverCameras();
      setFound(r.found);
      setFfmpeg(r.ffmpeg);
      setNames(Object.fromEntries(r.found.filter(c => !c.connected).map((c, i) => [c.ip, placeFor(i)])));
    } catch (e) { notify((e as Error).message, true); } finally { setScanning(false); }
  };
  const connect = async (c: FoundCamera) => {
    setBusy(c.ip);
    try {
      await api.connectCamera({ ip: c.ip, port: c.rtspPort, brand: c.brand, onvif: c.onvif, login: cred.login, password: cred.password, name: names[c.ip] || placeFor(0) });
      setFound(f => f?.map(x => (x.ip === c.ip ? { ...x, connected: true } : x)) ?? null);
      await reload();
      notify(`${names[c.ip] || c.ip} ulandi`);
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  /** Kalitlar maydoniga qo'yilgan tayyor rtsp:// manzil */
  const connectUrl = async (url: string, name: string) => {
    setBusy(url);
    let id: string | null = null;
    try {
      id = (await api.addCamera(name)).camera.id;
      await api.setCameraStream(id, url);
      await reload();
      notify(`${name} ulandi`);
    } catch (e) {
      if (id) await api.removeCamera(id).catch(() => {});
      notify((e as Error).message, true);
    } finally { setBusy(null); }
  };

  const connectedIps = new Set((list ?? []).map(c => c.ip?.replace(/:\d+$/, '')));
  const pendingUrls = routed.rtsp.filter(u => { try { return !connectedIps.has(new URL(u).hostname); } catch { return false; } });
  const expected = setup?.has.cameras ?? 0;
  return (
    <div className="space-y-4">
      {!ffmpeg && <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Bu kompyuterda ffmpeg yo'q — IP kameralar ishlamaydi. O'rnating: <code className="font-mono">winget install Gyan.FFmpeg</code>, keyin Palantir'ni qayta ishga tushiring.</p>}
      <Card title="Klinika tarmog'idagi kameralar" description={`Kompyuter kameralar bilan bitta routerga ulangan bo'lishi kerak.${expected ? ` Anketada: ${expected} ta kamera${setup?.has.cameraBrand ? `, ${setup.has.cameraBrand}` : ''}.` : ''}`}
        action={<Button variant={found ? 'secondary' : 'primary'} onClick={scan} disabled={scanning}>{scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} {found ? 'Qayta qidirish' : 'Tarmoqdan qidirish'}</Button>}>
        {scanning && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> ONVIF so'rovi va 554-port tekshirilmoqda — bir necha soniya…</p>}
        {found && !scanning && (found.length === 0
          ? <p className="text-sm text-slate-600">Kamera topilmadi. Kamera yoqilganmi va shu tarmoqdami? Topilmasa — kamera manzilini (<code className="font-mono">rtsp://…</code>) «Kalitlar» qadamiga qo'ying.</p>
          : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Field label="Kamera logini (hammasiga bir xil)"><TextInput value={cred.login} onChange={e => setCred({ ...cred, login: e.target.value })} autoComplete="off" /></Field>
                <Field label="Kamera paroli" hint="Kamera qutisida yoki uni o'rnatgan ustada"><TextInput type="password" value={cred.password} onChange={e => setCred({ ...cred, password: e.target.value })} autoComplete="off" /></Field>
              </div>
              <ul className="divide-y divide-slate-100">
                {found.map(c => (
                  <li key={c.ip} className="flex flex-wrap items-center gap-3 py-3">
                    <Video className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    <div className="min-w-40 flex-1"><p className="font-bold">{c.brand || "Noma'lum marka"} · <span className="font-mono">{c.ip}</span></p><p className="text-xs text-slate-500">{c.model || (c.onvif ? 'ONVIF' : `faqat RTSP porti ${c.rtspPort}`)}</p></div>
                    {c.connected ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Ulangan</span> : (
                      <>
                        <div className="w-40"><TextInput aria-label="Qayerda turibdi" value={names[c.ip] ?? ''} onChange={e => setNames({ ...names, [c.ip]: e.target.value })} list="camera-places" /></div>
                        <Button variant="primary" onClick={() => connect(c)} disabled={busy !== null}>{busy === c.ip ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ulash</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <datalist id="camera-places">{PLACES.map(p => <option key={p} value={p} />)}</datalist>
            </>
          ))}
      </Card>

      {pendingUrls.length > 0 && (
        <Card title="Kalitlar maydonidan kelgan manzillar">
          <ul className="divide-y divide-slate-100">
            {pendingUrls.map((u, i) => (
              <li key={u} className="flex flex-wrap items-center gap-3 py-3">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-600">{maskSecret(u)}</code>
                <Button variant="primary" onClick={() => connectUrl(u, placeFor(i))} disabled={busy !== null}>{busy === u ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ulash</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {list && list.some(c => c.ip) && (
        <Card title="Ulangan kameralar" description="Kadr — kameradan hozir olingan. Kreslo va kassa zonalarini kabinetdagi «Kameralar» bo'limida kadr ustida chizasiz.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.filter(c => c.ip).map(c => <Frame key={c.id} cam={c} />)}</div>
        </Card>
      )}
      {list && !list.some(c => c.ip) && !found && <p className="flex items-center gap-2 text-sm text-slate-500"><CameraIcon className="h-4 w-4" aria-hidden="true" /> Hali IP kamera ulanmagan.</p>}
    </div>
  );
}
