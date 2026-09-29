import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Eye, Heart, Info, MessageCircle, Send, Trophy } from 'lucide-react';
import type { Clinic, ContentItem, ItemStatus, PackState } from '../types';
import { Artboard } from '../templates/Artboard';
import { StatusBadge } from '../components/ItemCard';
import { Card, IconButton } from '../components/ui';
import { buildWeek, isPast, statusOf, withEdits } from '../lib/generator';
import { statsFor, type ItemStats } from '../lib/report';
import { money } from '../lib/text';
import { addDays, mondayOf, weekRange, whenLabel } from '../lib/week';

export interface WeekResult {
  items: ContentItem[];
  status: (item: ContentItem) => ItemStatus;
  /** Chiqqan (tasdiqlangan va vaqti kelgan) materiallar va ularning natijasi */
  live: { item: ContentItem; stats: ItemStats }[];
  views: number;
  reactions: number;
  leads: number;
}

export function weekResult(clinic: Clinic, pack: PackState, monday: Date, now: Date): WeekResult {
  const items = buildWeek(clinic, monday, pack.seeds).map(it => withEdits(it, pack.edits[it.id]));
  const status = (item: ContentItem) => statusOf(pack, item, now);
  const live = items
    .filter(it => status(it) === 'published' && isPast(it, now))
    .map(item => ({ item, stats: statsFor(item, clinic.followers) }));
  const sum = (k: keyof ItemStats) => live.reduce((s, x) => s + x.stats[k], 0);
  return { items, status, live, views: sum('views'), reactions: sum('reactions'), leads: sum('leads') };
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Eye; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon className="h-4 w-4 text-teal-700" />{label}</div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ReportPage({ clinic, pack, now }: { clinic: Clinic; pack: PackState; now: Date }) {
  // Standart — o'tgan hafta: u to'liq yakunlangan, natija to'liq ko'rinadi
  const [offset, setOffset] = useState(-1);
  const monday = addDays(mondayOf(now), offset * 7);
  const r = useMemo(() => weekResult(clinic, pack, monday, now), [clinic, pack, monday.getTime(), now]);
  const best = [...r.live].sort((a, b) => b.stats.leads - a.stats.leads || b.stats.views - a.stats.views)[0];
  const maxViews = Math.max(1, ...r.live.map(x => x.stats.views));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Natijalar</h1>
          <p className="text-sm text-slate-500">Qaysi post nechta odamga yetdi va nechtasi botga yozdi</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <IconButton label="Oldingi hafta" className="border-0" onClick={() => setOffset(offset - 1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <span className="min-w-[168px] text-center text-sm font-bold">{weekRange('uz', monday)}</span>
          <IconButton label="Keyingi hafta" className="border-0" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight className="h-4 w-4" /></IconButton>
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Demo: raqamlar namunaviy. Haqiqiy versiyada ko'rishlar Instagram va Telegram statistikasidan, lidlar esa postdagi bot havolasidan olinadi.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Send} label="Chiqqan materiallar" value={`${r.live.length} / ${r.items.length}`} hint="post va storis" />
        <Kpi icon={Eye} label="Ko'rishlar" value={money(r.views)} hint={`${money(clinic.followers)} obunachidan`} />
        <Kpi icon={Heart} label="Reaksiyalar" value={money(r.reactions)} />
        <Kpi icon={MessageCircle} label="Botga yozganlar" value={money(r.leads)} hint="yozilish uchun murojaat" />
      </div>

      {r.live.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">Bu haftada hali chiqqan material yo'q. Postlarni tasdiqlang — vaqti kelgach natija shu yerda chiqadi.</p>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card title="Har bir material">
            <ul className="divide-y divide-slate-100">
              {r.items.map(item => {
                const row = r.live.find(x => x.item.id === item.id);
                return (
                  <li key={item.id} className="flex items-center gap-4 py-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                      <Artboard item={item} lang="uz" clinic={clinic} className={item.kind === 'story' ? 'h-16 w-auto' : 'h-16 w-16'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{item.kind === 'story' ? 'Storis' : 'Post'} · {item.topic.uz}: {item.design.uz.title}</div>
                      <div className="text-xs text-slate-500">{whenLabel('uz', item.date, item.time)}</div>
                      {row && (
                        <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-teal-600" style={{ width: `${(row.stats.views / maxViews) * 100}%` }} />
                        </div>
                      )}
                    </div>
                    {row ? (
                      <div className="grid shrink-0 grid-cols-2 gap-x-5 text-right text-sm tabular-nums">
                        <span className="font-bold">{money(row.stats.views)}</span>
                        <span className="font-bold text-teal-700">{row.stats.leads}</span>
                        <span className="text-[11px] text-slate-400">ko'rish</span>
                        <span className="text-[11px] text-slate-400">lid</span>
                      </div>
                    ) : (
                      <StatusBadge item={item} status={r.status(item)} now={now} className="shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="space-y-5">
            {best && (
              <Card title="Eng yaxshi natija">
                <div className="flex gap-4">
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    <Artboard item={best.item} lang="uz" clinic={clinic} className={best.item.kind === 'story' ? 'h-28 w-auto' : 'h-28 w-28'} />
                  </div>
                  <div className="text-sm">
                    <p className="flex items-center gap-1.5 font-bold"><Trophy className="h-4 w-4 text-amber-500" />{best.item.topic.uz}</p>
                    <p className="mt-1 text-slate-600">{best.item.design.uz.title}</p>
                    <p className="mt-2 text-slate-500"><b className="text-slate-900">{money(best.stats.views)}</b> ko'rish · <b className="text-teal-700">{best.stats.leads}</b> lid</p>
                  </div>
                </div>
              </Card>
            )}
            <Card title="DentaCRM bilan ulansa" description="Lid qayerda qolib ketganini ham ko'rasiz">
              <div className="flex items-center justify-between gap-2 text-center text-xs font-semibold text-slate-600">
                {['Post', 'Lid', 'Qabul', "To'lov"].map((s, i) => (
                  <div key={s} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
                    <span className={`rounded-lg px-2.5 py-1.5 ${i < 2 ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-500'}`}>{s}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Alohida ishlaganda natija lid bilan o'lchanadi. DentaCRM ulansa — qaysi postdan kelgan bemor qabulga yozilgani va qancha to'lagani ham chiqadi.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
