/**
 * Instagram Direct — rasmiy yo'l (Instagram API with Instagram Login):
 *   egasi panelda «Instagram bilan kirish»ni bosadi → Instagram sahifasida ruxsat beradi →
 *   bu yerga kod qaytadi → 60 kunlik token (o'zi yangilanadi). Parol hech qayerda saqlanmaydi.
 *
 * Xabarlar ikki yo'l bilan keladi: webhook (ilova Meta tekshiruvidan o'tib Live bo'lganda) va
 * har IG_POLL_MS da suhbatlarni tekshirish (tekshiruvgacha ham ishlaydi). Bir xabar ikki yo'ldan
 * kelsa ham bir marta ishlanadi (xabar id'si bo'yicha).
 *
 * Instagram qoidasi: mijoz yozgandan keyin 24 soat ichida javob berish mumkin, birinchi bo'lib — yo'q.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { businesses, connections, IG_WINDOW_MS, leads, type BusinessRow, type ConnectionRow, type LeadRow } from '../db';
import { env } from '../env';
import { open, readState, seal, signState } from '../secret';
import { onIncoming, onOwnerOutgoing, registerSender, replySettings } from './core';

export const instagramAvailable = () => !!(env.igAppId && env.igAppSecret && env.publicUrl);
const redirectUri = () => `${env.publicUrl}/api/instagram/callback`;
const graph = (path: string) => `${env.igGraphUrl}/${env.igApiVersion}${path}`;

interface GraphError { error?: { message?: string; code?: number; error_subcode?: number } ; error_message?: string }

async function igFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({})) as T & GraphError;
  if (!r.ok || j.error) {
    const msg = j.error?.message ?? j.error_message ?? `HTTP ${r.status}`;
    if (j.error?.error_subcode === 2534022 || /outside of allowed window/i.test(msg)) {
      throw new Error("Instagram qoidasi: mijoz oxirgi 24 soatda yozmagan — javob berib bo'lmaydi");
    }
    throw new Error(`Instagram: ${msg}`);
  }
  return j;
}

// ─── Ulash (OAuth) ────────────────────────────────────────────────────────────

export function authorizeUrl(biz: BusinessRow): string {
  if (!instagramAvailable()) throw new Error('Instagram serverda sozlanmagan (IG_APP_ID, IG_APP_SECRET, PUBLIC_URL)');
  const q = new URLSearchParams({
    client_id: env.igAppId, redirect_uri: redirectUri(), response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_messages', state: signState(`ig:${biz.id}`),
  });
  return `${env.igOAuthUrl}?${q}`;
}

export async function handleCallback(code: string, state: string): Promise<BusinessRow> {
  const payload = readState(state);
  const biz = payload?.startsWith('ig:') ? businesses.byId(payload.slice(3)) : undefined;
  if (!biz) throw new Error("Havola eskirgan — panelda «Instagram bilan kirish»ni qayta bosing");
  const form = new FormData();
  form.append('client_id', env.igAppId);
  form.append('client_secret', env.igAppSecret);
  form.append('grant_type', 'authorization_code');
  form.append('redirect_uri', redirectUri());
  form.append('code', code.replace(/#_$/, ''));
  const short = await igFetch<{ access_token?: string; data?: { access_token: string }[] }>(env.igTokenUrl, { method: 'POST', body: form });
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error('Instagram token bermadi');
  const long = await igFetch<{ access_token: string; expires_in: number }>(
    `${env.igGraphUrl}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: env.igAppSecret, access_token: shortToken })}`);
  const me = await igFetch<{ user_id?: string; id?: string; username: string }>(graph(`/me?${new URLSearchParams({ fields: 'user_id,username', access_token: long.access_token })}`));
  const accountId = String(me.user_id ?? me.id);
  connections.save(biz.id, 'instagram', seal(long.access_token), { id: accountId, username: me.username }, {
    expires: new Date(Date.now() + long.expires_in * 1000).toISOString(),
    // Ulangandan oldingi xabarlarga javob berilmaydi
    cursor: new Date().toISOString(),
  });
  // Webhook uchun obuna (ilova Live bo'lmaguncha Meta xabar yubormaydi — o'shanda tekshirish ishlaydi)
  await igFetch(graph(`/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'messages', access_token: long.access_token })}`), { method: 'POST' })
    .catch(e => console.warn('[instagram] webhook obunasi:', (e as Error).message));
  return biz;
}

export const instagramAccount = (bizId: string) => {
  const c = connections.get(bizId, 'instagram');
  return c ? `@${c.account.username}` : null;
};

export function disconnectInstagram(biz: BusinessRow): void {
  connections.remove(biz.id, 'instagram');
}

// ─── Kiruvchi xabarlar ────────────────────────────────────────────────────────

const token = (c: ConnectionRow) => open(c.secret);
const names = new Map<string, { name: string | null; username: string | null }>();

/** Mijozning ismi va username'i (Instagram faqat yozishgan odam uchun beradi) */
async function profile(c: ConnectionRow, igsid: string, known?: string | null): Promise<{ name: string | null; username: string | null }> {
  const hit = names.get(igsid);
  if (hit) return hit;
  const p = await igFetch<{ name?: string; username?: string }>(graph(`/${igsid}?${new URLSearchParams({ fields: 'name,username', access_token: token(c) })}`))
    .catch(() => ({} as { name?: string; username?: string }));
  const v = { name: p.name ?? null, username: p.username ?? known ?? null };
  names.set(igsid, v);
  return v;
}

