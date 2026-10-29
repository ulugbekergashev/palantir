/**
 * Litsenziya (server/license.ts): kalitsiz muddatda — sahifa tepasida ingichka eslatma («Kalitni kiritish» — oyna ochiladi): suzib
 * turadigan tugma telefonda bo'limlar panelini, kompyuterda so'rov tugmalari va yozish maydonini yopib qo'yardi;
 * muddat tugagach — butun ekran aktivlashtirish oynasi. Kompyuter kodini egasi Palantir jamoasiga yuboradi va kalitni qo'yadi
 * (klinika Hub'ga ulangan bo'lsa, jamoa Hub'dan o'zi aktivlashtiradi — kod almashish shart emas).
 */
import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, Loader2, X } from 'lucide-react';
import { api, type LicenseView } from '../data/api';
import { Button } from './ui';

export function LicenseReminder({ license, onOpen }: { license: LicenseView; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-center justify-center gap-2 border-b border-amber-300/40 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 lg:pl-[92px]">
      <KeyRound className="h-4 w-4" aria-hidden="true" />
      Aktivlashtirilmagan · {license.daysLeft} kun qoldi · Kalitni kiritish
    </button>
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
              ? 'Kalitsiz ishlash muddati tugadi. Bot, kameralar va qo\'ng\'iroqlar ishlayapti — panel kalit kiritilgach ochiladi.'
              : `Kalitsiz yana ${license.daysLeft} kun ishlaydi. Keyin panel kalit so'raydi (bot, kameralar va qo'ng'iroqlar ishlayveradi).`}
          </p>
        </div>
        <div>
          <p className="text-sm">1. Kompyuter kodini Palantir jamoasiga yuboring:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-center font-mono text-lg tracking-wider text-slate-900">{license.machineId}</code>
            <Button size="sm" onClick={() => { void copy(); }}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? 'Nusxalandi' : 'Nusxalash'}</Button>
          </div>
        </div>
        <div>
          <label htmlFor="license-key" className="text-sm">2. Jamoa yuborgan kalitni shu yerga qo'ying:</label>
          <textarea id="license-key" value={key} onChange={e => setKey(e.target.value)} rows={3} spellCheck={false} autoComplete="off" placeholder="PAL1-…"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus:border-indigo-400" />
        </div>
        {problem && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
        <Button type="submit" variant="primary" disabled={busy || !key.trim()} className="w-full justify-center">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Aktivlashtirish
        </Button>
      </form>
    </div>
  );
}
