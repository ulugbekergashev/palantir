import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { session } from './data/api';
import { LoginPage } from './pages/LoginPage';

const DemoApp = lazy(() => import('./DemoApp'));
const LiveApp = lazy(() => import('./LiveApp'));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));

/** Manzil: #/demo — sotuv demosi, #/admin — klinikalarni boshqarish, qolgani — klinika kabineti */
const route = () => (window.location.hash.startsWith('#/demo') ? 'demo' : window.location.hash.startsWith('#/admin') ? 'admin' : 'app');

export default function App() {
  const [where, setWhere] = useState(route);
  const [authed, setAuthed] = useState(() => !!session.token());
  useEffect(() => {
    const on = () => setWhere(route());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>}>
      {where === 'demo' ? <DemoApp /> : where === 'admin' ? <AdminPage /> : authed ? <LiveApp /> : <LoginPage onLogin={() => setAuthed(true)} />}
    </Suspense>
  );
}
