import { useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Card, MoreLink } from '../components/ui';
import { iso } from '../lib/week';
import { TaskRow } from './TasksCard';

const TASKS_POLL_MS = 15_000;

/**
 * Ochiq vazifalar (GET /api/tasks?status=open) — bosh sahifa uchun. Shu yerda «bajarildi» qilingan vazifa ro'yxatda
 * chizilgan holda qoladi (adashib bosilgan bo'lsa qayta ochish mumkin); o'chirilgani yo'qoladi. Yuklanguncha — null.
 */
export function useOpenTasks(notify: Notify, onChanged?: () => void): { tasks: Task[] | null; replace: (t: Task) => void } {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  /** Mahalliy o'zgarishlar hisobi: so'rov yo'lda ekan egasi vazifani belgilagan bo'lsa, eski javob uni bosib ketmaydi */
  const edits = useRef(0);
  useEffect(() => {
    let told = false, gone = false;
    const load = () => {
      const at = edits.current;
      return api.tasks('open').then(r => {
        if (gone || edits.current !== at) return;
        setTasks(prev => [...r.tasks, ...(prev ?? []).filter(t => t.status === 'done' && !r.tasks.some(o => o.id === t.id))]);
      }).catch(e => {
        if (gone) return;
        // Ro'yxat kelmasa ham bosh sahifaning qolgan bo'laklari ko'rinadi (vazifalar bo'sh deb olinadi, keyingi urinishda to'ladi)
        setTasks(prev => prev ?? []);
        if (!told) { told = true; notify((e as Error).message, true); }
      });
    };
    void load();
    const t = setInterval(() => { void load(); }, TASKS_POLL_MS);
    return () => { gone = true; clearInterval(t); };
  }, []);
  const replace = (t: Task) => {
    edits.current += 1;
    setTasks(l => l?.flatMap(x => (x.id !== t.id ? [x] : t.status === 'cancelled' ? [] : [t])) ?? l);
    onChanged?.();
  };
  return { tasks, replace };
}

/** Bugungi va muddati o'tgan vazifalar (va shu yerda hozirgina bajarilganlar), muddati bo'yicha */
export const dueToday = (tasks: Task[], now: Date): Task[] => {
  const end = `${iso(now)}T23:59`;
  return tasks.filter(t => t.dueAt && t.dueAt <= end).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
};

/** Bugungi vazifalar: Jurnaldagi bilan bir xil qator — belgilash, muddatni surish, o'chirish */
export function TodayTasks({ tasks, now, replace, notify }: { tasks: Task[]; now: Date; replace: (t: Task) => void; notify: Notify }) {
  const open = tasks.filter(t => t.status === 'open').length;
  return (
    <Card title={`Bugungi vazifalar${open ? ` · ${open}` : ''}`} action={<MoreLink href="#/journal">Jurnal</MoreLink>}>
      <ul className="divide-y divide-slate-100">
        {tasks.map(t => <TaskRow key={t.id} task={t} now={now} onChange={replace} notify={notify} />)}
      </ul>
    </Card>
  );
}
