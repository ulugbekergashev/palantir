/**
 * Marketolog → Postlar: yangi post (egasining surati yoki Meta AI chizadi; matnni o'zi yozadi yoki Marketolog yozib beradi),
 * qoralamalar va joylanganlar. Instagram'ga faqat egasi «Joylash»ni bosganda chiqadi (Telegram kartasida ham shu tugma).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, ImagePlus, Loader2, Send, Sparkles, Wand2, X } from 'lucide-react';
import type { LiveStatus, PostView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';

const MAX_CAPTION = 2200;
const MAX_SIDE = 2048;

/** Telefondagi katta suratni yuborishdan oldin kichraytiradi (JPEG) */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  const g = canvas.getContext('2d')!;
  // Shaffof PNG JPEG'da qora bo'lib qolmasin
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}

const STATUS: Record<PostView['status'], { label: string; cls: string }> = {
  drawing: { label: 'Meta AI chizyapti…', cls: 'bg-[#a78bfa]/15 text-[#d9ccff]' },
  draft: { label: 'Tasdiqingizni kutyapti', cls: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  publishing: { label: 'Joylanyapti…', cls: 'bg-[#3fb6ff]/15 text-[#bfe6ff]' },
  published: { label: 'Joylandi', cls: 'bg-emerald-400/15 text-[#a7f3d0]' },
  failed: { label: 'Joylanmadi', cls: 'bg-[#f87171]/15 text-[#fecaca]' },
  unknown: { label: "Natija noma'lum — Instagram'da tekshiring", cls: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-glass/10 text-[#a3a9b5]' },
};

function PostImage({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, stale = false;
    api.postImage(id).then(b => { if (stale) return; url = URL.createObjectURL(b); setSrc(url); }).catch(() => {});
    return () => { stale = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src
    ? <img src={src} alt={alt} className="aspect-[4/5] w-full rounded-xl object-cover sm:w-44" />
    : <span className="block aspect-[4/5] w-full animate-pulse rounded-xl bg-glass/[0.05] sm:w-44" aria-hidden="true" />;
}

const field = 'w-full rounded-xl border border-glass/10 bg-glass/[0.03] px-3.5 py-2.5 text-[14.5px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f] focus:border-glass/25';
const button = 'inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-opacity disabled:opacity-40';

function NewPost({ status, notify, onCreated }: { status: LiveStatus; notify: Notify; onCreated: () => void }) {
  const [mode, setMode] = useState<'photo' | 'meta'>(status.metaAi.connected ? 'meta' : 'photo');
  const [image, setImage] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<'caption' | 'save' | null>(null);
  const meta = status.metaAi.connected && !status.metaAi.problem;

  const write = async () => {
    const topic = (caption || description).trim();
    if (topic.length < 3) return notify("Avval mavzuni yozing — masalan, «implant bo'yicha bepul konsultatsiya»", true);
    setBusy('caption');
    try { setCaption((await api.postCaption(topic)).caption); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      if (mode === 'photo') await api.postPhoto(caption, image!);
      else await api.postMeta(caption, description);
      notify(mode === 'photo' ? "Qoralama tayyor — Telegram'ga ham yuborildi" : "Meta AI rasm chizyapti — tayyor bo'lgach Telegram'ga keladi");
      setImage(null); setDescription(''); setCaption('');
      onCreated();
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(null); }
  };
  const ready = caption.trim() && (mode === 'photo' ? !!image : description.trim().length >= 10 && meta);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Rasm" className="flex flex-wrap gap-2">
        {([['meta', "Meta AI chizsin", Sparkles], ['photo', "O'z suratim", ImagePlus]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
            className={`${button} border ${mode === id ? 'border-transparent text-[#07080b]' : 'border-glass/10 text-[#c9cbd2] hover:bg-glass/5'}`} style={mode === id ? { background: HUE.marketolog.a } : undefined}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      {mode === 'meta' ? (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-[#a3a9b5]">Rasmda nima bo'lsin</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={1000} className={field}
            placeholder="Masalan: yorug' stomatologiya kabineti, shifokor bemorga tabassum bilan tushuntiryapti, oq va havorang ranglar" />
          {!meta && <span className="mt-1.5 block text-[12.5px] text-[#fde2b0]">Meta AI ulanmagan — «Ulash» varag'ida ulang yoki o'z suratingizni qo'shing.</span>}
        </label>
      ) : (
        <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-glass/15 p-4 hover:bg-glass/[0.03]">
          {image ? <img src={image} alt="Tanlangan surat" className="h-24 w-20 rounded-lg object-cover" /> : <ImagePlus className="h-8 w-8 text-[#7d838f]" aria-hidden="true" />}
          <span className="text-[14px] text-[#c9cbd2]">{image ? 'Boshqa surat tanlash' : "Surat tanlang (JPG yoki PNG) — Instagram o'lchamiga o'zi keltiriladi"}</span>
          <input type="file" accept="image/*" className="sr-only" onChange={async e => {
            const f = e.target.files?.[0];
            // Shu suratni qayta tanlasa ham ishlasin
            e.target.value = '';
            if (!f) return;
            try { setImage(await shrink(f)); } catch { notify("Surat o'qilmadi — boshqasini tanlang", true); }
          }} />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-[#a3a9b5]">Post matni <span className="font-normal tabular-nums text-[#7d838f]">{caption.length}/{MAX_CAPTION}</span></span>
        <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={6} maxLength={MAX_CAPTION} className={field}
          placeholder="Matnni yozing yoki mavzuni yozib, «Marketolog yozsin»ni bosing" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void write()} disabled={!!busy} className={`${button} border border-glass/10 text-[#c9cbd2] hover:bg-glass/5`}>
          {busy === 'caption' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />} Marketolog yozsin
        </button>
        <button type="submit" disabled={!ready || !!busy} className={`${button} text-[#07080b]`} style={{ background: HUE.marketolog.a }}>
          {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Qoralama tayyorlash
        </button>
      </div>
      <p className="text-[12.5px] text-[#7d838f]">Qoralama Telegram'ga ham keladi. Instagram'ga faqat siz «Joylash»ni bosganda chiqadi.</p>
    </form>
  );
}

function PostCard({ p, notify, onPosts }: { p: PostView; notify: Notify; onPosts: (list: PostView[]) => void }) {
  const [text, setText] = useState(p.caption);
  const [busy, setBusy] = useState<string | null>(null);
  const editable = p.status === 'draft' || p.status === 'failed';
  const unknown = p.status === 'unknown';
  const canPublish = p.hasImage && (editable || unknown);
  const act = async (what: string, fn: () => Promise<{ posts: PostView[] }>, done?: string) => {
    setBusy(what);
    try { onPosts((await fn()).posts); if (done) notify(done); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const s = STATUS[p.status];
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4 sm:flex-row">
      {p.status === 'drawing'
        ? <span className="flex aspect-[4/5] w-full items-center justify-center rounded-xl bg-glass/[0.04] sm:w-44"><Loader2 className="h-6 w-6 animate-spin text-[#d9ccff]" aria-label="Rasm chizilmoqda" /></span>
        : !p.hasImage ? <span className="flex aspect-[4/5] w-full items-center justify-center rounded-xl border border-dashed border-glass/10 text-[12px] text-[#7d838f] sm:w-44">rasm yo'q</span>
        : <PostImage id={p.id} alt={p.prompt ? `Meta AI rasmi: ${p.prompt}` : 'Post rasmi'} />}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
          {p.source === 'meta_ai' && <span className="text-[12px] text-[#7d838f]">rasm — Meta AI</span>}
          <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{new Date(p.publishedAt ?? p.createdAt).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {editable
          ? <textarea aria-label="Post matni" value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={MAX_CAPTION} className={field} />
          : <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#e4e3de]">{p.caption}</p>}
        {p.warnings.length > 0 && editable && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">⚠️ Reklama filtri: {p.warnings.join('; ')}</p>}
        {p.error && (p.status === 'failed' || unknown) && <p className="rounded-xl bg-[#f87171]/10 p-3 text-[13px] text-[#fecaca]">{p.error}</p>}
        <div className="flex flex-wrap gap-2">
          {editable && text.trim() !== p.caption && (
            <button type="button" disabled={!!busy} onClick={() => void act('save', () => api.postEdit(p.id, text), "Matn saqlandi — Telegram'ga yangi karta yuborildi")} className={`${button} border border-glass/10 text-[#c9cbd2] hover:bg-glass/5`}>
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Matnni saqlash
            </button>
          )}
          {canPublish && (
            <button type="button" disabled={!!busy || (editable && text.trim() !== p.caption)} title={text.trim() !== p.caption ? 'Avval matnni saqlang' : undefined}
              onClick={() => {
                if (unknown && !window.confirm("Oldingi urinishda post Instagram'da chiqqan bo'lishi mumkin. Instagram'ni ochib tekshirdingizmi va post chiqmaganmi? Qayta joylansinmi?")) return;
                void act('publish', () => api.postPublish(p.id, unknown), "Instagram'ga joylandi");
              }} className={`${button} text-[#07080b]`} style={{ background: HUE.marketolog.a }}>
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} {p.status === 'failed' ? 'Qayta joylash' : unknown ? "Chiqmagan — qayta joylash" : "Instagram'ga joylash"}
            </button>
          )}
          {(editable || unknown) && (
            <button type="button" disabled={!!busy} onClick={() => { if (window.confirm(unknown ? "Instagram'da post chiqqan bo'lsa, bu yozuvni yopish uchun «Bekor» qiling. Yopilsinmi?" : 'Qoralama bekor qilinsinmi?')) void act('cancel', () => api.postCancel(p.id)); }} className={`${button} text-[#a3a9b5] hover:bg-glass/5`}>
              <X className="h-4 w-4" aria-hidden="true" /> Bekor
            </button>
          )}
          {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className={`${button} border border-glass/10 text-[#c9cbd2] no-underline hover:bg-glass/5`}><ExternalLink className="h-4 w-4" aria-hidden="true" /> Instagram'da ochish</a>}
        </div>
      </div>
    </li>
  );
}

export function MarketingPosts({ status, notify, tick }: { status: LiveStatus; notify: Notify; tick: number }) {
  const [list, setList] = useState<PostView[] | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let stale = false;
    api.posts().then(r => { if (!stale) setList(r.posts); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  // Meta AI chizayotgan yoki joylanayotgan post bo'lsa — holat o'zi yangilanadi
  const pending = list?.some(p => p.status === 'drawing' || p.status === 'publishing');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setRev(n => n + 1), 5000);
    return () => clearInterval(t);
  }, [pending]);

  const ig = status.instagram;
  return (
    <div className="space-y-5">
      {!ig.account && (
        <p className="rounded-2xl bg-[#f5b454]/10 p-4 text-[13.5px] leading-relaxed text-[#fde2b0]">
          Instagram'ga joylash uchun akkauntingiz brauzer orqali ulangan bo'lishi kerak{ig.enabled ? <>: <a href={hrefOf('sozlamalar', 'instagram')} className="font-semibold text-[#fde2b0] underline">Sozlamalar → Instagram</a> → «Instagram'ga kirish»</> : " — o'rnatuvchi .env'da IG_VIA_BROWSER=1 ni yoqishi kerak"}. Qoralamani hozir ham tayyorlasa bo'ladi.
        </p>
      )}
      <Panel title="Yangi post"><NewPost status={status} notify={notify} onCreated={() => setRev(n => n + 1)} /></Panel>
      <Panel title="Postlar">
        {list === null ? <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />
          : !list.length ? <Quiet>Hali post yo'q. Yuqorida tayyorlang yoki Marketologga ayting: «Ertangi kun uchun implant haqida post tayyorla».</Quiet>
            : <ul className="flex flex-col gap-3">{list.map(p => <PostCard key={`${p.id}-${p.status}-${p.caption}`} p={p} notify={notify} onPosts={setList} />)}</ul>}
      </Panel>
    </div>
  );
}
