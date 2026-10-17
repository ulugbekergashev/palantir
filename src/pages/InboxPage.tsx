import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bot, Check, Loader2, Phone, Send, Users, X } from 'lucide-react';
import type { AutoReply, InboxMessage, InboxThread, Lead, LeadChannel, LeadStage, Outbound, ReplyDraft } from '../types';
import { api } from '../data/api';
import { FollowupCard, type Notify } from '../components/Artifacts';
import { Button, ButtonLink, Card, EmptyState, PageHeader, controlClass } from '../components/ui';
import { shortDate } from '../lib/week';

const CHANNEL: Record<LeadChannel, { label: string; cls: string }> = {
  telegram: { label: 'Telegram', cls: 'bg-sky-100 text-sky-800' },
  instagram: { label: 'Instagram', cls: 'bg-gradient-to-r from-fuchsia-100 to-orange-100 text-fuchsia-800' },
  bot: { label: 'Bot', cls: 'bg-indigo-100 text-indigo-800' },
  manual: { label: "Qo'lda", cls: 'bg-slate-100 text-slate-600' },
};

const STAGES: Record<LeadStage, { label: string; cls: string }> = {
  new: { label: 'Yangi', cls: 'bg-amber-100 text-amber-800' },
  contacted: { label: "Bog'lanildi", cls: 'bg-blue-100 text-blue-800' },
  won: { label: "Mijoz bo'ldi", cls: 'bg-emerald-100 text-emerald-800' },
  lost: { label: 'Rad etdi', cls: 'bg-slate-100 text-slate-500' },
};
const STAGE_IDS = Object.keys(STAGES) as LeadStage[];

