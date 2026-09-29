import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import type { Clinic, ContentItem, Lang, LiveStatus, WeekView } from './types';
import { EditModal } from './components/EditModal';
import type { ItemAction } from './components/ItemCard';
import { MobileNav, Sidebar, type Page } from './components/Sidebar';
import { TelegramPhone, hhmm, type ChatMsg } from './components/TelegramPhone';
import { Button } from './components/ui';
import { api, session } from './data/api';
import { download, svgToPng } from './lib/exportPng';
import { useFontsReady, useNow, useToast } from './lib/hooks';
import { addDays, fromIso, iso, mondayOf, weekRange } from './lib/week';
import { ConnectPage } from './pages/ConnectPage';
import { LeadsPage } from './pages/LeadsPage';
import { LiveReportPage } from './pages/LiveReportPage';
import { PackagePage } from './pages/PackagePage';
import { SetupPage } from './pages/SetupPage';
import { heightOf } from './templates/Artboard';

const PAGES: Page[] = ['package', 'telegram', 'leads', 'report', 'setup'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klinika';

/** To'liq versiya: klinika kabineti (ma'lumot serverda, matnni AI yozadi, Telegram bot ulanadi) */
export default function LiveApp() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [page, setPage] = useState<Page>('package');
  const [weekOffset, setWeekOffset] = useState(0);
  const [week, setWeek] = useState<WeekView | null>(null);
  const [lang, setLang] = useState<Lang>('uz');
  const [editing, setEditing] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [saveNote, setSaveNote] = useState<{ text: string; error?: boolean }>();
  const [toast, setToast] = useToast();
  const now = useNow();
  useFontsReady();
  const svgs = useRef(new Map<string, SVGSVGElement>());
  const msgId = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const thisMonday = iso(mondayOf(now));
  const monday = useMemo(() => addDays(fromIso(thisMonday), weekOffset * 7), [thisMonday, weekOffset]);
  const mondayKey = iso(monday);
  const current = useRef(mondayKey);
  current.current = mondayKey;

  const fail = (e: unknown) => setToast({ text: (e as Error).message, error: true });
  /** Faqat hozir ochiq haftaning javobi qabul qilinadi (tez almashtirilsa eskisi kelib qolmasin) */
  const acceptWeek = (w: WeekView) => { if (w.monday === current.current) setWeek(w); };

  useEffect(() => {
    api.me().then(r => { setClinic(r.clinic); setStatus(r.status); setLang(r.clinic.contentLang ?? 'uz'); }).catch(fail);
  }, []);

  useEffect(() => {
    setWeek(null);
    api.week(mondayKey).then(acceptWeek).catch(fail);
  }, [mondayKey]);

  // AI yozayotgan bo'lsa — tayyor bo'lguncha vaqti-vaqti bilan so'raladi
  useEffect(() => {
    if (!week?.aiPending) return;
    const t = setTimeout(() => { api.week(week.monday).then(acceptWeek).catch(() => {}); }, 2500);
    return () => clearTimeout(t);
  }, [week]);

  // Telegram sahifasiga qaytganda ulanish holati yangilansin (egasi botni bosgan bo'lishi mumkin)
  useEffect(() => { if (page === 'telegram') api.me().then(r => setStatus(r.status)).catch(() => {}); }, [page]);

  if (!clinic || !status) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  }

  const statusOf = (item: ContentItem) => week?.status[item.id] ?? 'pending';
  const items = week?.items ?? [];
  const pending = items.filter(i => statusOf(i) === 'pending').length;

  const onChangeClinic = (c: Clinic) => {
    setClinic(c);
    setSaveNote({ text: 'Saqlanmoqda…' });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveClinic(c);
        setSaveNote({ text: 'Saqlandi ✓' });
        api.week(current.current).then(acceptWeek).catch(() => {});
      } catch (e) {
        setSaveNote({ text: (e as Error).message, error: true });
      }
    }, 800);
  };

  const onAction = async (id: string, action: ItemAction) => {
    if (action === 'edit') return setEditing(id);
    try {
      acceptWeek(await api.action(id, action));
      if (action === 'variant') setToast({ text: 'Yangi variant tayyorlanmoqda' });
      if (action === 'publish') setToast({ text: "Rejaga qo'yildi" });
    } catch (e) { fail(e); }
  };

  const onPublishAll = async () => {
    try {
      const r = await api.publishAll(mondayKey);
      acceptWeek(r.week);
      setToast({ text: `${r.count} ta material rejaga qo'yildi` });
    } catch (e) { fail(e); }
  };

  const say = (from: ChatMsg['from'], text: string) => setChat(c => [...c, { id: ++msgId.current, from, text, time: hhmm(new Date()) }]);
  const onAsk = async (text: string) => {
    say('owner', text);
    try { say('bot', (await api.ask(text)).answer); } catch (e) { say('bot', `⚠️ ${(e as Error).message}`); }
  };

  const fileName = (item: ContentItem) => `${slug(clinic.name)}-${item.date}-${item.kind}-${item.template}-${lang}.png`;
  const onDownload = async (item: ContentItem) => {
    const svg = svgs.current.get(item.id);
    if (!svg) return;
    download(await svgToPng(svg, 1080, heightOf(item)), fileName(item));
    setToast({ text: 'PNG yuklab olindi' });
  };
  const onDownloadAll = async () => {
    const list = items.filter(i => statusOf(i) !== 'rejected');
    for (const item of list) {
      const svg = svgs.current.get(item.id);
      if (!svg) continue;
      download(await svgToPng(svg, 1080, heightOf(item)), fileName(item));
      await new Promise(r => setTimeout(r, 250));
    }
    setToast({ text: `${list.length} ta rasm yuklab olindi` });
  };
  const registerSvg = (id: string, el: SVGSVGElement | null) => {
    if (el) svgs.current.set(id, el);
    else svgs.current.delete(id);
  };

  const logout = () => { session.set(null); window.location.reload(); };

  const editItem = editing ? week?.items.find(i => i.id === editing) : undefined;
  const editBase = editing ? week?.base.find(i => i.id === editing) : undefined;
  const phone = week && (
    <TelegramPhone
      items={items} statusOf={statusOf} lang={lang} clinic={clinic} now={now} weekLabel={weekRange('uz', monday)}
      chat={chat} onAction={onAction} onAsk={onAsk} className="h-[min(820px,calc(100vh-7rem))]"
    />
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar
        pages={PAGES}
        page={page}
        setPage={setPage}
        clinic={clinic}
        badges={{ package: pending }}
        footer={
          <div className="space-y-2">
            <ul className="space-y-1 rounded-xl bg-slate-50 p-3 text-[11.5px] text-slate-600">
              <li>{status.ownerLinked ? '✅ Telegram ulangan' : '⚪ Telegram ulanmagan'}</li>
              <li>{status.channel ? `✅ Kanal: ${status.channel.title}` : '⚪ Kanal ulanmagan'}</li>
              <li>{status.ai ? '✅ AI matn yozadi' : "⚪ AI o'chiq (namunalar)"}</li>
            </ul>
            <Button variant="ghost" size="sm" className="w-full" onClick={logout}><LogOut className="h-3.5 w-3.5" /> Chiqish</Button>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav pages={PAGES} page={page} setPage={setPage} right={<button type="button" onClick={logout} aria-label="Chiqish" className="rounded-lg p-2 text-slate-500"><LogOut className="h-5 w-5" /></button>} />
        <main className="mx-auto w-full max-w-[1640px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {page === 'package' && (week ? (
            <PackagePage
              items={items} monday={monday} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
              lang={lang} setLang={setLang} clinic={clinic} now={now} statusOf={statusOf}
              metaOf={item => week.meta[item.id]} aiPending={week.aiPending}
              onAction={onAction} onDownload={onDownload} onDownloadAll={onDownloadAll} registerSvg={registerSvg}
              onPublishAll={onPublishAll} chat={chat} onAsk={onAsk} goToSetup={() => setPage('setup')}
            />
          ) : <div className="flex justify-center py-24 text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>)}
          {page === 'telegram' && (
            <ConnectPage status={status} onStatus={setStatus} phone={phone} onToast={text => setToast({ text })} onError={text => setToast({ text, error: true })} />
          )}
          {page === 'leads' && <LeadsPage onError={text => setToast({ text, error: true })} />}
          {page === 'report' && <LiveReportPage clinic={clinic} now={now} onError={text => setToast({ text, error: true })} />}
          {page === 'setup' && <SetupPage clinic={clinic} now={now} onChange={onChangeClinic} saveNote={saveNote} />}
        </main>
      </div>

      {editItem && editBase && (
        <EditModal
          item={editItem}
          original={editBase}
          clinic={clinic}
          lang={lang}
          onClose={() => setEditing(null)}
          onSave={async edit => {
            try { acceptWeek(await api.edit(editItem.id, edit)); setEditing(null); setToast({ text: 'Saqlandi' }); } catch (e) { fail(e); }
          }}
          onReset={async () => {
            try { acceptWeek(await api.edit(editItem.id, null)); setEditing(null); } catch (e) { fail(e); }
          }}
        />
      )}

      {toast && (
        <div role="status" className={`animate-pop fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${toast.error ? 'bg-rose-600' : 'bg-slate-900'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
