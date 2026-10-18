import { useEffect, useState } from 'react';
import { Copy, Inbox, Loader2, Phone, Trash2, UserPlus } from 'lucide-react';
import type { RequestKind, RequestSource } from '../types';
import { api, type RequestView, type TeamView } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, EmptyState, Field, PageHeader, TextInput, controlClass, inputClass } from '../components/ui';
import { prettyPhone } from '../lib/phone';

const KIND: Record<RequestKind, string> = {
  callback: "📞 Qo'ng'iroq qilish", booking: '📅 Qabulga yozish', change: '🔁 Surish yoki bekor qilish', complaint: '⚠️ Shikoyat', other: "📌 Boshqa ish",
};
const SOURCE: Record<RequestSource, string> = {
  bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: "qo'lda", call: "o'tkazib yuborilgan qo'ng'iroq", voice: 'ovozli agent', owner: 'egasi', panel: 'panel',
};
const when = (isoTime: string) => new Date(isoTime).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const waited = (isoTime: string) => {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(isoTime)) / 60_000));
  return min < 60 ? `${min} daq` : min < 1440 ? `${Math.round(min / 60)} soat` : `${Math.round(min / 1440)} kun`;
};

/**
 * So'rovlar: mijoz xodimdan nimadir kutyapti. Ochiqlari — eng eskisi birinchi (kim ko'p kutgan bo'lsa, o'sha tepada).
 * Pastda — qabulxona xodimlari: ular so'rovlarni Telegram'da tugmali karta bo'lib oladi
 */