function ChannelBadge({ channel }: { channel: LeadChannel }) {
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

/** Mijozning holati va izohi — suhbat tepasida. Izoh maydondan chiqilganda yoki Enter bosilganda saqlanadi */
function LeadFacts({ lead, notify, onSaved }: { lead: Lead; notify: Notify; onSaved: () => Promise<unknown> }) {
  const saved = lead.note ?? '';
  /** Egasi yozayotgan, hali saqlanmagan izoh. null — maydon serverdagi izohni ko'rsatadi (uni yordamchi ham o'zgartirishi mumkin) */
  const [draft, setDraft] = useState<string | null>(null);
  /** Tanlangan, hali saqlanib ulgurmagan holat: javob kelguncha ro'yxat eski qiymatga qaytib turmasin */
  const [picked, setPicked] = useState<LeadStage | null>(null);
  const save = async (patch: Parameters<typeof api.updateLead>[1], done: string): Promise<boolean> => {
    try { await api.updateLead(lead.id, patch); await onSaved(); notify(done); return true; } catch (e) { notify((e as Error).message, true); return false; }
  };
  const saveNote = async () => {
    if (draft === null) return;
    const next = draft.trim();
    // Saqlanmasa, yozilgan matn maydonda qoladi — keyingi chiqishda yana uriniladi
    if (next === saved || await save({ note: next || null }, 'Izoh saqlandi')) setDraft(null);
  };
  const stage = picked ?? lead.stage;
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={draft ?? saved}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => void saveNote()}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="Izoh: nima so'radi, nimaga kelishildi…"
        aria-label="Mijoz haqida izoh"
        maxLength={500}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
      />
      <select aria-label="Mijoz holati" value={stage}
        onChange={e => { const next = e.target.value as LeadStage; setPicked(next); void save({ stage: next }, 'Holat saqlandi').finally(() => setPicked(null)); }}
        className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${STAGES[stage].cls}`}>
        {STAGE_IDS.map(s => <option key={s} value={s}>{STAGES[s].label}</option>)}
      </select>
    </div>
  );
}

function Thread({ leadId, notify, onBack, onChanged }: { leadId: string; notify: Notify; onBack: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ lead: Lead; messages: InboxMessage[]; replies: ReplyDraft[] } | null>(null);
  const [text, setText] = useState('');
  /** «Tahrirlab yozish» bosilgan taklif: yuborilganda Cerebro farqidan o'rganadi */
  const [editing, setEditing] = useState<string | null>(null);
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
    void act('send', async () => { await api.writeTo(leadId, t, editing); setText(''); setEditing(null); }, 'Yuborildi');
  };

  if (!data) return <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const { lead, messages } = data;
  const pending = data.replies.filter(r => r.status === 'pending');
  const scheduled = data.replies.filter(r => r.status === 'scheduled');
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-100 pb-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Orqaga" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="truncate font-bold">{nameOf(lead)}</span><ChannelBadge channel={lead.channel} /></div>
            <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
              {lead.username && <span>@{lead.username}</span>}
              {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-indigo-700"><Phone className="h-3 w-3" />{lead.phone}</a>}
              <span>{lead.source ? `${lead.source} · ` : ''}{shortDate(lead.createdAt)}</span>
            </div>
          </div>
        </div>
        <LeadFacts lead={lead} notify={notify} onSaved={() => load().then(onChanged)} />
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto py-4">
        {!messages.length && <p className="py-6 text-center text-sm text-slate-400">Bu mijoz bilan hali yozishma yo'q.</p>}
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
            {r.booking && <p className="mb-1.5 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-slate-800">📅 Qabulga yozadi: {r.booking.doctorName}, {r.booking.date} {r.booking.time} — {r.booking.name}, {r.booking.phone}</p>}
            <p className="whitespace-pre-line">{r.text}</p>
            {r.note && <p className="mt-1.5 text-xs text-amber-900">ℹ️ {r.note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => act(r.id, () => api.sendReply(r.id), 'Yuborildi')}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {r.booking ? 'Yozish va yuborish' : 'Yuborish'}
              </Button>
              {!r.booking && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setText(r.text); setEditing(r.id); }}>Tahrirlab yozish</Button>}
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
      {!lead.reachable && lead.channel === 'instagram' && <p className="pt-2 text-xs text-slate-400">Instagram ulanmagan — «Ulanishlar»da qayta ulang.</p>}
    </div>
  );
}

/** Mijozlar: kim yozgan, nima deyilgan, holati qanday — bitta ro'yxatda (bot, shaxsiy Telegram, Instagram, qo'lda qo'shilganlar) */
export function InboxPage({ notify, onChanged }: { notify: Notify; /** Javob tasdiqlandi yoki rad etildi — menyudagi belgi yangilansin */ onChanged?: () => void }) {
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [settings, setSettings] = useState<AutoReply | null>(null);
  const [drafts, setDrafts] = useState<Outbound[]>([]);
  const [stage, setStage] = useState<LeadStage | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => {
    api.followups().then(r => setDrafts(r.followups.filter(f => f.status === 'draft'))).catch(() => {});
    return api.inbox().then(r => { setThreads(r.threads); setSettings(r.settings); }).catch(e => notify((e as Error).message, true));
  };
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 15_000); return () => clearInterval(t); }, []);

  const shown = (threads ?? []).filter(t => stage === 'all' || t.lead.stage === stage);
  const count = (s: LeadStage) => (threads ?? []).filter(t => t.lead.stage === s).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Mijozlar" description="Mijozlar va ular bilan yozishmalar — bot, shaxsiy Telegram va Instagram bir joyda. Yangi mijozni yordamchiga ayting: «Aziz, +998…, 2 ta stol so'radi — yozib qo'y».">
        {!!threads?.length && (
          <select aria-label="Holat bo'yicha saralash" className={`${controlClass} h-8 text-xs`} value={stage} onChange={e => setStage(e.target.value as LeadStage | 'all')}>
            <option value="all">Hammasi ({threads.length})</option>
            {STAGE_IDS.map(s => <option key={s} value={s}>{STAGES[s].label} ({count(s)})</option>)}
          </select>
        )}
        {settings && <a href="#/telegram" className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50">{MODE_LABEL[settings.mode]} · o'zgartirish</a>}
      </PageHeader>

      {drafts.length > 0 && (
        <Card title="Yuborishni kutayotgan xabarlar" description="Yuborish tugmasini bosmaguningizcha mijozga hech narsa ketmaydi">
          <div className="space-y-3">
            {drafts.map(o => <FollowupCard key={o.id} outbound={o} notify={notify} onChange={u => setDrafts(d => (u.status === 'draft' ? d.map(x => (x.id === u.id ? u : x)) : d.filter(x => x.id !== u.id)))} />)}
          </div>
        </Card>
      )}

      {threads === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !threads.length ? (
        <Card><EmptyState icon={Users} title="Hali mijoz yo'q" action={<ButtonLink href="#/telegram" size="sm">Ulanishlarni ochish</ButtonLink>}>«Ulanishlar»da Telegram va Instagram'ni ulang — mijozlar yozsa, shu yerda ko'rinadi.</EmptyState></Card>
      ) : (
        <div className="grid h-[calc(100dvh-13rem)] min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sheet lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <ul className={`overflow-y-auto border-r border-slate-100 ${open ? 'hidden lg:block' : ''}`}>
            {!shown.length && <li className="px-4 py-6 text-center text-sm text-slate-400">Bu holatda mijoz yo'q</li>}
            {shown.map(t => (
              <li key={t.lead.id}>
                <button type="button" onClick={() => setOpen(t.lead.id)} aria-current={open === t.lead.id}
                  className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition ${open === t.lead.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{nameOf(t.lead)}</span>
                      <ChannelBadge channel={t.lead.channel} />
                      {t.pending > 0 && <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 text-[11px] font-bold text-amber-800" title="Tasdiq kutayotgan javob">✍️ {t.pending}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {t.last ? `${t.last.direction === 'out' ? (t.last.by === 'cerebro' ? 'Cerebro: ' : 'Siz: ') : ''}${t.last.text}` : [t.lead.phone, t.lead.note].filter(Boolean).join(' · ') || "Yozishma yo'q"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {t.last && <span className="text-[11px] text-slate-400">{when(t.last.createdAt)}</span>}
                    {t.lead.stage !== 'new' && <span className={`rounded-full px-1.5 text-[10px] font-bold ${STAGES[t.lead.stage].cls}`}>{STAGES[t.lead.stage].label}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className={`min-h-0 p-4 ${open ? '' : 'hidden lg:block'}`}>
            {open ? <Thread key={open} leadId={open} notify={notify} onBack={() => setOpen(null)} onChanged={() => { void load(); onChanged?.(); }} />
              : <div className="flex h-full items-center justify-center"><EmptyState icon={Users} title="Mijozni tanlang">Chapdagi ro'yxatdan mijozni bossangiz, u bilan yozishma shu yerda ochiladi.</EmptyState></div>}
          </div>
        </div>
      )}
    </div>
  );
}
