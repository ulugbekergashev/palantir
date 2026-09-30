import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { api, session } from '../data/api';
import { Logo } from '../components/Sidebar';
import { Button, Field, TextInput } from '../components/ui';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-extrabold">Kabinetga kirish</h1>
          <Field label="Login"><TextInput value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" autoFocus required /></Field>
          <Field label="Parol"><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Kirish
          </Button>
        </form>
        <div className="mt-5 text-center text-sm">
          <a href="#/admin" className="text-slate-400 hover:text-slate-600">Admin</a>
        </div>
      </div>
    </div>
  );
}
