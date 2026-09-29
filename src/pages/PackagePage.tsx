import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Send, Sparkles, Target } from 'lucide-react';
import type { Clinic, ContentItem, ItemMeta, ItemStatus, Lang } from '../types';
import { ItemCard, type ItemAction } from '../components/ItemCard';
import { TelegramPhone, type ChatMsg } from '../components/TelegramPhone';
import { WeekStrip } from '../components/WeekStrip';
import { Button, IconButton, LangSwitch } from '../components/ui';
import { occasionsInWeek } from '../lib/occasions';
import { dayLong, fromIso, iso, weekRange } from '../lib/week';

export function PackagePage(props: {
  items: ContentItem[]; monday: Date; weekOffset: number; setWeekOffset: (n: number) => void;
  lang: Lang; setLang: (l: Lang) => void; clinic: Clinic; now: Date;
  statusOf: (item: ContentItem) => ItemStatus; onAction: (id: string, action: ItemAction) => void;
  onDownload: (item: ContentItem) => Promise<void>; onDownloadAll: () => Promise<void>;
  registerSvg: (id: string, el: SVGSVGElement | null) => void; onPublishAll: () => void;
  chat: ChatMsg[]; onAsk: (text: string) => void; goToSetup: () => void;
  /** To'liq versiya: serverdagi holat va AI yozayotgani */
  metaOf?: (item: ContentItem) => ItemMeta | undefined;
  aiPending?: boolean;
}) {
  const { items, monday, weekOffset, setWeekOffset, lang, setLang, clinic, now, statusOf } = props;
  const [zipping, setZipping] = useState(false);
  const posts = items.filter(i => i.kind === 'post');
  const stories = items.filter(i => i.kind === 'story');
  const pending = items.filter(i => statusOf(i) === 'pending').length;
  const approved = items.filter(i => statusOf(i) === 'published').length;
  const focus = clinic.services.find(s => s.id === clinic.goal.focusServiceId);
  const occasions = occasionsInWeek(monday);

  const downloadAll = async () => {
    setZipping(true);
    try { await props.onDownloadAll(); } finally { setZipping(false); }
  };

  const card = (item: ContentItem, horizontal = false) => (
    <ItemCard
      key={item.id}
      item={item}
      lang={lang}
      clinic={clinic}
      status={statusOf(item)}
      now={now}
      meta={props.metaOf?.(item)}
      onAction={props.onAction}
      onDownload={props.onDownload}
      registerSvg={props.registerSvg}
      horizontal={horizontal}
    />
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Haftalik paket</h1>
          <p className="text-sm text-slate-500">3 ta post va 2 ta storis. Har dushanba soat 09:00 da tayyor bo'ladi va Telegramingizga keladi.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <IconButton label="Oldingi hafta" className="border-0" onClick={() => setWeekOffset(weekOffset - 1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <span className="min-w-[168px] text-center text-sm font-bold">{weekRange('uz', monday)}</span>
          <IconButton label="Keyingi hafta" className="border-0" onClick={() => setWeekOffset(weekOffset + 1)}><ChevronRight className="h-4 w-4" /></IconButton>
        </div>
        {weekOffset !== 0 && <Button size="sm" onClick={() => setWeekOffset(0)}>Bu hafta</Button>}
        <LangSwitch label="Kontent tili" value={lang} onChange={setLang} options={[{ value: 'uz', label: 'UZ' }, { value: 'ru', label: 'RU' }]} />
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-white p-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><Target className="h-5 w-5" /></div>
          <div className="min-w-0 text-sm">
            <p className="font-bold text-slate-900">
              Bu hafta urg'u: {focus?.name || 'klinika xizmatlari'}
              {clinic.goal.promo && <span className="font-medium text-slate-600"> · Aksiya: {clinic.goal.promo}{clinic.goal.promoUntil ? ` (${dayLong('uz', fromIso(clinic.goal.promoUntil))}gacha)` : ''}</span>}
            </p>
            <p className="mt-0.5 text-slate-500">
              {occasions.length ? `Bayram va sanalar: ${occasions.map(o => o.title.uz.replace(/!$/, '')).join(', ')}. ` : ''}
              Bo'sh vaqtlar: {clinic.goal.freeSlots.length} ta.{' '}
              <button type="button" onClick={props.goToSetup} className="font-semibold text-teal-700 hover:underline">O'zgartirish</button>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-600">{approved}/{items.length} tasdiqlandi</span>
          <Button variant="primary" size="sm" disabled={!pending} onClick={props.onPublishAll}><Send className="h-3.5 w-3.5" /> Hammasini joylash</Button>
          <Button size="sm" onClick={downloadAll} disabled={zipping}>
            {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PNG ({items.filter(i => statusOf(i) !== 'rejected').length})
          </Button>
        </div>
      </div>

      {props.aiPending && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-violet-50 px-3.5 py-2.5 text-sm font-medium text-violet-800">
          <Sparkles className="h-4 w-4 animate-pulse" /> AI shu hafta uchun matn yozmoqda — tayyor bo'lgach kartochkalar o'zi yangilanadi.
        </p>
      )}

      <WeekStrip monday={monday} items={items} statusOf={statusOf} today={iso(now)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-400">Postlar · Instagram va Telegram kanal</h2>
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">{posts.map(i => card(i))}</div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-400">Storislar</h2>
            <div className="grid gap-5 2xl:grid-cols-2">{stories.map(i => card(i, true))}</div>
          </section>
        </div>
        <aside className="hidden xl:block">
          <div className="sticky top-6">
            <p className="mb-3 text-center text-xs font-semibold text-slate-500">Egasining Telegrami — tugmalarni bosib ko'ring</p>
            <TelegramPhone
              className="h-[calc(100vh-6.5rem)] max-h-[860px]"
              items={items}
              statusOf={statusOf}
              lang={lang}
              clinic={clinic}
              now={now}
              weekLabel={weekRange('uz', monday)}
              chat={props.chat}
              onAction={props.onAction}
              onAsk={props.onAsk}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
