import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Brain, Loader2, Mic, RotateCcw, Send, Square } from 'lucide-react';
import type { Artifact, Business, ChatEntry, LiveStatus } from '../types';
import { api } from '../data/api';
import { ArtifactView, type Notify } from '../components/Artifacts';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/ui';
import { startRecording, type Recording } from '../lib/recorder';

const SUGGESTIONS = [
  'Bugun nima qilishim kerak?',
  "Ertaga soat 10 da bankka borishni eslat",
  "Yangi mijoz: Aziz Karimov, +998 90 123 45 67, narx so'radi",
  'Hamkorlik shartnomasi tayyorla',
  'Dam olish kunlari aksiyasi haqida post qil',
  "Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla",
];

const time = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

export function ChatPage({ biz, status, notify, now }: { biz: Business; status: LiveStatus; notify: Notify; now: Date }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pending !== null;

  const load = () => api.chat().then(r => setEntries(r.entries)).catch(e => notify((e as Error).message, true));
  useEffect(() => { void load(); }, []);
  // Telegram'dagi suhbat ham shu yerda ko'rinsin
  useEffect(() => {
    if (busy) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [entries?.length, pending]);

  const submit = async (value: string, voice?: Blob) => {
    const clean = value.trim();
    if ((!clean && !voice) || busy) return;
    setPending(voice ? '🎙 …' : clean);
    setText('');
    try {
      const r = voice ? await api.sayVoice(voice) : await api.say(clean);
      setEntries(prev => [...(prev ?? []), ...r.entries]);
    } catch (e) {
      notify((e as Error).message, true);
      if (!voice) setText(clean);
    } finally {
      setPending(null);
      input.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(text);
    }
  };

  const toggleMic = async () => {
    if (rec) {
      setRec(null);
      try { await submit('', await rec.stop()); } catch { notify("Ovoz yozilmadi", true); }
      return;
    }
    try { setRec(await startRecording()); } catch { notify('Mikrofonga ruxsat berilmadi', true); }
  };

  const reset = async () => {
    await api.resetChat().catch(() => {});
    notify("Yangi suhbat: oldingi gaplar unutildi, vazifa va mijozlar joyida");
  };

  const replaceArtifact = (entryId: string, index: number, a: Artifact) =>
    setEntries(prev => prev?.map(e => (e.id === entryId ? { ...e, artifacts: e.artifacts.map((x, i) => (i === index ? a : x)) } : e)) ?? prev);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Yordamchi</h1>
          <p className="text-sm text-slate-500">Yozing yoki gapiring — vazifa, mijoz, hujjat, post. Telegram'dagi suhbat ham shu yerda.</p>
        </div>
        {!status.ai && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">AI ulanmagan</span>}
        {status.bot && !status.ownerLinked && (
          <a href="#/telegram" className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200">Telegram'ni ulang — eslatmalar u yerga keladi →</a>
        )}
        <Button size="sm" variant="ghost" onClick={reset} title="Suhbatni yangidan boshlash"><RotateCcw className="h-3.5 w-3.5" /> Yangi suhbat</Button>
      </header>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-live="polite">
        {entries === null ? (
          <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : entries.length === 0 && !pending ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow"><Brain className="h-7 w-7" /></div>
            <h2 className="text-xl font-extrabold">Assalomu alaykum{biz.ownerName ? `, ${biz.ownerName}` : ''}!</h2>
            <p className="mt-1 text-sm text-slate-500">Men — Cerebro. Ishingizni ayting, qolganini o'zim qilaman.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => void submit(s)} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {entries.map(e => (
              <div key={e.id} className={`flex ${e.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] space-y-2 ${e.role === 'owner' ? 'items-end' : ''}`}>
                  <div className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${e.role === 'owner' ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-900'}`}>
                    {e.role === 'owner' ? <p className="whitespace-pre-line">{e.text}</p> : <Markdown text={e.text} />}
                  </div>
                  {e.artifacts.map((a, i) => (
                    <ArtifactView key={i} a={a} biz={biz} channel={status.channel?.title ?? null} notify={notify} now={now} onChange={x => replaceArtifact(e.id, i, x)} />
                  ))}
                  <div className={`text-[11px] text-slate-400 ${e.role === 'owner' ? 'text-right' : ''}`}>{time(e.createdAt)}{e.channel === 'telegram' ? ' · Telegram' : ''}</div>
                </div>
              </div>
            ))}
            {pending && (
              <>
                <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600/80 px-4 py-2.5 text-[15px] text-white"><p className="whitespace-pre-line">{pending}</p></div></div>
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cerebro ishlayapti…</div>
              </>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={e => { e.preventDefault(); void submit(text); }} className="mt-3 flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-indigo-400">
        <textarea
          ref={input}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          placeholder={rec ? 'Gapiring… tugatgach ■ ni bosing' : 'Yozing yoki mikrofonni bosib gapiring…'}
          aria-label="Xabar"
          disabled={busy || !!rec}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-slate-400"
        />
        {status.voice && (
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy}
            aria-label={rec ? "Yozishni tugatish va yuborish" : 'Ovoz bilan aytish'}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${rec ? 'animate-pulse bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-100'} disabled:opacity-40`}
          >
            {rec ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()} aria-label="Yuborish" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
