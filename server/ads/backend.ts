/**
 * Reklama kabinetiga yo'l — pul qo'riqchisi (limitlar, kuzatuv, to'xtatish, tasdiq kartasi) shu bir nechta amal orqali ishlaydi:
 *  - meta — Meta Graph, Facebook tokeni bilan (graph.ts);
 *  - pipeboard — Pipeboard MCP asboblari, Pipeboard tokeni bilan. Meta tokeni Palantir'ga kelmaydi; javoblar — Graph JSON matni
 *    (asbob manba kodi: github.com/pipeboard-co/meta-ads-mcp, 2026-11-21).
 * Javob o'qilmasa — null yoki xato: qo'riqchi buni «noma'lum» deb oladi va hech narsa yoqmaydi (kampaniya kuzatuvda qoladi).
 * Pipeboard'da to'xtatishdan keyin holat qayta o'qiladi: to'xtamagan bo'lsa — xato (egasiga «darhol Ads Manager'da to'xtating»)
 */
import { AdsError, graph } from './graph';
import { McpCallError, endpointOf, mcpCall, type AdsVia } from './mcpClient';

export interface CampNode { name?: string; daily_budget?: string; lifetime_budget?: string; stop_time?: string; objective?: string }
export interface SetNode { daily_budget?: string; lifetime_budget?: string; end_time?: string; effective_status?: string }
export interface AccountNode { name?: string; currency?: string; account_status?: number; timezone_name?: string }
export interface RecentCampaign { id?: string; created_time?: string; effective_status?: string }
export type Preset = 'today' | 'this_month' | 'maximum';

export interface AdsApi {
  readonly via: AdsVia;
  /** Kampaniya (guruh yoki reklama bo'lsa — null) */
  campaign(id: string): Promise<CampNode | null>;
  /** Guruh yoki reklamaning kampaniyasi */
  parentCampaign(id: string): Promise<string | null>;
  /** Kampaniya guruhlari (byudjeti guruhlarda bo'lsa) */
  adsets(campaignId: string): Promise<SetNode[] | null>;
  /** Kampaniyaning hozirgi holati; o'qilmasa — null */
  status(campaignId: string): Promise<string | null>;
  /** Sarf: butun kabinet (act_…) yoki bitta kampaniya. O'qilmasa — xato */
  spend(objectId: string, preset: Preset): Promise<number>;
  /** Kampaniyani to'xtatish (xatoda — xato) */
  pause(campaignId: string): Promise<void>;
  /** Kabinetdagi oxirgi kampaniyalar (boost javobida raqam bo'lmasa) */
  recentCampaigns(): Promise<RecentCampaign[]>;
  account(): Promise<AccountNode>;
  /** Sahifa nomi; sahifa bu yo'lda ko'rinmasa — xato */
  pageName(pageId: string): Promise<string>;
}

interface Conn { token: string; adAccountId: string; via?: AdsVia }

const act = (c: Conn) => `act_${c.adAccountId}`;
const num = (v: unknown): number => Number.parseFloat(String(v ?? '0')) || 0;

// ─── Meta Graph ───────────────────────────────────────────────────────────────

function graphApi(c: Conn): AdsApi {
  return {
    via: 'meta',
    async campaign(id) {
      // «objective» faqat kampaniyada bor: guruh va reklamada so'rov xato qaytaradi
      const n = await graph<CampNode>(c.token, 'GET', id, { fields: 'name,daily_budget,lifetime_budget,stop_time,objective' }).catch(() => null);
      return n?.objective ? n : null;
    },
    async parentCampaign(id) {
      const p = await graph<{ campaign_id?: string }>(c.token, 'GET', id, { fields: 'campaign_id' }).catch(() => null);
      return p?.campaign_id ?? null;
    },
    async adsets(campaignId) {
      const r = await graph<{ data?: SetNode[] }>(c.token, 'GET', `${campaignId}/adsets`, { fields: 'daily_budget,lifetime_budget,end_time,effective_status', limit: 100 }).catch(() => null);
      return r ? r.data ?? [] : null;
    },
    async status(campaignId) {
      const r = await graph<{ effective_status?: string }>(c.token, 'GET', campaignId, { fields: 'effective_status' }).catch(() => null);
      return r ? r.effective_status ?? '' : null;
    },
    async spend(objectId, preset) {
      const r = await graph<{ data?: { spend?: string }[] }>(c.token, 'GET', `${objectId}/insights`, { fields: 'spend', date_preset: preset });
      return num(r.data?.[0]?.spend);
    },
    async pause(campaignId) {
      await graph(c.token, 'POST', campaignId, { status: 'PAUSED' });
    },
    async recentCampaigns() {
      const r = await graph<{ data?: RecentCampaign[] }>(c.token, 'GET', `${act(c)}/campaigns`, { fields: 'id,created_time,effective_status', limit: 25 }).catch(() => null);
      return r?.data ?? [];
    },
    account: () => graph<AccountNode>(c.token, 'GET', act(c), { fields: 'name,currency,account_status,timezone_name' }),
    async pageName(pageId) {
      return (await graph<{ name?: string }>(c.token, 'GET', pageId, { fields: 'name' })).name ?? '';
    },
  };
}