async function incoming(c: ConnectionRow, from: string, text: string, mid: string, knownUsername?: string | null): Promise<void> {
  const biz = businesses.byId(c.businessId);
  if (!biz?.active || replySettings(biz).mode === 'off') return;
  const who = leads.byInstagram(biz.id, from) ? { name: null, username: knownUsername ?? null } : await profile(c, from, knownUsername);
  onIncoming(biz, { channel: 'instagram', person: { igUserId: from, name: who.name, username: who.username }, text, extId: mid, source: 'Instagram' });
}

function outgoing(c: ConnectionRow, to: string, text: string, mid: string): void {
  const biz = businesses.byId(c.businessId);
  if (biz) onOwnerOutgoing(biz, 'instagram', { igUserId: to }, text, mid);
}

interface Messaging { sender?: { id: string }; recipient?: { id: string }; message?: { mid: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_self?: boolean; attachments?: unknown[] } }

/** Webhook: imzo tekshiriladi (Meta ilova siri bilan) */
export function verifySignature(raw: Buffer | undefined, header: string | undefined): boolean {
  if (!raw || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', env.igAppSecret).update(raw).digest('hex');
  const given = header.slice(7);
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function handleWebhook(body: { object?: string; entry?: { id: string; messaging?: Messaging[] }[] }): Promise<void> {
  if (body.object !== 'instagram') return;
  for (const entry of body.entry ?? []) {
    const c = connections.byAccount('instagram', String(entry.id));
    if (!c) continue;
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_deleted || msg.is_self || !m.sender || !m.recipient) continue;
      const text = msg.text || (msg.attachments?.length ? '[rasm yoki fayl]' : '');
      if (!text) continue;
      if (msg.is_echo) outgoing(c, m.recipient.id, text, msg.mid);
      else await incoming(c, m.sender.id, text, msg.mid);
    }
  }
}

