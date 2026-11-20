/**
 * Meta obyekti (kampaniya, guruh yoki reklama) → uning kampaniyasi, byudjeti va muddati — Graph'dan (kuzatuv va tasdiq uchun).
 * Byudjet kampaniyada bo'lmasa — jonli guruhlar yig'indisi; bitta guruh muddatsiz bo'lsa — kampaniya ham muddatsiz
 */
import { graph } from './graph';
import { fromMinor } from './plan';
import type { AdsConnection, Tracked } from './store';

export type Entity = Omit<Tracked, 'status' | 'stopReason'>;
interface CampNode { name?: string; daily_budget?: string; lifetime_budget?: string; stop_time?: string; objective?: string }
interface SetNode { daily_budget?: string; lifetime_budget?: string; end_time?: string; effective_status?: string }

/** Bir martada shuncha obyekt: ko'prog'i tasdiqlanmaydi (kartada hammasi ko'rinmaydi) */
export const MAX_ENTITIES = 10;

const amount = (v: string | undefined, cur: string): number | null => (v && Number(v) > 0 ? fromMinor(Number(v), cur) : null);

export async function campaignOf(c: AdsConnection, id: string, depth = 0): Promise<Entity | null> {
  // «objective» faqat kampaniyada bor: guruh va reklamada so'rov xato qaytaradi
  const camp = await graph<CampNode>(c.token, 'GET', id, { fields: 'name,daily_budget,lifetime_budget,stop_time,objective' }).catch(() => null);
  if (!camp?.objective) {
    if (depth) return null;
    const parent = await graph<{ campaign_id?: string }>(c.token, 'GET', id, { fields: 'campaign_id' }).catch(() => null);
    return parent?.campaign_id ? campaignOf(c, parent.campaign_id, 1) : null;
  }
  let daily = amount(camp.daily_budget, c.currency), lifetime = amount(camp.lifetime_budget, c.currency), endsAt = camp.stop_time ?? null;
  if (daily === null && lifetime === null) {
    const sets = await graph<{ data?: SetNode[] }>(c.token, 'GET', `${id}/adsets`, { fields: 'daily_budget,lifetime_budget,end_time,effective_status', limit: 100 }).catch(() => null);
    const live = (sets?.data ?? []).filter(s => !['DELETED', 'ARCHIVED'].includes((s.effective_status ?? '').toUpperCase()));
    const sum = (k: 'daily_budget' | 'lifetime_budget') => live.reduce((n, s) => n + (amount(s[k], c.currency) ?? 0), 0) || null;
    daily = sum('daily_budget');
    lifetime = sum('lifetime_budget');
    // Muddatsiz guruh bor — kampaniya ham muddatsiz (aks holda «tugadi» deb kuzatuvdan chiqib ketardi)
    endsAt = live.length && live.every(s => s.end_time) ? live.map(s => s.end_time!).sort().at(-1)! : null;
  }
  if (endsAt !== null && Number.isNaN(Date.parse(endsAt))) endsAt = null;
  return { campaignId: id, name: camp.name ?? id, daily, lifetime, endsAt };
}

export async function campaignsOf(c: AdsConnection, ids: readonly string[]): Promise<Entity[]> {
  const found = new Map<string, Entity>();
  for (const id of ids.slice(0, MAX_ENTITIES)) {
    const e = await campaignOf(c, id);
    if (e) found.set(e.campaignId, e);
  }
  return [...found.values()];
}

/** Hisobdagi shu vaqtdan keyin yaratilgan ishlayotgan kampaniyalar (boost javobida raqam topilmasa) */
export async function createdSince(c: AdsConnection, sinceMs: number): Promise<string[]> {
  const r = await graph<{ data?: { id?: string; created_time?: string; effective_status?: string }[] }>(c.token, 'GET', `act_${c.adAccountId}/campaigns`,
    { fields: 'id,created_time,effective_status', limit: 25 }).catch(() => null);
  return (r?.data ?? []).filter(x => x.id && x.created_time && Date.parse(x.created_time) >= sinceMs - 60_000 && !['PAUSED', 'DELETED', 'ARCHIVED'].includes((x.effective_status ?? '').toUpperCase()))
    .map(x => x.id!);
}
