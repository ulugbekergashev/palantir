import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import { api, session, type ProfilePhase } from '../data/api';
import { Logo } from '../components/Logo';
import { Button, ButtonLink, Field, TextInput } from '../components/ui';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Profil hali egasiga topshirilmagan (server/profile.ts): o'rnatuvchiga — sozlashni davom ettirish
  const [phase, setPhase] = useState<ProfilePhase | null>(null);
  useEffect(() => { api.profilePhase().then(setPhase).catch(() => {}); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      session.set((await api.login(login, password)).token);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        {phase?.setup && (
          <div className="mb-4 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            <p className="font-bold">Palantir hali sozlanmoqda</p>
            <p className="mt-1">Egasiga topshirilgach login va parol beriladi. Hozir sozlashni shu kompyuterdan davom ettirish mumkin.</p>
            <ButtonLink variant="primary" href="#/ulash" className="mt-3"><Wrench className="h-4 w-4" /> Sozlashni davom ettirish</ButtonLink>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lift sm:p-7">
          <h1 className="text-xl font-extrabold tracking-tight">Kabinetga kirish</h1>
          <Field label="Login"><TextInput value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" autoFocus required /></Field>
          <Field label="Parol"><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Kirish
          </Button>
        </form>
        <div className="mt-5 text-center text-sm">
          <a href="#/admin" className="rounded text-slate-500 hover:text-slate-900">{phase?.oneProfile ? 'Parolni unutdingizmi? (admin)' : 'Admin'}</a>
        </div>
      </div>
    </main>
  );
}