export function RequestsPage({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const [which, setWhich] = useState<'open' | 'closed'>('open');
  const [list, setList] = useState<RequestView[] | null>(null);
  const [open, setOpen] = useState(0);
  const [adding, setAdding] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => api.requests(which).then(r => { setList(r.requests); setOpen(r.open); }).catch(fail);
  useEffect(() => { setList(null); void load(); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, [which]);

  const act = (id: string, verb: 'done' | 'cancel' | 'no-answer' | 'note', text?: string) =>
    api.requestAction(id, verb, text).then(() => { void load(); onChanged(); }).catch(fail);

  return (
    <div className="space-y-5">
      <PageHeader
        title="So'rovlar"
        description="Mijoz xodimdan nimadir kutyapti: qo'ng'iroq qilishni so'radi, yozilmoqchi, qabulni surmoqchi yoki shikoyat qildi. Instagram, Telegram va qo'ng'iroqlardan o'zi keladi va qabulxonaga Telegram'da tugmali karta bo'lib boradi."
      >
        <Button variant="primary" onClick={() => setAdding(v => !v)}>Yangi so'rov</Button>
      </PageHeader>

      {adding && <NewRequest notify={notify} onDone={() => { setAdding(false); void load(); onChanged(); }} />}

      <div role="tablist" aria-label="So'rovlar" className="flex gap-1">
        {(['open', 'closed'] as const).map(w => (
          <button key={w} type="button" role="tab" aria-selected={which === w} onClick={() => setWhich(w)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${which === w ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/70'}`}>
            {w === 'open' ? `Ochiq${open ? ` (${open})` : ''}` : 'Yopilgan'}
          </button>
        ))}
      </div>

      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !list.length ? (
        <Card>
          <EmptyState icon={Inbox} title={which === 'open' ? "Ochiq so'rov yo'q" : "Yopilgan so'rov yo'q"}>
            {which === 'open' ? "Mijoz Instagram yoki Telegram'da «qo'ng'iroq qiling» desa, raqam qoldirsa yoki shikoyat qilsa — shu yerda va qabulxonaning Telegram'ida paydo bo'ladi." : undefined}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map(r => <RequestRow key={r.id} r={r} onAct={act} />)}
        </ul>
      )}

      <TeamCard notify={notify} />
    </div>
  );
}

function RequestRow({ r, onAct }: { r: RequestView; onAct: (id: string, verb: 'done' | 'cancel' | 'no-answer' | 'note', text?: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (verb: 'done' | 'cancel' | 'no-answer' | 'note', text?: string) => { setBusy(true); void onAct(r.id, verb, text).finally(() => { setBusy(false); setNote(''); }); };
  const who = r.lead?.name || r.name || 'Mijoz';
  const phone = r.phone ?? r.lead?.phone;
  const isOpen = r.status === 'open';
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sheet sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-bold">{KIND[r.kind]} <span className="text-sm font-medium text-slate-500">· {SOURCE[r.source]}</span></p>
        <p className="text-xs tabular-nums text-slate-500">
          {isOpen ? `${waited(r.createdAt)} kutyapti` : r.status === 'done' ? `✅ ${r.doneBy ?? ''} · ${when(r.closedAt ?? r.updatedAt)}` : `✖️ bekor · ${when(r.closedAt ?? r.updatedAt)}`}
        </p>
      </div>
      <p className="mt-1.5 text-[15px]">
        <span className="font-semibold">{who}</span>
        {phone && <> · <a href={`tel:${phone}`} className="font-semibold text-indigo-700 underline-offset-2 hover:underline">{prettyPhone(phone)}</a></>}
        {r.lead?.patientId && <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">DentaCRM bemori</span>}
      </p>
      {(r.whenText || r.dueAt) && <p className="mt-1 text-sm text-slate-700">🕕 {r.whenText ?? ''}{r.dueAt ? <span className="text-slate-500"> ({r.dueAt.replace('T', ' ')})</span> : null}</p>}
      <p className="mt-1 text-sm text-slate-700">{r.summary}</p>
      {r.quote && <p className="mt-1 text-sm italic text-slate-500">«{r.quote}»</p>}
      {r.attempts > 0 && isOpen && <p className="mt-1 text-sm font-semibold text-amber-700">📵 {r.attempts} marta ko'tarmadi</p>}
      {r.result && <p className="mt-1 text-sm text-slate-700">💬 {r.result}</p>}
      {isOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => run('done', note.trim() || undefined)}>✅ Bajarildi</Button>
          <Button size="sm" disabled={busy} onClick={() => run('no-answer')}>📵 Ko'tarmadi</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('cancel')}>Bekor</Button>
          <form className="flex min-w-[14rem] flex-1 gap-2" onSubmit={e => { e.preventDefault(); if (note.trim()) run('note', note.trim()); }}>
            <TextInput value={note} onChange={e => setNote(e.target.value)} placeholder="Natija: «ertaga 10:00 ga yozildi»" aria-label="Natija" className="h-8 text-xs" maxLength={500} />
            <Button size="sm" type="submit" disabled={busy || !note.trim()}>Yozish</Button>
          </form>
        </div>
      )}
    </li>
  );
}

function NewRequest({ notify, onDone }: { notify: Notify; onDone: () => void }) {
  const [kind, setKind] = useState<RequestKind>('callback');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (!phone.trim() || !summary.trim()) return notify('Telefon va nima qilish kerakligini yozing', true);
    setBusy(true);
    api.openRequest({ kind, phone: phone.trim(), name: name.trim() || undefined, summary: summary.trim(), dueAt: dueAt || undefined })
      .then(() => { notify("So'rov ochildi — qabulxonaga yuborildi"); onDone(); })
      .catch(e => notify((e as Error).message, true))
      .finally(() => setBusy(false));
  };
  return (
    <Card title="Yangi so'rov" description="Qabulxonaga Telegram'da karta bo'lib boradi va bajarilmaguncha eslatib turadi.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Turi">
          <select value={kind} onChange={e => setKind(e.target.value as RequestKind)} className={inputClass}>
            {(Object.keys(KIND) as RequestKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}
          </select>
        </Field>
        <Field label="Telefon"><TextInput value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+998 90 123 45 67" maxLength={40} /></Field>
        <Field label="Ism (ixtiyoriy)"><TextInput value={name} onChange={e => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Qachon (ixtiyoriy)"><input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className={`${controlClass} w-full`} /></Field>
        <div className="sm:col-span-2"><Field label="Nima qilish kerak"><TextInput value={summary} onChange={e => setSummary(e.target.value)} placeholder="Qo'ng'iroq qilib davolash rejasini aytish" maxLength={500} /></Field></div>
      </div>
      <Button variant="primary" className="mt-4" disabled={busy} onClick={save}>{busy ? 'Ochilmoqda…' : 'Ochish va yuborish'}</Button>
    </Card>
  );
}

function TeamCard({ notify }: { notify: Notify }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [name, setName] = useState('');
  const fail = (e: unknown) => notify((e as Error).message, true);
  useEffect(() => { api.staff().then(setTeam).catch(fail); const t = setInterval(() => { api.staff().then(setTeam).catch(() => {}); }, 15_000); return () => clearInterval(t); }, []);
  const add = () => { if (name.trim()) api.addStaff(name.trim()).then(t => { setTeam(t); setName(''); }).catch(fail); };
  const copy = (link: string) => navigator.clipboard.writeText(link).then(() => notify('Havola nusxalandi — xodimga yuboring')).catch(() => notify(link));
  return (
    <Card title="Qabulxona xodimlari" description="Xodim havolani o'z Telegram'ida ochadi — shundan keyin so'rovlar unga tugmali karta bo'lib keladi: «Bajarildi», «Ko'tarmadi», natijani yozish. Yordamchi bilan faqat egasi gaplashadi.">
      {team === null ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          {!team.bot && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Telegram bot ulanmagan — havola paydo bo'lishi uchun avval bot tokenini kiriting.</p>}
          <ul className="divide-y divide-slate-100">
            {team.staff.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 font-semibold">{s.name}</span>
                {s.linked ? <span className="text-sm font-semibold text-emerald-700">✓ Telegram ulangan</span>
                  : s.link ? <Button size="sm" onClick={() => copy(s.link!)}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> Havolani nusxalash</Button>
                  : <span className="text-sm text-slate-500">havola bot ulangach</span>}
                <Button size="sm" variant="danger" aria-label={`${s.name}ni olib tashlash`} onClick={() => { if (window.confirm(`${s.name} endi so'rovlarni olmaydi. Olib tashlansinmi?`)) api.removeStaff(s.id).then(setTeam).catch(fail); }}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {!team.staff.length && <p className="text-sm text-slate-500">Hali xodim yo'q — so'rovlar sizga keladi.</p>}
          <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); add(); }}>
            <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Xodim ismi (masalan, Aziza — administrator)" aria-label="Xodim ismi" maxLength={60} />
            <Button type="submit" disabled={!name.trim()}><UserPlus className="h-4 w-4" aria-hidden="true" /> Qo'shish</Button>
          </form>
          {team.staff.some(s => s.linked) && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={team.copyToOwner} onChange={e => api.staffCopy(e.target.checked).then(setTeam).catch(fail)} className="h-4 w-4 rounded border-slate-300" />
              So'rovlar nusxasi menga ham kelsin
            </label>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Phone className="h-3.5 w-3.5" aria-hidden="true" /> Kartadagi raqam Telegram'da bosiladi — telefondan darhol qo'ng'iroq.</p>
        </>
      )}
    </Card>
  );
}
