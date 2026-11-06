/**
 * Matnni baytlar bo'yicha qisqartirish: boshi va oxiri qoladi, o'rtasi tushib qoladi (o'rnida — necha bayt tushgani).
 * Diagnostika uchun (server/help.ts): boshida holat va sozlamalar, oxirida bugungi jurnal — eng keraklisi. Toza funksiya — scripts/check-help.ts.
 */
export function fitBytes(text: string, max: number): string {
  const all = Buffer.from(text);
  if (all.length <= max) return text;
  const half = Math.floor(max / 2);
  // Ko'p baytli harf chegarada bo'linsa, toString() uni bitta belgiga almashtiradi — matn buzilmaydi
  return `${all.subarray(0, half).toString()}\n\n… (qisqartirildi: ${all.length - 2 * half} bayt tushib qoldi) …\n\n${all.subarray(all.length - half).toString()}`;
}
