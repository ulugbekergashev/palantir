/**
 * Reklama MCP serveriga Palantir'ning o'zi ulanishi: tekshiruv (token MCP'ga yaraydimi) va egasi tasdiqlagan amalni bajarish.
 * Model esa shu serverga Agent SDK orqali ulanadi (engine.ts external). Ikki xil server:
 *  - meta — Meta'ning rasmiy serveri (https://mcp.facebook.com/ads), Facebook tokeni `Authorization` sarlavhasida
 *    (`ads_mcp_management` ruxsati kerak); META_ADS_MCP_URL — faqat sinov;
 *  - pipeboard — Pipeboard (Meta Business Partner) serveri, Pipeboard tokeni manzilda (`?token=`, ularning hujjati bo'yicha).
 *    O'z Meta ilovasi kerak emas; PIPEBOARD_MCP_URL — faqat sinov.
 * Token jurnalga va xato matniga yozilmaydi. META_ADS_MCP=0 — MCP o'chiq (eski reja yo'li qoladi)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { APP_VERSION } from '../version';

/** claudeai — egasining claude.ai'dagi Meta Ads ulagichi (token yo'q, chaqiruvlar obuna orqali: claudeai.ts) */
export type AdsVia = 'meta' | 'pipeboard' | 'claudeai';

export const mcpUrl = (): string => process.env.META_ADS_MCP_URL || 'https://mcp.facebook.com/ads';
const pipeboardBase = (): string => process.env.PIPEBOARD_MCP_URL || 'https://meta-ads.mcp.pipeboard.co/';
export const mcpEnabled = (): boolean => process.env.META_ADS_MCP !== '0';
export const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Qayerga va qanday ulaniladi. secret — xato matnlaridan o'chiriladigan token */
export interface McpEndpoint { url: string; headers: Record<string, string>; via: AdsVia; secret: string }

export function endpointOf(c: { token: string; via?: AdsVia }): McpEndpoint {
  if (c.via === 'claudeai') throw new Error("claude.ai ulagichi orqali ulangan kabinetda MCP manzili yo'q (chaqiruvlar — claudeai.ts)");
  if (c.via === 'pipeboard') {
    const u = new URL(pipeboardBase());
    u.searchParams.set('token', c.token);
    return { url: u.toString(), headers: {}, via: 'pipeboard', secret: c.token };
  }
  return { url: mcpUrl(), headers: authHeaders(c.token), via: 'meta', secret: c.token };
}

/** Xato matnida token (yoki manzildagi token) qolmasin */
export const redact = (text: string, secret: string): string => {
  let out = text;
  for (const s of [secret, encodeURIComponent(secret)]) if (s.length >= 8) out = out.split(s).join('***');
  return out.replace(/([?&]token=)[^&\s"']+/gi, '$1***');
};

/** Tekshiruv egasining javobini ushlab turadi (yarim soatda bir marta) — qisqa */
const PROBE_MS = 8_000;
const CALL_MS = 120_000;

/** refused — server javob berib, aniq rad etdi (hech narsa qilinmagan); aks holda javob kelmadi — bajarilgan bo'lishi mumkin */
export class McpCallError extends Error {
  constructor(message: string, readonly refused: boolean) { super(message); }
}

async function withClient<T>(ep: McpEndpoint, timeout: number, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(ep.url), { requestInit: { headers: ep.headers } });
  const client = new Client({ name: 'palantir', version: APP_VERSION });
  try {
    await client.connect(transport, { timeout });
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Server shu yo'lning o'z asboblarini beradimi: Meta — «ads_…», Pipeboard — kabinetlar ro'yxati asbobi */
const looksRight = (via: AdsVia, names: string[]): boolean =>
  via === 'pipeboard' ? names.some(n => /(?:^|_)get_ad_accounts$/.test(n)) : names.some(n => n.startsWith('ads_'));

/** Server ochiladimi va asboblar ro'yxati keladimi (token ruxsati) — xatoda false */
export async function mcpWorks(ep: McpEndpoint): Promise<boolean> {
  try {
    const r = await withClient(ep, PROBE_MS, c => c.listTools(undefined, { timeout: PROBE_MS }));
    return looksRight(ep.via, r.tools.map(t => t.name));
  } catch {
    return false;
  }
}

const SERVER_NAME: Record<AdsVia, string> = { meta: 'Meta', pipeboard: 'Pipeboard', claudeai: 'Meta' };

/** Bitta asbob: natija matni. Server xatosi (isError) — McpCallError (egasiga matni ko'rsatiladi) */
export async function mcpCall(ep: McpEndpoint, name: string, args: Record<string, unknown>): Promise<string> {
  let r: Awaited<ReturnType<Client['callTool']>>;
  try {
    r = await withClient(ep, CALL_MS, c => c.callTool({ name, arguments: args }, undefined, { timeout: CALL_MS }));
  } catch (e) {
    throw new McpCallError(redact(`${SERVER_NAME[ep.via]} bilan aloqa bo'lmadi: ${(e as Error).message}`, ep.secret), false);
  }
  const content = Array.isArray(r.content) ? r.content : [];
  const text = content.map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('\n').trim();
  if (r.isError) throw new McpCallError(redact(text, ep.secret).slice(0, 400) || `${SERVER_NAME[ep.via]} amalni bajarmadi`, true);
  // Pipeboard xatoni oddiy javob ichida qaytaradi: {"error": …}
  const err = jsonError(text);
  if (err) throw new McpCallError(redact(err, ep.secret).slice(0, 400), true);
  return text;
}

/** Javob — JSON obyekt va yuqori darajada «error» bor: xato matni; aks holda null */
export function jsonError(text: string): string | null {
  if (!text.startsWith('{')) return null;
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || !('error' in o)) return null;
  const e = (o as { error: unknown }).error;
  if (!e) return null;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown; error_user_msg?: unknown }).error_user_msg ?? (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : JSON.stringify(e);
}
