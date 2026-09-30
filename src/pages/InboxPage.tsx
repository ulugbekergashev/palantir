import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bot, Check, Loader2, MessagesSquare, Send, X } from 'lucide-react';
import type { AutoReply, InboxMessage, InboxThread, Lead, LeadChannel, ReplyDraft } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card } from '../components/ui';
import { shortDate } from '../lib/week';

const CHANNEL: Record<LeadChannel, { label: string; cls: string }> = {
  telegram: { label: 'Telegram', cls: 'bg-sky-100 text-sky-800' },
  instagram: { label: 'Instagram', cls: 'bg-gradient-to-r from-fuchsia-100 to-orange-100 text-fuchsia-800' },
  bot: { label: 'Bot', cls: 'bg-indigo-100 text-indigo-800' },
  manual: { label: "Qo'lda", cls: 'bg-slate-100 text-slate-600' },
};

export function ChannelBadge({ channel }: { channel: LeadChannel }) {
  const c = CHANNEL[channel];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.cls}`}>{c.label}</span>;
}

const MODE_LABEL: Record<AutoReply['mode'], string> = {
  off: "Cerebro mijozlarga javob tayyorlamaydi",
  draft: "Cerebro javob tayyorlaydi — siz tasdiqlaysiz",
  auto: "Cerebro o'zi javob beradi (bilmaganini sizdan so'raydi)",
};

const nameOf = (l: Lead) => l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';
const time = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? time(iso) : shortDate(iso));

function Thread({ leadId, notify, onBack, onChanged }: { leadId: string; notify: Notify; onBack: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ lead: Lead; messages: InboxMessage[]; replies: ReplyDraft[] } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const load = () => api.thread(leadId).then(setData).catch(e => notify((e as Error).message, true));
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, [leadId]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) notify(ok); await load(); onChanged(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    void act('send', async () => { await api.writeTo(leadId, t); setText(''); }, 'Yuborildi');
  };

  if (!data) return <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const { lead, messages } = data;
  const pending = data.replies.filter(r => r.status === 'pending');
  const scheduled = data.replies.filter(r => r.status === 'scheduled');
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-100 pb-3">
        <button type="button" onClick={onBack} aria-label="Orqaga" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate font-bold">{nameOf(lead)}</span><ChannelBadge channel={lead.channel} /></div>
          <div className="truncate text-xs text-slate-500">{[lead.username && `@${lead.username}`, lead.phone, lead.note].filter(Boolean).join(' · ')}</div>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto py-4">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === 'in' ? 'rounded-bl-md bg-slate-100' : m.by === 'cerebro' ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-br-md bg-emerald-600 text-white'}`}>
              <p className="whitespace-pre-line break-words">{m.text}</p>
              <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${m.direction === 'in' ? 'text-slate-400' : 'text-white/70'}`}>
                {m.by === 'cerebro' && <Bot className="h-3 w-3" />}{m.by === 'cerebro' ? 'Cerebro' : m.by === 'owner' ? 'Siz' : ''} {when(m.createdAt)}
              </div>
            </div>
          </div>
        ))}
        {scheduled.map(r => (
          <div key={r.id} className="ml-auto max-w-[80%] rounded-2xl border border-dashed border-indigo-300 bg-indigo-50 p-3 text-sm">
            <div className="mb-1 text-[11px] font-bold text-indigo-700">⏳ Cerebro {r.dueAt ? time(r.dueAt) : ''} da yuboradi (siz yozmasangiz)</div>
            <p className="whitespace-pre-line">{r.text}</p>
            <Button size="sm" variant="ghost" className="mt-2" disabled={!!busy} onClick={() => act(r.id, () => api.dismissReply(r.id), 'Bekor qilindi')}><X className="h-3.5 w-3.5" /> Yubormasin</Button>
          </div>
        ))}
        {pending.map(r => (
          <div key={r.id} className="ml-auto max-w-[85%] rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="mb-1 text-[11px] font-bold text-amber-800">✍️ Javob taklifi — tasdiqlaysizmi?</div>
            <p className="whitespace-pre-line">{r.text}</p>
            {r.note && <p className="mt-1.5 text-xs text-amber-900">ℹ️ {r.note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => act(r.id, () => api.sendReply(r.id), 'Yuborildi')}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Yuborish
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setText(r.text)}>Tahrirlab yozish</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(`x${r.id}`, () => api.dismissReply(r.id))}><X className="h-3.5 w-3.5" /> Kerak emas</Button>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 pt-3">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(5, Math.max(1, text.split('\n').length))}
          placeholder={lead.reachable ? `${nameOf(lead)}ga yozish…` : "Bu mijozga hozir yozib bo'lmaydi"} aria-label="Mijozga xabar" disabled={!lead.reachable}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:bg-slate-50" />
        <button type="submit" aria-label="Mijozga yuborish" disabled={!text.trim() || !!busy || !lead.reachable}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
          {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      {!lead.reachable && lead.channel === 'instagram' && <p className="pt-2 text-xs text-slate-400">Instagram qoidasi: mijoz oxirgi 24 soatda yozgan bo'lsagina javob berish mumkin.</p>}
    </div>
  );
}

export function InboxPage({ notify }: { notify: Notify }) {
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [settings, setSettings] = useState<AutoReply | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api.inbox().then(r => { setThreads(r.threads); setSettings(r.settings); }).catch(e => notify((e as Error).message, true));
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 15_000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Suhbatlar</h1>
          <p className="text-sm text-slate-500">Mijozlar bilan yozishmalar — bot, shaxsiy Telegram va Instagram bir joyda.</p>
        </div>
        {settings && <a href="#/telegram" className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">{MODE_LABEL[settings.mode]} · o'zgartirish</a>}
      </header>
      {threads === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !threads.length ? (
        <Card><p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-slate-500"><MessagesSquare className="h-5 w-5 shrink-0" /> Hali yozishma yo'q. «Ulanishlar»da Telegram va Instagram'ni ulang — mijozlar yozsa, shu yerda ko'rinadi.</p></Card>
      ) : (
        <div className="grid h-[calc(100dvh-13rem)] min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[320px_1fr]">
          <ul className={`overflow-y-auto border-r border-slate-100 ${open ? 'hidden lg:block' : ''}`}>
            {threads.map(t => (
              <li key={t.lead.id}>
                <button type="button" onClick={() => setOpen(t.lead.id)} aria-current={open === t.lead.id}
                  className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition ${open === t.lead.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{nameOf(t.lead)}</span>
                      <ChannelBadge channel={t.lead.channel} />
                      {t.pending > 0 && <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 text-[11px] font-bold text-amber-800" title="Tasdiq kutayotgan javob">✍️ {t.pending}</span>}
                    </div>
                    {t.last && <p className="mt-0.5 truncate text-xs text-slate-500">{t.last.direction === 'out' ? (t.last.by === 'cerebro' ? 'Cerebro: ' : 'Siz: ') : ''}{t.last.text}</p>}
                  </div>
                  {t.last && <span className="shrink-0 text-[11px] text-slate-400">{when(t.last.createdAt)}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className={`min-h-0 p-4 ${open ? '' : 'hidden lg:block'}`}>
            {open ? <Thread key={open} leadId={open} notify={notify} onBack={() => setOpen(null)} onChanged={() => void load()} />
              : <div className="flex h-full items-center justify-center text-sm text-slate-400">Chapdan suhbatni tanlang</div>}
          </div>
        </div>
      )}
    </div>
  );
}
