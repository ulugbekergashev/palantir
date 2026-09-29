import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, MessageCircle, MousePointerClick, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ContentItem, ItemStatus, Lang, PackState } from './types';
import { EditModal } from './components/EditModal';
import type { ItemAction } from './components/ItemCard';
import { MobileNav, Sidebar, type Page } from './components/Sidebar';
import { TelegramPhone, hhmm, type ChatMsg } from './components/TelegramPhone';
import { Card } from './components/ui';
import { download, svgToPng } from './lib/exportPng';
import { buildWeek, statusOf, withEdits } from './lib/generator';
import { initialStore, loadStore, saveStore, type Store } from './lib/storage';
import { money } from './lib/text';
import { addDays, fromIso, iso, mondayOf, weekRange } from './lib/week';
import { PackagePage } from './pages/PackagePage';
import { ReportPage, weekResult } from './pages/ReportPage';
import { SetupPage } from './pages/SetupPage';
import { heightOf } from './templates/Artboard';
import { useFontsReady, useNow } from './lib/hooks';

/** Telegram sahifasi: egasi uchun qanday ishlashi */
const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarCheck, title: 'Har dushanba 09:00 da', text: 'Haftalik paket keladi: rasm, matn va joylash vaqti.' },
  { icon: MousePointerClick, title: 'Bitta tugma', text: "«Joylash» — belgilangan vaqtda kanal va Instagram'ga chiqadi. «Boshqa variant» — yangisi darhol keladi." },
  { icon: ShieldCheck, title: 'Tasdiqsiz hech narsa chiqmaydi', text: "Tibbiy reklama filtri har matnni tekshiradi: kafolat va isbotsiz da'volar o'tkazilmaydi." },
  { icon: MessageCircle, title: 'Savol bering', text: '«Nechta lid keldi?», «Qaysi post yaxshi ishladi?» — bot natijalardan javob beradi.' },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klinika';

/** Demo bo'limlari (murojaatlar ro'yxati faqat to'liq versiyada — haqiqiy lidlar) */
const DEMO_PAGES: Page[] = ['package', 'telegram', 'report', 'setup'];

