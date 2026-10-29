/**
 * So'rov turlari va qo'ng'iroq natijalari — panel, Telegram kartasi va hisobotda bir xil nom (avval har joyda boshqacha edi:
 * «Qayta qo'ng'iroq» / «Qo'ng'iroq qilish», «Ko'chirish / bekor» / «Surish yoki bekor qilish»…). Belgi (emoji) — Telegram va
 * ro'yxatlarda nom oldidan.
 */
export type RequestKindKey = 'callback' | 'booking' | 'change' | 'complaint' | 'other';

export const REQUEST_KIND: Record<RequestKindKey, string> = {
  callback: "Qo'ng'iroq qilish", booking: 'Qabulga yozish', change: "Ko'chirish yoki bekor qilish", complaint: 'Shikoyat', other: "So'rov",
};
export const REQUEST_ICON: Record<RequestKindKey, string> = { callback: '📞', booking: '📅', change: '🔁', complaint: '⚠️', other: '📌' };
/** Noma'lum tur (eski yozuv) — «So'rov» */
export const requestKind = (kind: string, icon = false): string => {
  const k = (kind in REQUEST_KIND ? kind : 'other') as RequestKindKey;
  return icon ? `${REQUEST_ICON[k]} ${REQUEST_KIND[k]}` : REQUEST_KIND[k];
};

export type CallOutcomeKey = 'booked' | 'callback' | 'info' | 'lost' | 'complaint' | 'other';
export const CALL_OUTCOME: Record<CallOutcomeKey, string> = {
  booked: 'Qabulga yozildi', callback: "Qayta qo'ng'iroq kerak", info: "Ma'lumot oldi", lost: 'Qiziqmadi', complaint: 'Shikoyat', other: 'Boshqa',
};
export const CALL_OUTCOME_ICON: Record<CallOutcomeKey, string> = { booked: '✅', callback: '🔁', info: 'ℹ️', lost: '❌', complaint: '⚠️', other: '•' };
