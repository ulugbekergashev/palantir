/**
 * Registrator (DVR/NVR) — bitta IP'da bir nechta kamera. Kamera ulangach server shu qurilmaning boshqa kanallarini tekshiradi va
 * kadri bilan qaytaradi; egasi kadrga qarab kerakligini nomlab ulaydi (bo'sh kanal «Video yo'q» kadrini berishi mumkin — shuning
 * uchun avtomatik ulanmaydi). Oddiy (bitta) kamerada hech narsa ko'rinmaydi. Kameralar sahifasi va ulash ustasi ishlatadi.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../data/api';
import type { Camera } from '../types';
import { Button, TextInput } from './ui';

type Notify = (text: string, error?: boolean) => void;

export function RecorderChannels({ cameraId, placeFor, notify, onConnected }: {
  cameraId: string;
  /** i-chi yangi kameraga taklif qilinadigan nom (qaysi xonada) */
  placeFor: (i: number) => string;
  notify: Notify;
  onConnected: (camera: Camera) => void;
}) {
  const [channels, setChannels] = useState<{ channel: number; preview: string }[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    api.cameraChannels(cameraId).then(r => { if (!stale) setChannels(r.channels); }).catch(() => { if (!stale) setChannels([]); });
    return () => { stale = true; };
  }, [cameraId]);

  /** Egasi yozmagan nom — ro'yxatning hozirgi holatidan (yangi ulangan kameraning nomi qayta taklif qilinmaydi) */
  const nameOf = (channel: number, i: number) => names[channel] ?? placeFor(i);
  const connect = async (channel: number, i: number) => {
    setBusy(channel);
    try {
      const r = await api.connectChannel(cameraId, channel, nameOf(channel, i).trim() || `${channel}-kanal`);
      setChannels(list => list?.filter(c => c.channel !== channel) ?? null);
      onConnected(r.camera);
      notify(`${r.camera.name} ulandi`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  if (channels === null) {
    return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Registrator bo'lsa — boshqa kanallari tekshirilmoqda…</p>;
  }
  if (!channels.length) return null;
  return (
    <section aria-label="Registratordagi boshqa kameralar" className="space-y-3">
      <p className="text-sm text-slate-600"><b>Bu registrator — yana {channels.length} ta kanaldan kadr keldi.</b> Kerakli kameralarni nomlab ulang (kadri qora yoki «Video yo'q» bo'lsa — kamera ulanmagan kanal).</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((c, i) => (
          <li key={c.channel} className="overflow-hidden rounded-xl border border-slate-200">
            <img src={c.preview} alt={`${c.channel}-kanal kadri`} className="aspect-video w-full bg-ink-900 object-cover" />
            <div className="flex items-center gap-2 p-2">
              <span className="shrink-0 text-xs text-slate-500">{c.channel}-kanal</span>
              <TextInput aria-label={`${c.channel}-kanal qayerda`} value={nameOf(c.channel, i)} onChange={e => setNames({ ...names, [c.channel]: e.target.value })} />
              <Button size="sm" variant="primary" onClick={() => { void connect(c.channel, i); }} disabled={busy !== null}>
                {busy === c.channel && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Ulash
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
