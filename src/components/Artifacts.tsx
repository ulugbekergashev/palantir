import { useRef, useState } from 'react';
import { Banknote, Check, CheckCircle2, Download, Eye, FileText, Loader2, RotateCcw, Send, Trash2, X } from 'lucide-react';
import type { Artifact, Business, Doc, MoneyEntry, MoneyStatus, Outbound, Post, Task } from '../types';
import { api } from '../data/api';
import { download, svgToPng } from '../lib/exportPng';
import { dueLabel } from '../lib/week';
import { Artboard, heightOf } from '../templates/Artboard';
import { Markdown } from './Markdown';
import { Button } from './ui';

export type Notify = (text: string, error?: boolean) => void;

export const DOC_KINDS: Record<string, string> = {
  contract: 'Shartnoma', offer: 'Tijorat taklifi', invoice: 'Hisob-faktura', price_list: "Narxlar ro'yxati",
  letter: 'Xat', plan: 'Reja', report: 'Hisobot', other: 'Hujjat',
};

const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'cerebro'}.${ext}`;

/** Bitta amal: tugma bosilganda kutish belgisi, xato — bildirishnomada */
function useAction(notify: Notify) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  return [busy, run] as const;
}

export function DocCard({ doc, notify, compact = false }: { doc: Doc; notify: Notify; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, run] = useAction(notify);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><FileText className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{doc.title}</div>
          <div className="text-xs text-slate-400">{DOC_KINDS[doc.kind] ?? 'Hujjat'} · Word (.docx)</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}><Eye className="h-3.5 w-3.5" /> {open ? 'Yopish' : "Ko'rish"}</Button>
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run('dl', async () => download(await api.documentFile(doc.id), fileName(doc.title, 'docx')))}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {compact ? '' : 'Yuklab olish'}
        </Button>
      </div>
      {open && <Markdown text={doc.markdown} className="mt-3 max-h-[480px] overflow-y-auto rounded-xl bg-slate-50 p-4 text-sm leading-relaxed" />}
    </div>
  );
}

/** Eski post (post yasash olib tashlangan): rasmni yuklab olish va qoralamani o'chirish qoldi */
export function PostCard({ post, biz, notify, onChange }: {
  post: Post; biz: Business; notify: Notify; onChange: (p: Post) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [busy, run] = useAction(notify);
  const lang = biz.contentLang ?? 'uz';
  const story = post.item.kind === 'story';
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className={story ? 'mx-auto w-3/5 pt-3' : ''}>
        <Artboard ref={ref} item={post.item} lang={lang} biz={biz} className={`block h-auto w-full ${story ? 'rounded-xl border border-slate-200' : ''}`} />
      </div>
      <div className="space-y-3 p-3.5">
        <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-700">{post.item.caption[lang]}</p>
        <div className="flex flex-wrap items-center gap-2">
          {post.status === 'published'
            ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {post.inChannel ? 'Kanalga joylandi' : 'Joylandi'}</span>
            : post.status === 'deleted' && <span className="text-xs font-bold text-slate-400">O'chirilgan</span>}
          <Button size="sm" disabled={!!busy} onClick={() => run('png', async () => {
            if (!ref.current) return;
            download(await svgToPng(ref.current, 1080, heightOf(post.item)), fileName(post.item.design[lang].title, 'png'));
          })}>
            {busy === 'png' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PNG
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => run('txt', async () => { await navigator.clipboard.writeText(post.item.caption[lang]); notify('Matn nusxalandi'); })}>Matnni nusxalash</Button>
          {post.status === 'draft' && (
            <Button size="sm" variant="danger" className="ml-auto" disabled={!!busy} onClick={() => run('del', async () => { await api.deletePost(post.id); onChange({ ...post, status: 'deleted' }); })}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const MONEY_STATE: Record<Exclude<MoneyStatus, 'draft'>, { text: string; tone: string }> = {
  running: { text: 'Yozilmoqda…', tone: 'text-slate-500' },
  done: { text: "DentaCRM'ga yozildi", tone: 'text-emerald-700' },
  cancelled: { text: 'Bekor qilingan', tone: 'text-slate-400' },
  failed: { text: 'Yozilmadi', tone: 'text-rose-600' },
  unknown: { text: "Yozilgan-yozilmagani noma'lum — DentaCRM'da tekshiring", tone: 'text-amber-700' },
  undone: { text: "Ortga qaytarildi (CRM'dan o'chirildi)", tone: 'text-slate-500' },
};

/** DentaCRM'ga pul yozuvi: tasdiqlanmaguncha hech narsa yozilmaydi */
export function MoneyCard({ entry, notify, onChange }: { entry: MoneyEntry; notify: Notify; onChange: (e: MoneyEntry) => void }) {
  const [busy, run] = useAction(notify);
  const act = (verb: 'confirm' | 'cancel' | 'undo') => run(verb, async () => onChange((await api.money(entry.id, verb)).entry));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800"><Banknote className="h-4 w-4 text-emerald-600" /> {entry.title}</div>
      <ul className="space-y-0.5 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{entry.details.map(d => <li key={d}>{d}</li>)}</ul>
      {entry.note && <p className="mt-2 text-xs text-slate-500">{entry.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {entry.status === 'draft' ? (
          <>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => act('confirm')}>
              {busy === 'confirm' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Tasdiqlash
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('cancel')}><X className="h-3.5 w-3.5" /> Bekor qilish</Button>
            <span className="text-xs text-slate-400">Tasdiqlasangiz — DentaCRM'ga yoziladi. So'ramagan bo'lsangiz — bekor qiling</span>
          </>
        ) : (
          <>
            <span className={`text-xs font-bold ${MONEY_STATE[entry.status].tone}`}>{MONEY_STATE[entry.status].text}</span>
            {entry.canUndo && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('undo')}>
                {busy === 'undo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Ortga qaytarish
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function FollowupCard({ outbound, notify, onChange }: { outbound: Outbound; notify: Notify; onChange: (o: Outbound) => void }) {
  const [busy, run] = useAction(notify);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500">
        <Send className="h-3.5 w-3.5" /> Mijozlarga xabar · {outbound.leadIds.length} kishi
        {outbound.reachable < outbound.leadIds.length && <span className="font-medium text-slate-400">({outbound.reachable} tasiga Telegram orqali boradi)</span>}
      </div>
      <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-800">{outbound.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {outbound.status === 'sent' ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Yuborildi: {outbound.sentCount} ta</span>
          : outbound.status === 'cancelled' ? <span className="text-xs font-bold text-slate-400">Bekor qilingan</span>
            : (
              <>
                {outbound.reachable > 0 && (
                  <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run('send', async () => {
                    const r = await api.sendFollowup(outbound.id);
                    onChange(r.followup);
                    notify(r.failed ? `Yuborildi: ${r.sent}, yetmadi: ${r.failed}` : `Yuborildi: ${r.sent} ta`, r.failed > 0);
                  })}>
                    {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Yuborish ({outbound.reachable})
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run('cancel', async () => onChange((await api.cancelFollowup(outbound.id)).followup))}>
                  <X className="h-3.5 w-3.5" /> Bekor qilish
                </Button>
                {outbound.reachable === 0 && <span className="text-xs text-slate-400">Bu mijozlar botga yozmagan — qo'ng'iroq qiling yoki matnni nusxalab yuboring.</span>}
              </>
            )}
      </div>
    </div>
  );
}

export function TaskChip({ task, notify, onChange, now }: { task: Task; notify: Notify; onChange: (t: Task) => void; now: Date }) {
  const [busy, run] = useAction(notify);
  const done = task.status === 'done';
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
      <button
        type="button"
        aria-label={done ? 'Qayta ochish' : 'Bajarildi'}
        disabled={!!busy || task.status === 'cancelled'}
        onClick={() => run('t', async () => onChange((await api.updateTask(task.id, { status: done ? 'open' : 'done' })).task))}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 hover:border-indigo-500'}`}
      >
        {done && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${done ? 'text-slate-400 line-through' : ''}`}>{task.title}</div>
        <div className="text-xs text-slate-400">{task.status === 'cancelled' ? 'Bekor qilingan' : task.dueAt ? `⏰ ${dueLabel('uz', task.dueAt, now)}` : 'Muddatsiz'}</div>
      </div>
    </div>
  );
}

/** Suhbatdagi narsa */
export function ArtifactView({ a, biz, notify, onChange, now }: {
  a: Artifact; biz: Business; notify: Notify; onChange: (a: Artifact) => void; now: Date;
}) {
  switch (a.type) {
    case 'document': return <DocCard doc={a.doc} notify={notify} />;
    case 'post': return <div className="max-w-sm"><PostCard post={a.post} biz={biz} notify={notify} onChange={p => onChange({ type: 'post', post: p })} /></div>;
    case 'outbound': return <FollowupCard outbound={a.outbound} notify={notify} onChange={o => onChange({ type: 'outbound', outbound: o })} />;
    case 'money': return <MoneyCard entry={a.entry} notify={notify} onChange={e => onChange({ type: 'money', entry: e })} />;
    case 'task': return <TaskChip task={a.task} notify={notify} now={now} onChange={t => onChange({ type: 'task', task: t })} />;
  }
}
