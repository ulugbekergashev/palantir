import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImagePlus, Loader2, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { Business, ContentItem, Member, Note, Offering } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, Field, IconButton, TextInput, inputClass } from '../components/ui';
import { fileToDataUrl } from '../lib/image';
import { Artboard } from '../templates/Artboard';

/** Brend ranglari uchun tayyor juftliklar: asosiy + urg'u */
const PRESETS: [string, string][] = [
  ['#4F46E5', '#F59E0B'],
  ['#0F766E', '#F59E0B'],
  ['#1D4ED8', '#38BDF8'],
  ['#BE185D', '#FBBF24'],
  ['#15803D', '#A3E635'],
  ['#111827', '#D4AF37'],
];

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function UploadButton({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Button size="sm" onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" /> {label}</Button>
    </>
  );
}

const sample = (b: Business): ContentItem => {
  const d = { kicker: 'Namuna', title: b.offerings[0]?.name || b.name, badge: 'Yangi', lines: ['Rang va logo postlarda shunday chiqadi', 'Hamma rasm bir uslubda'] };
  return { id: 'preview', kind: 'post', template: 'promo', style: 0, seed: 1, design: { uz: d, ru: d }, caption: { uz: '', ru: '' } };
};

function NotesCard({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { api.notes().then(r => setList(r.notes)).catch(() => setList([])); }, []);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try { const { note } = await api.addNote(text.trim()); setList(l => [...(l ?? []), note]); setText(''); } catch (err) { notify((err as Error).message, true); }
  };
  return (
    <Card title="Cerebro eslab qolgan narsalar" description="Doimiy faktlar: yetkazib berish shartlari, rekvizitlar, ish tartibi. Yordamchi ularni hujjat va javoblarda ishlatadi.">
      {list === null ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <ul className="mb-3 space-y-1.5">
          {list.map(n => (
            <li key={n.id} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="flex-1">{n.text}</span>
              <button type="button" aria-label={`O'chirish: ${n.text}`} className="text-slate-400 hover:text-rose-600"
                onClick={async () => { await api.deleteNote(n.id).catch(() => {}); setList(l => l?.filter(x => x.id !== n.id) ?? l); }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {!list.length && <li className="text-sm text-slate-400">Hali yo'q. Yordamchiga «eslab qol: …» deb aytsangiz ham shu yerga tushadi.</li>}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <TextInput value={text} onChange={e => setText(e.target.value)} placeholder="Masalan: 500 ming so'mdan yuqori buyurtmaga yetkazish bepul" aria-label="Yangi fakt" maxLength={500} />
        <Button type="submit" disabled={!text.trim()}><Plus className="h-4 w-4" /></Button>
      </form>
    </Card>
  );
}

export function BusinessPage({ biz, onSaved, notify }: { biz: Business; onSaved: (b: Business) => void; notify: Notify }) {
  const [draft, setDraft] = useState(biz);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(biz);
  const up = (patch: Partial<Business>) => setDraft(d => ({ ...d, ...patch }));
  const upOffer = (id: string, patch: Partial<Offering>) => up({ offerings: draft.offerings.map(o => (o.id === id ? { ...o, ...patch } : o)) });
  const upMember = (id: string, patch: Partial<Member>) => up({ team: draft.team.map(m => (m.id === id ? { ...m, ...patch } : m)) });

  const save = async () => {
    setSaving(true);
    try {
      const { business } = await api.saveBusiness(draft);
      onSaved(business);
      setDraft(business);
      notify('Saqlandi — yordamchi yangi ma\'lumotni biladi');
    } catch (e) { notify((e as Error).message, true); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 pb-20">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Biznes profili</h1>
        <p className="text-sm text-slate-500">Cerebro shu ma'lumotdan foydalanadi: hujjatlarda rekvizit, postlarda narx va aloqa. O'zidan narx yoki chegirma qo'shmaydi.</p>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Biznes">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi"><TextInput value={draft.name} onChange={e => up({ name: e.target.value })} maxLength={60} /></Field>
            <Field label="Egasi (yordamchi shunday murojaat qiladi)"><TextInput value={draft.ownerName} onChange={e => up({ ownerName: e.target.value })} maxLength={60} /></Field>
            <Field label="Soha" hint="Masalan: restoran, qurilish mollari, o'quv markazi"><TextInput value={draft.industry} onChange={e => up({ industry: e.target.value })} maxLength={80} /></Field>
            <Field label="Telefon"><TextInput value={draft.phone} onChange={e => up({ phone: e.target.value })} maxLength={40} /></Field>
            <Field label="Manzil"><TextInput value={draft.address} onChange={e => up({ address: e.target.value })} maxLength={160} /></Field>
            <Field label="Ish vaqti"><TextInput value={draft.hours ?? ''} onChange={e => up({ hours: e.target.value })} placeholder="Du–Sh 9:00–20:00" maxLength={120} /></Field>
            <Field label="Instagram"><TextInput value={draft.instagram ?? ''} onChange={e => up({ instagram: e.target.value })} placeholder="@biznes" maxLength={60} /></Field>
            <Field label="Sayt"><TextInput value={draft.website ?? ''} onChange={e => up({ website: e.target.value })} maxLength={120} /></Field>
            <div className="sm:col-span-2">
              <Field label="Biznes haqida" hint="Nima qilasiz, kimlar mijozingiz, nimasi bilan farq qilasiz — yordamchi shundan tushunadi">
                <textarea className={`${inputClass} h-24 py-2`} value={draft.description ?? ''} onChange={e => up({ description: e.target.value })} maxLength={1500} />
              </Field>
            </div>
            <Field label="Post va hujjatlar tili">
              <select className={inputClass} value={draft.contentLang ?? 'uz'} onChange={e => up({ contentLang: e.target.value === 'ru' ? 'ru' : 'uz' })}>
                <option value="uz">O'zbekcha</option>
                <option value="ru">Русский</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={draft.morningBrief !== false} onChange={e => up({ morningBrief: e.target.checked })} />
              Har kuni ertalab qisqa xulosa (Telegram)
            </label>
          </div>
        </Card>

        <Card title="Brend" description="Logo va ranglar — hamma post bir uslubda chiqadi">
          <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {draft.brand.logo ? <img src={draft.brand.logo} alt="Logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-slate-300" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <UploadButton label="Logo yuklash" onFile={async f => up({ brand: { ...draft.brand, logo: await fileToDataUrl(f, 400) } })} />
                  {draft.brand.logo && <Button size="sm" variant="ghost" onClick={() => up({ brand: { ...draft.brand, logo: undefined } })}>Olib tashlash</Button>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(([p, a]) => (
                  <button key={p} type="button" aria-label={`Rang: ${p}`} aria-pressed={draft.brand.primary.toLowerCase() === p.toLowerCase()}
                    onClick={() => up({ brand: { ...draft.brand, primary: p, accent: a } })}
                    className={`flex h-10 w-14 overflow-hidden rounded-xl border-2 ${draft.brand.primary.toLowerCase() === p.toLowerCase() ? 'border-slate-900' : 'border-transparent'}`}>
                    <span className="flex-[2]" style={{ background: p }} /><span className="flex-1" style={{ background: a }} />
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Asosiy rang"><input type="color" className={`${inputClass} p-1`} value={draft.brand.primary} onChange={e => up({ brand: { ...draft.brand, primary: e.target.value } })} /></Field>
                <Field label="Urg'u rangi"><input type="color" className={`${inputClass} p-1`} value={draft.brand.accent} onChange={e => up({ brand: { ...draft.brand, accent: e.target.value } })} /></Field>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200"><Artboard item={sample(draft)} lang="uz" biz={draft} className="block h-auto w-full" /></div>
          </div>
        </Card>

        <Card title="Mahsulot va xizmatlar" description="Narxi 0 bo'lsa — yordamchi narxni aytmaydi"
          action={<Button size="sm" onClick={() => up({ offerings: [...draft.offerings, { id: newId('o'), name: '', price: 0 }] })}><Plus className="h-3.5 w-3.5" /> Qo'shish</Button>}>
          <div className="space-y-2">
            {draft.offerings.map(o => (
              <div key={o.id} className="grid grid-cols-[1fr_130px_auto] gap-2">
                <TextInput value={o.name} onChange={e => upOffer(o.id, { name: e.target.value })} placeholder="Nomi" aria-label="Nomi" maxLength={80} />
                <TextInput type="number" min={0} value={o.price || ''} onChange={e => upOffer(o.id, { price: Math.max(0, Number(e.target.value) || 0) })} placeholder="Narx, so'm" aria-label="Narx" />
                <IconButton label="O'chirish" className="h-10 w-10" onClick={() => up({ offerings: draft.offerings.filter(x => x.id !== o.id) })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
            {!draft.offerings.length && <p className="text-sm text-slate-400">Hali yo'q</p>}
          </div>
        </Card>

        <Card title="Jamoa" description="Xodimni tanishtiruvchi post uchun (surat ixtiyoriy)"
          action={<Button size="sm" onClick={() => up({ team: [...draft.team, { id: newId('m'), name: '', role: '' }] })}><Plus className="h-3.5 w-3.5" /> Qo'shish</Button>}>
          <div className="space-y-3">
            {draft.team.map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-2">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-slate-100">{m.photo && <img src={m.photo} alt="" className="h-full w-full object-cover" />}</div>
                <TextInput className="min-w-[140px] flex-1" value={m.name} onChange={e => upMember(m.id, { name: e.target.value })} placeholder="Ism familiya" aria-label="Ism" maxLength={80} />
                <TextInput className="min-w-[120px] flex-1" value={m.role} onChange={e => upMember(m.id, { role: e.target.value })} placeholder="Lavozimi" aria-label="Lavozimi" maxLength={80} />
                <TextInput className="w-20" type="number" min={0} max={70} value={m.years ?? ''} onChange={e => upMember(m.id, { years: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} placeholder="Yil" aria-label="Tajriba, yil" />
                <UploadButton label="Surat" onFile={async f => upMember(m.id, { photo: await fileToDataUrl(f, 700) })} />
                <IconButton label="O'chirish" className="h-10 w-10" onClick={() => up({ team: draft.team.filter(x => x.id !== m.id) })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
            {!draft.team.length && <p className="text-sm text-slate-400">Hali yo'q</p>}
          </div>
        </Card>

        <div className="xl:col-span-2"><NotesCard notify={notify} /></div>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <span className="text-sm font-semibold text-slate-600">O'zgarishlar saqlanmagan</span>
            <Button variant="ghost" onClick={() => setDraft(biz)}>Bekor qilish</Button>
            <Button variant="primary" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Saqlash</Button>
          </div>
        </div>
      )}
    </div>
  );
}
