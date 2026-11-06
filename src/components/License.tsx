/**
 * Litsenziya (server/license.ts): yangi o'rnatish — darhol butun ekran aktivlashtirish oynasi (DentaLocal kabi). Eski klinikaning
 * kalitsiz muddatida — sahifa tepasida ingichka eslatma («Kalitni kiritish» — oyna ochiladi): suzib
 * turadigan tugma telefonda bo'limlar panelini, kompyuterda so'rov tugmalari va yozish maydonini yopib qo'yardi;
 * eslatmani yopsa bo'ladi — ertasi kuni yana chiqadi, oxirgi kunlarda (URGENT_DAYS) yopilmaydi;
 * muddat tugagach — butun ekran aktivlashtirish oynasi. Kompyuter kodini o'rnatuvchi yoki egasi Palantir jamoasiga aytadi:
 * kompyuter Hub'ga o'zi yozilgan, jamoa Hub'da shu kod bilan «Tasdiqlash va aktivlashtirish»ni bosadi — oyna o'zi yopiladi (App.tsx
 * yopiq paytda holatni tez-tez so'raydi). Hub'siz — jamoa PAL1 kalitini yuboradi, u shu oynaga qo'yiladi.
 */
import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, Loader2, X } from 'lucide-react';
import { api, type LicenseView } from '../data/api';
import { Button } from './ui';

/** Shuncha kun qolganda eslatma yopilmaydi */
const URGENT_DAYS = 3;
const HIDDEN_KEY = 'palantir_license_hidden';
const today = () => new Date().toLocaleDateString('sv-SE');
const hiddenToday = () => { try { return localStorage.getItem(HIDDEN_KEY) === today(); } catch { return false; } };

export function LicenseReminder({ license, onOpen }: { license: LicenseView; onOpen: () => void }) {
  const urgent = license.daysLeft <= URGENT_DAYS;
  const [hidden, setHidden] = useState(hiddenToday);
  if (hidden && !urgent) return null;
  const hide = () => {
    try { localStorage.setItem(HIDDEN_KEY, today()); } catch { /* yopiq xotira — shu ochilishda yashiriladi */ }
    setHidden(true);
  };
  return (
    <div className={`flex w-full items-center border-b text-xs font-semibold lg:pl-[var(--rail,224px)] ${urgent ? 'border-[#ff7a6b]/30 bg-[#2a110d] text-[#ffc2b8]' : 'border-[#ff9a3c]/25 bg-[#1c1309] text-[#ffd9a0]'}`}>
      <button type="button" onClick={onOpen} className="flex flex-1 items-center justify-center gap-2 px-3.5 py-2 hover:text-[#fff3e0]">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Aktivlashtirilmagan · {license.daysLeft} kun qoldi · <span className="underline underline-offset-2">Kalitni kiritish</span>
      </button>
      {!urgent && (
        <button type="button" onClick={hide} aria-label="Eslatmani bugunga yopish" title="Bugunga yopish (ertaga yana eslatadi)" className="mr-1.5 rounded-lg p-1.5 opacity-70 hover:bg-glass/5 hover:opacity-100">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ActivationPanel({ license, onActivated, onClose }: { license: LicenseView; onActivated: (l: LicenseView) => void; onClose?: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(license.machineId).catch(() => {});
    setCopied(true);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      onActivated((await api.activateLicense(key.trim())).license);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/0.60)] p-4" role="dialog" aria-modal="true" aria-labelledby="license-title">
      <form onSubmit={submit} className="relative w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-slate-700 shadow-2xl">
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Yopish" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        )}
        <div>
          <h2 id="license-title" className="text-lg font-bold text-slate-900">Palantir'ni aktivlashtirish</h2>
          <p className="mt-1 text-sm text-slate-500">
            {license.blocked
              ? 'Palantir kalit bilan ishlaydi: kompyuter kodini yuboring, kelgan kalitni qo\'ying — panel shu zahoti ochiladi.'
              : `Kalitsiz yana ${license.daysLeft} kun ishlaydi. Keyin panel kalit so'raydi (bot, kameralar va qo'ng'iroqlar ishlayveradi).`}
          </p>
        </div>
        <div>
          <p className="text-sm">1. Kompyuter kodini Palantir jamoasiga ayting. Jamoa uni masofadan aktivlashtirsa, bu oyna o'zi yopiladi:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-center font-mono text-lg tracking-wider text-slate-900">{license.machineId}</code>
            <Button size="sm" onClick={() => { void copy(); }}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? 'Nusxalandi' : 'Nusxalash'}</Button>
          </div>
        </div>
        <div>
          <label htmlFor="license-key" className="text-sm">2. Jamoa kalit yuborgan bo'lsa — shu yerga qo'ying:</label>
          <textarea id="license-key" value={key} onChange={e => setKey(e.target.value)} rows={3} spellCheck={false} autoComplete="off" placeholder="PAL1-…"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus:border-brand-400" />
        </div>
        {problem && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
        <Button type="submit" variant="primary" disabled={busy || !key.trim()} className="w-full justify-center">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Aktivlashtirish
        </Button>
      </form>
    </div>
  );
}
