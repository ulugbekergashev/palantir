/**
 * Targetolog Pipeboard orqali (o'z Meta ilovasi bo'lmaganda) — soxta Pipeboard MCP bilan (haqiqiy pul va tarmoqsiz):
 * asbob qoidalari, token bilan ulash (bitta kabinet — o'zi, bir nechta — tanlash), model chaqiruvi → karta → tugma → limitlar →
 * Pipeboard'da bajarish, kuzatuvda limitga yetsa to'xtatish (to'xtamasa — egasiga «darhol»), token xato matniga chiqmasligi,
 * Graph'ga hech qanday so'rov ketmasligi.
 * Ishga tushirish: npm run test:ads-pipeboard
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const TOKEN = 'pb_test_token_0123456789abcdef';
const body = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });

// ─── Soxta Pipeboard MCP ──────────────────────────────────────────────────────
const calls: { name: string; args: Record<string, unknown> }[] = [];
let failNextUpdate = false;
const fake = {
  accounts: [{ id: 'act_1234567', account_id: '1234567', name: 'Klinika kabineti', currency: 'USD', account_status: 1 }] as Record<string, unknown>[],
  pages: [{ id: '7770001', name: 'Klinika sahifasi' }] as Record<string, unknown>[],
  today: '0', month: '0', campaignSpend: '1', insightsBroken: false, pauseSticks: true,
  status: {} as Record<string, string>,
};
/** 900000001 — kuniga 10$; 900000003 — kuniga 50$ (kunlik limitdan ko'p); 900000004 — byudjet guruhlarda (3$ + 2$) */
const CAMPS: Record<string, { name: string; daily_budget?: string }> = {
  '900000001': { name: 'Implant', daily_budget: '1000' },
  '900000003': { name: 'Katta', daily_budget: '5000' },
  '900000004': { name: 'Guruhli' },
};
const json = (o: unknown) => JSON.stringify(o, null, 2);
function fakeMcp(): McpServer {
  const s = new McpServer({ name: 'soxta-pipeboard', version: '1' });
  const reg = (name: string, shape: z.ZodRawShape, reply: (a: Record<string, unknown>) => unknown) =>
    s.registerTool(name, { inputSchema: shape }, async args => {
      calls.push({ name, args: args as Record<string, unknown> });
      return { content: [{ type: 'text' as const, text: json(reply(args as Record<string, unknown>)) }] };
    });
  const id = z.string();
  reg('get_ad_accounts', { limit: z.number().optional() }, () => ({ data: fake.accounts }));
  reg('get_account_pages', { account_id: z.string() }, () => ({ data: fake.pages }));
  reg('get_account_info', { account_id: z.string(), fields: z.string().optional() }, a => {
    const acc = fake.accounts.find(x => x.id === a.account_id);
    return acc ? { ...acc, timezone_name: 'Asia/Tashkent' } : { error: { message: 'Unsupported get request', code: 100 } };
  });
  reg('get_campaign_details', { campaign_id: id }, a => {
    const c = CAMPS[String(a.campaign_id)];
    return c ? { id: a.campaign_id, ...c, objective: 'OUTCOME_ENGAGEMENT', status: fake.status[String(a.campaign_id)] ?? 'ACTIVE' } : { error: { message: 'nonexisting field (objective)', code: 100 } };
  });
  reg('get_adset_details', { adset_id: id }, a => (a.adset_id === '900000002' ? { id: '900000002', campaign_id: '900000001', status: 'ACTIVE' } : { error: 'not an ad set' }));
  reg('get_ad_details', { ad_id: id }, () => ({ error: 'not an ad' }));
  reg('get_adsets', { account_id: z.string(), campaign_id: z.string().optional(), limit: z.number().optional() }, a =>
    (a.campaign_id === '900000004' ? { data: [{ daily_budget: '300', status: 'ACTIVE' }, { daily_budget: '200', status: 'ACTIVE' }, { daily_budget: '900', status: 'DELETED' }] } : { data: [] }));
  reg('get_insights', { object_id: z.string(), time_range: z.string().optional(), level: z.string().optional() }, a => {
    if (fake.insightsBroken) return { message: 'Upgrade your plan' };
    if (String(a.object_id).startsWith('act_')) return { data: [{ spend: a.time_range === 'today' ? fake.today : fake.month }] };
    return { data: [{ spend: fake.campaignSpend }] };
  });
  reg('get_campaigns', { account_id: z.string(), limit: z.number().optional() }, () => ({ data: [] }));
  reg('update_campaign', { campaign_id: id, status: z.string().optional(), daily_budget: z.number().optional() }, a => {
    const cid = String(a.campaign_id);
    if (failNextUpdate) { failNextUpdate = false; return { error: { message: 'Read timed out' } }; }
    if (!CAMPS[cid]) return { error: { message: 'Campaign not found' } };
    if (a.status && (a.status !== 'PAUSED' || fake.pauseSticks)) fake.status[cid] = String(a.status);
    return { success: true, id: cid };
  });
  reg('create_campaign', { account_id: z.string(), name: z.string(), objective: z.string(), status: z.string().optional() }, () => ({ id: '900000009' }));
  return s;
}
const pbServer = createServer(async (req, res) => {
  if (new URL(req.url!, 'http://x').searchParams.get('token') !== TOKEN) { res.writeHead(401).end('{"error":"invalid token"}'); return; }
  const raw = await body(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const s = fakeMcp();
  res.on('close', () => { void transport.close(); void s.close(); });
  await s.connect(transport);
  await transport.handleRequest(req, res, raw ? JSON.parse(raw) as unknown : undefined);
});
// Graph — Pipeboard ulanishida bu yerga hech narsa kelmasligi kerak
const graphHits: string[] = [];
const graph = createServer((req, res) => { graphHits.push(`${req.method} ${req.url}`); res.writeHead(500).end('{"error":{"message":"graph emas"}}'); });

const port = async (s: ReturnType<typeof createServer>) => { await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r())); return (s.address() as { port: number }).port; };
process.env.PIPEBOARD_MCP_URL = `http://127.0.0.1:${await port(pbServer)}/`;
process.env.META_GRAPH_BASE = `http://127.0.0.1:${await port(graph)}`;

