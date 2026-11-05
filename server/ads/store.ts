/**
 * Targetolog ma'lumotlari: Meta ulanishi (connections 'meta_ads' — token shifrlangan), qat'iy limitlar va kampaniyalar.
 * Holat faqat kutilgan holatdan o'zgaradi (move): ikki bosish ikki kampaniya yaratmaydi
 */
import type { AdCampaign } from '../../src/types';
import { connections, newId, sql, type Row } from '../db';
import { open, seal } from '../secret';
import { PlanSchema, type AdsAccount, type AdsLimits, type Plan } from './plan';

sql.exec(`
CREATE TABLE IF NOT EXISTS ads_limits (
  business_id TEXT PRIMARY KEY, per_campaign REAL NOT NULL DEFAULT 0, daily REAL NOT NULL DEFAULT 0, monthly REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ads_campaigns (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, task TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}', spent REAL NOT NULL DEFAULT 0, results INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0, error TEXT, stop_reason TEXT, created_at TEXT NOT NULL, launched_at TEXT, ends_at TEXT, checked_at TEXT
);
CREATE INDEX IF NOT EXISTS ads_campaigns_biz ON ads_campaigns (business_id, created_at);
`);
// Server yaratish paytida to'xtagan: Meta'da qisman yaratilgan bo'lishi mumkin (pauzada — pul ketmaydi), egasi kabinetda ko'radi
sql.run("UPDATE ads_campaigns SET status = 'failed', error = 'Yaratilayotganda server to''xtadi — Meta kabinetida pauzadagi qoralama qolgan bo''lishi mumkin' WHERE status = 'launching'");

export class TargetError extends Error {}

/** Meta'dagi qismlar: o'chirish va kuzatish uchun */
export interface MetaIds { campaignId?: string; adsetId?: string; creativeIds?: string[]; adIds?: string[]; imageHashes?: string[]; videoIds?: string[] }

export interface AdsConnection extends AdsAccount { token: string; accountName: string; pageName: string; timezone: string }

const PAGE = 50;

const toCampaign = (r: Row): AdCampaign & { meta: MetaIds } => ({
  id: String(r.id), task: String(r.task), plan: JSON.parse(String(r.plan)) as Plan, status: String(r.status) as AdCampaign['status'],
  currency: String(r.currency), spent: Number(r.spent), results: Number(r.results), clicks: Number(r.clicks), impressions: Number(r.impressions),
  meta: JSON.parse(String(r.meta)) as MetaIds, metaCampaignId: (JSON.parse(String(r.meta)) as MetaIds).campaignId ?? null,
  error: sql.str(r.error), stopReason: sql.str(r.stop_reason), createdAt: String(r.created_at), launchedAt: sql.str(r.launched_at),
  endsAt: sql.str(r.ends_at), checkedAt: sql.str(r.checked_at),
});

export const adsStore = {
  connection(bizId: string): AdsConnection | null {
    const c = connections.get(bizId, 'meta_ads');
    if (!c) return null;
    return {
      token: open(c.secret), adAccountId: c.account.id, accountName: c.account.name ?? '', currency: c.account.currency ?? 'USD',
      pageId: c.meta.pageId ?? '', pageName: c.meta.pageName ?? '', igActorId: c.meta.igActorId || null, timezone: c.meta.timezone ?? '',
    };
  },
  saveConnection(bizId: string, c: AdsConnection): void {
    connections.save(bizId, 'meta_ads', seal(c.token), { id: c.adAccountId, name: c.accountName, currency: c.currency },
      { pageId: c.pageId, pageName: c.pageName, igActorId: c.igActorId ?? '', timezone: c.timezone });
  },
  removeConnection: (bizId: string) => sql.run("DELETE FROM connections WHERE business_id = ? AND kind = 'meta_ads'", bizId),

  limits: (bizId: string): AdsLimits =>
    sql.one('SELECT * FROM ads_limits WHERE business_id = ?', r => ({ perCampaign: Number(r.per_campaign), daily: Number(r.daily), monthly: Number(r.monthly) }), bizId)
    ?? { perCampaign: 0, daily: 0, monthly: 0 },
  saveLimits: (bizId: string, l: AdsLimits) =>
    sql.run(`INSERT INTO ads_limits (business_id, per_campaign, daily, monthly) VALUES (?, ?, ?, ?)
      ON CONFLICT (business_id) DO UPDATE SET per_campaign = excluded.per_campaign, daily = excluded.daily, monthly = excluded.monthly`,
      bizId, l.perCampaign, l.daily, l.monthly),

  campaigns: (bizId: string) => sql.many(`SELECT * FROM ads_campaigns WHERE business_id = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT ${PAGE}`, toCampaign, bizId),
  campaign: (bizId: string, id: string) => sql.one('SELECT * FROM ads_campaigns WHERE business_id = ? AND id = ?', toCampaign, bizId, id),
  live: (bizId: string) => sql.many("SELECT * FROM ads_campaigns WHERE business_id = ? AND status IN ('active', 'paused') ORDER BY created_at", toCampaign, bizId),
  /** Ishlayotgan kampaniyasi bor bizneslar (kuzatuv uchun) */
  bizWithActive: () => sql.many("SELECT DISTINCT business_id AS b FROM ads_campaigns WHERE status = 'active'", r => String(r.b)),
  add(bizId: string, task: string, plan: Plan, currency: string): AdCampaign {
    const id = newId(12);
    sql.run("INSERT INTO ads_campaigns (id, business_id, task, plan, status, currency, created_at) VALUES (?, ?, ?, ?, 'proposed', ?, ?)",
      id, bizId, task.slice(0, 2000), JSON.stringify(PlanSchema.parse(plan)), currency, sql.nowIso());
    return adsStore.campaign(bizId, id)!;
  },
  /** Reja faqat taklif holatida o'zgaradi */
  setPlan: (bizId: string, id: string, plan: Plan) =>
    Number(sql.run("UPDATE ads_campaigns SET plan = ? WHERE business_id = ? AND id = ? AND status = 'proposed'", JSON.stringify(PlanSchema.parse(plan)), bizId, id).changes) > 0,
  setMeta: (bizId: string, id: string, meta: MetaIds) => sql.run('UPDATE ads_campaigns SET meta = ? WHERE business_id = ? AND id = ?', JSON.stringify(meta), bizId, id),
  move: (bizId: string, id: string, from: AdCampaign['status'][], to: AdCampaign['status'], extra: { error?: string | null; stopReason?: string | null; launchedAt?: string; endsAt?: string } = {}) =>
    Number(sql.run(`UPDATE ads_campaigns SET status = ?, error = COALESCE(?, error), stop_reason = ?, launched_at = COALESCE(?, launched_at), ends_at = COALESCE(?, ends_at)
      WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`,
      to, extra.error ?? null, extra.stopReason ?? null, extra.launchedAt ?? null, extra.endsAt ?? null, bizId, id, ...from).changes) > 0,
  setStats: (bizId: string, id: string, s: { spent: number; results: number; clicks: number; impressions: number }) =>
    sql.run('UPDATE ads_campaigns SET spent = ?, results = ?, clicks = ?, impressions = ?, checked_at = ? WHERE business_id = ? AND id = ?',
      s.spent, s.results, s.clicks, s.impressions, sql.nowIso(), bizId, id),
  waiting: (bizId: string) => sql.one("SELECT COUNT(*) AS n FROM ads_campaigns WHERE business_id = ? AND status = 'proposed'", r => Number(r.n), bizId) ?? 0,
};
