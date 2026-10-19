import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Unlink } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, TextInput } from '../components/ui';

interface DentaCrmProps {
  status: LiveStatus;
  onStatus: (s: LiveStatus) => void;
  notify: Notify;
}

const EMPTY = { url: '', username: '', password: '' };

/** DentaCRM: klinikaning qabul va to'lovlari. Yordamchi shu yerdan o'qiydi va bemorni qabulga yozadi */
export function DentaCrm({ status, onStatus, notify }: DentaCrmProps) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(false);
  const { account, problem } = status.crm;
  // Shu kompyuterda DentaCRM ishlab turgan bo'lsa — manzil o'zi qo'yiladi (egasi yozgan bo'lsa tegilmaydi)
  useEffect(() => {
    if (account) return;
    let stale = false;
    api.crmFind().then(r => {
      if (stale || !r.url) return;
      setFound(true);
      setForm(f => (f.url ? f : { ...f, url: r.url! }));
    }).catch(() => {});
    return () => { stale = true; };
  }, [account]);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onStatus((await api.crmConnect(form)).status);
      setForm(EMPTY);
      notify('DentaCRM ulandi');
    } catch (err) {
      // Parol maydoni xatodan keyin ham tozalanadi (sahifada qolib ketmasin)
      setForm(f => ({ ...f, password: '' }));
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600">Ulangan: <b>{account}</b>.{!problem && ' Yordamchi qabullar va tushumni shu yerdan oladi, bemorni qabulga yoza oladi.'}</p>
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!window.confirm("DentaCRM uzilsinmi? Yordamchi qabullar va tushumni ko'ra olmay qoladi.")) return;
            try { onStatus((await api.crmDisconnect()).status); } catch (err) { notify((err as Error).message, true); }
          }}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
        </div>
        {problem && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">⚠️ {problem}</p>}
      </div>
    );
  }
  return (
    <>
      <p className="text-sm text-slate-600">
        Klinikangiz DentaCRM'da ishlasa, ulang: «bugun nechta bemor?», «tushum qancha?», «Aliyevni ertaga 15:00 ga yoz» desangiz, yordamchi CRM'dan o'qiydi va unga yozadi.
        Parol shifrlangan holda shu kompyuterda saqlanadi.
      </p>
      <form onSubmit={connect} className="grid gap-2 sm:grid-cols-3">
        <label className="sm:col-span-3">
          <span className="mb-1 block text-xs font-semibold text-slate-600">DentaCRM manzili</span>
          <TextInput value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://192.168.1.20:3001 yoki https://klinika.dentacrm.uz" autoComplete="off" aria-label="DentaCRM manzili" />
          {found && <span className="mt-1 block text-xs text-emerald-700">Shu kompyuterda DentaCRM topildi — manzil qo'yildi. Login va parolni yozing.</span>}
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-600">Login</span>
          <TextInput value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" aria-label="DentaCRM logini" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-600">Parol</span>
          <TextInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} type="password" autoComplete="new-password" aria-label="DentaCRM paroli" />
        </label>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={busy || !form.url.trim() || !form.username.trim() || !form.password}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Ulash
          </Button>
        </div>
      </form>
    </>
  );
}
