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
  const tools = palantirTools(ctx, false, ['base', 'qabulxona', 'kontent', 'target', 'marketolog', 'kuzatuvchi', 'rekruter', 'murabbiy'], new ToolGate());
  assert.deepEqual(tools.map(t => t.name).sort(), defs.map(([n]) => n).sort());
  const byName = new Map(tools.map(t => [t.name, t]));
  const ok = await byName.get('list_tasks')!.handler({} as never, undefined);
  assert.equal(ok.isError, false);
  assert.equal(ok.content[0].type, 'text');
  const bad = await byName.get('create_task')!.handler({} as never, undefined);
  assert.equal(bad.isError, true);
  assert.match(String((bad.content[0] as { text: string }).text), /Kirish noto'g'ri/);
});

const { extrasPaused, extrasPausedUntil, notePressure, resetPressure } = await import('../server/subscription/pressure');
await check("B5: limitga yaqin (ogohlantirish yoki 85%) — qo'shimchalar yangilanguncha to'xtaydi; 50% — ishlaydi; yangilangach — yana ishlaydi", () => {
  const now = Date.parse('2026-11-15T10:00:00Z'), reset = Math.floor((now + 2 * 3_600_000) / 1000);
  resetPressure();
  assert.equal(extrasPaused(now), false);
  notePressure({ status: 'allowed', utilization: 0.5, resetsAt: reset }, now);
  assert.equal(extrasPaused(now), false);
  notePressure({ status: 'allowed', utilization: 0.85, resetsAt: reset }, now);
  assert.equal(extrasPausedUntil(now), reset * 1000);
  assert.equal(extrasPaused(reset * 1000 + 1), false, 'limit yangilangach — yana ishlaydi');
  notePressure({ status: 'allowed_warning', resetsAt: reset }, now);
  assert.equal(extrasPaused(now), true);
  notePressure({ status: 'allowed', utilization: 92 }, now); // foizda kelsa ham; vaqt aytilmasa — 5 soat
  assert.equal(extrasPaused(now + 4 * 3_600_000), true);
  assert.equal(extrasPaused(now + 6 * 3_600_000), false);
  resetPressure();
});
await check("B5: obuna javobidagi limit belgisi bosim holatiga yoziladi", () => {
  resetPressure();
  collectResult([{ type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } }, { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }] as never);
  assert.equal(extrasPaused(), true);
  resetPressure();
});

// ─── Limitni oxirigacha ishlatish (navbatlar) va Gemini zaxirasi ──────────────────

const { busiestShare, currentLane, laneClosedUntil, laneOpen, pausedText, withLane } = await import('../server/subscription/pressure');
const HOUR = 3_600_000;
/** Obunaning haqiqiy javobi shaklida (2026-11-16 da jonli obunadan olingan): ulush — unifiedWindows ichida */
const event = (five: number, week: number, now: number, weekLeftH = 29, status: 'allowed' | 'rejected' = 'allowed') => ({
  status, resetsAt: Math.floor((now + 2 * HOUR) / 1000), rateLimitType: 'five_hour' as const,
  unifiedWindows: { five_hour: { utilization: five, resetsAt: Math.floor((now + 2 * HOUR) / 1000), status }, seven_day: { utilization: week, resetsAt: Math.floor((now + weekLeftH * HOUR) / 1000), status: 'allowed' } },
});

await check("haqiqiy obuna javobi (unifiedWindows): ikkala oyna o'qiladi, 17% / 61% da hamma navbat ochiq", () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  resetPressure();
  notePressure(event(0.17, 0.61, now) as never, now);
  assert.equal(busiestShare(now), 0.61);
  for (const lane of ['background', 'heavy', 'live', 'patient'] as const) assert.equal(laneOpen(lane, now), true, lane);
});

await check("navbatlar: 86% — fondagi to'xtaydi, 93% — katta ishlar ham, 98% — egasining savollari ham; bemorlar — faqat limit tugaganda", () => {
  const now = Date.parse('2026-11-16T10:00:00Z'), reset = Math.floor((now + 2 * HOUR) / 1000) * 1000;
  const open = (five: number, status: 'allowed' | 'rejected' = 'allowed') => {
    resetPressure();
    notePressure(event(five, 0.3, now, 100, status) as never, now);
    return (['background', 'heavy', 'live', 'patient'] as const).map(l => laneOpen(l, now));
  };
  assert.deepEqual(open(0.84), [true, true, true, true]);
  assert.deepEqual(open(0.86), [false, true, true, true]);
  assert.deepEqual(open(0.93), [false, false, true, true]);
  assert.deepEqual(open(0.98), [false, false, false, true]);
  assert.deepEqual(open(1, 'rejected'), [false, false, false, false]);
  assert.equal(laneClosedUntil('live', now), reset, 'qachon ochilishi — oyna yangilanishi');
  assert.equal(laneOpen('live', reset + 1), true, 'yangilangach — yana ochiq');
  resetPressure();
});

