/**
 * Marketolog → Natijalar: oxirgi 30 kunda chiqqan kontent qanday ishladi — Telegram kanal posti va videosi (ko'rishlar), Instagram posti
 * (layk, izoh) va reklama (sarf, natija). Marketolog har ertalab o'zi o'lchaydi; «Yangilash» — hozir (yarim soatda bir marta).
 * Eng yaxshi va eng sust postlar keyingi kontent-rejaga hisobga olinadi.
 */
import { useEffect, useState } from 'react';
import { Clapperboard, ExternalLink, Eye, Heart, Loader2, MessageCircle, RefreshCw, Send, Image as ImageIcon } from 'lucide-react';
import type { ResultItem, ResultsView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';

const KIND: Record<ResultItem['kind'], { label: string; Icon: typeof Send }> = {
  telegram: { label: 'Telegram kanal', Icon: Send },
  video: { label: 'Kanal videosi', Icon: Clapperboard },
  instagram: { label: 'Instagram', Icon: ImageIcon },
};
const when = (at: string) => new Date(at).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const n = (v: number | null) => (v === null ? '—' : v.toLocaleString('ru-RU'));
const button = 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-glass/10 px-3.5 text-[13.5px] font-semibold text-[#c9cbd2] transition-opacity hover:bg-glass/5 disabled:opacity-40';

function Row({ i }: { i: ResultItem }) {
  const k = KIND[i.kind];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-glass/[0.05] text-[#c9cbd2]" title={k.label}><k.Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-[14px] font-semibold text-[#f2f0ea]">{i.title || '—'}</p>
        <p className="text-[12.5px] text-[#8a909c]">{k.label} · {when(i.at)}</p>
      </div>
      <div className="flex items-center gap-4 text-[13.5px] tabular-nums text-[#e4e3de]">
        {i.kind === 'instagram' ? <>
          <span className="inline-flex items-center gap-1.5" title="Layk"><Heart className="h-4 w-4 text-[#fb7185]" aria-hidden="true" />{n(i.likes)}</span>
          <span className="inline-flex items-center gap-1.5" title="Izoh"><MessageCircle className="h-4 w-4 text-[#7dd3fc]" aria-hidden="true" />{n(i.comments)}</span>
          {i.views !== null && <span className="inline-flex items-center gap-1.5" title="Ko'rish"><Eye className="h-4 w-4 text-[#a3a9b5]" aria-hidden="true" />{n(i.views)}</span>}
        </> : <span className="inline-flex items-center gap-1.5" title="Ko'rish"><Eye className="h-4 w-4 text-[#a3a9b5]" aria-hidden="true" />{n(i.views)}</span>}
        {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" aria-label={`${i.title} — ochish`} className="text-[#a3a9b5] hover:text-[#f2f0ea]"><ExternalLink className="h-4 w-4" aria-hidden="true" /></a>}
      </div>
    </li>
  );
}

export function MarketingResults({ notify, tick }: { notify: Notify; tick: number }) {
  const [view, setView] = useState<ResultsView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    api.results().then(r => { if (!stale) setView(r); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.resultsRefresh();
      setView(r);
      const t = typeof r.measured.telegram === 'number' ? `Telegram: ${r.measured.telegram} ta` : `Telegram: ${r.measured.telegram}`;
      const ig = typeof r.measured.instagram === 'number' ? `Instagram: ${r.measured.instagram} ta` : `Instagram: ${r.measured.instagram}`;
      notify(`O'lchandi — ${t}; ${ig}`);
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const tg = view.items.filter(i => i.kind !== 'instagram'), ig = view.items.filter(i => i.kind === 'instagram');
  const sum = (list: ResultItem[], f: (i: ResultItem) => number | null) => list.reduce((a, i) => a + (f(i) ?? 0), 0);
  const totals = [
    { label: 'Telegram kanal', value: tg.length ? `${tg.length} post · ${n(sum(tg, i => i.views))} ko'rish` : '—' },
    { label: 'Instagram', value: ig.length ? `${ig.length} post · ${n(sum(ig, i => i.likes))} layk · ${n(sum(ig, i => i.comments))} izoh` : '—' },
    { label: 'Reklama', value: view.ads.length ? view.ads.map(a => `${a.spent} ${a.currency}`).join(' · ') : '—' },
  ];
  return (
    <div className="space-y-5">
      <Panel title="Oxirgi 30 kun" action={<button type="button" onClick={() => void refresh()} disabled={busy} className={button}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Yangilash</button>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {totals.map(t => (
            <div key={t.label} className="min-w-0 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-3.5">
              <p className="text-[12.5px] font-semibold text-[#8a909c]">{t.label}</p>
              <p className="mt-1 text-[15px] font-semibold text-[#f2f0ea]">{t.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[#8a909c]">
          {view.checkedAt ? `Oxirgi o'lchov: ${when(view.checkedAt)}. ` : "Hali o'lchanmagan — «Yangilash»ni bosing. "}
          Marketolog har ertalab o'zi o'lchaydi; eng yaxshi va eng sust postlar keyingi <a href={hrefOf('marketolog', 'reja')} className="underline">kontent-rejaga</a> hisobga olinadi.
          {view.channelOpen === false && ' Telegram kanalingiz yopiq — ko\'rishlar soni olinmaydi.'}
        </p>
      </Panel>
      <Panel title="Chiqqan kontent">
        {!view.items.length
          ? <Quiet>Oxirgi 30 kunda chiqqan post yo'q. Kontent-meyker postlari kanalga yoki Instagram'ga joylangach, natijasi shu yerda ko'rinadi.</Quiet>
          : <ul className="flex flex-col gap-2.5">{view.items.map(i => <Row key={`${i.kind}-${i.id}`} i={i} />)}</ul>}
      </Panel>
      {view.ads.length > 0 && (
        <Panel title="Reklama">
          <ul className="flex flex-col gap-2.5">
            {view.ads.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-3.5 text-[13.5px]">
                <span className="min-w-0 flex-1 basis-56 truncate font-semibold text-[#f2f0ea]">{a.name}</span>
                <span className="tabular-nums text-[#e4e3de]">{a.spent} {a.currency} · {a.results} natija · {n(a.clicks)} bosish</span>
                <span className="text-[12.5px]" style={{ color: HUE.target.a }}>{when(a.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
