import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { session } from './data/api';
import { LoginPage } from './pages/LoginPage';

const LiveApp = lazy(() => import('./LiveApp'));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SetupWizard = lazy(() => import('./pages/setup/SetupWizard').then(m => ({ default: m.SetupWizard })));
const AnketaPage = lazy(() => import('./pages/AnketaPage').then(m => ({ default: m.AnketaPage })));

/** Manzil: #/admin — bizneslarni boshqarish, #/ulash — o'rnatuvchining ulash ustasi, #/anketa/KOD — egasining anketasi (kirishsiz), qolgani — kabinet */
const route = () => {
  const h = window.location.hash;
  return h.startsWith('#/admin') ? 'admin' : h.startsWith('#/ulash') ? 'setup' : h.startsWith('#/anketa') ? 'anketa' : 'app';
};

export default function App() {
  const [where, setWhere] = useState(route);
  const [authed, setAuthed] = useState(() => !!session.token());
  useEffect(() => {
    const on = () => { setWhere(route()); setAuthed(!!session.token()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>}>
      {where === 'admin' ? <AdminPage />
        : where === 'setup' ? <SetupWizard />
        : where === 'anketa' ? <AnketaPage />
        : authed ? <LiveApp /> : <LoginPage onLogin={() => setAuthed(true)} />}
    </Suspense>
  );
}
