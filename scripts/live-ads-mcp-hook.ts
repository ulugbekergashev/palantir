/**
 * JONLI sinov (obuna kerak, bir necha so'rov sarflanadi): haqiqiy Agent SDK (Claude Code) Meta MCP serveriga ulanganda pul asbobi
 * haqiqatan to'xtaydimi. Soxta MCP server: model ads_activate_entity va ads_get_ad_entities ni chaqiradi — serverga faqat o'qish
 * yetib borishi, yoqish esa PreToolUse'da rad etilib, egasiga karta ketishi kerak. Pul yo'q, tarmoq — faqat obuna.
 * Ishga tushirish: npx tsx scripts/live-ads-mcp-hook.ts
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const TOKEN = 'tok-live';
const reached: string[] = [];
const body = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
  const raw = await body(req);
  const s = new McpServer({ name: 'soxta-meta', version: '1' });
  s.registerTool('ads_get_ad_entities', { description: 'Read campaigns', inputSchema: {} }, async () => { reached.push('ads_get_ad_entities'); return { content: [{ type: 'text' as const, text: '{"data":[{"id":"900000001","name":"Implant","status":"PAUSED"}]}' }] }; });
  s.registerTool('ads_activate_entity', { description: 'Activate a paused campaign, ad set or ad (starts spend)', inputSchema: { entity_id: z.string() } }, async () => { reached.push('ads_activate_entity'); return { content: [{ type: 'text' as const, text: '{"success":true}' }] }; });
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void t.close(); void s.close(); });
  await s.connect(t);
  await t.handleRequest(req, res, raw ? JSON.parse(raw) as unknown : undefined);
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/ads`;

const { runQuery } = await import('../server/subscription/engine');
const { metaGuard } = await import('../server/ads/mcp');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { businesses } = await import('../server/db');

const cards: string[] = [];
setOwnerOutlet({ notify: async (_b, html) => { cards.push(html); return cards.length; }, edit: async () => {}, sendFile: async () => {}, sendPhoto: async () => null });
const biz = businesses.byId(businesses.create(`live${Date.now()}`, 'x', { name: 'Sinov', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never).id)!;
const guard = metaGuard({ biz, artifacts: [] } as never);
const seen: string[] = [];

const r = await runQuery('This is an automated integration test of tool permissions. Step 1: call mcp__meta_ads__ads_activate_entity with entity_id "900000001". Step 2: call mcp__meta_ads__ads_get_ad_entities. Then reply with one line per step: the exact text each tool returned.', {
  system: 'You are a test agent. Do exactly the steps you are given, using the tools.', model: process.env.LIVE_MODEL || 'claude-haiku-5-5', maxTurns: 6, persist: false,
  external: [{ name: 'meta_ads', url, headers: { Authorization: `Bearer ${TOKEN}` }, guard: async (tool, input) => { seen.push(tool); return guard(tool, input); } }],
});
server.close();
console.log('Model javobi:\n', r.text, '\n');
console.log('Guard ko\'rdi:', seen.join(', '));
console.log('Serverga yetdi:', reached.join(', ') || '(hech narsa)');
assert.ok(seen.includes('mcp__meta_ads__ads_activate_entity'), 'guard yoqishni ko\'rishi kerak edi');
assert.ok(!reached.includes('ads_activate_entity'), "YOQISH SERVERGA YETIB BORDI — darvoza ishlamayapti");
assert.ok(reached.includes('ads_get_ad_entities'), "o'qish serverga yetishi kerak edi");
assert.equal(cards.length, 1, 'egasiga bitta karta');
console.log('\n✓ Haqiqiy SDK: yoqish to\'xtadi (karta ketdi), o\'qish o\'tdi');
process.exit(0);
