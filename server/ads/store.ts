/**
 * Targetolog ma'lumotlari: Meta ulanishi (connections 'meta_ads' — token shifrlangan), qat'iy limitlar va kampaniyalar.
 * Holat faqat kutilgan holatdan o'zgaradi (move): ikki bosish ikki kampaniya yaratmaydi
 */
import type { AdCampaign } from '../../src/types';
import { connections, newId, sql, type Row } from '../db';
import { open, seal } from '../secret';
import type { AdsVia } from './mcpClient';
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
-- Meta MCP orqali: pul sarflaydigan amal egasining tugmasini kutadi (mcp.ts)
CREATE TABLE IF NOT EXISTS ads_mcp_actions (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, tool TEXT NOT NULL, action TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
  result TEXT, created_at TEXT NOT NULL, done_at TEXT
);
-- Egasi tasdiqlab yoqilgan (MCP orqali yaratilgan) kampaniyalar: kuzatuv ularni ham limitda to'xtatadi
CREATE TABLE IF NOT EXISTS ads_tracked (
  business_id TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL, daily REAL, lifetime REAL, ends_at TEXT, status TEXT NOT NULL,
  stop_reason TEXT, approved_at TEXT NOT NULL, PRIMARY KEY (business_id, campaign_id)
);
`);
// Server yaratish paytida to'xtagan: Meta'da qisman yaratilgan bo'lishi mumkin (pauzada — pul ketmaydi), egasi kabinetda ko'radi
sql.run("UPDATE ads_campaigns SET status = 'failed', error = 'Yaratilayotganda server to''xtadi — Meta kabinetida pauzadagi qoralama qolgan bo''lishi mumkin' WHERE status = 'launching'");
// Bajarilayotganda server to'xtagan: Meta'da bajarilgan-bajarilmagani noma'lum — egasi Ads Manager'da ko'radi
sql.run("UPDATE ads_mcp_actions SET status = 'failed', result = 'Bajarilayotganda server to''xtadi — Ads Manager''da tekshiring' WHERE status = 'running'");

export class TargetError extends Error {}

/** Meta'dagi qismlar: o'chirish va kuzatish uchun */
export interface MetaIds { campaignId?: string; adsetId?: string; creativeIds?: string[]; adIds?: string[]; imageHashes?: string[]; videoIds?: string[] }

/**
 * expiresAt — token muddati (Facebook orqali ulanganda 60 kun; qo'lda kiritilgan tizim foydalanuvchisi tokeni — null).
 * via — kabinetga yo'l: 'meta' (token — Facebook tokeni, Graph va Meta MCP) yoki 'pipeboard' (token — Pipeboard tokeni, faqat ularning MCP'si)
 */
export interface AdsConnection extends AdsAccount { token: string; accountName: string; pageName: string; timezone: string; expiresAt?: string | null; via?: AdsVia }

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
      expiresAt: c.meta.expiresAt || null, via: c.meta.via === 'pipeboard' ? 'pipeboard' : 'meta',
    };
  },
  saveConnection(bizId: string, c: AdsConnection): void {
    connections.save(bizId, 'meta_ads', seal(c.token), { id: c.adAccountId, name: c.accountName, currency: c.currency },
      { pageId: c.pageId, pageName: c.pageName, igActorId: c.igActorId ?? '', timezone: c.timezone, ...(c.expiresAt ? { expiresAt: c.expiresAt } : {}), ...(c.via === 'pipeboard' ? { via: 'pipeboard' } : {}) });
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

// ─── Meta MCP: tasdiq kutayotgan amallar va kuzatuvdagi kampaniyalar ──────────

export type McpAction = 'activate' | 'boost' | 'update';
export interface McpActionRow { id: string; tool: string; action: McpAction; input: unknown; status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; result: string | null; createdAt: string }
/** Kuzatuvdagi kampaniya: summalar kabinet valyutasida; daily yoki lifetime — Meta'dan o'qilgan */
export interface Tracked { campaignId: string; name: string; daily: number | null; lifetime: number | null; endsAt: string | null; status: 'active' | 'paused' | 'finished'; stopReason: string | null }

const toAction = (r: Row): McpActionRow => ({
  id: String(r.id), tool: String(r.tool), action: String(r.action) as McpAction, input: JSON.parse(String(r.input)) as unknown,
  status: String(r.status) as McpActionRow['status'], result: sql.str(r.result), createdAt: String(r.created_at),
});
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const toTracked = (r: Row): Tracked => ({
  campaignId: String(r.campaign_id), name: String(r.name), daily: num(r.daily), lifetime: num(r.lifetime), endsAt: sql.str(r.ends_at),
  status: String(r.status) as Tracked['status'], stopReason: sql.str(r.stop_reason),
});

export const mcpStore = {
  add(bizId: string, tool: string, action: McpAction, input: unknown): McpActionRow {
    const id = newId(12);
    sql.run("INSERT INTO ads_mcp_actions (id, business_id, tool, action, input, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      id, bizId, tool, action, JSON.stringify(input ?? {}).slice(0, 20_000), sql.nowIso());
    return mcpStore.get(bizId, id)!;
  },
  get: (bizId: string, id: string) => sql.one('SELECT * FROM ads_mcp_actions WHERE business_id = ? AND id = ?', toAction, bizId, id),
  /** Holat faqat kutilganidan o'zgaradi: ikki bosish ikki marta bajarmaydi */
  move: (bizId: string, id: string, from: McpActionRow['status'], to: McpActionRow['status'], result: string | null = null) =>
    Number(sql.run('UPDATE ads_mcp_actions SET status = ?, result = COALESCE(?, result), done_at = ? WHERE business_id = ? AND id = ? AND status = ?',
      to, result, sql.nowIso(), bizId, id, from).changes) > 0,

  track(bizId: string, t: Omit<Tracked, 'status' | 'stopReason'>): void {
    sql.run(`INSERT INTO ads_tracked (business_id, campaign_id, name, daily, lifetime, ends_at, status, approved_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT (business_id, campaign_id) DO UPDATE SET name = excluded.name, daily = excluded.daily, lifetime = excluded.lifetime,
        ends_at = excluded.ends_at, status = 'active', stop_reason = NULL, approved_at = excluded.approved_at`,
      bizId, t.campaignId, t.name.slice(0, 200), t.daily, t.lifetime, t.endsAt, sql.nowIso());
  },
  /** Meta'dan qayta o'qilgan byudjet va muddat (holat va tasdiq vaqti o'zgarmaydi) */
  refresh: (bizId: string, t: Omit<Tracked, 'status' | 'stopReason'>) =>
    sql.run('UPDATE ads_tracked SET name = ?, daily = ?, lifetime = ?, ends_at = ? WHERE business_id = ? AND campaign_id = ?',
      t.name.slice(0, 200), t.daily, t.lifetime, t.endsAt, bizId, t.campaignId),
  tracked: (bizId: string, campaignId: string) => sql.one('SELECT * FROM ads_tracked WHERE business_id = ? AND campaign_id = ?', toTracked, bizId, campaignId),
  active: (bizId: string) => sql.many("SELECT * FROM ads_tracked WHERE business_id = ? AND status = 'active' ORDER BY approved_at", toTracked, bizId),
  stop: (bizId: string, campaignId: string, to: 'paused' | 'finished', why: string) =>
    sql.run("UPDATE ads_tracked SET status = ?, stop_reason = ? WHERE business_id = ? AND campaign_id = ? AND status = 'active'", to, why, bizId, campaignId),
  bizWithActive: () => sql.many("SELECT DISTINCT business_id AS b FROM ads_tracked WHERE status = 'active'", r => String(r.b)),
};
