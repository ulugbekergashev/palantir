import { useState, type FormEvent } from 'react';
import { Building2, CheckCircle2, Copy, FileUp, Loader2, Plus } from 'lucide-react';
import { adminApi, api, type AdminBusiness } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import { cleanCode } from '../../lib/anketa';
import type { AnketaImport, SetupView } from '../../types';
import { loginFrom, newPassword } from './wizard';

const SOURCE_KEY = 'palantir_anketa_source';
const readSource = () => { try { return localStorage.getItem(SOURCE_KEY) ?? ''; } catch { return ''; } };
const writeSource = (v: string) => { try { localStorage.setItem(SOURCE_KEY, v); } catch { /* yopiq xotira */ } };

export function StepClinic({ list, selected, onSelect, onCreated, setup, onSetup, notify }: {
  list: AdminBusiness[] | null; selected: string | null; onSelect: (id: string) => void; onCreated: () => Promise<void>;
  setup: SetupView | null; onSetup: (s: SetupView) => void; notify: (text: string, error?: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => ({ name: '', industry: 'stomatologiya', login: '', password: newPassword() }));
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [source, setSource] = useState(readSource);
  const [result, setResult] = useState<AnketaImport | null>(null);
  const [anketaOpen, setAnketaOpen] = useState(false);
  const showForm = adding || list?.length === 0;
  // Anketa — ixtiyoriy: odatda yopiq, chunki ma'lumot egasi Telegram'ni ulagach tanishuv suhbatida yig'iladi
  const showAnketa = anketaOpen || !!result || !!setup?.anketa;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const login = form.login.trim().toLowerCase() || loginFrom(form.name);
      const { id } = await adminApi.create({ ...form, login });
      setCreated({ login, password: form.password });
      setAdding(false);
      await onCreated();
      onSelect(id);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };

  const load = async (body: { code: string; source: string } | { data: unknown }) => {
    setBusy(true);
    try {
      const r = await api.importAnketa(body);
      setResult(r.result);
      onSetup(r.setup);
      notify('Anketa yuklandi');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  const byCode = (e: FormEvent) => {
    e.preventDefault();
    writeSource(source.trim());
    void load({ code: cleanCode(code), source: source.trim() });
  };
  const byFile = async (file: File | undefined) => {
    if (!file) return;
    try { await load({ data: JSON.parse(await file.text()) }); } catch { notify("Bu fayl anketa emas — anketa sahifasidan yuklab olingan .json faylni tanlang", true); }
  };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => notify('Nusxalandi'), () => {}); };

  return (
    <div className="space-y-4">
      <Card title="Qaysi klinika" action={!showForm && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Yangi klinika</Button>}>
        {!list ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : showForm ? (
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Klinika nomi"><TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Shifo Dent" required autoFocus /></Field>
            <Field label="Soha"><TextInput value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} /></Field>
            <Field label="Kabinet logini" hint="Egasi panelga shu bilan kiradi"><TextInput value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} placeholder={loginFrom(form.name) || 'shifodent'} /></Field>
            <Field label="Parol" hint="O'zi yaratildi — o'zgartirsangiz ham bo'ladi (kamida 8 belgi)"><TextInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={8} required className="font-mono" /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Klinikani qo'shish</Button>
              {list.length > 0 && <Button variant="ghost" onClick={() => setAdding(false)}>Bekor qilish</Button>}
            </div>
          </form>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.filter(b => b.active).map(b => (
              <li key={b.id}>
                <button type="button" onClick={() => onSelect(b.id)} aria-pressed={selected === b.id}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${selected === b.id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <Building2 className={`h-5 w-5 shrink-0 ${selected === b.id ? 'text-indigo-600' : 'text-slate-400'}`} aria-hidden="true" />
                  <span className="min-w-0"><span className="block truncate font-bold">{b.name}</span><span className="block text-xs text-slate-500">{b.login}{b.industry ? ` · ${b.industry}` : ''}</span></span>
                  {selected === b.id && <CheckCircle2 className="ml-auto h-5 w-5 text-indigo-600" aria-label="tanlangan" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {created && (
          <div className="mt-4 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
            <p className="font-bold">Klinika qo'shildi. Egasiga bering:</p>
            <p className="mt-1 font-mono">login: {created.login} · parol: {created.password}</p>
            <Button size="sm" className="mt-2" onClick={() => copy(`Palantir kabineti\nLogin: ${created.login}\nParol: ${created.password}`)}><Copy className="h-3.5 w-3.5" /> Nusxalash</Button>
          </div>
        )}
      </Card>

      {selected && (
        <Card title="Klinika ma'lumotlari" description="Hech narsa qilish shart emas: egasi Telegram'ni ulagach, bot o'zi tanishishni taklif qiladi — manzil, ish vaqti, narxlar va mijozlar ko'p so'raydigan savollar. Narxlar ro'yxatini fayl qilib botga yuborsa ham bo'ladi.">
          {!showAnketa ? (
            <button type="button" onClick={() => setAnketaOpen(true)} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">
              Egasi anketani oldindan to'ldirganmi? Kod bilan yuklash
            </button>
          ) : <>
          <form onSubmit={byCode} className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Anketa kodi"><TextInput value={code} onChange={e => setCode(e.target.value)} placeholder="K7QM-2XPA" className="font-mono uppercase tracking-widest" required /></Field>
            <Field label="Anketa serveri" hint="Siz anketa yaratgan Palantir manzili"><TextInput value={source} onChange={e => setSource(e.target.value)} placeholder="https://palantir.sizning-domen.uz" type="url" required /></Field>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yuklash</Button>
          </form>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg text-sm font-semibold text-indigo-700 hover:text-indigo-900">
            <FileUp className="h-4 w-4" aria-hidden="true" /> Yoki anketa faylini tanlang (.json)
            <input type="file" accept="application/json,.json" className="sr-only" onChange={e => void byFile(e.target.files?.[0])} />
          </label>
          {(result || setup?.anketa) && (
            <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
              {result ? (
                <p><b>Yuklandi:</b> {result.prices.added} ta yangi narx{result.prices.updated ? `, ${result.prices.updated} tasi yangilandi` : ''}, {result.answers} ta savolga javob{result.about ? ', «Biznes haqida» sahifasi' : ''}.
                  {result.prices.conflicts > 0 && <span className="block text-amber-800">{result.prices.conflicts} ta xizmatga ikki xil narx yozilgan — egasidan so'raladi (Bo'shliqlar qadami).</span>}
                  {result.prices.unclear > 0 && <span className="block text-slate-500">{result.prices.unclear} ta qatorda narx tushunilmadi — ular jadvalga olinmadi.</span>}
                </p>
              ) : <p>Anketa {new Date(setup!.anketa!.importedAt).toLocaleString('uz-UZ')} da yuklangan{setup!.anketa!.code ? ` (${setup!.anketa!.code})` : ''}.</p>}
            </div>
          )}
          </>}
        </Card>
      )}
    </div>
  );
}
