/**
 * Targetolog Meta'ning rasmiy reklama MCP serveri orqali — soxta MCP va soxta Graph bilan (haqiqiy pul va tarmoqsiz):
 * qaysi asbob o'zi ishlaydi / egasiga karta / yopiq, karta → tugma → limitlar → Meta'da bajarish → kuzatuv, limitdan oshsa to'xtatish,
 * obuna dvigateliga ulanish (asbob ruxsati va PreToolUse rad etishi).
 * Ishga tushirish: npm run test:ads-mcp
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const TOKEN = 'tok-mcp';
const body = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });

// ─── Soxta Meta MCP ───────────────────────────────────────────────────────────
const mcpCalls: { name: string; args: Record<string, unknown> }[] = [];
const mcpFake = { boostResult: '{"campaign_id":"555000111"}', failNext: false };
function fakeMcp(): McpServer {
  const s = new McpServer({ name: 'soxta-meta', version: '1' });
  const reg = (name: string, shape: z.ZodRawShape, reply: (a: Record<string, unknown>) => string) =>
    s.registerTool(name, { inputSchema: shape }, async args => {
      mcpCalls.push({ name, args: args as Record<string, unknown> });
      if (mcpFake.failNext) { mcpFake.failNext = false; return { content: [{ type: 'text' as const, text: 'Meta: ruxsat yo\'q' }], isError: true }; }
      return { content: [{ type: 'text' as const, text: reply(args as Record<string, unknown>) }] };
    });
  reg('ads_get_ad_entities', {}, () => '{"data":[]}');
  reg('ads_activate_entity', { entity_id: z.string() }, a => `{"success":true,"id":"${String(a.entity_id)}"}`);
  reg('ads_update_entity', { entity_id: z.string(), status: z.string().optional(), daily_budget: z.number().optional() }, () => '{"success":true}');
  reg('ads_boost_ig_post', { media_id: z.string() }, () => mcpFake.boostResult);
  return s;
}
const mcpServer = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end('{"error":"invalid token"}'); return; }
  const raw = await body(req);
  // Holatsiz: har so'rovga yangi server (MCP SDK hujjatidagi namuna)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const s = fakeMcp();
  res.on('close', () => { void transport.close(); void s.close(); });
  await s.connect(transport);
  await transport.handleRequest(req, res, raw ? JSON.parse(raw) as unknown : undefined);
});

// ─── Soxta Graph ──────────────────────────────────────────────────────────────
const graphCalls: { method: string; path: string; params: Record<string, string> }[] = [];
const graphFake = { today: '0', month: '0', status: {} as Record<string, string>, campaignSpend: null as string | null };
/** Kampaniyalar: 900000001 — kuniga 10$; 900000003 — kuniga 50$ (kunlik limitdan ko'p); 555000111 — boost, kuniga 5$; 900000002 — guruh */
const CAMPS: Record<string, { name: string; daily_budget?: string; lifetime_budget?: string }> = {
  '900000001': { name: 'Implant', daily_budget: '1000' },
  '900000003': { name: 'Katta', daily_budget: '5000' },
  '555000111': { name: 'Boost', daily_budget: '500' },
  '900000004': { name: 'Guruhli' },
};
const graph = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  const raw = req.method === 'GET' ? '' : await body(req);
  const params = req.method === 'GET' ? Object.fromEntries(url.searchParams) : Object.fromEntries(new URLSearchParams(raw));
  const path = url.pathname.replace(/^\/v26\.0\//, '');
  graphCalls.push({ method: req.method!, path, params });
  const send = (code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (params.access_token !== TOKEN) return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
  if (path === 'act_1234567/insights') return send(200, { data: [{ spend: params.date_preset === 'today' ? graphFake.today : graphFake.month }] });
  if (req.method === 'POST' && CAMPS[path]) { if (params.status) graphFake.status[path] = params.status; return send(200, { success: true }); }
  const fields = String(params.fields ?? '');
  if (/^\d+\/insights$/.test(path)) return send(200, { data: [{ spend: graphFake.campaignSpend ?? '1' }] });
  if (path === '900000004/adsets') return send(200, { data: [{ daily_budget: '300' }, { daily_budget: '200' }, { daily_budget: '900', effective_status: 'DELETED' }] });
  if (CAMPS[path]) {
    if (fields === 'effective_status') return send(200, { effective_status: graphFake.status[path] ?? 'ACTIVE' });
    return send(200, { ...CAMPS[path], objective: 'OUTCOME_ENGAGEMENT' });
  }
  // Guruh: «objective» maydoni yo'q (Meta xato qaytaradi), campaign_id bor
  if (path === '900000002') return fields.includes('objective') ? send(400, { error: { message: 'nonexisting field (objective)', code: 100 } }) : send(200, { campaign_id: '900000001' });
  send(404, { error: { message: `soxta: ${req.method} ${path}`, code: 100 } });
});

