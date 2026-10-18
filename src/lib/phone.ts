/**
 * Telefon bo'yicha bitta odamni tanish: «+998 90 123-45-67», «8 90 123 45 67», «901234567» — bitta raqam.
 * Kalit — oxirgi 9 raqam (O'zbekiston mobil raqami); undan qisqa raqam bilan hech kim bilan solishtirilmaydi
 */
export const PHONE_KEY_DIGITS = 9;

export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= PHONE_KEY_DIGITS ? d.slice(-PHONE_KEY_DIGITS) : null;
}

/** Ko'rsatish uchun: «+998 90 123 45 67» (boshqa uzunlikdagi raqam — o'zgarishsiz) */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const m = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(d);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
