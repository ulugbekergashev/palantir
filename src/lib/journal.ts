import type { Page } from '../components/Sidebar';
import type { Call, CameraSummary, InboxThread } from '../types';

/** Jurnal qatori: nima bo'ldi va batafsili qaysi bo'limda. at — voqea vaqti (kutayotgan ishlarda yo'q) */
export interface JournalItem { key: string; at: string | null; kind: 'call' | 'camera' | 'chat' | 'brain'; level: 'ok' | 'warn' | 'crit'; text: string; page: Page }
export interface Journal { waiting: JournalItem[]; today: JournalItem[] }

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (isoTime: string): string => { const d = new Date(isoTime); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Bir kunning jurnali: tepada egasining qarorini kutayotgan ishlar, pastda yordamchi qilgan va ko'rgan narsalar (yangisi yuqorida).
 * Sof funksiya: ma'lumot qo'ng'iroqlar, kamera hisobi va yozishmalardan yig'iladi. day — "YYYY-MM-DD" (mahalliy sana).
 * toRemember — ikkinchi miyada egasining tasdig'ini kutayotgan javob va tuzatishlar soni.
 * followups — yordamchi tayyorlagan, lekin egasi hali «Yuborish»ni bosmagan mijozlarga xabarlar soni.
 */
export function buildJournal(calls: Call[], summary: CameraSummary | null, threads: InboxThread[], day: string, toRemember = 0, followups = 0): Journal {
  const waiting: JournalItem[] = [
    ...(summary?.findings ?? []).filter(f => f.level !== 'ok').map((f, i): JournalItem => ({ key: `f${i}`, at: null, kind: 'camera', level: f.level, text: f.text, page: 'cameras' })),
    ...threads.filter(t => t.pending > 0).map((t): JournalItem => ({ key: `t${t.lead.id}`, at: null, kind: 'chat', level: 'warn', text: `${t.lead.name || (t.lead.username ? `@${t.lead.username}` : null) || t.lead.phone || 'Mijoz'}: ${t.pending} ta javob tasdiqlashingizni kutyapti`, page: 'inbox' })),
    ...(followups > 0 ? [{ key: 'followups', at: null, kind: 'chat', level: 'warn', text: `Mijozlarga ${followups} ta xabar tayyor — «Yuborish»ni bosishingizni kutyapti`, page: 'inbox' } satisfies JournalItem] : []),
    ...(toRemember > 0 ? [{ key: 'brain', at: null, kind: 'brain', level: 'warn', text: `Ikkinchi miyada ${toRemember} ta narsa tasdig'ingizni kutyapti`, page: 'brain' } satisfies JournalItem] : []),
  ];
  const today: JournalItem[] = [
    ...calls.filter(c => dayOf(c.startedAt) === day).map((c): JournalItem => ({ key: `c${c.id}`, at: c.startedAt, kind: 'call', level: 'ok', text: `${c.name ?? c.phone} — ${c.outcome}${c.booked ? ` · ${c.booked}` : ''}`, page: 'calls' })),
    // Kutish va xodim joyidagi har seans jurnalga tushmaydi (kuniga o'nlab) — hisobi Kuzatuvchida
    ...(summary?.sessions ?? []).filter(s => s.kind === 'chair' || s.kind === 'desk').map((s): JournalItem => ({
      key: `s${s.id}`, at: s.startedAt, kind: 'camera', level: 'ok', page: 'cameras',
      text: `${s.zoneName}: ${s.kind === 'chair' ? "kresloga o'tirdi" : 'kassa oldida turdi'}${s.endedAt ? '' : ' (hozir ham shu yerda)'}`,
    })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return { waiting, today };
}
