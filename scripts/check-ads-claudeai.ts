/**
 * Targetolog egasining claude.ai'dagi Meta Ads ulagichi orqali (o'z Meta ilovasi ham, token ham yo'q) — soxta ijrochi bilan (haqiqiy
 * pul, obuna va tarmoqsiz). Soxta Meta javoblari haqiqiy kabinetda o'qilgan shakllarda (2026-11-22): {"ad_entities": "<JSON>"},
 * summa {value, unit}, ads_update_entity {entity_id, entity_type, fields: "<JSON>"}.
 * Tekshiriladi: pul qoidalari Meta'ning xizmat maydonlari bilan, ulash (ulagich yo'q / qayta kirish kerak / bitta kabinet — o'zi /
 * bir nechta — tanlash), model uchun server (boshqa ulagichlar va yopiq asboblar yashirin), karta → tugma → limitlar → bajarish,
 * kuzatuv (30 daqiqada bir, limitda to'xtatish, to'xtamasa — «darhol»), sarf o'qilmasa — hech narsa yoqilmaydi, Graph'ga so'rov yo'q.
 * Ishga tushirish: npm run test:ads-claudeai
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { CaiCall, CaiResult, Connector } from '../server/ads/claudeai';

// Graph — bu ulanishda bu yerga hech narsa kelmasligi kerak
const graphHits: string[] = [];
const graph = createServer((req, res) => { graphHits.push(`${req.method} ${req.url}`); res.writeHead(500).end('{"error":{"message":"graph emas"}}'); });
await new Promise<void>(r => graph.listen(0, '127.0.0.1', () => r()));
process.env.META_GRAPH_BASE = `http://127.0.0.1:${(graph.address() as { port: number }).port}`;

const { classify, entityIds, CREATE_PAUSED, BLOCKED } = await import('../server/ads/mcpRules');
const { metaGuard, approveAction, metaAdsServer } = await import('../server/ads/mcp');
const { connectClaudeAi, connectPicked, hubPending } = await import('../server/ads/hubConnect');
const { setCaiForTests, sameJson, responseText, caiCall } = await import('../server/ads/claudeai');
const { adsStore, mcpStore, TargetError } = await import('../server/ads/store');
const { watch, spendNow, propose, CLAUDEAI_WATCH_MS } = await import('../server/ads/campaigns');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { businesses } = await import('../server/db');

// ─── Soxta Meta (claude.ai ulagichi orqali) ────────────────────────────────────
const CONNECTOR = 'claude.ai Meta Ads';
const SERVER = 'claude_ai_Meta_Ads';
const META_TOOLS = ['ads_get_ad_accounts', 'ads_get_user_pages', 'ads_get_ad_account_pages', 'ads_get_ad_entities', 'ads_update_entity', 'ads_activate_entity', 'ads_boost_ig_post', 'ads_create_campaign', 'ads_catalog_create', 'ads_pixel_event_delete', 'ads_permission_set_asset_permissions'];
const fake = {
  state: 'connected' as Connector['state'],
  accounts: [{ ad_account_id: '1234567', ad_account_name: 'Klinika kabineti', account_status: 'ACTIVE', is_queryable: true, is_ads_mcp_enabled: true, currency: 'USD' }] as Record<string, unknown>[],
  pages: [{ page_id: '7770001', page_name: 'Klinika sahifasi' }],
  today: '0', month: '0', campaignSpend: '1', spendBroken: false, pauseSticks: true, refuseNext: false,
  status: {} as Record<string, string>,
};
/** 900000001 — kuniga 10$; 900000003 — kuniga 50$ (kunlik limitdan ko'p); 900000004 — byudjet guruhlarda (3$ + 2$) */
const CAMPS: Record<string, { name: string; daily?: string }> = {
  '900000001': { name: 'Implant', daily: '10' },
  '900000003': { name: 'Katta', daily: '50' },
  '900000004': { name: 'Guruhli' },
};
const SETS = [
  { id: '910000001', campaign_id: '900000004', daily: '3', status: 'ACTIVE' },
  { id: '910000002', campaign_id: '900000004', daily: '2', status: 'ACTIVE' },
  { id: '910000003', campaign_id: '900000004', daily: '9', status: 'DELETED' },
];
const usd = (v: string) => ({ value: v, unit: 'USD' });
const entities = (rows: unknown[]) => JSON.stringify({ ad_entities: JSON.stringify(rows), client_conversation_id: 'x' });
const runs: { calls: CaiCall[]; hide: readonly string[] }[] = [];
const named = (n: string) => runs.flatMap(r => r.calls).filter(c => c.tool === n);

