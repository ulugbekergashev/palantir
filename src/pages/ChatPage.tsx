import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Mic, Paperclip, RotateCcw, Send, Square } from 'lucide-react';
import type { Artifact, Business, ChatEntry, LiveStatus } from '../types';
import { api } from '../data/api';
import { ArtifactView, type Notify } from '../components/Artifacts';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/ui';
import { takeAsk } from '../lib/ask';
import { sectionFor } from '../lib/commands';
import { startRecording, type Recording } from '../lib/recorder';

const SUGGESTIONS = [
  'Bugun nima qilishim kerak?',
  "Ertaga soat 10 da bankka borishni eslat",
  "Yangi mijoz: Aziz Karimov, +998 90 123 45 67, narx so'radi",
  'Hamkorlik shartnomasi tayyorla',
  "Narxnomani (Excel, Word, PDF) skrepka bilan tashlang — o'qib, bilimga qo'shaman",
  "Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla",
];

const time = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
/** Suhbatga tashlanadigan fayl chegarasi (server: intake/extract.ts MAX_FILE_BYTES) */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function ChatPage({ biz, status, notify, now }: { biz: Business; status: LiveStatus; notify: Notify; now: Date }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  /** Birinchi kun suhbati ochiq: yozilgan gap savolga javob bo'lib ketadi */
  const [interview, setInterview] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = pending !== null;
  // Suhbat bo'sh: ekranda faqat so'rov qatori turadi, misollar uning ichida navbat bilan ko'rinadi
  // (yuklanayotganda ham shu ko'rinish: ramka paydo bo'lib, keyin yo'qolib qolmasin)
  const empty = !entries?.length && !pending;
  const [hint, setHint] = useState(0);
  useEffect(() => {
    if (!empty) return;
    const t = setInterval(() => setHint(h => (h + 1) % SUGGESTIONS.length), 3500);
    return () => clearInterval(t);
  }, [empty]);

  const load = () => api.chat().then(r => { setEntries(r.entries); setInterview(r.interview); }).catch(e => notify((e as Error).message, true));
  // Bosh sahifada yozilgan savol bo'lsa — suhbat yuklangach o'zi yuboriladi (sahifadan chiqib ketilgan bo'lsa — keyingi ochilishda)
  useEffect(() => {
    let gone = false;
    void load().then(() => { const asked = gone ? null : takeAsk(); if (asked) void submit(asked); });
    return () => { gone = true; };
  }, []);
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
    // «Kameralarni och» kabi qisqa buyruq: bo'lim darhol ochiladi
    const section = voice ? null : sectionFor(clean);
    if (section) { setText(''); window.location.hash = `#/${section}`; return; }
    setPending(voice ? '🎙 …' : clean);
    setText('');
    try {
      const r = voice ? await api.sayVoice(voice) : await api.say(clean);
      setEntries(prev => [...(prev ?? []), ...r.entries]);
      setInterview(r.interview);
      // Ovoz bilan aytilgan buyruq matnga aylangach tekshiriladi
      const spoken = voice ? sectionFor(r.entries.find(e => e.role === 'owner')?.text ?? '') : null;
      if (spoken) window.location.hash = `#/${spoken}`;
    } catch (e) {
      notify((e as Error).message, true);
      if (!voice) setText(clean);
    } finally {
      setPending(null);
      input.current?.focus();
    }
  };

  /** Birinchi kun suhbati: savolni o'tkazib yuborish yoki suhbatni to'xtatish */
  const interviewAct = async (action: 'skip' | 'stop') => {
    if (busy) return;
    setPending(action === 'skip' ? 'Keyingi savol…' : "To'xtatilmoqda…");
    try {
      const r = await api.interview(action);
      setEntries(prev => [...(prev ?? []), ...r.entries]);
      setInterview(r.open);
    } catch (e) {
      notify((e as Error).message, true);
      void load();
    } finally {
      setPending(null);
      input.current?.focus();
    }
  };

  /** Fayl tashlandi (narxnoma, shartnoma namunasi, yo'riqnoma): server o'qiydi, «Ikkinchi miya»da tasdiq kutadi */
  const sendFile = async (file: File) => {
    if (busy) return;
    // Katta fayl serverga yuborib o'tirilmaydi (server ham shu chegarada rad etadi)
    if (file.size > MAX_UPLOAD_BYTES) { notify(`Fayl ${MAX_UPLOAD_BYTES / 1024 / 1024} MB dan katta — kichikroq qilib yuboring.`, true); return; }
    setPending(`📎 ${file.name}`);
    try {
      const r = await api.sayFile(file);
      setEntries(prev => [...(prev ?? []), ...r.entries]);
    } catch (e) {
      notify((e as Error).message, true);
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
    <div className={`flex h-[calc(100dvh-var(--shell-y))] flex-col ${empty ? 'justify-center' : ''}`}>
      <header className={`mb-3 flex flex-wrap items-center gap-3 ${empty ? 'hidden' : ''}`}>
        <div className="mr-auto" data-ph-text>
          <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight">Yordamchi</h1>
          <p className="text-sm text-slate-500">Yozing, gapiring yoki fayl tashlang — vazifa, mijoz, hujjat, narxnoma. Telegram'dagi suhbat ham shu yerda.</p>
        </div>
        {!status.ai && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">AI ulanmagan</span>}
        {status.bot && !status.ownerLinked && (
          <a href="#/telegram" className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200">Telegram'ni ulang — eslatmalar u yerga keladi →</a>
        )}
        <Button size="sm" variant="ghost" onClick={reset} title="Suhbatni yangidan boshlash"><RotateCcw className="h-3.5 w-3.5" /> Yangi suhbat</Button>
      </header>

      <div data-chat-log className={empty ? 'pb-5' : 'flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'} aria-live="polite">
        {entries === null ? (
          <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : entries.length === 0 && !pending ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 shrink-0 items-center justify-center"><img src="/favicon.svg" alt="Cerebro Logo" className="h-14 w-14" /></div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {entries.map(e => (
              <div key={e.id} className={`flex ${e.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] space-y-2 ${e.role === 'owner' ? 'items-end' : ''}`}>
                  <div data-msg={e.role} className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${e.role === 'owner' ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-900'}`}>
                    {e.role === 'owner' ? <p className="whitespace-pre-line">{e.text}</p> : <Markdown text={e.text} />}
                  </div>
                  {e.artifacts.map((a, i) => (
                    <ArtifactView key={i} a={a} biz={biz} notify={notify} now={now} onChange={x => replaceArtifact(e.id, i, x)} />
                  ))}
                  <div className={`text-[11px] text-slate-400 ${e.role === 'owner' ? 'text-right' : ''}`}>{time(e.createdAt)}{e.channel === 'telegram' ? ' · Telegram' : ''}</div>
                </div>
              </div>
            ))}
            {pending && (
              <>
                <div className="flex justify-end"><div data-msg="owner" className="max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600/80 px-4 py-2.5 text-[15px] text-white"><p className="whitespace-pre-line">{pending}</p></div></div>
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cerebro ishlayapti…</div>
              </>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {interview && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>Cerebro savol beryapti — javobingizni yozing.</span>
          <button type="button" onClick={() => void interviewAct('skip')} disabled={busy} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">O'tkazib yuborish</button>
          <button type="button" onClick={() => void interviewAct('stop')} disabled={busy} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">To'xtatish</button>
        </div>
      )}
      <form data-chat-form onSubmit={e => { e.preventDefault(); void submit(text); }} className={`flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-indigo-400 ${empty ? 'mx-auto w-full max-w-3xl' : 'mt-3'}`}>
        <textarea
          ref={input}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          placeholder={rec ? 'Gapiring… tugatgach ■ ni bosing' : empty ? `«${SUGGESTIONS[hint]}»` : 'Yozing yoki mikrofonni bosib gapiring…'}
          aria-label="Xabar"
          disabled={busy || !!rec}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-slate-400"
        />
        <input ref={picker} type="file" accept=".pdf,.docx,.xlsx,.txt,.md,.csv" className="hidden" tabIndex={-1} aria-hidden="true"
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void sendFile(file); }} />
        <button type="button" onClick={() => picker.current?.click()} disabled={busy || !!rec} aria-label="Fayl biriktirish" title="PDF, Word, Excel yoki matn — o'qib, bilimga taklif qilaman"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 disabled:opacity-40">
          <Paperclip className="h-5 w-5" />
        </button>
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
      {empty && !status.ai && <p className="mt-3 text-center text-sm text-amber-700">AI kaliti ulanmagan — yordamchi hozircha javob bera olmaydi.</p>}
    </div>
  );
}