/** Webhook ishlamasa ham: suhbatlarni tekshirib, yangi xabarlarni oladi */
const parseTime = (t: string | number) => (typeof t === 'number' || /^\d+$/.test(String(t))
  ? Number(t) * (String(t).length > 11 ? 1 : 1000)
  : Date.parse(String(t).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')));

export async function pollInstagram(): Promise<void> {
  for (const c of connections.all('instagram')) {
    try {
      const since = Date.parse(c.meta.cursor ?? new Date().toISOString());
      let newest = since;
      const convs = await igFetch<{ data: { id: string; updated_time: string | number }[] }>(
        graph(`/me/conversations?${new URLSearchParams({ platform: 'instagram', fields: 'id,updated_time', access_token: token(c) })}`));
      for (const conv of convs.data ?? []) {
        if (parseTime(conv.updated_time) <= since) continue;
        const full = await igFetch<{ messages?: { data: { id: string; created_time: string; message?: string; from?: { id: string; username?: string }; to?: { data: { id: string }[] } }[] } }>(
          graph(`/${conv.id}?${new URLSearchParams({ fields: 'messages{id,created_time,from,to,message}', access_token: token(c) })}`));
        const msgs = (full.messages?.data ?? []).filter(m => parseTime(m.created_time) > since).sort((a, b) => parseTime(a.created_time) - parseTime(b.created_time));
        for (const m of msgs) {
          newest = Math.max(newest, parseTime(m.created_time));
          const text = m.message || '[rasm yoki fayl]';
          if (!m.from) continue;
          if (m.from.id === c.account.id) {
            const to = m.to?.data?.[0]?.id;
            if (to) outgoing(c, to, text, m.id);
          } else {
            await incoming(c, m.from.id, text, m.id, m.from.username);
          }
        }
      }
      if (newest > since) connections.setMeta(c.businessId, 'instagram', { ...c.meta, cursor: new Date(newest).toISOString() });
    } catch (e) {
      console.warn('[instagram] tekshirish:', (e as Error).message);
    }
  }
}

/** Uzoq muddatli token 60 kun yashaydi — 10 kun qolganda yangilanadi */
export async function refreshInstagramTokens(): Promise<void> {
  for (const c of connections.all('instagram')) {
    const left = Date.parse(c.meta.expires ?? '') - Date.now();
    if (!(left < 10 * 86_400_000) || Date.now() - Date.parse(c.updatedAt) < 86_400_000) continue;
    try {
      const r = await igFetch<{ access_token: string; expires_in: number }>(
        `${env.igGraphUrl}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token(c) })}`);
      connections.setSecret(c.businessId, 'instagram', seal(r.access_token));
      connections.setMeta(c.businessId, 'instagram', { ...c.meta, expires: new Date(Date.now() + r.expires_in * 1000).toISOString() });
    } catch (e) {
      console.warn('[instagram] token yangilanmadi:', (e as Error).message);
    }
  }
}

// ─── Yuborish ─────────────────────────────────────────────────────────────────

/** Instagram bitta xabarga 1000 baytgacha oladi — uzunini bo'ladi */
function parts(text: string, maxBytes = 990): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/(\s+)/)) {
    if (Buffer.byteLength(cur + word) > maxBytes && cur) { out.push(cur.trim()); cur = ''; }
    cur += word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function startInstagram(): void {
  registerSender('instagram', {
    can: (biz, lead) => !!connections.get(biz.id, 'instagram') && !!lead.igUserId,
    async send(biz: BusinessRow, lead: LeadRow, text: string) {
      const c = connections.get(biz.id, 'instagram');
      if (!c || !lead.igUserId) throw new Error('Instagram ulanmagan');
      if (!lead.lastInboundAt || Date.now() - Date.parse(lead.lastInboundAt) > IG_WINDOW_MS) {
        throw new Error("Instagram qoidasi: mijoz oxirgi 24 soatda yozmagan — javob berib bo'lmaydi");
      }
      let last = '';
      for (const part of parts(text)) {
        const r = await igFetch<{ message_id: string }>(graph('/me/messages'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token(c)}` },
          body: JSON.stringify({ recipient: { id: lead.igUserId }, message: { text: part } }),
        });
        last = r.message_id;
      }
      return last || null;
    },
  });
}
