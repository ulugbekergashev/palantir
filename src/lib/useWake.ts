/**
 * «Quloq» — egasi tugma bosmasdan «Palantir» (yoki «Jarvis») deb chaqiradi va topshirig'ini aytadi. Mikrofon shu kompyuterda tinglanadi
 * (tgvoice/wake.py, internetsiz); chaqiriq eshitilsa shu ulanishning o'zida jonli suhbat boshlanadi, tugagach yana tinglashga qaytadi.
 * Panelda boshqa jonli suhbat ochiq bo'lsa (sfera, chat, qabulxona sinovi) — quloq to'xtab turadi. Bir nechta oyna ochiq bo'lsa, faqat bittasi
 * tinglaydi (navigator.locks) — «Palantir» ikki marta javob bermasin. Yoqilgani shu brauzerda eslab qolinadi.
 */
import { useEffect, useRef, useState } from 'react';
import { session } from '../data/api';
import { startVoice, type VoiceEvent, type VoiceSession } from './liveVoice';
import { cardOf, liveVoices, type VoiceCard } from './useVoice';

export type WakePhase = 'off' | 'starting' | 'listening' | 'live' | 'paused' | 'error';
const KEY = 'cerebro_quloq';
const LOCK = 'cerebro-quloq';
/** Suhbat tugagach oyna shuncha turadi (oxirgi javobni o'qib olish uchun) */
const LINGER_MS = 5_000;
const RESTART_MS = 1_200, RETRY_MS = 10_000;

const saved = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const save = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* shaxsiy oyna — eslab qolinmaydi */ } };

/** Bitta oyna tinglaydi: qulf olinsa — bo'shatish funksiyasi, boshqa oyna tinglayotgan bo'lsa — null */
function acquire(): Promise<(() => void) | null> {
  return new Promise(resolve => {
    if (!navigator.locks) { resolve(() => {}); return; }
    void navigator.locks.request(LOCK, { ifAvailable: true }, lock => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise<void>(done => resolve(done));
    });
  });
}

export function useWake() {
  const [enabled, setEnabled] = useState(saved);
  const [phase, setPhase] = useState<WakePhase>('off');
  const [word, setWord] = useState('');
  const [you, setYou] = useState('');
  const [ai, setAi] = useState('');
  const [cards, setCards] = useState<VoiceCard[]>([]);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(false);
  const voice = useRef<VoiceSession | null>(null);
  const orb = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  const cardId = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const want = useRef(enabled);
  want.current = enabled;
  /** Har ishga tushirish urinishining raqami: kutilayotgan ulanish eskirgan bo'lsa (o'chirildi, boshqasi boshlandi) — darhol yopiladi */
  const attempt = useRef(0);
  const unlock = useRef<(() => void) | null>(null);
  const fatal = useRef(false);
  const release = () => { unlock.current?.(); unlock.current = null; };

  const later = (fn: () => void, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(fn, ms); };

  const onEvent = (e: VoiceEvent) => {
    if (e.type === 'listening') { setPhase('listening'); setError(''); }
    else if (e.type === 'wake') {
      live.current = true;
      setWord(e.word); setYou(''); setAi(''); setCards([]); setShown(true); setPhase('live');
    } else if (e.type === 'partial' || e.type === 'line') {
      if (e.who === 'Siz') setYou(e.text); else if (e.who === 'Palantir') setAi(e.text);
    } else if (e.type === 'tool') {
      const card = cardOf(e, ++cardId.current);
      if (card) setCards(list => [card, ...list.filter(c => c.kind !== 'working' || card.kind === 'working')].slice(0, 3));
    } else if (e.type === 'error') {
      setError(e.text);
      if (e.fatal) { fatal.current = true; setPhase('error'); }
    }
    else if (e.type === 'closed') {
      voice.current = null;
      release();
      const was = live.current;
      live.current = false;
      if (was) window.setTimeout(() => setShown(false), LINGER_MS);
      if (!want.current) { setPhase('off'); return; }
      if (fatal.current) return;
      setPhase(p => (p === 'error' ? p : 'starting'));
      later(start, was ? RESTART_MS : RETRY_MS);
    }
  };

  const start = async () => {
    if (!want.current || voice.current || unlock.current || fatal.current) return;
    if (liveVoices() > 0) { setPhase('paused'); return; }
    const token = session.token();
    if (!token) return;
    const my = ++attempt.current;
    setPhase('starting');
    const done = await acquire();
    if (!done) { setPhase('paused'); later(start, RETRY_MS); return; }
    if (my !== attempt.current || !want.current) { done(); return; }
    unlock.current = done;
    try {
      const s = await startVoice(token, onEvent, 'wake');
      // Ulanish kutilayotganda o'chirildi yoki boshqa suhbat boshlandi — mikrofon ochiq qolmasin
      if (my !== attempt.current || !want.current || liveVoices() > 0) { s.stop(); return; }
      voice.current = s;
    } catch (e) {
      release();
      setPhase('error');
      setError((e as Error).name === 'NotAllowedError' ? 'Mikrofonga ruxsat bering' : 'Quloq ulanmadi — Palantir ovoz xizmati ishlayaptimi?');
      later(start, RETRY_MS);
    }
  };
  const stop = () => { attempt.current++; window.clearTimeout(timer.current); voice.current?.stop(); voice.current = null; release(); };

  // Yoqish/o'chirish
  useEffect(() => {
    save(enabled);
    fatal.current = false;
    if (enabled) void start(); else { stop(); setPhase('off'); setError(''); }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boshqa jonli suhbat ochildi — tinglash to'xtaydi (suhbatdagi quloqning o'zi emas), yopildi — qaytadi
  useEffect(() => {
    const onVoice = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (!want.current || live.current) return;
      if (n > 0) { stop(); setPhase('paused'); } else later(start, RESTART_MS);
    };
    window.addEventListener('cerebro:voice', onVoice);
    return () => { window.removeEventListener('cerebro:voice', onVoice); stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sfera ovozga qarab «nafas oladi»
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const l = voice.current?.levels() ?? { mic: 0, ai: 0 };
      orb.current?.style.setProperty('--mic', l.mic.toFixed(3));
      orb.current?.style.setProperty('--ai', l.ai.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return {
    enabled, phase, word, you, ai, cards, error, shown, orb,
    toggle: () => setEnabled(v => !v),
    /** Suhbatni tugatish (quloq yoqilgan bo'lsa — yana tinglashga qaytadi) */
    hangUp: () => voice.current?.stop(),
    hide: () => setShown(false),
  };
}
export type Wake = ReturnType<typeof useWake>;
