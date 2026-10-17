import { useEffect, useRef, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import type { Business, LiveStatus } from './types';
import { api, session } from './data/api';
import { MOVED, PAGES, Sidebar, pageLabel, type Page } from './components/Sidebar';
import { Button } from './components/ui';
import { isMedical } from './lib/compliance';
import { connectionHealth } from './lib/health';
import { useFontsReady, useNow, useToast, useWide } from './lib/hooks';
import { iso } from './lib/week';
import { BrainPage } from './pages/BrainPage';
import { CallsPage } from './pages/CallsPage';
import { CamerasPage } from './pages/CamerasPage';
import { ChatPage } from './pages/ChatPage';
import { HomePage } from './pages/HomePage';
import { InboxPage } from './pages/InboxPage';
import { JournalPage } from './pages/JournalPage';
import { TelegramPage } from './pages/TelegramPage';

/** Manzildagi bo'lim: #/journal, #/inbox… (bo'sh yoki notanish manzil — bosh sahifa) */
const pageFromHash = (): Page => {
  const p = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return PAGES.includes(p as Page) ? p as Page : Object.hasOwn(MOVED, p) ? MOVED[p] : 'home';
};

export default function LiveApp() {
  useFontsReady();
  const now = useNow();
  const wide = useWide();
  const [toast, setToast] = useToast();
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [biz, setBiz] = useState<Business | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [error, setError] = useState('');
  const [dueToday, setDueToday] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [menu, setMenu] = useState(false);
  const [offeringsRev, setOfferingsRev] = useState('');
  const loaded = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  const main = useRef<HTMLElement>(null);
  const opened = useRef(false);
  // Tortma faqat tor ekranda bor: keng ekranda yon panel doim ochiq, sahifa esa to'silmaydi
  const drawerOpen = menu && !wide;
  // Klaviatura bilan ishlaganda: menyu ochilsa — diqqat uning ichiga, yopilsa — tugmaga qaytadi
  useEffect(() => {
    if (drawerOpen) document.querySelector<HTMLElement>('aside button[aria-current="page"]')?.focus();
    else if (menuWasOpen.current) menuButton.current?.focus();
    menuWasOpen.current = drawerOpen;
  }, [drawerOpen]);

  // Ekran kengayib yon panel doimiy bo'lsa, tortma «ochiq» bo'lib qolmaydi (yana torayganda o'zi ochilib ketmasin)
  useEffect(() => { if (wide) setMenu(false); }, [wide]);
  // Bo'lim almashganda: sahifa boshidan ko'rinadi, diqqat yangi mazmunga o'tadi (klaviatura va ekran o'quvchi uchun), oyna sarlavhasi yangilanadi
  useEffect(() => {
    document.title = `${pageLabel(page)} · Cerebro`;
    if (!opened.current) { opened.current = true; return; }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [page]);

  const notify = (text: string, isError = false) => setToast({ text, error: isError });
  const setPage = (p: Page) => { setMenu(false); window.location.hash = `#/${p}`; };
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    // Menyu ochiq turganda orqadagi sahifa aylanmaydi
    document.documentElement.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.documentElement.style.overflow = ''; };
  }, [drawerOpen]);

  useEffect(() => {
    // Brauzerning «orqaga» tugmasi bilan sahifa almashsa ham menyu yopiladi
    const on = () => { setMenu(false); setPageState(pageFromHash()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Sozlamalar boshqa joyda ham o'zgaradi (ikkinchi miyadagi narxlar, yordamchi yozgani) — har bo'limga o'tganda yangisi olinadi
  useEffect(() => {
    let stale = false;
    api.me().then(r => {
      if (stale) return;
      loaded.current = true;
      setBiz(r.business);
      setStatus(r.status);
      setOfferingsRev(r.offeringsRev);
    }).catch(e => { if (!stale && !loaded.current) setError((e as Error).message); });
    return () => { stale = true; };
  }, [page]);

  // Bugungi va kechikkan vazifalar, tasdiq kutayotgan javoblar soni — menyudagi belgi. Bo'lim almashganda va shu ishlar bajarilganda yangilanadi
  const refreshBadges = () => {
    const today = `${iso(new Date())}T23:59`;
    api.tasks('open').then(r => setDueToday(r.tasks.filter(t => t.dueAt && t.dueAt <= today).length)).catch(() => {});
    api.inbox().then(r => setWaiting(r.threads.reduce((n, t) => n + t.pending, 0))).catch(() => {});
  };
  useEffect(refreshBadges, [page]);

  const logout = () => { session.set(null); window.location.hash = ''; window.location.reload(); };

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-rose-700">{error}</p>
        <Button onClick={() => window.location.reload()}>Qayta urinish</Button>
      </div>
    );
  }
  if (!biz || !status) return <div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  const badges = { journal: dueToday, inbox: waiting };
  const health = connectionHealth(status, isMedical(biz.industry));

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Tor ekranda: yuqorida ingichka panel — menyu tugmasi va brend. Keng ekranda bo'limlar yon panelda doim ko'rinadi */}
      {!wide && (
        <header inert={drawerOpen} className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-paper/90 px-2 backdrop-blur">
          <button ref={menuButton} type="button" onClick={() => setMenu(true)} aria-label="Menyu" aria-expanded={drawerOpen} className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 transition-colors hover:bg-slate-200/80 active:bg-slate-200">
            <Menu className="h-5 w-5" aria-hidden="true" />
            {dueToday + waiting > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-paper bg-amber-500" aria-hidden="true" />}
          </button>
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-[15px] font-extrabold tracking-tight">Cerebro</span>
        </header>
      )}
      {drawerOpen && <div className="fixed inset-0 z-[45] bg-ink-950/50" onClick={() => setMenu(false)} aria-hidden="true" />}
      <Sidebar wide={wide} open={drawerOpen} page={page} setPage={setPage} biz={biz} health={health} badges={badges} onLogout={logout} />
      <div inert={drawerOpen} className="min-w-0">
        {/* key: bo'lim almashganda mazmun yengil ko'tarilib chiqadi */}
        <main key={page} ref={main} tabIndex={-1} className={`animate-rise mx-auto w-full px-4 py-4 outline-none sm:px-6 sm:py-6 lg:px-10 lg:py-8 ${page === 'chat' ? 'max-w-5xl' : 'max-w-6xl'}`}>
          {page === 'home' && <HomePage biz={biz} status={status} now={now} notify={notify} onChanged={refreshBadges} />}
          {page === 'chat' && <ChatPage biz={biz} status={status} notify={notify} now={now} />}
          {page === 'cameras' && <CamerasPage notify={notify} />}
          {page === 'calls' && <CallsPage notify={notify} />}
          {page === 'journal' && <JournalPage now={now} notify={notify} onChanged={refreshBadges} />}
          {page === 'brain' && <BrainPage notify={notify} />}
          {page === 'inbox' && <InboxPage notify={notify} onChanged={refreshBadges} />}
          {page === 'telegram' && <TelegramPage status={status} onStatus={setStatus} biz={biz} onBiz={setBiz} offeringsRev={offeringsRev} onSaved={(b, rev) => { setBiz(b); setOfferingsRev(rev); }} notify={notify} />}
        </main>
      </div>
      {toast && (
        <div role="status" className={`animate-pop fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lift lg:left-[calc(50%+8rem)] ${toast.error ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
