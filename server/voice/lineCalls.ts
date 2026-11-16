/**
 * Asterisk liniyasiga hozir kelgan qo'ng'iroqlar (T7). Har qo'ng'iroq boshida Asterisk «kim javob beradi» deb so'raydi
 * (/api/voice/route?phone=…) — shu yerda raqam eslab qolinadi.
 *
 * Nega: qabulxonadagi MicroSIP Asterisk'ning «administrator telefoni» bo'lsa, bitta qo'ng'iroq ikki joyda ko'rinadi. Administrator
 * ko'tarmasa, MicroSIP uni «o'tkazib yuborilgan» deb yozardi va «qayta qo'ng'iroq qiling» so'rovi ochilardi — vaholanki unga AI javob
 * bergan (yoki Asterisk o'zi so'rov ochadi). Ko'tarsa — jurnalda ikki yozuv (MicroSIP'niki yozuvi bilan va Asterisk'niki).
 * Xotirada: oyna qisqa, server qayta yonsa yo'qolishi zarar qilmaydi.
 */
import { phoneKey } from '../../src/lib/phone';

/** Qo'ng'iroq boshi bilan MicroSIP yozuvi orasidagi farq (jiringlash, AI suhbati, yozuv kechikishi) */
export const LINE_CALL_WINDOW_MS = 3 * 60_000;
const KEEP_MS = 2 * 3_600_000;

const seen = new Map<string, number[]>();
const keyOf = (bizId: string, phone: string) => { const k = phoneKey(phone); return k ? `${bizId}:${k}` : null; };

export function markLineCall(bizId: string, phone: string, at = Date.now()): void {
  const key = keyOf(bizId, phone);
  if (!key) return;
  const fresh = (seen.get(key) ?? []).filter(t => at - t < KEEP_MS);
  seen.set(key, [...fresh, at]);
  // Eskilari tozalanadi (xotira o'smasin)
  if (seen.size > 5000) for (const [k, list] of seen) if (list.every(t => at - t >= KEEP_MS)) seen.delete(k);
}

/** Shu raqamdan, shu paytga yaqin (± oyna) Asterisk liniyasiga qo'ng'iroq kelganmi */
export function lineCallNear(bizId: string, phone: string, at: number, windowMs = LINE_CALL_WINDOW_MS): boolean {
  const key = keyOf(bizId, phone);
  return !!key && (seen.get(key) ?? []).some(t => Math.abs(at - t) <= windowMs);
}

/** Sinovlar uchun */
export const forgetLineCalls = () => seen.clear();

/**
 * Hozir liniyada suhbat ketayotgan bo'lishi mumkinmi: oxirgi qo'ng'iroq boshidan CALL_BUSY_MS o'tmagan. Asterisk tugashini har doim
 * aytmaydi (administrator ko'targani, uzilgani), shuning uchun taxmin — masofadan qayta ishga tushirish shu bilan suhbatni uzmaslikka harakat qiladi
 */
export const CALL_BUSY_MS = 10 * 60_000;
export function lineBusy(at = Date.now()): boolean {
  for (const list of seen.values()) if (list.some(t => at - t >= 0 && at - t < CALL_BUSY_MS)) return true;
  return false;
}
