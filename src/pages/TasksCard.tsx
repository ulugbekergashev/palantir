import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, IconButton, TextInput, controlClass } from '../components/ui';
import { dueLabel, iso, stamp } from '../lib/week';

/** Bitta vazifa qatori: bajarildi belgisi, muddat va o'chirish. Jurnalda ham, bosh sahifadagi bugungi vazifalarda ham shu */
export function TaskRow({ task, now, onChange, notify }: { task: Task; now: Date; onChange: (t: Task) => void; notify: Notify }) {
  const [editing, setEditing] = useState(false);
  const [due, setDue] = useState(task.dueAt ?? '');
  const done = task.status === 'done';
  const overdue = !done && task.dueAt && task.dueAt < stamp(now);
  const save = async (patch: Partial<Pick<Task, 'dueAt' | 'status'>>) => {
    try { onChange((await api.updateTask(task.id, patch)).task); } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <li className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        aria-label={done ? `Qayta ochish: ${task.title}` : `Bajarildi: ${task.title}`}
        onClick={() => save({ status: done ? 'open' : 'done' })}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 hover:border-indigo-500'}`}
      >
        {done && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${done ? 'text-slate-400 line-through' : ''}`}>{task.title}</div>
        {task.notes && <div className="truncate text-xs text-slate-500">{task.notes}</div>}
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input type="datetime-local" aria-label="Muddat" className={`${controlClass} h-8 text-xs`} value={due} onChange={e => setDue(e.target.value)} />
          <Button size="sm" variant="primary" onClick={() => { setEditing(false); void save({ dueAt: due || null }); }}>Saqlash</Button>
          <IconButton label="Yopish" onClick={() => setEditing(false)}><X className="h-4 w-4" /></IconButton>
        </div>
      ) : (
        <button type="button" onClick={() => { setDue(task.dueAt ?? ''); setEditing(true); }} disabled={done}
          className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${overdue ? 'bg-rose-50 text-rose-700' : 'text-slate-500 hover:bg-slate-100'} disabled:hover:bg-transparent`}>
          {task.dueAt ? dueLabel('uz', task.dueAt, now) : done ? '' : '+ muddat'}
        </button>
      )}
      {!done && <IconButton label={`O'chirish: ${task.title}`} onClick={() => save({ status: 'cancelled' })}><X className="h-4 w-4" /></IconButton>}
    </li>
  );
}

/** Vazifalar va eslatmalar — Jurnal ichida. Yordamchiga aytilgani ham, shu yerda yozilgani ham bitta ro'yxatda */
export function TasksCard({ now, notify, onChanged }: { now: Date; notify: Notify; /** Vazifa qo'shildi, bajarildi yoki o'chirildi — menyudagi belgi yangilansin */ onChanged?: () => void }) {
  const [list, setList] = useState<Task[] | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  /** Mahalliy o'zgarishlar hisobi: so'rov yo'lda ekan egasi vazifa qo'shgan yoki belgilagan bo'lsa, eski javob uni bosib ketmaydi */
  const edits = useRef(0);
  useEffect(() => {
    let told = false;
    const load = () => {
      const at = edits.current;
      return api.tasks('all').then(r => { if (edits.current === at) setList(r.tasks); })
        .catch(e => { if (!told) { told = true; notify((e as Error).message, true); } });
    };
    void load();
    // Vazifa Telegram'da ham paydo bo'ladi (yordamchiga aytilganda) va o'chadi — ro'yxat o'zi yangilanib turadi
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    edits.current += 1;
    try {
      const { task } = await api.addTask({ title: title.trim(), dueAt: due || null });
      edits.current += 1;
      setList(l => [task, ...(l ?? [])]);
      onChanged?.();
      setTitle('');
      setDue('');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  const replace = (t: Task) => {
    edits.current += 1;
    setList(l => (t.status === 'cancelled' ? l?.filter(x => x.id !== t.id) : l?.map(x => (x.id === t.id ? t : x))) ?? l);
    onChanged?.();
  };

  const nowStamp = stamp(now);
  const today = iso(now);
  const open = (list ?? []).filter(t => t.status === 'open').sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  const groups: [string, Task[]][] = [
    ['Kechikkan', open.filter(t => t.dueAt && t.dueAt < nowStamp)],
    ['Bugun', open.filter(t => t.dueAt && t.dueAt >= nowStamp && t.dueAt.startsWith(today))],
    ['Keyinroq', open.filter(t => t.dueAt && t.dueAt.slice(0, 10) > today)],
    ['Muddatsiz', open.filter(t => !t.dueAt)],
  ];
  const done = (list ?? []).filter(t => t.status === 'done');
  const rows = (items: Task[]) => <ul className="divide-y divide-slate-100">{items.map(t => <TaskRow key={t.id} task={t} now={now} onChange={replace} notify={notify} />)}</ul>;

  return (
    <Card title={`Vazifalar${open.length ? ` (${open.length})` : ''}`} description="Muddati kelganda Palantir Telegram'ga eslatadi. Yordamchiga «juma kuni 11 da soliq hisobotini eslat» desangiz ham shu yerga tushadi.">
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Yangi vazifa…" aria-label="Vazifa" maxLength={200} />
        <input type="datetime-local" aria-label="Muddat" className={controlClass} value={due} onChange={e => setDue(e.target.value)} />
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Qo'shish</Button>
      </form>
      {list === null ? <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-slate-400" /> : (
        <div className="mt-3 space-y-3">
          {groups.filter(([, items]) => items.length).map(([label, items]) => (
            <section key={label}>
              <h3 className={`text-xs font-bold uppercase tracking-wide ${label === 'Kechikkan' ? 'text-rose-700' : 'text-slate-400'}`}>{label} ({items.length})</h3>
              {rows(items)}
            </section>
          ))}
          {!!done.length && (
            <section>
              <button type="button" onClick={() => setShowDone(s => !s)} aria-expanded={showDone} className="text-xs font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600">
                Bajarilgan ({done.length}) · {showDone ? 'yashirish' : "ko'rsatish"}
              </button>
              {showDone && rows(done)}
            </section>
          )}
        </div>
      )}
    </Card>
  );
}
