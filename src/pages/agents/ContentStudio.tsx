/**
 * Kontent-meyker → Brend-buk · Reja · Video.
 * Brend-buk — qisqa anketa (bo'sh qolsa ham bo'ladi: AI biznes profilidan oladi) → to'liq brend-tizim (BrandBookView.tsx).
 * Reja — brend-buk ustunlari bo'yicha mavzular; har biridan bir tugma bilan post yoki video.
 * Video — AI ssenariy + diktor (Gemini, zaxira — ElevenLabs) serverda; kadrlar shu yerda (brauzerda) chiziladi va mp4 bo'lib yuklab olinadi.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Clapperboard, Download, FileText, Mic, Palette, Pencil, Play, RotateCcw, Square, Trash2, Wand2 } from 'lucide-react';
import type { BrandAnswers, BrandBook, ContentVideo, VideoScene } from '../../types';
import { BrandBookView } from './BrandBookView';
import { api, type ContentView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';
import { H, W, drawFrame, loadFonts, play, recordMime, specOf, type Playback } from '../../lib/videoRender';
import { ACCENT, button, field, ghost, spin, useRun } from './Content';
import { renderBusy, renderLabel, renderReady, useServerClip } from './VideoServerClip';

type Props = { view: ContentView | null; setView: (v: ContentView) => void; notify: Notify };
const loading = <div className="py-6">{spin}</div>;
const primary = `${button} text-[#07080b]`;
const TONE = { ok: 'bg-emerald-400/15 text-[#a7f3d0]', wait: 'bg-[#f5b454]/15 text-[#fde2b0]', bad: 'bg-[#f87171]/15 text-[#fecaca]' } as const;

// ─── Brend-buk ────────────────────────────────────────────────────────────────

const QUESTIONS: { key: Exclude<keyof BrandAnswers, 'whose'>; label: string; hint: string }[] = [
  { key: 'what', label: 'Nima qilasiz?', hint: 'Masalan: kichik biznesga AI xodim quraman — qabulxona, eslatma, javoblar' },
  { key: 'audience', label: 'Kimga gapirasiz?', hint: 'Masalan: klinika va o\'quv markazi egalari, 30–50 yosh, vaqti yo\'q' },
  { key: 'values', label: 'Nimaga ishonasiz?', hint: 'Masalan: amaliy natija, halollik — «sinalmagan» deb ochiq aytaman' },
  { key: 'tone', label: 'Qanday ovozda?', hint: 'Masalan: qisqa, aniq, «siz» bilan, ozgina hazil' },
  { key: 'avoid', label: 'Nima bo\'lmasin?', hint: 'Masalan: robot rasmlari, «inqilob», va\'dalar' },
  { key: 'look', label: 'Rang yoki uslub istagi', hint: 'Masalan: o\'zbek koshinlari, firuza; yoki «bilmayman — o\'zingiz tanlang»' },
];

function BrandForm({ initial, setView, notify, onDone }: Props & { initial: BrandAnswers; onDone: () => void }) {
  const [a, setA] = useState<BrandAnswers>(initial);
  const [busy, run] = useRun(notify, setView);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('brand', () => api.contentBrand(a), 'Brend-buk tayyor').then(ok => { if (ok) onDone(); });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Kimning brendi" className="flex flex-wrap gap-2">
        {([['company', 'Kompaniya brendi'], ['personal', 'Shaxsiy brendim']] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={a.whose === id} onClick={() => setA({ ...a, whose: id })}
            className={`${button} border ${a.whose === id ? 'border-transparent text-[#07080b]' : 'border-glass/10 text-[#c9cbd2] hover:bg-glass/5'}`} style={a.whose === id ? { background: ACCENT } : undefined}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {QUESTIONS.map(q => (
          <label key={q.key} className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#a3a9b5]">{q.label}</span>
            <textarea value={a[q.key]} onChange={e => setA({ ...a, [q.key]: e.target.value })} rows={2} maxLength={600} placeholder={q.hint} className={field} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!!busy} className={primary} style={{ background: ACCENT }}>
          {busy ? spin : <Wand2 className="h-4 w-4" aria-hidden="true" />} {busy ? 'Yozyapti… (2–3 daqiqa)' : 'Brend-buk yaratish'}
        </button>
        <p className="text-[13px] text-[#8a909c]">Javob bermagan savollarni Palantir biznes profilingizdan o'zi to'ldiradi.</p>
      </div>
    </form>
  );
}

export function ContentBrandTab(props: Props) {
  const [editing, setEditing] = useState(false);
  const { view } = props;
  if (!view) return loading;
  const brand = view.brand;
  const answers: BrandAnswers = brand?.answers ?? { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' };
  if (!brand?.book || editing) {
    return (
      <Panel title={brand?.book ? 'Anketani o\'zgartirish' : 'Brend-buk yaratish'} action={brand?.book ? <button type="button" onClick={() => setEditing(false)} className={ghost}>Bekor</button> : undefined}>
        <p className="mb-4 text-[13.5px] leading-relaxed text-[#a3a9b5]">Brend-buk — postlar va videolar uchun yagona tizim: mohiyat va va'da, auditoriya, xabarlar, ovoz qoidalari va namunalari, ranglar, ilgaklar, formatlar va video diktori. Kontent-meyker har postda shunga tayanadi; videolar shu ranglarda chiziladi.</p>
        <BrandForm {...props} initial={answers} onDone={() => setEditing(false)} />
      </Panel>
    );
  }
  return (
    <Panel title="Brend-buk" action={<button type="button" onClick={() => setEditing(true)} className={ghost}><Pencil className="h-4 w-4" aria-hidden="true" /> Qayta yaratish</button>}>
      <BrandBookView b={brand.book} setView={props.setView} notify={props.notify} />
    </Panel>
  );
}

// ─── Reja ─────────────────────────────────────────────────────────────────────

const COUNTS = [10, 15, 20, 25, 30];

export function ContentPlanTab({ view, setView, notify }: Props) {
  const [count, setCount] = useState(25);
  const [wish, setWish] = useState('');
  const [busy, run] = useRun(notify, setView);
  if (!view) return loading;
  const make = (e: FormEvent) => {
    e.preventDefault();
    if (view.plan.length && !window.confirm('Yangi reja eskisini almashtiradi (post yoki video yozilgan mavzular qoladi). Davom etilsinmi?')) return;
    void run('plan', () => api.contentPlan(count, wish), view.brand?.book ? 'Reja tayyor' : 'Brend-buk va reja tayyor — brend-bukni ham ko\'rib chiqing');
  };
  return (
    <div className="space-y-5">
      <Panel title="Kontent reja">
        <form onSubmit={make} className="space-y-3">
          {!view.brand?.book && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">Brend-buk hali yo'q — reja bilan birga biznes profilingizdan o'zi yoziladi. Aniqroq bo'lishi uchun avval <a href={hrefOf('marketolog', 'brend')} className="font-semibold underline">Brend-buk</a> anketasini to'ldirsangiz yaxshi.</p>}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-[13.5px] text-[#c9cbd2]">
              <select value={count} onChange={e => setCount(Number(e.target.value))} className="rounded-lg border border-glass/10 bg-[#0b0c10] px-2 py-1.5 text-[#f2f0ea]">
                {COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
              </select> ta mavzu
            </label>
            <input value={wish} onChange={e => setWish(e.target.value)} maxLength={600} placeholder="Nimaga urg'u bersin (ixtiyoriy): masalan, DentaCRM'ni ham ko'rsatsin" aria-label="Reja istagi" className={`${field} min-w-0 flex-1 basis-72`} />
            <button type="submit" disabled={!!busy || view.busy} className={primary} style={{ background: ACCENT }}>{busy === 'plan' ? spin : <Wand2 className="h-4 w-4" aria-hidden="true" />} {busy === 'plan' ? 'Tuzyapti… (2 daqiqagacha)' : 'Reja tuzish'}</button>
          </div>
        </form>
      </Panel>
      <Panel title={view.plan.length ? `Mavzular (${view.plan.length})` : 'Mavzular'}>
        {!view.plan.length ? <Quiet>Hali reja yo'q. «Reja tuzish»ni bosing yoki Yordamchiga ayting: «menga 25 ta post rejasini tuz».</Quiet> : (
          <ol className="flex flex-col gap-2.5">
            {view.plan.map(p => (
              <li key={p.id} className="rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="w-7 shrink-0 text-right text-[14px] font-bold tabular-nums text-[#7d838f]">{p.n}.</span>
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="text-[14.5px] font-semibold text-[#f2f0ea]">{p.title}</p>
                    {p.angle && <p className="mt-1 text-[13px] leading-relaxed text-[#a3a9b5]">{p.angle}</p>}
                    <span className="mt-2 inline-block rounded-full bg-glass/[0.06] px-2.5 py-0.5 text-[12px] text-[#c9cbd2]">{p.pillar}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.draftId
                      ? <a href={hrefOf('marketolog', 'qoralamalar')} className={ghost}><FileText className="h-4 w-4" aria-hidden="true" /> Post tayyor</a>
                      : <button type="button" disabled={!!busy || view.busy} onClick={() => void run(`d${p.id}`, () => api.contentPlanDraft(p.id), "Post qoralamasi tayyor — Telegram'ga ham yuborildi")} className={ghost}>{busy === `d${p.id}` ? spin : <FileText className="h-4 w-4" aria-hidden="true" />} Post</button>}
                    {p.videoId
                      ? <a href={hrefOf('marketolog', 'video')} className={ghost}><Clapperboard className="h-4 w-4" aria-hidden="true" /> Video bor</a>
                      : <button type="button" disabled={!!busy || view.busy || !view.brand?.book} onClick={() => void run(`v${p.id}`, () => api.contentPlanVideo(p.id), 'Video ssenariysi tayyor — «Video» varag\'ida')} className={ghost}>{busy === `v${p.id}` ? spin : <Clapperboard className="h-4 w-4" aria-hidden="true" />} Video</button>}
                    {!p.draftId && !p.videoId && <button type="button" disabled={!!busy} onClick={() => void run(`x${p.id}`, () => api.contentPlanRemove(p.id))} aria-label={`${p.n}-mavzuni o'chirish`} className={`${button} text-[#a3a9b5] hover:bg-glass/5`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

// ─── Video ────────────────────────────────────────────────────────────────────

const KIND: Record<VideoScene['kind'], string> = { hook: 'Ilgak', point: 'Fikr', claim: "Da'vo", sign: 'Imzo' };
const fileName = (topic: string, mime: string) =>
  `${topic.toLowerCase().replace(/[^a-z0-9Ѐ-ӿ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video'}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;

function SceneEditor({ v, setView, notify, onDone }: Omit<Props, 'view'> & { v: ContentVideo; onDone: () => void }) {
  const [scenes, setScenes] = useState(v.scenes);
  const [busy, run] = useRun(notify, setView);
  const set = (i: number, patch: Partial<VideoScene>) => setScenes(scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      {scenes.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-glass/[0.06] p-3 md:grid-cols-[90px_1fr_1.4fr]">
          <span className="pt-2 text-[12.5px] font-semibold text-[#8a909c]">{i + 1}. {KIND[s.kind]}</span>
          <input value={s.text} onChange={e => set(i, { text: e.target.value })} maxLength={48} aria-label={`${i + 1}-sahna yozuvi`} className={field} />
          <textarea value={s.voice} onChange={e => set(i, { voice: e.target.value })} maxLength={240} rows={2} aria-label={`${i + 1}-sahna diktor gapi`} className={field} />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" disabled={!!busy} onClick={() => void run('save', () => api.contentVideoEdit(v.id, scenes), "Saqlandi — endi ovozni qayta yozdiring").then(ok => { if (ok) onDone(); })} className={primary} style={{ background: ACCENT }}>{busy && spin} Saqlash</button>
        <button type="button" onClick={onDone} className={ghost}>Bekor</button>
      </div>
    </div>
  );
}

function VideoCard({ v, book, voice, setView, notify }: Omit<Props, 'view'> & { v: ContentVideo; book: BrandBook; voice: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<ArrayBuffer | null>(null);
  const playing = useRef<Playback | null>(null);
  const exporting = useRef<AbortController | null>(null);
  /** Ikki marta bosilsa ikkinchi ijro boshlanmasin (ovoz yuklanayotgan paytda ham) */
  const starting = useRef(false);
  const [mode, setMode] = useState<'idle' | 'play' | 'record' | 'export'>('idle');
  const [progress, setProgress] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, run] = useRun(notify, setView);
  const spec = specOf(book, v);
  const ready = v.status === 'voiced';
  const canSave = typeof VideoEncoder !== 'undefined' || !!recordMime();
  /** mp4 serverda yig'iladi (HyperFrames) — bo'lmasa eski yo'l: panel o'zi chizadi va brauzerda yig'adi */
  const server = !!v.render?.available;
  const sc = useServerClip(v);
  const rBusy = renderBusy(v), rReady = renderReady(v);
  const label = ready ? renderLabel(v) : null;

  // Muqova — videoning birinchi kadri (lentada ham shu ko'rinadi)
  useEffect(() => {
    let live = true;
    void loadFonts().catch(() => undefined).then(() => {
      const ctx = canvas.current?.getContext('2d');
      if (live && ctx && !playing.current) drawFrame(ctx, spec, 0);
    });
    return () => { live = false; };
  }, [v.id, v.status, JSON.stringify(v.scenes), JSON.stringify(book.colors), book.font]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ijro, yozuv yoki yig'ish faqat karta yopilganda to'xtaydi (boshqa kartadagi amal ko'rinishni yangilasa — davom etadi)
  useEffect(() => () => { playing.current?.stop(); exporting.current?.abort(); }, []);

  const saveServer = () => void sc.file().then(b => { save(b); notify('Video yuklab olindi (mp4)'); }).catch(e => notify((e as Error).message, true));

  const save = (blob: Blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName(v.topic, blob.type);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  /** mp4: kadrlar birma-bir kodlanadi (WebCodecs) — tez va kadr tushib qolmaydi; brauzer bilmasa — real vaqt yozuvi */
  const download = async () => {
    if (starting.current) return;
    // Darhol band: modul yuklanayotganda ikkinchi bosish ikkinchi yig'ishni boshlamasin
    starting.current = true;
    const x = await import('../../lib/videoExport').catch(() => null);
    if (!x || !(await x.canExport())) { starting.current = false; void start(true); return; }
    setMode('export');
    const ac = new AbortController();
    exporting.current = ac;
    try {
      audio.current ??= await api.contentVideoAudio(v.id);
      let shown = 0;
      const blob = await x.exportMp4(spec, audio.current, p => { if (p - shown >= 0.01 || p === 1) { shown = p; setProgress(p); } }, ac.signal);
      save(blob);
      notify('Video yuklab olindi (mp4)');
    } catch (e) {
      notify(e instanceof x.ExportCancelled ? "Yig'ish to'xtatildi — video saqlanmadi" : `Video yig'ilmadi: ${(e as Error).message}`, !(e instanceof x.ExportCancelled));
    } finally {
      exporting.current = null;
      starting.current = false;
      setMode('idle');
      setProgress(0);
    }
  };

  const start = async (record: boolean) => {
    if (starting.current) return;
    starting.current = true;
    setMode(record ? 'record' : 'play');
    try {
      audio.current ??= await api.contentVideoAudio(v.id);
      if (!canvas.current) return;
      const p = play(canvas.current, spec, audio.current, record, (t, total) => setProgress(t / total));
      playing.current = p;
      const blob = await p.done;
      if (!blob && record) notify("Yozuv to'xtatildi — video saqlanmadi");
      if (blob) {
        save(blob);
        notify(blob.type.includes('mp4') ? 'Video yuklab olindi (mp4)' : 'Video yuklab olindi (webm — Instagram uchun mp4 kerak bo\'lsa, Chrome\'ning yangi versiyasida oching)');
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      playing.current = null;
      starting.current = false;
      setMode('idle');
      setProgress(0);
    }
  };

  return (
    <li className="rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap gap-5">
        <div className="w-[180px] shrink-0 sm:w-[216px]">
          {sc.clip ? <video src={sc.clip} controls autoPlay playsInline className="w-full rounded-xl border border-glass/10 bg-black" style={{ aspectRatio: `${W} / ${H}` }} aria-label="Video" />
            : sc.poster ? <img src={sc.poster} alt="Video muqovasi" className="w-full rounded-xl border border-glass/10" style={{ aspectRatio: `${W} / ${H}` }} />
              : <canvas ref={canvas} width={W} height={H} className="w-full rounded-xl border border-glass/10" style={{ aspectRatio: `${W} / ${H}` }} aria-label="Video ko'rinishi" />}
          {rBusy && <div className="mt-2 h-1.5 rounded-full bg-glass/10" role="progressbar" aria-label="Video yig'ilmoqda" aria-valuenow={v.render?.progress ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="h-1.5 rounded-full transition-[width]" style={{ width: `${Math.max(3, v.render?.progress ?? 0)}%`, background: ACCENT }} /></div>}
          {mode !== 'idle' && <div className="mt-2 h-1.5 rounded-full bg-glass/10" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-1.5 rounded-full" style={{ width: `${progress * 100}%`, background: ACCENT }} /></div>}
        </div>
        <div className="min-w-0 flex-1 basis-72 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${label ? TONE[label.tone] : v.status === 'failed' ? TONE.bad : TONE.wait}`}>
              {label ? label.text : v.status === 'failed' ? 'Ovoz yozilmadi' : 'Ovoz kutyapti'}
            </span>
            <span className="truncate text-[13px] text-[#a3a9b5]">{v.topic.split('\n')[0]}</span>
          </div>
          {v.error && v.status === 'failed' && <p className="rounded-xl bg-[#f87171]/10 p-3 text-[13px] text-[#fecaca]">{v.error}</p>}
          {ready && v.render?.phase === 'failed' && v.render.error && <p className="rounded-xl bg-[#f87171]/10 p-3 text-[13px] text-[#fecaca]">{v.render.error}</p>}
          {editing ? <SceneEditor v={v} setView={setView} notify={notify} onDone={() => setEditing(false)} /> : (
            <ol className="space-y-1.5 text-[13.5px] leading-relaxed">
              {v.scenes.map((s, i) => <li key={i}><span className="font-semibold text-[#8a909c]">{KIND[s.kind]}:</span> <span className="text-[#f2f0ea]">«{s.text}»</span> <span className="text-[#a3a9b5]">— {s.voice}</span></li>)}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            {ready && mode === 'idle' && server && <>
              {rReady && !sc.clip && <button type="button" onClick={() => void sc.watch().catch(e => notify((e as Error).message, true))} className={ghost}><Play className="h-4 w-4" aria-hidden="true" /> Ko'rish</button>}
              {v.render?.phase === 'stale' && <button type="button" disabled={!!busy} onClick={() => void run('render', () => api.contentVideoRender(v.id), "Video yangilanmoqda — bir necha daqiqa")} className={primary} style={{ background: ACCENT }}>{busy === 'render' ? spin : <RotateCcw className="h-4 w-4" aria-hidden="true" />} Videoni yangilash</button>}
              {rReady && <button type="button" onClick={saveServer} className={v.render?.phase === 'done' ? primary : ghost} style={v.render?.phase === 'done' ? { background: ACCENT } : undefined}><Download className="h-4 w-4" aria-hidden="true" /> Yuklab olish (mp4)</button>}
              {(v.render?.phase === 'none' || v.render?.phase === 'failed') && <button type="button" disabled={!!busy} onClick={() => void run('render', () => api.contentVideoRender(v.id), "Video yig'ilmoqda — bir necha daqiqa")} className={primary} style={{ background: ACCENT }}>{busy === 'render' ? spin : <Clapperboard className="h-4 w-4" aria-hidden="true" />} {v.render?.phase === 'failed' ? 'Qayta yasash' : 'Video yasash'}</button>}
            </>}
            {ready && mode === 'idle' && !server && <>
              <button type="button" onClick={() => void start(false)} className={ghost}><Play className="h-4 w-4" aria-hidden="true" /> Ko'rish</button>
              <button type="button" onClick={() => void download()} disabled={!canSave} title={canSave ? undefined : "Bu brauzer video yig'a olmaydi — Chrome yoki Edge'da oching"} className={primary} style={{ background: ACCENT }}><Download className="h-4 w-4" aria-hidden="true" /> Yuklab olish (mp4)</button>
            </>}
            {ready && mode === 'idle' && <>
              <button type="button" disabled={!!busy || !voice || rBusy} onClick={() => void run('voice', () => api.contentVideoVoice(v.id), 'Ovoz qayta yozildi')} title="Diktorni almashtirgan bo'lsangiz — yangi ovoz bilan qayta o'qitish" className={ghost}>{busy === 'voice' ? spin : <RotateCcw className="h-4 w-4" aria-hidden="true" />} Qayta ovoz</button>
            </>}
            {mode !== 'idle' && <button type="button" onClick={() => { playing.current?.stop(); exporting.current?.abort(); }} className={ghost}><Square className="h-4 w-4" aria-hidden="true" /> To'xtatish{mode !== 'play' ? ' (video saqlanmaydi)' : ''}</button>}
            {!ready && mode === 'idle' && <button type="button" disabled={!!busy || !voice} title={voice ? undefined : "Avval Gemini kalitini kiriting (Sozlamalar → Kalitlar)"} onClick={() => void run('voice', () => api.contentVideoVoice(v.id), 'Ovoz tayyor')} className={primary} style={{ background: ACCENT }}>{busy === 'voice' ? spin : v.status === 'failed' ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />} {v.status === 'failed' ? 'Qayta urinish' : 'Ovoz yozdirish'}</button>}
            {!editing && mode === 'idle' && <button type="button" onClick={() => setEditing(true)} className={ghost}><Pencil className="h-4 w-4" aria-hidden="true" /> Ssenariy</button>}
            {mode === 'idle' && <button type="button" disabled={!!busy} onClick={() => { if (window.confirm("Video o'chirilsinmi?")) void run('rm', () => api.contentVideoRemove(v.id)); }} aria-label="Videoni o'chirish" className={`${button} text-[#a3a9b5] hover:bg-glass/5`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
          </div>
          {mode === 'record' && <p className="text-[12.5px] text-[#8a909c]">Yozilyapti — video uzunligicha vaqt ketadi. Bu varaqni yopmang va boshqa varaqqa o'tmang.</p>}
          {rBusy && <p className="text-[12.5px] text-[#8a909c]" aria-live="polite">Video shu kompyuterda yig'ilmoqda{v.render?.phase === 'rendering' ? ` — ${v.render.progress}%` : ' (navbatda)'}. Odatda 2–4 daqiqa; panelni yopsangiz ham davom etadi.</p>}
          {mode === 'export' && <p className="text-[12.5px] text-[#8a909c]" aria-live="polite">Yig'ilyapti — {Math.round(progress * 100)}%. Odatda video uzunligidan tezroq; varaqni yopmang.</p>}
        </div>
      </div>
    </li>
  );
}

export function ContentVideoTab({ view, setView, notify }: Props) {
  const [topic, setTopic] = useState('');
  const [busy, run] = useRun(notify, setView);
  // Video serverda yig'ilayotgan bo'lsa — holat har 2,5 soniyada yangilanadi
  const rendering = !!view?.videos.some(renderBusy);
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => { void api.content().then(setView).catch(() => undefined); }, 2500);
    return () => clearInterval(t);
  }, [rendering, setView]);
  if (!view) return loading;
  const book = view.brand?.book;
  const make = (e: FormEvent) => {
    e.preventDefault();
    void run('make', () => api.contentVideo(topic), 'Ssenariy tayyor').then(ok => { if (ok) setTopic(''); });
  };
  return (
    <div className="space-y-5">
      <Panel title="Video tayyorlash">
        {!book ? (
          <p className="text-[13.5px] text-[#fde2b0]"><Palette className="mr-1 inline h-4 w-4" aria-hidden="true" />Video brend-buk ranglarida chiziladi — avval <a href={hrefOf('marketolog', 'brend')} className="font-semibold underline">Brend-buk</a> yarating.</p>
        ) : (
          <form onSubmit={make} className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-[#a3a9b5]">9:16, 20–35 soniya: Kontent-meyker ssenariy yozadi, diktor ({view.voiceBy === 'elevenlabs' ? 'ElevenLabs' : <>brend-bukdagi ovoz — <b className="text-[#e4e3de]">{book.narrator}</b></>}) o'qiydi, video brendingiz uslubida — kinetik matn, so'zma-so'z subtitr, sahna o'tishlari bilan shu kompyuterda mp4 bo'lib yig'iladi.</p>
            {!view.voice && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">Ovoz uchun Gemini kaliti kerak: <a href="#/ulash" className="font-semibold underline">Ulash → Kalitlar</a> → «Gemini kaliti» (aistudio.google.com, bepul ochiladi). Kalitsiz ham ssenariy yoziladi.</p>}
            <div className="flex flex-wrap gap-2">
              <input value={topic} onChange={e => setTopic(e.target.value)} maxLength={600} placeholder="Mavzu: masalan, AI xodim — bu chatbot emas" aria-label="Video mavzusi" className={`${field} min-w-0 flex-1 basis-72`} />
              <button type="submit" disabled={topic.trim().length < 5 || !!busy || view.busy} className={primary} style={{ background: ACCENT }}>{busy === 'make' ? spin : <Clapperboard className="h-4 w-4" aria-hidden="true" />} {busy === 'make' ? 'Yozyapti…' : 'Video tayyorlash'}</button>
            </div>
            <p className="text-[12.5px] text-[#7d838f]">Mavzuni <a href={hrefOf('marketolog', 'reja')} className="underline">Reja</a>dan ham tanlash mumkin.</p>
          </form>
        )}
      </Panel>
      <Panel title="Videolar">
        {!view.videos.length || !book ? <Quiet>Hali video yo'q.</Quiet> : (
          <ul className="flex flex-col gap-3">{view.videos.map(v => <VideoCard key={`${v.id}-${v.status}-${v.duration}-${v.starts.join(',')}-${v.scenes.map(s => s.text).join('|')}-${renderReady(v)}`} v={v} book={book} voice={view.voice} setView={setView} notify={notify} />)}</ul>
        )}
      </Panel>
    </div>
  );
}
