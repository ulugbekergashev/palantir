/**
 * Reklama kabinetini Facebook orqali ulash (Palantir Hub, hub/server.ts 8-band): egasi «Facebook orqali ulash» bosadi → Hub imzolagan
 * havola → facebook.com'da kiradi va ruxsat beradi → Hub kodni tokenga almashtiradi (ilova siri faqat Hub'da) → token navbat orqali
 * shu yerga (ads_token). Bu yerda: tokenga ochiq reklama kabinetlari va sahifalar o'qiladi; bittadan bo'lsa (yoki avval ulangan
 * kabinet ro'yxatda bo'lsa — token yangilash) o'zi ulanadi, aks holda panelda tanlash uchun 1 soat kutadi (faqat xotirada; token
 * hech qayerga yozilmaydi va panelga chiqmaydi). Ulash — oddiy connect() orqali: kabinet holati, valyuta, sahifa tekshiriladi.
 */
import { businesses, type BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';
import { connect } from './campaigns';
import { graph } from './graph';
import { TargetError, adsStore } from './store';

const PENDING_MS = 3_600_000;
/** Hub navbatida kechikib kelgan ruxsat (klinika o'chiq edi) — eskirgan: egasi qayta bosadi */
const TOKEN_STALE_MS = 3_600_000;
const HUB_TIMEOUT_MS = 15_000;
/** Kabinet va sahifa ro'yxati: oddiy egada bir nechta; ko'pi bilan shuncha ko'rsatiladi */
const LIST_LIMIT = 50;

export interface HubAccount { id: string; name: string; currency: string; active: boolean }
export interface HubPage { id: string; name: string; igId: string | null; igName: string | null }
interface Pending { token: string; expiresAt: string | null; accounts: HubAccount[]; pages: HubPage[]; until: number }

const pending = new Map<string, Pending>();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Panel: tanlash kutayotgan ro'yxat (token chiqmaydi) */
export function hubPending(bizId: string, now = Date.now()): { accounts: HubAccount[]; pages: HubPage[] } | null {
  const p = pending.get(bizId);
  if (!p) return null;
  if (p.until < now) { pending.delete(bizId); return null; }
  return { accounts: p.accounts, pages: p.pages };
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

/** Tokenga ochiq kabinetlar va sahifalar */
export async function listAssets(token: string): Promise<{ accounts: HubAccount[]; pages: HubPage[] }> {
  const [acc, pg] = await Promise.all([
    graph<{ data?: RawAccount[] }>(token, 'GET', 'me/adaccounts', { fields: 'account_id,name,currency,account_status', limit: LIST_LIMIT }),
    graph<{ data?: RawPage[] }>(token, 'GET', 'me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: LIST_LIMIT }),
  ]);
  const accounts = (acc.data ?? []).map(a => ({ id: String(a.account_id ?? a.id ?? '').replace(/^act_/, ''), name: String(a.name ?? ''), currency: String(a.currency ?? '').toUpperCase(), active: a.account_status === 1 }))
    .filter(a => /^\d{5,20}$/.test(a.id));
  const pages = (pg.data ?? []).map(p => ({ id: String(p.id ?? ''), name: String(p.name ?? ''), igId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null, igName: p.instagram_business_account?.username ? String(p.instagram_business_account.username) : null }))
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
      pending.set(biz.id, { token, expiresAt, ...assets, until: now + PENDING_MS });
      await notifyOwner(biz, `⚠️ <b>Targetolog</b>: kabinet ulanmadi — ${esc((e as Error).message)}. Panel → Targetolog → Kabinet'da boshqasini tanlang.`).catch(() => null);
      return;
    }
  }
  pending.set(biz.id, { token, expiresAt, ...assets, until: now + PENDING_MS });
  await notifyOwner(biz, `🔗 <b>Targetolog</b>: Facebook ulandi — ${assets.accounts.length} ta kabinet, ${assets.pages.length} ta sahifa. Panel → Targetolog → Kabinet'da qaysi biri ekanini tanlang (1 soat ichida).`).catch(() => null);
}

/** Egasi panelda tanladi */
export async function connectPicked(biz: BusinessRow, pick: { adAccountId: string; pageId: string; igActorId?: string | null }, now = Date.now()): Promise<void> {
  const p = pending.get(biz.id);
  if (!p || p.until < now) { pending.delete(biz.id); throw new TargetError('Facebook ruxsati eskirgan — «Facebook orqali ulash»ni qayta bosing'); }
  const id = pick.adAccountId.replace(/^act_/, '');
  const page = p.pages.find(x => x.id === pick.pageId);
  if (!p.accounts.some(x => x.id === id) || !page) throw new TargetError('Bu kabinet yoki sahifa Facebook ruxsatida yo‘q — ro‘yxatdan tanlang');
  // Instagram — tanlangan sahifaga bog'langan akkaunt (boshqasi bo'lsa reklama Direct'ga ishlamaydi)
  const ig = pick.igActorId === undefined ? page.igId : pick.igActorId;
  await connect(biz, { token: p.token, adAccountId: id, pageId: page.id, igActorId: ig, expiresAt: p.expiresAt });
  pending.delete(biz.id);
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
