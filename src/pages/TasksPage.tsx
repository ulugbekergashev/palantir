import { useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Check, Loader2, Plus, X } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, IconButton, TextInput, controlClass } from '../components/ui';
import { dueLabel, iso, stamp } from '../lib/week';

function TaskRow({ task, now, onChange, notify }: { task: Task; now: Date; onChange: (t: Task) => void; notify: Notify }) {
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

export function TasksPage({ now, notify }: { now: Date; notify: Notify }) {
  const [list, setList] = useState<Task[] | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => { api.tasks('all').then(r => setList(r.tasks)).catch(e => notify((e as Error).message, true)); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { task } = await api.addTask({ title: title.trim(), dueAt: due || null });
      setList(l => [task, ...(l ?? [])]);
      setTitle('');
      setDue('');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  const replace = (t: Task) => setList(l => (t.status === 'cancelled' ? l?.filter(x => x.id !== t.id) : l?.map(x => (x.id === t.id ? t : x))) ?? l);

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

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Vazifalar</h1>
        <p className="text-sm text-slate-500">Muddati bor vazifa uchun Cerebro vaqtida Telegram'ga eslatma yuboradi. Yordamchiga aytsangiz ham shu yerga tushadi.</p>
      </header>

      <form onSubmit={add} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[1fr_auto_auto]">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Yangi vazifa…" aria-label="Vazifa" maxLength={200} />
        <input type="datetime-local" aria-label="Muddat" className={controlClass} value={due} onChange={e => setDue(e.target.value)} />
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Qo'shish</Button>
      </form>

      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !open.length && !done.length ? (
        <Card><p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><CalendarClock className="h-5 w-5" /> Hali vazifa yo'q. Yordamchiga ayting: «Juma kuni soat 11 da soliqqa hisobot topshirishni eslat».</p></Card>
      ) : (
        <>
          {groups.filter(([, items]) => items.length).map(([label, items]) => (
            <Card key={label} title={`${label} (${items.length})`} className={label === 'Kechikkan' ? 'border-rose-200' : ''}>
              <ul className="-my-2 divide-y divide-slate-100">{items.map(t => <TaskRow key={t.id} task={t} now={now} onChange={replace} notify={notify} />)}</ul>
            </Card>
          ))}
          {!!done.length && (
            <Card title={`Bajarilgan (${done.length})`} action={<Button size="sm" variant="ghost" onClick={() => setShowDone(s => !s)}>{showDone ? 'Yashirish' : "Ko'rsatish"}</Button>}>
              {showDone ? <ul className="-my-2 divide-y divide-slate-100">{done.map(t => <TaskRow key={t.id} task={t} now={now} onChange={replace} notify={notify} />)}</ul> : null}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
