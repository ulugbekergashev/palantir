/**
 * Xotira — kompaniya papkasi: qarorlar, qoidalar, faktlar, afzalliklar, odatlar, kontaktlar (Bilim/Faktlar.md, Obsidian'da ham).
 * Chapda — turlar va teglar (soni bilan), o'ngda — qidiruv, «Eskirganlar ham» va yozuvlar. Eskirgan yozuv AI'ga berilmaydi,
 * lekin tarixda qoladi (narx o'zgarsa, eskisi o'chmaydi). Har yozuvda — sana, kim yozgani, qayerdan va teglar.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Contact, Gavel, Heart, Info, Layers, ListChecks, Loader2, Plus, Repeat, RotateCcw, Search, Trash2, X, type LucideIcon } from 'lucide-react';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { KIND_LABEL, MEMORY_KINDS, cleanTags } from '../lib/memory';
import type { MemoryKind, Note } from '../types';

const KIND_LOOK: Record<MemoryKind, { icon: LucideIcon; text: string; bg: string }> = {
  qaror: { icon: Gavel, text: 'text-violet-300', bg: 'bg-violet-400/[0.12]' },
  qoida: { icon: ListChecks, text: 'text-sky-300', bg: 'bg-sky-400/[0.12]' },
  fakt: { icon: Info, text: 'text-[#d3d8e2]', bg: 'bg-[#d3d8e2]/[0.12]' },
  afzallik: { icon: Heart, text: 'text-amber-300', bg: 'bg-amber-400/[0.12]' },
  odat: { icon: Repeat, text: 'text-emerald-300', bg: 'bg-emerald-400/[0.12]' },
  kontakt: { icon: Contact, text: 'text-pink-300', bg: 'bg-pink-400/[0.12]' },
};
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const day = (d: string) => (d ? `${Number(d.slice(8, 10))}-${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}${d.slice(0, 4) === String(new Date().getFullYear()) ? '' : ` ${d.slice(0, 4)}`}` : '');
const kindOf = (n: Note): MemoryKind => n.kind ?? 'fakt';

type Filter = MemoryKind | 'all';

export function MemoryPage({ notify }: { notify: Notify }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [withStale, setWithStale] = useState(false);
  const [adding, setAdding] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const reload = () => api.memory().then(r => setNotes(r.notes)).catch(fail);
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = (notes ?? []).filter(n => !n.staleAt);
  const pool = withStale ? (notes ?? []) : live;
  // Bir necha yuz yozuvdan ortiq bo'lmaydi — har chizishda hisoblash arzon
  const counts = Object.fromEntries(MEMORY_KINDS.map(k => [k, pool.filter(n => kindOf(n) === k).length])) as Record<MemoryKind, number>;
  const tagCount = new Map<string, number>();
  for (const n of pool) for (const t of n.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const q = query.trim().toLowerCase();
  const shown = pool
    .filter(n => filter === 'all' || kindOf(n) === filter)
    .filter(n => !tag || (n.tags ?? []).includes(tag))
    .filter(n => !q || (q.startsWith('#') ? (n.tags ?? []).some(t => t.startsWith(q.slice(1))) : `${n.text} ${(n.tags ?? []).join(' ')} ${n.by ?? ''}`.toLowerCase().includes(q)))
    // Yangisi tepada; sanasiz (eski) yozuvlar — oxirida, fayldagi tartibda
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (b.n.createdAt || '').localeCompare(a.n.createdAt || '') || b.i - a.i)
    .map(x => x.n);
  const staleCount = (notes ?? []).length - live.length;

  const update = (id: string, patch: Parameters<typeof api.updateNote>[1], done?: string) =>
    api.updateNote(id, patch).then(() => { if (done) notify(done); return reload(); }).catch(fail);
  const remove = (id: string) => api.deleteNote(id).then(() => { notify("O'chirildi"); return reload(); }).catch(fail);

  const side = (f: Filter, label: string, count: number, icon: LucideIcon, tone = 'text-[#8a909c]') => {
    const Icon = icon;
    const on = filter === f;
    return (
      <li key={f}>
        <button type="button" onClick={() => setFilter(f)} aria-pressed={on}
          className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors ${on ? 'bg-[#ff9a3c]/[0.13] text-[#f2f0ea]' : 'text-[#a3a9b5] hover:bg-glass/[0.05] hover:text-[#e4e3de]'}`}>
          <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-[#ffd9a0]' : tone}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="tabular-nums text-[12px] text-[#6c727e]">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex min-h-[calc(100dvh-15rem)] flex-col overflow-hidden rounded-2xl border border-glass/[0.08] bg-[#0b0c10] lg:flex-row">
      <aside aria-label="Xotira turlari" className="border-b border-glass/[0.06] bg-[#0e1015] p-3 lg:w-[240px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="px-2.5 pb-3 pt-1">
          <p className="text-[15px] font-semibold text-[#f2f0ea]">Xotira <span className="tabular-nums text-[#6c727e]">{live.length}</span></p>
          <p className="mt-0.5 text-[12px] text-[#8a909c]">{live.length} jonli{staleCount ? ` · ${staleCount} eskirgan` : ''}</p>
        </div>
        <ul className="flex flex-col gap-0.5">
          {side('all', 'Hammasi', pool.length, Layers)}
          {MEMORY_KINDS.map(k => side(k, KIND_LABEL[k].many, counts[k], KIND_LOOK[k].icon, KIND_LOOK[k].text))}
        </ul>
        {tags.length > 0 && (
          <>
            <p className="px-2.5 pb-1.5 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#5f6571]">Teglar</p>
            <div className="flex flex-wrap gap-1.5 px-1.5">
              {tags.map(([t, c]) => (
                <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t}
                  className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${tag === t ? 'bg-[#ff9a3c] text-[#07080b]' : 'bg-glass/[0.05] text-[#a3a9b5] hover:bg-glass/[0.09]'}`}>
                  #{t} <span className="tabular-nums opacity-60">{c}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      <section aria-label="Yozuvlar" className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-glass/[0.06] px-4 py-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-glass/[0.08] bg-[#07080b] px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#8a909c]" aria-hidden="true" />
            <label htmlFor="memory-search" className="sr-only">Xotiradan qidirish</label>
            <input id="memory-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="So'z yoki #teg"
              className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6c727e]" />
          </div>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-[#a3a9b5]">
            <input type="checkbox" checked={withStale} onChange={e => setWithStale(e.target.checked)} className="peer sr-only" />
            <span aria-hidden="true" className="relative h-5 w-9 rounded-full bg-glass/[0.12] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-[#d9dbe1] after:transition-transform peer-checked:bg-[#ff9a3c] peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-[#ff9a3c]/60" />
            Eskirganlar ham
          </label>
          <button type="button" onClick={() => setAdding(v => !v)} aria-expanded={adding}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#ff9a3c] px-3.5 text-[13px] font-semibold text-[#07080b] hover:bg-[#ffab5c]">
            {adding ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{adding ? 'Yopish' : 'Yangi yozuv'}
          </button>
        </div>

        {adding && <AddForm initialKind={filter === 'all' ? 'fakt' : filter} onAdded={n => { setAdding(false); notify(`${KIND_LABEL[kindOf(n)].one} saqlandi`); void reload(); }} onError={fail} />}

        {(tag || filter !== 'all') && (
          <p className="px-4 pt-3 text-[12.5px] text-[#8a909c]">
            {filter !== 'all' && <>{KIND_LABEL[filter].many} — {KIND_LABEL[filter].hint.toLowerCase()}</>}
            {tag && <>{filter !== 'all' && ' · '}teg <button type="button" onClick={() => setTag(null)} className="text-[#ffd9a0] underline-offset-2 hover:underline">#{tag} ✕</button></>}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {!notes ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-[#8a909c]" aria-label="Yuklanmoqda" />
            : !shown.length ? (
              <div className="mx-auto mt-10 max-w-sm text-center">
                <p className="text-[14px] text-[#d9dbe1]">{pool.length ? 'Bu filtr bo\'yicha yozuv yo\'q' : "Xotira hali bo'sh"}</p>
                <p className="mt-1 text-[13px] text-[#8a909c]">Yordamchiga «eslab qol: …» deb ayting yoki «Yangi yozuv»ni bosing. Qaror, qoida va faktlarni AI har ishdan oldin o'qiydi.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map(n => <MemoryCard key={n.id} note={n} onTag={setTag} onUpdate={update} onRemove={remove} />)}
              </ul>
            )}
        </div>
      </section>
    </div>
  );
}

function KindChip({ kind }: { kind: MemoryKind }) {
  const look = KIND_LOOK[kind], Icon = look.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${look.bg} ${look.text}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />{KIND_LABEL[kind].one.toLowerCase()}
    </span>
  );
}

function MemoryCard({ note, onTag, onUpdate, onRemove }: {
  note: Note;
  onTag: (t: string) => void;
  onUpdate: (id: string, patch: Parameters<typeof api.updateNote>[1], done?: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const [sure, setSure] = useState(false);
  const kind = kindOf(note);
  // Kim yozgani manbani ham aytadi («Siz (suhbatda)», «Narxlar ro'yxati») — manba alohida ko'rsatilmaydi
  const meta = [day(note.createdAt), note.by].filter(Boolean);
  return (
    <li className={`group rounded-xl border px-4 py-3 transition-colors ${note.staleAt ? 'border-glass/[0.05] bg-transparent opacity-60' : 'border-glass/[0.07] bg-glass/[0.025] hover:border-glass/[0.12]'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip kind={kind} />
            {note.staleAt && <span className="rounded-md bg-glass/[0.06] px-1.5 py-0.5 text-[11px] text-[#a3a9b5]">eskirgan{note.staleAt !== '0000-00-00' ? ` · ${day(note.staleAt)}` : ''}</span>}
          </div>
          <p className={`mt-1.5 text-[14.5px] leading-relaxed text-[#e4e3de] ${note.staleAt ? 'line-through decoration-[#6c727e]' : ''}`}>{note.text}</p>
          {(meta.length > 0 || (note.tags ?? []).length > 0) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#6c727e]">
              {meta.join(' · ')}
              {(note.tags ?? []).map(t => <button key={t} type="button" onClick={() => onTag(t)} className="text-[#8fb3ff] hover:underline">#{t}</button>)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <label className="sr-only" htmlFor={`kind-${note.id}`}>Turi</label>
          <select id={`kind-${note.id}`} value={kind} onChange={e => { void onUpdate(note.id, { kind: e.target.value as MemoryKind }); }}
            className="h-8 rounded-lg border border-glass/[0.08] bg-[#0b0c10] px-1.5 text-[12px] text-[#d9dbe1] outline-none focus:border-[#ff9a3c]/50">
            {MEMORY_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k].one}</option>)}
          </select>
          {note.staleAt
            ? <IconButton label="Qaytarish (AI yana ishlatadi)" icon={RotateCcw} onClick={() => { void onUpdate(note.id, { stale: false }, 'Qaytarildi'); }} />
            : <IconButton label="Eskirgan deb belgilash (AI ishlatmaydi, tarixda qoladi)" icon={Archive} onClick={() => { void onUpdate(note.id, { stale: true }, 'Eskirgan deb belgilandi'); }} />}
          {sure
            ? <button type="button" onClick={() => { void onRemove(note.id); }} onBlur={() => setSure(false)} autoFocus className="h-8 rounded-lg bg-rose-500/90 px-2.5 text-[12px] font-semibold text-white">O'chirilsinmi?</button>
            : <IconButton label="O'chirish" icon={Trash2} onClick={() => setSure(true)} danger />}
        </div>
      </div>
    </li>
  );
}

function IconButton({ label, icon: Icon, onClick, danger = false }: { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#8a909c] transition-colors hover:bg-glass/[0.06] ${danger ? 'hover:text-rose-300' : 'hover:text-[#f2f0ea]'}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function AddForm({ initialKind, onAdded, onError }: { initialKind: MemoryKind; onAdded: (n: Note) => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind>(initialKind);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    api.addNote(text.trim(), { kind, tags: cleanTags(tags.split(/[,\s]+/)) })
      .then(r => onAdded(r.note)).catch(onError).finally(() => setBusy(false));
  };
  return (
    <form onSubmit={submit} className="border-b border-glass/[0.06] bg-[#0e1015] px-4 py-4">
      <fieldset>
        <legend className="sr-only">Turi</legend>
        <div className="flex flex-wrap gap-1.5">
          {MEMORY_KINDS.map(k => {
            const look = KIND_LOOK[k], Icon = look.icon, on = kind === k;
            return (
              <label key={k} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#ff9a3c]/60 ${on ? `border-transparent ${look.bg} ${look.text}` : 'border-glass/[0.08] text-[#a3a9b5] hover:bg-glass/[0.04]'}`}>
                <input type="radio" name="memory-kind" value={k} checked={on} onChange={() => setKind(k)} className="sr-only" />
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />{KIND_LABEL[k].one}
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="mt-2 text-[12px] text-[#8a909c]">{KIND_LABEL[kind].hint}</p>
      <label htmlFor="memory-text" className="sr-only">Yozuv matni</label>
      <textarea id="memory-text" value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={500} autoFocus
        placeholder={kind === 'qaror' ? "Masalan: Reklama limiti oyiga 500$ — oktabrdagi natijaga qarab" : 'Masalan: Yetkazib berish 200 000 so\'mdan bepul'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }}
        className="mt-2 w-full resize-none rounded-lg border border-glass/[0.08] bg-[#07080b] px-3 py-2 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6c727e] focus:border-[#ff9a3c]/50" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="memory-tags" className="sr-only">Teglar</label>
        <input id="memory-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="Teglar: narx, yetkazish"
          className="h-9 min-w-[180px] flex-1 rounded-lg border border-glass/[0.08] bg-[#07080b] px-3 text-[13px] text-[#f2f0ea] outline-none placeholder:text-[#6c727e] focus:border-[#ff9a3c]/50" />
        <button type="submit" disabled={!text.trim() || busy} className="h-9 rounded-lg bg-[#ff9a3c] px-4 text-[13px] font-semibold text-[#07080b] disabled:opacity-40">
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </div>
    </form>
  );
}
