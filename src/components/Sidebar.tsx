import type { ReactNode } from 'react';
import { BarChart3, Brain, Building2, LayoutGrid, MessageCircle, PhoneCall, type LucideIcon } from 'lucide-react';
import type { Clinic } from '../types';
import { initials } from '../lib/text';

export type Page = 'package' | 'telegram' | 'report' | 'leads' | 'setup';

const NAV: Record<Page, { label: string; icon: LucideIcon }> = {
  package: { label: 'Haftalik paket', icon: LayoutGrid },
  telegram: { label: 'Telegram bot', icon: MessageCircle },
  report: { label: 'Natijalar', icon: BarChart3 },
  leads: { label: 'Murojaatlar', icon: PhoneCall },
  setup: { label: 'Klinika va brend', icon: Building2 },
};

export function Logo({ subtitle = 'AI marketolog va dizayner' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-white">
        <Brain className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <div className="text-[17px] font-extrabold tracking-tight">Cerebro</div>
        <div className="text-[11px] font-medium text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}

export function Sidebar({ pages, page, setPage, clinic, badges = {}, footer }: {
  pages: Page[]; page: Page; setPage: (p: Page) => void; clinic: Clinic; badges?: Partial<Record<Page, number>>; footer?: ReactNode;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
      <Logo />
      <nav className="mt-8 space-y-1">
        {pages.map(id => {
          const { label, icon: Icon } = NAV[id];
          const badge = badges[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${page === id ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="flex-1 text-left">{label}</span>
              {!!badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-extrabold text-white" style={{ background: clinic.brand.primary }}>
            {clinic.brand.logo ? <img src={clinic.brand.logo} alt="" className="h-full w-full bg-white object-contain" /> : initials(clinic.name)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold">{clinic.name}</div>
            <div className="truncate text-xs text-slate-400">{clinic.ownerName || 'Klinika'}</div>
          </div>
        </div>
        {footer}
      </div>
    </aside>
  );
}

/** Telefon va planshetda: yuqorida logo va bo'limlar */
export function MobileNav({ pages, page, setPage, right }: { pages: Page[]; page: Page; setPage: (p: Page) => void; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between px-4 pt-3"><Logo />{right}</div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2">
        {pages.map(id => {
          const { label, icon: Icon } = NAV[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${page === id ? 'bg-teal-50 text-teal-800' : 'text-slate-600'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
