import { ArrowRight, Check } from 'lucide-react';
import { ButtonLink } from '../components/ui';
import type { SetupStep } from '../lib/setup';

/**
 * Ishga tushirish ro'yxati: o'rnatuvchi klinikada birinchi ko'radigan narsa. Bajarilgan qadam yashil belgi oladi,
 * navbatdagisi ajralib turadi va o'z bo'limiga olib boradi. Hammasi bajarilgach ro'yxat ko'rsatilmaydi.
 */
export function SetupCard({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter(s => s.done).length;
  const next = steps.find(s => !s.done)?.key;
  return (
    <section aria-labelledby="setup" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sheet">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
        <div className="mr-auto min-w-0">
          <h2 id="setup" className="text-lg font-extrabold tracking-tight">Cerebro'ni ishga tushirish</h2>
          <p className="mt-0.5 text-sm text-slate-500">Qadamlarni tartib bilan bajaring — har biri bir-ikki daqiqa oladi.</p>
        </div>
        <div className="w-full sm:w-56">
          <p className="text-xs font-semibold text-slate-600"><span className="text-base font-extrabold tabular-nums text-slate-900">{done}/{steps.length}</span> qadam bajarildi</p>
          <div className="mt-1.5 flex gap-1" aria-hidden="true">
            {steps.map(s => <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.done ? 'bg-emerald-500' : 'bg-slate-200'}`} />)}
          </div>
        </div>
      </div>
      <ol className="divide-y divide-slate-100">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold tabular-nums ${s.done ? 'bg-emerald-100 text-emerald-700' : s.key === next ? 'bg-indigo-600 text-white' : 'border-2 border-slate-200 text-slate-500'}`}>
              {s.done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <p className={`text-sm font-bold ${s.done ? 'text-slate-500' : ''}`}>{s.title}{s.done && <span className="sr-only"> — bajarildi</span>}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{s.text}</p>
            </div>
            {s.done
              ? <span className="text-xs font-bold text-emerald-700">Tayyor</span>
              : <ButtonLink href={s.href} size="sm" variant={s.key === next ? 'primary' : 'secondary'}>{s.go} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></ButtonLink>}
          </li>
        ))}
      </ol>
    </section>
  );
}
