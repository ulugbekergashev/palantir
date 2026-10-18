import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Send, Stethoscope } from 'lucide-react';
import type { Call, ClientCardView, LeadRequest } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { prettyPhone } from '../lib/phone';

const pad = (n: number) => String(n).padStart(2, '0');
/** «19.10.2026 00:35» (brauzer tilidan qat'i nazar bir xil) */
const when = (t: string) => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const sum = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
const length = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const KIND: Record<LeadRequest['kind'], string> = { callback: "📞 Qo'ng'iroq qilish", booking: '📅 Qabulga yozish', change: '🔁 Surish/bekor', complaint: '⚠️ Shikoyat', other: '📌 Boshqa' };
const CALL_STATE: Record<string, string> = { ended: 'gaplashildi', missed: "o'tkazib yuborildi", no_answer: "ko'tarmadi", talking: 'suhbatda', ringing: 'jiringlayapti', dialing: 'terilmoqda' };

function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2.5 text-sm font-bold text-slate-900">{title}{count !== undefined && <span className="ml-1.5 font-semibold text-slate-400">{count}</span>}</h3>
      {children}
    </section>
  );
}

function CallRow({ c, notify }: { c: Call; notify: Notify }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const Icon = c.status === 'missed' || c.status === 'no_answer' ? PhoneMissed : c.direction === 'out' ? PhoneOutgoing : PhoneIncoming;
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-sm">
        <Icon className={`h-4 w-4 shrink-0 ${c.status === 'missed' ? 'text-rose-600' : 'text-slate-400'}`} aria-hidden="true" />
        <span className="font-semibold text-slate-900">{c.source === 'voice' ? 'Ovozli agent' : c.direction === 'out' ? 'Chiquvchi' : 'Kiruvchi'}</span>
        <span className="text-slate-500">{c.status ? CALL_STATE[c.status] ?? c.status : ''}{c.durationSec ? ` · ${length(c.durationSec)}` : ''}</span>
        <span className="ml-auto text-xs tabular-nums text-slate-400">{when(c.startedAt)}</span>
      </div>
      {(c.analysis?.summary || c.outcome) && <p className="mt-0.5 pl-6 text-xs text-slate-600">{c.analysis?.summary || c.outcome}</p>}
      {c.hasRecording && (src ? <audio controls src={src} className="mt-1.5 w-full pl-6" /> : (
        <button type="button" onClick={() => api.callAudio(c.id).then(b => setSrc(URL.createObjectURL(b))).catch(e => notify((e as Error).message, true))}
          className="mt-1 inline-flex items-center gap-1 pl-6 text-xs font-semibold text-indigo-700 hover:underline"><Play className="h-3 w-3" aria-hidden="true" /> Yozuvni tinglash</button>
      ))}
    </li>
  );
}

/**
 * Mijoz kartasi: bitta odam hamma kanallarda — qayerda yozishadi, so'rovlari, qo'ng'iroqlari (yozuv bilan) va DentaCRM bemori
 * (oxirgi tashrif, balans, yaqin qabullari)
 */
