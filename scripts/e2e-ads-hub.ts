/**
 * Reklama kabinetini Facebook orqali ulash sinovi — Palantir Hub (haqiqiy jarayon) + Palantir server + soxta Facebook (dialog/oauth,
 * oauth/access_token va Marketing API):
 *   havola: Hub imzolaydi, qaytish /ads/callback, ruxsatlarda ads_mcp_management; imzosi buzilgan holat — rad;
 *   bir nechta kabinet → panelda tanlash (token chiqmaydi), ro'yxatda yo'q kabinet — rad, tanlangani ulanadi (60 kunlik muddat, Instagram
 *   sahifadan); qayta kirish → o'sha kabinet o'zi qayta ulanadi (yangi token); bitta kabinet va sahifa → o'zi ulanadi;
 *   muddat yaqin — kanallar nazorati muammo deydi.
 * Ishga tushirish: npm run test:ads-hub
 */
process.env.TZ = 'Asia/Tashkent';
import './isolate';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OWNER, aiServer, json, listen, say, sent, sleep, tgServer, waitFor, type Sent, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const APP_SECRET = 'fb-app-secret-test';
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-adshub-'));

// ─── Sof qoidalar ─────────────────────────────────────────────────────────────
const { autoPick, adsTokenProblem } = await import('../server/ads/hubConnect');
const { adsStore } = await import('../server/ads/store');
console.log('\n# Qoidalar (sof)');
const A = (id: string, active = true) => ({ id, name: `K${id}`, currency: 'USD', active });
const P = (id: string, igId: string | null = null) => ({ id, name: `S${id}`, igId, igName: igId ? 'klinika' : null });
ok('bitta faol kabinet va bitta sahifa — o‘zi tanlanadi (Instagram sahifadan)', JSON.stringify(autoPick(null, { accounts: [A('11111'), A('22222', false)], pages: [P('33333', '17841')] })) === JSON.stringify({ adAccountId: '11111', pageId: '33333', igActorId: '17841' }));
ok('ikki faol kabinet yoki ikki sahifa — egasi tanlaydi', autoPick(null, { accounts: [A('11111'), A('22222')], pages: [P('33333')] }) === null && autoPick(null, { accounts: [A('11111')], pages: [P('33333'), P('44444')] }) === null);
ok('ulangan kabinet ro‘yxatda yo‘q, boshqa bitta bor — o‘zi almashmaydi (egasi tanlaydi)', autoPick({ adAccountId: '22222', pageId: '44444', igActorId: null }, { accounts: [A('11111')], pages: [P('33333')] }) === null);
ok('avval ulangan kabinet ro‘yxatda — o‘sha (qayta kirish), faol bo‘lmasa — yo‘q', autoPick({ adAccountId: '22222', pageId: '44444', igActorId: null }, { accounts: [A('11111'), A('22222')], pages: [P('33333'), P('44444', '178')] })?.igActorId === '178'
  && autoPick({ adAccountId: '22222', pageId: '44444', igActorId: null }, { accounts: [A('11111'), A('22222', false)], pages: [P('33333'), P('44444')] }) === null);
const base = { token: 'x'.repeat(30), adAccountId: '11111', accountName: 'K', currency: 'USD', timezone: '', pageId: '33333', pageName: 'S', igActorId: null };
const now = Date.parse('2026-11-21T08:00:00Z');
adsStore.saveConnection('bizunit1', { ...base, expiresAt: new Date(now + 30 * 86_400_000).toISOString() });
adsStore.saveConnection('bizunit2', { ...base, expiresAt: new Date(now + 3 * 86_400_000).toISOString() });
adsStore.saveConnection('bizunit3', { ...base, expiresAt: null });
adsStore.saveConnection('bizunit4', { ...base, expiresAt: new Date(now - 1000).toISOString() });
ok('muddat: 30 kun — jim; 3 kun — ogohlantiradi; muddatsiz — jim; tugagan — «tugadi»', adsTokenProblem('bizunit1', now) === null && /tugaydi/.test(adsTokenProblem('bizunit2', now) ?? '')
  && adsTokenProblem('bizunit3', now) === null && /tugadi/.test(adsTokenProblem('bizunit4', now) ?? ''));

