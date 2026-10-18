import { BellRing, Brain, Check, House, ListChecks, LogOut, MessageCircle, PhoneCall, Plug, TriangleAlert, Users, Video, type LucideIcon } from 'lucide-react';
import type { Business } from '../types';
import type { HealthItem } from '../lib/health';
import { initials } from '../lib/text';

/** Bo'limlar kam: vazifalar Jurnalda, mijozlar va yozishmalar bitta joyda, hujjatlar va bilim — Ikkinchi miyada */
export type Page = 'home' | 'chat' | 'journal' | 'inbox' | 'requests' | 'calls' | 'cameras' | 'brain' | 'telegram';

const NAV: Record<Page, { label: string; icon: LucideIcon }> = {
  home: { label: 'Bosh sahifa', icon: House },
  chat: { label: 'Yordamchi', icon: MessageCircle },
  journal: { label: 'Jurnal', icon: ListChecks },
  inbox: { label: 'Mijozlar', icon: Users },
  requests: { label: "So'rovlar", icon: BellRing },
  calls: { label: "Qo'ng'iroqlar", icon: PhoneCall },
  cameras: { label: 'Kameralar', icon: Video },
  brain: { label: 'Ikkinchi miya', icon: Brain },
  telegram: { label: 'Ulanishlar', icon: Plug },
};

export const PAGES = Object.keys(NAV) as Page[];
export const pageLabel = (page: Page): string => NAV[page].label;

/** Menyudagi tartib: kun ishlari, mijozlar bilan aloqa, sozlash — orasida ingichka chiziq */
const GROUPS: Page[][] = [['home', 'chat', 'journal'], ['inbox', 'requests', 'calls', 'cameras'], ['brain', 'telegram']];

/** Belgi yonidagi son nimani bildiradi (ekran o'quvchi uchun) */
const BADGE_MEANING: Partial<Record<Page, string>> = { journal: 'ta ish bugunga', inbox: 'ta javob tasdiq kutyapti', requests: "ta so'rov javobsiz" };

/** Olib tashlangan bo'limlarning eski manzillari (xatcho'p, eski havola) — ishi ko'chgan joyga olib boradi */
export const MOVED: Record<string, Page> = { tasks: 'journal', leads: 'inbox', documents: 'brain', posts: 'chat', business: 'telegram' };

/** tone: ink — to'q yon panel ustida (oq yozuv) */
export function Logo({ subtitle = 'AI yordamchi', tone = 'paper' }: { subtitle?: string; tone?: 'paper' | 'ink' }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
      <div className="leading-tight">
        <div className={`text-[17px] font-extrabold tracking-tight ${tone === 'ink' ? 'text-white' : ''}`}>Cerebro</div>
        <div className={`text-[11px] font-medium ${tone === 'ink' ? 'text-ink-400' : 'text-slate-500'}`}>{subtitle}</div>
      </div>
    </div>
  );
}

function HealthMark({ level }: { level: HealthItem['level'] }) {
  if (level === 'ok') return <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (level === 'warn') return <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />;
  return <span className="mx-[3px] h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink-600" aria-hidden="true" />;
}

/** Ulanishlar holati: nima ulangan, nima yo'q — bosilsa «Ulanishlar» ochiladi. Joyida turgan qatorda so'z yo'q, faqat belgi */
function Health({ items }: { items: HealthItem[] }) {
  return (
    <a href="#/telegram" className="block rounded-xl border border-ink-800 px-3 py-2.5 transition-colors hover:border-ink-700 hover:bg-ink-900 focus-visible:outline-indigo-300">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">Holat</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map(i => (
          <li key={i.key} className="flex items-center gap-2 text-xs">
            <HealthMark level={i.level} />
            <span className={`min-w-0 flex-1 truncate font-medium ${i.level === 'off' ? 'text-ink-400' : 'text-ink-200'}`}>{i.label}</span>
            <span className={i.level === 'ok' ? 'sr-only' : i.level === 'warn' ? 'font-semibold text-amber-400' : 'text-ink-400'}>{i.state}</span>
          </li>
        ))}
      </ul>
    </a>
  );
}

/**
 * Yon panel. Keng ekranda (wide) doim ko'rinadi; torroqda — yuqori chapdagi «Menyu» tugmasi bilan ochiladigan tortma,
 * bo'lim tanlanganda yopiladi.
 */
export function Sidebar({ wide, open, page, setPage, biz, health, badges = {}, onLogout }: {
  wide: boolean; open: boolean;
  page: Page; setPage: (p: Page) => void; biz: Business; health: HealthItem[]; badges?: Partial<Record<Page, number>>; onLogout: () => void;
}) {
  const drawer = wide ? { 'aria-label': 'Yon panel' } : { inert: !open, role: 'dialog', 'aria-modal': true, 'aria-label': 'Menyu' } as const;
  return (
    <aside {...drawer} className={`fixed inset-y-0 left-0 z-[46] flex h-dvh w-64 max-w-[85vw] flex-col overflow-y-auto overscroll-contain bg-ink-950 px-3 pb-3 pt-5 text-ink-200 transition-transform duration-200 ${wide || open ? 'translate-x-0' : '-translate-x-full'} ${open && !wide ? 'shadow-2xl' : ''}`}>
      <div className="px-2"><Logo tone="ink" /></div>
      <nav aria-label="Bo'limlar" className="mt-7 space-y-3">
        {GROUPS.map((group, n) => (
          <ul key={group[0]} className={`space-y-0.5 ${n ? 'border-t border-ink-800 pt-3' : ''}`}>
            {group.map(id => {
              const { label, icon: Icon } = NAV[id];
              const badge = badges[id];
              const active = page === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setPage(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-indigo-300 ${active ? 'bg-ink-800 text-white' : 'text-ink-300 hover:bg-ink-900 hover:text-white active:bg-ink-800'}`}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-indigo-400" aria-hidden="true" />}
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-indigo-300' : ''}`} aria-hidden="true" />
                    <span className="flex-1 text-left">{label}</span>
                    {!!badge && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold tabular-nums leading-[18px] text-ink-950">{badge}<span className="sr-only"> {BADGE_MEANING[id]}</span></span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>

      <div className="mt-auto space-y-3 pt-6">
        <Health items={health} />
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xs font-extrabold text-white ring-1 ring-white/10" style={{ background: biz.brand.primary }}>
            {biz.brand.logo ? <img src={biz.brand.logo} alt="" className="h-full w-full bg-white object-contain" /> : initials(biz.name)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold text-white">{biz.name}</div>
            <div className="truncate text-xs text-ink-400">{biz.ownerName || biz.industry || 'Biznes'}</div>
          </div>
        </div>
        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-ink-300 transition-colors hover:bg-ink-900 hover:text-white active:bg-ink-800 focus-visible:outline-indigo-300">
          <LogOut className="h-[18px] w-[18px]" aria-hidden="true" /> Chiqish
        </button>
      </div>
    </aside>
  );
}
