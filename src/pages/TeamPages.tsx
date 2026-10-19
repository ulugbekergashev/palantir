/**
 * AI jamoa xodimlarining sahifalari — bosh ekran bilan bir uslubda: tepada xodimning sferasi, ismi, jonli holati va bugungi
 * raqamlari; asosiy varaq — u nima qilyapti (agents/*); to'liq ro'yxatlar (so'rovlar, jurnal, kamera sozlash) — qo'shimcha varaqlarda.
 * Sozlamalar ham shu yerda — ulanishlar va ishga tushirish qadamlari.
 */
import { useState } from 'react';
import { Settings } from 'lucide-react';
import type { Business, LiveStatus } from '../types';
import type { Notify } from '../components/Artifacts';
import { AgentHero, AgentTabs } from '../components/agent';
import type { MemberState } from '../components/team';
import { isMedical } from '../lib/compliance';
import { setupSteps } from '../lib/setup';
import { useDayFeed } from '../lib/useDayFeed';
import { iso } from '../lib/week';
import { AnalystBody, PeriodSwitch, analystStats, useAnalystData } from './agents/Analyst';
import { AssistantDesk, dueGroup, useAssistantData } from './agents/Assistant';
import { ReceptionToday, useReceptionData } from './agents/Reception';
import { WatchToday, useWatchData } from './agents/Watch';
import { CallsPage } from './CallsPage';
import { CamerasPage } from './CamerasPage';
import { ChatPage } from './ChatPage';
import { InboxPage } from './InboxPage';
import { JournalPage } from './JournalPage';
import { RequestsPage } from './RequestsPage';
import { SetupCard } from './SetupCard';
import { TelegramPage } from './TelegramPage';

interface Common { biz: Business; status: LiveStatus; now: Date; notify: Notify; onChanged: () => void; tab: string | null; state: MemberState | null; tick: number }
const pick = (tab: string | null, ids: string[]) => (tab && ids.includes(tab) ? tab : ids[0]);

