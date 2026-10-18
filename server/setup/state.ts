/**
 * O'rnatish holati (businesses.setup): anketadan kelib, hali hal qilinmagan narsalar va egasida nimalar borligi.
 * Bilim emas — ulash ustasi va «bo'shliqlar» savollari uchun. Buzilgan JSON o'rnatishni to'xtatmaydi: bo'sh holat qaytadi.
 */
import type { CrmKind, Hours } from '../../src/lib/anketa';
import type { PriceConflict } from '../../src/lib/prices';
import { businesses, type BusinessRow } from '../db';

export interface SetupState {
  /** Bitta xizmatga ikki xil narx — egasi qaysi biri to'g'riligini aytguncha jadvalga olinmaydi */
  conflicts: PriceConflict[];
  /** Anketadagi ish vaqti kunma-kun (bo'sh kun — egasi yozmagan, so'raladi) */
  hours: Hours | null;
  /** Egasida bor kanallar: ulash ustasi qadamlarni shundan oldindan to'ldiradi */
  has: { instagram: string; telegramPhone: string; crm: CrmKind; cameras: number; cameraBrand: string };
  /** Qaysi anketadan va qachon yuklangan */
  anketa: { code: string | null; importedAt: string } | null;
}

export const emptySetup = (): SetupState => ({ conflicts: [], hours: null, has: { instagram: '', telegramPhone: '', crm: '', cameras: 0, cameraBrand: '' }, anketa: null });

export function setupOf(biz: BusinessRow): SetupState {
  if (!biz.setup) return emptySetup();
  try {
    const s = JSON.parse(biz.setup) as Partial<SetupState>;
    const base = emptySetup();
    return {
      conflicts: Array.isArray(s.conflicts) ? s.conflicts.filter(c => typeof c?.name === 'string' && Array.isArray(c.prices)) : [],
      hours: s.hours && typeof s.hours === 'object' ? s.hours : null,
      has: { ...base.has, ...(s.has ?? {}) },
      anketa: s.anketa ?? null,
    };
  } catch {
    return emptySetup();
  }
}

/** Holatni o'zgartiradi (bazadagi eng yangisi ustidan) */
export function updateSetup(bizId: string, change: (s: SetupState) => SetupState): SetupState {
  const fresh = businesses.byId(bizId);
  const next = change(fresh ? setupOf(fresh) : emptySetup());
  businesses.update(bizId, { setup: JSON.stringify(next) });
  return next;
}