const { classify, PB_CREATE_PAUSED, BLOCKED } = await import('../server/ads/mcpRules');
const { metaGuard, approveAction, metaAdsServer, META_SERVER } = await import('../server/ads/mcp');
const { connectPipeboard, connectPicked, hubPending } = await import('../server/ads/hubConnect');
const { endpointOf, mcpCall, McpCallError } = await import('../server/ads/mcpClient');
const { adsStore, mcpStore, TargetError } = await import('../server/ads/store');
const { watch, spendNow, propose } = await import('../server/ads/campaigns');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { businesses } = await import('../server/db');

const sent: { html: string; keyboard?: unknown }[] = [];
setOwnerOutlet({
  notify: async (_b, html, keyboard) => { sent.push({ html, keyboard }); return sent.length; },
  edit: async () => {}, sendFile: async () => {}, sendPhoto: async () => null,
});

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 5).join('\n    ')}`); }
}
const rejects = async (p: Promise<unknown>, re: RegExp) => {
  try { await p; } catch (e) { assert.ok(e instanceof TargetError, `TargetError kutilgan edi: ${(e as Error).message}`); assert.match(e.message, re); return; }
  assert.fail('xato kutilgan edi');
};
const PROFILE = { name: 'Sinov', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never;
const emptyBiz = () => businesses.byId(businesses.create(`pb${Date.now()}${Math.random()}`, 'x', PROFILE).id)!;
/** Pipeboard orqali ulangan biznes, limitlar: kampaniya 400, kuniga 20, oyiga 300 */
const newBiz = () => {
  const b = emptyBiz();
  adsStore.saveConnection(b.id, { token: TOKEN, adAccountId: '1234567', accountName: 'Kabinet', currency: 'USD', pageId: '7770001', pageName: 'Sahifa', igActorId: null, timezone: 'Asia/Tashkent', via: 'pipeboard' });
  adsStore.saveLimits(b.id, { perCampaign: 400, daily: 20, monthly: 300 });
  return b;
};
const ctxOf = (biz: ReturnType<typeof newBiz>, over: Record<string, unknown> = {}) => ({ biz, artifacts: [], ...over }) as never as Parameters<typeof metaGuard>[0];
const cardId = () => {
  const kb = sent.at(-1)?.keyboard as { inline_keyboard: { callback_data: string }[][] };
  return kb.inline_keyboard[0][0].callback_data.split('|')[1];
};
const named = (n: string) => calls.filter(c => c.name === n);

console.log('Targetolog — Pipeboard');

await check("asboblar: o'qish — ruxsat, yaratish — pauzada, to'xtatish — o'zi, yoqish/byudjet — karta, qolgani — yopiq", () => {
  const pb = (t: string, i: unknown = {}) => classify(t, i, 'pipeboard');
  for (const t of ['get_campaigns', 'get_insights', 'search_interests', 'estimate_audience_size', 'validate_interests', 'bulk_get_insights']) assert.deepEqual(pb(t), { kind: 'allow', strangers: false }, t);
  assert.deepEqual(pb('search_ads_archive', { q: 'implant' }), { kind: 'allow', strangers: true }, 'Ad Library — begona matn');
  assert.equal(pb('create_campaign', { account_id: 'act_1', name: 'x', objective: 'OUTCOME_LEADS', daily_budget: 1000 }).kind, 'allow');
  assert.equal(pb('create_adset', { campaign_id: '1', status: 'PAUSED', daily_budget: '500' }).kind, 'allow');
  assert.deepEqual(pb('create_campaign', { name: 'x', status: 'ACTIVE' }), { kind: 'deny', why: PB_CREATE_PAUSED });
  assert.deepEqual(pb('create_ad', { adset_id: '1', creative_id: '2', status: 'ACTIVE' }), { kind: 'deny', why: PB_CREATE_PAUSED });
  assert.equal(pb('update_campaign', { campaign_id: '900000001', status: 'PAUSED' }).kind, 'allow', "to'xtatish — o'zi");
  assert.equal(pb('update_ad', { ad_id: '1', name: 'Yangi' }).kind, 'allow');
  assert.deepEqual(pb('update_campaign', { campaign_id: '900000001', status: 'ACTIVE' }), { kind: 'money', action: 'activate' });
  assert.deepEqual(pb('update_adset', { adset_id: '1', status: 'active' }), { kind: 'money', action: 'activate' });
  for (const input of [{ campaign_id: '1', daily_budget: 5000 }, { campaign_id: '1', status: 'ACTIVE', daily_budget: 5000 }, { adset_id: '1', bid_amount: 30 }, { campaign_id: '1' }, { campaign_id: '1', status: 'DELETED' }])
    assert.deepEqual(pb('update_campaign', input), { kind: 'money', action: 'update' }, JSON.stringify(input));
  assert.deepEqual(pb('create_budget_schedule', { campaign_id: '1', budget_value: 2 }), { kind: 'money', action: 'update' });
  // Auditoriya va kreativ almashishi — barglari id/name bo'lsa ham egasiga
  assert.deepEqual(pb('update_adset', { adset_id: '1', name: 'x', targeting: { flexible_spec: [{ interests: [{ id: '6003', name: 'a' }] }] } }), { kind: 'money', action: 'update' });
  assert.deepEqual(pb('update_ad', { ad_id: '1', name: 'x', creative_id: '2' }), { kind: 'money', action: 'update' });
  assert.deepEqual(pb('update_campaign', { campaign_id: '1', status: 'ACTIVE', adset_ids: ['2'] }), { kind: 'money', action: 'update' });
  for (const t of ['duplicate_campaign', 'generate_report', 'save_ad_image_locally', 'delete_campaign', 'ads_activate_entity', 'new_tool_2027'])
    assert.deepEqual(pb(t), { kind: 'deny', why: BLOCKED }, t);
  // Meta nomlari Pipeboard'da ishlamaydi va aksincha
  assert.deepEqual(classify('update_campaign', { campaign_id: '1', status: 'PAUSED' }), { kind: 'deny', why: BLOCKED });
});

await check("ulash: noto'g'ri shakl va ishlamaydigan token — tushunarli xato; bitta kabinet va sahifa — o'zi ulanadi", async () => {
  const biz = emptyBiz();
  await rejects(connectPipeboard(biz, 'abc'), /o'xshamaydi/);
  await rejects(connectPipeboard(biz, 'pb_wrong_token_0123456789'), /ishlamadi/);
  assert.equal(adsStore.connection(biz.id), null);
  const r = await connectPipeboard(biz, `  ${TOKEN} `);
  assert.deepEqual(r, { connected: true });
  const c = adsStore.connection(biz.id)!;
  assert.equal(c.via, 'pipeboard');
  assert.equal(c.token, TOKEN);
  assert.equal(c.adAccountId, '1234567');
  assert.equal(c.accountName, 'Klinika kabineti');
  assert.equal(c.pageName, 'Klinika sahifasi');
  assert.equal(c.currency, 'USD');
  assert.equal(c.expiresAt, null);
});

await check('ulash: bir nechta kabinet — panelda tanlash (Pipeboard yo\'li bilan), ro\'yxatda yo\'g\'i — yo\'q; faol emas — ulanmaydi', async () => {
  const keep = fake.accounts;
  fake.accounts = [...keep, { id: 'act_7654321', account_id: '7654321', name: 'Ikkinchi', currency: 'USD', account_status: 1 }, { id: 'act_5555555', account_id: '5555555', name: 'Yopiq', currency: 'USD', account_status: 2 }];
  try {
    const biz = emptyBiz();
    assert.deepEqual(await connectPipeboard(biz, TOKEN), { connected: false });
    const p = hubPending(biz.id)!;
    assert.equal(p.via, 'pipeboard');
    assert.equal(p.accounts.length, 3);
    assert.equal(JSON.stringify(p).includes(TOKEN), false, 'token panelga chiqmaydi');
    await rejects(connectPicked(biz, { adAccountId: '9999999', pageId: '7770001' }), /ro.yxatdan tanlang/);
    await rejects(connectPicked(biz, { adAccountId: '5555555', pageId: '7770001' }), /faol emas/);
    await connectPicked(biz, { adAccountId: 'act_7654321', pageId: '7770001' });
    const c = adsStore.connection(biz.id)!;
    assert.equal(c.via, 'pipeboard');
    assert.equal(c.accountName, 'Ikkinchi');
    assert.equal(hubPending(biz.id), null);
  } finally {
    fake.accounts = keep;
  }
});

await check("model uchun server: Pipeboard manzili token bilan, sarlavhasiz; ko'rsatmada Pipeboard asboblari", async () => {
  const ext = (await metaAdsServer(ctxOf(newBiz())))!;
  assert.ok(ext, 'server berildi');
  assert.equal(ext.name, META_SERVER);
  assert.equal(ext.via, 'pipeboard');
  assert.equal(new URL(ext.url).searchParams.get('token'), TOKEN);
  assert.deepEqual(ext.headers, {});
  assert.match(ext.note, /Pipeboard[\s\S]*act_1234567[\s\S]*update_campaign/);
  assert.doesNotMatch(ext.note, /ads_activate_entity/);
});

await check("model chaqiruvi: o'qish va to'xtatish o'tadi; yaratishda ACTIVE — rad; yoqish — bajarilmaydi, egasiga karta (byudjet Pipeboard'dan)", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'pipeboard');
  const p = `mcp__${META_SERVER}__`;
  assert.equal(await guard(`${p}get_campaigns`, { account_id: 'act_1234567' }), null);
  assert.equal(await guard(`${p}update_campaign`, { campaign_id: '900000001', status: 'PAUSED' }), null);
  assert.equal(await guard(`${p}create_campaign`, { account_id: 'act_1234567', name: 'x', objective: 'OUTCOME_LEADS', status: 'ACTIVE' }), PB_CREATE_PAUSED);
  assert.equal(await guard(`${p}duplicate_campaign`, { campaign_id: '900000001' }), BLOCKED);
  const before = sent.length, updates = named('update_campaign').length;
  assert.match(String(await guard(`${p}update_campaign`, { campaign_id: '900000001', status: 'ACTIVE' })), /Not run by you.*Tasdiqlash/);
  assert.equal(sent.length, before + 1);
  assert.match(sent.at(-1)!.html, /Reklamani yoqish[\s\S]*«Implant» — kuniga 10 USD, muddatsiz[\s\S]*status: ACTIVE/);
  assert.equal(named('update_campaign').length, updates, "Pipeboard'ga yozuv ketmadi");
  assert.match(String(await guard(`${p}update_campaign`, { campaign_id: '900000004', daily_budget: 9000 })), /Not run by you/);
  assert.match(sent.at(-1)!.html, /Byudjet, stavka[\s\S]*«Guruhli» — kuniga 5 USD/);
});

await check("tugma: limit ichida — Pipeboard'da bajariladi, kampaniya kuzatuvga; limitdan oshsa — so'rov ketmaydi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'pipeboard');
  fake.today = '0'; fake.month = '0';
  await guard(`mcp__${META_SERVER}__update_campaign`, { campaign_id: '900000001', status: 'ACTIVE' });
  const id = cardId();
  const n = named('update_campaign').length;
  await approveAction(biz, id);
  assert.equal(named('update_campaign').length, n + 1);
  assert.deepEqual(named('update_campaign').at(-1)!.args, { campaign_id: '900000001', status: 'ACTIVE' });
  assert.equal(mcpStore.get(biz.id, id)?.status, 'done');
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active');
  assert.match(sent.at(-1)!.html, /bajarildi[\s\S]*Implant/);
  await rejects(approveAction(biz, id), /Allaqachon/);

  await guard(`mcp__${META_SERVER}__update_campaign`, { campaign_id: '900000003', status: 'ACTIVE' });
  const big = cardId(), m = named('update_campaign').length;
  await rejects(approveAction(biz, big), /kunlik limitdan/);
  assert.equal(named('update_campaign').length, m, "limitdan oshgani Pipeboard'ga yuborilmadi");
  assert.equal(mcpStore.get(biz.id, big)?.status, 'failed');
});

await check("Pipeboard xatosi (tarmoq uzilishi ham shunday keladi): kampaniya Meta'da to'xtagani o'qilmaguncha kuzatuvda qoladi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'pipeboard');
  fake.today = '0'; fake.month = '0';
  await guard(`mcp__${META_SERVER}__update_campaign`, { campaign_id: '900000004', status: 'ACTIVE' });
  // Pipeboard «xato» qaytaradi, lekin Meta yoqib bo'lgan
  fake.status['900000004'] = 'ACTIVE';
  failNextUpdate = true;
  await assert.rejects(approveAction(biz, cardId()), /Read timed out/);
  assert.equal(mcpStore.tracked(biz.id, '900000004')?.status, 'active', 'kuzatuvdan chiqmadi');
  // Haqiqatan yoqilmagan (Meta'da pauzada) — chiqariladi
  fake.status['900000001'] = 'PAUSED';
  await guard(`mcp__${META_SERVER}__update_campaign`, { campaign_id: '900000001', status: 'ACTIVE' });
  failNextUpdate = true;
  await assert.rejects(approveAction(biz, cardId()));
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'finished');
});

await check("kuzatuv: kunlik limitga yetsa Pipeboard orqali to'xtatiladi va qayta o'qib tekshiriladi", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 10, lifetime: null, endsAt: null });
  fake.status['900000001'] = 'ACTIVE';
  fake.today = '25'; fake.month = '25'; fake.campaignSpend = '5';
  await watch(biz);
  assert.equal(fake.status['900000001'], 'PAUSED');
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /limitga yetildi[\s\S]*To'xtatildi: Implant/);
});

await check("kuzatuv: Pipeboard to'xtatishni bajarmasa — kuzatuvda qoladi, egasiga «darhol Ads Manager'da»", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 10, lifetime: null, endsAt: null });
  fake.status['900000001'] = 'ACTIVE';
  fake.pauseSticks = false;
  try {
    fake.today = '25'; fake.month = '25';
    await watch(biz);
    assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active', "to'xtamagani kuzatuvdan chiqmaydi");
    assert.match(sent.at(-1)!.html, /to'xtatib bo'lmadi: Implant[\s\S]*Ads Manager/);
  } finally {
    fake.pauseSticks = true;
    fake.today = '0'; fake.month = '0';
  }
});

await check("bitta kampaniya limiti: sarf Pipeboard'dan, limitga yetsa to'xtatiladi; guruhli kampaniya byudjeti guruhlardan", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000004', name: 'Guruhli', daily: null, lifetime: null, endsAt: null });
  fake.status['900000004'] = 'ACTIVE';
  fake.campaignSpend = '401';
  await watch(biz);
  assert.equal(mcpStore.tracked(biz.id, '900000004')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /bir kampaniya limiti/);
  fake.campaignSpend = '1';
  fake.status['900000004'] = 'ACTIVE';
  const s = await spendNow(biz, adsStore.connection(biz.id)!);
  assert.equal(s.today, 0);
});

await check("sarf o'qilmasa — «noma'lum» (0 deb olinmaydi), hech narsa yoqilmaydi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'pipeboard');
  await guard(`mcp__${META_SERVER}__update_campaign`, { campaign_id: '900000001', status: 'ACTIVE' });
  const id = cardId(), n = named('update_campaign').length;
  fake.insightsBroken = true;
  try {
    await assert.rejects(spendNow(biz, adsStore.connection(biz.id)!), /sarf/);
    await assert.rejects(approveAction(biz, id));
    assert.equal(named('update_campaign').length, n, 'yoqish yuborilmadi');
  } finally {
    fake.insightsBroken = false;
  }
});

await check("tayyor reja yo'li Pipeboard'da — tushunarli rad (Facebook tokeni kerak)", async () => {
  await rejects(propose(newBiz(), 'implant reklama', {} as never), /Pipeboard/);
});

await check('token xato matniga chiqmaydi (server ishlamasa ham)', async () => {
  const ep = endpointOf({ token: TOKEN, via: 'pipeboard' });
  const down = { ...ep, url: ep.url.replace(/:\d+\//, ':1/') };
  try {
    await mcpCall(down, 'get_campaigns', {});
    assert.fail('xato kutilgan edi');
  } catch (e) {
    assert.ok(e instanceof McpCallError);
    assert.equal(e.message.includes(TOKEN), false, e.message);
    assert.match(e.message, /Pipeboard bilan aloqa/);
  }
});

await check("Graph'ga (Facebook tokeni yo'li) hech qanday so'rov ketmadi", () => {
  assert.deepEqual(graphHits, []);
});

pbServer.close();
graph.close();
console.log(failed ? `\n${failed} ta yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
