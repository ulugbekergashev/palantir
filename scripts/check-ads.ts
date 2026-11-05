/**
 * Targetolog — soxta Meta Graph serveri bilan (haqiqiy pul va tarmoqsiz): reja, limitlar, ishga tushirish tartibi (pauzada yaratish →
 * byudjetni o'qib solishtirish → oxirida yoqish), xatoda tozalash, ikki marta bosish, kuzatuvda limitga yetganda to'xtatish.
 * Ishga tushirish: npm run test:ads
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Soxta Meta ───────────────────────────────────────────────────────────────
interface Call { method: string; path: string; params: Record<string, string> }
const calls: Call[] = [];
const fake = { today: '0', month: '0', echoBudget: null as string | null, failAds: false, failActivate: false, failCleanup: false, campaignSeq: 0, lastBudget: '0', videoPolls: 0, videoBytes: 0 };
const body = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
/** multipart (video yuklash): oddiy maydonlar va fayl hajmi */
function multipart(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/--[^\r\n]+\r\n/)) {
    const m = /name="([^"]+)"(; filename="[^"]*")?[^]*?\r\n\r\n([^]*)\r\n$/.exec(part);
    if (!m) continue;
    if (m[2]) fake.videoBytes = m[3].length; else out[m[1]] = m[3];
  }
  return out;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  const raw = req.method === 'GET' ? '' : await body(req);
  const params = req.method === 'GET' ? Object.fromEntries(url.searchParams)
    : String(req.headers['content-type']).startsWith('multipart/') ? multipart(raw) : Object.fromEntries(new URLSearchParams(raw));
  const path = url.pathname.replace(/^\/v26\.0\//, '');
  calls.push({ method: req.method!, path, params });
  const send = (code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (params.access_token !== 'tok-1') return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
  if (req.method === 'GET' && path === 'act_9999999') return send(200, { name: 'Boshqa', currency: 'IDR', account_status: 1 });
  if (fake.failActivate && req.method === 'POST' && /^c\d+$/.test(path) && params.status === 'ACTIVE') return send(500, { error: { message: 'timeout', code: 2 } });
  if (fake.failCleanup && /^c\d+$/.test(path) && (req.method === 'DELETE' || params.status === 'PAUSED')) return send(500, { error: { message: 'down', code: 2 } });
  if (req.method === 'GET' && path === 'act_1234567') return send(200, { name: 'Mening kabinetim', currency: 'USD', account_status: 1, timezone_name: 'Asia/Tashkent' });
  if (req.method === 'GET' && path === '7770001') return send(200, { name: 'Palantir sahifa' });
  if (req.method === 'GET' && path === 'act_1234567/insights') return send(200, { data: [{ spend: params.date_preset === 'today' ? fake.today : fake.month }] });
  if (req.method === 'GET' && path === 'search') return send(200, { data: params.q === 'Toshkent' ? [{ key: '2215', name: 'Tashkent', country_code: 'UZ', type: 'city' }] : [] });
  if (req.method === 'POST' && path === 'act_1234567/adimages') return send(200, { images: { [params.name]: { hash: `hash-${calls.length}` } } });
  if (req.method === 'POST' && path === 'act_1234567/advideos') return send(200, { id: 'v77' });
  // Meta videoni avval qayta ishlaydi: birinchi so'rovda «processing», keyin «ready»
  if (req.method === 'GET' && path === 'v77') return send(200, { status: { video_status: ++fake.videoPolls < 2 ? 'processing' : 'ready' } });
  if (req.method === 'POST' && path === 'act_1234567/campaigns') { fake.lastBudget = params.lifetime_budget; return send(200, { id: `c${++fake.campaignSeq}` }); }
  if (req.method === 'GET' && /^c\d+$/.test(path)) return send(200, { lifetime_budget: fake.echoBudget ?? fake.lastBudget });
  if (req.method === 'POST' && path === 'act_1234567/adsets') return send(200, { id: 's1' });
  if (req.method === 'POST' && path === 'act_1234567/adcreatives') return send(200, { id: `cr${calls.length}` });
  if (req.method === 'POST' && path === 'act_1234567/ads') return fake.failAds ? send(400, { error: { message: 'x', code: 100, error_user_title: 'Matn', error_user_msg: 'Reklama matni qoidaga zid' } }) : send(200, { id: `ad${calls.length}` });
  if ((req.method === 'POST' || req.method === 'DELETE') && /^c\d+$/.test(path)) return send(200, { success: true });
  if (req.method === 'GET' && /^c\d+\/insights$/.test(path)) return send(200, { data: [{ spend: '12.5', impressions: '1000', clicks: '30', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }] }] });
  send(404, { error: { message: `soxta: ${req.method} ${path}`, code: 100 } });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
