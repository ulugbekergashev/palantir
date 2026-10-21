/** Kirish va xavfsizlik: egasi o'z parolini almashtiradi yoki boshqa qurilmalardan chiqadi (eski kirishlar serverda bekor bo'ladi) */
import { useState, type FormEvent } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { api, session } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Button, Card, Field, TextInput } from '../../components/ui';

const MIN_PASSWORD = 8;

export function AccountCard({ notify }: { notify: Notify }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState<'password' | 'others' | null>(null);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) return notify(`Yangi parol kamida ${MIN_PASSWORD} belgi`, true);
    if (next !== again) return notify('Yangi parol ikki marta bir xil yozilmadi', true);
    setBusy('password');
    try {
      session.set((await api.changePassword(current, next)).token);
      setCurrent(''); setNext(''); setAgain('');
      notify("Parol almashdi. Boshqa qurilmalarda qayta kirish kerak bo'ladi");
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    if (!window.confirm("Shu qurilmadan boshqa hamma joyda (telefon, boshqa kompyuter) chiqilsinmi?")) return;
    setBusy('others');
    try {
      session.set((await api.signOutOthers()).token);
      notify('Boshqa qurilmalardan chiqildi');
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Kirish va xavfsizlik" description="Parol almashsa yoki «boshqa qurilmalardan chiqish» bosilsa — avval kirilgan hamma qurilmada qayta kirish kerak bo'ladi.">
      <form onSubmit={change} className="space-y-3">
        <Field label="Joriy parol"><TextInput type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required /></Field>
        <Field label="Yangi parol" hint={`Kamida ${MIN_PASSWORD} belgi`}><TextInput type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required /></Field>
        <Field label="Yangi parol (yana bir marta)"><TextInput type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required /></Field>
        <Button type="submit" variant="primary" disabled={!!busy}><KeyRound className="h-4 w-4" aria-hidden="true" /> Parolni almashtirish</Button>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <p className="flex-1 text-sm text-slate-600">Telefon yo'qolsa yoki begona kompyuterda kirib qolgan bo'lsangiz.</p>
        <Button onClick={() => { void signOutOthers(); }} disabled={!!busy}><LogOut className="h-4 w-4" aria-hidden="true" /> Boshqa qurilmalardan chiqish</Button>
      </div>
    </Card>
  );
}
