/**
 * Jonli ovozli suhbat holati — bosh ekran sferasi, Yordamchi va Qabulxona sinovi bir xil ishlatadi.
 * kind: owner — egasi o'z yordamchisi bilan; customer — egasi qabulxonani mijoz bo'lib sinaydi (jadvalga yozilmaydi, so'rov ochilmaydi).
 * Holat: kim nima dedi (jonli matn), asbob natijalari (karta), sfera uchun ovoz balandligi (orb ref'ga CSS o'zgaruvchilari).
 */
import { useEffect, useRef, useState } from 'react';
import { session } from '../data/api';
import { startVoice, type VoiceEvent, type VoiceSession } from './liveVoice';

export type VoiceMode = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
export interface VoiceCard { id: number; kind: 'tasks' | 'done' | 'answer' | 'working' | 'booked' | 'request'; title: string; body?: string; items?: { title: string; when: string | null; late?: boolean }[] }

const when = (due: string | null | undefined) => (due ? due.replace('T', ' ').slice(5) : null);

/** Asbob natijasi → ekrandagi karta (yo'q bo'lsa — faqat gap) */
export function cardOf(e: Extract<VoiceEvent, { type: 'tool' }>, id: number): VoiceCard | null {
  const r = e.result ?? {};
  if (e.state === 'start') return e.name === 'cerebro' ? { id, kind: 'working', title: 'Cerebro bajaryapti', body: String(e.args.request ?? '') } : null;
  if ('error' in r) return { id, kind: 'done', title: 'Bajarilmadi', body: String(r.error) };
  if (e.name === 'list_tasks') {
    const tasks = (r.tasks as { title: string; due_at: string | null; holati?: string }[] | undefined) ?? [];
    return { id, kind: 'tasks', title: tasks.length ? `Ochiq ishlar · ${tasks.length}` : "Ochiq ish yo'q", items: tasks.slice(0, 6).map(t => ({ title: t.title, when: when(t.due_at), late: t.holati === 'kechikkan' })) };
  }
  if (e.name === 'add_task') return { id, kind: 'done', title: 'Eslatma qo‘yildi', body: [r.title, when(r.due_at as string | null)].filter(Boolean).join(' · ') };
  if (e.name === 'update_task') return { id, kind: 'done', title: r.status === 'done' ? 'Bajarildi' : r.status === 'cancelled' ? 'Bekor qilindi' : 'Vaqti o‘zgardi', body: [r.title, when(r.due_at as string | null)].filter(Boolean).join(' · ') };
  if (e.name === 'cerebro') return { id, kind: 'answer', title: 'Cerebro', body: String(r.result ?? '') };
  if (e.name === 'book_appointment') return { id, kind: 'booked', title: 'Qabulga yozildi', body: String(r.booked ?? '') };
  if (e.name === 'leave_request') return { id, kind: 'request', title: "So'rov qoldirildi", body: String(e.args.request ?? '') };
  return null;
}

export function useVoice(kind: 'owner' | 'customer' = 'owner') {
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [you, setYou] = useState('');
  const [ai, setAi] = useState('');
  const [cards, setCards] = useState<VoiceCard[]>([]);
  const [error, setError] = useState('');
  const voice = useRef<VoiceSession | null>(null);
  const orb = useRef<HTMLDivElement>(null);
  const cardId = useRef(0);
  const working = useRef(0);

  // Sfera ovoz bilan «nafas oladi»: odam gapirsa — kengayadi, AI gapirsa — yorqinlashadi
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const l = voice.current?.levels() ?? { mic: 0, ai: 0 };
      orb.current?.style.setProperty('--mic', l.mic.toFixed(3));
      orb.current?.style.setProperty('--ai', l.ai.toFixed(3));
      if (voice.current) setMode(m => (m === 'connecting' || m === 'thinking' ? m : l.ai > 0.04 ? 'speaking' : 'listening'));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); voice.current?.stop(); };
  }, []);

  const push = (card: VoiceCard | null) => {
    if (!card) return;
    setCards(list => [card, ...list.filter(c => c.kind !== 'working' || card.kind === 'working')].slice(0, 4));
  };

  const onEvent = (e: VoiceEvent) => {
    if (e.type === 'ready') { setMode('listening'); setError(''); }
    else if (e.type === 'partial' || e.type === 'line') {
      if (e.who === 'Siz') { setYou(e.text); if (e.type === 'partial') setAi(''); }
      else if (e.who === 'Cerebro') setAi(e.text);
    } else if (e.type === 'tool') {
      working.current += e.state === 'start' ? 1 : -1;
      setMode(working.current > 0 ? 'thinking' : 'listening');
      push(cardOf(e, ++cardId.current));
    } else if (e.type === 'error') setError(e.text);
    else if (e.type === 'closed') { voice.current = null; working.current = 0; setMode('idle'); }
  };

  const toggle = async () => {
    if (voice.current) { voice.current.stop(); return; }
    const token = session.token();
    if (!token) return;
    setError('');
    setYou('');
    setAi('');
    setMode('connecting');
    try {
      voice.current = await startVoice(token, onEvent, kind);
    } catch (e) {
      setMode('idle');
      setError((e as Error).name === 'NotAllowedError' ? 'Mikrofonga ruxsat bering (manzil satridagi belgi)' : 'Ovozli suhbat ochilmadi — Cerebro telefon liniyasi ishlayaptimi?');
    }
  };

  return { mode, active: mode !== 'idle', you, ai, cards, error, toggle, orb, push, setYou, setAi, setError, nextId: () => ++cardId.current };
}
