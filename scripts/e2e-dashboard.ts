/**
 * Boshqaruv paneli sinovi — bazaga bugungi va kechagi «hayot» yoziladi (xabarlar va javoblar, qo'ng'iroqlar, so'rovlar, qabullar),
 * keyin: hisob to'g'rimi (murojaatlar, javob vaqti, javobsizlar, o'tkazib yuborilgan va qayta qo'ng'iroq, so'rovlar, jamoa, dinamika),
 * va panel ko'rinmas brauzerda (headless) ochilib rasmga olinadi: keng ekran va telefon eni.
 * Ishga tushirish: npm run test:dashboard [rasmlar papkasi]
 */
// «Bugun»ning hodisalari hozirdan 50…14 daqiqa oldin yoziladi — kun boshidan bir soat o'tmagan bo'lsa ular kechaga tushardi
// (CI istalgan soatda ishga tushadi). Shuning uchun sinov (server va brauzer ham) hozir taxminan tush payti bo'lgan soat mintaqasida
// ishlaydi; server mintaqani TZ dan oladi (server/tz.ts), hisob unga bog'liq emas. Etc/GMT da ishora teskari: Etc/GMT-5 = UTC+5
const NOON_OFFSET = 12 - new Date().getUTCHours();
const TIMEZONE = NOON_OFFSET === 0 ? 'Etc/GMT' : `Etc/GMT${NOON_OFFSET > 0 ? '-' : '+'}${Math.abs(NOON_OFFSET)}`;
process.env.TZ = TIMEZONE;
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import type { DashboardView, FunnelView } from '../src/lib/dashboard';
import { iso } from '../src/lib/week';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';
import { OWNER, aiServer, listen, say, sent, sleep, tgServer, waitFor, stopProcess } from './fakes';
import { chromePath } from './chrome';

const CHROME = chromePath();
const OUT = process.argv[2] || join(tmpdir(), 'palantir-dashboard');
mkdirSync(OUT, { recursive: true });
const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const STAFF = 6004;

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), crmPort = await listen(crmServer);
crm.seed(iso(new Date()), iso(new Date(Date.now() + 86_400_000)));
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-dash-'));
const PORT = 3297, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'dash-secret', TICK_MS: '60000',
    MONITOR_MS: '500', MONITOR_GRACE_MS: '1500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', WEB_SEARCH: '0', BACKUP_KEEP: '0', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '',
    TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}

