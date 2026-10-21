/**
 * Palantir bilan suhbat — yozishma, ovozli xabar, jonli ovoz va Telegram bitta oqimda (bitta suhbat, bazada).
 * Chapda — suhbat (kun bo'yicha; ovozli suhbat — alohida karta, telefondan va Telegram'dan kelgani belgisi bilan), pastda — yozish,
 * fayl, ovozli xabar va jonli suhbat (sfera). O'ngda — Xotira: Palantir nimani doim eslab turadi (MemoryPanel).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AudioLines, ChevronDown, Loader2, Mic, Paperclip, Phone, RotateCcw, Send, Square } from 'lucide-react';
import type { Artifact, ChatEntry, LiveStatus } from '../types';
import { api } from '../data/api';
import { ArtifactView, type Notify } from '../components/Artifacts';
import { Markdown } from '../components/Markdown';
import { MemoryPanel } from '../components/MemoryPanel';
import { AgentOrb, HUE } from '../components/agent';
import { takeAsk } from '../lib/ask';
import { sectionFor } from '../lib/commands';
import { startRecording, type Recording } from '../lib/recorder';
import { useVoice } from '../lib/useVoice';
import { iso } from '../lib/week';

const SUGGESTIONS = [
  'Bugun nima qilishim kerak?',
  'Ertaga soat 10 da bankka borishni eslat',
  "Yangi mijoz: Aziz Karimov, +998 90 123 45 67, narx so'radi",
  'Hamkorlik shartnomasi tayyorla',
  'Kechagi natijalar qanday?',
];
const VOICE_MARK = '🎙 Ovozli suhbat';
/** Reja qatoridagi gapiruvchi: «Siz:» yoki «Palantir:» (eski yozuvlarda «Cerebro:» — eski nom) */
const SPEAKER = /^(Siz|Palantir|Cerebro):\s*/;
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
/** Suhbatga tashlanadigan fayl chegarasi (server: intake/extract.ts MAX_FILE_BYTES) */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Telegram'dagi suhbat ham shu yerda ko'rinsin */
const POLL_MS = 20_000;
/** Ovozli suhbat kartasida yig'ilganda ko'rinadigan oxirgi qatorlar */
const VOICE_PREVIEW = 4;

