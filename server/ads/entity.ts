/**
 * Meta obyekti (kampaniya, guruh yoki reklama) → uning kampaniyasi, byudjeti va muddati (kuzatuv va tasdiq uchun) — kabinet yo'li
 * orqali (Graph yoki Pipeboard, backend.ts). Byudjet kampaniyada bo'lmasa — jonli guruhlar yig'indisi; bitta guruh muddatsiz bo'lsa —
 * kampaniya ham muddatsiz
 */
import { apiOf } from './backend';
import { fromMinor } from './plan';
import type { AdsConnection, Tracked } from './store';

export type Entity = Omit<Tracked, 'status' | 'stopReason'>;

/** Bir martada shuncha obyekt: ko'prog'i tasdiqlanmaydi (kartada hammasi ko'rinmaydi) */
export const MAX_ENTITIES = 10;

const amount = (v: string | number | undefined, cur: string): number | null => (v !== undefined && Number(v) > 0 ? fromMinor(Number(v), cur) : null);

export async function campaignOf(c: AdsConnection, id: string, depth = 0): Promise<Entity | null> {
  const api = apiOf(c);
  const camp = await api.campaign(id);
  if (!camp) {
    if (depth) return null;
    const parent = await api.parentCampaign(id);
    return parent ? campaignOf(c, parent, 1) : null;
  }
  let daily = amount(camp.daily_budget, c.currency), lifetime = amount(camp.lifetime_budget, c.currency), endsAt = camp.stop_time ?? null;
  if (daily === null && lifetime === null) {
    const sets = await api.adsets(id);
    const live = (sets ?? []).filter(s => !['DELETED', 'ARCHIVED'].includes((s.effective_status ?? '').toUpperCase()));
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
  const list = await apiOf(c).recentCampaigns().catch(() => []);
  return list.filter(x => x.id && x.created_time && Date.parse(x.created_time) >= sinceMs - 60_000 && !['PAUSED', 'DELETED', 'ARCHIVED'].includes((x.effective_status ?? '').toUpperCase()))
    .map(x => x.id!);
}