/** Bugun soat hh:mm (mahalliy) — ISO; kun oldin — days */
const at = (hh: number, mm = 0, days = 0) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
let n = 0;
const id = () => `seed${String(++n).padStart(6, '0')}`;

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  // Bu server TG_PERSONAL / IG_VIA_BROWSER'siz: keyinga qoldirilgan kanallar standart holatda o'chiq va panel ularni ko'rsatmaydi
  ok("keyinga qoldirilgan: shaxsiy Telegram va brauzer orqali Instagram o'chiq", me.status.telegramUser.enabled === false && me.status.telegramUser.available === false
    && me.status.instagram.enabled === false && me.status.instagram.available === false, JSON.stringify({ tg: me.status.telegramUser, ig: me.status.instagram }));
  const mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => sent.slice(mark).some(s => String(s.params.text ?? '').includes('Shifo Dent')));
  await api('/api/crm', { token, body: { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN } });
  const team = (await api('/api/staff', { token, body: { name: 'Aziza' } })).json;
  say(STAFF, `/start ${String(team.staff[0].link).split('start=')[1]}`);
  await sleep(800);

  // ─── «Hayot»: bugun va kecha ───────────────────────────────────────────────
  const biz = (await api('/api/me', { token })).json;
  void biz;
  const db = new DatabaseSync(join(dataDir, 'palantir.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const bizId = String((db.prepare('SELECT id FROM businesses LIMIT 1').get() as { id: string }).id);
  const lead = (name: string, channel: string, phone: string | null, created: string) => {
    const lid = id();
    db.prepare(`INSERT INTO leads (id, business_id, name, phone, phone_key, channel, stage, source, created_at, updated_at, last_inbound_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`)
      .run(lid, bizId, name, phone, phone ? phone.replace(/\D/g, '').slice(-9) : null, channel, channel === 'instagram' ? 'Instagram' : 'Telegram havola', created, created, created);
    return lid;
  };
  const msg = (lid: string, channel: string, dir: 'in' | 'out', text: string, when: string) =>
    db.prepare('INSERT INTO inbox (id, business_id, lead_id, channel, direction, author, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id(), bizId, lid, channel, dir, dir === 'in' ? 'customer' : 'palantir', text, when);
  const call = (phone: string, direction: 'in' | 'out', status: string, start: string, sec: number, extra: { outcome?: string; analysis?: string; leadId?: string } = {}) =>
    db.prepare(`INSERT INTO calls (id, business_id, phone, name, started_at, duration_sec, outcome, transcript, booked, created_at, source, direction, status, phone_key, answered_at, ended_at, analysis, lead_id)
      VALUES (?, ?, ?, NULL, ?, ?, ?, '[]', NULL, ?, 'microsip', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id(), bizId, phone, start, sec, extra.outcome ?? '', start, direction, status, phone.replace(/\D/g, '').slice(-9), status === 'ended' ? start : null, new Date(Date.parse(start) + sec * 1000 + 1000).toISOString(), extra.analysis ?? null, extra.leadId ?? null);
  const request = (lid: string, status: 'open' | 'done', created: string, closed: string | null, by: string | null, attempts = 0) =>
    db.prepare(`INSERT INTO requests (id, business_id, lead_id, kind, status, phone, name, summary, source, attempts, done_by, created_at, updated_at, closed_at)
      VALUES (?, ?, ?, 'callback', ?, NULL, NULL, 'Qo''ng''iroq qilib narxni aytish', 'instagram', ?, ?, ?, ?, ?)`).run(id(), bizId, lid, status, attempts, by, created, closed ?? created, closed);

  // Bugungi hodisalar hozirdan 50…14 daqiqa oldin (kun boshidan kamida bir soat o'tgan bo'lishi kerak)
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const sinceMidnight = (Date.now() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 60_000;
  if (sinceMidnight < 55) console.log("  (diqqat: kun boshidan 55 daqiqa o'tmagan — bugungi hodisalar kechaga tushadi, 00:55 dan keyin ishga tushiring)");
  // Bugun: Instagram — 3 murojaat (2 tasiga javob: 4 va 10 daqiqada; 1 tasi javobsiz), Telegram — 2 (ikkalasiga javob, 2 daqiqada)
  // DentaCRM'dagi p1 (Ali Valiyev): bugun kelgan (a1, Completed) — Instagram'dan yozgan, shu bemorga bog'langan
  const a = lead('Ali Valiyev', 'instagram', '+998901112233', ago(50)); msg(a, 'instagram', 'in', 'Implant qancha?', ago(50)); msg(a, 'instagram', 'out', '5 mln dan', ago(46)); msg(a, 'instagram', 'in', 'Rahmat', ago(44));
  const b = lead('Dilnoza', 'instagram', null, ago(40)); msg(b, 'instagram', 'in', "Qo'ng'iroq qiling", ago(40)); msg(b, 'instagram', 'out', 'Albatta', ago(30));
  const c = lead('Javohir', 'instagram', null, ago(35)); msg(c, 'instagram', 'in', 'Ish vaqtingiz?', ago(35));
  const d1 = lead('Sardor', 'bot', null, ago(25)); msg(d1, 'bot', 'in', 'Salom', ago(25)); msg(d1, 'bot', 'out', 'Assalomu alaykum', ago(23));
  const e = lead('Nodira', 'telegram', null, ago(20)); msg(e, 'telegram', 'in', 'Breket narxi?', ago(20)); msg(e, 'telegram', 'out', '9 mln', ago(18));
  // Kecha: Instagram — 1 murojaat (javob 30 daqiqada)
  const y = lead('Kechagi', 'instagram', null, at(15, 0, 1)); msg(y, 'instagram', 'in', 'Salom', at(15, 0, 1)); msg(y, 'instagram', 'out', 'Salom!', at(15, 30, 1));
  // Qo'ng'iroqlar bugun: kiruvchi gaplashildi (tahlil — qabulga yozildi), o'tkazib yuborilgan va keyin qayta qo'ng'iroq qilingan, o'tkazib yuborilgan (qayta qilinmagan), chiquvchi
  call('+998901110001', 'in', 'ended', ago(45), 95, { outcome: 'Implant ko\'rikka yozildi', analysis: '{"outcome":"booked"}', leadId: a });
  call('+998935550002', 'in', 'missed', ago(38), 0);
  call('+998935550002', 'out', 'ended', ago(33), 60);
  call('+998977770003', 'in', 'missed', ago(30), 0);
  // So'rovlar: bugun ochilgan 2 ta — biri Aziza 25 daqiqada yopdi, biri ochiq; kecha ochilgan 1 ta
  request(b, 'done', ago(39), ago(14), 'Aziza', 1);
  request(c, 'open', ago(34), null, null);
  request(y, 'done', at(15, 1, 1), at(16, 0, 1), 'Aziza');
  db.prepare("UPDATE leads SET patient_id = 'p1' WHERE id = ?").run(a);
  db.close();
  crm.transactions.push({ id: 'tp1', patientName: 'Ali Valiyev', patientId: 'p1', date: iso(new Date()), amount: 300_000, type: 'Cash', service: 'Plomba', status: 'Paid', clinicId: 'c1', doctorId: 'd1', doctorName: 'Rustam Rustamov', discountAmount: 0 });

  console.log('\n# Hisob (bugun)');
  const dash = (await api('/api/dashboard?period=today', { token })).json.dashboard as DashboardView;
  const k = dash.kpi;
  ok("murojaatlar: Instagram 3, Telegram 2 (bot+shaxsiy), kiruvchi qo'ng'iroq 3 → 8", k.inquiries.instagram === 3 && k.inquiries.telegram === 2 && k.inquiries.calls === 3 && k.inquiries.value === 8, JSON.stringify(k.inquiries));
  ok('kechagi bilan solishtirish: kecha 1 murojaat', k.inquiries.prev === 1);
  ok("javob berildi: 4 xabar + 1 gaplashilgan qo'ng'iroq = 5; birinchi javob mediana — 3 daqiqa (2, 2, 4, 10)", k.answered.value === 5 && k.answered.responseMin === 3 && k.answered.prevResponseMin === 30, JSON.stringify({ v: k.answered.value, m: k.answered.responseMin, p: k.answered.prevResponseMin }));
  ok("javobsiz: 1 xabar + 1 o'tkazib yuborilgan (ikkinchisiga qayta qo'ng'iroq qilingan)", k.unanswered.messages === 1 && k.unanswered.missedCalls === 1 && k.unanswered.value === 2, JSON.stringify(k.unanswered));
  ok("so'rovlar: bugun 2 ochildi, 1 yopildi (25 daq), hozir ochiq 1", k.requests.value === 2 && k.requests.closed === 1 && k.requests.open === 1 && k.requests.closeMin === 25, JSON.stringify(k.requests));
  ok("qabulga yozildi: qo'ng'iroq tahlilidan 1", k.booked.value === 1);
  ok('yangi mijozlar: bugun 5, kecha 1', k.newLeads.value === 5 && k.newLeads.prev === 1);
  ok("dinamika: soat bo'yicha 24 bo'lak, o'tkazib yuborilganlar 2", dash.period.bucket === 'hour' && dash.dynamics.missed.length === 24 && dash.dynamics.missed.reduce((s, x) => s + x, 0) === 2);
  const aziza = dash.team.find(t => t.name === 'Aziza');
  ok("jamoa: Aziza — qabulxona, Telegram ulangan, bugun 1 yopdi (25 daq)", aziza?.role === 'reception' && aziza.linked && aziza.closed === 1 && aziza.closeMin === 25, JSON.stringify(dash.team));
  ok("so'nggi murojaatlar: xabar, qo'ng'iroq va so'rov aralash, yangisi birinchi", dash.recent.length >= 8 && ['message', 'call', 'request'].every(kind => dash.recent.some(r => r.kind === kind))
    && dash.recent.every((r, i, all) => !i || all[i - 1].at >= r.at));
  ok("«Rahmat» (javobdan keyin) — javob kutilmaydi; savol — javobsiz", dash.recent.find(r => r.kind === 'message' && r.who === 'Ali Valiyev')?.state === 'answered', JSON.stringify(dash.recent.filter(r => r.kind === 'message').map(r => [r.who, r.text, r.state])));
  ok("javobsiz xabar lentada «waiting»", dash.recent.some(r => r.kind === 'message' && r.who === 'Javohir' && r.state === 'waiting'));
  const f = (await api('/api/dashboard/funnel?period=today', { token })).json.funnel as FunnelView;
  ok("voronka: 5 kishi murojaat qildi (Instagram 3, Telegram 2), 4 tasi javob oldi", f.inquiries.total === 5 && f.inquiries.byChannel.instagram === 3 && f.answered.total === 4, JSON.stringify(f));
  ok("voronka DentaCRM bilan: 1 bemorga bog'langan — yozildi, keldi, to'ladi; tushum 300 000 — Instagram'dan", f.crm && f.linked === 1 && f.booked.total === 1 && f.came?.total === 1 && f.paid?.total === 1
    && f.revenue?.total === 300_000 && f.revenue.byChannel.instagram === 300_000);
  ok("bemorga bog'lanmagan to'lovlar (boshqa bemorlar) tushumga kirmaydi", f.revenue?.byChannel.telegram === 0);
  const card = (await api(`/api/leads/${a}/card`, { token })).json.card as import('../src/types').ClientCardView;
  ok("mijoz kartasi: Instagram, 3 xabar; qo'ng'iroq (tahlili bilan); DentaCRM bemori Ali Valiyev — balans 150 000, ertaga 10:00 qabul",
    card.channels.instagram !== null && card.messages.instagram === 3 && card.calls.length === 1 && card.calls[0].analysis?.outcome === 'booked'
    && card.patient?.name === 'Ali Valiyev' && card.patient.balance === 150_000 && card.patient.upcoming.some(v => v.time === '10:00'), JSON.stringify({ ...card, lead: undefined }).slice(0, 400));
  const gapMin = (Date.parse(card.lastMessageAt ?? '') - Date.parse(card.firstMessageAt ?? '')) / 60_000;
  ok("kartada birinchi murojaat — eng birinchi xabar, oxirgisi — eng oxirgi (6 daqiqa farq)", Math.abs(gapMin - 6) < 0.1, `${card.firstMessageAt} → ${card.lastMessageAt}`);
  ok("so'rovlari bor mijoz kartasida — so'rovlar", ((await api(`/api/leads/${b}/card`, { token })).json.card as import('../src/types').ClientCardView).requests.length === 1);
  const week = (await api('/api/dashboard?period=week', { token })).json.dashboard as DashboardView;
  ok("hafta: kun bo'yicha 7 bo'lak, 9 murojaat (kecha bilan)", week.period.bucket === 'day' && week.period.labels.length === 7 && week.kpi.inquiries.value === 9);
  ok("noto'g'ri oraliq (to < from) — bugun", ((await api('/api/dashboard?period=custom&from=2026-10-10&to=2026-10-01', { token })).json.dashboard as DashboardView).period.key === 'today');

  console.log('\n# Ko\'rinish (headless)');
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: TIMEZONE, locale: 'uz-UZ' });
  await ctx.addInitScript(t => { localStorage.setItem('palantir_token', t); }, token);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/#/tahlilchi/hisobot`, { waitUntil: 'networkidle' });
  await page.getByText('Murojaatlar sharhi').waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'dashboard-1440.png'), fullPage: true });
  await page.getByText('Voronka va tushum').waitFor({ timeout: 10000 });
  ok("voronka panelda: tushum ko'rinadi", await page.getByText("300 000 so'm").first().isVisible());
  ok("panel ochildi: ko'rsatkichlar, dinamika, kanallar, jamoa, so'nggi murojaatlar", await page.getByText('Murojaatlar dinamikasi').isVisible() && await page.getByText('Kanallar').first().isVisible() && await page.getByRole('heading', { name: /Jamoa/ }).isVisible() && await page.getByText("So'nggi murojaatlar").isVisible());
  const chart = page.getByRole('img', { name: 'Murojaatlar dinamikasi' });
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
  await page.waitForTimeout(300);
  await page.locator('section', { has: chart }).screenshot({ path: join(OUT, 'dashboard-tooltip.png') });
  ok('grafikda sichqoncha bilan — tooltip', await page.getByText("Kiruvchi qo'ng'iroq").count() > 1);
  await page.getByRole('tab', { name: 'Hafta' }).click();
  await page.waitForTimeout(800);
  ok("«Hafta» — kun bo'yicha", await page.getByText("kun bo'yicha").isVisible());
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'dashboard-390.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('telefon enida gorizontal siljish yo\'q', overflow <= 1, `${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#/inbox`, { waitUntil: 'networkidle' });
  await page.getByText('Ali Valiyev').first().click();
  await page.getByRole('tab', { name: 'Karta' }).click();
  await page.getByText('DentaCRM bemori').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'client-card.png'), fullPage: true });
  ok("panel: mijoz kartasi — kanallar, DentaCRM bemori, yaqin qabul, qo'ng'iroq yozuvi", await page.getByText('Yaqin qabullar').isVisible() && await page.getByText("Qo'ng'iroqlar").first().isVisible());
  ok("sahifada JS xatosi yo'q", !errors.length, errors.join(' | '));
  await browser.close();

  console.log('\n# Kanallar nazorati');
  const toOwnerAfter = (m: number, needle: string) => sent.slice(m).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && String(s.params.text ?? '').includes(needle));
  let m0 = sent.length;
  await sleep(2500);
  ok('hammasi joyida — egasiga ogohlantirish yo\'q', !toOwnerAfter(m0, '⚠️'));
  crm.rejectAll = true;
  m0 = sent.length;
  const down = await waitFor('CRM uzildi', () => toOwnerAfter(m0, '⚠️ <b>DentaCRM</b>'), 15_000);
  ok("DentaCRM kirishni rad eta boshladi — kutish vaqtidan keyin egasiga bir marta «⚠️ DentaCRM»", !!down, String(down?.params.text ?? ''));
  await sleep(2000);
  ok('takrorlanmaydi (bir marta)', sent.slice(m0).filter(s => String(s.params.text ?? '').includes('⚠️ <b>DentaCRM</b>')).length === 1);
  crm.rejectAll = false;
  m0 = sent.length;
  ok('tiklandi — «✅ DentaCRM yana ishlayapti»', await waitFor('CRM tiklandi', () => toOwnerAfter(m0, '✅ <b>DentaCRM</b> yana ishlayapti'), 15_000));
  const db2 = new DatabaseSync(join(dataDir, 'palantir.db'));
  db2.exec('PRAGMA busy_timeout = 5000');
  db2.prepare("INSERT INTO cameras (id, business_id, name, zones, created_at, last_seen_at, stream_host) VALUES ('cam1', ?, 'Kassa', '[]', ?, ?, '192.168.1.64')")
    .run(bizId, new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() - 600_000).toISOString());
  db2.close();
  m0 = sent.length;
  const cam = await waitFor('kamera', () => toOwnerAfter(m0, 'Kamera «Kassa»'), 15_000);
  ok("IP kameradan 10 daqiqa kadr yo'q — «⚠️ Kamera «Kassa»: kadr kelmayapti»", !!cam && String(cam.params.text).includes('kadr kelmayapti'), String(cam?.params.text ?? ''));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await stopProcess(server);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* band */ }
  const failed = results.filter(r => !r).length;
  if (failed) console.log(`\n--- server jurnali (oxiri) ---\n${log.slice(-3000)}`);
  console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`} · rasmlar: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
