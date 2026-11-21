/**
 * Meta reklama MCP asboblari (https://mcp.facebook.com/ads): qaysi birini Targetolog o'zi chaqiradi, qaysi biri egasining tugmasiga ketadi,
 * qaysi biri yopiq. Egasi qarori (2026-11-20, A): o'qish, tahlil, yaratish (Meta hammasini PAUZADA yaratadi) va to'xtatish — o'zi;
 * pul sarflaydigan har narsa — faqat egasi Telegram'da tasdiqlaganda.
 *
 * Nomlar Meta hujjatidan (Ads MCP server → tools, 2026-11-20); kirish maydonlari hujjatda yozilmagan. Shuning uchun hammasi «ruxsat
 * ro'yxati»: noma'lum asbob — yopiq; tahrirlash kartasiz faqat aniq «to'xtatish» yoki «nomini o'zgartirish» bo'lsa — boshqa har qanday
 * shakl (tushunarsiz maydon, chuqur ichma-ich, holat matn emas) — egasining tugmasiga. Meta yangi asbob qo'shsa, avval shu yerga yoziladi.
 *
 * Pipeboard (o'z Meta ilovasi bo'lmaganda, mcpClient.ts) — xuddi shu qoida, ularning asbob nomlari bilan (manba kodi:
 * github.com/pipeboard-co/meta-ads-mcp, 2026-11-21): o'qish — get_/search_/estimate_/validate_; yaratish — faqat PAUSED;
 * update_campaign/adset/ad — faqat to'xtatish yoki nom kartasiz, «ACTIVE» — yoqish kartasi, qolgani (byudjet, stavka…) — tahrir kartasi;
 * byudjet jadvali — karta; nusxa ko'chirish, hisobot va noma'lum asboblar — yopiq.
 */
import type { AdsVia } from './mcpClient';
import type { McpAction } from './store';

export type Verdict = { kind: 'allow'; strangers: boolean } | { kind: 'money'; action: McpAction } | { kind: 'deny'; why: string };

/** O'qish (Meta hujjatidagi aniq nomlar): kabinet, kampaniyalar, natijalar, taqqoslash, ochiq Ad Library, faoliyat jurnali */
const READ = new Set([
  'ads_get_ad_accounts', 'ads_get_ad_account_pages', 'ads_get_pages_for_business', 'ads_get_user_pages', 'ads_get_field_context',
  'ads_get_creatives', 'ads_get_creative_ads', 'ads_get_ad_images', 'ads_get_ad_videos', 'ads_get_ad_preview', 'ads_get_ad_entities',
  'ads_library_search', 'ads_get_ig_accounts', 'ads_get_ig_media', 'ads_get_ad_account_custom_audiences', 'ads_get_custom_audience',
  'ads_get_custom_audience_adsets', 'ads_get_opportunity_score', 'ads_insights_advertiser_context', 'ads_insights_anomaly_signal',
  'ads_insights_auction_ranking_benchmarks', 'ads_insights_industry_benchmark', 'ads_insights_performance_trend', 'ads_account_get_activity_logs',
]);
/** Yaratish — pul ketmaydi (Meta pauzada yaratadi); holat berilsa — faqat PAUSED */
const MAKE = new Set(['ads_create_campaign', 'ads_create_ad_set', 'ads_create_ad', 'ads_create_creative']);
/** Auditoriya: Instagram/sahifa bilan ishlaganlardan — mumkin; odamlarning telefoni, emaili yoki xeshi — yopiq */
const AUDIENCE = new Set(['ads_create_custom_audience', 'ads_update_custom_audience']);
const MONEY: Record<string, McpAction> = { ads_activate_entity: 'activate', ads_boost_ig_post: 'boost' };
/** Boshqalarning reklamalari — begona matn (bilim va xotiraga yozuvchi asboblar shu gapda yopiladi) */
const STRANGERS = new Set(['ads_library_search']);