function answer(c: CaiCall): CaiResult {
  const a = c.args;
  const ok = (o: unknown): CaiResult => ({ text: typeof o === 'string' ? o : JSON.stringify(o), error: false });
  switch (c.tool) {
    case 'ads_get_ad_accounts': return ok({ ad_accounts: fake.accounts });
    case 'ads_get_user_pages': case 'ads_get_ad_account_pages': return ok({ pages: fake.pages });
    case 'ads_get_ad_entities': {
      const ids = (a.object_ids as string[] | undefined) ?? [];
      if (a.level === 'ad_account') return fake.spendBroken ? ok({ ad_entities: '[]' }) : ok(entities([{ id: '1234567', amount_spent: usd(a.date_preset === 'today' ? fake.today : fake.month) }]));
      if (a.level === 'campaign') {
        return ok(entities(Object.entries(CAMPS).filter(([id]) => !ids.length || ids.includes(id)).map(([id, x]) => ({
          id, name: x.name, objective: 'OUTCOME_LEADS', effective_status: fake.status[id] ?? 'ACTIVE', amount_spent: usd(fake.campaignSpend),
          ...(x.daily ? { daily_budget: usd(x.daily) } : {}),
        }))));
      }
      if (a.level === 'adset') {
        const filter = (a.filtering as { value: string[] }[] | undefined)?.[0]?.value ?? [];
        return ok(entities(SETS.filter(s => (!ids.length || ids.includes(s.id)) && (!filter.length || filter.includes(s.campaign_id)))
          .map(s => ({ id: s.id, campaign_id: s.campaign_id, daily_budget: usd(s.daily), lifetime_budget: usd('0'), effective_status: s.status }))));
      }
      return ok(entities([]));
    }
    case 'ads_update_entity': case 'ads_activate_entity': {
      if (fake.refuseNext) { fake.refuseNext = false; return { text: 'Request timed out', error: true }; }
      const id = String(a.entity_id);
      if (!CAMPS[id]) return { text: 'Entity not found', error: true };
      const fields = c.tool === 'ads_activate_entity' ? { status: 'ACTIVE' } : JSON.parse(String(a.fields ?? '{}')) as { status?: string };
      if (fields.status && (fields.status !== 'PAUSED' || fake.pauseSticks)) fake.status[id] = fields.status;
      return ok({ success: true, id });
    }
    default: return { text: `unknown tool ${c.tool}`, error: true };
  }
}
setCaiForTests(
  async (server, calls, hide) => {
    assert.equal(server, CONNECTOR);
    runs.push({ calls: [...calls], hide });
    return calls.map(answer);
  },
  async () => ({ name: fake.state === 'missing' ? '' : CONNECTOR, state: fake.state, others: ['claude.ai Gmail', 'claude.ai Google Drive'], tools: META_TOOLS }),
);

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
const emptyBiz = () => businesses.byId(businesses.create(`cai${Date.now()}${Math.random()}`, 'x', PROFILE).id)!;
/** claude.ai ulagichi orqali ulangan biznes, limitlar: kampaniya 400, kuniga 20, oyiga 300 */
const newBiz = () => {
  const b = emptyBiz();
  adsStore.saveConnection(b.id, { token: '', adAccountId: '1234567', accountName: 'Kabinet', currency: 'USD', pageId: '7770001', pageName: 'Sahifa', igActorId: null, timezone: '', via: 'claudeai' });
  adsStore.saveLimits(b.id, { perCampaign: 400, daily: 20, monthly: 300 });
  return b;
};
const ctxOf = (biz: ReturnType<typeof newBiz>, over: Record<string, unknown> = {}) => ({ biz, artifacts: [], ...over }) as never as Parameters<typeof metaGuard>[0];
const cardId = () => {
  const kb = sent.at(-1)?.keyboard as { inline_keyboard: { callback_data: string }[][] };
  return kb.inline_keyboard[0][0].callback_data.split('|')[1];
};
const P = `mcp__${SERVER}__`;
/** Haqiqiy shakldagi chaqiruvlar (model shunday yuboradi) */
const meta = { advertiser_job: 'update_existing_campaigns', advertiser_request: 'pause the waste', client_conversation_id: 'Xk3mQ9vTa7LpR2wZ5nBd' };
const pauseIn = (id: string) => ({ ad_account_id: '1234567', entity_id: id, entity_type: 'campaign', fields: '{"status":"PAUSED"}', ...meta });
const activateIn = (id: string) => ({ ad_account_id: '1234567', entity_id: id, entity_type: 'campaign', ...meta });

