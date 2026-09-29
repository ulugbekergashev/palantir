/**
 * Post ustidagi amallar — panel ham, Telegram tugmalari ham shu yerdan o'tadi
 * (ikkala joyda bir xil qoida).
 */
import type { ItemEdit, Lang } from '../src/types';
import { items, type ClinicRow } from './db';
import { isMonday, viewWeek } from './content';

export type Action = 'publish' | 'reject' | 'undo' | 'variant';

/** "2026-09-28-3" — shu klinika haftasidagi haqiqiy post id'si */
export const validItemId = (itemId: string) => /^\d{4}-\d{2}-\d{2}-[0-4]$/.test(itemId) && isMonday(itemId.slice(0, 10));

/** Amalni bajaradi. Xato bo'lsa — egasiga ko'rsatiladigan sabab */
export function applyAction(clinic: ClinicRow, itemId: string, action: Action): string | null {
  if (!validItemId(itemId)) return 'Post topilmadi';
  const row = items.get(clinic.id, itemId);
  if (row?.publishedAt) {
    return action === 'publish' ? 'Allaqachon joylangan' : "Post allaqachon chiqqan — kanaldan o'zingiz o'chirishingiz mumkin";
  }
  switch (action) {
    case 'publish':
      items.update(clinic.id, itemId, { status: 'published', attempts: 0, publishError: null });
      break;
    case 'reject':
      items.update(clinic.id, itemId, { status: 'rejected' });
      break;
    case 'undo':
      items.update(clinic.id, itemId, { status: 'pending' });
      break;
    case 'variant':
      items.update(clinic.id, itemId, { seed: (row?.seed ?? 0) + 1, edits: null, status: 'pending' });
      break;
  }
  return null;
}

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : undefined);

/** Egasining matni (null — AI variantiga qaytarish) */
export function saveEdit(clinic: ClinicRow, itemId: string, edit: Partial<Record<Lang, ItemEdit>> | null): string | null {
  if (!validItemId(itemId)) return 'Post topilmadi';
  if (items.get(clinic.id, itemId)?.publishedAt) return 'Post allaqachon chiqqan';
  const clean: Partial<Record<Lang, ItemEdit>> = {};
  for (const l of ['uz', 'ru'] as Lang[]) {
    const e = edit?.[l];
    if (!e) continue;
    const title = clip(e.title, 120)?.trim();
    const caption = clip(e.caption, 2000);
    if (title || caption !== undefined) clean[l] = { ...(title ? { title } : {}), ...(caption !== undefined ? { caption } : {}) };
  }
  items.update(clinic.id, itemId, { edits: Object.keys(clean).length ? clean : null });
  return null;
}

/** Haftadagi kutilayotgan hamma post — tasdiqlanadi. Nechtasi */
export function publishAll(clinic: ClinicRow, monday: string): string[] {
  const view = viewWeek(clinic, monday);
  const ids = view.items.filter(it => view.status[it.id] === 'pending').map(it => it.id);
  for (const id of ids) items.update(clinic.id, id, { status: 'published', attempts: 0, publishError: null });
  return ids;
}
