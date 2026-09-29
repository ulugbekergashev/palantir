import { BarChart3, Building2, LayoutGrid, MessageCircle, type LucideIcon } from 'lucide-react';
import type { Clinic } from '../types';
import { initials } from '../lib/text';

export type Page = 'package' | 'telegram' | 'report' | 'setup';

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'package', label: 'Haftalik paket', icon: LayoutGrid },
  { id: 'telegram', label: 'Telegram bot', icon: MessageCircle },
  { id: 'report', label: 'Natijalar', icon: BarChart3 },
  { id: 'setup', label: 'Klinika va brend', icon: Building2 },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700">
        <svg viewBox="0 0 100 100" className="h-5 w-5" aria-hidden="true">
          <path fill="#fff" d="M30 8C18 8 10 18 10 32c0 16 6 26 10 40 3 12 5 22 12 22s8-14 12-24c2-6 4-8 6-8s4 2 6 8c4 10 5 24 12 24s9-10 12-22c4-14 10-24 10-40 0-14-8-24-20-24-8 0-12 5-20 5S38 8 30 8z" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[17px] font-extrabold tracking-tight">Denta<span className="text-teal-700">Grow</span></div>
        <div className="text-[11px] font-medium text-slate-400">AI marketolog va dizayner</div>
      </div>
    </div>
  );
}

export function Sidebar({ page, setPage, clinic, pending }: { page: Page; setPage: (p: Page) => void; clinic: Clinic; pending: number }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
      <Logo />
      <nav className="mt-8 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPage(id)}
            aria-current={page === id ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${page === id ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="flex-1 text-left">{label}</span>
            {id === 'package' && pending > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{pending}</span>}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-extrabold text-white" style={{ background: clinic.brand.primary }}>
            {clinic.brand.logo ? <img src={clinic.brand.logo} alt="" className="h-full w-full bg-white object-contain" /> : initials(clinic.name)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold">{clinic.name}</div>
            <div className="truncate text-xs text-slate-400">{clinic.ownerName}</div>
          </div>
        </div>
        <p className="rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
          <b>Demo.</b> Matnlar tayyor namunalardan olinadi, ma'lumot faqat shu brauzerda saqlanadi. Haqiqiy versiyada matnni AI klinikangiz ma'lumotidan yozadi.
        </p>
      </div>
    </aside>
  );
}

/** Telefon va planshetda: yuqorida logo va bo'limlar */
export function MobileNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
      <div className="px-4 pt-3"><Logo /></div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2">
        {NAV.map(({ id, label, icon: Icon }) => (
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
        ))}
      </nav>
    </header>
  );
}
