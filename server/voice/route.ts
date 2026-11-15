/**
 * Kiruvchi qo'ng'iroqni kim oladi — sof qoida (bazaga tegmaydi; sinovlar to'g'ridan-to'g'ri chaqiradi):
 *   ai          — har doim AI;
 *   ai_transfer — har doim AI; ish vaqtida AI javob bera olmasa (yoki mijoz odam so'rasa) — administratorga o'tkazadi;
 *   day_admin   — ish vaqtida avval administrator, qolgan paytda AI;
 *   human       — faqat administrator, AI qo'ng'iroq olmaydi (kechasi ham): «human:45». Egasi telefonda AI'ni o'chiradigan yo'l —
 *                 AI administrator jamoadan chiqmaydi (B1); oldin uni olib tashlagan klinikalar shu rejimga ko'chirildi (server/migrate.ts v3)
 */
export type LineMode = 'ai' | 'ai_transfer' | 'day_admin' | 'human';
export interface LineRouting { mode: LineMode; ring: number; days: number[]; from: string; to: string }

export const LINE_MODES: LineMode[] = ['ai', 'ai_transfer', 'day_admin', 'human'];

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** Hozir ish vaqtimi (kunlar 1 — dushanba … 7 — yakshanba; tun bo'ylab oraliq ham bo'ladi: 20:00–08:00) */
function inHours(r: LineRouting, at: Date): boolean {
  const day = ((at.getDay() + 6) % 7) + 1, m = at.getHours() * 60 + at.getMinutes();
  const a = toMin(r.from), b = toMin(r.to);
  return r.days.includes(day) && (a <= b ? m >= a && m < b : m >= a || m < b);
}

/** AI yo'q paytda administrator telefoni shuncha jiringlaydi; ko'tarilmasa — uzr va «qayta qo'ng'iroq qiling» so'rovi */
export const HUMAN_RING_SEC = 45;

/**
 * Hozir kim javob beradi (sof funksiya): «admin:20» — avval administrator 20 soniya (keyin AI), «ai» — darhol AI,
 * «human:45» — faqat administrator («Faqat administrator» rejimi; ko'tarmasa — AI emas, «qayta qo'ng'iroq qiling» so'rovi)
 */
export function routeNow(r: LineRouting, at: Date): string {
  if (r.mode === 'human') return `human:${Math.max(r.ring, HUMAN_RING_SEC)}`;
  return r.mode === 'day_admin' && inHours(r, at) ? `admin:${r.ring}` : 'ai';
}

/** AI hozir administratorga o'tkaza oladimi: ha bo'lsa — necha soniya jiringlaydi, yo'q bo'lsa — null */
export function transferNow(r: LineRouting, at: Date): number | null {
  return r.mode === 'ai_transfer' && inHours(r, at) ? r.ring : null;
}