console.log('Targetolog — claude.ai ulagichi');

await check("qoidalar haqiqiy shakllar bilan: xizmat maydonlari to'xtatishni kartaga yubormaydi; byudjet, yoqish — karta; yopiqlari — yopiq", () => {
  const m = (t: string, i: unknown = {}) => classify(t, i, 'claudeai');
  assert.deepEqual(m('ads_update_entity', pauseIn('900000001')), { kind: 'allow', strangers: false }, "to'xtatish — o'zi");
  assert.deepEqual(m('ads_update_entity', { ...pauseIn('900000001'), fields: '{"name":"Yangi nom"}' }), { kind: 'allow', strangers: false });
  assert.deepEqual(m('ads_update_entity', { ...pauseIn('910000001'), entity_type: 'ad_set', fields: '{"daily_budget":500}' }), { kind: 'money', action: 'update' });
  assert.deepEqual(m('ads_update_entity', { ...pauseIn('900000001'), fields: '{"status":"ACTIVE"}' }), { kind: 'money', action: 'update' });
  assert.deepEqual(m('ads_activate_entity', activateIn('900000001')), { kind: 'money', action: 'activate' });
  assert.deepEqual(m('ads_get_ad_entities', { ad_account_id: '1234567', level: 'campaign', fields: ['id'], ...meta }), { kind: 'allow', strangers: false });
  assert.deepEqual(m('ads_create_campaign', { ad_account_id: '1234567', name: 'x', objective: 'OUTCOME_LEADS', ...meta }), { kind: 'allow', strangers: false });
  assert.deepEqual(m('ads_create_campaign', { ad_account_id: '1234567', name: 'x', status: 'ACTIVE', ...meta }), { kind: 'deny', why: CREATE_PAUSED });
  assert.equal(m('ads_creative_upload_media', { ad_account_id: '1234567', ...meta }).kind, 'allow');
  for (const t of ['ads_catalog_create', 'ads_pixel_event_delete', 'ads_permission_set_asset_permissions', 'ads_duplicate_entity', 'offer_report'])
    assert.deepEqual(m(t), { kind: 'deny', why: BLOCKED }, t);
  // Kabinet raqami obyekt emas: kartada va kuzatuvda faqat kampaniya
  assert.deepEqual(entityIds(activateIn('900000001')), ['900000001']);
});

