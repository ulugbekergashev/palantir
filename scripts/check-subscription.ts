/**
 * Obuna dvigateli (AI_ENGINE=subscription, Claude Agent SDK) — AI'ga so'rov yubormasdan tekshiriladigan qismlari:
 * kalitlar bola jarayonga o'tmasligi, so'rovni obunaga aylantirish, natijani o'qish, Palantir asboblari MCP orqali, sessiya kaliti
 * va egasiga tushunarli xatolar. Jonli tekshiruv (haqiqiy obuna bilan): npx tsx scripts/live-subscription.ts
 * Ishga tushirish: npm run test:subscription
 */
import './isolate';
import assert from 'node:assert/strict';

process.env.AI_ENGINE = 'subscription';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { env } = await import('../server/env');
const { childEnv, collectResult, plainRequest, SubscriptionError, sessionKey, sessionOf } = await import('../server/subscription/engine');
const { palantirTools, ToolGate } = await import('../server/subscription/tools');
const { ownerToolDefs } = await import('../server/tools');
const { friendlyError } = await import('../server/agent');
const { businesses } = await import('../server/db');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

console.log('Obuna dvigateli');

await check('obuna rejimida API kalitsiz ham AI yoqilgan hisoblanadi', () => {
  assert.equal(env.aiEngine, 'subscription');
  assert.equal(env.aiEnabled, true);
});

await check("bola jarayonga API kalit, token va soxta manzil o'tmaydi (aks holda obuna emas, kalit ishlatiladi)", () => {
  const out = childEnv({ PATH: 'C:\\bin', ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_MODEL: 'x', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-1' });
  assert.equal(out.PATH, 'C:\\bin');
  assert.equal(out.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-1');
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK']) assert.equal(k in out, false, k);
  assert.match(String(out.CLAUDE_AGENT_SDK_CLIENT_APP), /^palantir\//);
});

await check("asbobsiz bitta matnli so'rov obunaga o'tadi: ko'rsatma, matn va chuqurlik saqlanadi", () => {
  const r = plainRequest({ model: 'claude-opus-5-5', max_tokens: 100, system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }], output_config: { effort: 'low' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'salom' }, { type: 'text', text: 'dunyo' }] }] });
  assert.deepEqual(r, { model: 'claude-opus-5-5', system: 'A\n\nB', content: 'salom\n\ndunyo', schema: null, effort: 'low' });
  const s = plainRequest({ model: 'm', max_tokens: 100, system: 'S', messages: [{ role: 'user', content: 'savol' }] });
  assert.deepEqual(s, { model: 'm', system: 'S', content: 'savol', schema: null, effort: undefined });
});

await check("rasmli so'rov (kamera, rasmni ko'rish) obunaga bloklar bilan o'tadi, kesh belgisi olib tashlanadi", () => {
  const image = { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'eA==' };
  const r = plainRequest({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'image', source: image }, { type: 'text', text: 'nima bor?', cache_control: { type: 'ephemeral' } }] }] });
  assert.deepEqual(r?.content, [{ type: 'image', source: image }, { type: 'text', text: 'nima bor?' }]);
});

await check("JSON shakli so'ralgan so'rov (mijozga javob, Direktor) obunaga shakli bilan o'tadi", () => {
  const schema = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
  const r = plainRequest({ model: 'm', max_tokens: 1, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: 'x' }] });
  assert.deepEqual(r?.schema, schema);
  assert.equal(r?.effort, 'low');
});

await check("asbobli, bir necha xabarli yoki hujjatli so'rov obunaga o'tmaydi (null — API kalit kerak)", () => {
  assert.equal(plainRequest({ model: 'm', max_tokens: 1, tools: [{ name: 't', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'x' }] }), null);
  assert.equal(plainRequest({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }), null);
  assert.equal(plainRequest({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'x' } }] }] }), null);
});

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 };
const result = (over: Record<string, unknown>) => ({ type: 'result', subtype: 'success', is_error: false, result: 'Tayyor', session_id: 'sess-1', usage, num_turns: 1, errors: [], ...over });

await check("natija: matn, sessiya va tokenlar o'qiladi", () => {
  const r = collectResult([{ type: 'system', subtype: 'init', session_id: 'sess-1' }, result({})] as never);
  assert.deepEqual(r, { text: 'Tayyor', sessionId: 'sess-1', cut: false, refused: false, usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 } });
});

await check("JSON shakli so'ralganda SDK tekshirgan javob (structured) ham qaytadi", () => {
  const r = collectResult([result({ result: '{"reply":"ok"}', structured_output: { reply: 'ok' } })] as never);
  assert.deepEqual(r.structured, { reply: 'ok' });
});

await check('model rad etsa — refused belgisi', () => {
  assert.equal(collectResult([result({ stop_reason: 'refusal', result: '' })] as never).refused, true);
});

