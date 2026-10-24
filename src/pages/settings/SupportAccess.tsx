/**
 * Palantir jamoasi kirishi (hub orqali, parolsiz): o'rnatuvchi klinikani bezovta qilmay tekshiradi — kameralar, bemorlar, ulash ustasi.
 * Egasi bu yerda ruxsatni o'chiradi (darhol: jamoaning ochiq kirishi ham bekor) va oxirgi kirishlarni ko'radi.
 * Hub ulanmagan bo'lsa — ko'rinmaydi. Jamoaning o'zi ruxsatni o'zgartira olmaydi (server ham ruxsat bermaydi).
 */
import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { api, type SupportAccessView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Button } from '../../components/ui';
import { ago } from '../../components/agent';

const VISITS_SHOWN = 5;

export function SupportAccess({ notify }: { notify: Notify }) {
  const [view, setView] = useState<SupportAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.supportAccess().then(setView).catch(() => {}); }, []);
  if (!view?.hub) return null;

  const toggle = async () => {
    const next = !view.allowed;
    if (!next && !window.confirm("Palantir jamoasi panelingizga kira olmaydi (hozir ochiq bo'lsa ham chiqariladi). O'chirilsinmi?")) return;
    setBusy(true);
    try {
      const r = await api.setSupportAccess(next);
      setView({ ...view, allowed: r.allowed });
      notify(r.allowed ? 'Palantir jamoasi kira oladi' : "Palantir jamoasi kirishi o'chirildi");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const Icon = view.allowed ? ShieldCheck : ShieldOff;
  return (
    <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={`h-5 w-5 ${view.allowed ? 'text-emerald-500' : 'text-slate-400'}`} aria-hidden="true" />
        <p className="min-w-48 flex-1">
          <b>Palantir jamoasi</b> — {view.allowed
            ? 'sozlash va tekshirish uchun panelingizga parolsiz kira oladi. Har kirish shu yerda yoziladi.'
            : "kira olmaydi. Yordam kerak bo'lsa — qayta yoqing."}
        </p>
        {view.mine
          ? <span className="text-xs text-slate-500">Buni faqat klinika egasi o'zgartiradi</span>
          : <Button size="sm" onClick={() => { void toggle(); }} disabled={busy}>{view.allowed ? "O'chirish" : 'Yoqish'}</Button>}
      </div>
      {view.visits.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-500">
          {view.visits.slice(0, VISITS_SHOWN).map(v => (
            <li key={v.at}>Kirgan: {new Date(v.at).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' })} ({ago(v.at)})</li>
          ))}
        </ul>
      )}
    </div>
  );
}
