/**
 * Marketing → Kontent-meyker: Telegram kanal qoralamalari (kontent-zavod — siz kuzatadigan ochiq kanallardagi yangiliklardan yoki
 * mavzudan). Qoralama Telegram'ingizga ham keladi; kanalga faqat siz «Kanalga joylash»ni bosganda chiqadi.
 * Varaqlar: Postlar → Telegram kanal (yozdirish, tahrir, joylash) · Manbalar (kuzatiladigan kanallar) · Kanallar (Telegram kanal, til,
 * uslub, jadval; Instagram va rasm chizish holati). Instagram postlari — Posts.tsx
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, Plus, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import type { ContentDraft, LiveStatus } from '../../types';
import { api, type ContentView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';
import { MetaAiConnect } from './Marketing';

const MAX_DRAFT = 4000;
export const ACCENT = HUE.kontent.a;
export const field = 'w-full rounded-xl border border-glass/40 bg-glass/[0.03] px-3.5 py-2.5 text-[14.5px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f] focus:border-glass/60';
export const button = 'inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-opacity disabled:opacity-40';
export const ghost = `${button} border border-glass/10 text-[#c9cbd2] hover:bg-glass/5`;
export const spin = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;

const STATUS: Record<ContentDraft['status'], { label: string; cls: string }> = {
  draft: { label: 'Tasdiqingizni kutyapti', cls: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  publishing: { label: 'Joylanyapti…', cls: 'bg-[#3fb6ff]/15 text-[#bfe6ff]' },
  published: { label: 'Kanalda', cls: 'bg-emerald-400/15 text-[#a7f3d0]' },
  failed: { label: 'Joylanmadi', cls: 'bg-[#f87171]/15 text-[#fecaca]' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-glass/10 text-[#a3a9b5]' },
};

/** Kontent-meyker ma'lumoti: hamma varaq bitta holatdan; har amal serverdan yangi ko'rinishni qaytaradi */
export function useContent(notify: Notify, tick: number): [ContentView | null, (v: ContentView) => void] {
  const [view, setView] = useState<ContentView | null>(null);
  useEffect(() => {
    let stale = false;
    api.content().then(v => { if (!stale) setView(v); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [view, setView];
}

/** true — bajarildi (xato bo'lsa sababi ko'rsatiladi va false) */
export type Run = (what: string, fn: () => Promise<ContentView>, done?: string) => Promise<boolean>;
export function useRun(notify: Notify, setView: (v: ContentView) => void): [string | null, Run] {
  const [busy, setBusy] = useState<string | null>(null);
  const run: Run = async (what, fn, done) => {
    setBusy(what);
    try { setView(await fn()); if (done) notify(done); return true; } catch (e) { notify((e as Error).message, true); return false; } finally { setBusy(null); }
  };
  return [busy, run];
}

/** Shapka raqamlari — Telegram kanal va Instagram birga (instagram — ulangan akkaunt) */
export function contentStats(v: ContentView | null, instagram: string | null) {
  const waiting = v ? v.drafts.filter(d => d.status === 'draft' || d.status === 'failed').length + v.igPosts.waiting : null;
  const week = Date.now() - 7 * 86_400_000;
  const where = v ? [v.settings.channelId && 'Telegram', instagram && 'Instagram'].filter(Boolean) : [];
  return [
    { label: 'Tasdiq kutyapti', value: waiting ?? '—', tone: waiting ? 'warn' as const : undefined },
    { label: 'Chiqdi', value: v ? v.drafts.filter(d => d.status === 'published' && Date.parse(d.publishedAt ?? '') > week).length + v.igPosts.week : '—', hint: 'oxirgi 7 kunda' },
    { label: 'Rejada', value: v?.plan.length ?? '—', hint: 'mavzu' },
    { label: 'Joylaydi', value: v ? (where.length ? where.join(' · ') : 'ulanmagan') : '—', tone: v && !where.length ? 'warn' as const : undefined },
  ];
}

// ─── Qoralamalar ──────────────────────────────────────────────────────────────

function DraftCard({ d, channel, notify, setView }: { d: ContentDraft; channel: boolean; notify: Notify; setView: (v: ContentView) => void }) {
  const [text, setText] = useState(d.text);
  const [busy, run] = useRun(notify, setView);
  const editable = d.status === 'draft' || d.status === 'failed';
  const changed = text.trim() !== d.text;
  const s = STATUS[d.status];
  return (
    <li className="space-y-3 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
        {d.topic && <span className="truncate text-[12px] text-[#7d838f]">mavzu: {d.topic}</span>}
        <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{new Date(d.publishedAt ?? d.createdAt).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {editable
        ? <textarea aria-label="Post matni" value={text} onChange={e => setText(e.target.value)} rows={Math.min(16, Math.max(6, text.split('\n').length + 1))} maxLength={MAX_DRAFT} className={field} />
        : <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#e4e3de]">{d.text}</p>}
      {d.error && d.status === 'failed' && <p className="rounded-xl bg-[#f87171]/10 p-3 text-[13px] text-[#fecaca]">{d.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {editable && changed && (
          <button type="button" disabled={!!busy} onClick={() => void run('save', () => api.contentEdit(d.id, text), "Saqlandi — Telegram'ga yangi karta yuborildi")} className={ghost}>
            {busy === 'save' && spin} Matnni saqlash
          </button>
        )}
        {editable && (
          <button type="button" disabled={!!busy || changed || !channel} title={!channel ? 'Avval «Kanal» varag\'ida kanalingizni ulang' : changed ? 'Avval matnni saqlang' : undefined}
            onClick={() => void run('publish', () => api.contentPublish(d.id), 'Kanalga joylandi')} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>
            {busy === 'publish' ? spin : <Send className="h-4 w-4" aria-hidden="true" />} {d.status === 'failed' ? 'Qayta joylash' : 'Kanalga joylash'}
          </button>
        )}
        {editable && (
          <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Qoralama bekor qilinsinmi?')) void run('cancel', () => api.contentCancel(d.id)); }} className={`${button} text-[#a3a9b5] hover:bg-glass/5`}>
            <X className="h-4 w-4" aria-hidden="true" /> Bekor
          </button>
        )}
        {d.sourceUrl && <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-[#8a909c] no-underline hover:text-[#d9dbe1]"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> material</a>}
      </div>
    </li>
  );
}

function TopicForm({ notify, setView }: { notify: Notify; setView: (v: ContentView) => void }) {
  const [topic, setTopic] = useState('');
  const [busy, run] = useRun(notify, setView);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('topic', () => api.contentTopic(topic), "Qoralama tayyor — Telegram'ga ham yuborildi").then(ok => { if (ok) setTopic(''); });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-[#a3a9b5]">Yoki o'z mavzuingiz bo'yicha</span>
        <textarea value={topic} onChange={e => setTopic(e.target.value)} rows={2} maxLength={2000} className={field}
          placeholder="Masalan: klinika administratori uchun 3 ta AI vosita — qo'ng'iroqni yozish, eslatma, javob shabloni" />
      </label>
      <button type="submit" disabled={topic.trim().length < 5 || !!busy} className={ghost}>{busy ? spin : <Wand2 className="h-4 w-4" aria-hidden="true" />} Shu mavzuda yozsin</button>
    </form>
  );
}

export function ContentDrafts({ view, setView, notify }: { view: ContentView | null; setView: (v: ContentView) => void; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const generate = async () => {
    setBusy(true);
    try { const r = await api.contentRun(); setView(r); notify(r.note); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const list = view.drafts;
  const channel = !!view.settings.channelId;
  return (
    <div className="space-y-5">
      <Panel title="Kontent-zavod">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void generate()} disabled={busy || view.running || !view.sources.length} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>
              {busy || view.running ? spin : <Sparkles className="h-4 w-4" aria-hidden="true" />} {busy || view.running ? 'Yangiliklarni o\'qib, yozyapti…' : 'Yangi qoralamalar'}
            </button>
            <p className="text-[13px] leading-relaxed text-[#8a909c]">
              {view.sources.length
                ? <>{view.sources.length} ta kanaldagi yangi postlardan {view.settings.perRun} tagacha qoralama yozadi{view.settings.auto ? ' · har kuni ertalab o\'zi ham' : ''}.</>
                : <>Avval <a href={hrefOf('marketolog', 'manbalar')} className="font-semibold text-[#ffd6a8] underline">Manbalar</a>ga kuzatiladigan kanallarni qo'shing.</>}
            </p>
          </div>
          {!channel && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">Kanalingiz hali ulanmagan — qoralama yozsa bo'ladi, joylash uchun <a href={hrefOf('marketolog', 'kanal')} className="font-semibold text-[#fde2b0] underline">Kanal</a> varag'ida ulang.</p>}
          <TopicForm notify={notify} setView={setView} />
        </div>
      </Panel>
      <Panel title="Kanal qoralamalari">
        {!list.length
          ? <Quiet>Hali qoralama yo'q. «Yangi qoralamalar»ni bosing yoki Yordamchiga ayting: «kanalimga bugungi yangiliklardan post tayyorla».</Quiet>
          : <ul className="flex flex-col gap-3">{list.map(d => <DraftCard key={`${d.id}-${d.status}-${d.text.length}`} d={d} channel={channel} notify={notify} setView={setView} />)}</ul>}
      </Panel>
    </div>
  );
}

// ─── Manbalar ─────────────────────────────────────────────────────────────────

export function ContentSources({ view, setView, notify }: { view: ContentView | null; setView: (v: ContentView) => void; notify: Notify }) {
  const [handle, setHandle] = useState('');
  const [busy, run] = useRun(notify, setView);
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const add = (e: FormEvent) => {
    e.preventDefault();
    void run('add', () => api.contentSourceAdd(handle), 'Manba qo\'shildi').then(ok => { if (ok) setHandle(''); });
  };
  return (
    <Panel title="Kuzatiladigan kanallar">
      <div className="space-y-4">
        <p className="text-[13.5px] leading-relaxed text-[#a3a9b5]">Ochiq Telegram kanallar — raqobatchilar, yangilik kanallari, sohangizdagi bloggerlar. Kontent-meyker ulardan faqat fakt oladi va o'z so'zi bilan yozadi; manba kanalni postda tilga olmaydi.</p>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@kanal_nomi yoki t.me/kanal_nomi" aria-label="Kanal havolasi" className={`${field} min-w-0 flex-1 basis-60`} />
          <button type="submit" disabled={handle.trim().length < 3 || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'add' ? spin : <Plus className="h-4 w-4" aria-hidden="true" />} Qo'shish</button>
        </form>
        {!view.sources.length ? <Quiet>Hali manba yo'q.</Quiet> : (
          <ul className="divide-y divide-glass/[0.06] rounded-2xl border border-glass/[0.06]">
            {view.sources.map(s => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <a href={`https://t.me/${s.handle}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#f2f0ea] no-underline hover:underline">@{s.handle}</a>
                  <p className="truncate text-[12.5px] text-[#8a909c]">{s.title ?? 'hali o\'qilmagan'}{s.lastPost ? ` · oxirgi o'qilgan post №${s.lastPost}` : ''}</p>
                </div>
                <button type="button" disabled={!!busy} onClick={() => void run(`rm${s.id}`, () => api.contentSourceRemove(s.id))} aria-label={`@${s.handle} ni olib tashlash`} className={`${button} text-[#a3a9b5] hover:bg-glass/5`}>
                  {busy === `rm${s.id}` ? spin : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ─── Kanal va uslub ───────────────────────────────────────────────────────────

/** Instagram va rasm chizish: qayerga joylanadi, kim chizadi */
function OtherOutlets({ view, status, onStatus, notify }: { view: ContentView; status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const ig = status.instagram;
  const meta = status.metaAi;
  return (
    <>
      <Panel title="Instagram">
        {ig.account
          ? <p className="text-[15px] text-[#f2f0ea]">📸 <b>{ig.account}</b> <span className="text-[13px] text-[#8a909c]">— tasdiqlangan Instagram postlari shu akkauntga chiqadi</span></p>
          : <p className="text-[13.5px] leading-relaxed text-[#fde2b0]">Instagram ulanmagan{ig.enabled ? <>: <a href={hrefOf('sozlamalar', 'instagram')} className="font-semibold text-[#fde2b0] underline">Sozlamalar → Instagram</a> → «Instagram'ga kirish»</> : " — o'rnatuvchi IG_VIA_BROWSER=1 ni yoqishi kerak"}. Qoralamani hozir ham tayyorlasa bo'ladi.</p>}
      </Panel>
      <Panel title="Rasm chizish">
        <div className="space-y-3">
          <p className="text-[13.5px] leading-relaxed text-[#c9cbd2]">
            {view.picture === 'meta_ai' ? <>Instagram postlari rasmini <b>Meta AI</b> chizadi — akkauntingiz orqali, bepul (kunlik chegara Marketolog savollari bilan bitta).</>
              : view.picture === 'gemini' ? <>Rasmni <b>Gemini</b> chizadi — tez, brend ranglarida (~5 sent). Meta AI ulansa — o'sha chizadi, bepul.</>
              : <>Rasm chizadigan xizmat yo'q — Meta AI'ni ulang yoki postga o'z suratingizni qo'shing.</>}
          </p>
          {(!meta.connected || meta.problem) && <MetaAiConnect status={status} onStatus={onStatus} notify={notify} />}
        </div>
      </Panel>
    </>
  );
}

export function ContentChannel({ view, setView, notify, status, onStatus }: { view: ContentView | null; setView: (v: ContentView) => void; notify: Notify; status: LiveStatus; onStatus: (s: LiveStatus) => void }) {
  const [channel, setChannel] = useState('');
  const [style, setStyle] = useState<string | null>(null);
  const [busy, run] = useRun(notify, setView);
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const s = view.settings;
  const connect = (e: FormEvent) => {
    e.preventDefault();
    void run('connect', () => api.contentChannel(channel), 'Kanal ulandi').then(ok => { if (ok) setChannel(''); });
  };
  return (
    <div className="space-y-5">
      <Panel title="Telegram kanalingiz">
        {s.channelId ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[15px] text-[#f2f0ea]">📢 <b>{s.channelTitle}</b> <span className="text-[13px] text-[#8a909c]">— tasdiqlangan postlar shu yerga chiqadi</span></p>
            <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Kanal uzilsinmi? Qoralamalar qoladi.')) void run('off', () => api.contentChannelOff(), 'Kanal uzildi'); }} className={`${ghost} ml-auto`}>Uzish</button>
          </div>
        ) : !status.bot ? (
          <p className="text-[13.5px] text-[#fde2b0]">Avval Telegram botni ulang: <a href={hrefOf('sozlamalar', 'telegram')} className="font-semibold text-[#fde2b0] underline">Sozlamalar → Telegram</a>.</p>
        ) : (
          <form onSubmit={connect} className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-[#c9cbd2]">
              <li>Telegram'da kanalingizni oching → Boshqaruv → Administratorlar → <b>@{status.bot}</b> ni qo'shing, «Xabar joylash» huquqi bilan.</li>
              <li>Kanal havolasini yozing (yopiq kanal bo'lsa — uning ID'si, -100… bilan boshlanadi).</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="@mening_kanalim" aria-label="Kanal havolasi" className={`${field} min-w-0 flex-1 basis-60`} />
              <button type="submit" disabled={channel.trim().length < 3 || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'connect' && spin} Ulash</button>
            </div>
          </form>
        )}
      </Panel>
      <Panel title="Qanday yozsin">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div role="radiogroup" aria-label="Post tili" className="flex gap-2">
              {(['uz', 'ru'] as const).map(l => (
                <button key={l} type="button" role="radio" aria-checked={s.lang === l} disabled={!!busy} onClick={() => void run('lang', () => api.contentSettings({ lang: l }))}
                  className={`${button} border ${s.lang === l ? 'border-transparent text-[#07080b]' : 'border-glass/10 text-[#c9cbd2] hover:bg-glass/5'}`} style={s.lang === l ? { background: ACCENT } : undefined}>
                  {l === 'uz' ? "O'zbekcha" : 'Русский'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13.5px] text-[#c9cbd2]">Bir martada
              <select value={s.perRun} disabled={!!busy} onChange={e => void run('per', () => api.contentSettings({ perRun: Number(e.target.value) }))} className="rounded-lg border border-glass/10 bg-[#0b0c10] px-2 py-1.5 text-[#f2f0ea]">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select> ta post
            </label>
            <label className="flex items-center gap-2 text-[13.5px] text-[#c9cbd2]">
              <input type="checkbox" checked={s.auto} disabled={!!busy} onChange={e => void run('auto', () => api.contentSettings({ auto: e.target.checked }), e.target.checked ? 'Har kuni ertalab qoralamalar keladi' : undefined)} className="h-4 w-4 accent-[#ffb86b]" />
              Har kuni ertalab o'zi tayyorlasin
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#a3a9b5]">Shu kanal uchun qo'shimcha talablar</span>
            <span className="mb-1.5 block text-[12.5px] text-[#8a909c]">Kompaniyaning ovozi va auditoriyasi — <a href={hrefOf('miya', 'brend')} className="underline">Miya → Brend</a> (hamma xodim shundan oladi). Bu yerda — faqat kanalga xos narsa.</span>
            <textarea value={style ?? s.style} onChange={e => setStyle(e.target.value)} rows={5} maxLength={2000} className={field}
              placeholder="Masalan: «sen» bilan emas, «siz» bilan. Qisqa gaplar. Har postda klinikalar uchun bitta amaliy maslahat. Emoji ko'p bo'lmasin. Oxirida: «Palantir — klinikangiz uchun AI yordamchi»." />
          </label>
          {style !== null && style !== s.style && (
            <button type="button" disabled={!!busy} onClick={() => void run('style', () => api.contentSettings({ style }), 'Uslub saqlandi').then(ok => { if (ok) setStyle(null); })} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>
              {busy === 'style' && spin} Saqlash
            </button>
          )}
        </div>
      </Panel>
      <OtherOutlets view={view} status={status} onStatus={onStatus} notify={notify} />
    </div>
  );
}