await check("qadamlar tugasa — xato emas, oxirgi aytilgan matn bilan «uzildi»", () => {
  const assistant = { type: 'assistant', session_id: 'sess-2', message: { content: [{ type: 'text', text: 'Ikkitasini qo\'shdim' }] } };
  const r = collectResult([assistant, result({ subtype: 'error_max_turns', is_error: true, result: undefined, session_id: 'sess-2', errors: ['max turns'] })] as never);
  assert.equal(r.cut, true);
  assert.equal(r.text, "Ikkitasini qo'shdim");
  assert.equal(r.sessionId, 'sess-2');
});

await check('kirilmagan obuna → auth, limit → limit, boshqasi → failed', () => {
  const kind = (msgs: unknown[]) => { try { collectResult(msgs as never); return 'ok'; } catch (e) { return e instanceof SubscriptionError ? e.reason : 'other'; } };
  assert.equal(kind([result({ is_error: true, result: 'Not logged in · Please run /login', api_error_status: 401 })]), 'auth');
  assert.equal(kind([result({ is_error: true, result: "You've hit your usage limit · resets 5pm" })]), 'limit');
  assert.equal(kind([result({ is_error: true, result: 'Rate limit reached for your OAuth account' })]), 'limit');
  assert.equal(kind([{ type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'rejected' } }, result({ is_error: true, result: 'API Error' })]), 'limit');
  assert.equal(kind([result({ subtype: 'error_during_execution', is_error: true, result: undefined, errors: ['boom'] })]), 'failed');
  assert.equal(kind([]), 'failed');
});

await check('xatoda sessiya saqlanadi (bajarilgan asboblar keyingi gapda unutilmasin)', () => {
  try {
    collectResult([{ type: 'system', subtype: 'init', session_id: 'sess-7' }, result({ subtype: 'error_during_execution', is_error: true, result: undefined, session_id: 'sess-7', errors: ['boom'] })] as never);
    assert.fail('xato kutilgan edi');
  } catch (e) {
    assert.ok(e instanceof SubscriptionError);
    assert.equal(e.sessionId, 'sess-7');
  }
});

await check('egasiga tushunarli sabab: kirish, limit va qo\'llab-quvvatlanmaydigan ish', () => {
  assert.match(friendlyError(new SubscriptionError('auth', 'x')), /claude/i);
  assert.match(friendlyError(new SubscriptionError('limit', 'x')), /limit/i);
  assert.match(friendlyError(new SubscriptionError('unsupported', 'x')), /API kalit/i);
  assert.match(friendlyError(new SubscriptionError('timeout', 'x')), /uzoq/i);
});

await check("mijozga javob obunada tayyorlanmasa — xodimga sababi aytiladi (limit, kirilmagan)", async () => {
  const { whyNoReply } = await import('../server/inbox/core');
  assert.match(whyNoReply(new SubscriptionError('limit', 'x')), /obunasining limiti/);
  assert.match(whyNoReply(new SubscriptionError('auth', 'x')), /obunasiga kirilmagan/);
  assert.match(whyNoReply(new Error('boom')), /javob tayyorlay olmadi/);
});

await check("darvoza: yopilgach asbob ishlamaydi, yopish ishlayotgan asbobni kutadi, chaqiruvlar sanaladi", async () => {
  const gate = new ToolGate();
  let finished = false;
  const slow = gate.run(async () => { await new Promise(r => setTimeout(r, 50)); finished = true; return 'ok'; }, 'rad');
  assert.equal(gate.calls, 1);
  await gate.close();
  assert.equal(finished, true, 'close() ishlayotgan asbobni kutmadi');
  assert.equal(await slow, 'ok');
  assert.equal(await gate.run(async () => 'ok', 'rad'), 'rad');
  assert.equal(gate.calls, 1);
});

await check('sessiya kaliti: shu asboblar to\'plamiga tegishli bo\'lsa sessiya qaytadi, boshqa bo\'lsa — yo\'q', () => {
  const key = sessionKey('abc123', 'sess-9');
  assert.equal(sessionOf(key, 'abc123'), 'sess-9');
  assert.equal(sessionOf(key, 'other'), null);
  assert.equal(sessionOf('abc123', 'abc123'), null);
});

await check("har bir Palantir asbobi MCP asbobiga aylanadi va natija runTool orqali qaytadi", async () => {
  const biz = businesses.create(`obuna${Date.now()}`, 'x', { name: 'Sinov', ownerName: 'Ulug\'bek', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
  const ctx = { biz, artifacts: [] };
  const defs = ownerToolDefs(false);
  const tools = palantirTools(ctx, false, ['base', 'qabulxona', 'kontent', 'target', 'marketolog', 'kuzatuvchi'], new ToolGate());
  assert.deepEqual(tools.map(t => t.name).sort(), defs.map(([n]) => n).sort());
  const byName = new Map(tools.map(t => [t.name, t]));
  const ok = await byName.get('list_tasks')!.handler({} as never, undefined);
  assert.equal(ok.isError, false);
  assert.equal(ok.content[0].type, 'text');
  const bad = await byName.get('create_task')!.handler({} as never, undefined);
  assert.equal(bad.isError, true);
  assert.match(String((bad.content[0] as { text: string }).text), /Kirish noto'g'ri/);
});

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
