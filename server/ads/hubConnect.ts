/**
 * Reklama kabinetini Facebook orqali ulash (Palantir Hub, hub/server.ts 8-band): egasi «Facebook orqali ulash» bosadi → Hub imzolagan
 * havola → facebook.com'da kiradi va ruxsat beradi → Hub kodni tokenga almashtiradi (ilova siri faqat Hub'da) → token navbat orqali
 * shu yerga (ads_token). Bu yerda: tokenga ochiq reklama kabinetlari va sahifalar o'qiladi; bittadan bo'lsa (yoki avval ulangan
 * kabinet ro'yxatda bo'lsa — token yangilash) o'zi ulanadi, aks holda panelda tanlash uchun 1 soat kutadi (faqat xotirada; token
 * hech qayerga yozilmaydi va panelga chiqmaydi). Ulash — oddiy connect() orqali: kabinet holati, valyuta, sahifa tekshiriladi.
 *
 * Pipeboard orqali (o'z Meta ilovasi bo'lmaganda): egasi pipeboard.co'da Facebook bilan kirib kabinetini ulaydi, u yerdan API tokenini
 * panelga qo'yadi → shu yerda token tekshiriladi, kabinetlar va sahifalar Pipeboard asboblari bilan o'qiladi, keyin xuddi yuqoridagidek.
 *
 * claude.ai ulagichi orqali (token ham, ilova ham yo'q): egasi claude.ai'da Meta Ads ulagichini qo'shgan — panelda «Claude orqali ulash»
 * → ulagich topiladi, kabinetlar va sahifalar Meta asboblari bilan (ijrochi orqali, claudeai.ts) o'qiladi, keyin xuddi yuqoridagidek.
 */
import { businesses, type BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';
import { pipeboardJson } from './backend';
import { caiOne, callMeta, connector, stateText } from './claudeai';
import { connect } from './campaigns';
import { graph } from './graph';
import { endpointOf, mcpWorks, type AdsVia } from './mcpClient';
import { TargetError, adsStore } from './store';

const PENDING_MS = 3_600_000;
/** Hub navbatida kechikib kelgan ruxsat (klinika o'chiq edi) — eskirgan: egasi qayta bosadi */
const TOKEN_STALE_MS = 3_600_000;
const HUB_TIMEOUT_MS = 15_000;
/** Kabinet va sahifa ro'yxati: oddiy egada bir nechta; ko'pi bilan shuncha ko'rsatiladi */
const LIST_LIMIT = 50;

export interface HubAccount { id: string; name: string; currency: string; active: boolean }
export interface HubPage { id: string; name: string; igId: string | null; igName: string | null }
interface Pending { token: string; expiresAt: string | null; accounts: HubAccount[]; pages: HubPage[]; until: number; via: AdsVia }

const pending = new Map<string, Pending>();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Panel: tanlash kutayotgan ro'yxat (token chiqmaydi) */
export function hubPending(bizId: string, now = Date.now()): { accounts: HubAccount[]; pages: HubPage[]; via: AdsVia } | null {
  const p = pending.get(bizId);
  if (!p) return null;
  if (p.until < now) { pending.delete(bizId); return null; }
  return { accounts: p.accounts, pages: p.pages, via: p.via };
}

export const dropHubPending = (bizId: string): void => { pending.delete(bizId); };

/** Egasi brauzerda ochadigan Facebook kirish havolasi (Hub imzolaydi) */
export async function adsHubUrl(biz: BusinessRow): Promise<string> {
  const hub = env.hub;
  if (!hub) throw new TargetError('Palantir Hub kodi kiritilmagan — ulash ustasi → kalitlar (yoki tokenni qo‘lda kiriting)');
  let r: Response;
  try {
    r = await fetch(`${hub.url}/api/ads/connect-url`, { method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ businessId: biz.id }), signal: AbortSignal.timeout(HUB_TIMEOUT_MS) });
  } catch (e) {
    throw new TargetError(`Palantir Hub javob bermadi: ${(e as Error).message}`);
  }
  const j = await r.json().catch(() => ({})) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new TargetError(j.error ?? `Palantir Hub javob bermadi (${r.status})`);
  // Faqat Hub'ning o'z sahifasi (u yerdan Facebook'ga): boshqa manzil panelda ochilmaydi
  if (!j.url.startsWith(`${hub.url}/ads/start?`)) throw new TargetError('Palantir Hub kutilmagan havola berdi — Palantir jamoasiga ayting');
  return j.url;
}

