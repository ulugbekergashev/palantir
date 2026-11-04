import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isClinic } from './data/industries';
import type { Business, LiveStatus } from './types';
import { api, session, type Who } from './data/api';
import { Rail } from './components/Rail';
import { WakeOverlay } from './components/WakeOverlay';
import { useWake } from './lib/useWake';
import { DEPARTMENT_OF, TEAM, isMember, useTeam, type Member } from './components/team';
import { Button } from './components/ui';
import { useFontsReady, useNow, useToast } from './lib/hooks';
import { AREAS, hrefOf, routeFromHash, type Area, type Route } from './lib/nav';
import { AiPage } from './pages/AiPage';
import { AnalystArea, AssistantArea, MarketingArea, ReceptionArea, SettingsArea, WatchArea } from './pages/TeamPages';
import { MiyaArea } from './pages/VaultPage';
import { DirectorArea } from './pages/DirectorPage';
import { CrewArea } from './pages/CrewPage';

/**
 * Panel — bitta dastur, AI jamoa atrofida: bosh ekran (Palantir, ovoz bilan), jamoadagi xodimlar (standart — Direktor va Yordamchi,
 * qolganini egasi «AI xodimlar»da ishga oladi: src/lib/crew.ts), Miya (Obsidian kabi) va Sozlamalar. Chapda (telefonda — pastda) bir xil ustun.
 * Ko'rinish qorong'i (index.css: .night).
 */
const TITLES: Record<Area, string> = {
  ai: 'Palantir', direktor: TEAM.direktor.name, qabulxona: TEAM.qabulxona.name, yordamchi: TEAM.yordamchi.name, kuzatuvchi: TEAM.kuzatuvchi.name,
  tahlilchi: TEAM.tahlilchi.name, marketolog: 'Marketing', xodimlar: 'AI xodimlar', miya: 'Miya', sozlamalar: 'Sozlamalar',
};

/** Hamma bo'lim — nav.ts dagi yagona ro'yxat (yangi bo'lim qo'shilsa, bu yerda alohida yozish shart emas) */
const ALL_AREAS: Area[] = AREAS;
const areasFor = (who: Who | null): Area[] =>
  who?.kind !== 'staff' ? ALL_AREAS : who.access === 'manager' ? ALL_AREAS.filter(a => a !== 'sozlamalar') : ['qabulxona'];

/** Xodim bo'limi jamoada bormi: Marketing — ichidagi xodimlardan biri olingan bo'lsa (Marketolog, Kontent-meyker, Targetolog) */
const crewOpen = (a: Area, crew: Member[]): boolean =>
  !isMember(a) || crew.some(m => m === a || DEPARTMENT_OF[m]?.area === a);

