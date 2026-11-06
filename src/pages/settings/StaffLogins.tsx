/**
 * Xodimlarning panelga kirishi (faqat egasi): «Qabulxona xodimlari» ro'yxatidagi odamga login, parol va huquq beriladi.
 * Qabulxona — faqat Qabulxona bo'limi; boshqaruvchi — hammasi, Sozlamalar va egasining kirish/kalitlaridan tashqari (server/access.ts).
 * Parol bir marta ko'rsatiladi; «Yangi parol» — eskisi va ochiq kirishlari bekor; «Yopish» — xodim darhol chiqadi.
 * Yuqorida — xodim panelni qayerdan ochadi: klinika ichidagi kompyuterdan (server/lan.ts) va istalgan joydan (Hub); nusxalanadigan
 * login-parol matniga ham manzil qo'shiladi.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Loader2, UserPlus } from 'lucide-react';
import { api, type AccessMember, type PanelWhere } from '../../data/api';
import type { StaffAccess } from '../../types';
import type { Notify } from '../../components/Artifacts';
import { Button, Card, Field, TextInput } from '../../components/ui';
import { loginFrom } from '../setup/wizard';
import { copyText } from '../../lib/clipboard';

const ACCESS: Record<StaffAccess, { name: string; hint: string }> = {
  reception: { name: 'Qabulxona', hint: "so'rovlar, yozishmalar, qo'ng'iroqlar, mijozlar" },
  manager: { name: 'Boshqaruvchi', hint: 'hamma bo‘lim, Sozlamalar va kalitlardan tashqari' },
};

export function StaffLogins({ notify }: { notify: Notify }) {
  const [members, setMembers] = useState<AccessMember[] | null>(null);
  const [where, setWhere] = useState<PanelWhere | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<{ name: string; login: string; password: string } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.teamAccess().then(r => { setMembers(r.members); setWhere(r.where); setError(''); }).catch(e => setError((e as Error).message));
  /** Xodimga beriladigan manzil: klinika ichidagisi, bo'lmasa — Hub havolasi */
  const address = where?.lan[0] ?? where?.hub ?? '';
  const copy = (text: string) => { copyText(text).then(() => notify('Nusxalandi'), () => notify(text)); };
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<{ member: AccessMember; password?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.password && r.member.login) setShown({ name: r.member.name, login: r.member.login, password: r.password });
      await load();
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const give = (m: AccessMember, access: StaffAccess) => {
    const login = m.login ? undefined : window.prompt(`«${m.name}» uchun login (lotin harflari):`, loginFrom(m.name) || '')?.trim().toLowerCase();
    if (!m.login && !login) return;
    void act(() => api.grantAccess(m.id, access, login));
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await api.addStaff(name.trim()); setName(''); await load(); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };

  return (
    <Card title="Xodimlar kirishi" description="Har xodim panelga o'z logini bilan kiradi va faqat o'ziga ochilgan bo'limni ko'radi. Parol bir marta ko'rsatiladi.">
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {where && <Where where={where} copy={copy} />}
      {shown && (
        <div className="mb-4 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
          <p className="font-semibold">«{shown.name}» — panelga kirish</p>
          <p className="mt-1 font-mono" data-testid="staff-creds">login: {shown.login} · parol: {shown.password}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copy(`Palantir paneli${address ? `\nManzil: ${address}` : ''}\nLogin: ${shown.login}\nParol: ${shown.password}`)}><Copy className="h-4 w-4" /> Nusxalash</Button>
            <Button size="sm" onClick={() => setShown(null)}>Yopish</Button>
          </div>
          <p className="mt-2 text-xs text-emerald-800">Xodimga bering. Parol boshqa ko'rsatilmaydi — unutsa «Yangi parol».</p>
        </div>
      )}
      {!members && !error && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {members && (
        <ul className="divide-y divide-slate-100">
          {members.length === 0 && <li className="py-3 text-sm text-slate-500">Hali xodim yo'q — pastda qo'shing.</li>}
          {members.map(m => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-3">
              <span className="min-w-[10rem] flex-1">
                <span className="block font-semibold text-slate-900">{m.name}</span>
                <span className="block text-xs text-slate-500">
                  {m.access ? `${ACCESS[m.access].name} · ${m.login} · ${m.seenAt ? `oxirgi kirish ${new Date(m.seenAt).toLocaleString()}` : 'hali kirmagan'}` : "panelga kirishi yo'q"}
                </span>
              </span>
              {(Object.keys(ACCESS) as StaffAccess[]).filter(a => a !== m.access).map(a => (
                <Button key={a} size="sm" disabled={busy} title={ACCESS[a].hint} onClick={() => give(m, a)}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" /> {m.access ? `${ACCESS[a].name} qilish` : `${ACCESS[a].name} sifatida kirsin`}
                </Button>
              ))}
              {m.access && <Button size="sm" disabled={busy} onClick={() => { void act(() => api.resetAccess(m.id)); }}>Yangi parol</Button>}
              {m.access && <Button size="sm" disabled={busy} onClick={() => { if (window.confirm(`«${m.name}» panelga kira olmasin? Ochiq kirishi darhol tugaydi.`)) void act(() => api.revokeAccess(m.id)); }}>Yopish</Button>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="Yangi xodim"><TextInput id="staff-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ismi (masalan, Dilnoza)" maxLength={60} /></Field>
        <Button type="submit" disabled={busy || !name.trim()}><UserPlus className="h-4 w-4" aria-hidden="true" /> Qo'shish</Button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        {ACCESS.reception.name}: {ACCESS.reception.hint}. {ACCESS.manager.name}: {ACCESS.manager.hint}. Pul yozuvlarini tasdiqlash, kalitlar va xodimlar — faqat sizda.
      </p>
    </Card>
  );
}

/** Xodim panelni qayerdan ochadi */
function Where({ where, copy }: { where: PanelWhere; copy: (text: string) => void }) {
  return (
    <div className="mb-4 space-y-1.5 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-700" data-testid="panel-where">
      <p className="font-semibold text-slate-800">Xodim panelni qayerdan ochadi</p>
      {where.lan.map(url => (
        <p key={url} className="flex flex-wrap items-center gap-2">
          <span>Klinika ichidagi kompyuterdan (internetsiz):</span>
          <span className="font-mono font-semibold text-slate-900">{url}</span>
          <Button size="sm" onClick={() => copy(url)} aria-label={`${url} — nusxalash`}><Copy className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </p>
      ))}
      {!where.lan.length && (
        <p className="text-xs text-slate-500">Klinika ichidagi kompyuterlardan to'g'ridan-to'g'ri ochish hali yoqilmagan — o'rnatuvchi server kompyuterida install\Tarmoq.cmd ni bir marta ishga tushiradi.</p>
      )}
      {where.hub && (
        <p className="flex flex-wrap items-center gap-2">
          <span>Istalgan joydan (internet orqali):</span>
          <span className="break-all font-mono text-slate-900">{where.hub}</span>
          <Button size="sm" onClick={() => copy(where.hub!)} aria-label="Hub havolasi — nusxalash"><Copy className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </p>
      )}
    </div>
  );
}
