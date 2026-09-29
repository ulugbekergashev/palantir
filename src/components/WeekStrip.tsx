import type { ContentItem, ItemStatus } from '../types';
import { DAYS_SHORT, addDays, iso } from '../lib/week';

const DOT: Record<ItemStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  published: 'bg-teal-600 text-white border-teal-600',
  rejected: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
};

/** Haftaning 7 kuni va har kunga rejalangan postlar */
export function WeekStrip({ monday, items, statusOf, today }: {
  monday: Date; items: ContentItem[]; statusOf: (item: ContentItem) => ItemStatus; today: string;
}) {
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        const key = iso(day);
        const list = items.filter(it => it.date === key).sort((a, b) => a.time.localeCompare(b.time));
        const isToday = key === today;
        return (
          <div key={key} className={`min-h-[84px] rounded-xl border p-1.5 sm:p-2 ${isToday ? 'border-teal-600 bg-teal-50/60' : 'border-slate-200 bg-white'}`}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className={`text-[11px] font-bold uppercase ${isToday ? 'text-teal-700' : 'text-slate-400'}`}>{DAYS_SHORT.uz[i]}</span>
              <span className={`text-sm font-bold ${isToday ? 'text-teal-800' : 'text-slate-700'}`}>{day.getDate()}</span>
            </div>
            <div className="space-y-1">
              {list.map(it => (
                <div key={it.id} title={`${it.time} · ${it.topic.uz}`} className={`h-1.5 truncate rounded-md border sm:h-auto sm:px-1.5 sm:py-0.5 text-[10px] font-semibold ${DOT[statusOf(it)]}`}>
                  <span className="hidden sm:inline">{it.time} {it.kind === 'story' ? '◷ ' : ''}{it.topic.uz}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