const port = async (s: ReturnType<typeof createServer>) => { await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r())); return (s.address() as { port: number }).port; };
process.env.META_ADS_MCP_URL = `http://127.0.0.1:${await port(mcpServer)}/ads`;
process.env.META_GRAPH_BASE = `http://127.0.0.1:${await port(graph)}`;

const { classify, entityIds, idsInText, BLOCKED, CREATE_PAUSED, NO_PEOPLE } = await import('../server/ads/mcpRules');
const { metaGuard, approveAction, cancelAction, mcpReady, forgetReady, overLimits, metaAdsServer, META_SERVER } = await import('../server/ads/mcp');
const { adsStore, mcpStore, TargetError } = await import('../server/ads/store');
const { watch } = await import('../server/ads/campaigns');
const { optionsFor } = await import('../server/subscription/engine');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { businesses, sql } = await import('../server/db');

const sent: { html: string; keyboard?: unknown }[] = [];
let telegramUp = true;
setOwnerOutlet({
  notify: async (_b, html, keyboard) => { if (!telegramUp) return null; sent.push({ html, keyboard }); return sent.length; },
  edit: async () => {}, sendFile: async () => {}, sendPhoto: async () => null,
});

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 4).join('\n    ')}`); }
}
const rejects = async (p: Promise<unknown>, re: RegExp) => {
  try { await p; } catch (e) { assert.ok(e instanceof TargetError, `TargetError kutilgan edi: ${(e as Error).message}`); assert.match(e.message, re); return; }
  assert.fail('xato kutilgan edi');
};
const PROFILE = { name: 'Sinov', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never;
const newBiz = () => {
  const b = businesses.create(`mcp${Date.now()}${Math.random()}`, 'x', PROFILE);
  adsStore.saveConnection(b.id, { token: TOKEN, adAccountId: '1234567', accountName: 'Kabinet', currency: 'USD', pageId: '7770001', pageName: 'Sahifa', igActorId: null, timezone: 'Asia/Tashkent' });
  adsStore.saveLimits(b.id, { perCampaign: 400, daily: 20, monthly: 300 });
  return businesses.byId(b.id)!;
};
const ctxOf = (biz: ReturnType<typeof newBiz>, over: Record<string, unknown> = {}) => ({ biz, artifacts: [], ...over }) as never as Parameters<typeof metaGuard>[0];
const cardId = () => {
  const kb = sent.at(-1)?.keyboard as { inline_keyboard: { callback_data: string }[][] };
  return kb.inline_keyboard[0][0].callback_data.split('|')[1];
};

console.log('Targetolog — Meta MCP');

await check("asboblar: o'qish — ruxsat, yaratish — pauzada, pul — karta, qolgani — yopiq", () => {
  assert.deepEqual(classify('ads_get_ad_entities', {}), { kind: 'allow', strangers: false });
  assert.deepEqual(classify('ads_insights_performance_trend', {}), { kind: 'allow', strangers: false });
  assert.deepEqual(classify('ads_library_search', { q: 'implant' }), { kind: 'allow', strangers: true }, 'Ad Library — begona matn');
  assert.equal(classify('ads_create_campaign', { name: 'x', objective: 'OUTCOME_ENGAGEMENT' }).kind, 'allow');
  assert.equal(classify('ads_create_ad_set', { daily_budget: 1000, status: 'PAUSED' }).kind, 'allow', 'pauzadagi guruhda byudjet — pul ketmaydi');
  assert.deepEqual(classify('ads_create_campaign', { name: 'x', status: 'ACTIVE' }), { kind: 'deny', why: CREATE_PAUSED });
  assert.deepEqual(classify('ads_create_ad', { params: '{"adset":{"configured_status":"active"}}' }), { kind: 'deny', why: CREATE_PAUSED }, 'JSON satr ichidagi holat ham');
  assert.deepEqual(classify('ads_activate_entity', { entity_id: '1' }), { kind: 'money', action: 'activate' });
  assert.deepEqual(classify('ads_boost_ig_post', {}), { kind: 'money', action: 'boost' });
  assert.equal(classify('ads_update_entity', { entity_id: '1', status: 'PAUSED' }).kind, 'allow', "to'xtatish — o'zi");
  assert.equal(classify('ads_update_entity', { entity_ids: ['1', '2'], entity_type: 'CAMPAIGN', status: 'paused' }).kind, 'allow');
  assert.equal(classify('ads_update_entity', { entity_id: '1', name: 'Yangi nom' }).kind, 'allow');
  const money = { kind: 'money', action: 'update' };
  // Kartasiz faqat to'xtatish/nom: boshqa har qanday shakl — egasiga (Meta maydon nomlari hujjatda yo'q)
  for (const input of [
    { entity_id: '1', status: 'ACTIVE' }, { entity_id: '1', status: 'DELETED' }, { entity_id: '1', status: 'ARCHIVED' },
    { entity_id: '1', fields: { daily_budget: 500 } }, { entity_id: '1', bid_amount: 30 }, { entity_id: '1', end_time: '2026-12-30' },
    { entity_id: '1', field: 'status', value: 'ACTIVE' }, { entity_id: '1', updates: [{ field: 'daily_budget', value: 5000 }] },
    { entity_id: '1', status: { value: 'ACTIVE' } }, { entity_id: '1', paused: false }, { entity_id: '1' },
    { a: { a: { a: { a: { a: { a: { a: { a: { status: 'PAUSED' } } } } } } } } },
  ]) assert.deepEqual(classify('ads_update_entity', input), money, JSON.stringify(input));
  for (const t of ['ads_update_custom_audience_users', 'ads_delete_custom_audience', 'ads_catalog_create', 'ads_create_upload_url', 'ads_new_tool_2027', 'ads_get_new_thing'])
    assert.deepEqual(classify(t, {}), { kind: 'deny', why: BLOCKED }, t);
  assert.deepEqual(classify('ads_create_ad_set', { name: 'x', paused: false }), { kind: 'deny', why: CREATE_PAUSED });
  // Auditoriya: Instagram bilan ishlaganlardan — mumkin; telefon, email, xesh — yo'q
  assert.equal(classify('ads_create_custom_audience', { name: 'IG 90 kun', rule: { event_sources: [{ id: '17841400000000000', type: 'ig_business' }], retention_seconds: 7776000 } }).kind, 'allow');
  for (const input of [{ name: 'B', phones: ['998901234567'] }, { name: 'B', schema: ['EMAIL'], data: [['a@b.uz']] }, { name: 'B', list: ['+998 90 123 45 67'] }, { name: 'B', x: 'a'.repeat(64) }])
    assert.deepEqual(classify('ads_update_custom_audience', input), { kind: 'deny', why: NO_PEOPLE }, JSON.stringify(input));
});

await check('raqamlar: kirishdagi id/ids, natija matnidagi id', () => {
  assert.deepEqual(entityIds({ entity_id: '900000001', other: { campaign_ids: ['900000002', 'x'], adset_id: 900000003 }, name: '1234567' }).sort(), ['900000001', '900000002', '900000003']);
  assert.deepEqual(idsInText('{"campaign_id":"555000111","ad":{"id":"555000112"}}').sort(), ['555000111', '555000112']);
});

await check("token MCP'ga yaraydimi: to'g'ri token — ha, noto'g'risi — yo'q; ulanmagan biznesga server berilmaydi", async () => {
  const biz = newBiz();
  assert.equal(await mcpReady(biz.id, adsStore.connection(biz.id)!), true);
  const bad = newBiz();
  adsStore.saveConnection(bad.id, { ...adsStore.connection(bad.id)!, token: 'eski-token' });
  assert.equal(await mcpReady(bad.id, adsStore.connection(bad.id)!), false);
  const none = businesses.byId(businesses.create(`mcpn${Date.now()}`, 'x', PROFILE).id)!;
  assert.equal(await metaAdsServer(ctxOf(none)), null);
  const ext = await metaAdsServer(ctxOf(biz));
  assert.equal(ext?.name, META_SERVER);
  assert.equal(ext?.headers.Authorization, `Bearer ${TOKEN}`);
  process.env.META_ADS_MCP = '0';
  forgetReady(biz.id);
  assert.equal(await metaAdsServer(ctxOf(biz)), null, "META_ADS_MCP=0 — o'chiq");
  delete process.env.META_ADS_MCP;
});

await check("model chaqiruvi: o'qish o'tadi, Ad Library begona deb belgilanadi, yoqish — bajarilmaydi, egasiga karta", async () => {
  const biz = newBiz(), ctx = ctxOf(biz) as { readStrangers?: boolean };
  const guard = metaGuard(ctx as never);
  assert.equal(await guard(`mcp__${META_SERVER}__ads_get_ad_entities`, {}), null);
  assert.equal(ctx.readStrangers, undefined);
  const before = sent.length;
  const why = await guard(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  assert.match(String(why), /Not run by you.*Tasdiqlash/);
  assert.equal(sent.length, before + 1);
  assert.match(sent.at(-1)!.html, /Reklamani yoqish[\s\S]*«Implant» — kuniga 10 USD, muddatsiz[\s\S]*entity_id: 900000001/);
  assert.equal(mcpStore.get(biz.id, cardId())?.status, 'pending');
  assert.equal(mcpCalls.length, 0, "Meta'ga hech narsa ketmadi");
  assert.equal(await guard(`mcp__${META_SERVER}__ads_library_search`, { q: 'implant' }), null);
  assert.equal(ctx.readStrangers, true);
  assert.match(String(await guard(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' })), /other people's text/, 'begona matndan keyin — karta ham yo\'q');
});

await check("rad: rasm, jadvaldagi ish, Telegram yo'q, bitta gapda 3 tadan ko'p karta, yopiq asbob", async () => {
  const biz = newBiz();
  const act = `mcp__${META_SERVER}__ads_activate_entity`;
  assert.match(String(await metaGuard(ctxOf(biz, { fromPhoto: true }))(act, { entity_id: '900000001' })), /picture/);
  assert.match(String(await metaGuard(ctxOf(biz, { unattended: true }))(act, { entity_id: '900000001' })), /not watching/);
  assert.equal(await metaGuard(ctxOf(biz, { unattended: true }))(`mcp__${META_SERVER}__ads_update_entity`, { entity_id: '900000001', status: 'PAUSED' }), null, "jadvalda ham to'xtatish mumkin");
  telegramUp = false;
  assert.match(String(await metaGuard(ctxOf(biz))(act, { entity_id: '900000001' })), /Telegram is not connected/);
  telegramUp = true;
  const g = metaGuard(ctxOf(biz));
  for (let i = 0; i < 3; i++) assert.match(String(await g(act, { entity_id: '900000001' })), /Not run by you/);
  assert.match(String(await g(act, { entity_id: '900000001' })), /three approval cards/);
  assert.equal(await g(`mcp__${META_SERVER}__ads_update_custom_audience_users`, { phones: ['998901234567'] }), BLOCKED, "bemorlar raqami Meta'ga ketmaydi");
  const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, i]));
  assert.match(String(await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_update_entity`, { entity_id: '900000001', ...wide })), /too much for the owner/, "kartaga sig'maydigan narsa — karta ham yo'q");
});

