import { useEffect, useState } from 'react';
import { Loader2, PhoneCall } from 'lucide-react';
import type { Call } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';

const when = (isoTime: string) => new Date(isoTime).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const length = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Ovozli agent qabul qilgan qo'ng'iroqlar: chapda ro'yxat, o'ngda suhbat matni */
export function CallsPage({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Call[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => api.calls().then(r => setList(r.calls)).catch(fail);
  useEffect(() => { void load(); api.voiceKey().then(r => setHasKey(r.exists)).catch(fail); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, []);
  const makeKey = () => {
    if (hasKey && !window.confirm('Yangi kalit yaratilsa, eskisi shu zahoti ishlamay qoladi. Davom etilsinmi?')) return;
    api.newVoiceKey().then(r => { setKey(r.key); setHasKey(true); }).catch(fail);
  };
  const call = list?.find(c => c.id === picked) ?? list?.[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="Qo'ng'iroqlar" description="Ovozli agent javob bergan qo'ng'iroqlar: kim qo'ng'iroq qildi, nima deyildi, qabulga yozildimi." />

      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !list.length ? (
        <Card><EmptyState icon={PhoneCall} title="Hali qo'ng'iroq yo'q">Ovozli agent ulangach, har bir suhbat shu yerda paydo bo'ladi: kim qo'ng'iroq qildi, nima deyildi, qabulga yozildimi.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-1">
            {list.map(c => (
              <button key={c.id} type="button" onClick={() => setPicked(c.id)} aria-current={c.id === call?.id} className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${c.id === call?.id ? 'bg-white shadow-sheet ring-1 ring-slate-200' : 'hover:bg-slate-200/60'}`}>
                <div className="flex justify-between gap-2"><span className="truncate font-semibold">{c.name ?? c.phone}</span><span className="shrink-0 text-xs tabular-nums text-slate-400">{when(c.startedAt)}</span></div>
                <div className="truncate text-sm text-slate-500">{c.outcome}</div>
              </button>
            ))}
          </div>
          {call && (
            <Card title={call.name ?? call.phone} description={`${call.phone} · ${when(call.startedAt)} · ${length(call.durationSec)}`}>
              {call.booked && <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Qabulga yozildi: {call.booked}</p>}
              <div className="space-y-2">
                {call.transcript.map((l, i) => (
                  <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.who === 'ai' ? 'ml-auto bg-indigo-50' : 'bg-slate-100'}`}>
                    <div className="text-[11px] font-bold text-slate-500">{l.who === 'ai' ? 'Agent' : 'Mijoz'}</div>{l.text}
                  </div>
                ))}
                {!call.transcript.length && <p className="text-sm text-slate-500">Bu qo'ng'iroqning matni kelmagan.</p>}
              </div>
            </Card>
          )}
        </div>
      )}

      <Card title="Ovozli agentni ulash" description="Agent suhbat paytida shu manzilga murojaat qiladi: bo'sh vaqtni so'raydi, qabulga yozadi va tugagan suhbatni topshiradi.">
        <dl className="space-y-2 text-sm">
          <div><dt className="text-slate-500">Manzil</dt><dd className="break-all font-mono">{window.location.origin}/api/voice</dd></div>
          <div><dt className="text-slate-500">Kalit</dt><dd className="break-all font-mono">{key ?? (hasKey ? '•••••••• (yaratilgan)' : 'hali yaratilmagan')}</dd></div>
        </dl>
        <Button size="sm" className="mt-3" onClick={makeKey}>{hasKey ? 'Yangi kalit yaratish' : 'Kalit yaratish'}</Button>
        <p className="mt-3 text-sm text-slate-500">{key ? "Kalitni hozir nusxalab oling — u boshqa ko'rsatilmaydi. " : ''}Kalitni faqat ovozli agent xizmatiga bering: u bilan klinika jadvalini ko'rish va qabulga yozish mumkin.</p>
      </Card>
    </div>
  );
}
