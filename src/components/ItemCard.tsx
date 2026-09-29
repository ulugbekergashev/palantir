import { useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Download, Loader2, PenLine, RefreshCw, Send, ShieldCheck, Undo2, X } from 'lucide-react';
import type { Clinic, ContentItem, ItemStatus, Lang } from '../types';
import { Artboard } from '../templates/Artboard';
import { check } from '../lib/compliance';
import { isPast } from '../lib/generator';
import { whenLabel } from '../lib/week';
import { Button, IconButton } from './ui';

export type ItemAction = 'publish' | 'reject' | 'variant' | 'edit' | 'undo';

/** Holat: kutilmoqda / rejada (vaqti kelmagan) / joylandi / kerak emas */
export function StatusBadge({ item, status, now, className = '' }: { item: ContentItem; status: ItemStatus; now: Date; className?: string }) {
  const [text, cls, Icon] = status === 'rejected'
    ? ['Kerak emas', 'bg-slate-100 text-slate-500', X]
    : status === 'published'
      ? isPast(item, now) ? ['Joylandi', 'bg-emerald-50 text-emerald-700', Check] : ['Rejada', 'bg-sky-50 text-sky-700', CalendarClock]
      : ['Tasdiq kutilmoqda', 'bg-amber-50 text-amber-700', CalendarClock];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${cls} ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {text}
    </span>
  );
}

/** Tibbiy reklama filtri natijasi */
export function ComplianceNote({ text }: { text: string }) {
  const issues = check(text);
  if (!issues.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <ShieldCheck className="h-3.5 w-3.5" /> Tibbiy reklama qoidalari tekshirildi
      </p>
    );
  }
  return (
    <ul className="space-y-1 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
      {issues.map(i => (
        <li key={i.phrase} className="flex gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><b>«{i.phrase}»</b> — {i.why}. {i.hint}.</span>
        </li>
      ))}
    </ul>
  );
}

export const complianceText = (item: ContentItem, lang: Lang) =>
  [item.design[lang].title, ...item.design[lang].lines, item.caption[lang]].join('\n');

export function ItemCard({ item, lang, clinic, status, now, onAction, onDownload, registerSvg, horizontal = false }: {
  item: ContentItem; lang: Lang; clinic: Clinic; status: ItemStatus; now: Date;
  onAction: (id: string, action: ItemAction) => void;
  onDownload: (item: ContentItem) => Promise<void>;
  registerSvg: (id: string, el: SVGSVGElement | null) => void;
  horizontal?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const story = item.kind === 'story';
  const pending = status === 'pending';
  const download = async () => {
    setBusy(true);
    try { await onDownload(item); } finally { setBusy(false); }
  };

  return (
    <article className={`flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${horizontal ? 'flex-col sm:flex-row' : 'flex-col'} ${status === 'rejected' ? 'opacity-60' : ''}`}>
      <div className={`flex items-center justify-center bg-slate-100 ${horizontal ? 'sm:w-[46%] sm:shrink-0' : ''}`}>
        <Artboard
          ref={el => registerSvg(item.id, el)}
          item={item}
          lang={lang}
          clinic={clinic}
          className={story ? 'block h-[380px] w-auto max-w-full' : 'block h-auto w-full'}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <StatusBadge item={item} status={status} now={now} />
          <span className="truncate font-medium text-slate-500">{whenLabel('uz', item.date, item.time)}</span>
        </div>
        <div className="-mt-1 text-sm font-bold text-slate-900">{story ? 'Storis' : 'Post'} · {item.topic[lang]}</div>
        <p className={`whitespace-pre-line text-sm leading-relaxed text-slate-600 ${horizontal ? 'line-clamp-6' : 'line-clamp-5'}`}>{item.caption[lang]}</p>
        <ComplianceNote text={complianceText(item, lang)} />

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {pending ? (
            <Button variant="primary" size="sm" onClick={() => onAction(item.id, 'publish')}>
              <Send className="h-3.5 w-3.5" /> Joylash
            </Button>
          ) : (
            <Button size="sm" onClick={() => onAction(item.id, 'undo')}>
              <Undo2 className="h-3.5 w-3.5" /> Qaytarish
            </Button>
          )}
          <IconButton label="Boshqa variant" onClick={() => onAction(item.id, 'variant')}><RefreshCw className="h-4 w-4" /></IconButton>
          <IconButton label="Tahrirlash" onClick={() => onAction(item.id, 'edit')}><PenLine className="h-4 w-4" /></IconButton>
          <IconButton label="PNG yuklab olish" onClick={download} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </IconButton>
          {pending && (
            <IconButton label="Kerak emas" className="ml-auto" onClick={() => onAction(item.id, 'reject')}><X className="h-4 w-4" /></IconButton>
          )}
        </div>
      </div>
    </article>
  );
}
