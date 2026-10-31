/**
 * Jonli tekshiruv (Sozlamalar tepasida): «Tekshirish» — har ulangan kanal haqiqiy xizmatda sinaladi (server/live/check.ts),
 * natija har qatorda: ishlayapti / e'tibor bering / ishlamayapti / ulanmagan. «Meta AI bilan» — Meta AI'ga ham savol beradi (sekinroq).
 */
import { useState } from 'react';
import { Activity, CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { LiveCheck as Check } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';

const LOOK: Record<Check['level'], { icon: LucideIcon; tone: string; word: string }> = {
  ok: { icon: CircleCheck, tone: 'text-emerald-400', word: 'ishlayapti' },
  warn: { icon: TriangleAlert, tone: 'text-[#f5b454]', word: "e'tibor bering" },
  fail: { icon: CircleX, tone: 'text-[#ff7a6b]', word: 'ishlamayapti' },
  off: { icon: CircleMinus, tone: 'text-[#7d838f]', word: 'ulanmagan' },
};
const ORDER: Check['level'][] = ['fail', 'warn', 'ok', 'off'];

export function LiveCheckCard({ notify }: { notify: Notify }) {
  const [busy, setBusy] = useState<'quick' | 'deep' | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [at, setAt] = useState<string | null>(null);

  const run = async (deep: boolean) => {
    setBusy(deep ? 'deep' : 'quick');
    try {
      const r = await api.liveCheck(deep);
      setChecks([...r.checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level)));
      setAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const failed = checks?.filter(c => c.level === 'fail').length ?? 0;
  // Ulanmaganlar — bitta qatorda (ro'yxatni cho'zib, ishlamayotganini ko'mib yubormasin)
  const shown = checks?.filter(c => c.level !== 'off') ?? [];
  const unplugged = checks?.filter(c => c.level === 'off').map(c => c.label) ?? [];
  const summary = checks && (failed ? `${failed} ta kanal ishlamayapti` : 'Ulangan kanallarning hammasi ishlayapti');
  const btn = 'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50';

  return (
    <section aria-label="Jonli tekshiruv" className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff9a3c]/[0.12] text-[#ff9a3c]"><Activity className="h-[19px] w-[19px]" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-[#f2f0ea]">Jonli tekshiruv</h3>
          <p className="text-[13px] text-[#8a909c]">
            {summary ? `${summary} · ${at}` : "Har bir ulanish haqiqiy xizmatda sinaladi. Mijozga hech narsa yuborilmaydi, post joylanmaydi."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { void run(false); }} disabled={!!busy} className={`${btn} bg-[#ff9a3c] text-[#1a0f05] hover:bg-[#ffb062]`}>
            {busy === 'quick' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{checks ? 'Qayta tekshirish' : 'Tekshirish'}
          </button>
          <button type="button" onClick={() => { void run(true); }} disabled={!!busy} title="Meta AI'ga ham bitta savol beriladi — bir-ikki daqiqa"
            className={`${btn} border border-glass/[0.1] text-[#d9dbe1] hover:bg-glass/[0.05]`}>
            {busy === 'deep' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}Meta AI bilan
          </button>
        </div>
      </div>
      {checks && (
        <ul className="mt-4 divide-y divide-glass/[0.06] border-t border-glass/[0.06]">
          {shown.map(c => {
            const look = LOOK[c.level];
            return (
              <li key={c.key} className="flex items-start gap-3 py-2.5">
                <look.icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${look.tone}`} aria-label={look.word} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-[#f2f0ea]">{c.label}</span>
                  <span className={`block text-[13px] ${c.level === 'off' ? 'text-[#7d838f]' : 'text-[#a3a9b5]'}`}>{c.detail}</span>
                </span>
                {c.ms >= 1000 && <span className="shrink-0 text-[12px] tabular-nums text-[#7d838f]">{(c.ms / 1000).toFixed(1)} s</span>}
              </li>
            );
          })}
          {unplugged.length > 0 && (
            <li className="flex items-start gap-3 py-2.5">
              <CircleMinus className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#7d838f]" aria-label="ulanmagan" />
              <span className="min-w-0 flex-1 text-[13px] text-[#7d838f]"><span className="font-semibold text-[#a3a9b5]">Ulanmagan:</span> {unplugged.join(', ')}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
