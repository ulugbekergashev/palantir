/**
 * Miya — Obsidian kabi, panelning ichida: chapda papkalar va sahifalar, o'rtada sahifa (o'qish yoki tahrirlash), o'ngda
 * bog'lanishlar (shu sahifaga havola qilganlar va undan chiquvchi havolalar). Fayllar Obsidian'dagi bilan bir — «Obsidian'da ochish»
 * o'sha papkani ochadi. Saqlangan o'zgarish AI bilimiga darhol tushadi (mundarija qayta yig'iladi).
 * Ikkinchi varaq — avvalgi «Ikkinchi miya»: mijozlar so'raydigan savollar, narxlar, uslub.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Brain, ChevronDown, ChevronRight, ExternalLink, FilePlus2, FileText, Folder, Link2, Loader2, Pencil, Search } from 'lucide-react';
import { apiBase, session } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { NoteView } from '../components/NoteView';
import { hrefOf } from '../lib/nav';
import { BrainPage } from './BrainPage';

interface TreeNode { name: string; path: string; kind: 'dir' | 'file'; children?: TreeNode[] }
interface Note { path: string; content: string; modified: string; backlinks: { path: string; line: string }[] }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${apiBase}/api/brain/${path}`, { ...init, headers: { authorization: `Bearer ${session.token()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  const body = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? 'Xato');
  return body;
}

const files = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => (n.kind === 'file' ? [n] : files(n.children ?? [])));
const titleOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
const outgoing = (text: string) => [...new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1].trim()))];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const when = (iso: string) => { const d = new Date(iso); return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** Sahifa o'zi shu nomli sarlavha bilan boshlansa — nom ikki marta chiqmasin (Obsidian'dagi kabi bitta sarlavha) */
const startsWithTitle = (text: string, title: string) => (/^(?:---[sS]*?---s*)?#s+(.+)$/m.exec(text.replace(/%%[sS]*?%%/g, '').trimStart())?.[1].trim().toLowerCase() ?? '') === title.toLowerCase();

function TreeView({ nodes, open, toggle, selected, onPick, filter }: {
  nodes: TreeNode[]; open: Set<string>; toggle: (p: string) => void; selected: string | null; onPick: (p: string) => void; filter: string;
}) {
  const match = (n: TreeNode): boolean => n.kind === 'file' ? n.name.toLowerCase().includes(filter) : (n.children ?? []).some(match);
  return (
    <ul className="flex flex-col">
      {nodes.filter(n => !filter || match(n)).map(n => n.kind === 'dir' ? (
        <li key={n.path}>
          <button type="button" onClick={() => toggle(n.path)} aria-expanded={open.has(n.path) || !!filter} className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[14px] text-[#c9cbd2] hover:bg-glass/[0.04]">
            {open.has(n.path) || filter ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8a909c]" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8a909c]" aria-hidden="true" />}
            <Folder className="h-4 w-4 shrink-0 text-[#8a909c]" aria-hidden="true" />
            <span className="truncate">{n.name}</span>
            <span className="ml-auto tabular-nums text-[11px] text-[#6e7582]">{files(n.children ?? []).length || ''}</span>
          </button>
          {(open.has(n.path) || !!filter) && <div className="ml-3 border-l border-glass/[0.06] pl-1"><TreeView nodes={n.children ?? []} open={open} toggle={toggle} selected={selected} onPick={onPick} filter={filter} /></div>}
        </li>
      ) : (
        <li key={n.path}>
          <button type="button" onClick={() => onPick(n.path)} aria-current={selected === n.path ? 'page' : undefined}
            className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2 pl-[26px] text-left text-[14px] ${selected === n.path ? 'bg-[#8b8cff]/15 text-[#f2f0ea]' : 'text-[#a3a9b5] hover:bg-glass/[0.04] hover:text-[#e4e3de]'}`}>
            <span className="truncate">{n.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Vault({ notify }: { notify: Notify }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Bilim']));
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = !!note && editing && draft !== note.content;

  const loadTree = () => call<{ tree: TreeNode[] }>('files').then(r => { setTree(r.tree); return r.tree; });
  const openNote = async (path: string, edit = false) => {
    if (dirty && !window.confirm('Saqlanmagan o‘zgarish bor. Tashlab ketaymi?')) return;
    try {
      const r = await call<{ note: Note }>(`note?path=${encodeURIComponent(path)}`);
      setSelected(r.note.path);
      setNote(r.note);
      setDraft(r.note.content);
      setEditing(edit);
      const parts = r.note.path.split('/').slice(0, -1);
      setOpen(prev => new Set([...prev, ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]));
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  useEffect(() => {
    loadTree().then(t => {
      const first = files(t).find(f => f.path === 'INDEKS.md') ?? files(t)[0];
      if (first) void openNote(first.path);
    }).catch(e => notify((e as Error).message, true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => (tree ? files(tree) : []), [tree]);
  /** [[Nom]] — shu nomli sahifa (papkasi har qanday); yo'q bo'lsa — yangi sahifa ochiladi (Obsidian'dagidek) */
  const follow = (target: string) => {
    const t = target.toLowerCase().replace(/\.md$/i, '');
    const hit = all.find(f => f.path.toLowerCase().replace(/\.md$/i, '') === t) ?? all.find(f => f.name.toLowerCase() === t.split('/').pop());
    if (hit) void openNote(hit.path);
    else startNew(target.split('/').pop() ?? target);
  };

  const save = async () => {
    if (!note || saving) return;
    setSaving(true);
    try {
      const r = await call<{ note: Note }>('note', { method: 'PUT', body: JSON.stringify({ path: note.path, content: draft }) });
      setNote(r.note);
      setDraft(r.note.content);
      setEditing(false);
      notify('Saqlandi — Palantir endi shuni biladi');
      void loadTree();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    if (e.key === 'Escape' && !dirty) setEditing(false);
  };

  const startNew = (name = '') => setNewName(name);
  const create = async () => {
    const name = (newName ?? '').trim().replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const path = `Bilim/${name}.md`;
    try {
      await call('note', { method: 'PUT', body: JSON.stringify({ path, content: `# ${name}\n\n` }) });
      setNewName(null);
      await loadTree();
      await openNote(path, true);
      setTimeout(() => editor.current?.focus(), 50);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  const openObsidian = async () => {
    try {
      window.location.href = (await call<{ url: string }>('obsidian')).url;
    } catch {
      notify('Obsidian ochilmadi', true);
    }
  };

  const links = note ? outgoing(editing ? draft : note.content) : [];

  return (
    <div className="flex min-h-[calc(100dvh-15rem)] flex-wrap overflow-hidden rounded-2xl border border-glass/[0.08] bg-[#0b0c10] lg:h-[calc(100dvh-15rem)] lg:flex-nowrap">
      {/* Papkalar */}
      <aside aria-label="Sahifalar" className="flex w-full flex-col border-b border-glass/[0.06] bg-[#0e1015] lg:w-[270px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-1 px-3 pb-2 pt-3">
          <span className="mr-auto text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a909c]">Sahifalar</span>
          <button type="button" onClick={() => startNew()} aria-label="Yangi sahifa" title="Yangi sahifa" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]"><FilePlus2 className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => { void openObsidian(); }} aria-label="Obsidian'da ochish" title="Obsidian'da ochish" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]"><ExternalLink className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {newName !== null && (
          <form onSubmit={e => { e.preventDefault(); void create(); }} className="mx-3 mb-2 flex gap-1">
            <label htmlFor="new-note" className="sr-only">Yangi sahifa nomi</label>
            <input id="new-note" autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setNewName(null); }} placeholder="Sahifa nomi" className="h-9 min-w-0 flex-1 rounded-lg border border-glass/10 bg-[#07080b] px-2.5 text-[14px] text-[#f2f0ea] outline-none focus:border-[#8b8cff]/60" />
            <button type="submit" className="h-9 rounded-lg bg-[#8b8cff] px-3 text-[13px] font-semibold text-[#07080b]">Yaratish</button>
          </form>
        )}
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-glass/[0.08] bg-[#07080b] px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#8a909c]" aria-hidden="true" />
          <label htmlFor="vault-search" className="sr-only">Sahifa qidirish</label>
          <input id="vault-search" value={filter} onChange={e => setFilter(e.target.value.toLowerCase())} placeholder="Qidirish…" className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6e7582]" />
        </div>
        <div className="max-h-72 flex-1 overflow-y-auto px-1.5 pb-3 lg:max-h-none">
          {tree ? <TreeView nodes={tree} open={open} toggle={p => setOpen(prev => { const s = new Set(prev); if (s.has(p)) s.delete(p); else s.add(p); return s; })} selected={selected} onPick={p => { void openNote(p); }} filter={filter} />
            : <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-[#8a909c]" aria-label="Yuklanmoqda" />}
        </div>
      </aside>

      {/* Sahifa */}
      <section aria-label="Sahifa" className="flex min-w-0 flex-1 basis-[420px] flex-col">
        {note ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-glass/[0.06] px-5 py-2.5">
              <span className="mr-auto truncate text-[13px] text-[#8a909c]">{note.path.replace(/\.md$/i, '').split('/').join(' / ')}</span>
              {dirty && <span className="text-[12px] text-[#f5b454]">saqlanmagan</span>}
              {editing ? (
                <>
                  <button type="button" onClick={() => { setDraft(note.content); setEditing(false); }} className="min-h-9 rounded-lg px-3 text-[13px] text-[#a3a9b5] hover:bg-glass/5">Bekor</button>
                  <button type="button" onClick={() => { void save(); }} disabled={!dirty || saving} className="min-h-9 rounded-lg bg-[#8b8cff] px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-40">{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
                </>
              ) : (
                <button type="button" onClick={() => { setEditing(true); setTimeout(() => editor.current?.focus(), 30); }} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-glass/10 px-3 text-[13px] text-[#d9dbe1] hover:bg-glass/5">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Tahrirlash
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[760px] px-6 py-8 sm:px-10">
                {(editing || !startsWithTitle(note.content, titleOf(note.path))) && <h1 className="mb-5 text-[32px] font-bold leading-tight tracking-tight text-[#f2f0ea]">{titleOf(note.path)}</h1>}
                {editing ? (
                  <>
                    <label htmlFor="note-editor" className="sr-only">Sahifa matni</label>
                    <textarea id="note-editor" ref={editor} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} spellCheck={false}
                      className="min-h-[60vh] w-full resize-none rounded-xl border border-glass/[0.08] bg-transparent p-4 tabular-nums text-[14px] leading-[1.7] text-[#e4e3de] outline-none focus:border-[#8b8cff]/50" />
                    <p className="mt-2 text-[12px] text-[#8a909c]">Ctrl+S — saqlash · [[Sahifa nomi]] — havola · - [ ] — vazifa</p>
                  </>
                ) : <NoteView text={note.content} onLink={follow} />}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-[#8a909c]">{tree && !all.length ? "Miya hali bo'sh — yangi sahifa yarating" : 'Sahifani tanlang'}</div>
        )}
      </section>

      {/* Bog'lanishlar */}
      {note && (
        <aside aria-label="Bog'lanishlar" className="w-full border-t border-glass/[0.06] bg-[#0e1015] px-4 py-4 lg:w-[260px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a909c]"><Link2 className="h-3.5 w-3.5" aria-hidden="true" />Shu sahifaga havolalar · {note.backlinks.length}</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {note.backlinks.map(b => (
              <li key={b.path}>
                <button type="button" onClick={() => { void openNote(b.path); }} className="w-full rounded-lg border border-glass/[0.06] bg-glass/[0.02] px-3 py-2 text-left hover:bg-glass/[0.05]">
                  <span className="block truncate text-[13px] font-medium text-[#e4e3de]">{titleOf(b.path)}</span>
                  {b.line && <span className="mt-0.5 block line-clamp-2 text-[12px] text-[#8a909c]">{b.line}</span>}
                </button>
              </li>
            ))}
            {!note.backlinks.length && <li className="text-[13px] text-[#6e7582]">Hech qaysi sahifa havola qilmagan</li>}
          </ul>
          <h2 className="mt-6 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a909c]"><FileText className="h-3.5 w-3.5" aria-hidden="true" />Bu sahifadagi havolalar · {links.length}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {links.map(l => <li key={l}><button type="button" onClick={() => follow(l)} className="rounded-full bg-[#8b8cff]/12 px-2.5 py-1 text-[12px] text-[#c7c8ff] hover:bg-[#8b8cff]/20" title={l}>{l.split("/").pop()}</button></li>)}
            {!links.length && <li className="text-[13px] text-[#6e7582]">Havola yo'q</li>}
          </ul>
          <p className="mt-6 text-[12px] text-[#6e7582]">O'zgargan: {when(note.modified)}</p>
        </aside>
      )}
    </div>
  );
}

export function MiyaArea({ tab, notify }: { tab: string | null; notify: Notify }) {
  const active = tab === 'savollar' ? 'savollar' : 'sahifalar';
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-glass/[0.06] pb-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#8b8cff]/15 text-[#c7c8ff]"><Brain className="h-7 w-7" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#f2f0ea]">Miya</h1>
            <p className="mt-0.5 text-sm text-[#a3a9b5]">Palantir bilgan hamma narsa — oddiy sahifalar. Bu yerda yoki Obsidian'da yozing: jamoa shundan javob beradi.</p>
          </div>
        </div>
        <nav aria-label="Varaqlar" className="flex flex-wrap gap-1.5">
          {[{ id: 'sahifalar', label: 'Sahifalar' }, { id: 'savollar', label: 'Savollar va narxlar' }].map(t => (
            <a key={t.id} href={hrefOf('miya', t.id)} aria-current={t.id === active ? 'page' : undefined}
              className={`min-h-10 rounded-full px-4 py-2 text-sm font-medium no-underline transition-colors ${t.id === active ? 'bg-[#f2f0ea] text-[#07080b]' : 'text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]'}`}>{t.label}</a>
          ))}
        </nav>
      </header>
      {active === 'sahifalar' ? <Vault notify={notify} /> : <div className="agent-body"><BrainPage notify={notify} /></div>}
    </div>
  );
}