await check("tugma: limit ichida — Meta'da bajariladi, kampaniya kuzatuvga; ikkinchi bosish — yo'q", async () => {
  const biz = newBiz();
  await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000002' });
  const id = cardId();
  assert.match(sent.at(-1)!.html, /«Implant»/, "guruh orqali kampaniyasi topildi");
  mcpCalls.length = 0;
  await approveAction(biz, id);
  assert.deepEqual(mcpCalls, [{ name: 'ads_activate_entity', args: { entity_id: '900000002' } }]);
  assert.equal(mcpStore.get(biz.id, id)?.status, 'done');
  const t = mcpStore.tracked(biz.id, '900000001');
  assert.equal(t?.status, 'active');
  assert.equal(t?.daily, 10);
  assert.match(sent.at(-1)!.html, /bajarildi[\s\S]*Kuzatuvda/);
  await rejects(approveAction(biz, id), /Allaqachon/);
});

await check("tugma: limitdan oshsa — Meta'ga so'rov ketmaydi; limit yo'q — ham; bekor qilish", async () => {
  const biz = newBiz();
  const g = metaGuard(ctxOf(biz));
  await g(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000003' });
  const big = cardId();
  mcpCalls.length = 0;
  await rejects(approveAction(biz, big), /kunlik limitdan/);
  assert.equal(mcpCalls.length, 0);
  assert.equal(mcpStore.get(biz.id, big)?.status, 'failed');
  await g(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  const small = cardId();
  adsStore.saveLimits(biz.id, { perCampaign: 0, daily: 0, monthly: 0 });
  await rejects(approveAction(biz, small), /Limitlar o'rnatilmagan/);
  adsStore.saveLimits(biz.id, { perCampaign: 400, daily: 20, monthly: 300 });
  await g(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  const third = cardId();
  cancelAction(biz, third);
  await rejects(approveAction(biz, third), /Bekor qilingan/);
  assert.throws(() => cancelAction(biz, third), TargetError);
});

await check("karta bir kundan keyin eskiradi; Meta xatosi — egasiga sababi", async () => {
  const biz = newBiz();
  const g = metaGuard(ctxOf(biz));
  await g(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  const old = cardId();
  sql.run('UPDATE ads_mcp_actions SET created_at = ? WHERE id = ?', new Date(Date.now() - 2 * 86_400_000).toISOString(), old);
  await rejects(approveAction(biz, old), /eskirgan/);
  await g(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  const id = cardId();
  mcpFake.failNext = true;
  await rejects(approveAction(biz, id), /ruxsat yo'q/);
  assert.equal(mcpStore.get(biz.id, id)?.status, 'failed');
  assert.notEqual(mcpStore.tracked(biz.id, '900000001')?.status, 'active', 'Meta rad etdi — kuzatuvdan chiqadi');
});

await check("Meta javob bermadi: bajarilgan bo'lishi mumkin — kampaniya kuzatuvda qoladi, egasiga «aniq emas»", async () => {
  const biz = newBiz();
  await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000001' });
  const id = cardId();
  const url = process.env.META_ADS_MCP_URL;
  process.env.META_ADS_MCP_URL = 'http://127.0.0.1:1/ads';
  try { await rejects(approveAction(biz, id), /aniq emas — kampaniya kuzatuvda/); } finally { process.env.META_ADS_MCP_URL = url; }
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active');
});

await check("boost: natijadagi kampaniya kuzatuvga; Meta'dagi haqiqiy byudjet limitdan oshsa — darhol to'xtatiladi", async () => {
  const biz = newBiz();
  await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_boost_ig_post`, { media_id: '17890001' });
  await approveAction(biz, cardId());
  assert.equal(mcpStore.tracked(biz.id, '555000111')?.status, 'active');
  // Ikkinchi biznes: boost Meta'da kuniga 50$ chiqdi (kunlik limit 20$)
  const b2 = newBiz();
  mcpFake.boostResult = '{"campaign_id":"900000003"}';
  await metaGuard(ctxOf(b2))(`mcp__${META_SERVER}__ads_boost_ig_post`, { media_id: '17890002' });
  await approveAction(b2, cardId());
  mcpFake.boostResult = '{"campaign_id":"555000111"}';
  assert.equal(graphFake.status['900000003'], 'PAUSED');
  assert.equal(mcpStore.tracked(b2.id, '900000003')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /darhol to'xtatildi/);
});

await check("byudjet o'zgarishi: karta, tasdiqdan keyin Meta'dagi summa bilan qayta tekshiruv", async () => {
  const biz = newBiz();
  await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_update_entity`, { entity_id: '900000001', daily_budget: 1500 });
  assert.match(sent.at(-1)!.html, /Byudjet, stavka[\s\S]*daily_budget: 1500/);
  mcpCalls.length = 0;
  await approveAction(biz, cardId());
  assert.equal(mcpCalls[0]?.name, 'ads_update_entity');
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active');
});

await check("limitlar hisobi: guruhlar yig'indisi (o'chirilgani yo'q), ishlayotganlar kunlik tezligi, oy oxirigacha", () => {
  const L = { perCampaign: 100, daily: 20, monthly: 300 };
  const S = { today: 0, month: 0, committed: 0, dailyRate: 0 };
  const e = (daily: number | null, lifetime: number | null = null, endsAt: string | null = null) => ({ campaignId: '1', name: 'K', daily, lifetime, endsAt });
  assert.deepEqual(overLimits(L, S, [e(10)], 'USD'), []);
  assert.match(overLimits(L, { ...S, dailyRate: 15 }, [e(10)], 'USD').join(), /ishlayotganlar/);
  assert.match(overLimits(L, S, [e(null)], 'USD').join(), /byudjeti o'qilmadi/);
  assert.match(overLimits(L, S, [e(null, 150, new Date(Date.now() + 10 * 86_400_000).toISOString())], 'USD').join(), /bir kampaniya/);
  assert.match(overLimits(L, { ...S, month: 290 }, [e(10)], 'USD').join(), /Oylik limit/);
  assert.match(overLimits(L, { ...S, today: 20 }, [e(1)], 'USD').join(), /Bugungi limit tugagan/);
});

await check("guruhli kampaniya: byudjet guruhlardan (o'chirilgani hisobga olinmaydi)", async () => {
  const biz = newBiz();
  await metaGuard(ctxOf(biz))(`mcp__${META_SERVER}__ads_activate_entity`, { entity_id: '900000004' });
  assert.match(sent.at(-1)!.html, /«Guruhli» — kuniga 5 USD/);
});

await check("kuzatuv: MCP orqali yoqilgan kampaniya kunlik limitga yetsa to'xtatiladi; Meta'da to'xtatilgani kuzatuvdan chiqadi", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 10, lifetime: null, endsAt: null });
  graphFake.status['900000001'] = 'ACTIVE';
  graphFake.today = '25';
  await watch(biz);
  graphFake.today = '0';
  assert.equal(graphFake.status['900000001'], 'PAUSED');
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /limitga yetildi[\s\S]*Implant/);
  const b2 = newBiz();
  mcpStore.track(b2.id, { campaignId: '555000111', name: 'Boost', daily: 5, lifetime: null, endsAt: null });
  graphFake.status['555000111'] = 'PAUSED';
  await watch(b2);
  assert.match(String(mcpStore.tracked(b2.id, '555000111')?.stopReason), /Meta'da: PAUSED/);
});

await check("kuzatuv: bitta kampaniya sarfi limitga yetsa to'xtatiladi; byudjet Meta'dan qayta o'qiladi; muddat yaqinda o'tgan — hali kuzatuvda", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 1, lifetime: null, endsAt: new Date(Date.now() - 3600_000).toISOString() });
  graphFake.status['900000001'] = 'ACTIVE';
  await watch(biz);
  const t = mcpStore.tracked(biz.id, '900000001');
  assert.equal(t?.status, 'active', "Meta'da hali ishlayapti — kuzatuvdan chiqmaydi");
  assert.equal(t?.daily, 10, "byudjet Meta'dan qayta o'qildi");
  graphFake.campaignSpend = '450';
  await watch(biz);
  graphFake.campaignSpend = null;
  assert.equal(graphFake.status['900000001'], 'PAUSED');
  assert.match(String(mcpStore.tracked(biz.id, '900000001')?.stopReason), /bir kampaniya/);
});

await check("obuna dvigateli: Meta server sarlavhasi bilan, faqat shu ikki server ruxsatda; PreToolUse — rad sababi, xatoda ham rad", async () => {
  const guardSaid = new Map<string, string | null>([['mcp__meta_ads__ads_get_ad_entities', null], ['mcp__meta_ads__ads_activate_entity', 'karta yuborildi']]);
  const o = optionsFor({
    system: 's', model: 'm', maxTurns: 1, persist: false,
    external: [{ name: 'meta_ads', url: 'https://mcp.facebook.com/ads', headers: { Authorization: 'Bearer t' }, guard: async t => { if (!guardSaid.has(t)) throw new Error('kutilmagan'); return guardSaid.get(t)!; } }],
  }, new AbortController());
  assert.deepEqual(o.mcpServers?.meta_ads, { type: 'http', url: 'https://mcp.facebook.com/ads', headers: { Authorization: 'Bearer t' } });
  assert.deepEqual(o.allowedTools, ['mcp__meta_ads']);
  assert.equal(o.strictMcpConfig, true);
  const m = o.hooks?.PreToolUse?.[0];
  assert.equal(m?.matcher, 'mcp__meta_ads__.*');
  const run = (tool: string) => m!.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, tool_use_id: 'x', session_id: 's', transcript_path: '', cwd: '' } as never, 'x', { signal: new AbortController().signal });
  assert.deepEqual(await run('mcp__meta_ads__ads_get_ad_entities'), { continue: true });
  assert.deepEqual(await run('mcp__meta_ads__ads_activate_entity'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'karta yuborildi' } });
  const broken = await run('mcp__meta_ads__ads_whatever') as { hookSpecificOutput: { permissionDecision: string } };
  assert.equal(broken.hookSpecificOutput.permissionDecision, 'deny', 'tekshiruv yiqilsa — bajarilmaydi');
});

mcpServer.close();
graph.close();
console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