await check('ijrochi yordamchilari: JSON tengligi (kalit tartibi muhim emas) va asbob javobi matni', () => {
  assert.ok(sameJson({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 }));
  assert.ok(!sameJson({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameJson({ a: '1' }, { a: 1 }));
  assert.ok(!sameJson([1, 2], [2, 1]));
  assert.equal(responseText('{"x":1}'), '{"x":1}');
  assert.equal(responseText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(responseText({ content: [{ type: 'text', text: 'c' }] }), 'c');
});

await check("ijrochi: boshqa ulagichlar va Meta'ning keraksiz asboblari yashirin — faqat chaqirilayotgan asbob ko'rinadi", async () => {
  await caiCall([{ tool: 'ads_get_ad_accounts', args: {} }]);
  const hide = runs.at(-1)!.hide;
  assert.ok(hide.includes('mcp__claude_ai_Gmail') && hide.includes('mcp__claude_ai_Google_Drive'), 'boshqa ulagichlar');
  assert.ok(hide.includes(`${P}ads_catalog_create`) && hide.includes(`${P}ads_update_entity`));
  assert.ok(!hide.includes(`${P}ads_get_ad_accounts`), 'chaqirilayotgani ko\'rinadi');
});

await check("ulash: ulagich yo'q yoki qayta kirish kerak — tushunarli yo'l; bitta faol kabinet va sahifa — o'zi ulanadi (tokensiz)", async () => {
  const biz = emptyBiz();
  fake.state = 'missing';
  await rejects(connectClaudeAi(biz), /Add custom connector: https:\/\/mcp\.facebook\.com\/ads/);
  fake.state = 'needs-auth';
  await rejects(connectClaudeAi(biz), /qayta kirish/);
  fake.state = 'connected';
  assert.equal(adsStore.connection(biz.id), null);
  assert.deepEqual(await connectClaudeAi(biz), { connected: true });
  const c = adsStore.connection(biz.id)!;
  assert.equal(c.via, 'claudeai');
  assert.equal(c.token, '');
  assert.equal(c.adAccountId, '1234567');
  assert.equal(c.accountName, 'Klinika kabineti');
  assert.equal(c.pageName, 'Klinika sahifasi');
  assert.equal(c.currency, 'USD');
});

await check("ulash: bir nechta kabinet — panelda tanlash; faol emas yoki Meta MCP'ga yopiq — ulanmaydi", async () => {
  const keep = fake.accounts;
  fake.accounts = [...keep,
    { ad_account_id: '7654321', ad_account_name: 'Ikkinchi', account_status: 'ACTIVE', is_queryable: true, is_ads_mcp_enabled: true, currency: 'USD' },
    { ad_account_id: '5555555', ad_account_name: 'Yopiq', account_status: 'CLOSED', is_queryable: false, is_ads_mcp_enabled: true, currency: 'USD' }];
  try {
    const biz = emptyBiz();
    assert.deepEqual(await connectClaudeAi(biz), { connected: false });
    const p = hubPending(biz.id)!;
    assert.equal(p.via, 'claudeai');
    assert.deepEqual(p.accounts.map(a => a.active), [true, true, false]);
    await rejects(connectPicked(biz, { adAccountId: '5555555', pageId: '7770001' }), /faol emas/);
    await connectPicked(biz, { adAccountId: '7654321', pageId: '7770001' });
    assert.equal(adsStore.connection(biz.id)?.accountName, 'Ikkinchi');
    assert.equal(adsStore.connection(biz.id)?.via, 'claudeai');
  } finally {
    fake.accounts = keep;
  }
});

await check("model uchun: ulagich (url yo'q), boshqa ulagichlar va yopiq asboblar yashirin; ko'rsatmada server nomi va kabinet", async () => {
  const ext = (await metaAdsServer(ctxOf(newBiz())))!;
  assert.ok(ext, 'server berildi');
  assert.equal(ext.name, SERVER);
  assert.equal(ext.via, 'claudeai');
  assert.equal(ext.url, '');
  assert.ok(ext.claudeAi);
  const hide = ext.claudeAi.hide;
  assert.ok(hide.includes('mcp__claude_ai_Gmail'));
  assert.ok(hide.includes(`${P}ads_catalog_create`) && hide.includes(`${P}ads_permission_set_asset_permissions`), 'yopiqlari yashirin');
  for (const t of ['ads_get_ad_entities', 'ads_update_entity', 'ads_activate_entity', 'ads_create_campaign']) assert.ok(!hide.includes(`${P}${t}`), t);
  assert.match(ext.note, new RegExp(`mcp__${SERVER}__[\\s\\S]*1234567`));
  assert.match(ext.note, /ads_get_ad_images/);
  assert.doesNotMatch(ext.note, /ads_upload_media uploads/);
});

await check("model chaqiruvi: to'xtatish o'tadi (karta yo'q); yoqish va byudjet — bajarilmaydi, egasiga karta (byudjet Meta'dan)", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'claudeai', SERVER);
  const before = sent.length;
  assert.equal(await guard(`${P}ads_update_entity`, pauseIn('900000001')), null);
  assert.equal(await guard(`${P}ads_get_ad_entities`, { ad_account_id: '1234567', level: 'campaign', fields: ['id'], ...meta }), null);
  assert.equal(sent.length, before, "to'xtatish va o'qishda karta yo'q");
  const acts = named('ads_activate_entity').length;
  assert.match(String(await guard(`${P}ads_activate_entity`, activateIn('900000001'))), /Not run by you.*Tasdiqlash/);
  assert.match(sent.at(-1)!.html, /Reklamani yoqish[\s\S]*«Implant» — kuniga 10 USD, muddatsiz/);
  assert.equal(named('ads_activate_entity').length, acts, "Meta'ga yozuv ketmadi");
  assert.match(String(await guard(`${P}ads_update_entity`, { ...pauseIn('910000001'), entity_type: 'ad_set', fields: '{"daily_budget":900}' })), /Not run by you/);
  assert.match(sent.at(-1)!.html, /Byudjet, stavka[\s\S]*«Guruhli» — kuniga 5 USD/);
});

await check("tugma: limit ichida — ijrochi aynan model yuborgan chaqiruvni bajaradi, kampaniya kuzatuvga; limitdan oshsa — so'rov ketmaydi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'claudeai', SERVER);
  fake.today = '0'; fake.month = '0'; fake.status['900000001'] = 'PAUSED';
  await guard(`${P}ads_activate_entity`, activateIn('900000001'));
  const id = cardId(), n = named('ads_activate_entity').length;
  await approveAction(biz, id);
  assert.equal(named('ads_activate_entity').length, n + 1);
  assert.deepEqual(named('ads_activate_entity').at(-1)!.args, activateIn('900000001'));
  assert.equal(fake.status['900000001'], 'ACTIVE');
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active');
  assert.match(sent.at(-1)!.html, /bajarildi[\s\S]*Implant/);

  await guard(`${P}ads_activate_entity`, activateIn('900000003'));
  const big = cardId(), m = named('ads_activate_entity').length;
  await rejects(approveAction(biz, big), /kunlik limitdan/);
  assert.equal(named('ads_activate_entity').length, m, "limitdan oshgani Meta'ga yuborilmadi");
});

