import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, Loader2, LogOut, Plus, Power, Wand2 } from 'lucide-react';
import { adminApi, session, type AdminBusiness, type AdminUsage } from '../data/api';
import { Logo } from '../components/Logo';
import { Button, ButtonLink, Card, Field, TextInput } from '../components/ui';
import { AnketaAdmin } from './AnketaAdmin';

/** Server ham shuni talab qiladi (server/http.ts) */
const MIN_PASSWORD = 8;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} mln` : n >= 1000 ? `${Math.round(n / 1000)} ming` : String(n));

/** Oxirgi kunlardagi AI xarajati: kun va biznes bo'yicha. Dollar — taxminiy (aniq hisob Anthropic kabinetida) */
function UsageTable({ rows }: { rows: AdminUsage[] }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-slate-500">Hali AI so'rovlari bo'lmagan</p>;
  const total = rows.reduce((sum, r) => sum + r.usd, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-400">
          <tr><th className="py-2 pr-3">Kun</th><th className="pr-3">Biznes</th><th className="pr-3 text-right">So'rovlar</th><th className="pr-3 text-right">Kirish</th><th className="pr-3 text-right">Chiqish</th><th className="text-right">≈ $</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {rows.map(r => (
            <tr key={`${r.day}|${r.businessId}`}>
              <td className="py-2 pr-3 text-slate-600">{r.day}</td>
              <td className="pr-3 font-semibold">{r.business}</td>
              <td className="pr-3 text-right">{r.calls}</td>
              <td className="pr-3 text-right text-slate-600">{tokens(r.input + r.cacheRead + r.cacheWrite)}</td>
              <td className="pr-3 text-right text-slate-600">{tokens(r.output)}</td>
              <td className="text-right font-semibold">{r.usd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200"><td colSpan={5} className="py-2 pr-3 text-right text-slate-500">Jami</td><td className="text-right font-extrabold tabular-nums">{total.toFixed(2)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Sotuvchi (siz) uchun: bizneslarni qo'shish, bloklash, parolni tiklash, AI xarajatini ko'rish */
export function AdminPage() {
  const [authed, setAuthed] = useState(!!session.adminToken());
  const [password, setPassword] = useState('');
  const [list, setList] = useState<AdminBusiness[] | null>(null);
  const [form, setForm] = useState({ name: '', industry: '', login: '', password: '' });
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => {
    const err = e as Error & { status?: number };
    if (err.status === 401) { session.setAdmin(null); setAuthed(false); }
    setMsg({ text: err.message, error: true });
  };
  const [usage, setUsage] = useState<{ model: string; rows: AdminUsage[] } | null>(null);
  const load = () => Promise.all([adminApi.businesses(), adminApi.usage()]).then(([b, u]) => { setList(b.businesses); setUsage({ model: u.model, rows: u.usage }); }).catch(fail);
  useEffect(() => { if (authed) void load(); }, [authed]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    try { session.setAdmin((await adminApi.login(password)).token); setAuthed(true); setMsg(null); } catch (err) { fail(err); }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.create(form);
      setMsg({ text: `«${form.name}» qo'shildi. Login: ${form.login.trim().toLowerCase()} — egasiga bering.` });
      setForm({ name: '', industry: '', login: '', password: '' });
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const toggle = async (c: AdminBusiness) => {
    try { await adminApi.update(c.id, { active: !c.active }); await load(); } catch (err) { fail(err); }
  };
  const resetPassword = async (c: AdminBusiness) => {
    const pw = window.prompt(`«${c.name}» uchun yangi parol (kamida ${MIN_PASSWORD} belgi):`);
    if (!pw) return;
    try { await adminApi.update(c.id, { password: pw }); setMsg({ text: `«${c.name}» paroli yangilandi` }); } catch (err) { fail(err); }
  };

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lift sm:p-7">
          <Logo subtitle="Admin" />
          <Field label="Admin paroli"><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus required /></Field>
          {msg && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{msg.text}</p>}
          <Button type="submit" variant="primary" className="w-full">Kirish</Button>
          <a href="#/" className="block rounded text-center text-sm text-slate-500 hover:text-slate-900">Kabinetga kirish</a>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <Logo subtitle="Admin — bizneslar" />
        <div className="flex items-center gap-1">
          <ButtonLink variant="primary" href="#/ulash"><Wand2 className="h-4 w-4" /> Ulash ustasi</ButtonLink>
          <Button variant="ghost" onClick={() => { session.setAdmin(null); setAuthed(false); }}><LogOut className="h-4 w-4" /> Chiqish</Button>
        </div>
      </header>
      {msg && <p role="status" className={`rounded-xl px-3.5 py-2.5 text-sm ${msg.error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{msg.text}</p>}

      <Card title="Yangi biznes" description="Egasiga login va parolni bering — u kirib, Telegramni ulaydi; biznes haqidagi bilim «Ikkinchi miya»ga yig'iladi">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr_1fr_auto] sm:items-end">
          <Field label="Biznes nomi"><TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Soha"><TextInput value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} placeholder="stomatologiya" /></Field>
          <Field label="Login"><TextInput value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} placeholder="bizness" required /></Field>
          <Field label={`Parol (kamida ${MIN_PASSWORD} belgi)`}><TextInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={MIN_PASSWORD} required /></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Qo'shish</Button>
        </form>
      </Card>

      <AnketaAdmin onError={fail} onInfo={text => setMsg({ text })} />

      <Card title={`Bizneslar${list ? ` (${list.length})` : ''}`}>
        {!list ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Hali biznes yo'q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr><th className="py-2 pr-3">Biznes</th><th className="pr-3">Soha</th><th className="pr-3">Login</th><th className="pr-3">Telegram</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(c => (
                  <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                    <td className="py-2.5 pr-3 font-semibold">{c.name}</td>
                    <td className="pr-3 text-slate-600">{c.industry || '—'}</td>
                    <td className="pr-3 text-slate-600">{c.login}</td>
                    <td className="pr-3">{c.ownerLinked ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="ulangan" /> : <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => resetPassword(c)}><KeyRound className="h-3.5 w-3.5" /> Parol</Button>
                      <Button size="sm" variant={c.active ? 'danger' : 'ghost'} onClick={() => toggle(c)}><Power className="h-3.5 w-3.5" /> {c.active ? "O'chirish" : 'Yoqish'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="AI xarajati — oxirgi 7 kun" description={usage ? `Model: ${usage.model}. Dollar taxminiy: aniq hisob va qoldiq — platform.claude.com` : undefined}>
        {usage ? <UsageTable rows={usage.rows} /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />}
      </Card>
    </div>
  );
}
