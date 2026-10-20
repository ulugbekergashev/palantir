/**
 * Instagram Direct — rasmiy yo'l (Instagram API with Instagram Login), Palantir Hub orqali.
 *
 *   ulash   — panel hubdan kirish havolasini oladi → egasi instagram.com'da kiradi va ruxsat beradi → hub 60 kunlik tokenni
 *             navbatga qo'yadi → shu modul oladi, shifrlab saqlaydi va akkauntni webhook'larga yozdiradi (subscribed_apps);
 *   o'qish  — Meta xabarni hubga yuboradi → hub navbatiga → shu modul uzun so'rov (/api/pull) bilan oladi → mijozlar oqimiga (core.ts);
 *   yozish  — graph.instagram.com/…/me/messages, klinikaning o'z tokeni bilan. Mijozning oxirgi xabaridan 24 soat o'tgan bo'lsa
 *             Instagram ruxsat bermaydi; Meta «Human Agent» ruxsatini bergan bo'lsa (IG_HUMAN_AGENT=1) — 7 kungacha HUMAN_AGENT tegi bilan.
 *   token   — 60 kun; har kuni tekshiriladi, 10 kun qolganda yangilanadi.
 *
 * Brauzer orqali ulanish (instagram.ts) ham qoladi: bir biznesda ikkalasi bo'lsa, rasmiysi birinchi.
 */
import { businesses, connections, inbox, type BusinessRow, type LeadRow } from '../db';
import { env } from '../env';
import { forgetInstagram } from '../forget';
import { open, seal } from '../secret';
import { isOurEcho, notifyOwner, onIncoming, onOwnerOutgoing, registerSender } from './core';
import { splitForInstagram, windowRule } from './igRules';

const VERSION = 'v25.0';
const KIND = 'instagram_api';
const DAY_MS = 86_400_000;
const REFRESH_BEFORE_MS = 10 * DAY_MS;
const RETRY_MIN_MS = 3_000, RETRY_MAX_MS = 60_000;
const PULL_TIMEOUT_MS = 40_000;

const graph = (path: string) => `${env.igGraphUrl}/${VERSION}${path}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class IgApiError extends Error {}

const tokenOf = (bizId: string): string | null => {
  const c = connections.get(bizId, KIND);
  if (!c) return null;
  try { return open(c.secret); } catch { return null; }
};

async function graphCall(url: string, init: RequestInit & { token: string }): Promise<Record<string, unknown>> {
  const { token, ...rest } = init;
  const r = await fetch(url, { ...rest, headers: { ...(rest.headers ?? {}), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) {
    const err = (j.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
    throw new IgApiError(`Instagram: ${err.message ?? r.status}${err.code ? ` (${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})` : ''}`);
  }
  return j;
}

async function sendDirect(biz: BusinessRow, lead: LeadRow, text: string): Promise<string | null> {
  const token = tokenOf(biz.id);
  if (!token || !lead.igThread) throw new IgApiError('Instagram (rasmiy) ulanmagan');
  const rule = windowRule(lead.lastInboundAt, Date.now(), env.igHumanAgent);
  if (rule === 'closed') {
    throw new IgApiError(env.igHumanAgent
      ? "Instagram mijozning oxirgi xabaridan 7 kun o'tgach yozishga ruxsat bermaydi — qo'ng'iroq qiling yoki u yozishini kuting"
      : "Instagram mijozning oxirgi xabaridan 24 soat o'tgach yozishga ruxsat bermaydi — qo'ng'iroq qiling yoki u yozishini kuting");
  }
  let last: string | null = null;
  for (const part of splitForInstagram(text)) {
    const body = { recipient: { id: lead.igThread }, message: { text: part }, ...(rule === 'human_agent' ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : {}) };
    const r = await graphCall(graph('/me/messages'), { method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    last = r.message_id ? String(r.message_id) : last;
  }
  return last;
}

// ─── Hub navbati ─────────────────────────────────────────────────────────────

interface HubEvent { seq: number; kind: string; payload: Record<string, unknown> }
interface Messaging {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_unsupported?: boolean; attachments?: unknown[] };
}

const profiles = new Map<string, { name: string | null; username: string | null }>();
/** Yozgan odamning ismi va username'i (Instagram bermasa — bo'sh) */
async function profile(bizId: string, igsid: string): Promise<{ name: string | null; username: string | null }> {
  const hit = profiles.get(igsid);
  if (hit) return hit;
  const token = tokenOf(bizId);
  let p = { name: null as string | null, username: null as string | null };
  if (token) {
    try {
      const j = await graphCall(graph(`/${encodeURIComponent(igsid)}?fields=name,username`), { token });
      p = { name: j.name ? String(j.name).slice(0, 80) : null, username: j.username ? String(j.username).slice(0, 40) : null };
    } catch { /* ruxsat yo'q yoki odam yashirgan */ }
  }
  if (profiles.size > 5000) profiles.clear();
  profiles.set(igsid, p);
  return p;
}

async function onToken(p: Record<string, unknown>): Promise<void> {
  const biz = businesses.byId(String(p.businessId ?? ''));
  if (!biz?.active) return;
  const token = String(p.token ?? '');
  const igUserId = String(p.igUserId ?? ''), username = String(p.username ?? '');
  const expiresAt = new Date(Date.now() + (Number(p.expiresIn) || 60 * 86_400) * 1000).toISOString();
  connections.save(biz.id, KIND, seal(token), { id: igUserId, username }, { expiresAt });
  try {
    await graphCall(graph(`/me/subscribed_apps?subscribed_fields=messages`), { method: 'POST', token });
  } catch (e) {
    connections.patchMeta(biz.id, KIND, { problem: `Xabarlarga obuna bo'lmadi: ${(e as Error).message}` });
    await notifyOwner(biz, `⚠️ Instagram @${esc(username)} ulandi, lekin xabarlarga obuna bo'lmadi: ${esc((e as Error).message)}`).catch(() => null);
    return;
  }
  await notifyOwner(biz, `📸 Instagram @${esc(username)} rasmiy ulandi — Direct'ga yozganlarga Palantir javob beradi (sozlamangiz bo'yicha).`).catch(() => null);
}

