import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import type { Business, LiveStatus } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { JournalRows } from '../components/JournalRows';
import { Button, Card, MoreLink } from '../components/ui';
import { askPalantir } from '../lib/ask';
import { isMedical } from '../lib/compliance';
import { setupSteps } from '../lib/setup';
import { useDayFeed } from '../lib/useDayFeed';
import { DAYS, dayLong, weekday } from '../lib/week';
import { ClinicDayCard } from './ClinicDayCard';
import { Dashboard } from './dashboard/Dashboard';
import { CamerasBlock } from './DayBlocks';
import { SetupCard } from './SetupCard';
import { TodayTasks, dueToday, useOpenTasks } from './TodayTasks';

const QUICK = ['Bugun nima qilishim kerak?', 'Ertaga soat 10 da bankka borishni eslat', 'Hamkorlik shartnomasi tayyorla'];
const QUICK_CLINIC = ['Bugun nima qilishim kerak?', 'Bugungi tushum qancha?', 'Ertaga nechta bemor yozilgan?'];

/** Bosh sahifa to'ridagi katak: toq sonli bo'laklarning oxirgisi ikki ustunni egallaydi */
const CELL = 'min-w-0 lg:last:odd:col-span-2';

const greeting = (hour: number): string => (hour < 5 || hour >= 22 ? 'Xayrli tun' : hour < 11 ? 'Xayrli tong' : hour < 17 ? 'Xayrli kun' : 'Xayrli kech');

/** Yordamchiga savol: matn suhbat sahifasiga topshiriladi, u yerda yuboriladi (suhbat mantig'i takrorlanmaydi) */
function AskBar({ ai, clinic }: { ai: boolean; clinic: boolean }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) askPalantir(text); };
  return (
    <div className="mt-6 max-w-3xl">
      <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white p-2 pl-3 shadow-lift transition focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/15 hover:border-slate-400 focus-within:hover:border-indigo-500">
        <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0" />
        <input value={text} onChange={e => setText(e.target.value)} aria-label="Palantir'ga savol" placeholder="Palantir'dan so'rang yoki topshiriq bering…" maxLength={2000} enterKeyHint="send"
          className="h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-slate-400" />
        <Button type="submit" variant="primary" disabled={!text.trim()}>So'rash <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tayyor savollar">
        {(clinic ? QUICK_CLINIC : QUICK).map(q => (
          <li key={q}>
            <button type="button" onClick={() => askPalantir(q)} className="rounded-full border border-slate-300 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-white hover:text-slate-900 active:bg-slate-100">{q}</button>
          </li>
        ))}
      </ul>
      {!ai && <p className="mt-3 text-sm font-medium text-amber-800">AI kaliti ulanmagan — yordamchi hozircha javob bera olmaydi.</p>}
    </div>
  );
}

/**
 * Bosh sahifa: egasi biznesni bir qarashda ko'radi. Tepadan pastga: salom va yordamchiga savol; boshqaruv paneli (murojaatlar,
 * javob vaqti, javobsizlar, so'rovlar — davr bo'yicha, dinamika, kanallar va jamoa); klinika kuni (DentaCRM), sizni kutayotgan ishlar va bugungi vazifalar.
 * Hali hech narsa ulanmagan bo'lsa — birinchi bo'lib ishga tushirish ro'yxati.
 */
export function HomePage({ biz, status, now, notify, onChanged }: { biz: Business; status: LiveStatus; now: Date; notify: Notify; onChanged: () => void }) {
  const feed = useDayFeed(notify);
  const { tasks, replace } = useOpenTasks(notify, onChanged);
  const [hasCamera, setHasCamera] = useState(false);
  useEffect(() => {
    let gone = false;
    api.cameras().then(r => { if (!gone) setHasCamera(r.cameras.length > 0); }).catch(e => { if (!gone) notify((e as Error).message, true); });
    return () => { gone = true; };
  }, []);

  const clinic = isMedical(biz.industry);
  const owner = biz.ownerName.trim().split(/\s+/)[0];
  const steps = feed ? setupSteps(status, clinic, feed.brain) : [];
  // Asosiy ulanishlar yo'q — ro'yxat eng tepada; faqat bilim qadamlari qolgan bo'lsa — pastda, kunga xalaqit bermaydi
  const fresh = !status.ownerLinked || (clinic && !status.crm.account);
  const setup = steps.some(s => !s.done) && <SetupCard steps={steps} />;
  const waiting = feed?.journal.waiting ?? [];
  const today = tasks ? dueToday(tasks, now) : [];
  const cameras = hasCamera ? feed?.summary ?? null : null;

  return (
    <div className="space-y-8">
      <header className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 lg:hidden">{DAYS.uz[weekday(now)]}, {dayLong('uz', now)}</p>
          <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:mt-0">{greeting(now.getHours())}{owner ? `, ${owner}` : ''}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{biz.name} — bugungi holat bir qarashda.</p>
          <AskBar ai={status.ai} clinic={clinic || !!status.crm.account} />
        </div>
        {/* Keng ekranda sana — daftar varag'ining burchagidagidek yirik raqam bilan */}
        <p className="hidden shrink-0 text-right lg:block">
          <span className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{DAYS.uz[weekday(now)]}</span>
          <span className="block text-6xl font-extrabold leading-none tracking-tighter tabular-nums text-slate-900">{now.getDate()}</span>
          <span className="mt-1 block text-sm font-semibold text-slate-500">{dayLong('uz', now).replace(/^\d+-/, '')} {now.getFullYear()}</span>
        </p>
      </header>

      {fresh && setup}
      <Dashboard status={status} clinic={clinic || !!status.crm.account} notify={notify} />
      {status.crm.account && <ClinicDayCard status={status} now={now} />}

      {/* Klinika kuni o'zi kutish belgisini ko'rsatadi — ikkinchisi kerak emas */}
      {!feed || !tasks ? !status.crm.account && <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" aria-label="Yuklanmoqda" /> : (
        <>
          {!fresh && !waiting.length && !today.length && (
            <p className="flex items-center gap-2.5 rounded-2xl border border-dashed border-slate-300 px-5 py-4 text-sm text-slate-600">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              Hozircha sizdan hech narsa kutilmayapti, bugunga vazifa ham yo'q.
            </p>
          )}
          {/* Ikki ustun; bo'laklar toq bo'lsa oxirgisi butun eniga yoyiladi */}
          <div className="grid items-start gap-5 empty:hidden lg:grid-cols-2">
            {waiting.length > 0 && (
              <div className={CELL}>
                <Card title={`Sizni kutyapti · ${waiting.length}`} action={<MoreLink href="#/journal">Jurnal</MoreLink>} className="border-t-2 border-t-amber-400">
                  <JournalRows items={waiting} />
                </Card>
              </div>
            )}
            {today.length > 0 && <div className={CELL}><TodayTasks tasks={today} now={now} replace={replace} notify={notify} /></div>}
            {cameras && <div className={CELL}><CamerasBlock summary={cameras} /></div>}
          </div>
        </>
      )}

      {!fresh && setup}
    </div>
  );
}