/** Kartasiz tahrirlashda bo'lishi mumkin bo'lgan maydonlar: raqam, tur, nom va holat — boshqa har qanday maydon egasiga ketadi */
const SAFE_EDIT_KEY = /^(?:(?:\w+_)?ids?|entity_type|type|level|name|(?:configured_)?status)$/i;
/** Holatga o'xshash maydonlar (yaratishda faqat PAUSED) */
const STATE_KEY = /status|paused|enabled|active|state/i;
/** Odamlarning shaxsiy ma'lumoti (auditoriyaga yuklash) */
const PERSONAL_KEY = /e?mail|phone|hash|schema|users?$|members|customer|file|payload|^data$|madid|fn$|ln$|dob/i;
const PERSONAL_VALUE = /@|^\+?\d[\d\s()-]{8,16}$|^[a-f0-9]{64}$/i;
const MAX_DEPTH = 6;

export const CREATE_PAUSED = 'Not run: create it paused (status PAUSED, or leave the status out). Turning it on is the owner\'s decision — call ads_activate_entity afterwards and Palantir sends the owner an approval card.';
export const BLOCKED = "Not run: this Meta tool is closed in Palantir (uploading customers' or patients' data to Meta, catalogs, deleting, tools not on Palantir's list). If the owner needs it, they can do it in Ads Manager themselves.";
export const NO_PEOPLE = "Not run: people's phones, emails or hashes are never uploaded to Meta from Palantir. Audiences from Instagram or Page engagement (or website visitors) are fine.";

interface Leaf { key: string; value: unknown }