async function onEntry(p: Record<string, unknown>): Promise<void> {
  const conn = connections.byAccount(KIND, String((p.entry as { id?: string })?.id ?? ''));
  const biz = conn && businesses.byId(conn.businessId);
  if (!biz?.active || !conn) return;
  const ours = conn.account.id;
  for (const m of ((p.entry as { messaging?: Messaging[] }).messaging ?? [])) {
    const msg = m.message;
    if (!msg?.mid || msg.is_deleted) continue;
    const text = (msg.text ?? '').trim() || (msg.attachments?.length ? '[rasm yoki fayl]' : '');
    if (!text) continue;
    if (msg.is_echo || m.sender?.id === ours) {
      // Biz yuborgan javobning aks-sadosi — tashlanadi; egasi telefondan o'zi yozgani — yozishmaga
      const peer = m.recipient?.id;
      if (!peer || inbox.has(biz.id, 'instagram', msg.mid) || isOurEcho(biz.id, 'instagram', text)) continue;
      onOwnerOutgoing(biz, 'instagram', { igUserId: peer }, text, msg.mid);
      continue;
    }
    const igsid = m.sender?.id;
    if (!igsid) continue;
    const who = await profile(biz.id, igsid);
    onIncoming(biz, { channel: 'instagram', person: { igUserId: igsid, igThread: igsid, name: who.name, username: who.username }, text, extId: msg.mid, source: 'Instagram' });
  }
}

/** Egasi ilovani Instagram'dan olib tashladi: token endi ishlamaydi — ulanish o'chadi, yozishmalar qoladi */
async function onRevoked(p: Record<string, unknown>): Promise<void> {
  const biz = businesses.byId(String(p.businessId ?? ''));
  const c = biz && connections.get(biz.id, KIND);
  if (!biz || !c || c.account.id !== String(p.igUserId ?? '')) return;
  connections.remove(biz.id, KIND);
  await notifyOwner(biz, `⚠️ Instagram @${esc(c.account.username)}'da Palantir ilovasi olib tashlandi — rasmiy ulanish uzildi, Direct xabarlari endi kelmaydi. Qayta ulash: panel → Ulanishlar.`).catch(() => null);
}

/** Meta orqali ma'lumotni o'chirish so'rovi: token va Instagram'dan kelgan ma'lumot o'chadi, keyin hubga «bajarildi» (holat sahifasi uchun) */
async function onDelete(p: Record<string, unknown>): Promise<void> {
  const biz = businesses.byId(String(p.businessId ?? ''));
  if (biz) {
    if (connections.get(biz.id, KIND)?.account.id === String(p.igUserId ?? '')) connections.remove(biz.id, KIND);
    const gone = forgetInstagram(biz.id);
    console.log(`[instagram] Meta so'rovi bilan o'chirildi: ${gone.messages} ta xabar, ${gone.leads} ta karta`);
    await notifyOwner(biz, `🗑 Instagram akkaunti egasi Meta orqali ma'lumotni o'chirishni so'radi: rasmiy ulanish uzildi, Instagram'dan kelgan ${gone.messages} ta xabar va faqat Instagram'dan tanilgan ${gone.leads} ta mijoz kartasi o'chirildi.`).catch(() => null);
  }
  const hub = env.hub, code = String(p.code ?? '');
  if (!hub || !code) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${hub.url}/api/ig/deleted`, { method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10_000) });
      if (r.ok) return;
      throw new Error(`hub ${r.status}`);
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, attempt * 2_000));
    }
  }
}

let running = false;
/** Hub bilan aloqa: oxirgi muvaffaqiyatli so'rov va oxirgi xato (kanallar nazorati uchun) */
const hubState = { okAt: Date.now(), error: null as string | null };
/** Hub bilan aloqa shuncha vaqtdan beri yo'q bo'lsa — muammo (null — joyida) */
export function hubProblem(now = Date.now()): string | null {
  return env.hub && hubState.error && now - hubState.okAt > 60_000 ? `Palantir Hub bilan aloqa yo'q: ${hubState.error}` : null;
}
let stopFlag = false;
let cursor = 0;

