import { Brain, ChevronRight, MessagesSquare, PhoneCall, Video } from 'lucide-react';
import type { JournalItem } from '../lib/journal';

const ICON = { call: PhoneCall, camera: Video, chat: MessagesSquare, brain: Brain };
const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', crit: 'bg-rose-500' };
const LEVEL = { ok: 'joyida', warn: 'sizni kutyapti', crit: 'muammo' };
const clock = (isoTime: string) => new Date(isoTime).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });

/** Jurnal qatorlari (Jurnal va bosh sahifada): har biri o'z bo'limiga olib boradi. Vaqti bor qatorda — soat, yo'g'ida — daraja nuqtasi */
export function JournalRows({ items }: { items: JournalItem[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map(item => {
        const Icon = ICON[item.kind];
        return (
          <li key={item.key}>
            <button type="button" onClick={() => { window.location.hash = `#/${item.page}`; }} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 active:bg-slate-100">
              <span className="w-11 shrink-0 tabular-nums text-slate-500">
                {item.at ? clock(item.at) : <><span className={`ml-1 inline-block h-2 w-2 rounded-full ${DOT[item.level]}`} aria-hidden="true" /><span className="sr-only">{LEVEL[item.level]}</span></>}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 flex-1">{item.text}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
