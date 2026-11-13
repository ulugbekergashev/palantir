/**
 * «Yetkazildi» — AI javob bermagan bemorga avtomatik xabar (core.ts: holdCustomer). Bu javob emas: bemor hali kutyapti.
 * «Javob kutyapti» ro'yxati (attention.ts) va eskirgan takliflar (core.ts: expireStale) uni javob deb sanamaydi
 */
import type { InboxMessage } from '../../src/types';

/** Xabarning birinchi qatori — shu belgi bilan taniladi */
const HOLD_MARK = 'xodimiga yetkazildi ✅';
export const holdLine = (business: string): string => `Xabaringiz «${business}» ${HOLD_MARK} Tez orada javob beramiz.`;

export const isHold = (m: Pick<InboxMessage, 'direction' | 'by' | 'text'>): boolean => m.direction === 'out' && m.by === 'palantir' && m.text.includes(HOLD_MARK);

/** Bemor javob kutyaptimi: «yetkazildi» dan boshqa oxirgi xabar — bemorniki. Qaytadi: o'sha xabar yoki null (javob yozilgan) */
export function awaitingReply(thread: InboxMessage[]): InboxMessage | null {
  const last = thread.filter(m => !isHold(m)).at(-1);
  return last?.direction === 'in' ? last : null;
}