process.env.META_GRAPH_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ADS_VIDEO_POLL_MS = '20';

const { toMinor, planProblems, campaignParams, adsetParams, creativeParams, targeting } = await import('../server/ads/plan');
const { adsStore } = await import('../server/ads/store');
const { connect, disconnect, propose, launch, pause, resume, cancel, watch, planMark, TargetError } = await import('../server/ads/campaigns');
const { ownerBudget } = await import('../server/ads/planner');
const { businesses } = await import('../server/db');
const { env } = await import('../server/env');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`); }
}
const rejects = async (p: Promise<unknown>, re: RegExp) => {
  try { await p; } catch (e) { assert.ok(e instanceof TargetError, `TargetError kutilgan edi: ${(e as Error).message}`); assert.match(e.message, re); return; }
  assert.fail('xato kutilgan edi');
};

const plan = (over: Record<string, unknown> = {}) => ({
  name: 'Implant aksiyasi', destination: 'instagram' as const, budget: 50, days: 5, countries: ['UZ'], cities: [{ name: 'Toshkent' }],
  ageMin: 25, ageMax: 55, genders: [], autoAudience: false, welcome: 'Salom! Qaysi xizmat qiziqtiradi?', link: null,
  ads: [{ text: 'Implant — bepul konsultatsiya, 3D tomografiya bilan.', headline: 'Bepul konsultatsiya', image: 'file:rasm00001.jpg' }], notes: [], ...over,
});
const LIMITS = { perCampaign: 100, daily: 20, monthly: 300 };
const NO_SPEND = { today: 0, month: 0, committed: 0, dailyRate: 0 };
const ACC = { adAccountId: '1234567', pageId: '7770001', igActorId: '8880001', currency: 'USD' };

console.log('Targetolog');

await check('summa API uchun eng kichik birlikda: USD — sent, JPY — butun', () => {
  assert.equal(toMinor(50, 'USD'), 5000);
  assert.equal(toMinor(12.345, 'usd'), 1235);
  assert.equal(toMinor(5000, 'JPY'), 5000);
});

await check("limitlar: byudjet aytilmagan, limit yo'q, kampaniya/kunlik/oylik oshgan, shahar topilmagan, rasm yo'q — hammasi aytiladi", () => {
  const P = (o: Record<string, unknown>) => planProblems(plan({ cities: [{ name: 'Toshkent', key: '2215' }], ...o }) as never, LIMITS, NO_SPEND, ACC, 'USD');
  assert.deepEqual(P({}), []);
  assert.match(P({ budget: null }).join(), /Byudjet aytilmagan/);
  assert.match(planProblems(plan({ cities: [] }) as never, { perCampaign: 0, daily: 0, monthly: 0 }, NO_SPEND, ACC, 'USD').join(), /Limitlar o'rnatilmagan/);
  assert.match(P({ budget: 150 }).join(), /bir kampaniya limitidan/);
  assert.match(P({ budget: 50, days: 2 }).join(), /kunlik limitdan/);
  assert.match(planProblems(plan({ cities: [] }) as never, LIMITS, { today: 0, month: 240, committed: 20, dailyRate: 0 }, ACC, 'USD').join(), /Oylik limit/);
  assert.match(P({ cities: [{ name: 'Atlantida' }] }).join(), /topilmadi: Atlantida/);
  assert.match(P({ ads: [{ text: 'Matn matn matn matn', image: '' }] }).join(), /rasm tanlanmagan/);
  assert.match(planProblems(plan({ cities: [] }) as never, LIMITS, NO_SPEND, { ...ACC, igActorId: null }, 'USD').join(), /Instagram akkaunti/);
  assert.match(planProblems(plan({ cities: [] }) as never, LIMITS, NO_SPEND, null, 'USD').join(), /ulanmagan/);
  assert.match(planProblems(plan({ cities: [] }) as never, LIMITS, { ...NO_SPEND, dailyRate: 15 }, ACC, 'USD').join(), /ishlayotganlar/, 'boshqa kampaniyalar kunlik tezligi qo\'shiladi');
});

await check("Meta so'rovlari: kampaniya pauzada, umumiy byudjet sentda; guruh — Instagram Direct, tugash vaqti; kreativ — Direct tugmasi", () => {
  const p = plan({ cities: [{ name: 'Toshkent', key: '2215', radiusKm: 30 }] }) as never;
  const c = campaignParams(p, 'USD');
  assert.equal(c.status, 'PAUSED');
  assert.equal(c.objective, 'OUTCOME_ENGAGEMENT');
  assert.equal(c.lifetime_budget, 5000);
  assert.deepEqual(c.special_ad_categories, []);
  const start = new Date('2026-11-02T10:00:00Z');
  const s = adsetParams(p, ACC, 'c9', start);
  assert.equal(s.destination_type, 'INSTAGRAM_DIRECT');
  assert.equal(s.optimization_goal, 'CONVERSATIONS');
  assert.equal(Number(s.end_time) - Number(s.start_time), 5 * 86_400);
  assert.equal('daily_budget' in s || 'lifetime_budget' in s, false, 'byudjet faqat kampaniyada');
  assert.deepEqual(targeting(p).geo_locations, { cities: [{ key: '2215', radius: 30, distance_unit: 'kilometer' }] });
  const cr = creativeParams(p, ACC, 0, 'h1') as { object_story_spec: { instagram_actor_id: string; link_data: { call_to_action: { type: string }; image_hash: string } } };
  assert.equal(cr.object_story_spec.instagram_actor_id, '8880001');
  assert.equal(cr.object_story_spec.link_data.call_to_action.type, 'INSTAGRAM_MESSAGE');
  const vid = creativeParams(p, ACC, 0, 'h1', 'v77') as { object_story_spec: { link_data?: unknown; video_data: { video_id: string; image_hash: string; message: string; title: string; page_welcome_message: string; call_to_action: { type: string } } } };
  assert.equal(vid.object_story_spec.link_data, undefined, 'video — link_data emas, video_data');
  assert.deepEqual([vid.object_story_spec.video_data.video_id, vid.object_story_spec.video_data.image_hash, vid.object_story_spec.video_data.title], ['v77', 'h1', 'Bepul konsultatsiya'], 'video va uning muqovasi');
  assert.equal(vid.object_story_spec.video_data.call_to_action.type, 'INSTAGRAM_MESSAGE');
  assert.equal(vid.object_story_spec.video_data.page_welcome_message, 'Salom! Qaysi xizmat qiziqtiradi?');
  const webVid = creativeParams(plan({ destination: 'website', link: 'https://palantir.uz' }) as never, ACC, 0, 'h1', 'v77') as { object_story_spec: { video_data: { call_to_action: { value: { link: string } } } } };
  assert.equal(webVid.object_story_spec.video_data.call_to_action.value.link, 'https://palantir.uz', 'videoda havola — tugmada');
  const web = creativeParams(plan({ destination: 'website', link: 'https://palantir.uz' }) as never, ACC, 0, 'h1') as { object_story_spec: { link_data: { link: string } } };
  assert.equal(web.object_story_spec.link_data.link, 'https://palantir.uz');
  assert.equal(adsetParams(plan({ destination: 'website', link: 'https://palantir.uz' }) as never, ACC, 'c', start).promoted_object, undefined);
});

await check("byudjet faqat egasidan: topshiriqda yo'q summa — null; jami yoki kunlik × kun — qoladi", () => {
  const P = (budget: number, days = 6) => plan({ budget, days }) as never;
  assert.equal(ownerBudget(P(60), 'Implant reklamasi, jami 60 dollar, 6 kun').budget, 60);
  assert.equal(ownerBudget(P(60), 'Kuniga 10$, 6 kun').budget, 60);
  assert.equal(ownerBudget(P(60), 'Implant reklamasi, Toshkentda').budget, null);
  assert.equal(ownerBudget(P(1500000), "Jami 1 500 000 so'm").budget, 1500000);
});

// ─── Zanjir (soxta Meta) ──────────────────────────────────────────────────────
const biz = businesses.create(`target${Date.now()}`, 'x', { name: 'Sinov', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
mkdirSync(join(env.dataDir, 'reklama', biz.id), { recursive: true });
writeFileSync(join(env.dataDir, 'reklama', biz.id, 'rasm00001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

await check("ulash: noto'g'ri token — tushunarli xato; to'g'ri — kabinet nomi va valyuta saqlanadi, token shifrlangan", async () => {
  await rejects(connect(biz, { token: 'yomon', adAccountId: 'act_1234567', pageId: '7770001', igActorId: '8880001' }), /token/i);
  const c = await connect(biz, { token: 'tok-1', adAccountId: 'act_1234567', pageId: '7770001', igActorId: '8880001' });
  assert.equal(c.currency, 'USD');
  assert.equal(c.accountName, 'Mening kabinetim');
  assert.equal(adsStore.connection(biz.id)?.token, 'tok-1');
  assert.ok(calls.every(x => !x.path.includes('tok-1')), "token manzilda emas");
});

await check("birligi aniq bo'lmagan valyutadagi kabinet ulanmaydi; kuzatuvdagi kampaniya bor paytda boshqa kabinetga o'tib bo'lmaydi", async () => {
  const b2 = businesses.create(`val${Date.now()}`, 'x', { name: 'V', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
  await rejects(connect(b2, { token: 'tok-1', adAccountId: '9999999', pageId: '7770001' }), /IDR/);
});

let id = '';
await check("reja: shahar Meta kodiga aylanadi; limit yo'qligida ishga tushmaydi", async () => {
  const camp = await propose(biz, "Implant reklamasi, 50$, 5 kun, Toshkent", plan() as never);
  id = camp.id;
  assert.equal(camp.plan.cities[0].key, '2215');
  await rejects(launch(biz, id), /Limitlar o'rnatilmagan/);
  assert.equal(adsStore.campaign(biz.id, id)?.status, 'proposed');
});

await check("bugungi sarf limitga yaqin — ishga tushmaydi (haqiqiy sarf ishga tushirishdan oldin qayta olinadi)", async () => {
  adsStore.saveLimits(biz.id, LIMITS);
  fake.month = '280';
  await rejects(launch(biz, id), /Oylik limit/);
  fake.month = '0';
});

await check("Meta byudjetni boshqacha qaytarsa — kampaniya o'chiriladi, holat «yaratilmadi», pul ketmaydi", async () => {
  fake.echoBudget = '500000';
  const before = calls.length;
  await rejects(launch(biz, id), /byudjet boshqacha/);
  fake.echoBudget = null;
  const mine = calls.slice(before);
  assert.ok(mine.some(x => x.method === 'DELETE' && /^c\d+$/.test(x.path)), "o'chirildi");
  assert.ok(!mine.some(x => x.path === 'act_1234567/adsets'), "guruh yaratilmadi");
  assert.ok(!mine.some(x => x.params.status === 'ACTIVE' && /^c\d+$/.test(x.path)), 'yoqilmadi');
  assert.equal(adsStore.campaign(biz.id, id)?.status, 'failed');
});

await check("reklama bosqichida xato — Meta xabari egasiga, kampaniya o'chiriladi", async () => {
  const c2 = await propose(biz, 'x', plan() as never);
  fake.failAds = true;
  await rejects(launch(biz, c2.id), /Reklama matni qoidaga zid/);
  fake.failAds = false;
  assert.equal(adsStore.campaign(biz.id, c2.id)?.status, 'failed');
  assert.ok(calls.at(-1)?.method === 'DELETE');
});

let liveId = '';
await check("muvaffaqiyatli ishga tushish: rasm → kampaniya (pauza) → byudjet tekshiruvi → guruh → kreativ → reklama → oxirida YOQISH", async () => {
  const c3 = await propose(biz, 'x', plan() as never);
  liveId = c3.id;
  const before = calls.length;
  await rejects(launch(biz, c3.id, { mark: 'eskikarta' }), /o'zgargan/);
  const done = await launch(biz, c3.id, { mark: planMark(adsStore.campaign(biz.id, c3.id)!.plan) });
  assert.equal(done.status, 'active');
  const order = calls.slice(before).filter(x => x.method !== 'GET' || /^c\d+$/.test(x.path)).map(x => `${x.method} ${x.path.replace(/^c\d+$/, 'C')}${x.params.status ? `:${x.params.status}` : ''}`);
  assert.deepEqual(order, ['POST act_1234567/adimages', 'POST act_1234567/campaigns:PAUSED', 'GET C', 'POST act_1234567/adsets:ACTIVE', 'POST act_1234567/adcreatives', 'POST act_1234567/ads:ACTIVE', 'POST C:ACTIVE']);
  await rejects(launch(biz, c3.id), /Allaqachon/);
});

await check("kuzatuv: sarf va yozishmalar yangilanadi; kunlik limitga yetsa — to'xtatiladi", async () => {
  await watch(biz);
  const c = adsStore.campaign(biz.id, liveId)!;
  assert.equal(c.spent, 12.5);
  assert.equal(c.results, 4);
  assert.equal(c.status, 'active');
  fake.today = '21';
  await watch(biz);
  assert.equal(adsStore.campaign(biz.id, liveId)?.status, 'paused');
  assert.match(adsStore.campaign(biz.id, liveId)?.stopReason ?? '', /Limit/);
});

await check("yoqish so'rovi yiqilsa — pauza va o'chirish, holat «yaratilmadi»; tozalab ham bo'lmasa — kuzatuvda qoladi, egasiga aytiladi", async () => {
  fake.today = '0';
  adsStore.saveLimits(biz.id, { perCampaign: 100, daily: 100, monthly: 1000 });
  const a = await propose(biz, 'x', plan({ budget: 20, days: 5 }) as never);
  fake.failActivate = true;
  await rejects(launch(biz, a.id), /Ishga tushmadi/);
  assert.equal(adsStore.campaign(biz.id, a.id)?.status, 'failed');
  const b = await propose(biz, 'x', plan({ budget: 20, days: 5 }) as never);
  fake.failCleanup = true;
  const tracked = await launch(biz, b.id);
  fake.failActivate = false; fake.failCleanup = false;
  assert.equal(tracked.status, 'active', 'kuzatuvdan chiqmaydi');
  assert.match(tracked.stopReason ?? '', /tekshiring/);
  await pause(biz, b.id);
});

await check("bir vaqtda ikki kampaniya ishga tushirilmaydi (bir-birining limitini ko'rmay o'tib ketmasin)", async () => {
  const a = await propose(biz, 'x', plan({ budget: 20, days: 5 }) as never);
  const b = await propose(biz, 'x', plan({ budget: 20, days: 5 }) as never);
  const [ra, rb] = await Promise.allSettled([launch(biz, a.id), launch(biz, b.id)]);
  assert.equal(ra.status, 'fulfilled');
  assert.equal(rb.status, 'rejected');
  assert.match(String((rb as PromiseRejectedResult).reason?.message), /hozir ishga tushirilmoqda/);
  await pause(biz, a.id);
  adsStore.saveLimits(biz.id, LIMITS);
});

await check("limit tugaganda davom ettirib bo'lmaydi; limit bo'shagach — bo'ladi; ishlayotganini bekor qilib bo'lmaydi", async () => {
  fake.today = '21';
  await rejects(resume(biz, liveId), /Bugungi limit/);
  fake.today = '3';
  assert.equal((await resume(biz, liveId)).status, 'active');
  assert.throws(() => cancel(biz, liveId), /to'xtating/);
  assert.equal((await pause(biz, liveId)).status, 'paused');
});

await check("limit olib tashlansa (0) — ishlayotganlar to'xtatiladi; kuzatuvdagi kampaniya bor paytda kabinetni uzib bo'lmaydi", async () => {
  fake.today = '0';
  assert.equal((await resume(biz, liveId)).status, 'active');
  assert.throws(() => disconnect(biz), /tugating/);
  adsStore.saveLimits(biz.id, { perCampaign: 100, daily: 0, monthly: 0 });
  await watch(biz);
  assert.equal(adsStore.campaign(biz.id, liveId)?.status, 'paused');
  assert.match(adsStore.campaign(biz.id, liveId)?.stopReason ?? '', /olib tashlandi/);
});

await check("video reklama (Kontent-meyker videosi): avval muqova va video yuklanadi, Meta tayyorlaguncha kutiladi, kreativ — video_data; keyin kampaniya", async () => {
  const { videoStore, videoDir } = await import('../server/content/video');
  const { imagePath, videoFile } = await import('../server/ads/campaigns');
  const b2 = businesses.create(`targetv${Date.now()}`, 'x', { name: 'Video', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
  await connect(b2, { token: 'tok-1', adAccountId: '1234567', pageId: '7770001', igActorId: '8880001' });
  adsStore.saveLimits(b2.id, LIMITS);
  const v = videoStore.add(b2.id, 'Implant — 30 soniyada', [{ kind: 'hook', text: 'Implant', voice: 'Implant' }]);
  mkdirSync(videoDir(), { recursive: true });
  writeFileSync(join(videoDir(), `${v.id}.mp4`), Buffer.alloc(4096, 1));
  writeFileSync(join(videoDir(), `${v.id}.mp4.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.ok(imagePath(`video:${v.id}`, b2.id)?.endsWith('.mp4.jpg'), 'muqova — reklama rasmi o\'rnida');
  assert.ok(videoFile(`video:${v.id}`, b2.id)?.endsWith('.mp4'));
  assert.equal(videoFile(`video:${v.id}`, biz.id), null, "boshqa biznes videosi olinmaydi");
  const c = await propose(b2, 'x', plan({ ads: [{ text: 'Implant — bepul konsultatsiya, 3D tomografiya bilan.', headline: null, image: `video:${v.id}` }] }) as never);
  const before = calls.length;
  const done = await launch(b2, c.id);
  assert.equal(done.status, 'active');
  const order = calls.slice(before).filter(x => x.method !== 'GET' || /^c\d+$|^v77$/.test(x.path)).map(x => `${x.method} ${x.path.replace(/^c\d+$/, 'C')}${x.params.status ? `:${x.params.status}` : ''}`);
  assert.deepEqual(order, ['POST act_1234567/adimages', 'POST act_1234567/advideos', 'GET v77', 'GET v77', 'POST act_1234567/campaigns:PAUSED', 'GET C', 'POST act_1234567/adsets:ACTIVE', 'POST act_1234567/adcreatives', 'POST act_1234567/ads:ACTIVE', 'POST C:ACTIVE']);
  assert.equal(fake.videoBytes, 4096, 'mp4 to\'liq yuklandi');
  const creative = JSON.parse(calls.find((x, i) => i >= before && x.path === 'act_1234567/adcreatives')!.params.object_story_spec) as { video_data: { video_id: string } };
  assert.equal(creative.video_data.video_id, 'v77');
});

server.close();
console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
