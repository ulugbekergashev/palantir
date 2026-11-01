/**
 * Chap ustun (telefonda — pastki panel): Palantir (ovoz), AI jamoa, Miya, Sozlamalar. Hamma bo'limda bir xil — dastur bitta.
 * Telefonda pastda — Palantir va jamoa (yetti tugma, barmoq sig'adi); Miya, Sozlamalar, Quloq va Chiqish — «Ko'proq» ichida.
 */
import { useEffect, useRef, useState } from 'react';
import { Brain, Ear, EarOff, Ellipsis, Lock, LogOut, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { DEPARTMENTS } from '../pages/ComingSoon';
import type { Wake } from '../lib/useWake';
import type { Area } from '../lib/nav';
import { hrefOf } from '../lib/nav';
import { DEPARTMENT_LABEL, DEPARTMENT_OF, MEMBERS, RAIL_MEMBERS, TEAM, type Member, type MemberState } from './team';

interface Item { area: Area; label: string; icon: LucideIcon; badge?: number; /** Bo'lim hali ishlamaydi — tez kunda */ locked?: boolean }

/** Telefonning pastki panelida yetti tugma sig'ishi uchun qisqa nomlar (kompyuterda — to'liq) */
const SHORT: Partial<Record<Area, string>> = { qabulxona: 'Qabul', yordamchi: 'Yordam', kuzatuvchi: 'Kamera', tahlilchi: 'Tahlil', marketolog: 'SMM' };
/** Telefonda «Ko'proq» ichida turadigan bo'limlar */
const MORE: Area[] = ['hr', 'miya', 'sozlamalar'];

const EAR: Record<Wake['phase'], { dot: string; hint: string }> = {
  off: { dot: '', hint: "O'chiq — yoqsangiz, «Palantir» yoki «Jarvis» deb chaqirasiz" },
  starting: { dot: 'bg-glass/40', hint: 'Ulanmoqda…' },
  listening: { dot: 'bg-emerald-400 animate-pulse', hint: "Tinglayapti — «Palantir, …» deb ayting (ovoz shu kompyuterdan chiqmaydi)" },
  live: { dot: 'bg-[#ff9a3c]', hint: 'Suhbat ketyapti' },
  paused: { dot: 'bg-glass/40', hint: 'Boshqa ovozli suhbat yoki boshqa oyna tinglayapti — bo‘shagach shu yerda tinglaydi' },
  error: { dot: 'bg-[#f5b454]', hint: 'Ulanmadi — qayta urinadi' },
};

/** allowed — shu kirishga ochiq bo'limlar (klinika xodimi: server/access.ts); berilmasa — hammasi */
export function Rail({ area, team, ownerName, onLogout, wake, allowed }: { area: Area; team: Record<Member, MemberState> | null; ownerName: string; onLogout: () => void; wake: Wake; allowed?: Area[] }) {
  const open = (a: Area) => !allowed || allowed.includes(a);
  const items: Item[] = [
    { area: 'ai' as Area, label: 'Palantir', icon: Sparkles },
    // Bo'lim tugmasidagi nishon — ichidagi xodimlarniki bilan birga (Marketing: Marketolog + Kontent-meyker)
    ...RAIL_MEMBERS.map(m => ({ area: m as Area, label: DEPARTMENT_LABEL[m] ?? TEAM[m].name, icon: TEAM[m].icon, badge: team ? MEMBERS.filter(x => x === m || DEPARTMENT_OF[x]?.area === m).reduce((n, x) => n + team[x].badge, 0) : undefined })),
    { area: 'hr' as Area, label: DEPARTMENTS.hr.name, icon: DEPARTMENTS.hr.icon, locked: true },
    { area: 'miya' as Area, label: 'Miya', icon: Brain },
  ].filter(it => open(it.area));
  const [more, setMore] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !sheet.current?.contains(e.target as Node)) setMore(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [more]);

  const link = (it: Item) => {
    const active = area === it.area;
    // Miya va Sozlamalar telefonda pastki panelda emas — «Ko'proq» ichida
    const desktopOnly = MORE.includes(it.area) ? 'hidden lg:flex' : 'flex';
    return (
      <a
        key={it.area}
        href={hrefOf(it.area)}
        aria-current={active ? 'page' : undefined}
        aria-label={it.label}
        className={`group relative ${desktopOnly} min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[11px] font-medium no-underline transition-colors lg:flex-none lg:py-2 ${active ? 'text-[#f2f0ea]' : 'text-[#8a909c] hover:text-[#d9dbe1]'}`}
      >
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${active ? 'bg-[#ff9a3c]/18 text-[#ffd9a0]' : 'group-hover:bg-glass/5'}`}>
          <it.icon className="h-[19px] w-[19px]" aria-hidden="true" />
          {it.locked && <Lock className="absolute ml-5 mt-5 h-3 w-3 rounded-full bg-[#07080b] p-[1px] text-[#c9cbd2]" aria-hidden="true" />}
        </span>
        <span className="max-w-full truncate lg:hidden" aria-hidden="true">{SHORT[it.area] ?? it.label}</span>
        <span className="hidden max-w-full truncate lg:inline" aria-hidden="true">{it.label}</span>
        {!!it.badge && <span className="absolute right-1.5 top-1 min-w-[18px] rounded-full bg-[#f5b454] px-1 text-center text-[10px] font-bold leading-[18px] text-[#07080b] lg:right-3">{it.badge}</span>}
      </a>
    );
  };
  return (
    <nav aria-label="Bo'limlar" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-glass/[0.06] bg-[#07080b]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-x-auto lg:inset-y-0 lg:left-0 lg:w-[92px] lg:flex-col lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-2 lg:py-4 lg:[scrollbar-width:none]">
      <a href={hrefOf('ai')} className="mb-4 hidden justify-center lg:flex" aria-label="Palantir — bosh ekran"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" /></a>
      <div className="flex flex-1 gap-0.5 lg:flex-none lg:flex-col lg:gap-1">{items.map(link)}</div>
      <div className="hidden flex-1 lg:block" />
      <div ref={sheet} className="relative flex w-[calc(100%/7)] lg:hidden">
        <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} aria-controls="koproq" aria-label="Ko'proq"
          className={`group flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[11px] font-medium transition-colors ${more || MORE.includes(area) ? 'text-[#f2f0ea]' : 'text-[#8a909c]'}`}>
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${more || MORE.includes(area) ? 'bg-[#ff9a3c]/18 text-[#ffd9a0]' : ''}`}>
            <Ellipsis className="h-[19px] w-[19px]" aria-hidden="true" />
          </span>
          <span aria-hidden="true">Ko'proq</span>
          {wake.enabled && EAR[wake.phase].dot && <span className={`absolute right-3 top-2 h-2 w-2 rounded-full ${EAR[wake.phase].dot}`} aria-hidden="true" />}
        </button>
        {more && (
          <div id="koproq" role="menu" aria-label="Ko'proq" className="absolute bottom-[calc(100%+8px)] right-1 w-56 rounded-2xl border border-glass/[0.08] bg-[#0b0c10] p-1.5 shadow-2xl">
            {[{ area: 'hr' as Area, label: `${DEPARTMENTS.hr.name} · tez kunda`, icon: DEPARTMENTS.hr.icon }, { area: 'miya' as Area, label: 'Miya', icon: Brain }, { area: 'sozlamalar' as Area, label: 'Sozlamalar', icon: Settings }].filter(it => open(it.area)).map(it => (
              <a key={it.area} role="menuitem" href={hrefOf(it.area)} onClick={() => setMore(false)} aria-current={area === it.area ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] no-underline ${area === it.area ? 'bg-[#ff9a3c]/12 text-[#f2f0ea]' : 'text-[#d9dbe1] active:bg-glass/5'}`}>
                <it.icon className="h-[18px] w-[18px]" aria-hidden="true" />{it.label}
              </a>
            ))}
            <button type="button" role="menuitemcheckbox" aria-checked={wake.enabled} onClick={wake.toggle}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] text-[#d9dbe1] active:bg-glass/5">
              {wake.enabled ? <Ear className="h-[18px] w-[18px]" aria-hidden="true" /> : <EarOff className="h-[18px] w-[18px]" aria-hidden="true" />}
              <span className="min-w-0 flex-1">Quloq<span className="block text-[12px] text-[#8a909c]">{wake.enabled ? EAR[wake.phase].hint : "o'chiq"}</span></span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMore(false); onLogout(); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] text-[#d9dbe1] active:bg-glass/5">
              <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />Chiqish<span className="ml-auto truncate text-[12px] text-[#8a909c]">{ownerName}</span>
            </button>
          </div>
        )}
      </div>
      <div className="hidden lg:flex lg:w-auto lg:flex-col lg:gap-1">
        <button type="button" onClick={wake.toggle} aria-pressed={wake.enabled} title={`Quloq: ${EAR[wake.phase].hint}`}
          className={`group relative hidden min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors lg:flex ${wake.enabled ? 'text-[#ffd9a0]' : 'text-[#8a909c] hover:text-[#d9dbe1]'}`}
          aria-describedby="quloq-holat">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${wake.enabled ? 'bg-[#ff9a3c]/18' : 'group-hover:bg-glass/5'}`}>
            {wake.enabled ? <Ear className="h-[19px] w-[19px]" aria-hidden="true" /> : <EarOff className="h-[19px] w-[19px]" aria-hidden="true" />}
          </span>
          Quloq
          <span id="quloq-holat" className="sr-only">{wake.phase === 'error' && wake.error ? wake.error : EAR[wake.phase].hint}</span>
          {wake.enabled && EAR[wake.phase].dot && <span className={`absolute right-4 top-2 h-2 w-2 rounded-full ${EAR[wake.phase].dot}`} aria-hidden="true" />}
        </button>
        {open('sozlamalar') && link({ area: 'sozlamalar', label: 'Sozlamalar', icon: Settings })}
        <button type="button" onClick={onLogout} title={`Chiqish (${ownerName})`} className="hidden min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] text-[#8a909c] transition-colors hover:text-[#d9dbe1] lg:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-glass/5"><LogOut className="h-[18px] w-[18px]" aria-hidden="true" /></span>
          Chiqish
        </button>
      </div>
    </nav>
  );
}
