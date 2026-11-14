/**
 * Tinch soatlar: Hub sotuvchiga «klinika bilan aloqa yo'q» deb kechasi yozmaydi (H4). Klinikalar kechqurun kompyuterni o'chiradi —
 * har klinikadan kuniga ikki xabar («aloqa yo'q», «yana aloqada») haqiqiy muammoni ko'mib yuborardi.
 * spec — «20-9» (Toshkent vaqti bilan 20:00 dan 09:00 gacha); bo'sh yoki noto'g'ri — tinch soat yo'q.
 */
const TASHKENT_UTC_OFFSET = 5;

export function quietNow(spec: string, at: Date): boolean {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(spec);
  if (!m) return false;
  const from = Number(m[1]), to = Number(m[2]);
  if (from > 23 || to > 23 || from === to) return false;
  const hour = (at.getUTCHours() + TASHKENT_UTC_OFFSET) % 24;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
