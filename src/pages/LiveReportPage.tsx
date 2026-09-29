import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, Loader2, MousePointerClick, PhoneCall, Send, Trophy } from 'lucide-react';
import type { Clinic, WeekView } from '../types';
import { Artboard } from '../templates/Artboard';
import { StatusBadge } from '../components/ItemCard';
import { Card, IconButton } from '../components/ui';
import { api } from '../data/api';
import { addDays, iso, mondayOf, weekRange, whenLabel } from '../lib/week';

type Counts = Record<string, { clicks: number; contacts: number }>;

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Send; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon className="h-4 w-4 text-teal-700" />{label}</div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

/** To'liq versiya natijalari: haqiqiy bosishlar va raqam qoldirganlar (postdagi havola orqali) */
export function LiveReportPage({ clinic, now, onError }: { clinic: Clinic; now: Date; onError: (msg: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ week: WeekView; counts: Counts } | null>(null);
  const monday = iso(addDays(mondayOf(now), offset * 7));

  useEffect(() => {
    setData(null);
    api.report(monday).then(setData).catch(e => onError((e as Error).message));
  }, [monday]);

  const rows = data?.week.items.map(item => ({ item, c: data.counts[item.id] ?? { clicks: 0, contacts: 0 }, meta: data.week.meta[item.id] })) ?? [];
  const published = rows.filter(r => r.meta.publishedAt).length;
  const clicks = rows.reduce((s, r) => s + r.c.clicks, 0);
  const contacts = rows.reduce((s, r) => s + r.c.contacts, 0);
  const best = [...rows].sort((a, b) => b.c.contacts - a.c.contacts || b.c.clicks - a.c.clicks)[0];
  const maxClicks = Math.max(1, ...rows.map(r => r.c.clicks));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Natijalar</h1>
          <p className="text-sm text-slate-500">Postdagi yozilish havolasini kim bosdi va kim raqam qoldirdi</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <IconButton label="Oldingi hafta" className="border-0" onClick={() => setOffset(offset - 1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <span className="min-w-[168px] text-center text-sm font-bold">{weekRange('uz', addDays(mondayOf(now), offset * 7))}</span>
          <IconButton label="Keyingi hafta" className="border-0" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight className="h-4 w-4" /></IconButton>
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Ko'rishlar sonini Telegram botlarga bermaydi — uni kanal statistikasidan ko'ring. Bu yerda — haqiqiy murojaatlar.
      </p>

      {!data ? (
        <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={Send} label="Chiqqan materiallar" value={`${published} / ${rows.length}`} />
            <Kpi icon={MousePointerClick} label="Havolani bosganlar" value={String(clicks)} />
            <Kpi icon={PhoneCall} label="Raqam qoldirganlar" value={String(contacts)} hint="administrator qo'ng'iroq qiladi" />
            <Kpi icon={Trophy} label="Bosgandan raqamgacha" value={clicks ? `${Math.round((contacts / clicks) * 100)}%` : '—'} />
          </div>
          <Card title="Har bir material">
            <ul className="divide-y divide-slate-100">
              {rows.map(({ item, c, meta }) => (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                    <Artboard item={item} lang="uz" clinic={clinic} className={item.kind === 'story' ? 'h-16 w-auto' : 'h-16 w-16'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{item.kind === 'story' ? 'Storis' : 'Post'} · {item.topic.uz}: {item.design.uz.title}</div>
                    <div className="text-xs text-slate-500">{whenLabel('uz', item.date, item.time)}</div>
                    <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${(c.clicks / maxClicks) * 100}%` }} />
                    </div>
                  </div>
                  <StatusBadge item={item} status={data.week.status[item.id]} now={now} meta={meta} className="hidden shrink-0 sm:inline-flex" />
                  <div className="grid shrink-0 grid-cols-2 gap-x-5 text-right text-sm tabular-nums">
                    <span className="font-bold">{c.clicks}</span>
                    <span className="font-bold text-teal-700">{c.contacts}</span>
                    <span className="text-[11px] text-slate-400">bosish</span>
                    <span className="text-[11px] text-slate-400">raqam</span>
                  </div>
                </li>
              ))}
            </ul>
            {best && best.c.clicks > 0 && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                🏆 Eng yaxshisi — «{best.item.topic.uz}: {best.item.design.uz.title}»: {best.c.clicks} bosish, {best.c.contacts} raqam.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
