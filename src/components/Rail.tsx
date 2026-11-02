/**
 * Chap ustun (telefonda — pastki panel): Palantir (ovoz), AI jamoa, Miya, Sozlamalar. Hamma bo'limda bir xil — dastur bitta.
 * Kompyuterda — ixcham qatorlar (belgi va nom bir qatorda), guruhlarga bo'lingan: past ekranda ham hamma bo'lim ko'rinadi.
 * Tepadagi tugma ustunni yig'adi (faqat belgilar) — tanlov shu kompyuterda eslab qolinadi; kenglik --rail o'zgaruvchisida (LiveApp).
 * Telefonda pastda — Palantir va jamoa (yetti tugma, barmoq sig'adi); Miya, Sozlamalar, Quloq va Chiqish — «Ko'proq» ichida.
 */
import { useEffect, useRef, useState } from 'react';
import { Brain, Compass, Ear, EarOff, Ellipsis, Hourglass, Lock, LogOut, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { UPCOMING } from '../pages/ComingSoon';
import type { Wake } from '../lib/useWake';
import type { Area } from '../lib/nav';
import { hrefOf } from '../lib/nav';
import { DEPARTMENT_LABEL, DEPARTMENT_OF, MEMBERS, RAIL_MEMBERS, TEAM, type Member, type MemberState } from './team';

interface Item { area: Area; label: string; icon: LucideIcon; badge?: number; /** Bo'lim hali ishlamaydi — tez kunda */ locked?: boolean; /** Xodim ishlayapti (yashil nuqta) */ live?: boolean }

/** Telefonning pastki panelida yetti tugma sig'ishi uchun qisqa nomlar (kompyuterda — to'liq) */
const SHORT: Partial<Record<Area, string>> = { qabulxona: 'Qabul', yordamchi: 'Yordam', kuzatuvchi: 'Kamera', tahlilchi: 'Tahlil', marketolog: 'SMM' };
/** Telefonda «Ko'proq» ichida turadigan bo'limlar */
const MORE: Area[] = ['direktor', 'tezkunda', 'miya', 'sozlamalar'];
/** Kompyuterdagi kenglik: to'liq va yig'ilgan (px) — sahifa shu qadar o'ngga suriladi */
const WIDE = 224, NARROW = 68;
const FOLD_KEY = 'palantir:rail-yigilgan';

const EAR: Record<Wake['phase'], { dot: string; hint: string }> = {
  off: { dot: '', hint: "O'chiq — yoqsangiz, «Palantir» yoki «Jarvis» deb chaqirasiz" },
  starting: { dot: 'bg-glass/40', hint: 'Ulanmoqda…' },
  listening: { dot: 'bg-emerald-400 animate-pulse', hint: "Tinglayapti — «Palantir, …» deb ayting (ovoz shu kompyuterdan chiqmaydi)" },
  live: { dot: 'bg-[#ff9a3c]', hint: 'Suhbat ketyapti' },
  paused: { dot: 'bg-glass/40', hint: 'Boshqa ovozli suhbat yoki boshqa oyna tinglayapti — bo‘shagach shu yerda tinglaydi' },
  error: { dot: 'bg-[#f5b454]', hint: 'Ulanmadi — qayta urinadi' },
};

const readFold = (): boolean => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } };

