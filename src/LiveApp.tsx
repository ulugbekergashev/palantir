import { useEffect, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import type { Business, LiveStatus } from './types';
import { api, session } from './data/api';
import { MobileNav, PAGES, Sidebar, type Page } from './components/Sidebar';
import { Button } from './components/ui';
import { useFontsReady, useNow, useToast } from './lib/hooks';
import { iso } from './lib/week';
import { BusinessPage } from './pages/BusinessPage';
import { ChatPage } from './pages/ChatPage';
import { LeadsPage } from './pages/LeadsPage';
import { DocumentsPage, PostsPage } from './pages/LibraryPages';
import { TasksPage } from './pages/TasksPage';
import { TelegramPage } from './pages/TelegramPage';

/** Manzildagi bo'lim: #/tasks, #/leads… (bo'lmasa — yordamchi) */
const pageFromHash = (): Page => {
  const p = window.location.hash.replace(/^#\/?/, '').split('/')[0] as Page;
  return PAGES.includes(p) ? p : 'chat';
};

export default function LiveApp() {
  useFontsReady();
  const now = useNow();
  const [toast, setToast] = useToast();
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [biz, setBiz] = useState<Business | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [error, setError] = useState('');
  const [dueToday, setDueToday] = useState(0);

  const notify = (text: string, isError = false) => setToast({ text, error: isError });
  const setPage = (p: Page) => { window.location.hash = `#/${p}`; };

  useEffect(() => {
    const on = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    api.me().then(r => { setBiz(r.business); setStatus(r.status); }).catch(e => setError((e as Error).message));
  }, []);

  // Bugungi va kechikkan vazifalar soni — menyudagi belgi
  useEffect(() => {
    const today = `${iso(new Date())}T23:59`;
    api.tasks('open').then(r => setDueToday(r.tasks.filter(t => t.dueAt && t.dueAt <= today).length)).catch(() => {});
  }, [page]);

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

  const badges = { tasks: dueToday };
  const logoutButton = <Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" /> Chiqish</Button>;

  return (
    <div className="flex min-h-screen">
      <Sidebar page={page} setPage={setPage} biz={biz} badges={badges} footer={logoutButton} />
      <div className="min-w-0 flex-1">
        <MobileNav page={page} setPage={setPage} right={logoutButton} badges={badges} />
        <main className={`mx-auto w-full p-4 sm:p-6 lg:p-8 ${page === 'chat' ? 'max-w-5xl' : 'max-w-6xl'}`}>
          {page === 'chat' && <ChatPage biz={biz} status={status} notify={notify} now={now} />}
          {page === 'tasks' && <TasksPage now={now} notify={notify} />}
          {page === 'leads' && <LeadsPage status={status} notify={notify} />}
          {page === 'documents' && <DocumentsPage notify={notify} />}
          {page === 'posts' && <PostsPage biz={biz} status={status} notify={notify} />}
          {page === 'business' && <BusinessPage biz={biz} onSaved={setBiz} notify={notify} />}
          {page === 'telegram' && <TelegramPage status={status} onStatus={setStatus} notify={notify} />}
        </main>
      </div>
      {toast && (
        <div role="status" className={`animate-pop fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${toast.error ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