export function ReceptionArea({ tab, notify, onChanged, state, status, tick }: Common) {
  const active = pick(tab, ['bugun', 'sorovlar', 'qongiroqlar', 'yozishmalar']);
  const [data, reload] = useReceptionData(notify, tick);
  const today = iso(new Date());
  const k = data?.dashboard?.kpi;
  const stats = [
    { label: 'Javob berildi', value: k?.answered.value ?? '—', hint: k?.answered.responseMin != null ? `o'rtacha ${k.answered.responseMin} daqiqada` : undefined },
    { label: 'Qabulga yozildi', value: k?.booked.value ?? '—', tone: k?.booked.value ? 'good' as const : undefined },
    { label: "Qo'ng'iroq", value: data ? data.calls.filter(c => c.startedAt.slice(0, 10) === today).length : '—', hint: k?.unanswered.missedCalls ? `${k.unanswered.missedCalls} tasi o'tkazib yuborilgan` : undefined },
    { label: 'Sizni kutyapti', value: data?.requests.length ?? '—', tone: data?.requests.length ? 'warn' as const : undefined },
  ];
  return (
    <div className="space-y-6">
      <AgentHero member="qabulxona" state={state} stats={stats}>
        <AgentTabs area="qabulxona" active={active} tabs={[{ id: 'bugun', label: 'Bugun' }, { id: 'sorovlar', label: "So'rovlar", count: data?.requests.length }, { id: 'qongiroqlar', label: "Qo'ng'iroqlar" }, { id: 'yozishmalar', label: 'Yozishmalar' }]} />
      </AgentHero>
      {active === 'bugun' && <ReceptionToday data={data} reload={reload} notify={notify} status={status} onChanged={onChanged} tick={tick} />}
      {active !== 'bugun' && (
        <div className="agent-body">
          {active === 'sorovlar' && <RequestsPage notify={notify} onChanged={() => { reload(); onChanged(); }} />}
          {active === 'qongiroqlar' && <CallsPage notify={notify} />}
          {active === 'yozishmalar' && <InboxPage notify={notify} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

export function AssistantArea({ tab, biz, status, now, notify, onChanged, state, tick }: Common) {
  // «ishlar» — eski manzil (jurnal)
  const active = pick(tab === 'ishlar' ? 'jurnal' : tab, ['stol', 'suhbat', 'jurnal']);
  const [data, reload] = useAssistantData(notify, tick);
  const tasks = data?.tasks ?? [];
  const late = tasks.filter(t => dueGroup(t) === 'late').length;
  const next = tasks.filter(t => t.dueAt && dueGroup(t) !== 'late').sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))[0];
  const stats = [
    { label: 'Kechikkan ish', value: data ? late : '—', tone: late ? 'warn' as const : undefined },
    { label: 'Bugungi ish', value: data ? tasks.filter(t => dueGroup(t) === 'today').length : '—' },
    { label: 'Keyingi eslatma', value: next?.dueAt ? next.dueAt.slice(11) : '—', hint: next ? next.title.slice(0, 40) : undefined },
    { label: 'Hujjat', value: data?.docs.length ?? '—', hint: 'u tayyorlagan' },
  ];
  const changed = () => { reload(); onChanged(); };
  return (
    <div className="space-y-6">
      <AgentHero member="yordamchi" state={state} stats={stats}>
        <AgentTabs area="yordamchi" active={active} tabs={[{ id: 'stol', label: 'Ish stoli' }, { id: 'suhbat', label: 'Suhbat tarixi' }, { id: 'jurnal', label: 'Jurnal', count: late }]} />
      </AgentHero>
      {active === 'stol' && <AssistantDesk data={data} reload={reload} notify={notify} onChanged={onChanged} owner={(biz.ownerName || '').split(' ')[0]} />}
      {/* Suhbat ekran bo'yiga cho'ziladi: sarlavha egallagan joy hisobga olinadi */}
      {active === 'suhbat' && <div className="agent-body mx-auto max-w-4xl [--shell-y:9rem]"><ChatPage biz={biz} status={status} notify={notify} now={now} /></div>}
      {active === 'jurnal' && <div className="agent-body"><JournalPage now={now} notify={notify} onChanged={changed} /></div>}
    </div>
  );
}

export function WatchArea({ tab, notify, state, tick }: Common) {
  const active = pick(tab, ['kuzatuv', 'sozlash']);
  const data = useWatchData(notify, tick);
  const s = data?.summary;
  const issues = s?.findings.filter(f => f.level !== 'ok').length ?? 0;
  const stats = data?.cameras.length ? [
    { label: 'Kreslodagi bemor', value: s?.seated ?? '—' },
    { label: 'Kassa oldida', value: s?.deskVisits ?? '—' },
    { label: 'DentaCRM: keldi', value: s?.crm?.visits ?? '—', hint: s?.crm ? `${s.crm.payments} to'lov` : 'DentaCRM ulanmagan' },
    { label: 'Nomuvofiqlik', value: s ? issues : '—', tone: issues ? 'warn' as const : 'good' as const },
  ] : [];
  return (
    <div className="space-y-6">
      <AgentHero member="kuzatuvchi" state={state} stats={stats}>
        <AgentTabs area="kuzatuvchi" active={active} tabs={[{ id: 'kuzatuv', label: 'Kuzatuv' }, { id: 'sozlash', label: 'Kameralarni sozlash' }]} />
      </AgentHero>
      {active === 'kuzatuv' ? <WatchToday data={data} /> : <div className="agent-body"><CamerasPage notify={notify} /></div>}
    </div>
  );
}

export function AnalystArea({ notify, state }: Common) {
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('week');
  const data = useAnalystData(period, notify);
  return (
    <div className="space-y-6">
      <AgentHero member="tahlilchi" state={state} stats={analystStats(data?.dashboard ?? null, data?.funnel ?? null)}>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </AgentHero>
      <AnalystBody data={data} />
    </div>
  );
}

export function SettingsArea({ biz, status, notify, onStatus, onBiz, offeringsRev, onSaved }: Common & {
  onStatus: (s: LiveStatus) => void; onBiz: (b: Business) => void; offeringsRev: string; onSaved: (b: Business, rev: string) => void;
}) {
  const feed = useDayFeed(notify);
  const steps = feed ? setupSteps(status, isMedical(biz.industry), feed.brain) : [];
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center gap-4 border-b border-glass/[0.06] pb-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-glass/[0.06] text-[#d9dbe1]"><Settings className="h-7 w-7" aria-hidden="true" /></span>
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#f2f0ea]">Sozlamalar</h1>
          <p className="mt-0.5 text-sm text-[#a3a9b5]">Telegram, Instagram, DentaCRM va telefon — jamoangiz qayerda ishlashi.</p>
        </div>
      </header>
      {steps.some(s => !s.done) && <SetupCard steps={steps} />}
      <div className="agent-body">
        <TelegramPage status={status} onStatus={onStatus} biz={biz} onBiz={onBiz} offeringsRev={offeringsRev} onSaved={onSaved} notify={notify} />
      </div>
    </div>
  );
}