export default function LiveApp() {
  useFontsReady();
  const now = useNow();
  const [toast, setToast] = useToast();
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [biz, setBiz] = useState<Business | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [error, setError] = useState('');
  const [offeringsRev, setOfferingsRev] = useState('');
  const [who, setWho] = useState<Who | null>(null);
  const [crew, setCrew] = useState<Member[] | null>(null);
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);
  const main = useRef<HTMLElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    const on = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Bo'lim almashganda: sahifa boshidan, diqqat yangi mazmunga (klaviatura va ekran o'quvchi uchun), oyna sarlavhasi
  useEffect(() => {
    document.title = route.area === 'ai' ? 'Palantir' : `${TITLES[route.area]} · Palantir`;
    if (!opened.current) { opened.current = true; return; }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [route.area, route.tab]);

  // Sozlamalar boshqa joyda ham o'zgaradi — har bo'limga o'tganda yangisi olinadi
  useEffect(() => {
    let stale = false;
    api.me().then(r => {
      if (stale) return;
      loaded.current = true;
      setBiz(r.business);
      setStatus(r.status);
      setOfferingsRev(r.offeringsRev);
      setWho(r.who);
      setCrew(r.crew);
    }).catch(e => { if (!stale && !loaded.current) setError((e as Error).message); });
    return () => { stale = true; };
  }, [route.area]);

  const notify = (text: string, isError = false) => setToast({ text, error: isError });
  // Klinika xodimi (server/access.ts): qabulxona — faqat Qabulxona; boshqaruvchi — Sozlamalarsiz hammasi. Yopiq bo'limga kirsa — o'zinikiga
  // Jamoada yo'q xodimning bo'limi menyuda yo'q; manzil bilan ochilsa — «AI xodimlar» (u yerda ishga olinadi)
  const byAccess = areasFor(who);
  const inCrew = byAccess.filter(a => !crew || crewOpen(a, crew));
  const allowed = inCrew.length ? inCrew : byAccess;
  // Klinika xodimiga berilgan bo'lim (Qabulxona) egasi uni jamoadan olib tashlagan bo'lsa ham menyuda ko'rinsin
  const railCrew = !crew || inCrew.length ? crew ?? [] : [...crew, ...byAccess.filter(isMember)];
  const closed = !allowed.includes(route.area);
  const home = isMember(route.area) && allowed.includes('xodimlar') ? 'xodimlar' : allowed[0];
  useEffect(() => { if (closed) window.location.hash = hrefOf(home); }, [closed, home]);
  const team = useTeam(status ?? ({ crm: { account: null } } as unknown as LiveStatus), tick, !!biz && isClinic(biz.industry, !!status?.crm.account));
  const wake = useWake();
  // «Quloq» ishlay olmasa (model o'rnatilmagan, mikrofon yo'q) — egasi bilsin
  useEffect(() => { if (wake.phase === 'error' && wake.error) setToast({ text: `Quloq: ${wake.error}`, error: true }); }, [wake.phase, wake.error, setToast]);
  const changed = () => setTick(t => t + 1);
  const logout = () => { session.set(null); window.location.hash = ''; window.location.reload(); };

  if (error) {
    return (
      <div className="night flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-rose-700">{error}</p>
        <Button onClick={() => window.location.reload()}>Qayta urinish</Button>
      </div>
    );
  }
  if (!biz || !status || !crew) return <div className="night flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  if (closed) return <div className="night flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  const { area, tab } = route;
  const common = { biz, status, now, notify, onChanged: changed, tab, tick, state: isMember(area) ? team?.[area] ?? null : null };

  return (
    <div className="night min-h-dvh pb-20 lg:pb-0 lg:pl-[var(--rail,224px)]">
      <Rail area={area} team={team} crew={railCrew} ownerName={who?.kind === 'staff' ? who.name : biz.ownerName} onLogout={logout} wake={wake} allowed={allowed} />
      <WakeOverlay wake={wake} />
      {area === 'ai' ? (
        <main key="ai" ref={main} tabIndex={-1} className="outline-none">
          <AiPage biz={biz} status={status} now={now} team={team} crew={crew} notify={notify} tick={tick} onChanged={changed} />
        </main>
      ) : (
        <main key={area} ref={main} tabIndex={-1} className={`animate-rise mx-auto w-full px-4 py-5 outline-none sm:px-6 sm:py-7 lg:px-10 lg:py-9 ${area === 'miya' ? 'max-w-[1500px]' : 'max-w-6xl'}`}>
          {area === 'direktor' && <DirectorArea {...common} />}
          {area === 'qabulxona' && <ReceptionArea {...common} limited={who?.kind === 'staff' && who.access === 'reception'} />}
          {area === 'yordamchi' && <AssistantArea {...common} />}
          {area === 'kuzatuvchi' && <WatchArea {...common} />}
          {area === 'tahlilchi' && <AnalystArea {...common} />}
          {area === 'marketolog' && <MarketingArea {...common} crew={crew} onStatus={setStatus} kontent={team?.kontent ?? null} target={team?.target ?? null} />}
          {area === 'xodimlar' && <CrewArea crew={crew} onCrew={setCrew} notify={notify} owner={who?.kind !== 'staff'} />}
          {area === 'miya' && <MiyaArea tab={tab} notify={notify} />}
          {area === 'sozlamalar' && (
            <SettingsArea {...common} onStatus={setStatus} onBiz={setBiz} offeringsRev={offeringsRev} onSaved={(b, rev) => { setBiz(b); setOfferingsRev(rev); }} />
          )}
        </main>
      )}
      {toast && (
        <div role="status" className={`animate-pop fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lift lg:bottom-5 lg:left-[calc(50%+var(--rail,224px)/2)] ${toast.error ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