/** allowed — shu kirishga ochiq bo'limlar (klinika xodimi: server/access.ts); berilmasa — hammasi */
export function Rail({ area, team, ownerName, onLogout, wake, allowed }: { area: Area; team: Record<Member, MemberState> | null; ownerName: string; onLogout: () => void; wake: Wake; allowed?: Area[] }) {
  const open = (a: Area) => !allowed || allowed.includes(a);
  const [folded, setFolded] = useState(readFold);
  useEffect(() => {
    document.documentElement.style.setProperty('--rail', `${folded ? NARROW : WIDE}px`);
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* xususiy oyna — eslab qolinmaydi */ }
  }, [folded]);

  const home: Item[] = [{ area: 'ai' as Area, label: 'Palantir', icon: Sparkles }].filter(it => open(it.area));
  // Bo'lim tugmasidagi nishon — ichidagi xodimlarniki bilan birga (Marketing: Marketolog + Kontent-meyker)
  const crew: Item[] = RAIL_MEMBERS.map(m => {
    const inside = MEMBERS.filter(x => x === m || DEPARTMENT_OF[x]?.area === m);
    return { area: m as Area, label: DEPARTMENT_LABEL[m] ?? TEAM[m].name, icon: TEAM[m].icon, badge: team ? inside.reduce((n, x) => n + team[x].badge, 0) : undefined, live: !!team && inside.some(x => team[x].live) };
  }).filter(it => open(it.area));
  const rest: Item[] = [
    { area: 'tezkunda' as Area, label: 'Tez kunda', icon: Hourglass, locked: true },
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

  /** Kompyuterdagi qator: to'liq — belgi va nom yonma-yon; yig'ilgan — faqat belgi (nom ekran o'quvchisi va maslahat uchun) */
  const row = folded ? 'lg:h-10 lg:w-11 lg:flex-none lg:justify-center lg:self-center lg:px-0' : 'lg:h-9 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-2.5';
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
        title={folded ? it.label : undefined}
        className={`group relative ${desktopOnly} min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[11px] font-medium no-underline transition-colors lg:min-h-0 lg:rounded-lg lg:py-0 lg:text-[13.5px] ${row} ${active ? 'text-[#f2f0ea] lg:bg-[#ff9a3c]/[0.13]' : 'text-[#8a909c] hover:text-[#d9dbe1] lg:hover:bg-glass/[0.05]'}`}
      >
        {active && <span aria-hidden="true" className="absolute -left-2 top-1.5 hidden h-6 w-[3px] rounded-r-full bg-[#ff9a3c] lg:block" />}
        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors lg:h-auto lg:w-auto lg:rounded-none lg:bg-transparent ${active ? 'bg-[#ff9a3c]/18 text-[#ffd9a0]' : 'group-hover:bg-glass/5 lg:group-hover:bg-transparent'}`}>
          <it.icon className="h-[19px] w-[19px] lg:h-[18px] lg:w-[18px]" aria-hidden="true" />
          {it.locked && <Lock className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-[#07080b] p-[1px] text-[#c9cbd2]" aria-hidden="true" />}
          {it.live && folded && <span aria-hidden="true" className="absolute -right-1 -top-1 hidden h-2 w-2 rounded-full bg-emerald-400 lg:block" />}
        </span>
        <span className="max-w-full truncate lg:hidden" aria-hidden="true">{SHORT[it.area] ?? it.label}</span>
        <span className={folded ? 'sr-only' : 'hidden min-w-0 flex-1 truncate lg:inline'} aria-hidden="true">{it.label}</span>
        {it.live && !folded && <span aria-hidden="true" title="Ishlayapti" className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 lg:block" />}
        {!!it.badge && (
          <span className={`absolute right-1.5 top-1 min-w-[18px] rounded-full bg-[#f5b454] px-1 text-center text-[10px] font-bold leading-[18px] text-[#07080b] ${folded ? 'lg:-right-1 lg:-top-1' : 'lg:static lg:shrink-0'}`}>{it.badge}</span>
        )}
      </a>
    );
  };
  /** Guruh sarlavhasi — faqat kompyuterda; yig'ilganda — ingichka chiziq */
  const group = (title: string) => (folded
    ? <div aria-hidden="true" className="mx-3 my-2 hidden h-px bg-glass/[0.07] lg:block" />
    : <div aria-hidden="true" className="hidden px-2.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#5f6571] lg:block">{title}</div>);
  const tool = `hidden items-center rounded-lg text-[13px] transition-colors lg:flex ${folded ? 'h-10 w-11 justify-center self-center' : 'h-9 gap-3 px-2.5'}`;

  return (
    <nav aria-label="Bo'limlar" className={`fixed inset-x-0 bottom-0 z-40 flex border-t border-glass/[0.06] bg-[#07080b]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-x-auto lg:inset-y-0 lg:left-0 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-t-0 lg:bg-[#08090c] lg:py-3 lg:[scrollbar-width:none] ${folded ? 'lg:w-[68px] lg:px-2' : 'lg:w-[224px] lg:px-3'}`}>
      <div className={`mb-2 hidden items-center lg:flex ${folded ? 'flex-col gap-2' : 'gap-2.5 px-1'}`}>
        <a href={hrefOf('ai')} className="flex shrink-0 no-underline" aria-label="Palantir — bosh ekran">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
        </a>
        {/* Nom havoladan tashqarida: menyu havolalari ro'yxatida «Palantir» ikki marta chiqmasin */}
        {!folded && <span aria-hidden="true" className="min-w-0 truncate text-[16px] font-bold tracking-tight text-[#f2f0ea]">Palantir</span>}
        <button type="button" onClick={() => setFolded(v => !v)} aria-label={folded ? 'Menyuni yoyish' : "Menyuni yig'ish"} title={folded ? 'Menyuni yoyish' : "Menyuni yig'ish"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6c727e] transition-colors hover:bg-glass/[0.06] hover:text-[#d9dbe1] ${folded ? '' : 'ml-auto'}`}>
          {folded ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="flex flex-1 gap-0.5 lg:flex-none lg:flex-col">
        {home.map(link)}
        {crew.length > 0 && group('AI jamoa')}
        {crew.map(link)}
        {rest.length > 0 && group('Boshqa')}
        {rest.map(link)}
      </div>
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
            {[{ area: 'direktor' as Area, label: 'Direktor', icon: Compass }, { area: 'tezkunda' as Area, label: `Tez kunda · ${UPCOMING.length} ta xodim`, icon: Hourglass }, { area: 'miya' as Area, label: 'Miya', icon: Brain }, { area: 'sozlamalar' as Area, label: 'Sozlamalar', icon: Settings }].filter(it => open(it.area)).map(it => (
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
      <div className="hidden border-t border-glass/[0.06] pt-2 lg:flex lg:flex-col lg:gap-0.5">
        <button type="button" onClick={wake.toggle} aria-pressed={wake.enabled} title={`Quloq: ${EAR[wake.phase].hint}`} aria-describedby="quloq-holat"
          className={`relative ${tool} ${wake.enabled ? 'bg-[#ff9a3c]/[0.1] text-[#ffd9a0]' : 'text-[#8a909c] hover:bg-glass/[0.05] hover:text-[#d9dbe1]'}`}>
          {wake.enabled ? <Ear className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /> : <EarOff className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />}
          <span className={folded ? 'sr-only' : 'min-w-0 flex-1 truncate text-left'}>Quloq</span>
          <span id="quloq-holat" className="sr-only">{wake.phase === 'error' && wake.error ? wake.error : EAR[wake.phase].hint}</span>
          {wake.enabled && EAR[wake.phase].dot && <span className={`h-2 w-2 shrink-0 rounded-full ${EAR[wake.phase].dot} ${folded ? 'absolute right-1.5 top-1.5' : ''}`} aria-hidden="true" />}
        </button>
        {open('sozlamalar') && link({ area: 'sozlamalar', label: 'Sozlamalar', icon: Settings })}
        <button type="button" onClick={onLogout} title={`Chiqish (${ownerName})`} className={`${tool} text-[#8a909c] hover:bg-glass/[0.05] hover:text-[#d9dbe1]`}>
          <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span className={folded ? 'sr-only' : 'min-w-0 flex-1 truncate text-left'}>Chiqish{ownerName && <span className="ml-1.5 text-[12px] text-[#5f6571]">· {ownerName}</span>}</span>
        </button>
      </div>
    </nav>
  );
}
