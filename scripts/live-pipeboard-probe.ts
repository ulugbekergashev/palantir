/**
 * Haqiqiy Pipeboard serveri bilan qisqa tekshiruv (pul va kabinetga tegmaydi):
 *  - tokensiz/soxta token bilan: Palantir «token ishlamadi» deydi, xato matnida token yo'q;
 *  - PIPEBOARD_TOKEN berilsa: asboblar ro'yxati — Palantir qoidalari bilan solishtiriladi (noma'lum asboblar yopiq), kabinetlar soni.
 * Ishga tushirish: npx tsx scripts/live-pipeboard-probe.ts   (yoki PIPEBOARD_TOKEN=… bilan)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { endpointOf, mcpCall, mcpWorks } from '../server/ads/mcpClient';
import { classify } from '../server/ads/mcpRules';

const fakeToken = 'pb_palantir_probe_not_a_real_token_000';
const fakeEp = endpointOf({ token: fakeToken, via: 'pipeboard' });
console.log('soxta token → mcpWorks:', await mcpWorks(fakeEp));
try {
  await mcpCall(fakeEp, 'get_ad_accounts', {});
} catch (e) {
  const m = (e as Error).message;
  console.log('soxta token → xato:', m.slice(0, 200));
  console.log('xato matnida token bormi:', m.includes(fakeToken));
}

const token = process.env.PIPEBOARD_TOKEN?.trim();
if (token) {
  const ep = endpointOf({ token, via: 'pipeboard' });
  console.log('haqiqiy token → mcpWorks:', await mcpWorks(ep));
  const client = new Client({ name: 'palantir', version: 'probe' });
  await client.connect(new StreamableHTTPClientTransport(new URL(ep.url)));
  const { tools } = await client.listTools();
  await client.close();
  const by: Record<string, string[]> = {};
  for (const t of tools) {
    const v = classify(t.name, {}, 'pipeboard');
    (by[v.kind === 'money' ? `money:${v.action}` : v.kind] ??= []).push(t.name);
  }
  console.log(`asboblar: ${tools.length}`);
  for (const [k, names] of Object.entries(by)) console.log(`  ${k}: ${names.sort().join(', ')}`);
  const acc = JSON.parse(await mcpCall(ep, 'get_ad_accounts', { limit: 50 })) as { data?: { name?: string; currency?: string; account_status?: number }[] };
  console.log('kabinetlar:', (acc.data ?? []).map(a => `${a.name} (${a.currency}, holat ${a.account_status})`).join('; ') || "yo'q");
}