// ─── Pipeboard MCP ────────────────────────────────────────────────────────────

/** Asbob natijasi — JSON (xato — {"error": …}, mcpCall uni McpCallError qiladi). JSON bo'lmasa — xato */
export async function pipeboardJson<T>(token: string, tool: string, args: Record<string, unknown>): Promise<T> {
  let text: string;
  try {
    text = await mcpCall(endpointOf({ token, via: 'pipeboard' }), tool, args);
  } catch (e) {
    throw new AdsError(e instanceof McpCallError ? e.message : 'Pipeboard javob bermadi', null, !(e instanceof McpCallError && e.refused));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdsError(`Pipeboard javobi o'qilmadi (${tool})`);
  }
}

/** Kampaniya Meta'da pul sarflamaydigan holatlar */
export const STOPPED_STATES: ReadonlySet<string> = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'DELETED']);

/** JSON ichidan shu raqamli obyektni topish (sahifalar ro'yxati shakli asbobga qarab farq qilishi mumkin) */
function findById(v: unknown, id: string, depth = 0): { name?: unknown } | null {
  if (!v || typeof v !== 'object' || depth > 5) return null;
  if (!Array.isArray(v) && String((v as { id?: unknown }).id ?? '') === id) return v as { name?: unknown };
  for (const x of Object.values(v)) {
    const hit = findById(x, id, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function pipeboardApi(c: Conn): AdsApi {
  const call = <T>(tool: string, args: Record<string, unknown>) => pipeboardJson<T>(c.token, tool, args);
  type Node = CampNode & { status?: string; effective_status?: string; configured_status?: string; campaign_id?: string };
  const api: AdsApi = {
    via: 'pipeboard',
    async campaign(id) {
      const n = await call<Node>('get_campaign_details', { campaign_id: id }).catch(() => null);
      return n?.objective ? n : null;
    },
    async parentCampaign(id) {
      const set = await call<Node>('get_adset_details', { adset_id: id }).catch(() => null);
      if (set?.campaign_id) return String(set.campaign_id);
      const ad = await call<Node>('get_ad_details', { ad_id: id }).catch(() => null);
      return ad?.campaign_id ? String(ad.campaign_id) : null;
    },
    async adsets(campaignId) {
      const r = await call<{ data?: (SetNode & { status?: string })[] }>('get_adsets', { account_id: act(c), campaign_id: campaignId, limit: 100 }).catch(() => null);
      if (!r || !Array.isArray(r.data)) return null;
      return r.data.map(s => ({ ...s, effective_status: s.effective_status ?? s.status }));
    },
    async status(campaignId) {
      const n = await call<Node>('get_campaign_details', { campaign_id: campaignId }).catch(() => null);
      return n ? String(n.effective_status ?? n.status ?? n.configured_status ?? '') : null;
    },
    async spend(objectId, preset) {
      const level = objectId.startsWith('act_') ? 'account' : 'campaign';
      const r = await call<{ data?: { spend?: string }[] }>('get_insights', { object_id: objectId, time_range: preset, level });
      // Ma'lumot shakli kutilganidek bo'lmasa — «noma'lum» (0 deb olinmaydi: limit nazorati ko'r bo'lib qolardi)
      if (!r || !Array.isArray(r.data)) throw new AdsError("Pipeboard sarf ma'lumotini bermadi");
      return num(r.data[0]?.spend);
    },
    async pause(campaignId) {
      await call('update_campaign', { campaign_id: campaignId, status: 'PAUSED' });
      // Haqiqatan to'xtadimi — qayta o'qiladi
      const st = (await api.status(campaignId) ?? '').toUpperCase();
      if (!STOPPED_STATES.has(st)) throw new AdsError(`Pipeboard to'xtatishni tasdiqlamadi (holat: ${st || "noma'lum"})`);
    },
    async recentCampaigns() {
      const r = await call<{ data?: (RecentCampaign & { status?: string })[] }>('get_campaigns', { account_id: act(c), limit: 25 }).catch(() => null);
      return (r?.data ?? []).map(x => ({ ...x, effective_status: x.effective_status ?? x.status }));
    },
    account: () => call<AccountNode>('get_account_info', { account_id: act(c), fields: 'name,currency,account_status,timezone_name' }),
    async pageName(pageId) {
      for (const account_id of [act(c), 'me']) {
        const r = await call<unknown>('get_account_pages', { account_id }).catch(() => null);
        const hit = findById(r, pageId);
        if (hit) return typeof hit.name === 'string' ? hit.name : '';
      }
      throw new AdsError("Bu Facebook sahifa Pipeboard'ga ulangan akkauntda topilmadi");
    },
  };
  return api;
}

export const apiOf = (c: Conn): AdsApi => (c.via === 'pipeboard' ? pipeboardApi(c) : graphApi(c));
