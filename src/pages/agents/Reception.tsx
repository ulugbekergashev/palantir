/**
 * Qabulxona — asosiy varaq, ish joyi: suhbatlar markazi (qo'ng'iroqlar va yozishmalar, AI javobi va natijasi bilan),
 * «mijoz bo'lib qo'ng'iroq qiling» (qabulxonani sinash — jadvalga yozilmaydi), sizni kutayotgan so'rovlar (shu yerda yopiladi),
 * AI bilmagan savollar (bir marta javob — keyin o'zi aytadi) va qanday ishlashi (o'zi javob beradimi, qaysi kanallar).
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { AutoReply, Call, LiveStatus, ReplyMode } from '../../types';
import { api, type RequestView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentAsk, Panel, Quiet, ago } from '../../components/agent';
import { VoicePanel } from '../../components/VoicePanel';
import type { DashboardView } from '../../lib/dashboard';
import { hrefOf } from '../../lib/nav';
import { Conversations } from './Conversations';
import { Gaps } from './Gaps';

const KIND: Record<string, string> = { callback: "Qayta qo'ng'iroq", booking: 'Yozilmoqchi', change: "Ko'chirish / bekor", complaint: 'Shikoyat', other: "So'rov" };
const MODES: { id: ReplyMode; label: string; hint: string }[] = [
  { id: 'auto', label: "O'zi javob beradi", hint: 'Bilganiga darhol javob beradi, bilmaganini sizga so‘rov qiladi' },
  { id: 'draft', label: 'Avval menga ko‘rsatsin', hint: 'Javobni tayyorlaydi, siz tasdiqlaysiz' },
  { id: 'off', label: "O'chiq", hint: 'Yozishmalarga javob bermaydi' },
];

function RequestCard({ r, onDone, notify }: { r: RequestView; onDone: () => void; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const act = async (verb: 'done' | 'no-answer') => {
    setBusy(true);
    try {
      await api.requestAction(r.id, verb);
      notify(verb === 'done' ? 'Hal qilindi' : "Ko'tarmadi — 30 daqiqadan keyin yana eslatiladi");
      onDone();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const phone = r.phone ?? r.lead?.phone;
  return (
    <li className={`flex flex-col gap-2.5 rounded-2xl border p-4 ${r.kind === 'complaint' ? 'border-rose-400/25 bg-rose-400/[0.05]' : 'border-[#f5b454]/20 bg-[#f5b454]/[0.04]'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-[11px] font-bold uppercase tracking-[0.1em] ${r.kind === 'complaint' ? 'text-rose-300' : 'text-[#f5b454]'}`}>{KIND[r.kind] ?? "So'rov"}</span>
        <span className="text-[12px] text-[#7d838f]">{ago(r.createdAt)}</span>
      </div>
      <p className="text-[15px] font-semibold text-[#f2f0ea]">{r.name ?? r.lead?.name ?? 'Mijoz'}{phone && <a href={`tel:${phone}`} className="ml-2 tabular-nums text-[13px] font-normal text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">{phone}</a>}</p>
      <p className="text-[14px] leading-relaxed text-[#d9dbe1]">{r.summary}{r.whenText && <span className="text-[#a3a9b5]"> · {r.whenText}</span>}</p>
      {r.quote && <p className="border-l-2 border-glass/15 pl-3 text-[13px] italic text-[#a3a9b5]">«{r.quote}»</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={busy} onClick={() => { void act('done'); }} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-[#f2f0ea] px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />Hal qilindi</button>
        {phone && <button type="button" disabled={busy} onClick={() => { void act('no-answer'); }} className="min-h-10 rounded-xl border border-glass/10 px-3.5 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">Ko'tarmadi</button>}
      </div>
    </li>
  );
}

export interface ReceptionData { dashboard: DashboardView | null; requests: RequestView[]; calls: Call[]; reply: AutoReply | null }

export function useReceptionData(notify: Notify, tick: number): [ReceptionData | null, () => void] {
  const [data, setData] = useState<ReceptionData | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let stale = false;
    Promise.all([
      api.dashboard('today').then(r => r.dashboard).catch(() => null), api.requests('open').then(r => r.requests).catch(() => []),
      api.calls().then(r => r.calls).catch(() => []), api.inbox().then(r => r.settings).catch(() => null),
    ]).then(([dashboard, requests, calls, reply]) => { if (!stale) setData({ dashboard, requests, calls, reply }); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setN(x => x + 1)];
}

export function ReceptionToday({ data, reload, notify, status, onChanged, tick }: { data: ReceptionData | null; reload: () => void; notify: Notify; status: LiveStatus; onChanged: () => void; tick: number }) {
  const [mode, setMode] = useState<ReplyMode | null>(null);
  const current = mode ?? data?.reply?.mode ?? null;
  const setReply = async (m: ReplyMode) => {
    if (!data?.reply) return;
    setMode(m);
    try { await api.setAutoReply({ ...data.reply, mode: m }); notify('Saqlandi'); } catch (e) { setMode(null); notify((e as Error).message, true); }
  };
  const channels = [
    { name: 'Telegram bot', on: !!status.bot },
    { name: 'Instagram', on: !!status.instagram?.account },
    { name: 'Shaxsiy Telegram', on: !!status.telegramUser?.account },
  ];
  const changed = () => { reload(); onChanged(); };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Conversations notify={notify} onChanged={changed} tick={tick} />
        <div className="flex flex-col gap-5">
          <VoicePanel kind="customer" member="qabulxona" title="Mijoz bo'lib qo'ng'iroq qiling"
            hint="Qabulxona sizga mijozdek javob beradi. Sinov: jadvalga yozilmaydi, so'rov ochilmaydi."
            labels={{ start: "Qabulxonaga qo'ng'iroq qilish", stop: "Qo'ng'iroqni tugatish", speaking: 'Qabulxona gapiryapti' }} />
          <Panel title={`Sizni kutyapti${data?.requests.length ? ` · ${data.requests.length}` : ''}`} action={<a href={hrefOf('qabulxona', 'sorovlar')} className="text-[13px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">Hammasi →</a>}>
            {data?.requests.length ? <ul className="flex flex-col gap-2.5">{data.requests.slice(0, 4).map(r => <RequestCard key={r.id} r={r} notify={notify} onDone={changed} />)}</ul>
              : <Quiet>Hammasi hal qilingan — siz hal qilishingiz kerak bo'lgan so'rov yo'q.</Quiet>}
          </Panel>
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Gaps notify={notify} onChanged={onChanged} />
        <Panel title="Qanday ishlaydi">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[14px] text-[#d9dbe1]">Yozishmalarga javob</legend>
            {MODES.map(m => (
              <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${current === m.id ? 'border-[#3fd6c3]/40 bg-[#3fd6c3]/[0.06]' : 'border-glass/[0.06] hover:bg-glass/[0.03]'}`}>
                <input type="radio" name="reply-mode" checked={current === m.id} onChange={() => { void setReply(m.id); }} disabled={!data?.reply} className="mt-1 accent-[#3fd6c3]" />
                <span><span className="block text-[14px] font-medium text-[#f2f0ea]">{m.label}</span><span className="block text-[12px] text-[#8a909c]">{m.hint}</span></span>
              </label>
            ))}
          </fieldset>
          <ul className="mt-5 flex flex-col gap-2 border-t border-glass/[0.06] pt-4">
            {channels.map(c => (
              <li key={c.name} className="flex items-center gap-2.5 text-[14px] text-[#d9dbe1]">
                <span className={`h-2 w-2 rounded-full ${c.on ? 'bg-emerald-400' : 'bg-glass/25'}`} aria-hidden="true" />{c.name}
                <span className="ml-auto text-[12px] text-[#8a909c]">{c.on ? 'ulangan' : <a href={hrefOf('sozlamalar')} className="text-[#a3a9b5]">ulash</a>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <AgentAsk member="qabulxona" placeholder="Qabulxonadan so'rang: «Bugun kim yozilgan?»" />
    </div>
  );
}