export function ClientCard({ leadId, notify }: { leadId: string; notify: Notify }) {
  const [card, setCard] = useState<ClientCardView | null>(null);
  useEffect(() => {
    let gone = false;
    setCard(null);
    api.clientCard(leadId).then(r => { if (!gone) setCard(r.card); }).catch(e => { if (!gone) notify((e as Error).message, true); });
    return () => { gone = true; };
  }, [leadId]);
  if (!card) return <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" aria-label="Yuklanmoqda" /></div>;
  const { channels, patient } = card;
  return (
    <div className="space-y-3 py-4">
      <Block title="Kanallar">
        <ul className="grid gap-2 sm:grid-cols-3">
          <li className={`rounded-xl px-3 py-2 ${channels.instagram ? 'bg-rose-50' : 'bg-slate-50'}`}>
            <p className="text-xs font-semibold text-slate-500">Instagram</p>
            <p className="truncate text-sm font-semibold text-slate-900">{channels.instagram ?? '—'}{card.messages.instagram ? <span className="font-normal text-slate-500"> · {card.messages.instagram} xabar</span> : null}</p>
          </li>
          <li className={`rounded-xl px-3 py-2 ${channels.telegram ? 'bg-sky-50' : 'bg-slate-50'}`}>
            <p className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Send className="h-3 w-3" aria-hidden="true" />Telegram</p>
            <p className="truncate text-sm font-semibold text-slate-900">{channels.telegram ?? '—'}{card.messages.telegram ? <span className="font-normal text-slate-500"> · {card.messages.telegram} xabar</span> : null}</p>
          </li>
          <li className={`rounded-xl px-3 py-2 ${channels.phone ? 'bg-emerald-50' : 'bg-slate-50'}`}>
            <p className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Phone className="h-3 w-3" aria-hidden="true" />Telefon</p>
            <p className="truncate text-sm font-semibold text-slate-900">{channels.phone ? <a href={`tel:${channels.phone}`} className="hover:underline">{prettyPhone(channels.phone)}</a> : '—'}{card.calls.length ? <span className="font-normal text-slate-500"> · {card.calls.length} qo'ng'iroq</span> : null}</p>
          </li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          {card.firstMessageAt ? `Birinchi murojaat: ${when(card.firstMessageAt)}` : `Kartaga qo'shilgan: ${when(card.lead.createdAt)}`}
          {card.lead.source ? ` · ${card.lead.source}` : ''}{card.lastMessageAt ? ` · oxirgi xabar: ${when(card.lastMessageAt)}` : ''}
        </p>
      </Block>

      {patient && (
        <Block title="DentaCRM bemori">
          {patient.problem ? <p className="text-sm text-amber-700">{patient.problem}</p> : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><p className="text-xs text-slate-500">Bemor</p><p className="flex items-center gap-1.5 text-sm font-semibold"><Stethoscope className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />{patient.name}</p></div>
                <div><p className="text-xs text-slate-500">Oxirgi tashrif</p><p className="text-sm font-semibold">{patient.lastVisit ? day(patient.lastVisit.slice(0, 10)) : '—'}</p></div>
                <div><p className="text-xs text-slate-500">Balans</p><p className={`text-sm font-semibold ${patient.balance < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{patient.balance < 0 ? `qarz ${sum(patient.balance)}` : sum(patient.balance)}</p></div>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-500">Yaqin qabullar</p>
              {!patient.upcoming.length ? <p className="text-sm text-slate-500">Yaqin 2 haftada qabul yo'q.</p> : (
                <ul className="mt-1 space-y-1">
                  {patient.upcoming.map(v => (
                    <li key={v.id} className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      <span className="font-semibold">{day(v.date)} {v.time}</span><span className="text-slate-600">{v.doctorName}</span>
                      <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">{v.status === 'Confirmed' ? 'tasdiqlangan' : 'kutilmoqda'}</span></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Block>
      )}

      <Block title="So'rovlar" count={card.requests.length}>
        {!card.requests.length ? <p className="text-sm text-slate-500">So'rov bo'lmagan.</p> : (
          <ul className="divide-y divide-slate-100">
            {card.requests.map(r => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center gap-2"><span className="font-semibold">{KIND[r.kind]}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${r.status === 'open' ? 'bg-amber-50 text-amber-800' : r.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{r.status === 'open' ? 'ochiq' : r.status === 'done' ? `bajarildi${r.doneBy ? ` · ${r.doneBy}` : ''}` : 'bekor'}</span>
                  <span className="ml-auto text-xs tabular-nums text-slate-400">{when(r.createdAt)}</span></div>
                <p className="text-xs text-slate-600">{r.summary}</p>
                {r.result && <p className="text-xs text-slate-500">💬 {r.result}</p>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Qo'ng'iroqlar" count={card.calls.length}>
        {!card.calls.length ? <p className="text-sm text-slate-500">Qo'ng'iroq bo'lmagan.</p> : <ul className="divide-y divide-slate-100">{card.calls.map(c => <CallRow key={c.id} c={c} notify={notify} />)}</ul>}
      </Block>
    </div>
  );
}
