/**
 * Klinika telefonidan (SIM) AI raqamiga yo'naltirish kodlari — GSM standarti, O'zbekiston operatorlarida ham ishlaydi. Telefonda terib,
 * qo'ng'iroq tugmasi bosiladi; operator «yoqildi» deb javob beradi. Kodlar mobil telefon uchun (shahar telefonida operator orqali yoqiladi).
 */
export interface ForwardCode { title: string; hint: string; code: string }

/** Raqam xalqaro ko'rinishda: 998712001122 → +998712001122; 9 xonali mahalliy (712001122) — +998 qo'shiladi */
export function intlNumber(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  if (d.length === 9) return `+998${d}`;
  return d.length >= 10 ? `+${d}` : null;
}

/** ring — administrator necha soniya ko'tarmasa AI'ga o'tadi (operatorlar 5–30 soniyani qabul qiladi, 5 ga karrali) */
export function forwardCodes(number: string, ring = 15): { on: ForwardCode[]; off: ForwardCode } | null {
  const n = intlNumber(number);
  if (!n) return null;
  const secs = Math.min(30, Math.max(5, Math.round(ring / 5) * 5));
  return {
    on: [
      { title: `Ko'tarilmasa (${secs} soniyadan keyin)`, hint: "Administrator ulgurmasa — AI javob beradi", code: `**61*${n}**${secs}#` },
      { title: 'Band bo\'lsa', hint: "Administrator boshqa qo'ng'iroqda — AI javob beradi", code: `**67*${n}#` },
      { title: "O'chiq yoki aloqa yo'q", hint: 'Telefon o\'chgan, zaryadi tugagan — AI javob beradi', code: `**62*${n}#` },
    ],
    off: { title: "Hammasini o'chirish", hint: "Yo'naltirishni bekor qilish", code: '##004#' },
  };
}