interface RawAccount { account_id?: string; id?: string; name?: string; currency?: string; account_status?: number }
interface RawPage { id?: string; name?: string; instagram_business_account?: { id?: string; username?: string } }

/** Meta MCP javobi (claude.ai ulagichi) → JSON; o'qilmasa — xato */
const metaJson = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
  const text = await caiOne(tool, args);
  try { return JSON.parse(text) as unknown; } catch { throw new TargetError(`Meta javobi o'qilmadi (${tool})`); }
};

/** Javob ichidagi sahifalar: {page_id, page_name} yoki «pages» ro'yxatidagi {id, name} */
function pagesIn(v: unknown, out: HubPage[] = [], depth = 0, inPages = false): HubPage[] {
  if (!v || typeof v !== 'object' || depth > 5 || out.length >= LIST_LIMIT) return out;
  const r = v as Record<string, unknown>;
  const id = String(r.page_id ?? (inPages ? r.id ?? '' : ''));
  if (!Array.isArray(v) && /^\d{5,20}$/.test(id)) {
    if (!out.some(p => p.id === id)) out.push({ id, name: String(r.page_name ?? r.name ?? ''), igId: null, igName: null });
    return out;
  }
  for (const [k, x] of Object.entries(v)) pagesIn(x, out, depth + 1, Array.isArray(v) ? inPages : /page/i.test(k));
  return out;
}

/** claude.ai ulagichi: egasining Facebook akkauntiga ochiq kabinetlar (faol va Meta MCP'ga ochiqlari — faol) va sahifalar */
async function claudeaiAssets(): Promise<{ accounts: HubAccount[]; pages: HubPage[] }> {
  const acc = await metaJson('ads_get_ad_accounts', callMeta('report_measure_or_look_up')) as { ad_accounts?: unknown };
  if (!Array.isArray(acc.ad_accounts)) throw new TargetError("Meta kabinetlar ro'yxatini bermadi");
  const accounts = (acc.ad_accounts as Record<string, unknown>[]).filter(a => a && typeof a === 'object').slice(0, LIST_LIMIT)
    .map(a => ({ id: String(a.ad_account_id ?? ''), name: String(a.ad_account_name ?? ''), currency: String(a.currency ?? '').toUpperCase(), active: a.account_status === 'ACTIVE' && a.is_queryable !== false && a.is_ads_mcp_enabled !== false }))
    .filter(a => /^\d{5,20}$/.test(a.id));
  const pages = pagesIn(await metaJson('ads_get_user_pages', callMeta('report_measure_or_look_up')).catch(() => null));
  return { accounts, pages };
}