// ─── Soxta Facebook ──────────────────────────────────────────────────────────
type World = { accounts: { account_id: string; name: string; currency: string; account_status: number }[]; pages: { id: string; name: string; instagram_business_account?: { id: string; username: string } }[] };
const fb = { dialogs: [] as URLSearchParams[], codes: 0, long: 'FB-LONG-1-EAAG0000000000000000000000', world: null as World | null, tokensSeen: new Set<string>() };
const fbServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fb');
  const q = url.searchParams;
  if (url.pathname === '/dialog/oauth') {
    fb.dialogs.push(q);
    res.statusCode = 302;
    res.setHeader('location', `${q.get('redirect_uri')}?code=FB-CODE-${++fb.codes}&state=${encodeURIComponent(q.get('state') ?? '')}#_`);
    return res.end();
  }
  if (url.pathname === '/v26.0/oauth/access_token') {
    if (q.get('client_secret') !== APP_SECRET) return json(res, { error: { message: 'bad secret' } }, 400);
    if (q.get('grant_type') === 'fb_exchange_token') return q.get('fb_exchange_token') === 'FB-SHORT' ? json(res, { access_token: fb.long, token_type: 'bearer', expires_in: 5_183_944 }) : json(res, { error: { message: 'bad token' } }, 400);
    return /^FB-CODE-\d+$/.test(q.get('code') ?? '') && q.get('redirect_uri')?.endsWith('/ads/callback') ? json(res, { access_token: 'FB-SHORT', token_type: 'bearer', expires_in: 5400 }) : json(res, { error: { message: 'bad code' } }, 400);
  }
  const token = q.get('access_token') ?? '';
  if (!token.startsWith('FB-LONG-')) return json(res, { error: { message: 'Invalid OAuth access token', code: 190 } }, 401);
  fb.tokensSeen.add(token);
  const w = fb.world!;
  if (url.pathname === '/v26.0/me/adaccounts') return json(res, { data: w.accounts.map(a => ({ ...a, id: `act_${a.account_id}` })) });
  if (url.pathname === '/v26.0/me/accounts') return json(res, { data: w.pages });
  const act = url.pathname.match(/^\/v26\.0\/act_(\d+)$/);
  if (act) { const a = w.accounts.find(x => x.account_id === act[1]); return a ? json(res, { name: a.name, currency: a.currency, account_status: a.account_status, timezone_name: 'Asia/Tashkent' }) : json(res, { error: { message: 'no account' } }, 404); }
  if (/^\/v26\.0\/act_\d+\/insights$/.test(url.pathname)) return json(res, { data: [{ spend: '0' }] });
  const page = w.pages.find(p => url.pathname === `/v26.0/${p.id}`);
  if (page) return json(res, { name: page.name });
  json(res, { error: { message: 'not found' } }, 404);
});

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), fbPort = await listen(fbServer);
const FB = `http://127.0.0.1:${fbPort}`;
const HUB_PORT = 3417, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3302, home = `http://127.0.0.1:${PORT}`;
const ADMIN = 'hub-admin-sinov-kaliti-0123456789';
const procs: ChildProcess[] = [];
let log = '';
const start = (script: string, env: Record<string, string>) => {
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', script], { env: { ...process.env, DOTENV: '0', ASTERISK_WSL: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  procs.push(p);
};
const up = async (url: string) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(home + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && textOf(s).includes(needle));
/** Egasi havolani ochdi va Facebook'da ruxsat berdi: Hub sahifasi */
const fbLinkOf = (html: string) => (html.match(/href="([^"]+)"/)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const consent = async (link: string) => { const start = await (await fetch(link)).text(); const r = await fetch(fbLinkOf(start)); return { status: r.status, html: await r.text(), start }; };