const time = (at: string) => new Date(at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
function dayTitle(at: string): string {
  const d = new Date(at), today = new Date(), y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (iso(d) === iso(today)) return 'Bugun';
  if (iso(d) === iso(y)) return 'Kecha';
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

/** Ovozli suhbat yozuvi (server: brain/routes.ts voiceEntry) — sarlavha va «Siz:/Palantir:/✓» qatorlari */
function VoiceSession({ e }: { e: ChatEntry }) {
  const [open, setOpen] = useState(false);
  const [head, ...rows] = e.text.split('\n');
  const lines = rows.filter(Boolean);
  const shown = open ? lines : lines.slice(-VOICE_PREVIEW);
  return (
    <div className="rounded-2xl border border-[#8b8cff]/20 bg-[#8b8cff]/[0.05] px-4 py-3">
      <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c7c8ff]">
        <AudioLines className="h-4 w-4" aria-hidden="true" />{head.replace(VOICE_MARK, 'Ovozli suhbat')}
        <span className="ml-auto font-normal normal-case tracking-normal text-[#7d838f]">{time(e.createdAt)}</span>
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-snug">
        {shown.map((l, i) => {
          const done = l.startsWith('✓'), me = l.startsWith('Siz:');
          return (
            <li key={i} className={done ? 'text-emerald-300' : me ? 'text-[#a3a9b5]' : 'text-[#e4e3de]'}>
              {done ? l : <><span className="mr-1.5 text-[12px] font-semibold text-[#7d838f]">{me ? 'Siz' : 'Palantir'}</span>{l.replace(SPEAKER, '')}</>}
            </li>
          );
        })}
      </ul>
      {lines.length > VOICE_PREVIEW && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-2 flex items-center gap-1 text-[13px] text-[#a3a9b5] hover:text-[#f2f0ea]">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />{open ? "Yig'ish" : `Hammasi · ${lines.length} qator`}
        </button>
      )}
    </div>
  );
}

/** Egasining gapi: qayerdan kelgani belgisi bilan (ovozli xabar, telefon orqali, fayl) */
function OwnerBubble({ e }: { e: ChatEntry }) {
  const voice = e.text.startsWith('🎙 '), phone = e.text.startsWith('📞 ');
  const said = voice || phone ? e.text.slice(3) : e.text;
  // Xodim sahifasidagi «so'rang» qatoridan kelgan savol: «(Qabulxona haqida) …» — belgi bo'lib ko'rinadi
  const about = /^\((\S+) haqida\) /.exec(said);
  const text = about ? said.slice(about[0].length) : said;
  return (
    <div data-msg="owner" className="rounded-[20px] rounded-br-md bg-glass/[0.08] px-4 py-2.5 text-[15px] leading-relaxed text-[#f2f0ea]">
      {(voice || phone) && (
        <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a909c]">
          {phone ? <Phone className="h-3 w-3" aria-hidden="true" /> : <Mic className="h-3 w-3" aria-hidden="true" />}{phone ? 'Telefon orqali' : 'Ovozli xabar'}
        </span>
      )}
      {about && <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a909c]">{about[1]} haqida</span>}
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}

export function ChatPage({ status, notify, now }: { status: LiveStatus; notify: Notify; now: Date }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  /** Birinchi kun suhbati ochiq: yozilgan gap savolga javob bo'lib ketadi */
  const [interview, setInterview] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  /** Xotira qayta o'qilsin (yangi fakt «eslab qol» bilan qo'shilgan bo'lishi mumkin) */
  const [memoryTick, setMemoryTick] = useState(0);
  const live = useVoice('owner');
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = pending !== null;
  const empty = entries !== null && !entries.length && !pending;

  const load = () => api.chat().then(r => { setEntries(r.entries); setInterview(r.interview); }).catch(e => notify((e as Error).message, true));
  // Boshqa sahifada yozilgan savol bo'lsa — suhbat yuklangach o'zi yuboriladi
  useEffect(() => {
    let gone = false;
    void load().then(() => { const asked = gone ? null : takeAsk(); if (asked) void submit(asked); });
    return () => { gone = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (busy) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Jonli suhbat tugadi — yozuvi suhbatga tushadi (server bir zumda yozadi)
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live.active) { const t = setTimeout(() => { void load(); setMemoryTick(x => x + 1); }, 1500); wasLive.current = false; return () => clearTimeout(t); }
    wasLive.current = live.active;
  }, [live.active]); // eslint-disable-line react-hooks/exhaustive-deps
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
      setMemoryTick(x => x + 1);
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
    }
  };

  /** Fayl tashlandi (narxnoma, shartnoma namunasi, yo'riqnoma): server o'qiydi, Miya'da tasdiq kutadi */
  const sendFile = async (file: File) => {
    if (busy) return;
    if (file.size > MAX_UPLOAD_BYTES) { notify(`Fayl ${MAX_UPLOAD_BYTES / 1024 / 1024} MB dan katta — kichikroq qilib yuboring.`, true); return; }
    setPending(`📎 ${file.name}`);
    try {
      const r = await api.sayFile(file);
      setEntries(prev => [...(prev ?? []), ...r.entries]);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setPending(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(text); }
  };
  const toggleMic = async () => {
    if (rec) {
      setRec(null);
      try { await submit('', await rec.stop()); } catch { notify('Ovoz yozilmadi', true); }
      return;
    }
    try { setRec(await startRecording()); } catch { notify('Mikrofonga ruxsat berilmadi', true); }
  };
  const reset = async () => {
    await api.resetChat().catch(() => {});
    notify("Yangi mavzu: oldingi gaplar qisqa eslatma bo'lib qoldi, Xotira joyida");
  };
  const replaceArtifact = (entryId: string, index: number, a: Artifact) =>
    setEntries(prev => prev?.map(e => (e.id === entryId ? { ...e, artifacts: e.artifacts.map((x, i) => (i === index ? a : x)) } : e)) ?? prev);

  const h = HUE.yordamchi;
  const days: { title: string; list: ChatEntry[] }[] = [];
  for (const e of entries ?? []) {
    const title = dayTitle(e.createdAt);
    if (days.at(-1)?.title === title) days.at(-1)!.list.push(e); else days.push({ title, list: [e] });
  }

  return (
    <div className="grid h-[calc(100dvh-var(--shell-y))] min-h-[560px] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Palantir bilan suhbat" className="relative flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-glass/[0.07] bg-[#0a0b0f]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-40 h-[380px] w-[380px] rounded-full" style={{ background: `radial-gradient(closest-side, ${h.glow}, transparent)` }} />
        <header className="relative flex flex-wrap items-center gap-3 border-b border-glass/[0.06] px-5 py-4 sm:px-6">
          <AgentOrb member="yordamchi" size={40} live={live.active} />
          <div className="mr-auto min-w-0">
            <h1 className="text-[17px] font-semibold text-[#f2f0ea]">Palantir bilan suhbat</h1>
            <p className="text-[13px] text-[#8a909c]">Yozing, gapiring yoki fayl tashlang. Telegram va ovozli suhbatlar ham shu yerda.</p>
          </div>
          {!status.ai && <span className="rounded-full bg-[#f5b454]/15 px-3 py-1 text-[12px] font-semibold text-[#fde2b0]">AI ulanmagan</span>}
          {status.bot && !status.ownerLinked && <a href="#/sozlamalar/telegram" className="rounded-full bg-[#f5b454]/15 px-3 py-1 text-[12px] font-semibold text-[#fde2b0] no-underline">Telegram'ni ulang →</a>}
          <button type="button" onClick={() => { void reset(); }} title="Yangi mavzu: suhbat qisqaradi, Xotira qoladi" className="flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Yangi mavzu
          </button>
        </header>

        <div data-chat-log className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" aria-live="polite">
          {entries === null ? (
            <div className="flex h-full items-center justify-center text-[#7d838f]"><Loader2 className="h-6 w-6 animate-spin" aria-label="Yuklanmoqda" /></div>
          ) : empty ? (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-5 text-center">
              <AgentOrb member="yordamchi" size={96} />
              <p className="text-[22px] font-semibold tracking-tight text-[#f2f0ea]">Nima qilamiz?</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map(s => <button key={s} type="button" onClick={() => { void submit(s); }} className="min-h-9 rounded-full border border-glass/10 px-3.5 text-[13px] text-[#c9cbd2] hover:bg-glass/5">{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {days.map(d => (
                <div key={d.title} className="flex flex-col gap-4">
                  <p className="flex items-center gap-3 text-[12px] font-medium text-[#7d838f]"><span className="h-px flex-1 bg-glass/[0.07]" aria-hidden="true" />{d.title}<span className="h-px flex-1 bg-glass/[0.07]" aria-hidden="true" /></p>
                  {d.list.map(e => e.role === 'assistant' && e.text.startsWith(VOICE_MARK) ? <VoiceSession key={e.id} e={e} /> : (
                    <div key={e.id} className={`flex gap-3 ${e.role === 'owner' ? 'justify-end' : ''}`}>
                      {e.role === 'assistant' && <span className="mt-1"><AgentOrb member="yordamchi" size={26} /></span>}
                      <div className={`flex max-w-[86%] flex-col gap-2 ${e.role === 'owner' ? 'items-end' : 'min-w-0 flex-1'}`}>
                        {e.role === 'owner' ? <OwnerBubble e={e} />
                          : <div data-msg="assistant" className="text-[15.5px] leading-[1.7] text-[#e4e3de]"><Markdown text={e.text} /></div>}
                        {e.artifacts.map((a, i) => <ArtifactView key={i} a={a} notify={notify} now={now} onChange={x => replaceArtifact(e.id, i, x)} />)}
                        <span className="text-[11px] text-[#6b717c]">{time(e.createdAt)}{e.channel === 'telegram' ? ' · Telegram' : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {pending && (
                <>
                  <div className="flex justify-end"><div data-msg="owner" className="max-w-[86%] rounded-[20px] rounded-br-md bg-glass/[0.06] px-4 py-2.5 text-[15px] text-[#d9dbe1]"><p className="whitespace-pre-line">{pending}</p></div></div>
                  <p className="flex items-center gap-2 text-[14px] text-[#a3a9b5]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Palantir ishlayapti…</p>
                </>
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>

        {(live.active || live.error) && (
          <div className="relative mx-4 mb-3 flex items-center gap-4 rounded-2xl border border-[#8b8cff]/25 bg-[#8b8cff]/[0.06] px-4 py-3 sm:mx-6" aria-live="polite">
            <div ref={live.orb} aria-hidden="true" className="h-10 w-10 shrink-0 rounded-full transition-transform duration-100"
              style={{ background: `radial-gradient(circle at 30% 28%, #ffffffcc, ${h.a} 38%, ${h.b} 72%, #15123a 100%)`, transform: 'scale(calc(1 + var(--mic, 0) * 0.25 + var(--ai, 0) * 0.15))' }} />
            <div className="min-w-0 flex-1 text-[14px]">
              {live.error ? <p role="alert" className="text-rose-200">{live.error}</p> : (
                <>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c7c8ff]">{live.mode === 'connecting' ? 'Ulanmoqda…' : live.mode === 'thinking' ? 'Bajaryapti…' : live.mode === 'speaking' ? 'Palantir gapiryapti' : 'Eshityapti — gapiring'}</p>
                  {live.ai ? <p className="truncate text-[#f2f0ea]">{live.ai}</p> : live.you ? <p className="truncate text-[#a3a9b5]">«{live.you}»</p> : null}
                </>
              )}
            </div>
            {live.active && <button type="button" onClick={() => { void live.toggle(); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#f2f0ea] px-3.5 text-[13px] font-semibold text-[#07080b]"><Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />Tugatish</button>}
          </div>
        )}

        {interview && (
          <div className="relative mx-4 mb-2 flex flex-wrap items-center gap-2 text-[13px] text-[#a3a9b5] sm:mx-6">
            <span>Palantir savol beryapti — javobingizni yozing.</span>
            <button type="button" onClick={() => { void interviewAct('skip'); }} disabled={busy} className="rounded-full border border-glass/10 px-3 py-1 text-[12px] hover:bg-glass/5 disabled:opacity-40">O'tkazib yuborish</button>
            <button type="button" onClick={() => { void interviewAct('stop'); }} disabled={busy} className="rounded-full border border-glass/10 px-3 py-1 text-[12px] hover:bg-glass/5 disabled:opacity-40">To'xtatish</button>
          </div>
        )}
        <form data-chat-form onSubmit={e => { e.preventDefault(); void submit(text); }} className="relative mx-4 mb-4 flex items-end gap-1.5 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 focus-within:border-glass/25 sm:mx-6 sm:mb-5">
          <textarea ref={input} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder={rec ? 'Gapiring… tugatgach ■ ni bosing' : 'Yozing yoki gapiring…'} aria-label="Xabar" disabled={busy || !!rec}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
          <input ref={picker} type="file" accept=".pdf,.docx,.xlsx,.txt,.md,.csv" className="hidden" tabIndex={-1} aria-hidden="true"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void sendFile(file); }} />
          <button type="button" onClick={() => picker.current?.click()} disabled={busy || !!rec} aria-label="Fayl biriktirish" title="PDF, Word, Excel yoki matn — o'qib, Miya'ga taklif qilaman"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#a3a9b5] hover:bg-glass/5 disabled:opacity-40"><Paperclip className="h-5 w-5" aria-hidden="true" /></button>
          {status.voice && (
            <button type="button" onClick={() => { void toggleMic(); }} disabled={busy} aria-label={rec ? 'Yozishni tugatish va yuborish' : 'Ovozli xabar'} title="Ovozli xabar: gapiring, matnga aylanadi"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${rec ? 'animate-pulse bg-rose-500 text-white' : 'text-[#a3a9b5] hover:bg-glass/5'} disabled:opacity-40`}>
              {rec ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
            </button>
          )}
          <button type="button" onClick={() => { void live.toggle(); }} aria-pressed={live.active} aria-label={live.active ? 'Jonli suhbatni tugatish' : 'Jonli suhbat — gaplashib oling'} title="Jonli suhbat: Palantir ovoz bilan javob beradi"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${live.active ? 'bg-[#8b8cff] text-[#07080b]' : 'text-[#c7c8ff] hover:bg-[#8b8cff]/10'}`}>
            <AudioLines className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="submit" disabled={busy || !text.trim()} aria-label="Yuborish" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8b8cff] text-[#07080b] disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>
      </section>
      <aside className="hidden min-h-0 overflow-y-auto xl:block"><MemoryPanel notify={notify} tick={memoryTick} /></aside>
    </div>
  );
}
