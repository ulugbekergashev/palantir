/** Litsenziya holati — sof hisob (bazaga tegmaydi; license.ts va sinovlar ishlatadi) */
import { iso } from '../src/lib/week';

export const GRACE_DAYS = 7;
/** Muddat tugashidan shuncha kun oldin ogohlantiriladi */
const WARN_DAYS = 7;
const DAY_MS = 86_400_000;

/** Oxirgi tasdiq: hub qaytargan muddat va to'xtatilgani, qachon tasdiqlangani; hech tasdiqlanmagan bo'lsa — birinchi ishga tushgan payt */
export interface LicenseSaved { until: string | null; suspended: boolean; checkedAt: string | null; firstSeenAt: string }
export type LicenseState = 'none' | 'ok' | 'expiring' | 'expired' | 'suspended' | 'unverified';
export interface LicenseView { state: LicenseState; until: string | null; message: string | null }

/** Sof hisob: saqlangan tasdiq va hozirgi vaqtdan holat va egasiga aytiladigan gap */
export function licenseStateOf(s: LicenseSaved, now: Date, hub: boolean): LicenseView {
  if (!hub) return { state: 'none', until: null, message: null };
  const since = Date.parse(s.checkedAt ?? s.firstSeenAt);
  if (!Number.isFinite(since) || now.getTime() - since > GRACE_DAYS * DAY_MS) {
    return { state: 'unverified', until: s.until, message: `Litsenziya ${GRACE_DAYS} kundan beri tekshirilmadi — internet va Palantir Hub bilan aloqani tekshiring` };
  }
  if (s.suspended) return { state: 'suspended', until: s.until, message: "Litsenziya to'xtatilgan — sotuvchi bilan bog'laning" };
  if (!s.until) return { state: 'ok', until: null, message: null };
  const today = iso(now);
  if (s.until < today) return { state: 'expired', until: s.until, message: `Litsenziya muddati ${s.until} da tugagan — uzaytirish uchun sotuvchi bilan bog'laning` };
  if (s.until <= iso(new Date(now.getTime() + WARN_DAYS * DAY_MS))) return { state: 'expiring', until: s.until, message: `Litsenziya ${s.until} da tugaydi — uzaytirishni unutmang` };
  return { state: 'ok', until: s.until, message: null };
}

