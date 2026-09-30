import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, MessageCircle, Phone, Plus, Users } from 'lucide-react';
import type { Lead, LeadStage, LiveStatus, Outbound } from '../types';
import { api } from '../data/api';
import { FollowupCard, type Notify } from '../components/Artifacts';
import { Button, Card, TextInput, controlClass } from '../components/ui';
import { shortDate } from '../lib/week';
import { ChannelBadge } from './InboxPage';

export const STAGES: Record<LeadStage, { label: string; cls: string }> = {
  new: { label: 'Yangi', cls: 'bg-amber-100 text-amber-800' },
  contacted: { label: "Bog'lanildi", cls: 'bg-blue-100 text-blue-800' },
  won: { label: "Mijoz bo'ldi", cls: 'bg-emerald-100 text-emerald-800' },
  lost: { label: 'Rad etdi', cls: 'bg-slate-100 text-slate-500' },
};

function LeadRow({ lead, onChange, notify }: { lead: Lead; onChange: (l: Lead) => void; notify: Notify }) {
  const [note, setNote] = useState(lead.note ?? '');
  const save = async (patch: Parameters<typeof api.updateLead>[1]) => {
    try { onChange((await api.updateLead(lead.id, patch)).lead); } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1.4fr_1fr_1.6fr_auto] sm:items-start sm:gap-3">
      <div className="min-w-0">
        <div className="font-semibold">{lead.name ?? (lead.username ? `@${lead.username}` : "Ismi yo'q")}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-indigo-700"><Phone className="h-3 w-3" />{lead.phone}</a>}
          {lead.username && <a href={`https://t.me/${lead.username}`} target="_blank" rel="noreferrer" className="hover:text-indigo-700">@{lead.username}</a>}
          {lead.channel !== 'manual' && <ChannelBadge channel={lead.channel} />}
          {lead.reachable && <a href="#/inbox" className="inline-flex items-center gap-1 text-indigo-700" title="Cerebro bu mijozga yoza oladi"><MessageCircle className="h-3 w-3" />yozish mumkin</a>}
        </div>
      </div>
      <div className="text-xs text-slate-500">{lead.source ?? '—'} · {shortDate(lead.createdAt)}</div>
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={() => { if (note !== (lead.note ?? '')) void save({ note: note || null }); }}
        placeholder="Izoh…"
        aria-label={`Izoh: ${lead.name ?? ''}`}
        maxLength={500}
        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none sm:border-transparent sm:hover:border-slate-200"
      />
      <select aria-label="Holat" value={lead.stage} onChange={e => void save({ stage: e.target.value as LeadStage })}
        className={`w-fit rounded-lg px-2 py-1 text-xs font-bold outline-none ${STAGES[lead.stage].cls}`}>
        {(Object.keys(STAGES) as LeadStage[]).map(s => <option key={s} value={s}>{STAGES[s].label}</option>)}
      </select>
    </li>
  );
}

export function LeadsPage({ status, notify }: { status: LiveStatus; notify: Notify }) {
  const [list, setList] = useState<Lead[] | null>(null);
  const [drafts, setDrafts] = useState<Outbound[]>([]);
  const [filter, setFilter] = useState<LeadStage | 'all'>('all');
  const [form, setForm] = useState({ name: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.leads().then(r => setList(r.leads)).catch(e => notify((e as Error).message, true));
    api.followups().then(r => setDrafts(r.followups.filter(f => f.status === 'draft'))).catch(() => {});
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { lead } = await api.addLead(form);
      setList(l => [lead, ...(l ?? [])]);
      setForm({ name: '', phone: '', note: '' });
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };

  const shown = (list ?? []).filter(l => filter === 'all' || l.stage === filter);
  const count = (s: LeadStage) => (list ?? []).filter(l => l.stage === s).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Mijozlar</h1>
        <p className="text-sm text-slate-500">
          Yozgan mijozlar (bot, shaxsiy Telegram, Instagram) o'zi tushadi{status.generalLink ? '' : ' (ulangach)'}. Yordamchiga «oxirgi hafta yozganlarga rahmat xabarini tayyorla» desangiz — tasdiqlash uchun shu yerga chiqadi.
        </p>
      </header>

      {drafts.length > 0 && (
        <Card title="Yuborishni kutayotgan xabarlar" description="Yuborish tugmasini bosmaguningizcha mijozga hech narsa ketmaydi">
          <div className="space-y-3">
            {drafts.map(o => <FollowupCard key={o.id} outbound={o} notify={notify} onChange={u => setDrafts(d => (u.status === 'draft' ? d.map(x => (x.id === u.id ? u : x)) : d.filter(x => x.id !== u.id)))} />)}
          </div>
        </Card>
      )}

      <form onSubmit={add} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ism" aria-label="Ism" maxLength={80} />
        <TextInput value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+998 …" aria-label="Telefon" maxLength={40} />
        <TextInput value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Nima so'radi" aria-label="Izoh" maxLength={500} />
        <Button type="submit" variant="primary" disabled={busy || (!form.name.trim() && !form.phone.trim())}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Qo'shish</Button>
      </form>

      <Card
        title={`Hammasi${list ? ` (${list.length})` : ''}`}
        action={
          <select aria-label="Saralash" className={`${controlClass} h-8 text-xs`} value={filter} onChange={e => setFilter(e.target.value as LeadStage | 'all')}>
            <option value="all">Hammasi</option>
            {(Object.keys(STAGES) as LeadStage[]).map(s => <option key={s} value={s}>{STAGES[s].label} ({count(s)})</option>)}
          </select>
        }
      >
        {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !shown.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Users className="h-5 w-5" /> {list.length ? "Bu holatda mijoz yo'q" : "Hali mijoz yo'q"}</p>
        ) : (
          <>
            <div className="hidden gap-3 pb-1 text-xs font-semibold text-slate-400 sm:grid sm:grid-cols-[1.4fr_1fr_1.6fr_auto]"><span>Mijoz</span><span>Qayerdan</span><span>Izoh</span><span>Holat</span></div>
            <ul className="divide-y divide-slate-100">
              {shown.map(l => <LeadRow key={l.id} lead={l} notify={notify} onChange={u => setList(prev => prev?.map(x => (x.id === u.id ? u : x)) ?? prev)} />)}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
