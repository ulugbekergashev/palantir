/**
 * Reklama kabinetiga yo'l — pul qo'riqchisi (limitlar, kuzatuv, to'xtatish, tasdiq kartasi) shu bir nechta amal orqali ishlaydi:
 *  - meta — Meta Graph, Facebook tokeni bilan (graph.ts);
 *  - pipeboard — Pipeboard MCP asboblari, Pipeboard tokeni bilan. Meta tokeni Palantir'ga kelmaydi; javoblar — Graph JSON matni
 *    (asbob manba kodi: github.com/pipeboard-co/meta-ads-mcp, 2026-11-21);
 *  - claudeai — Meta'ning rasmiy MCP serveri egasining claude.ai ulagichi orqali (claudeai.ts ijrochisi). Argument va javob shakllari
 *    haqiqiy kabinetda o'qib ko'rilgan (2026-11-22): ads_get_ad_entities {ad_account_id, level, fields, object_ids | filtering,
 *    date_preset} → {"ad_entities": "<JSON>"}, summa {value, unit} asosiy birlikda; ads_update_entity {entity_id, entity_type,
 *    fields: "<JSON>"} — byudjet sentlarda.
 * Javob o'qilmasa — null yoki xato: qo'riqchi buni «noma'lum» deb oladi va hech narsa yoqmaydi (kampaniya kuzatuvda qoladi).
 * Pipeboard'da to'xtatishdan keyin holat qayta o'qiladi: to'xtamagan bo'lsa — xato (egasiga «darhol Ads Manager'da to'xtating»)
 */
import { caiOne, callMeta } from './claudeai';
import { AdsError, graph } from './graph';
import { McpCallError, endpointOf, mcpCall, type AdsVia } from './mcpClient';
import { toMinor } from './plan';

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

interface Conn { token: string; adAccountId: string; via?: AdsVia; currency?: string }

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

// ─── claude.ai ulagichi (Meta'ning rasmiy MCP serveri, claudeai.ts ijrochisi orqali) ──────────────

/** Meta MCP'dagi summa: {value: "2", unit: "USD"} — asosiy birlikda; Palantir ichida — eng kichik birlikda (Graph kabi) */
interface MetaMoney { value?: unknown; unit?: unknown }
const minorOf = (m: unknown, fallbackCur: string): string | undefined => {
  if (!m || typeof m !== 'object') return undefined;
  const { value, unit } = m as MetaMoney;
  const n = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return undefined;
  return String(toMinor(n, typeof unit === 'string' && unit ? unit : fallbackCur));
};
const majorOf = (m: unknown): number | null => {
  const n = m && typeof m === 'object' ? Number.parseFloat(String((m as MetaMoney).value ?? '')) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

type MetaRow = Record<string, unknown>;

/** ads_get_ad_entities javobi: {"ad_entities": "<JSON massiv satri>"} (yoki massivning o'zi). Shakl boshqacha — xato */
export function metaRows(text: string): MetaRow[] {
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new AdsError("Meta javobi o'qilmadi"); }
  let rows = o && typeof o === 'object' ? (o as { ad_entities?: unknown }).ad_entities : undefined;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { throw new AdsError("Meta javobi o'qilmadi"); } }
  if (!Array.isArray(rows)) throw new AdsError("Meta ma'lumot bermadi");
  return rows.filter((r): r is MetaRow => !!r && typeof r === 'object');
}