/** JSON satr ichidagi obyekt ham ochiladi (masalan, «params»: "{…}") */
const parsed = (s: string): unknown => {
  if (!/^\s*[{[]/.test(s)) return null;
  try { return JSON.parse(s) as unknown; } catch { return null; }
};

/** Kirishning barcha barglari (kalit — oxirgi obyekt kaliti). Juda chuqur — null: tushunarsiz shakl */
function leaves(v: unknown, key = '', depth = 0, out: Leaf[] = []): Leaf[] | null {
  if (depth > MAX_DEPTH) return null;
  const inner = typeof v === 'string' ? parsed(v) : v;
  if (inner === null || typeof inner !== 'object') { out.push({ key, value: v }); return out; }
  for (const [k, x] of Object.entries(inner)) if (!leaves(x, Array.isArray(inner) ? key : k, depth + 1, out)) return null;
  return out;
}

const isPaused = (v: unknown) => typeof v === 'string' && v.trim().toUpperCase() === 'PAUSED';

/** Faqat to'xtatish va/yoki nomini o'zgartirish: hamma maydon xavfsiz, holat bo'lsa — PAUSED, va nimadir o'zgaradi */
function safeEdit(input: unknown): boolean {
  const ls = leaves(input);
  if (!ls?.length || !ls.every(l => SAFE_EDIT_KEY.test(l.key))) return false;
  const states = ls.filter(l => /status/i.test(l.key));
  return states.every(l => isPaused(l.value)) && (states.length > 0 || ls.some(l => /^name$/i.test(l.key)));
}

/** Hamma maydon xavfsiz va holat bor-u, hammasi «ACTIVE»: faqat yoqish */
function onlyActivate(input: unknown): boolean {
  const ls = leaves(input);
  if (!ls?.length || !ls.every(l => SAFE_EDIT_KEY.test(l.key))) return false;
  const states = ls.filter(l => /status/i.test(l.key));
  return states.length > 0 && states.every(l => typeof l.value === 'string' && l.value.trim().toUpperCase() === 'ACTIVE');
}

/** Yaratish: holat berilsa — faqat PAUSED */
const pausedOnly = (input: unknown): Verdict => {
  const ls = leaves(input);
  return ls && ls.filter(l => STATE_KEY.test(l.key)).every(l => isPaused(l.value)) ? { kind: 'allow', strangers: false } : { kind: 'deny', why: CREATE_PAUSED };
};

// ─── Pipeboard ────────────────────────────────────────────────────────────────

const PB_READ = /^(?:get|search|estimate|validate|bulk_get)_[a-z_]+$/;
/** Boshqalarning reklamalari va sahifalari — begona matn */
const PB_STRANGERS = /archive|library|search_pages/;
const PB_MAKE = new Set(['create_campaign', 'create_adset', 'create_ad', 'create_ad_creative', 'upload_ad_image', 'update_ad_creative', 'compute_image_crops']);
const PB_EDIT = new Set(['update_campaign', 'update_adset', 'update_ad']);
const PB_MONEY: Record<string, McpAction> = { create_budget_schedule: 'update' };
export const PB_CREATE_PAUSED = "Not run: create it paused (status PAUSED, or leave the status out). Turning it on is the owner's decision — call update_campaign with status ACTIVE afterwards and Palantir sends the owner an approval card.";

/**
 * Pipeboard tahririda kartasiz/«faqat yoqish» bo'lishi uchun yuqori darajada faqat shu maydonlar: ichma-ich «targeting» (barglari id/name)
 * yoki creative_id xavfsiz nomlarga o'xshasa ham — auditoriya va kreativni egasi ko'rmay almashtirmasin
 */
const PB_EDIT_TOP = new Set(['campaign_id', 'adset_id', 'ad_id', 'name', 'status']);
const topOnly = (input: unknown): boolean =>
  !!input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => PB_EDIT_TOP.has(k));

function classifyPipeboard(tool: string, input: unknown): Verdict {
  if (PB_READ.test(tool)) return { kind: 'allow', strangers: PB_STRANGERS.test(tool) };
  const action = PB_MONEY[tool];
  if (action) return { kind: 'money', action };
  if (PB_EDIT.has(tool)) {
    if (topOnly(input) && safeEdit(input)) return { kind: 'allow', strangers: false };
    return { kind: 'money', action: topOnly(input) && onlyActivate(input) ? 'activate' : 'update' };
  }
  if (PB_MAKE.has(tool)) {
    const v = pausedOnly(input);
    return v.kind === 'deny' ? { kind: 'deny', why: PB_CREATE_PAUSED } : v;
  }
  return { kind: 'deny', why: BLOCKED };
}

export function classify(tool: string, input: unknown, via: AdsVia = 'meta'): Verdict {
  if (via === 'pipeboard') return classifyPipeboard(tool, input);
  if (READ.has(tool)) return { kind: 'allow', strangers: STRANGERS.has(tool) };
  const action = MONEY[tool];
  if (action) return { kind: 'money', action };
  if (tool === 'ads_update_entity') return safeEdit(input) ? { kind: 'allow', strangers: false } : { kind: 'money', action: 'update' };
  if (MAKE.has(tool)) return pausedOnly(input);
  if (AUDIENCE.has(tool)) {
    const ls = leaves(input);
    const people = !ls || ls.some(l => PERSONAL_KEY.test(l.key) || (typeof l.value === 'string' && !/id$/i.test(l.key) && PERSONAL_VALUE.test(l.value.trim())));
    return people ? { kind: 'deny', why: NO_PEOPLE } : { kind: 'allow', strangers: false };
  }
  return { kind: 'deny', why: BLOCKED };
}

const META_ID = /^\d{6,25}$/;
const ID_KEY = /(?:^|_)ids?$/i;

/** Kirishdagi Meta obyektlari raqamlari (id, campaign_id, entity_ids…): qaysi kampaniya yoqilayotganini aniqlash uchun */
export function entityIds(v: unknown): string[] {
  const out = new Set<string>();
  for (const l of leaves(v) ?? []) if (ID_KEY.test(l.key) && (typeof l.value === 'string' || typeof l.value === 'number') && META_ID.test(String(l.value))) out.add(String(l.value));
  return [...out];
}

/** Natija matnidagi raqamlar («id»: "…", campaign_id …) — boost yangi kampaniya yaratadi, u ham kuzatuvga olinadi */
export function idsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/"(?:id|campaign_id|adset_id|ad_id)"\s*:\s*"?(\d{6,25})"?/g)) out.add(m[1]);
  return [...out];
}
