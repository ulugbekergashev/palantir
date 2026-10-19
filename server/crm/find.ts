/**
 * Shu kompyuterdagi DentaCRM'ni topish: lokal nashr odatda shu kompyuterda, 3001-portda ishlaydi. Litsenziya holati yo'li
 * (kirishsiz ochiq) DentaCRM'nikiga o'xshab javob bersa — manzili qaytadi, egasi faqat login va parolni yozadi.
 */
import { readCapped } from '../readCapped';

export const LOCAL_CRM = 'http://localhost:3001';
const FIND_TIMEOUT_MS = 1500;
const BODY_LIMIT = 4096;

/** allowPrivate — umumiy serverda (CRM_ALLOW_PRIVATE=0) mahalliy manzillar so'ralmaydi */
export async function findLocalCrm(base = LOCAL_CRM, allowPrivate = true): Promise<string | null> {
  if (!allowPrivate) return null;
  try {
    const r = await fetch(`${base.replace('//localhost', '//127.0.0.1')}/api/license/status`, { signal: AbortSignal.timeout(FIND_TIMEOUT_MS) });
    if (!r.ok) return null;
    const j = JSON.parse(await readCapped(r, BODY_LIMIT)) as Record<string, unknown>;
    return typeof j.activated === 'boolean' && typeof j.machineId === 'string' ? base : null;
  } catch {
    return null;
  }
}
