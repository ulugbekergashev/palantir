/**
 * Xodim sahifasidagi «Nazorat»: AI nimani o'zi qiladi, nima sizning tugmangiz bilan, nima hech qachon (src/data/nazorat.ts).
 * Yopiq turadi — sarlavhada uchta belgi va soni; bosilsa uch ustun ochiladi.
 */
import { ShieldCheck } from 'lucide-react';
import { COMMON_NEVER, RIGHTS } from '../data/nazorat';
import type { Member } from './team';

const COLUMNS = [
  { key: 'free', label: 'Erkin', hint: "o'zi qiladi", dot: 'bg-emerald-400', text: 'text-emerald-300' },
  { key: 'button', label: 'Tugma', hint: 'sizning tasdig\'ingiz bilan', dot: 'bg-amber-400', text: 'text-amber-300' },
  { key: 'never', label: 'Yopiq', hint: 'hech qachon', dot: 'bg-rose-400', text: 'text-rose-300' },
] as const;

export function Nazorat({ member }: { member: Member }) {
  const r = RIGHTS[member];
  const lists = { free: r.free, button: r.button, never: [...r.never, ...COMMON_NEVER] };
  return (
    <details className="group relative mt-4 rounded-2xl border border-glass/[0.07] bg-glass/[0.03] sm:mt-6">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="mr-auto flex items-center gap-2 text-[13px] font-semibold text-[#f2f0ea]">
          <ShieldCheck className="h-4 w-4 text-[#a3a9b5]" aria-hidden="true" />Nazorat
          <span className="hidden font-normal text-[#8a909c] sm:inline">— muhim qadam faqat sizning tugmangiz bilan</span>
        </span>
        {COLUMNS.map(c => (
          <span key={c.key} className="flex items-center gap-1.5 text-[12px] text-[#a3a9b5]">
            <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />{c.label} <span className="tabular-nums text-[#f2f0ea]">{lists[c.key].length}</span>
          </span>
        ))}
        <span className="text-[12px] text-[#8a909c] group-open:hidden">Ochish</span>
        <span className="hidden text-[12px] text-[#8a909c] group-open:inline">Yopish</span>
      </summary>
      <div className="grid gap-3 border-t border-glass/[0.07] p-4 sm:grid-cols-3">
        {COLUMNS.map(c => (
          <section key={c.key} className="min-w-0">
            <h3 className={`text-[12px] font-semibold uppercase tracking-[0.12em] ${c.text}`}>{c.label} <span className="font-normal normal-case tracking-normal text-[#8a909c]">· {c.hint}</span></h3>
            {lists[c.key].length ? (
              <ul className="mt-2 space-y-1.5">
                {lists[c.key].map(t => <li key={t} className="text-[13px] leading-snug text-[#c9ced8]">{t}</li>)}
              </ul>
            ) : <p className="mt-2 text-[13px] text-[#8a909c]">Yo'q — bu xodim tashqariga hech narsa yubormaydi</p>}
          </section>
        ))}
      </div>
    </details>
  );
}
