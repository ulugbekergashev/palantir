/**
 * «O'zi javob bersin» rejimining kechki yig'masi (B7, egasi qarori): har javob uchun alohida xabar o'rniga — bitta.
 * Qabul va AI bilmagan savol darhol aytiladi (core.ts); bu yerda — Palantir o'zi javob bergan oddiy suhbatlar.
 */
export interface DigestRow { name: string; channel: string; replies: number }

/** Ro'yxatda shunchadan ortig'i «yana N ta» bo'ladi */
const SHOWN = 10;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Bo'sh ro'yxat — null (aytadigan narsa yo'q) */
export function digestText(rows: DigestRow[]): string | null {
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.replies, 0);
  const lines = rows.slice(0, SHOWN).map(r => `• ${esc(r.name)} · ${esc(r.channel)}${r.replies > 1 ? ` — ${r.replies} ta javob` : ''}`);
  const more = rows.length > SHOWN ? [`… yana ${rows.length - SHOWN} ta mijoz`] : [];
  return [
    `🤖 <b>Bugun Palantir o'zi ${rows.length} ta mijozga javob berdi</b> (${total} ta xabar):`,
    ...lines, ...more,
    '', '<i>Yozishmalar: panel → AI administrator → Yozishmalar. Qabullar va javob bilmagan savollar sizga darhol aytilgan.</i>',
  ].join('\n');
}
