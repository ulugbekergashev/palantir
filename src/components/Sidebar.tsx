import type { ReactNode } from 'react';
import { Brain, Building2, CheckSquare, FileText, Image, MessageCircle, MessagesSquare, Plug, Users, type LucideIcon } from 'lucide-react';
import type { Business } from '../types';
import { initials } from '../lib/text';

export type Page = 'chat' | 'inbox' | 'tasks' | 'leads' | 'documents' | 'posts' | 'business' | 'telegram';

const NAV: Record<Page, { label: string; icon: LucideIcon }> = {
  chat: { label: 'Yordamchi', icon: MessageCircle },
  inbox: { label: 'Suhbatlar', icon: MessagesSquare },
  tasks: { label: 'Vazifalar', icon: CheckSquare },
  leads: { label: 'Mijozlar', icon: Users },
  documents: { label: 'Hujjatlar', icon: FileText },
  posts: { label: 'Postlar', icon: Image },
  business: { label: 'Biznes profili', icon: Building2 },
  telegram: { label: 'Ulanishlar', icon: Plug },
};

export const PAGES = Object.keys(NAV) as Page[];

export function Logo({ subtitle = 'AI yordamchi' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
        <Brain className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <div className="text-[17px] font-extrabold tracking-tight">Cerebro</div>
        <div className="text-[11px] font-medium text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}

export function Sidebar({ page, setPage, biz, badges = {}, footer }: {
  page: Page; setPage: (p: Page) => void; biz: Business; badges?: Partial<Record<Page, number>>; footer?: ReactNode;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
      <Logo />
      <nav className="mt-8 space-y-1">
        {PAGES.map(id => {
          const { label, icon: Icon } = NAV[id];
          const badge = badges[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${page === id ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-extrabold text-white" style={{ background: biz.brand.primary }}>
            {biz.brand.logo ? <img src={biz.brand.logo} alt="" className="h-full w-full bg-white object-contain" /> : initials(biz.name)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold">{biz.name}</div>
            <div className="truncate text-xs text-slate-400">{biz.ownerName || biz.industry || 'Biznes'}</div>
          </div>
        </div>
        {footer}
      </div>
    </aside>
  );
}

/** Telefon va planshetda: yuqorida logo va bo'limlar */
export function MobileNav({ page, setPage, right, badges = {} }: { page: Page; setPage: (p: Page) => void; right?: ReactNode; badges?: Partial<Record<Page, number>> }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between px-4 pt-3"><Logo />{right}</div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2">
        {PAGES.map(id => {
          const { label, icon: Icon } = NAV[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${page === id ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {!!badges[id] && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{badges[id]}</span>}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
