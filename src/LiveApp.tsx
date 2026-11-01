import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isClinic } from './data/industries';
import type { Business, LiveStatus } from './types';
import { api, session, type Who } from './data/api';
import { Rail } from './components/Rail';
import { WakeOverlay } from './components/WakeOverlay';
import { useWake } from './lib/useWake';
import { TEAM, isMember, useTeam } from './components/team';
import { Button } from './components/ui';
import { useFontsReady, useNow, useToast } from './lib/hooks';
import { hrefOf, routeFromHash, type Area, type Route } from './lib/nav';
import { AiPage } from './pages/AiPage';
import { AnalystArea, AssistantArea, MarketingArea, ReceptionArea, SettingsArea, WatchArea } from './pages/TeamPages';
import { MiyaArea } from './pages/VaultPage';

/**
 * Panel — bitta dastur, AI jamoa atrofida: bosh ekran (Palantir, ovoz bilan), besh xodim (Qabulxona, Yordamchi, Kuzatuvchi,
 * Tahlilchi, Marketolog), Miya (Obsidian kabi) va Sozlamalar. Chapda (telefonda — pastda) bir xil ustun. Ko'rinish qorong'i (index.css: .night).
 */
const TITLES: Record<Area, string> = {
  ai: 'Palantir', qabulxona: TEAM.qabulxona.name, yordamchi: TEAM.yordamchi.name, kuzatuvchi: TEAM.kuzatuvchi.name,
  tahlilchi: TEAM.tahlilchi.name, marketolog: 'Marketing', miya: 'Miya', sozlamalar: 'Sozlamalar',
};

const ALL_AREAS: Area[] = ['ai', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi', 'marketolog', 'miya', 'sozlamalar'];
const areasFor = (who: Who | null): Area[] =>
  who?.kind !== 'staff' ? ALL_AREAS : who.access === 'manager' ? ALL_AREAS.filter(a => a !== 'sozlamalar') : ['qabulxona'];

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
    }).catch(e => { if (!stale && !loaded.current) setError((e as Error).message); });
    return () => { stale = true; };
  }, [route.area]);

  const notify = (text: string, isError = false) => setToast({ text, error: isError });
  // Klinika xodimi (server/access.ts): qabulxona — faqat Qabulxona; boshqaruvchi — Sozlamalarsiz hammasi. Yopiq bo'limga kirsa — o'zinikiga
  const allowed = areasFor(who);
  const closed = !allowed.includes(route.area);
  const home = allowed[0];
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
  if (!biz || !status) return <div className="night flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  if (closed) return <div className="night flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  const { area, tab } = route;
  const common = { biz, status, now, notify, onChanged: changed, tab, tick, state: isMember(area) ? team?.[area] ?? null : null };

  return (
    <div className="night min-h-dvh pb-20 lg:pb-0 lg:pl-[92px]">
      <Rail area={area} team={team} ownerName={who?.kind === 'staff' ? who.name : biz.ownerName} onLogout={logout} wake={wake} allowed={allowed} />
      <WakeOverlay wake={wake} />
      {area === 'ai' ? (
        <main key="ai" ref={main} tabIndex={-1} className="outline-none">
          <AiPage biz={biz} status={status} now={now} team={team} notify={notify} tick={tick} onChanged={changed} />
        </main>
      ) : (
        <main key={area} ref={main} tabIndex={-1} className={`animate-rise mx-auto w-full px-4 py-5 outline-none sm:px-6 sm:py-7 lg:px-10 lg:py-9 ${area === 'miya' ? 'max-w-[1500px]' : 'max-w-6xl'}`}>
          {area === 'qabulxona' && <ReceptionArea {...common} limited={who?.kind === 'staff' && who.access === 'reception'} />}
          {area === 'yordamchi' && <AssistantArea {...common} />}
          {area === 'kuzatuvchi' && <WatchArea {...common} />}
          {area === 'tahlilchi' && <AnalystArea {...common} />}
          {area === 'marketolog' && <MarketingArea {...common} onStatus={setStatus} kontent={team?.kontent ?? null} />}
          {area === 'miya' && <MiyaArea tab={tab} notify={notify} />}
          {area === 'sozlamalar' && (
            <SettingsArea {...common} onStatus={setStatus} onBiz={setBiz} offeringsRev={offeringsRev} onSaved={(b, rev) => { setBiz(b); setOfferingsRev(rev); }} />
          )}
        </main>
      )}
      {toast && (
        <div role="status" className={`animate-pop fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lift lg:bottom-5 lg:left-[calc(50%+46px)] ${toast.error ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