/** Sotuv demosi: hammasi brauzerda, server va AI'siz */
export default function DemoApp() {
  const [store, setStore] = useState<Store>(loadStore);
  const [page, setPage] = useState<Page>('package');
  const [lang, setLang] = useState<Lang>('uz');
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow();
  useFontsReady();
  const svgs = useRef(new Map<string, SVGSVGElement>());
  const msgId = useRef(0);

  useEffect(() => { saveStore(store); }, [store]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);

  const { clinic, pack } = store;
  const thisMonday = iso(mondayOf(now));
  const monday = useMemo(() => addDays(fromIso(thisMonday), weekOffset * 7), [thisMonday, weekOffset]);
  const baseItems = useMemo(() => buildWeek(clinic, monday, pack.seeds), [clinic, monday, pack.seeds]);
  const items = useMemo(() => baseItems.map(it => withEdits(it, pack.edits[it.id])), [baseItems, pack.edits]);
  const status = (item: ContentItem) => statusOf(pack, item, now);
  const pendingIds = items.filter(i => status(i) === 'pending').map(i => i.id);

  const setPack = (f: (p: PackState) => PackState) => setStore(s => ({ ...s, pack: f(s.pack) }));
  const setStatus = (ids: string[], value: ItemStatus) =>
    setPack(p => ({ ...p, status: { ...p.status, ...Object.fromEntries(ids.map(id => [id, value])) } }));
  const say = (from: ChatMsg['from'], text: string) =>
    setChat(c => [...c, { id: ++msgId.current, from, text, time: hhmm(new Date()) }]);

  const onAction = (id: string, action: ItemAction) => {
    if (action === 'publish') setStatus([id], 'published');
    else if (action === 'reject') setStatus([id], 'rejected');
    else if (action === 'undo') setStatus([id], 'pending');
    else if (action === 'edit') setEditing(id);
    else {
      setPack(p => {
        const edits = { ...p.edits };
        delete edits[id];
        return { ...p, edits, seeds: { ...p.seeds, [id]: (p.seeds[id] ?? 0) + 1 }, status: { ...p.status, [id]: 'pending' } };
      });
      setToast('Yangi variant tayyor');
    }
  };

  const publishAll = () => {
    if (!pendingIds.length) return 0;
    setStatus(pendingIds, 'published');
    return pendingIds.length;
  };

  /** Botga savol: demo'da kalit so'zlar bo'yicha, haqiqiy versiyada — AI (DentaAI kabi, tayyor hisobotlar ustida) */
  const answer = (question: string): string => {
    const q = question.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
    if (/hammasi|barchasi|все/.test(q) && /joyla|chiqar|опублик/.test(q)) {
      const n = publishAll();
      return n
        ? `✅ ${n} ta material rejaga qo'yildi. Har biri belgilangan vaqtda ${clinic.telegramChannel || 'kanal'}${clinic.instagram ? ` va ${clinic.instagram}` : ''}ga o'zi chiqadi.`
        : "Bu haftada tasdiq kutayotgan material qolmadi 👌";
    }
    const current = mondayOf(now);
    const cur = weekResult(clinic, pack, current, now);
    const prev = weekResult(clinic, pack, addDays(current, -7), now);
    const note = '\n\n(demo: namuna raqamlar)';
    if (/lid|mijoz|yozil|murojaat|заяв|лид|клиент/.test(q)) {
      return cur.live.length
        ? `Bu hafta ${cur.live.length} ta material chiqdi: ${money(cur.views)} ko'rish, botga ${cur.leads} kishi yozdi.\nO'tgan hafta: ${prev.leads} ta lid.${note}`
        : `Bu hafta hali chiqqan material yo'q. O'tgan hafta ${prev.live.length} ta material ${money(prev.views)} ko'rish va ${prev.leads} ta lid olib keldi.${note}`;
    }
    if (/yaxshi|eng |natija|qaysi|лучш|результат/.test(q)) {
      const src = cur.live.length ? cur : prev;
      const best = [...src.live].sort((a, b) => b.stats.leads - a.stats.leads || b.stats.views - a.stats.views)[0];
      if (!best) return "Hali natija yo'q — postlar chiqqach ko'rsataman.";
      return `${cur.live.length ? 'Bu hafta' : "O'tgan hafta"} eng yaxshisi — «${best.item.topic.uz}: ${best.item.design.uz.title}»: ${money(best.stats.views)} ko'rish, ${best.stats.leads} ta lid.${note}`;
    }
    if (/ko'r|qamrov|просмотр|охват/.test(q)) {
      return `Bu hafta ${money(cur.views)} ko'rish, o'tgan hafta — ${money(prev.views)}.${note}`;
    }
    if (/aksiya|chegirma|акци|скидк/.test(q)) {
      return "Aksiyani «Klinika va brend → Haftalik maqsad» bo'limida o'zgartiring — postlar darhol yangilanadi. Men o'zimdan chegirma qo'shmayman.";
    }
    return "Hozircha paket, lidlar va natijalar bo'yicha javob beraman. Masalan: «Nechta lid keldi?» yoki «Qaysi post yaxshi ishladi?»";
  };

  const onAsk = (text: string) => {
    say('owner', text);
    const reply = answer(text);
    setTimeout(() => say('bot', reply), 450);
  };

  const onPublishAll = () => {
    const n = publishAll();
    if (n) {
      say('bot', `✅ ${n} ta material rejaga qo'yildi.`);
      setToast(`${n} ta material rejaga qo'yildi`);
    }
  };

  const fileName = (item: ContentItem) => `${slug(clinic.name)}-${item.date}-${item.kind}-${item.template}-${lang}.png`;
  const onDownload = async (item: ContentItem) => {
    const svg = svgs.current.get(item.id);
    if (!svg) return;
    download(await svgToPng(svg, 1080, heightOf(item)), fileName(item));
    setToast('PNG yuklab olindi');
  };
  const onDownloadAll = async () => {
    const list = items.filter(i => status(i) !== 'rejected');
    for (const item of list) {
      const svg = svgs.current.get(item.id);
      if (!svg) continue;
      download(await svgToPng(svg, 1080, heightOf(item)), fileName(item));
      await new Promise(r => setTimeout(r, 250));
    }
    setToast(`${list.length} ta rasm yuklab olindi`);
  };
  const registerSvg = (id: string, el: SVGSVGElement | null) => {
    if (el) svgs.current.set(id, el);
    else svgs.current.delete(id);
  };

  const reset = () => {
    if (!window.confirm("Namuna klinika ma'lumoti tiklansinmi? Kiritgan o'zgarishlaringiz o'chadi.")) return;
    setStore(initialStore());
    setChat([]);
    setWeekOffset(0);
    setToast('Namuna klinika tiklandi');
  };

  const editItem = editing ? items.find(i => i.id === editing) : undefined;
  const editBase = editing ? baseItems.find(i => i.id === editing) : undefined;

  const phoneProps = {
    items, statusOf: status, lang, clinic, now, weekLabel: weekRange('uz', monday), chat, onAction, onAsk,
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar
        pages={DEMO_PAGES}
        page={page}
        setPage={setPage}
        clinic={clinic}
        badges={{ package: pendingIds.length }}
        footer={
          <div className="space-y-2">
            <p className="rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
              <b>Demo.</b> Matnlar tayyor namunalardan, natijalar namunaviy. Ma'lumot faqat shu brauzerda saqlanadi.
            </p>
            <a href="#/" className="block text-center text-xs font-semibold text-teal-700 hover:underline">Kirish sahifasiga</a>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav pages={DEMO_PAGES} page={page} setPage={setPage} />
        <main className="mx-auto w-full max-w-[1640px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {page === 'package' && (
            <PackagePage
              {...phoneProps}
              monday={monday}
              weekOffset={weekOffset}
              setWeekOffset={setWeekOffset}
              setLang={setLang}
              onDownload={onDownload}
              onDownloadAll={onDownloadAll}
              registerSvg={registerSvg}
              onPublishAll={onPublishAll}
              goToSetup={() => setPage('setup')}
            />
          )}
          {page === 'telegram' && (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-5">
                <header>
                  <h1 className="text-2xl font-extrabold tracking-tight">Telegram bot</h1>
                  <p className="text-sm text-slate-500">Egasi hech qanday dastur ochmaydi — hammasi Telegramda</p>
                </header>
                <Card>
                  <ul className="space-y-4 text-sm">
                    {STEPS.map(({ icon: Icon, title, text }) => (
                      <li key={title} className="flex gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Icon className="h-[18px] w-[18px]" /></div>
                        <div><p className="font-bold">{title}</p><p className="text-slate-500">{text}</p></div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <TelegramPhone {...phoneProps} className="h-[min(820px,calc(100vh-7rem))]" />
            </div>
          )}
          {page === 'report' && <ReportPage clinic={clinic} pack={pack} now={now} />}
          {page === 'setup' && (
            <SetupPage clinic={clinic} now={now} onReset={reset} onChange={c => setStore(s => ({ ...s, clinic: c }))} />
          )}
        </main>
      </div>

      {editItem && editBase && (
        <EditModal
          item={editItem}
          original={editBase}
          clinic={clinic}
          lang={lang}
          onClose={() => setEditing(null)}
          onSave={edit => {
            setPack(p => ({ ...p, edits: { ...p.edits, [editItem.id]: edit } }));
            setEditing(null);
            setToast('Saqlandi');
          }}
          onReset={() => {
            setPack(p => {
              const edits = { ...p.edits };
              delete edits[editItem.id];
              return { ...p, edits };
            });
            setEditing(null);
          }}
        />
      )}

      {toast && (
        <div role="status" className="animate-pop fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