/** Tokenga ochiq kabinetlar va sahifalar (Pipeboard va claude.ai ulagichida sahifaning Instagram akkaunti ko'rinmaydi — igId null) */
export async function listAssets(token: string, via: AdsVia = 'meta'): Promise<{ accounts: HubAccount[]; pages: HubPage[] }> {
  if (via === 'claudeai') return claudeaiAssets();
  const [acc, pg] = await Promise.all(via === 'pipeboard'
    ? [pipeboardJson<{ data?: RawAccount[] }>(token, 'get_ad_accounts', { limit: LIST_LIMIT }), pipeboardJson<{ data?: RawPage[] }>(token, 'get_account_pages', { account_id: 'me' })]
    : [
      graph<{ data?: RawAccount[] }>(token, 'GET', 'me/adaccounts', { fields: 'account_id,name,currency,account_status', limit: LIST_LIMIT }),
      graph<{ data?: RawPage[] }>(token, 'GET', 'me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: LIST_LIMIT }),
    ]);
  const accounts = (Array.isArray(acc.data) ? acc.data : []).slice(0, LIST_LIMIT).map(a => ({ id: String(a.account_id ?? a.id ?? '').replace(/^act_/, ''), name: String(a.name ?? ''), currency: String(a.currency ?? '').toUpperCase(), active: a.account_status === 1 }))
    .filter(a => /^\d{5,20}$/.test(a.id));
  const pages = (Array.isArray(pg.data) ? pg.data : []).slice(0, LIST_LIMIT).map(p => ({ id: String(p.id ?? ''), name: String(p.name ?? ''), igId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null, igName: p.instagram_business_account?.username ? String(p.instagram_business_account.username) : null }))
    .filter(p => /^\d{5,20}$/.test(p.id));
  return { accounts, pages };
}

/**
 * Qaysi kabinet va sahifa o'zi tanlanadi: avval ulangani ro'yxatda bo'lsa — o'sha (token yangilandi), ro'yxatda bo'lmasa — egasi
 * tanlaydi; birinchi ulashda bitta faol kabinet va bitta sahifa bo'lsa — o'sha; boshqa hollarda — egasi tanlaydi (null)
 */
export function autoPick(prev: { adAccountId: string; pageId: string; igActorId: string | null } | null, a: { accounts: HubAccount[]; pages: HubPage[] }): { adAccountId: string; pageId: string; igActorId: string | null } | null {
  if (prev) {
    const same = a.accounts.some(x => x.id === prev.adAccountId && x.active) && a.pages.some(p => p.id === prev.pageId);
    // Ulangan kabinet boshqasiga o'zi almashmaydi (boshqa Facebook akkaunti bilan kirilgan bo'lishi mumkin) — egasi tanlaydi
    return same ? { adAccountId: prev.adAccountId, pageId: prev.pageId, igActorId: a.pages.find(p => p.id === prev.pageId)?.igId ?? prev.igActorId } : null;
  }
  const active = a.accounts.filter(x => x.active);
  if (active.length === 1 && a.pages.length === 1) return { adAccountId: active[0].id, pageId: a.pages[0].id, igActorId: a.pages[0].igId };
  return null;
}

const expiryOf = (expiresIn: number, now: number): string | null => (expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null);

/** Hub navbatidan: egasi Facebook'da ruxsat berdi */
export async function onAdsToken(payload: unknown, now = Date.now()): Promise<void> {
  const p = payload as { businessId?: unknown; token?: unknown; expiresIn?: unknown; at?: unknown };
  const token = typeof p.token === 'string' ? p.token.trim() : '';
  const biz = typeof p.businessId === 'string' ? businesses.byId(p.businessId) : undefined;
  if (!biz || token.length < 20 || token.length > 2000) return;
  if (typeof p.at === 'number' && now - p.at > TOKEN_STALE_MS) return;
  const expiresIn = Number(p.expiresIn);
  // 0 — muddatsiz; ko'pi bilan bir yil (noto'g'ri qiymat sanani buzmasin)
  const expiresAt = expiryOf(Number.isFinite(expiresIn) ? Math.min(Math.max(expiresIn, 0), 366 * 86_400) : 0, now);
  let assets: { accounts: HubAccount[]; pages: HubPage[] };
  try {
    assets = await listAssets(token);
  } catch (e) {
    await notifyOwner(biz, `⚠️ <b>Targetolog</b>: Facebook ulandi, lekin kabinetlar o'qilmadi — ${esc((e as Error).message)}. Panel → Targetolog → Kabinet'da qayta urining.`).catch(() => null);
    return;
  }
  if (!assets.accounts.length || !assets.pages.length) {
    const what = !assets.accounts.length ? 'reklama kabineti' : 'Facebook sahifa';
    await notifyOwner(biz, `⚠️ <b>Targetolog</b>: Facebook'da ruxsat berildi, lekin hech qanday ${what} tanlanmagan. «Facebook orqali ulash»ni qayta bosing va kirishda kabinet hamda sahifani belgilang.`).catch(() => null);
    return;
  }
  const prev = adsStore.connection(biz.id);
  const pick = autoPick(prev, assets);
  if (pick) {
    try {
      const c = await connect(biz, { token, ...pick, expiresAt });
      pending.delete(biz.id);
      await notifyOwner(biz, `✅ <b>Targetolog</b>: reklama kabineti ${prev ? 'qayta ' : ''}ulandi — <b>${esc(c.accountName || `act_${c.adAccountId}`)}</b> (${esc(c.currency)}), sahifa ${esc(c.pageName || c.pageId)}.${prev ? '' : ' Endi panelda limitlarni qo‘ying — limitsiz hech narsa ishga tushmaydi.'}`).catch(() => null);
      return;
    } catch (e) {
      // Kabinet faol emas yoki valyuta mos emas — egasi boshqasini tanlasin
      pending.set(biz.id, { token, expiresAt, ...assets, until: now + PENDING_MS, via: 'meta' });
      await notifyOwner(biz, `⚠️ <b>Targetolog</b>: kabinet ulanmadi — ${esc((e as Error).message)}. Panel → Targetolog → Kabinet'da boshqasini tanlang.`).catch(() => null);
      return;
    }
  }
  pending.set(biz.id, { token, expiresAt, ...assets, until: now + PENDING_MS, via: 'meta' });
  await notifyOwner(biz, `🔗 <b>Targetolog</b>: Facebook ulandi — ${assets.accounts.length} ta kabinet, ${assets.pages.length} ta sahifa. Panel → Targetolog → Kabinet'da qaysi biri ekanini tanlang (1 soat ichida).`).catch(() => null);
}

/** Egasi panelda tanladi */
export async function connectPicked(biz: BusinessRow, pick: { adAccountId: string; pageId: string; igActorId?: string | null }, now = Date.now()): Promise<void> {
  const p = pending.get(biz.id);
  if (!p || p.until < now) { pending.delete(biz.id); throw new TargetError('Tanlash vaqti o‘tdi — ulashni qaytadan boshlang'); }
  const id = pick.adAccountId.replace(/^act_/, '');
  const page = p.pages.find(x => x.id === pick.pageId);
  if (!p.accounts.some(x => x.id === id) || !page) throw new TargetError('Bu kabinet yoki sahifa Facebook ruxsatida yo‘q — ro‘yxatdan tanlang');
  // Instagram — tanlangan sahifaga bog'langan akkaunt (boshqasi bo'lsa reklama Direct'ga ishlamaydi)
  const ig = pick.igActorId === undefined ? page.igId : pick.igActorId;
  await connect(biz, { token: p.token, adAccountId: id, pageId: page.id, igActorId: ig, expiresAt: p.expiresAt, via: p.via });
  pending.delete(biz.id);
}

/** Pipeboard API tokeni: harf, raqam va bir nechta belgi (manzilga qo'shiladi) */
const PIPEBOARD_TOKEN = /^[A-Za-z0-9_\-.:]{16,300}$/;

/**
 * Egasi Pipeboard tokenini qo'ydi: token ishlaydimi → kabinetlar va sahifalar → bittadan bo'lsa (yoki avval ulangani ro'yxatda) —
 * o'zi ulanadi; aks holda panelda tanlash (1 soat). connected — o'zi ulandimi
 */
export async function connectPipeboard(biz: BusinessRow, raw: string, now = Date.now()): Promise<{ connected: boolean }> {
  const token = raw.trim();
  if (!PIPEBOARD_TOKEN.test(token)) throw new TargetError("Bu Pipeboard tokeniga o'xshamaydi — pipeboard.co/api-tokens sahifasidagi tokenni to'liq nusxalang");
  if (!(await mcpWorks(endpointOf({ token, via: 'pipeboard' })))) throw new TargetError("Pipeboard tokeni ishlamadi — pipeboard.co/api-tokens'dan yangisini oling va qayta qo'ying");
  let assets: { accounts: HubAccount[]; pages: HubPage[] };
  try {
    assets = await listAssets(token, 'pipeboard');
  } catch (e) {
    throw new TargetError(`Pipeboard'dan kabinetlar o'qilmadi: ${(e as Error).message}`);
  }
  if (!assets.accounts.length) throw new TargetError("Pipeboard'ga hali reklama kabineti ulanmagan — pipeboard.co'da Facebook bilan kirib, kabinetni ulang, keyin qayta urining");
  if (!assets.pages.length) throw new TargetError("Pipeboard'dagi Facebook akkauntida sahifa ko'rinmadi — pipeboard.co'da sahifaga ham ruxsat bering");
  const pick = autoPick(adsStore.connection(biz.id), assets);
  if (pick) {
    try {
      await connect(biz, { token, ...pick, igActorId: pick.igActorId, expiresAt: null, via: 'pipeboard' });
      pending.delete(biz.id);
      return { connected: true };
    } catch (e) {
      if (!(e instanceof TargetError)) throw e;
      // Kabinet faol emas yoki valyuta mos emas — egasi boshqasini tanlasin
    }
  }
  pending.set(biz.id, { token, expiresAt: null, ...assets, until: now + PENDING_MS, via: 'pipeboard' });
  return { connected: false };
}

/**
 * Egasi claude.ai'da Meta Ads ulagichini qo'shgan: ulagich bormi va ulanganmi → kabinetlar va sahifalar → bittadan bo'lsa (yoki avval
 * ulangani ro'yxatda) — o'zi ulanadi; aks holda panelda tanlash (1 soat). connected — o'zi ulandimi
 */
export async function connectClaudeAi(biz: BusinessRow, now = Date.now()): Promise<{ connected: boolean }> {
  const k = await connector(true);
  if (k.state !== 'connected') throw new TargetError(stateText(k.state));
  let assets: { accounts: HubAccount[]; pages: HubPage[] };
  try {
    assets = await listAssets('', 'claudeai');
  } catch (e) {
    throw new TargetError(`claude.ai ulagichidan kabinetlar o'qilmadi: ${(e as Error).message}`);
  }
  if (!assets.accounts.some(a => a.active)) throw new TargetError("claude.ai'dagi Meta ulagichida faol reklama kabineti ko'rinmadi — ulagichga ruxsat berishda kabinetni belgilang");
  if (!assets.pages.length) throw new TargetError("claude.ai'dagi Meta ulagichida Facebook sahifa ko'rinmadi — ulagichga ruxsat berishda sahifani ham belgilang");
  const pick = autoPick(adsStore.connection(biz.id), assets);
  if (pick) {
    try {
      await connect(biz, { token: '', ...pick, igActorId: pick.igActorId, expiresAt: null, via: 'claudeai' });
      pending.delete(biz.id);
      return { connected: true };
    } catch (e) {
      if (!(e instanceof TargetError)) throw e;
      // Kabinet faol emas yoki valyuta mos emas — egasi boshqasini tanlasin
    }
  }
  pending.set(biz.id, { token: '', expiresAt: null, ...assets, until: now + PENDING_MS, via: 'claudeai' });
  return { connected: false };
}

/** Kanallar nazorati: token muddati yaqin (Facebook orqali ulanganda 60 kun; uzaytirib bo'lmaydi — egasi qayta kiradi) */
const WARN_BEFORE_MS = 5 * 86_400_000;
export function adsTokenProblem(bizId: string, now = Date.now()): string | null {
  const exp = Date.parse(adsStore.connection(bizId)?.expiresAt ?? '');
  if (!Number.isFinite(exp) || exp - now > WARN_BEFORE_MS) return null;
  const day = new Date(exp).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', timeZone: 'Asia/Tashkent' });
  return exp <= now
    ? 'Facebook ruxsati tugadi — Targetolog → Kabinet → «Facebook orqali qayta ulash»'
    : `Facebook ruxsati ${day} tugaydi — Targetolog → Kabinet → «Facebook orqali qayta ulash»`;
}
