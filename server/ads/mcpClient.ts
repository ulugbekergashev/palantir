/**
 * Meta'ning rasmiy reklama MCP serveriga Palantir'ning o'zi ulanishi: tekshiruv (token MCP'ga yaraydimi — `ads_mcp_management` ruxsati)
 * va egasi tasdiqlagan amalni bajarish. Model esa shu serverga Agent SDK orqali ulanadi (engine.ts external).
 * Token jurnalga yozilmaydi. META_ADS_MCP_URL — faqat sinov (soxta server); META_ADS_MCP=0 — MCP o'chiq (eski reja yo'li qoladi)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { APP_VERSION } from '../version';

export const mcpUrl = (): string => process.env.META_ADS_MCP_URL || 'https://mcp.facebook.com/ads';
export const mcpEnabled = (): boolean => process.env.META_ADS_MCP !== '0';
export const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Tekshiruv egasining javobini ushlab turadi (yarim soatda bir marta) — qisqa */
const PROBE_MS = 8_000;
const CALL_MS = 120_000;

/** refused — Meta javob berib, aniq rad etdi (hech narsa qilinmagan); aks holda javob kelmadi — bajarilgan bo'lishi mumkin */
export class McpCallError extends Error {
  constructor(message: string, readonly refused: boolean) { super(message); }
}

async function withClient<T>(token: string, timeout: number, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl()), { requestInit: { headers: authHeaders(token) } });
  const client = new Client({ name: 'palantir', version: APP_VERSION });
  try {
    await client.connect(transport, { timeout });
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Server ochiladimi va asboblar ro'yxati keladimi (token ruxsati) — xatoda false */
export async function mcpWorks(token: string): Promise<boolean> {
  try {
    const r = await withClient(token, PROBE_MS, c => c.listTools(undefined, { timeout: PROBE_MS }));
    return r.tools.some(t => t.name.startsWith('ads_'));
  } catch {
    return false;
  }
}

/** Bitta asbob: natija matni. Meta xatosi (isError) — McpCallError (egasiga matni ko'rsatiladi) */
export async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<string> {
  let r: Awaited<ReturnType<Client['callTool']>>;
  try {
    r = await withClient(token, CALL_MS, c => c.callTool({ name, arguments: args }, undefined, { timeout: CALL_MS }));
  } catch (e) {
    throw new McpCallError(`Meta bilan aloqa bo'lmadi: ${(e as Error).message}`, false);
  }
  const content = Array.isArray(r.content) ? r.content : [];
  const text = content.map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('\n').trim();
  if (r.isError) throw new McpCallError(text.slice(0, 400) || 'Meta amalni bajarmadi', true);
  return text;
}
