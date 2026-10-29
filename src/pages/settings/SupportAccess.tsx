/**
 * Palantir jamoasi kirishi (hub orqali, parolsiz). Standart: har kirish uchun egasidan Telegram'da so'raladi. Egasi bu yerda doimiy
 * ruxsat beradi (so'ramasdan — o'rnatish kunlari qulay) yoki ochiq kirishni yopadi (darhol: jamoa chiqariladi) va oxirgi kirishlarni
 * ko'radi. Har kirish baribir Telegram'da aytiladi. Hub ulanmagan bo'lsa — ko'rinmaydi. Jamoaning o'zi buni o'zgartira olmaydi.
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

  const open = view.allowed || !!view.until;
  const toggle = async () => {
    const next = !open;
    if (!next && !window.confirm("Palantir jamoasi hozir chiqariladi; keyingi safar kirmoqchi bo'lsa Telegram'da sizdan so'raydi. Yopilsinmi?")) return;
    setBusy(true);
    try {
      const r = await api.setSupportAccess(next);
      setView({ ...view, allowed: r.allowed, until: null });
      notify(r.allowed ? "Palantir jamoasi so'ramasdan kira oladi" : 'Palantir jamoasi kirishi yopildi');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const Icon = open ? ShieldCheck : ShieldOff;
  const until = view.until ? new Date(view.until).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return (
    <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={`h-5 w-5 ${open ? 'text-emerald-500' : 'text-slate-400'}`} aria-hidden="true" />
        <p className="min-w-48 flex-1">
          <b>Palantir jamoasi</b> — {view.allowed
            ? "sozlash va tekshirish uchun panelingizga so'ramasdan kira oladi. Har kirish Telegram'da aytiladi va shu yerda yoziladi."
            : view.until
              ? `siz Telegram'da ruxsat bergansiz — ${until} gacha kira oladi.`
              : "kirmoqchi bo'lsa, har safar Telegram'da sizdan so'raydi. O'rnatish kunlari so'ramasdan kirsin desangiz — yoqing."}
        </p>
        {view.mine
          ? <span className="text-xs text-slate-500">Buni faqat klinika egasi o'zgartiradi</span>
          : <Button size="sm" onClick={() => { void toggle(); }} disabled={busy}>{open ? 'Yopish' : "So'ramasdan kirsin"}</Button>}
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
