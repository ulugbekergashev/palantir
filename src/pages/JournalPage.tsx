import { CalendarClock, CheckCircle2, Loader2 } from 'lucide-react';
import type { Notify } from '../components/Artifacts';
import { JournalRows } from '../components/JournalRows';
import { Card, EmptyState, PageHeader } from '../components/ui';
import { useDayFeed } from '../lib/useDayFeed';
import { TasksCard } from './TasksCard';

/** Jurnal: egasini kutayotgan ishlar, vazifalar va yordamchining bugungi ishlari. Har qator o'z bo'limiga olib boradi */
export function JournalPage({ now, notify, onChanged }: { now: Date; notify: Notify; onChanged?: () => void }) {
  const journal = useDayFeed(notify)?.journal ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="Jurnal" description="Tepada — sizning qaroringizni kutayotgan ishlar, keyin vazifalar, pastda — Cerebro bugun qilgan va ko'rgan narsalar." />
      {/* Vazifalar o'z manbasidan yuklanadi: kamera yoki qo'ng'iroqlar javob bermay tursa ham ko'rinadi */}
      {!journal ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
        <Card title="Sizni kutyapti">
          {journal.waiting.length ? <JournalRows items={journal.waiting} /> : <EmptyState compact icon={CheckCircle2} title="Hozircha sizdan hech narsa kutilmayapti">Tasdiqlash kerak bo'lgan javob yoki kamera topgan farq paydo bo'lsa, shu yerda ko'rinadi.</EmptyState>}
        </Card>
      )}
      <TasksCard now={now} notify={notify} onChanged={onChanged} />
      {journal && (
        <Card title="Bugun">
          {journal.today.length ? <JournalRows items={journal.today} /> : <EmptyState compact icon={CalendarClock} title="Bugun hali hech narsa bo'lmadi">Qo'ng'iroqlar va kamera ko'rganlari shu yerda paydo bo'ladi.</EmptyState>}
        </Card>
      )}
    </div>
  );
}