try {
  start('hub/server.ts', {
    PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_VERIFY_TOKEN: 'verify-me', HUB_ADMIN_KEY: ADMIN,
    FB_APP_ID: '5550001', FB_APP_SECRET: APP_SECRET, FB_AUTH_URL: `${FB}/dialog/oauth`, FB_GRAPH_URL: `${FB}/v26.0`, IG_APP_ID: '', IG_APP_SECRET: '',
  });
  ok('hub ishga tushdi, reklama ilovasi sozlangan', await up(`${HUB}/health`) && (await (await fetch(`${HUB}/health`)).json()).ads === true);
  const clinic = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ name: 'Shifo Dent' }) })).json() as { code: string };

  start('server/index.ts', {
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'ads-hub-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    PALANTIR_HUB: clinic.code, META_GRAPH_BASE: FB, META_ADS_MCP: '0',
  });
  ok('Palantir ishga tushdi', await up(`${home}/api/health`));
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => to(mark, 'Shifo Dent'));

  console.log('\n# Havola');
  let view = (await api('/api/ads', { token })).json;
  ok('panel: Hub bor, kabinet ulanmagan, tanlash yo‘q', view.hub === true && view.account === null && view.pending === null);
  ok('kirishsiz havola berilmaydi', (await api('/api/ads/hub-url', { body: {} })).status === 401);
  const link = (await api('/api/ads/hub-url', { token, body: {} })).json.url as string;
  ok('havola — Hub sahifasi; unda klinika nomi va Facebook tugmasi', link.startsWith(`${HUB}/ads/start?`));
  const startHtml = await (await fetch(link)).text();
  const lq = new URL(fbLinkOf(startHtml)).searchParams;
  ok('sahifada: «Shifo Dent» va «bu sizning klinikangiz bo‘lmasa — yoping»', /Shifo Dent/.test(startHtml) && /klinikangiz bo'lmasa/.test(startHtml));
  ok('Facebook havolasi: Meta ilovasi, qaytish /ads/callback, ruxsatlarda ads_mcp_management va ads_management, holat imzolangan', lq.get('client_id') === '5550001' && lq.get('redirect_uri') === `${HUB}/ads/callback`
    && /ads_mcp_management/.test(lq.get('scope') ?? '') && /ads_management/.test(lq.get('scope') ?? '') && (lq.get('state') ?? '').includes('.'));
  ok('buzuq holat bilan boshlash sahifasi ochilmaydi', (await fetch(`${HUB}/ads/start?state=xx.yy`)).status === 400);
  const forged = `${(lq.get('state') ?? '').split('.')[0]}.AAAA`;
  ok('imzosi buzilgan holat — «Havola eskirgan»', (await fetch(`${HUB}/ads/callback?code=FB-CODE-9&state=${encodeURIComponent(forged)}`)).status === 400);
  ok('ruxsat berilmadi — «Ulanmadi», token yo‘q', /Ruxsat berilmadi/.test(await (await fetch(`${HUB}/ads/callback?error=access_denied&state=${encodeURIComponent(lq.get('state') ?? '')}`)).text()));

  console.log('\n# Ikki kabinet — egasi tanlaydi');
  fb.world = {
    accounts: [{ account_id: '10001', name: 'Xatna', currency: 'USD', account_status: 1 }, { account_id: '10002', name: 'Eski', currency: 'USD', account_status: 2 }, { account_id: '10003', name: 'Implant', currency: 'USD', account_status: 1 }],
    pages: [{ id: '20001', name: 'Shifo Dent', instagram_business_account: { id: '17841000001', username: 'shifo_dent' } }, { id: '20002', name: 'Shifo Kids' }],
  };
  mark = sent.length;
  const page1 = await consent(link);
  ok('Facebook ruxsati → Hub sahifasi «Facebook ulandi»', page1.status === 200 && /Facebook ulandi/.test(page1.html));
  ok('o‘sha havola ikkinchi marta — «ishlatilgan», token berilmaydi', /ishlatilgan/.test(await (await fetch(fbLinkOf(page1.start))).text()));
  ok('egasiga: tanlang (3 kabinet, 2 sahifa)', !!(await waitFor('tanlash xabari', () => to(mark, 'tanlang'))));
  view = (await api('/api/ads', { token })).json;
  ok('panel: tanlash ro‘yxati, token chiqmaydi', view.pending?.accounts.length === 3 && view.pending.pages.length === 2 && view.pending.accounts.find((a: any) => a.id === '10002')?.active === false && !JSON.stringify(view).includes('FB-LONG'));
  ok('ro‘yxatda yo‘q kabinet — rad', (await api('/api/ads/connect-hub', { token, body: { adAccountId: '99999', pageId: '20001' } })).status === 409);
  const picked = await api('/api/ads/connect-hub', { token, body: { adAccountId: 'act_10003', pageId: '20001', igActorId: '17841000001' } });
  const days = (Date.parse(picked.json.account?.expiresAt ?? '') - Date.now()) / 86_400_000;
  ok('tanlangan kabinet ulandi: Implant, sahifa, Instagram, muddat ~60 kun; tanlash yopildi', picked.status === 200 && picked.json.account?.adAccountId === '10003' && picked.json.account.pageName === 'Shifo Dent'
    && picked.json.account.igActorId === '17841000001' && days > 59 && days < 61 && picked.json.pending === null, `${picked.status} ${JSON.stringify(picked.json).slice(0, 200)}`);
  ok('tanlash ikkinchi marta — «eskirgan»', (await api('/api/ads/connect-hub', { token, body: { adAccountId: '10001', pageId: '20001' } })).status === 409);

  console.log('\n# Qayta kirish — o‘zi qayta ulanadi');
  fb.long = 'FB-LONG-2-EAAG0000000000000000000000';
  fb.tokensSeen.clear();
  mark = sent.length;
  await consent((await api('/api/ads/hub-url', { token, body: {} })).json.url);
  ok('egasiga: «qayta ulandi» — o‘sha kabinet', !!(await waitFor('qayta ulandi', () => to(mark, 'qayta ulandi'))) && !!to(mark, 'Implant'));
  view = (await api('/api/ads', { token })).json;
  ok('panel: o‘sha kabinet, yangi token ishlatiladi (sarf so‘rovi)', view.account?.adAccountId === '10003' && view.pending === null && fb.tokensSeen.has('FB-LONG-2-EAAG0000000000000000000000'));

  console.log('\n# Bitta kabinet — o‘zi ulanadi');
  ok('uzildi', (await api('/api/ads/connect', { token, method: 'DELETE' })).json.account === null);
  fb.world = { accounts: [{ account_id: '10001', name: 'Xatna', currency: 'USD', account_status: 1 }], pages: [{ id: '20001', name: 'Shifo Dent', instagram_business_account: { id: '17841000001', username: 'shifo_dent' } }] };
  mark = sent.length;
  await consent((await api('/api/ads/hub-url', { token, body: {} })).json.url);
  ok('egasiga: ulandi + limitlarni qo‘ying', !!(await waitFor('ulandi', () => to(mark, 'limitlarni'))));
  view = (await api('/api/ads', { token })).json;
  ok('panel: Xatna, Instagram sahifadan', view.account?.adAccountId === '10001' && view.account.igActorId === '17841000001');

  console.log('\n# Kabinet yo‘q');
  await api('/api/ads/connect', { token, method: 'DELETE' });
  fb.world = { accounts: [], pages: [{ id: '20001', name: 'Shifo Dent' }] };
  mark = sent.length;
  await consent((await api('/api/ads/hub-url', { token, body: {} })).json.url);
  ok('egasiga: kabinet tanlanmagan — qayta bosing', !!(await waitFor('kabinet yo‘q', () => to(mark, 'reklama kabineti tanlanmagan'))) && (await api('/api/ads', { token })).json.account === null);
  ok('serverda kutilmagan xato yo‘q', !/TypeError|ReferenceError|SyntaxError/.test(log), log.match(/.*(TypeError|ReferenceError).*/)?.[0]);
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await Promise.all(procs.map(p => stopProcess(p)));
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl band */ }
  const failed = results.filter(r => !r).length;
  if (failed) console.log(`\n--- jurnal (oxiri) ---\n${log.slice(-3000)}`);
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
  process.exit(failed ? 1 : 0);
}