await check("Meta rad etsa (yoki javob aniq bo'lmasa): kampaniya Meta'da to'xtagani o'qilmaguncha kuzatuvda qoladi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'claudeai', SERVER);
  fake.today = '0'; fake.month = '0';
  await guard(`${P}ads_activate_entity`, activateIn('900000004'));
  fake.status['900000004'] = 'ACTIVE';
  fake.refuseNext = true;
  await assert.rejects(approveAction(biz, cardId()), /timed out/);
  assert.equal(mcpStore.tracked(biz.id, '900000004')?.status, 'active', 'kuzatuvdan chiqmadi');
  fake.status['900000001'] = 'PAUSED';
  await guard(`${P}ads_activate_entity`, activateIn('900000001'));
  fake.refuseNext = true;
  await assert.rejects(approveAction(biz, cardId()));
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'finished');
});

await check("kuzatuv: 30 daqiqada bir marta; kunlik limitga yetsa to'xtatiladi (fields: status PAUSED) va qayta o'qib tekshiriladi", async () => {
  const biz = newBiz(), t0 = new Date('2026-11-22T10:00:00Z');
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 10, lifetime: null, endsAt: null });
  fake.status['900000001'] = 'ACTIVE';
  fake.today = '25'; fake.month = '25'; fake.campaignSpend = '5';
  await watch(biz, t0);
  assert.equal(fake.status['900000001'], 'PAUSED');
  const pause = named('ads_update_entity').at(-1)!;
  assert.equal(pause.args.entity_id, '900000001');
  assert.equal(pause.args.fields, '{"status":"PAUSED"}');
  assert.equal(classify('ads_update_entity', pause.args, 'claudeai').kind, 'allow', "Palantir'ning o'z to'xtatishi ham qoidaga mos");
  assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /limitga yetildi[\s\S]*To'xtatildi: Implant/);
  // Yana kampaniya — 10 daqiqadan keyin tekshirilmaydi, 30 daqiqadan keyin — tekshiriladi
  mcpStore.track(biz.id, { campaignId: '900000004', name: 'Guruhli', daily: null, lifetime: null, endsAt: null });
  fake.status['900000004'] = 'ACTIVE';
  const runsBefore = runs.length;
  await watch(biz, new Date(t0.getTime() + 10 * 60_000));
  assert.equal(runs.length, runsBefore, "10 daqiqada so'rov yo'q");
  await watch(biz, new Date(t0.getTime() + CLAUDEAI_WATCH_MS));
  assert.ok(runs.length > runsBefore);
  assert.equal(fake.status['900000004'], 'PAUSED');
  fake.today = '0'; fake.month = '0';
});

