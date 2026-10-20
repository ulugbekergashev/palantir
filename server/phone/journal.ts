/**
 * Qo'ng'iroqlar jurnali — sof qoidalar (bazaga tegmaydi): MicroSIP hodisasi joriy holatga nima qiladi.
 * DentaCRM'dagi (dentalocal/backend/telephony.ts) jonli sinalgan qoidalar asosida, bitta kompyuter uchun soddalashtirilgan.
 *
 *   incoming — qo'ng'iroq keldi     answer — xodim ko'tardi (faqat kiruvchida)     start — suhbat boshlandi
 *   end      — tugadi               outgoing — raqam terildi
 *
 * MicroSIP qo'ng'iroqqa id bermaydi — hodisalar telefon raqami bo'yicha bog'lanadi: shu raqamdagi yopilmagan yozuv — «joriy qo'ng'iroq».
 */
export type CallEvent = 'incoming' | 'answer' | 'start' | 'end' | 'outgoing';
export type CallDirection = 'in' | 'out';
export type CallState = 'ringing' | 'dialing' | 'talking' | 'ended' | 'missed' | 'no_answer';

export interface OpenCall {
  id: string;
  direction: CallDirection;
  state: CallState;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
}

/** Raqam ikki marta terilsa (yoki «terildi»ni ham Palantir, ham MicroSIP yuborsa) — bitta yozuv */
export const DUPLICATE_DIAL_MS = 20_000;
/** Bir necha soniyada qayta jiringlasa — o'sha qo'ng'iroq */
export const RERING_AFTER_MISS_MS = 5_000;
/** «Tugadi» «ko'tardi»dan oldin kelgan bo'lsa — yozuv qayta ochiladi */
export const ANSWER_REOPEN_MS = 3 * 60_000;
/** «Tugadi» kelmay qolgan yozuvlar (MicroSIP yopilib qolgan) shundan keyin o'zi yopiladi */
export const STALE_RINGING_MS = 5 * 60_000;
export const STALE_TALKING_MS = 4 * 3_600_000;

export type CallAction =
  | { kind: 'ignore' }
  | { kind: 'create'; direction: CallDirection; state: CallState; answered: boolean }
  | { kind: 'update'; id: string; state: CallState; answered?: boolean; ended?: boolean; reopened?: boolean };

/**
 * open — shu raqamdagi yopilmagan oxirgi yozuv; recentIn — shu raqamdagi yaqinda yopilgan oxirgi kiruvchi yozuv
 * (faqat «keldi» va «ko'tardi» uchun kerak)
 */
export function decideCall(event: CallEvent, at: number, open: OpenCall | null, recentIn: OpenCall | null): CallAction {
  switch (event) {
    case 'incoming':
      if (open?.direction === 'in') return { kind: 'ignore' };
      // Bir necha soniya ichida qayta jiringladi (operator navbati) — o'sha qo'ng'iroq
      if (recentIn?.state === 'missed' && recentIn.endedAt && at - recentIn.endedAt <= RERING_AFTER_MISS_MS) return { kind: 'update', id: recentIn.id, state: 'ringing', reopened: true };
      return { kind: 'create', direction: 'in', state: 'ringing', answered: false };
    case 'answer':
      if (open?.state === 'ringing') return { kind: 'update', id: open.id, state: 'talking', answered: true };
      if (open) return { kind: 'ignore' };
      if (recentIn?.state === 'missed' && recentIn.endedAt && at - recentIn.endedAt <= ANSWER_REOPEN_MS) return { kind: 'update', id: recentIn.id, state: 'talking', answered: true, reopened: true };
      // «Keldi» yetib kelmagan — baribir kiruvchi (ko'tarish faqat kiruvchida)
      return { kind: 'create', direction: 'in', state: 'talking', answered: true };
    case 'start':
      if (open && (open.state === 'ringing' || open.state === 'dialing')) return { kind: 'update', id: open.id, state: 'talking', answered: true };
      if (open) return { kind: 'ignore' };
      // Oldin hech narsa bo'lmagan — raqam eski MicroSIP'da terilgan («terildi» xabari yo'q)
      return { kind: 'create', direction: 'out', state: 'talking', answered: true };
    case 'end':
      if (!open) return { kind: 'ignore' };
      if (open.state === 'talking') return { kind: 'update', id: open.id, state: 'ended', ended: true };
      return { kind: 'update', id: open.id, state: open.direction === 'in' ? 'missed' : 'no_answer', ended: true };
    case 'outgoing':
      if (open?.direction === 'out' && at - open.startedAt < DUPLICATE_DIAL_MS) return { kind: 'ignore' };
      return { kind: 'create', direction: 'out', state: 'dialing', answered: false };
  }
}

/** Uzoq ochiq qolgan yozuv qanday yopiladi (null — hali yopilmaydi) */
export function staleState(c: OpenCall, now: number): CallState | null {
  if (c.state === 'talking') return now - c.startedAt > STALE_TALKING_MS ? 'ended' : null;
  if (now - c.startedAt <= STALE_RINGING_MS) return null;
  return c.state === 'ringing' ? 'missed' : c.state === 'dialing' ? 'no_answer' : null;
}
