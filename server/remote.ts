/**
 * Masofadan kirish: egasining telefoni (Telegram Mini App yoki brauzer) → Palantir Hub (HTTPS) → shu kompyuter o'zi ulangan uzun
 * so'rov (/api/pull, port ochilmaydi) → shu yerdagi panel serveri → javob hubga → telefonga.
 * Hub orqali kelgan so'rov http.ts'da shu jarayonning siri bilan belgilanadi: admin, ulash ustasi va ichki xizmatlar yo'llari
 * masofadan yopiq, kirish urinishlari mijozning haqiqiy manzili bo'yicha sanaladi. REMOTE_PANEL=0 — o'chiq.
 */
import { randomBytes } from 'node:crypto';
import { env } from './env';

/** Hub'dan kelgan so'rovni belgilovchi sir: har ishga tushishda yangi, tashqariga chiqmaydi */
export const RELAY_SECRET = randomBytes(24).toString('hex');
export const RELAY_HEADER = 'x-palantir-relay', CLIENT_HEADER = 'x-palantir-client';

export interface RelayRequest { id: string; method: string; path: string; headers: Record<string, string>; body: string; ip: string }
interface RelayAnswer { status: number; headers: Record<string, string>; body: string }

const ANSWER_HEADERS = ['content-type', 'cache-control', 'etag', 'content-disposition', 'last-modified'];
/** AI bilan suhbat bir daqiqadan oshishi mumkin; hub 120 soniya kutadi */
const LOCAL_TIMEOUT_MS = 110_000;

const text = (status: number, message: string): RelayAnswer =>
  ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify({ error: message })).toString('base64') });

/** Panel qaysi manzilda tinglaydi (hamma tarmoqda bo'lsa — shu kompyuterning o'zi) */
const localBase = () => `http://${['0.0.0.0', '::', ''].includes(env.listenHost) ? '127.0.0.1' : env.listenHost}:${env.port}`;

async function answerOf(r: RelayRequest): Promise<RelayAnswer> {
  if (!env.remotePanel) return text(403, "Masofadan kirish o'chirilgan (klinika kompyuterida REMOTE_PANEL=0)");
  if (!r.path.startsWith('/')) return text(400, "Noto'g'ri yo'l");
  try {
    const res = await fetch(`${localBase()}${r.path}`, {
      method: r.method,
      headers: { ...r.headers, [RELAY_HEADER]: RELAY_SECRET, [CLIENT_HEADER]: r.ip },
      body: r.method === 'GET' || r.method === 'HEAD' ? undefined : Buffer.from(r.body, 'base64'),
      redirect: 'manual',
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    });
    const headers = Object.fromEntries(ANSWER_HEADERS.flatMap(n => { const v = res.headers.get(n); return v ? [[n, v]] : []; }));
    return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()).toString('base64') };
  } catch (e) {
    return text(502, `Panel serveri javob bermadi: ${(e as Error).message}`);
  }
}

/** Bitta masofaviy so'rov: shu yerdagi panelga beradi va javobni hubga qaytaradi (boshqa so'rovlarni kutib turmaydi) */
export async function handleRelay(r: RelayRequest, hub: { url: string; key: string }): Promise<void> {
  const answer = await answerOf(r);
  const res = await fetch(`${hub.url}/api/relay/${r.id}`, {
    method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify(answer), signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`hub ${res.status}`);
}

/** Panelning masofaviy manzili (Telegram Mini App ham shu): hub kodi bor va o'chirilmagan bo'lsa */
export function remoteUrl(): string | null {
  return env.hub && env.remotePanel ? `${env.hub.url}/c/${env.hub.clinicId}/` : null;
}