await check("kuzatuv: to'xtatish Meta'da tasdiqlanmasa — kuzatuvda qoladi, egasiga «darhol Ads Manager'da»", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000001', name: 'Implant', daily: 10, lifetime: null, endsAt: null });
  fake.status['900000001'] = 'ACTIVE';
  fake.pauseSticks = false;
  try {
    fake.today = '25'; fake.month = '25';
    await watch(biz);
    assert.equal(mcpStore.tracked(biz.id, '900000001')?.status, 'active');
    assert.match(sent.at(-1)!.html, /to'xtatib bo'lmadi: Implant[\s\S]*Ads Manager/);
  } finally {
    fake.pauseSticks = true;
    fake.today = '0'; fake.month = '0';
  }
});

await check("bitta kampaniya limiti: kampaniyaning jami sarfi Meta'dan, limitga yetsa to'xtatiladi", async () => {
  const biz = newBiz();
  mcpStore.track(biz.id, { campaignId: '900000004', name: 'Guruhli', daily: null, lifetime: null, endsAt: null });
  fake.status['900000004'] = 'ACTIVE';
  fake.campaignSpend = '401';
  await watch(biz);
  assert.equal(mcpStore.tracked(biz.id, '900000004')?.status, 'paused');
  assert.match(sent.at(-1)!.html, /bir kampaniya limiti/);
  fake.campaignSpend = '1';
});

await check("sarf o'qilmasa — «noma'lum» (0 deb olinmaydi), hech narsa yoqilmaydi", async () => {
  const biz = newBiz(), guard = metaGuard(ctxOf(biz), 'claudeai', SERVER);
  fake.status['900000001'] = 'PAUSED';
  await guard(`${P}ads_activate_entity`, activateIn('900000001'));
  const id = cardId(), n = named('ads_activate_entity').length;
  fake.spendBroken = true;
  try {
    await assert.rejects(spendNow(biz, adsStore.connection(biz.id)!), /sarf/);
    await assert.rejects(approveAction(biz, id));
    assert.equal(named('ads_activate_entity').length, n, 'yoqish yuborilmadi');
  } finally {
    fake.spendBroken = false;
  }
});

await check("tayyor reja yo'li — tushunarli rad (Facebook tokeni kerak)", async () => {
  await rejects(propose(newBiz(), 'implant reklama', {} as never), /claude\.ai ulagichi/);
});

await check("Graph'ga hech qanday so'rov ketmadi", () => {
  assert.deepEqual(graphHits, []);
});

graph.close();
if (failed) { console.log(`\n${failed} ta tekshiruv o'tmadi`); process.exit(1); }
console.log('\nHammasi joyida');
process.exit(0);