/** Sahifalar ro'yxatidan shu raqamli sahifa (page_id/page_name yoki id/name) */
function pageIn(text: string, pageId: string): { name: string } | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  const walk = (v: unknown, depth: number): { name: string } | null => {
    if (!v || typeof v !== 'object' || depth > 5) return null;
    const r = v as Record<string, unknown>;
    if (!Array.isArray(v) && String(r.page_id ?? r.id ?? '') === pageId) return { name: String(r.page_name ?? r.name ?? '') };
    for (const x of Object.values(v)) { const hit = walk(x, depth + 1); if (hit) return hit; }
    return null;
  };
  return walk(o, 0);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function claudeaiApi(c: Conn): AdsApi {
  const cur = c.currency ?? 'USD';
  const look = () => callMeta('report_measure_or_look_up');
  const base = (level: string, fields: string[], extra: Record<string, unknown> = {}) => ({ ad_account_id: c.adAccountId, level, fields, ...extra, ...look() });
  const rows = async (level: string, fields: string[], extra: Record<string, unknown> = {}): Promise<MetaRow[]> => {
    try {
      return metaRows(await caiOne('ads_get_ad_entities', base(level, fields, extra)));
    } catch (e) {
      throw e instanceof AdsError ? e : new AdsError((e as Error).message, null, !(e instanceof McpCallError && e.refused));
    }
  };
  const byId = (list: MetaRow[], id: string) => list.find(r => String(r.id ?? '') === id) ?? null;
  const api: AdsApi = {
    via: 'claudeai',
    async campaign(id) {
      const r = byId(await rows('campaign', ['id', 'name', 'objective', 'daily_budget', 'lifetime_budget', 'stop_time', 'effective_status'], { object_ids: [id] }).catch(() => []), id);
      if (!r) return null;
      return { name: str(r.name), objective: str(r.objective) ?? 'UNKNOWN', daily_budget: minorOf(r.daily_budget, cur), lifetime_budget: minorOf(r.lifetime_budget, cur), stop_time: str(r.stop_time) };
    },
    async parentCampaign(id) {
      for (const level of ['adset', 'ad']) {
        const r = byId(await rows(level, ['id', 'campaign_id'], { object_ids: [id] }).catch(() => []), id);
        if (r?.campaign_id) return String(r.campaign_id);
      }
      return null;
    },
    async adsets(campaignId) {
      const list = await rows('adset', ['id', 'campaign_id', 'daily_budget', 'lifetime_budget', 'end_time', 'effective_status'], { filtering: [{ field: 'campaign.id', operator: 'IN', value: [campaignId] }] }).catch(() => null);
      return list === null ? null : list.filter(r => String(r.campaign_id ?? '') === campaignId)
        .map(r => ({ daily_budget: minorOf(r.daily_budget, cur), lifetime_budget: minorOf(r.lifetime_budget, cur), end_time: str(r.end_time), effective_status: str(r.effective_status) }));
    },
    async status(campaignId) {
      const list = await rows('campaign', ['id', 'effective_status'], { object_ids: [campaignId] }).catch(() => null);
      if (!list) return null;
      const r = byId(list, campaignId);
      return r ? String(r.effective_status ?? '') : null;
    },
    async spend(objectId, preset) {
      const account = objectId.startsWith('act_');
      const list = await rows(account ? 'ad_account' : 'campaign', ['id', 'amount_spent'], { date_preset: preset, ...(account ? {} : { object_ids: [objectId] }) });
      // Qator yoki summa yo'q — «noma'lum» (0 deb olinmaydi: limit nazorati ko'r bo'lib qolardi)
      const r = account ? list[0] : byId(list, objectId);
      const n = r ? majorOf(r.amount_spent) : null;
      if (n === null) throw new AdsError("Meta sarf ma'lumotini bermadi");
      return n;
    },
    async pause(campaignId) {
      try {
        await caiOne('ads_update_entity', { ad_account_id: c.adAccountId, entity_id: campaignId, entity_type: 'campaign', fields: JSON.stringify({ status: 'PAUSED' }), ...callMeta('update_existing_campaigns') });
      } catch (e) {
        throw e instanceof AdsError ? e : new AdsError((e as Error).message);
      }
      // Haqiqatan to'xtadimi — qayta o'qiladi
      const st = (await api.status(campaignId) ?? '').toUpperCase();
      if (!STOPPED_STATES.has(st)) throw new AdsError(`Meta to'xtatishni tasdiqlamadi (holat: ${st || "noma'lum"})`);
    },
    async recentCampaigns() {
      const list = await rows('campaign', ['id', 'created_time', 'effective_status']).catch(() => []);
      return list.map(r => ({ id: str(String(r.id ?? '')), created_time: str(r.created_time), effective_status: str(r.effective_status) }));
    },
    async account() {
      let text: string;
      try { text = await caiOne('ads_get_ad_accounts', look()); } catch (e) { throw new AdsError((e as Error).message); }
      const list = (() => { try { return (JSON.parse(text) as { ad_accounts?: unknown }).ad_accounts; } catch { return null; } })();
      if (!Array.isArray(list)) throw new AdsError("Meta kabinetlar ro'yxatini bermadi");
      const a = list.find(x => x && typeof x === 'object' && String((x as MetaRow).ad_account_id ?? '') === c.adAccountId) as MetaRow | undefined;
      if (!a) throw new AdsError("Bu reklama kabineti claude.ai'dagi Meta ulagichida ko'rinmadi");
      const ok = a.account_status === 'ACTIVE' && a.is_queryable !== false && a.is_ads_mcp_enabled !== false;
      return { name: str(a.ad_account_name), currency: str(a.currency), account_status: ok ? 1 : 0, timezone_name: '' };
    },
    async pageName(pageId) {
      for (const [tool, args] of [['ads_get_ad_account_pages', { ad_account_id: c.adAccountId, ...look() }], ['ads_get_user_pages', look()]] as const) {
        const text = await caiOne(tool, args).catch(() => '');
        const hit = pageIn(text, pageId);
        if (hit) return hit.name;
      }
      throw new AdsError("Bu Facebook sahifa claude.ai'dagi Meta ulagichida ko'rinmadi");
    },
  };
  return api;
}

export const apiOf = (c: Conn): AdsApi => (c.via === 'pipeboard' ? pipeboardApi(c) : c.via === 'claudeai' ? claudeaiApi(c) : graphApi(c));
