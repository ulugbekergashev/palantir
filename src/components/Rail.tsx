/**
 * Chap ustun (telefonda — pastki panel): Palantir (ovoz), AI jamoa, Miya, Sozlamalar. Hamma bo'limda bir xil — dastur bitta.
 */
import { Brain, Ear, EarOff, LogOut, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import type { Wake } from '../lib/useWake';
import type { Area } from '../lib/nav';
import { hrefOf } from '../lib/nav';
import { MEMBERS, TEAM, type Member, type MemberState } from './team';

interface Item { area: Area; label: string; icon: LucideIcon; badge?: number }

/** Telefonning pastki panelida yetti bo'lim sig'ishi uchun qisqa nomlar (kompyuterda — to'liq) */
const SHORT: Partial<Record<Area, string>> = { qabulxona: 'Qabul', yordamchi: 'Yordam', kuzatuvchi: 'Kamera', tahlilchi: 'Tahlil', sozlamalar: 'Sozlama' };

const EAR: Record<Wake['phase'], { dot: string; hint: string }> = {
  off: { dot: '', hint: "O'chiq — yoqsangiz, «Palantir» yoki «Jarvis» deb chaqirasiz" },
  starting: { dot: 'bg-glass/40', hint: 'Ulanmoqda…' },
  listening: { dot: 'bg-emerald-400 animate-pulse', hint: "Tinglayapti — «Palantir, …» deb ayting (ovoz shu kompyuterdan chiqmaydi)" },
  live: { dot: 'bg-[#8b8cff]', hint: 'Suhbat ketyapti' },
  paused: { dot: 'bg-glass/40', hint: 'Boshqa ovozli suhbat yoki boshqa oyna tinglayapti — bo‘shagach shu yerda tinglaydi' },
  error: { dot: 'bg-[#f5b454]', hint: 'Ulanmadi — qayta urinadi' },
};

export function Rail({ area, team, ownerName, onLogout, wake }: { area: Area; team: Record<Member, MemberState> | null; ownerName: string; onLogout: () => void; wake: Wake }) {
  const items: Item[] = [
    { area: 'ai', label: 'Palantir', icon: Sparkles },
    ...MEMBERS.map(m => ({ area: m as Area, label: TEAM[m].name, icon: TEAM[m].icon, badge: team?.[m].badge })),
    { area: 'miya', label: 'Miya', icon: Brain },
  ];
  const link = (it: Item) => {
    const active = area === it.area;
    return (
      <a
        key={it.area}
        href={hrefOf(it.area)}
        aria-current={active ? 'page' : undefined}
        aria-label={it.label}
        className={`group relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[10px] font-medium sm:text-[11px] no-underline transition-colors lg:flex-none lg:py-2 ${active ? 'text-[#f2f0ea]' : 'text-[#8a909c] hover:text-[#d9dbe1]'}`}
      >
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${active ? 'bg-[#8b8cff]/18 text-[#c7c8ff]' : 'group-hover:bg-glass/5'}`}>
          <it.icon className="h-[19px] w-[19px]" aria-hidden="true" />
        </span>
        <span className="max-w-full truncate lg:hidden" aria-hidden="true">{SHORT[it.area] ?? it.label}</span>
        <span className="hidden max-w-full truncate lg:inline" aria-hidden="true">{it.label}</span>
        {!!it.badge && <span className="absolute right-1.5 top-1 min-w-[18px] rounded-full bg-[#f5b454] px-1 text-center text-[10px] font-bold leading-[18px] text-[#07080b] lg:right-3">{it.badge}</span>}
      </a>
    );
  };
  return (
    <nav aria-label="Bo'limlar" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-glass/[0.06] bg-[#07080b]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-x-auto lg:inset-y-0 lg:left-0 lg:w-[92px] lg:flex-col lg:border-r lg:border-t-0 lg:px-2 lg:py-4">
      <a href={hrefOf('ai')} className="mb-4 hidden justify-center lg:flex" aria-label="Palantir — bosh ekran"><img src="/favicon.svg" alt="" className="h-9 w-9" /></a>
      <div className="flex flex-1 gap-0.5 lg:flex-none lg:flex-col lg:gap-1">{items.map(link)}</div>
      <div className="hidden flex-1 lg:block" />
      <div className="flex w-[calc(100%/7)] gap-0.5 lg:w-auto lg:flex-col lg:gap-1">
        <button type="button" onClick={wake.toggle} aria-pressed={wake.enabled} title={`Quloq: ${EAR[wake.phase].hint}`}
          className={`group relative hidden min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors lg:flex ${wake.enabled ? 'text-[#c7c8ff]' : 'text-[#8a909c] hover:text-[#d9dbe1]'}`}
          aria-describedby="quloq-holat">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${wake.enabled ? 'bg-[#8b8cff]/18' : 'group-hover:bg-glass/5'}`}>
            {wake.enabled ? <Ear className="h-[19px] w-[19px]" aria-hidden="true" /> : <EarOff className="h-[19px] w-[19px]" aria-hidden="true" />}
          </span>
          Quloq
          <span id="quloq-holat" className="sr-only">{wake.phase === 'error' && wake.error ? wake.error : EAR[wake.phase].hint}</span>
          {wake.enabled && EAR[wake.phase].dot && <span className={`absolute right-4 top-2 h-2 w-2 rounded-full ${EAR[wake.phase].dot}`} aria-hidden="true" />}
        </button>
        {link({ area: 'sozlamalar', label: 'Sozlamalar', icon: Settings })}
        <button type="button" onClick={onLogout} title={`Chiqish (${ownerName})`} className="hidden min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] text-[#8a909c] transition-colors hover:text-[#d9dbe1] lg:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-glass/5"><LogOut className="h-[18px] w-[18px]" aria-hidden="true" /></span>
          Chiqish
        </button>
      </div>
    </nav>
  );
}