await check("haftalik sur'at: hafta boshida 60% ishlatilgan bo'lsa fondagi ishlar kutadi; hafta oxirida qolgan limit fondagi ishlarga beriladi", () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  resetPressure();
  // 5 kun qoldi (haftaning 29% i o'tdi), 60% ishlatilgan — sur'atdan oldinda
  notePressure(event(0.2, 0.6, now, 120) as never, now);
  assert.equal(laneOpen('background', now), false);
  assert.equal(laneOpen('heavy', now), true, "sur'at faqat fondagi ishlarga");
  const back = laneClosedUntil('background', now)!;
  const weekStart = now + 120 * HOUR - 7 * 24 * HOUR;
  assert.ok(Math.abs(back - (weekStart + 0.5 * 7 * 24 * HOUR)) < 2000, "sur'at yetib oladigan payt");
  // 10 soat qoldi, 80% — limit baribir yangilanadi: fondagi ishlar ishlasin
  resetPressure();
  notePressure(event(0.2, 0.8, now, 10) as never, now);
  assert.equal(laneOpen('background', now), true);
  resetPressure();
});

await check("ogohlantirish (allowed_warning) aniq ulush bilan kelsa — sun'iy 92% qilinmaydi; ulushsiz kelsa — ehtiyot uchun 92%", () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  resetPressure();
  notePressure({ ...event(0.55, 0.3, now, 100), status: 'allowed_warning' } as never, now);
  assert.equal(busiestShare(now), 0.55);
  assert.equal(laneOpen('heavy', now), true);
  resetPressure();
  notePressure({ status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: Math.floor((now + HOUR) / 1000) }, now);
  assert.equal(laneOpen('heavy', now), false);
  resetPressure();
});

await check("server qayta yonganda oxirgi limit holati diskdan o'qiladi", async () => {
  const { reloadPressure } = await import('../server/subscription/pressure');
  const now = Date.now();
  resetPressure();
  notePressure(event(0.95, 0.4, now, 100) as never, now);
  reloadPressure();
  assert.equal(busiestShare(now), 0.95);
  assert.equal(laneOpen('heavy', now), false);
  resetPressure();
  reloadPressure();
  assert.equal(busiestShare(now), null);
});

await check("navbat konteksti: ichma-ich — kamroq muhimi qoladi, await'dan keyin ham saqlanadi", async () => {
  assert.equal(currentLane(), undefined);
  assert.equal(withLane('background', () => withLane('heavy', () => currentLane())), 'background');
  assert.equal(withLane('live', () => withLane('heavy', () => currentLane())), 'heavy');
  assert.equal(await withLane('patient', async () => { await new Promise(r => setTimeout(r, 5)); return currentLane(); }), 'patient');
});

await check("egasiga «keyinroq» xabari: foiz va Toshkent vaqti; ertaga bo'lsa — sanasi bilan", () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  resetPressure();
  notePressure(event(0.93, 0.3, now, 100) as never, now);
  assert.match(pausedText('heavy', Date.parse('2026-11-16T12:30:00Z'), now), /93%.*Bu katta ish 17:30 dan keyin/);
  assert.match(pausedText('heavy', Date.parse('2026-11-17T01:00:00Z'), now), /17\.11 06:00/);
  assert.match(friendlyError(new SubscriptionError('paused', pausedText('live', now + HOUR, now))), /limitiga yaqin/);
  resetPressure();
});

const { geminiRequest, claudeMessage, GeminiError } = await import('../server/gemini/think');
await check("Gemini zaxirasi: ko'rsatma, rasm, JSON shakli va chuqurlik o'tadi; asbobli so'rov — yo'q", () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const body = geminiRequest({
    model: 'claude-opus-5-5', max_tokens: 500, system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'eA==' } }, { type: 'text', text: 'nima?', cache_control: { type: 'ephemeral' } }] }],
  }, 'gemini-3.8-flash') as Record<string, unknown>;
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.equal(body.store, false);
  assert.equal(body.system_instruction, 'A\n\nB');
  assert.deepEqual(body.input, [{ type: 'user_input', content: [{ type: 'image', data: 'eA==', mime_type: 'image/jpeg' }, { type: 'text', text: 'nima?' }] }]);
  assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json', schema });
  assert.deepEqual(body.generation_config, { thinking_level: 'low', max_output_tokens: 500 });
  assert.throws(() => geminiRequest({ model: 'm', max_tokens: 1, tools: [{ name: 't', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'x' }] }), GeminiError);
});