async function pullLoop(): Promise<void> {
  let delay = RETRY_MIN_MS;
  while (!stopFlag) {
    const hub = env.hub;
    if (!hub) { await new Promise(r => setTimeout(r, 5_000)); continue; }
    try {
      const r = await fetch(`${hub.url}/api/pull?after=${cursor}`, { headers: { authorization: `Bearer ${hub.key}` }, signal: AbortSignal.timeout(PULL_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`hub ${r.status}`);
      const { events } = await r.json() as { events: HubEvent[] };
      for (const e of events) {
        try {
          if (e.kind === 'ig_token') await onToken(e.payload);
          else if (e.kind === 'ig_entry') await onEntry(e.payload);
          else if (e.kind === 'ig_revoked') await onRevoked(e.payload);
          else if (e.kind === 'ig_delete') await onDelete(e.payload);
        } catch (err) {
          console.error(`[instagram] hub voqeasi (${e.kind}):`, (err as Error).message);
        }
        cursor = e.seq;
      }
      delay = RETRY_MIN_MS;
      hubState.okAt = Date.now();
      hubState.error = null;
    } catch (e) {
      if (stopFlag) return;
      if ((e as Error).name !== 'TimeoutError') {
        console.warn('[instagram] hub bilan aloqa yo\'q:', (e as Error).message);
        hubState.error = (e as Error).message;
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(RETRY_MAX_MS, delay * 2);
    }
  }
}

/** 60 kunlik token muddati yaqin bo'lsa — yangilanadi (Instagram 24 soatdan eski, hali amal qilayotgan tokenni yangilaydi) */
export async function refreshTokens(now = Date.now()): Promise<void> {
  for (const c of connections.all(KIND)) {
    const exp = Date.parse(c.meta.expiresAt ?? '');
    if (Number.isFinite(exp) && exp - now > REFRESH_BEFORE_MS) continue;
    const token = tokenOf(c.businessId);
    if (!token) continue;
    try {
      const r = await fetch(`${env.igGraphUrl}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
      if (!r.ok || !j.access_token) throw new Error(j.error?.message ?? String(r.status));
      connections.setSecret(c.businessId, KIND, seal(j.access_token));
      connections.patchMeta(c.businessId, KIND, { expiresAt: new Date(now + (j.expires_in ?? 60 * 86_400) * 1000).toISOString(), problem: undefined });
    } catch (e) {
      const biz = businesses.byId(c.businessId);
      connections.patchMeta(c.businessId, KIND, { problem: `Token yangilanmadi: ${(e as Error).message}` });
      if (biz && Number.isFinite(exp) && exp < now + 3 * DAY_MS) await notifyOwner(biz, "⚠️ Rasmiy Instagram ulanishi tez orada tugaydi — panel → Ulanishlar'da qayta ulang.").catch(() => null);
    }
  }
}

let refreshTimer: NodeJS.Timeout | null = null;

export function startInstagramApi(): void {
  registerSender('instagram', { can: (biz, lead) => !!lead.igThread && !!connections.get(biz.id, KIND), send: sendDirect }, KIND);
  if (running) return;
  running = true;
  stopFlag = false;
  void pullLoop().finally(() => { running = false; });
  void refreshTokens().catch(() => {});
  refreshTimer = setInterval(() => { void refreshTokens().catch(() => {}); }, DAY_MS);
  refreshTimer.unref();
}

export function stopInstagramApi(): void {
  stopFlag = true;
  if (refreshTimer) clearInterval(refreshTimer);
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export interface IgApiStatus { hub: boolean; account: string | null; problem: string | null; expiresAt: string | null; humanAgent: boolean }

export function instagramApiStatus(bizId: string): IgApiStatus {
  const c = connections.get(bizId, KIND);
  return { hub: !!env.hub, account: c ? `@${c.account.username}` : null, problem: c?.meta.problem ?? null, expiresAt: c?.meta.expiresAt ?? null, humanAgent: env.igHumanAgent };
}

/** Egasi brauzerda ochadigan Instagram kirish havolasi (hub imzolaydi) */
export async function instagramApiConnectUrl(biz: BusinessRow): Promise<string> {
  const hub = env.hub;
  if (!hub) throw new IgApiError("Palantir Hub kodi kiritilmagan — ulash ustasi → kalitlar");
  const r = await fetch(`${hub.url}/api/ig/connect-url`, { method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ businessId: biz.id }), signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({})) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new IgApiError(j.error ?? `Hub javob bermadi (${r.status})`);
  return j.url;
}

export async function disconnectInstagramApi(biz: BusinessRow): Promise<void> {
  const c = connections.get(biz.id, KIND);
  if (!c) return;
  connections.remove(biz.id, KIND);
  if (env.hub) await fetch(`${env.hub.url}/api/ig/forget`, { method: 'POST', headers: { authorization: `Bearer ${env.hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ igUserId: c.account.id }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
}
