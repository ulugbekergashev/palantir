/**
 * Rasmiy Instagram sinovi — Cerebro Hub (haqiqiy jarayon) + Cerebro server + soxta Meta (instagram.com OAuth va graph.instagram.com):
 *   sof qoidalar: 24 soat / 7 kun (Human Agent), 1000 baytdan uzun javob bo'laklarga, hub kodi;
 *   yo'l: hub klinika kodini beradi → kod kalit sifatida → «Instagram'ni rasmiy ulash» → Instagram'da ruxsat → hub kodni tokenga
 *   almashtiradi (ilova siri faqat hubda) → token klinikaga navbat orqali → obuna (subscribed_apps) → Meta webhook (imzo tekshiriladi)
 *   → mijoz yozdi (ismi profilidan) → javob taklifi egasiga, so'rov qabulxonaga → «Yuborish» → graph /me/messages → aks-sado tashlanadi,
 *   egasining telefondan yozgani yozishmaga → bir xabar ikki marta kelsa bir marta → 24 soatdan keyin yozilmaydi → uzish.
 * Ishga tushirish: npm run test:instagram
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeHubCode, parseHubCode } from '../src/lib/hubCode';
import { splitForInstagram, windowRule } from '../server/inbox/igRules';
import { OWNER, ai, aiServer, json, listen, press, readBody, say, sent, sleep, tgServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const STAFF = 6003;
const APP_SECRET = 'meta-app-secret-test';
const IG_ACCOUNT = '17841400000000001';

console.log('\n# Qoidalar (sof)');
const now = Date.parse('2026-10-18T12:00:00Z');
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
ok('24 soat ichida — yozsa bo\'ladi; 30 soat — yo\'q; Human Agent bilan 30 soat — teg bilan; 8 kun — hech qanday', windowRule(ago(23), now, false) === 'open' && windowRule(ago(30), now, false) === 'closed'
  && windowRule(ago(30), now, true) === 'human_agent' && windowRule(ago(24 * 8), now, true) === 'closed' && windowRule(null, now, true) === 'closed');
const long = `${"Assalomu alaykum! Implant narxi 5 000 000 so'mdan boshlanadi. ".repeat(30)}https://example.com/${'x'.repeat(1200)}`;
const parts = splitForInstagram(long);
ok("1000 baytdan uzun javob — bo'laklarga, har biri ≤ 1000 bayt, matn yo'qolmaydi", parts.length >= 3 && parts.every(p => Buffer.byteLength(p) <= 1000) && parts.join('').replace(/\s/g, '').length === long.replace(/\s/g, '').length);
ok("o'zbekcha harflar va emoji bo'linmaydi", splitForInstagram("O'zbekiston 😀 ".repeat(120)).every(p => !p.includes('�') && Buffer.byteLength(p) <= 1000));
const code = makeHubCode('https://hub.example.uz/', 'a1b2c3d4e5', 'S'.repeat(32));
ok('hub kodi: manzil va kalit bitta qatorda; buzuq kod — rad', parseHubCode(code)?.url === 'https://hub.example.uz' && parseHubCode(code)?.key === `a1b2c3d4e5.${'S'.repeat(32)}` && parseHubCode('chub.xx.yy') === null && parseHubCode(`${code}x.y`) === null);

// ─── Soxta Meta ───────────────────────────────────────────────────────────────
const meta = { authorize: [] as URLSearchParams[], tokenForms: [] as URLSearchParams[], subscribed: [] as string[], sentMsgs: [] as { auth: string; body: Record<string, any> }[], refreshed: 0 };
let msgSeq = 0;
const metaServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://meta');
  const auth = String(req.headers.authorization ?? '');
  if (url.pathname === '/oauth/authorize') {
    meta.authorize.push(url.searchParams);
    // Egasi kirdi va «Ruxsat berish»ni bosdi
    res.statusCode = 302;
    res.setHeader('location', `${url.searchParams.get('redirect_uri')}?code=CODE-1&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}#_`);
    return res.end();
  }
  if (url.pathname === '/oauth/access_token' && req.method === 'POST') {
    const form = new URLSearchParams((await readBody(req)).toString());
    meta.tokenForms.push(form);
    if (form.get('client_secret') !== APP_SECRET || form.get('code') !== 'CODE-1') return json(res, { error_message: 'bad code' }, 400);
    return json(res, { data: [{ access_token: 'SHORT-1', user_id: '111', permissions: 'instagram_business_basic,instagram_business_manage_messages' }] });
  }
  if (url.pathname === '/access_token') return url.searchParams.get('access_token') === 'SHORT-1' ? json(res, { access_token: 'LONG-1', token_type: 'bearer', expires_in: 5_183_944 }) : json(res, { error: { message: 'bad token' } }, 400);
  if (url.pathname === '/refresh_access_token') { meta.refreshed++; return json(res, { access_token: 'LONG-2', token_type: 'bearer', expires_in: 5_183_944 }); }
  if (!auth.startsWith('Bearer LONG-')) return json(res, { error: { message: 'Invalid OAuth access token', code: 190 } }, 401);
  if (url.pathname === '/v25.0/me') return json(res, { user_id: IG_ACCOUNT, username: 'shifo_dent', id: '111' });
  if (url.pathname === '/v25.0/me/subscribed_apps' && req.method === 'POST') { meta.subscribed.push(String(url.searchParams.get('subscribed_fields'))); return json(res, { success: true }); }
  if (url.pathname === '/v25.0/me/messages' && req.method === 'POST') {
    meta.sentMsgs.push({ auth, body: JSON.parse((await readBody(req)).toString()) });
    return json(res, { recipient_id: 'IGSID-1', message_id: `m_out_${++msgSeq}` });
  }
  if (url.pathname === '/v25.0/IGSID-1') return json(res, { name: 'Malika Yusupova', username: 'malika_y' });
  json(res, { error: { message: 'not found' } }, 404);
});

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), metaPort = await listen(metaServer);
const META = `http://127.0.0.1:${metaPort}`;
const work = fs.mkdtempSync(path.join(tmpdir(), 'cerebro-ig-'));
const HUB_PORT = 3410, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3296, base = `http://127.0.0.1:${PORT}`;
const procs: ChildProcess[] = [];
let log = '';
const start = (script: string, env: Record<string, string>) => {
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  procs.push(p);
  return p;
};
const up = async (url: string) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string }[][] })?.inline_keyboard ?? []).flat();
const webhook = (body: unknown, secret = APP_SECRET) => {
  const raw = JSON.stringify(body);
  return fetch(`${HUB}/ig/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
};
const dm = (mid: string, text: string, extra: Record<string, unknown> = {}, from = 'IGSID-1', toId = IG_ACCOUNT) =>
  ({ object: 'instagram', entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: toId }, timestamp: Date.now(), message: { mid, text, ...extra } }] }] });

try {
  start('hub/server.ts', {
    PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), IG_APP_ID: '9990001', IG_APP_SECRET: APP_SECRET, HUB_PUBLIC_URL: HUB, HUB_VERIFY_TOKEN: 'verify-me', HUB_ADMIN_KEY: 'hub-admin-1',
    IG_AUTH_URL: `${META}/oauth/authorize`, IG_TOKEN_URL: `${META}/oauth/access_token`, IG_GRAPH_URL: META,
  });
  ok('hub ishga tushdi, Meta ilovasi sozlangan', await up(`${HUB}/health`) && (await (await fetch(`${HUB}/health`)).json()).instagram === true);

  console.log('\n# Hub: klinika kodi va webhook tasdig\'i');
  ok("admin kalitsiz klinika ochilmaydi", (await fetch(`${HUB}/admin/clinics`, { method: 'POST', body: '{}' })).status === 401);
  const clinic = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: { authorization: 'Bearer hub-admin-1' }, body: JSON.stringify({ name: 'Shifo Dent' }) })).json() as { code: string };
  ok('klinika kodi: «chub.» va hub manzili ichida', clinic.code.startsWith('chub.') && parseHubCode(clinic.code)?.url === HUB);
  const verify = await fetch(`${HUB}/ig/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242`);
  ok("Meta webhook tasdig'i: challenge qaytdi; noto'g'ri token — 403", (await verify.text()) === '4242' && (await fetch(`${HUB}/ig/webhook?hub.mode=subscribe&hub.verify_token=xato&hub.challenge=1`)).status === 403);

  start('server/index.ts', {
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'ig-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0', INBOX_DEBOUNCE_MS: '300',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    CEREBRO_HUB: clinic.code, IG_GRAPH_URL: META,
  });
  ok('Cerebro ishga tushdi', await up(`${base}/api/health`));
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => to(OWNER, mark, 'Shifo Dent'));
  const team = (await api('/api/staff', { token, body: { name: 'Aziza' } })).json;
  say(STAFF, `/start ${String(team.staff[0].link).split('start=')[1]}`);
  await waitFor('xodim', () => to(STAFF, mark, 'ulandingiz'));
  ok("panel: hub kodi tanildi (kalitlar ro'yxatida), rasmiy Instagram hali ulanmagan", me.status.instagramApi?.hub === true && !me.status.instagramApi.account);

  console.log("\n# Instagram'ni rasmiy ulash (OAuth)");
  mark = sent.length;
  const link = (await api('/api/instagram/official', { token, body: {} })).json.url as string;
  const q = new URL(link).searchParams;
  ok("kirish havolasi: Instagram'ga, ilova id, qaytish manzili — hub, ruxsatlar, imzolangan holat", link.startsWith(`${META}/oauth/authorize`) && q.get('client_id') === '9990001' && q.get('redirect_uri') === `${HUB}/ig/callback`
    && q.get('scope') === 'instagram_business_basic,instagram_business_manage_messages' && (q.get('state') ?? '').includes('.'));
  const toCallback = await fetch(link, { redirect: 'manual' });
  const page = await fetch(String(toCallback.headers.get('location')).replace(/#_$/, ''));
  ok('egasi ruxsat berdi → hub sahifasi «Instagram ulandi @shifo_dent»', (await page.text()).includes('shifo_dent'));
  ok("kod tokenga hubda almashtirildi (ilova siri bilan), Cerebro sirni bilmaydi", meta.tokenForms[0]?.get('client_secret') === APP_SECRET && !log.includes(APP_SECRET));
  const connected = await (async () => { for (let i = 0; i < 40; i++) { const s = (await api('/api/me', { token })).json.status.instagramApi; if (s?.account) return s; await sleep(250); } return null; })();
  ok('Cerebro tokenni hubdan oldi: @shifo_dent, 60 kunlik', connected?.account === '@shifo_dent' && Date.parse(connected.expiresAt) > Date.now() + 50 * 86_400_000, JSON.stringify(connected));
  ok("akkaunt xabarlarga obuna qilindi (subscribed_apps=messages)", await waitFor('obuna', () => meta.subscribed.includes('messages')));
  ok('egasiga: «rasmiy ulandi»', await waitFor('egasiga', () => to(OWNER, mark, 'rasmiy ulandi')));
  const forged = await fetch(`${HUB}/ig/callback?code=CODE-1&state=${encodeURIComponent('eyJjIjoiYSJ9.soxta')}`);
  ok("soxta holat bilan callback — rad (begona klinika nomidan ulanmaydi)", forged.status === 400);

  console.log('\n# Mijoz Direct\'ga yozdi → javob → so\'rov');
  ok("imzosiz webhook — rad", (await webhook(dm('m0', 'soxta'), 'boshqa-sir')).status === 401);
  ai.customer = () => ({
    action: 'reply', reply: "Albatta, administratorimiz sizga qo'ng'iroq qiladi.", question: '', note_for_owner: '', lead_note: "Implant narxini so'radi",
    customer_name: '', customer_phone: '', follow_up: '', follow_up_days: 0,
    request_kind: 'callback', request_phone: '90 777 88 99', request_when: '', request_due: '', request_summary: "Qo'ng'iroq qilib implant narxini aytish",
  });
  mark = sent.length;
  ok('webhook qabul qilindi', (await webhook(dm('m1', "Assalomu alaykum, implant qancha? Qo'ng'iroq qiling: 90 777 88 99"))).status === 200);
  const card = await waitFor('egasiga karta', () => to(OWNER, mark, 'Javob taklifi'), 15_000);
  ok("egasiga javob taklifi: ism Instagram profilidan, kanal Instagram", textOf(card).includes('Malika Yusupova') && textOf(card).includes('Instagram'), textOf(card).slice(0, 200));
  ok("qabulxonaga so'rov: «Qo'ng'iroq qilish · Instagram», raqam", await waitFor('so\'rov', () => to(STAFF, mark, "Qo'ng'iroq qilish</b> · Instagram") && to(STAFF, mark, '+998 90 777 88 99')));
  await webhook(dm('m1', "Assalomu alaykum, implant qancha? Qo'ng'iroq qiling: 90 777 88 99"));
  await sleep(1500);
  const lead = (await api('/api/leads', { token })).json.leads[0];
  const thread = (await api(`/api/inbox/${lead?.id}`, { token })).json;
  ok("Meta bir xabarni ikki marta yuborsa — bir marta yozildi", thread.messages?.filter((m: { direction: string }) => m.direction === 'in').length === 1);
  ok("mijoz kartasi: Instagram, yozsa bo'ladi, raqami so'rovdan", lead?.channel === 'instagram' && lead.reachable && lead.phone === '+998907778899', JSON.stringify(lead).slice(0, 200));
  mark = sent.length;
  press(OWNER, buttons(card).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, card!.id!);
  await waitFor('yuborildi', () => meta.sentMsgs.length > 0);
  const out = meta.sentMsgs[0];
  ok("«Yuborish» → graph /me/messages: mijozning IGSID'siga, klinika tokeni bilan, tegsiz (24 soat ichida)", out?.body.recipient?.id === 'IGSID-1' && out.body.message?.text?.includes('administratorimiz') && out.auth === 'Bearer LONG-1' && !out.body.tag);

  console.log('\n# Aks-sado va egasining telefondan yozgani');
  await webhook(dm('m_out_1', String(out?.body.message?.text), { is_echo: true }, IG_ACCOUNT, 'IGSID-1'));
  await webhook(dm('m_own', "Ertaga soat 11 da kuting", { is_echo: true }, IG_ACCOUNT, 'IGSID-1'));
  await sleep(1500);
  const msgs = (await api(`/api/inbox/${lead.id}`, { token })).json.messages as { direction: string; by: string; text: string }[];
  ok("o'zimiz yuborgan javob ikki marta yozilmadi; egasining telefondan yozgani — «egasi» bo'lib yozishmada", msgs.filter(m => m.text.includes('administratorimiz')).length === 1 && msgs.some(m => m.by === 'owner' && m.text.includes('soat 11')));

  console.log('\n# 24 soatdan keyin');
  const db = new DatabaseSync(path.join(work, 'data', 'cerebro.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE leads SET last_inbound_at = ? WHERE id = ?').run(new Date(Date.now() - 30 * 3_600_000).toISOString(), lead.id);
  db.close();
  const before = meta.sentMsgs.length;
  const late = await api(`/api/inbox/${lead.id}/send`, { token, body: { text: 'Assalomu alaykum, natija tayyor' } });
  ok("30 soatdan keyin yozilmaydi: tushunarli sabab, Instagram'ga so'rov ketmadi", late.status >= 400 && String(late.json.error).includes('24 soat') && meta.sentMsgs.length === before, String(late.json.error));

  console.log('\n# Uzish');
  await api('/api/instagram/official', { method: 'DELETE', token });
  mark = sent.length;
  await webhook(dm('m9', 'Yana savol bor'));
  await sleep(2000);
  ok("uzilgach: panelda ulanmagan, hub bu akkauntning xabarini endi yubormaydi", !(await api('/api/me', { token })).json.status.instagramApi.account && !to(OWNER, mark, 'Yana savol'));
  ok('serverda kutilmagan xato yo\'q', !/TypeError|ReferenceError|SyntaxError/.test(log), log.match(/.*(TypeError|ReferenceError).*/)?.[0]);
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  for (const p of procs) p.kill();
  await sleep(700);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl band */ }
  const failed = results.filter(r => !r).length;
  if (failed) console.log(`\n--- jurnal (oxiri) ---\n${log.slice(-3000)}`);
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
  process.exit(failed ? 1 : 0);
}