await check("Gemini javobi Claude javobi ko'rinishida: matn, tokenlar (o'ylash chiqishda); tugallanmagan javob — xato", () => {
  const m = claudeMessage({ status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '"1"}' }] }], usage: { total_tokens: 130, total_input_tokens: 100, total_cached_tokens: 40 } });
  assert.equal(m.stop_reason, 'end_turn');
  assert.deepEqual(m.content.map(b => (b.type === 'text' ? b.text : '')), ['{"a":"1"}']);
  assert.deepEqual(m.usage, { input_tokens: 60, output_tokens: 30, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 });
  assert.equal(claudeMessage({ status: 'incomplete', steps: [] }).stop_reason, 'max_tokens');
  assert.throws(() => claudeMessage({ status: 'failed', error: { message: 'x' } }), GeminiError);
});

// Soxta Gemini: so'rovni yozib oladi va JSON javob qaytaradi
const { createServer } = await import('node:http');
const { listen } = await import('./fakes');
const seen: { key: string; body: Record<string, unknown> }[] = [];
let geminiDown = false;
const fakeGemini = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  seen.push({ key: String(req.headers['x-goog-api-key']), body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
  if (geminiDown) { res.writeHead(400, { 'Content-Type': 'application/json', Connection: 'close' }).end(JSON.stringify({ error: { message: 'API key not valid' } })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }).end(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"reply":"Gemini"}' }] }], usage: { total_tokens: 12, total_input_tokens: 10 } }));
});
const geminiUrl = `http://127.0.0.1:${await listen(fakeGemini)}`;
const { aiProblem, think } = await import('../server/claude');
const { aiUsage } = await import('../server/serviceStore');
const { ask } = await import('../server/agent');
const { iso } = await import('../src/lib/week');
const zbiz = businesses.create(`zaxira${Date.now()}`, 'x', { name: 'Sinov', ownerName: 'Aziz', industry: 'stomatologiya', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
const plain = { model: 'claude-opus-5-5', max_tokens: 100, system: 'S', messages: [{ role: 'user' as const, content: 'salom' }] };
const textIn = (m: { content: { type: string; text?: string }[] }) => m.content.map(b => b.text ?? '').join('');

await check("limit yopgan navbatda: bemorga javob, qo'ng'iroq tahlili va kamera — Gemini'da (kalit bilan), hisobga yoziladi", async () => {
  Object.assign(env, { geminiKey: 'gk-1', geminiApiRoot: geminiUrl });
  const now = Date.now();
  resetPressure();
  notePressure(event(1, 0.5, now, 100, 'rejected') as never, now);
  seen.length = 0;
  const day = iso(new Date());
  const before = aiUsage.calls(zbiz.id, day, 'customer');
  assert.equal(textIn(await think(zbiz.id, 'customer', plain)), '{"reply":"Gemini"}');
  assert.equal(textIn(await withLane('patient', () => think(zbiz.id, 'owner', plain))), '{"reply":"Gemini"}');
  assert.equal(textIn(await think(zbiz.id, 'camera', plain)), '{"reply":"Gemini"}');
  assert.equal(seen.length, 3);
  assert.equal(seen[0].key, 'gk-1');
  assert.equal(seen[0].body.model, env.geminiTextModel);
  assert.equal(aiUsage.calls(zbiz.id, day, 'customer'), before + 1);
  resetPressure();
});

await check("limit yopgan navbatda: egasining ishi Gemini'ga ketmaydi — vaqti aytilgan «keyinroq»; kalitsiz bemor — «limit tugadi»", async () => {
  const now = Date.now();
  resetPressure();
  notePressure(event(0.93, 0.3, now, 100) as never, now);
  seen.length = 0;
  await assert.rejects(() => withLane('heavy', () => think(zbiz.id, 'owner', plain)), (e: unknown) => e instanceof SubscriptionError && e.reason === 'paused' && /dan keyin/.test(e.message));
  // Egasining Telegram'dagi gapi (live) 93% da ishlaydi, 98% da — vaqti bilan rad
  notePressure(event(0.98, 0.3, now, 100) as never, now);
  const r = await ask(zbiz.id, 'telegram', 'salom');
  assert.equal(r.failed, true);
  assert.match(r.text, /limitiga yaqin.*dan keyin/);
  assert.equal(seen.length, 0, "egasining ishi Gemini'ga ketmadi");
  notePressure(event(1, 0.5, now, 100, 'rejected') as never, now);
  // Gemini ham yiqilsa — xom Gemini xatosi emas, «limit tugadi» (nazorat va xodim shuni ko'radi)
  geminiDown = true;
  await assert.rejects(() => think(zbiz.id, 'customer', plain), (e: unknown) => e instanceof SubscriptionError && e.reason === 'limit');
  assert.match(String(aiProblem(zbiz.id)), /limiti tugadi/);
  geminiDown = false;
  assert.equal(textIn(await think(zbiz.id, 'customer', plain)), '{"reply":"Gemini"}');
  assert.equal(aiProblem(zbiz.id), null, 'Gemini javob bergach — muammo tiklandi');
  Object.assign(env, { geminiKey: '' });
  await assert.rejects(() => think(zbiz.id, 'customer', plain), (e: unknown) => e instanceof SubscriptionError && e.reason === 'limit');
  assert.match(String(aiProblem(zbiz.id)), /limiti tugadi/, "kalitsiz ham nazoratga tushadi");
  resetPressure();
});
await check("Gemini tokenlari alohida «gemini» qatorida va Gemini narxida (2027-01-01 dan ikki baravar)", async () => {
  const { geminiCostUsd } = await import('../server/gemini/think');
  const row = aiUsage.since(iso(new Date())).find(r => r.businessId === zbiz.id && r.kind === 'gemini');
  assert.ok(row && row.input > 0 && row.calls === 0, "gemini qatori: tokenlar bor, so'rovlar asl ish turida");
  const u = { input: 1_000_000, output: 1_000_000, cacheRead: 0 };
  assert.equal(geminiCostUsd(u, '2026-12-31', 'gemini-3.8-flash'), 4.5);
  assert.equal(geminiCostUsd(u, '2027-01-01', 'gemini-3.8-flash'), 9);
});

const { deferred, toolKey } = await import('../server/subscription/deferred');
const { runTool } = await import('../server/tools');
const { runDeferred } = await import('../server/scheduler');
const noBot = { enabled: false } as never;
const clearQueue = () => { for (const d of deferred.list(zbiz.id)) deferred.done(d.id); };

await check("limit tufayli rad etilgan egasining gapi navbatga qo'yiladi (bir marta), «o'zim bajaraman» deyiladi; navbat ochilmaguncha bajarilmaydi", async () => {
  const now = Date.now();
  resetPressure();
  clearQueue();
  notePressure(event(0.98, 0.3, now, 100) as never, now);
  const r = await ask(zbiz.id, 'telegram', 'Oylik hisobot tayyorla');
  assert.match(r.text, /o'zim bajarib, natijasini yuboraman/);
  await ask(zbiz.id, 'telegram', 'Oylik hisobot tayyorla');
  const q = deferred.list(zbiz.id).filter(d => d.text === 'Oylik hisobot tayyorla');
  assert.equal(q.length, 1, 'takror navbatga ikki marta tushmaydi');
  assert.equal(q[0].own, true);
  assert.equal(q[0].lane, 'live');
  // Qo'ng'iroqdagi gap navbatga qo'yilmaydi (qo'ng'iroq tugagan)
  await ask(zbiz.id, 'telegram', "Qo'ng'iroqdagi savol", { phone: true });
  assert.equal(deferred.list(zbiz.id).some(d => d.text === "Qo'ng'iroqdagi savol"), false);
  // Vaqti hali kelmagan — bajarilmaydi; vaqti o'tgan, lekin navbat hali yopiq (masalan, haftalik oyna) — ham bajarilmaydi, navbatda qoladi
  assert.equal(await runDeferred(noBot, now), 0);
  deferred.add({ businessId: zbiz.id, channel: 'telegram', text: 'Eski ish', display: 'Eski ish', lane: 'live', until: now - 1000, own: true });
  assert.equal(await runDeferred(noBot, now), 0);
  assert.equal(deferred.list(zbiz.id).length, 2);
  clearQueue();
  resetPressure();
});

await check("katta asbob (hujjat) limit tufayli bajarilmasa — faqat o'sha asbob navbatga (bilim/CRM'ga yozmaydigan rejimda); jadvaldagi ishda — yo'q", async () => {
  const now = Date.now();
  resetPressure();
  clearQueue();
  notePressure(event(0.93, 0.3, now, 100) as never, now);
  const input = { title: 'Narxlar', kind: 'price_list', brief: 'Implant 5 mln' };
  const out = await withLane('live', () => runTool('create_document', input, { biz: zbiz, artifacts: [] }));
  assert.equal(out.isError, true);
  assert.match(out.content, /o'zim bajarib.*qayta chaqirmang/);
  const q = deferred.list(zbiz.id);
  assert.equal(q.length, 1);
  assert.equal(q[0].own, false);
  assert.equal(q[0].lane, 'heavy');
  assert.equal(q[0].tool, 'create_document');
  assert.deepEqual(JSON.parse(q[0].input!), input, "kirish to'liq saqlanadi (kesilmaydi)");
  // Boshqa kirish bilan — alohida ish (kalit kirish xeshidan)
  await withLane('live', () => runTool('create_document', { ...input, title: 'Narxlar 2' }, { biz: zbiz, artifacts: [] }));
  assert.equal(deferred.list(zbiz.id).length, 2);
  clearQueue();
  const scheduled = await withLane('live', () => runTool('create_document', input, { biz: zbiz, artifacts: [], unattended: true }));
  assert.match(scheduled.content, /qayta so'rang/);
  assert.equal(deferred.list(zbiz.id).length, 0, 'jadvaldagi ish navbatga tushmaydi');
  resetPressure();
});

await check("navbatdagi asbob modelsiz bajariladi: vazifa yaratiladi; bilimga yozish (remember) — begona matn rejimida rad; navbatdan o'chadi", async () => {
  const { tasks } = await import('../server/db');
  const now = Date.now();
  resetPressure();
  clearQueue();
  const add = (tool: string, input: unknown) => deferred.add({ businessId: zbiz.id, channel: 'telegram', lane: 'heavy', until: now - 1000, own: false, text: toolKey(tool, input), tool, input: JSON.stringify(input), display: tool });
  add('create_task', { title: 'Kechiktirilgan vazifa' });
  add('remember', { fact: "Narx 1 so'm" });
  assert.equal(await runDeferred(noBot, now), 2);
  assert.ok(tasks.list(zbiz.id).some(t => t.title === 'Kechiktirilgan vazifa'));
  const { facts } = await import('../server/brain/vault');
  assert.equal(JSON.stringify(facts.list(zbiz.id)).includes("Narx 1 so'm"), false, "bilimga yozilmadi");
  assert.equal(deferred.list(zbiz.id).length, 0);
});

await check("navbatdagi ish yana limitga tushsa — navbatda qoladi (urinish sanaladi, egasiga xabar yo'q); 3 urinishdan keyin — voz kechiladi", async () => {
  const now = Date.now();
  resetPressure();
  clearQueue();
  // Katta ish navbati yopiq; ish «live» navbatda turibdi — bajarishga olinadi, ichida hujjat yana limitga tushadi
  notePressure(event(0.93, 0.3, now, 100) as never, now);
  const input = { title: 'Narxlar', kind: 'price_list', brief: 'Implant 5 mln' };
  deferred.add({ businessId: zbiz.id, channel: 'telegram', lane: 'live', until: now - 1000, own: false, text: toolKey('create_document', input), tool: 'create_document', input: JSON.stringify(input), display: 'Hujjat' });
  assert.equal(await runDeferred(noBot, now), 0);
  const [left] = deferred.list(zbiz.id);
  assert.ok(left && !left.claimed && left.attempts === 1, `navbatda qoldi: ${JSON.stringify(left)}`);
  assert.equal(left.lane, 'heavy');
  // Urinishlar tugagan ish — bajarilmaydi, o'chiriladi
  clearQueue();
  deferred.add({ businessId: zbiz.id, channel: 'telegram', lane: 'live', until: now - 1000, own: true, text: 'Eski', display: 'Eski', attempts: 3 });
  assert.equal(await runDeferred(noBot, now), 0);
  assert.equal(deferred.list(zbiz.id).length, 0);
  resetPressure();
});

fakeGemini.closeAllConnections();
fakeGemini.close();

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
// process.exit emas: Windows'da fetch ulanishi yopilayotganda chiqilsa Node yiqiladi (UV_HANDLE_CLOSING) — jarayon o'zi tugaydi
process.exitCode = failed ? 1 : 0;
