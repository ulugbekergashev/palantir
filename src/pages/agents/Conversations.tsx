/**
 * Qabulxona suhbatlari — bitta joyda: chapda qo'ng'iroqlar va yozishmalar (yangisi tepada, filtr bilan), o'ngda tanlangani.
 * Yozishma: xabarlar (mijoz / AI / siz), AI tayyorlagan va tasdiqingizni kutayotgan javob (yuborish, tahrirlash, kerak emas),
 * o'zingiz yozish (suhbatni qo'lga olish). Qo'ng'iroq: natija, AI xulosasi, suhbat matni va yozuvni tinglash.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, MessageCircle, Pause, Phone, PhoneMissed, Play, Send } from 'lucide-react';
import type { Call, InboxMessage, InboxThread, Lead, ReplyDraft } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { clock } from '../../components/agent';

type Item = { kind: 'chat'; id: string; at: string; thread: InboxThread } | { kind: 'call'; id: string; at: string; call: Call };
type Filter = 'all' | 'waiting' | 'calls' | 'chats';

const leadName = (l: Lead) => l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';
const CH: Record<string, string> = { instagram: 'Instagram', telegram: 'Telegram', bot: 'Telegram bot', manual: 'Qo‘lda' };
const OUTCOME: Record<string, string> = { booked: 'Qabulga yozildi', callback: "Qayta qo'ng'iroq kerak", info: "Ma'lumot oldi", lost: 'Qiziqmadi', complaint: 'Shikoyat', other: 'Boshqa' };
const day = (iso: string) => {
  const d = new Date(iso), t = new Date();
  return d.toDateString() === t.toDateString() ? clock(iso) : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const initials = (s: string) => s.replace(/^@/, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

function ChatThread({ thread, notify, onChanged }: { thread: InboxThread; notify: Notify; onChanged: () => void }) {
  const [data, setData] = useState<{ messages: InboxMessage[]; replies: ReplyDraft[] } | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = () => api.thread(thread.lead.id).then(r => setData({ messages: r.messages, replies: r.replies })).catch(e => notify((e as Error).message, true));
  useEffect(() => { setData(null); setText(''); setEditing(null); void load(); }, [thread.lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data]);
  const pending = data?.replies.filter(r => r.status === 'pending') ?? [];
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await work(); notify(done); await load(); onChanged(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void run(async () => { await api.writeTo(thread.lead.id, text.trim(), editing); setText(''); setEditing(null); }, 'Yuborildi');
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-glass/[0.06] px-5 py-3.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3fd6c3]/15 text-[13px] font-bold text-[#8ff0e2]">{initials(leadName(thread.lead))}</span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[#f2f0ea]">{leadName(thread.lead)}</p>
          <p className="text-[12px] text-[#7d838f]">{CH[thread.lead.channel] ?? thread.lead.channel}{thread.lead.phone ? ` · ${thread.lead.phone}` : ''}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!data ? <div className="mx-auto mt-10 h-5 w-5 animate-spin rounded-full border-2 border-glass/20 border-t-glass/70" aria-label="Yuklanmoqda" /> : (
          <ol className="flex flex-col gap-2.5">
            {data.messages.map(m => (
              <li key={m.id} className={`flex flex-col ${m.direction === 'in' ? 'items-start' : 'items-end'}`}>
                {m.direction === 'out' && <span className="mb-0.5 text-[11px] font-medium text-[#7d838f]">{m.by === 'cerebro' ? 'AI qabulxona' : 'Siz'}</span>}
                <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${m.direction === 'in' ? 'rounded-bl-md bg-glass/[0.06] text-[#e4e3de]' : m.by === 'cerebro' ? 'rounded-br-md bg-[#3fd6c3]/15 text-[#dffaf5]' : 'rounded-br-md bg-[#8b8cff]/20 text-[#e9e9ff]'}`}>{m.text}</p>
                <span className="mt-0.5 text-[11px] text-[#6e7582]">{day(m.createdAt)}</span>
              </li>
            ))}
            {!data.messages.length && <li className="py-8 text-center text-[14px] text-[#7d838f]">Xabar yo'q</li>}
          </ol>
        )}
        {pending.map(r => (
          <div key={r.id} className="mt-4 rounded-2xl border border-[#f5b454]/25 bg-[#f5b454]/[0.05] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f5b454]">AI javobi tasdiqingizni kutyapti</p>
            {r.note && <p className="mt-1 text-[13px] text-[#c9b48c]">Nega o'zi yubormadi: {r.note}</p>}
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-[#f2f0ea]">{r.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => { void run(() => api.sendReply(r.id), 'Yuborildi'); }} className="min-h-10 rounded-xl bg-[#f2f0ea] px-4 text-[13px] font-semibold text-[#07080b] disabled:opacity-50">Yuborish</button>
              <button type="button" disabled={busy} onClick={() => { setText(r.text); setEditing(r.id); }} className="min-h-10 rounded-xl border border-glass/10 px-4 text-[13px] text-[#d9dbe1] hover:bg-glass/5">Tahrirlash</button>
              <button type="button" disabled={busy} onClick={() => { void run(() => api.dismissReply(r.id), 'Olib tashlandi'); }} className="min-h-10 rounded-xl px-3 text-[13px] text-[#a3a9b5] hover:bg-glass/5">Kerak emas</button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {thread.lead.reachable ? (
        <form onSubmit={send} className="m-3 flex items-end gap-2 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 pl-4 focus-within:border-glass/25">
          <label htmlFor="reply-box" className="sr-only">Mijozga yozish</label>
          <textarea id="reply-box" rows={1} value={text} onChange={e => setText(e.target.value)} placeholder={editing ? 'AI javobini tahrirlang…' : "O'zingiz yozing — suhbatni qo'lga olasiz"}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Yuborish" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#3fd6c3] text-[#07080b] disabled:opacity-40"><ArrowUp className="h-5 w-5" aria-hidden="true" /></button>
        </form>
      ) : <p className="m-3 rounded-xl bg-glass/[0.03] px-4 py-3 text-[13px] text-[#8a909c]">Bu mijozga Cerebro yoza olmaydi (kanal ulanmagan) — raqami bo'lsa, qo'ng'iroq qiling.</p>}
    </div>
  );
}

function CallThread({ call }: { call: Call }) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { setUrl(null); setPlaying(false); }, [call.id]);
  const toggle = async () => {
    if (playing) { audio.current?.pause(); return; }
    const src = url ?? URL.createObjectURL(await api.callAudio(call.id));
    setUrl(src);
    setTimeout(() => { void audio.current?.play(); }, 0);
  };
  const a = call.analysis;
  const lines = call.transcript.length ? call.transcript : [];
  const mins = `${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')}`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-glass/[0.06] px-5 py-3.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3fd6c3]/15 text-[#8ff0e2]">{call.status === 'missed' ? <PhoneMissed className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-[#f2f0ea]">{call.name ?? a?.customerName ?? call.phone}</p>
          <p className="text-[12px] text-[#7d838f]">{call.phone} · {day(call.startedAt)} · {mins}{call.source === 'voice' ? ' · AI javob berdi' : ''}</p>
        </div>
        {call.hasRecording && (
          <button type="button" onClick={() => { void toggle(); }} className="flex min-h-10 items-center gap-2 rounded-full bg-glass/[0.07] px-4 text-[13px] text-[#f2f0ea] hover:bg-glass/[0.12]">
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}{playing ? "To'xtatish" : 'Tinglash'}
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className={`rounded-2xl border p-4 ${call.booked || a?.outcome === 'booked' ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : 'border-glass/[0.08] bg-glass/[0.03]'}`}>
          <p className={`text-[15px] font-semibold ${call.booked || a?.outcome === 'booked' ? 'text-emerald-300' : 'text-[#f2f0ea]'}`}>{call.booked ? `Qabulga yozildi · ${call.booked}` : a ? OUTCOME[a.outcome] : call.outcome}</p>
          {a?.summary && <p className="mt-1.5 text-[14px] leading-relaxed text-[#c9cbd2]">{a.summary}</p>}
          {a?.nextStep && <p className="mt-1.5 text-[13px] text-[#a3a9b5]">Keyingi qadam: {a.nextStep}</p>}
        </div>
        <ol className="mt-4 flex flex-col gap-2.5">
          {lines.map((l, i) => (
            <li key={i} className={`flex flex-col ${l.who === 'caller' ? 'items-start' : 'items-end'}`}>
              <span className="mb-0.5 text-[11px] font-medium text-[#7d838f]">{l.who === 'caller' ? 'Mijoz' : 'AI qabulxona'}</span>
              <p className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${l.who === 'caller' ? 'rounded-bl-md bg-glass/[0.06] text-[#e4e3de]' : 'rounded-br-md bg-[#3fd6c3]/15 text-[#dffaf5]'}`}>{l.text}</p>
            </li>
          ))}
          {!lines.length && a?.transcript && <li className="whitespace-pre-line text-[14px] leading-relaxed text-[#c9cbd2]">{a.transcript}</li>}
        </ol>
      </div>
      {url && <audio ref={audio} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />}
    </div>
  );
}

export function Conversations({ notify, onChanged, tick }: { notify: Notify; onChanged: () => void; tick: number }) {
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let stale = false;
    Promise.all([api.inbox().then(r => r.threads).catch(() => []), api.calls().then(r => r.calls).catch(() => [])])
      .then(([t, c]) => { if (!stale) { setThreads(t); setCalls(c); } });
    return () => { stale = true; };
  }, [tick, n]);

  const items = useMemo<Item[]>(() => [
    ...(threads ?? []).map((t): Item => ({ kind: 'chat', id: `t${t.lead.id}`, at: t.last?.createdAt ?? t.lead.lastInboundAt ?? '', thread: t })),
    ...calls.map((c): Item => ({ kind: 'call', id: `c${c.id}`, at: c.startedAt, call: c })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [threads, calls]);
  const shown = items.filter(i => filter === 'all' || (filter === 'waiting' ? i.kind === 'chat' && i.thread.pending > 0 : filter === 'calls' ? i.kind === 'call' : i.kind === 'chat'));
  const current = items.find(i => i.id === selected) ?? shown[0] ?? null;
  const waiting = items.filter(i => i.kind === 'chat' && i.thread.pending > 0).length;
  const filters: { id: Filter; label: string; count?: number }[] = [{ id: 'all', label: 'Hammasi' }, { id: 'waiting', label: 'Kutyapti', count: waiting }, { id: 'calls', label: "Qo'ng'iroq" }, { id: 'chats', label: 'Yozishma' }];

  // Hali hech kim murojaat qilmagan: bo'sh ikki maydon emas — nima bo'lishi va hozir qanday sinash
  if (threads && !items.length) {
    return (
      <section aria-label="Suhbatlar" className="flex flex-col items-center gap-4 rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3fd6c3]/12 text-[#8ff0e2]"><MessageCircle className="h-6 w-6" aria-hidden="true" /></span>
        <h2 className="text-[20px] font-semibold tracking-tight text-[#f2f0ea]">Hali murojaat yo'q</h2>
        <p className="max-w-lg text-[15px] leading-relaxed text-[#a3a9b5]">Mijoz yozganda yoki qo'ng'iroq qilganda u shu yerda chiqadi: nima so'radi, AI nima javob berdi va nima bilan tugadi. Kerak bo'lsa — suhbatni o'zingiz qo'lga olasiz.</p>
        <p className="text-[14px] text-[#8ff0e2]">Hozir sinab ko'ring: «Mijoz bo'lib qo'ng'iroq qiling» — sferani bosing va gapiring.</p>
      </section>
    );
  }

  return (
    <section aria-label="Suhbatlar" className="flex min-h-[560px] flex-col overflow-hidden rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] lg:h-[640px] lg:flex-row">
      <div className="flex flex-col border-b border-glass/[0.06] lg:w-[330px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">Suhbatlar</h2>
          <span className="text-[12px] text-[#7d838f]">{items.length}</span>
        </div>
        <div role="tablist" aria-label="Filtr" className="flex flex-wrap gap-1 px-3 pb-3">
          {filters.map(f => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
              className={`flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${filter === f.id ? 'bg-[#f2f0ea] text-[#07080b]' : 'text-[#a3a9b5] hover:bg-glass/5'}`}>
              {f.label}{!!f.count && <span className="rounded-full bg-[#f5b454] px-1.5 text-[10px] font-bold text-[#07080b]">{f.count}</span>}
            </button>
          ))}
        </div>
        <ul className="max-h-80 flex-1 overflow-y-auto px-2 pb-2 lg:max-h-none">
          {shown.map(i => {
            const active = current?.id === i.id;
            const name = i.kind === 'chat' ? leadName(i.thread.lead) : i.call.name ?? i.call.analysis?.customerName ?? i.call.phone;
            const preview = i.kind === 'chat' ? i.thread.last?.text ?? '' : i.call.booked ? `Qabulga yozildi · ${i.call.booked}` : i.call.analysis ? OUTCOME[i.call.analysis.outcome] : i.call.outcome;
            const Icon = i.kind === 'call' ? (i.call.status === 'missed' ? PhoneMissed : Phone) : i.thread.lead.channel === 'manual' ? MessageCircle : Send;
            return (
              <li key={i.id}>
                <button type="button" onClick={() => setSelected(i.id)} aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-glass/[0.07]' : 'hover:bg-glass/[0.03]'}`}>
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-glass/[0.06] text-[12px] font-bold text-[#d9dbe1]">
                    {initials(name)}
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0b0c10] bg-[#14161c] text-[#8ff0e2]"><Icon className="h-2.5 w-2.5" aria-hidden="true" /></span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><span className="truncate text-[14px] font-semibold text-[#f2f0ea]">{name}</span><span className="ml-auto shrink-0 tabular-nums text-[11px] text-[#6e7582]">{i.at ? day(i.at) : ''}</span></span>
                    <span className={`block truncate text-[13px] ${i.kind === 'call' && (i.call.booked || i.call.analysis?.outcome === 'booked') ? 'text-emerald-300' : 'text-[#8a909c]'}`}>{preview}</span>
                    {i.kind === 'chat' && i.thread.pending > 0 && <span className="mt-1 inline-block rounded-full bg-[#f5b454]/15 px-2 py-0.5 text-[11px] font-medium text-[#fbd38d]">AI javobi tayyor</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {threads && !shown.length && <li className="px-3 py-8 text-center text-[13px] leading-relaxed text-[#7d838f]">{items.length ? "Bu filtrda suhbat yo'q" : "Hali hech kim yozmagan va qo'ng'iroq qilmagan. Mijoz yozganda yoki qo'ng'iroq qilganda — shu yerda, AI javobi bilan."}</li>}
        </ul>
      </div>
      <div className="min-h-[420px] min-w-0 flex-1">
        {current ? (current.kind === 'chat'
          ? <ChatThread thread={current.thread} notify={notify} onChanged={() => { setN(x => x + 1); onChanged(); }} />
          : <CallThread call={current.call} />)
          : <div className="flex h-full items-center justify-center p-8 text-center text-[14px] leading-relaxed text-[#7d838f]">Suhbatni tanlang — mijoz nima dedi, AI nima javob berdi va nima bilan tugadi, shu yerda.</div>}
      </div>
    </section>
  );
}
