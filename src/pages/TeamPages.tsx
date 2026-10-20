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
import { DemandBody } from './agents/Demand';
import { DiscoveriesBody } from './agents/Discoveries';
import { AssistantDesk, dueGroup, useAssistantData } from './agents/Assistant';
import { ReceptionToday, useReceptionData } from './agents/Reception';
import { WatchCameras, WatchNow, useWatchData } from './agents/Watch';
import { OrdersPanel } from '../components/Orders';
import { AgentJournal } from '../components/Journal';
import { CallsPage } from './CallsPage';
import { CamerasPage } from './CamerasPage';
import { Dashboard } from './dashboard/Dashboard';
import { ChatPage } from './ChatPage';
import { InboxPage } from './InboxPage';
import { JournalPage } from './JournalPage';
import { RequestsPage } from './RequestsPage';
import { SetupCard } from './SetupCard';
import { SettingsHub } from './settings/SettingsHub';

interface Common { biz: Business; status: LiveStatus; now: Date; notify: Notify; onChanged: () => void; tab: string | null; state: MemberState | null; tick: number }
const pick = (tab: string | null, ids: string[]) => (tab && ids.includes(tab) ? tab : ids[0]);

export function ReceptionArea({ tab, notify, onChanged, state, status, tick }: Common) {
  const active = pick(tab, ['bugun', 'sorovlar', 'qongiroqlar', 'yozishmalar', 'topshiriqlar']);
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
        <AgentTabs area="qabulxona" active={active} tabs={[{ id: 'bugun', label: 'Bugun' }, { id: 'sorovlar', label: "So'rovlar", count: data?.requests.length }, { id: 'qongiroqlar', label: "Qo'ng'iroqlar" }, { id: 'yozishmalar', label: 'Yozishmalar' }, { id: 'topshiriqlar', label: 'Topshiriqlar' }]} />
      </AgentHero>
      {active === 'bugun' && <ReceptionToday data={data} reload={reload} notify={notify} status={status} onChanged={onChanged} tick={tick} />}
      {active === 'topshiriqlar' && <OrdersPanel member="qabulxona" notify={notify} />}
      {active !== 'bugun' && active !== 'topshiriqlar' && (
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
  const active = pick(tab === 'ishlar' ? 'jurnal' : tab, ['stol', 'suhbat', 'jurnal', 'topshiriqlar']);
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
      <AgentHero member="yordamchi" state={state} stats={stats} compact={active === 'suhbat'}>
        <AgentTabs area="yordamchi" active={active} tabs={[{ id: 'stol', label: 'Ish stoli' }, { id: 'suhbat', label: 'Suhbat' }, { id: 'jurnal', label: 'Ishlar', count: late }, { id: 'topshiriqlar', label: 'Topshiriqlar' }]} />
      </AgentHero>
      {active === 'stol' && <AssistantDesk data={data} reload={reload} notify={notify} onChanged={onChanged} owner={(biz.ownerName || '').split(' ')[0]} />}
      {/* Suhbat ekran bo'yiga cho'ziladi: sarlavha egallagan joy hisobga olinadi */}
      {active === 'suhbat' && <div className="[--shell-y:10.5rem]"><ChatPage biz={biz} status={status} notify={notify} now={now} /></div>}
      {active === 'jurnal' && <div className="agent-body"><JournalPage now={now} notify={notify} onChanged={changed} /></div>}
      {active === 'topshiriqlar' && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <OrdersPanel member="yordamchi" notify={notify} />
          <section aria-label="Bajarganlari" className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5"><h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">Bajarganlari</h2><AgentJournal member="yordamchi" notify={notify} tick={tick} /></section>
        </div>
      )}
    </div>
  );
}

export function WatchArea({ tab, notify, state, tick }: Common) {
  // Kamera sahifasi: #/kuzatuvchi/kamera-<id>; eski varaqlar: kuzatuv → hozir, sozlash → ulash
  const camera = tab?.startsWith('kamera-') ? tab.slice(7) : null;
  const alias: Record<string, string> = { kuzatuv: 'hozir', sozlash: 'ulash' };
  const active = camera ? 'kameralar' : pick(tab ? alias[tab] ?? tab : null, ['hozir', 'kameralar', 'topshiriqlar', 'jurnal', 'ulash']);
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
        <AgentTabs area="kuzatuvchi" active={active} tabs={[{ id: 'hozir', label: 'Hozir' }, { id: 'kameralar', label: 'Kameralar', count: data?.cameras.length }, { id: 'topshiriqlar', label: 'Topshiriqlar' }, { id: 'jurnal', label: 'Jurnal' }, { id: 'ulash', label: 'Ulash' }]} />
      </AgentHero>
      {active === 'hozir' && <WatchNow data={data} notify={notify} tick={tick} />}
      {active === 'kameralar' && <WatchCameras data={data} selected={camera} notify={notify} tick={tick} />}
      {active === 'topshiriqlar' && <OrdersPanel member="kuzatuvchi" notify={notify} cameras={data?.cameras ?? []} />}
      {active === 'jurnal' && <AgentJournal member="kuzatuvchi" notify={notify} tick={tick} />}
      {active === 'ulash' && <div className="agent-body"><CamerasPage notify={notify} /></div>}
    </div>
  );
}

export function AnalystArea({ tab, biz, status, notify, state }: Common) {
  const active = pick(tab, ['raqamlar', 'kashfiyotlar', 'talab', 'hisobot', 'topshiriqlar']);
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('week');
  const data = useAnalystData(period, notify);
  return (
    <div className="space-y-6">
      <AgentHero member="tahlilchi" state={state} stats={analystStats(data?.dashboard ?? null, data?.funnel ?? null)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AgentTabs area="tahlilchi" active={active} tabs={[{ id: 'raqamlar', label: 'Raqamlar' }, { id: 'kashfiyotlar', label: 'Kashfiyotlar' }, { id: 'talab', label: 'Talab' }, { id: 'hisobot', label: "To'liq hisobot" }, { id: 'topshiriqlar', label: 'Topshiriqlar' }]} />
          {active === 'raqamlar' && <PeriodSwitch value={period} onChange={setPeriod} />}
        </div>
      </AgentHero>
      {active === 'raqamlar' && <AnalystBody data={data} />}
      {active === 'kashfiyotlar' && <DiscoveriesBody notify={notify} />}
      {active === 'talab' && <DemandBody notify={notify} />}
      {active === 'hisobot' && <Dashboard status={status} clinic={isMedical(biz.industry)} notify={notify} />}
      {active === 'topshiriqlar' && <OrdersPanel member="tahlilchi" notify={notify} />}
    </div>
  );
}

export function SettingsArea({ tab, biz, status, notify, onStatus, onBiz, offeringsRev, onSaved }: Common & {
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
          <p className="mt-0.5 text-sm text-[#a3a9b5]">Telegram, Instagram, DentaCRM, telefon va kameralar — jamoangiz qayerda ishlashi.</p>
        </div>
      </header>
      {steps.some(s => !s.done) && <SetupCard steps={steps} />}
      <SettingsHub tab={tab} biz={biz} status={status} notify={notify} onStatus={onStatus} onBiz={onBiz} offeringsRev={offeringsRev} onSaved={onSaved} />
    </div>
  );
}
