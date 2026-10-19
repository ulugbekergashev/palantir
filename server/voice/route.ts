/** Kiruvchi qo'ng'iroqni kim oladi — sof qoida (bazaga tegmaydi; sinovlar to'g'ridan-to'g'ri chaqiradi) */
export type LineMode = 'ai' | 'day_admin';
export interface LineRouting { mode: LineMode; ring: number; days: number[]; from: string; to: string }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** Hozir kim javob beradi (sof funksiya): ish vaqtida — administrator (ring soniya), qolgan paytda — AI */
export function routeNow(r: LineRouting, at: Date): string {
  if (r.mode !== 'day_admin') return 'ai';
  const day = ((at.getDay() + 6) % 7) + 1, m = at.getHours() * 60 + at.getMinutes();
  const a = toMin(r.from), b = toMin(r.to);
  const inHours = r.days.includes(day) && (a <= b ? m >= a && m < b : m >= a || m < b);
  return inHours ? `admin:${r.ring}` : 'ai';
}
