import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, session, type LicenseView } from './data/api';
import { LoginPage } from './pages/LoginPage';
import { ActivationPanel, LicenseReminder } from './components/License';

const LiveApp = lazy(() => import('./LiveApp'));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SetupWizard = lazy(() => import('./pages/setup/SetupWizard').then(m => ({ default: m.SetupWizard })));
const AnketaPage = lazy(() => import('./pages/AnketaPage').then(m => ({ default: m.AnketaPage })));

/** Manzil: #/admin — bizneslarni boshqarish, #/ulash — o'rnatuvchining ulash ustasi, #/anketa/KOD — egasining anketasi (kirishsiz), qolgani — kabinet */
const route = () => {
  const h = window.location.hash;
  return h.startsWith('#/admin') ? 'admin' : h.startsWith('#/ulash') ? 'setup' : h.startsWith('#/anketa') ? 'anketa' : 'app';
};
/** Litsenziya holati shuncha vaqtda qayta so'raladi: muddat panel ochiq turganda tugashi mumkin */
const LICENSE_CHECK_MS = 10 * 60_000;

export default function App() {
  const [where, setWhere] = useState(route);
  const [authed, setAuthed] = useState(() => !!session.token());
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [activating, setActivating] = useState(false);
  useEffect(() => {
    const on = () => { setWhere(route()); setAuthed(!!session.token()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    const check = () => { api.license().then(r => setLicense(r.license)).catch(() => {}); };
    check();
    const t = setInterval(check, LICENSE_CHECK_MS);
    return () => clearInterval(t);
  }, []);

  // Anketa — egasining telefonidagi sahifa (kirishsiz): litsenziya u yerda ko'rsatilmaydi
  const showLicense = where !== 'anketa' && license && !license.activated;
  const activated = (l: LicenseView) => { setLicense(l); setActivating(false); };
  if (showLicense && license.blocked) return <ActivationPanel license={license} onActivated={activated} />;
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>}>
      {where === 'admin' ? <AdminPage />
        : where === 'setup' ? <SetupWizard />
        : where === 'anketa' ? <AnketaPage />
        : authed ? <LiveApp /> : <LoginPage onLogin={() => setAuthed(true)} />}
      {showLicense && <LicenseReminder license={license} onOpen={() => setActivating(true)} />}
      {showLicense && activating && <ActivationPanel license={license} onActivated={activated} onClose={() => setActivating(false)} />}
    </Suspense>
  );
}
