/**
 * To'liq oqim sinovi — haqiqiy token va pulsiz:
 *   soxta Telegram API (getUpdates orqali xabar beradi, yuborilganlarni yozib boradi)
 *   soxta Claude API (JSON matn qaytaradi; bittasi ataylab qoidani buzadi)
 *   server — alohida jarayon, vaqtinchalik bazada.
 * Ishga tushirish: npm test
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleClinic } from '../src/data/sampleClinic';
import type { ContentItem } from '../src/types';
import { CHANNEL, OWNER, PATIENT, ai, aiServer, listen, press, say, sent, shareContact, sleep, tgServer, waitFor } from './fakes';

const OUT = process.env.E2E_OUT;
const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};
// ─── Server ───────────────────────────────────────────────────────────────────
const tgPort = await listen(tgServer);
const aiPort = await listen(aiServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-e2e-'));
const PORT = 3290;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const base = `http://127.0.0.1:${PORT}`;
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali ishga tushmadi */ } await sleep(250); }

  console.log('\n# Admin va kirish');
  const bad = await api('/api/admin/login', { body: { password: 'xato' } });
  ok("admin: noto'g'ri parol — 401", bad.status === 401);
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  ok('admin: kirdi', !!admin);
  const created = await api('/api/admin/clinics', { token: admin, body: { name: 'Marvarid Dent', login: 'Marvarid', password: 'secret12' } });
  ok('admin: klinika yaratildi', created.status === 200, created.json.id);
  const dup = await api('/api/admin/clinics', { token: admin, body: { name: 'X', login: 'marvarid', password: 'secret12' } });
  ok('admin: band login — 409', dup.status === 409);
  const other = await api('/api/admin/clinics', { token: admin, body: { name: 'Boshqa', login: 'boshqa', password: 'secret34' } });

  ok('klinika: tokensiz — 401', (await api('/api/me')).status === 401);
  ok("klinika: noto'g'ri parol — 401", (await api('/api/login', { body: { login: 'marvarid', password: 'x' } })).status === 401);
  const token = (await api('/api/login', { body: { login: 'marvarid', password: 'secret12' } })).json.token;
  const otherToken = (await api('/api/login', { body: { login: 'boshqa', password: 'secret34' } })).json.token;
  ok('klinika: kirdi', !!token && !!otherToken && !!other.json.id);

  console.log('\n# Profil');
  const badProfile = await api('/api/clinic', { method: 'PUT', token, body: { ...sampleClinic(), brand: { primary: 'red', accent: '#000000' } } });
  ok("profil: noto'g'ri rang — 400", badProfile.status === 400, badProfile.json.details?.[0]);
  const saved = await api('/api/clinic', { method: 'PUT', token, body: { ...sampleClinic(), contentLang: 'uz' } });
  ok('profil: saqlandi', saved.status === 200);
  const me = (await api('/api/me', { token })).json;
  ok('holat: bot va AI yoqilgan, egasi hali ulanmagan', me.status.bot === 'cerebro_test_bot' && me.status.ai && !me.status.ownerLinked, me.status.linkUrl);

  console.log('\n# Haftalik paket va AI');
  const monday = (await import('../src/lib/week')).iso((await import('../src/lib/week')).mondayOf(new Date()));
  let week = (await api(`/api/weeks/${monday}`, { token })).json;
  ok('hafta: 5 ta material', week.items?.length === 5);
  ok('AI orqa fonda yozmoqda (panel kutmaydi)', week.aiPending === true);
  for (let i = 0; i < 40 && week.aiPending; i++) { await sleep(250); week = (await api(`/api/weeks/${monday}`, { token })).json; }
  const byTpl = (t: string) => (week.items as ContentItem[]).find(i => i.template === t);
  const promo = byTpl('promo')!;
  ok('AI: aksiya matnini AI yozdi', promo.ai && promo.caption.uz.startsWith('Tabassumingizni qaytarish vaqti keldi.'));
  const doctor = byTpl('doctor');
  ok("AI: qoidani buzgan matn rad etildi (bank ishlatildi)", doctor && !doctor.ai && !doctor.caption.uz.includes('kafolat'));
  ok('AI: postda bot havolasi bor', promo.caption.uz.includes(`https://t.me/cerebro_test_bot?start=l-${created.json.id}-`));
  const otherWeek = (await api(`/api/weeks/${monday}`, { token: otherToken })).json;
  ok("boshqa klinikaning paketi — o'z nomi bilan", otherWeek.items[0].caption.uz.includes('#boshqa') && !otherWeek.items[0].caption.uz.includes('Marvarid'));

  console.log('\n# Egasi Telegramni ulaydi');
  say(OWNER, `/start o-${new URL(me.status.linkUrl).searchParams.get('start')!.slice(2)}`);
  const photos = await waitFor('5 ta rasm', () => { const p = sent.filter(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER); return p.length >= 5 && p; });
  ok('ulandi va paket keldi (5 rasm)', photos?.length === 5);
  const photo = photos?.[0];
  ok('rasm — PNG, serverda chizilgan', photo?.file && photo.file.subarray(1, 4).toString() === 'PNG' && photo.file.length > 20000, `${photo?.file?.length} bayt`);
  if (OUT && photo?.file) writeFileSync(join(OUT, 'e2e-owner-photo.png'), photo.file);
  const kb = (photo?.params.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] })?.inline_keyboard;
  ok('tugmalar: Joylash / Boshqa variant / Tahrirlash / Kerak emas', kb?.flat().map(b => b.text).join(',') === '✅ Joylash,🔄 Boshqa variant,✏️ Tahrirlash,❌ Kerak emas');
  ok('egasi uchun matn 1024 belgidan oshmaydi', photos?.every(p => String(p.params.caption).length <= 1024));
  ok('holat: egasi ulangan', (await api('/api/me', { token })).json.status.ownerLinked);

  console.log('\n# Kanal');
  const chBad = await api('/api/channel', { token, body: { channel: '@yoq_kanal' } });
  ok("kanal: topilmasa — tushunarli xato", chBad.status === 400 && /topilmadi/.test(chBad.json.error), chBad.json.error);
  const ch = await api('/api/channel', { token, body: { channel: 'https://t.me/test_channel' } });
  ok('kanal: ulandi', ch.status === 200 && ch.json.status.channel?.title === 'Test kanal');

  console.log('\n# Tugmalar (Telegram)');
  const before = sent.length;
  press(OWNER, `p|${promo.id}`, 101);
  const toChannel = await waitFor('kanalga joylash', () => sent.slice(before).find(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === CHANNEL));
  const promoIsPast = new Date(`${promo.date}T${promo.time}:00`) <= new Date();
  if (promoIsPast) {
    ok('«Joylash»: vaqti o\'tgan post darhol kanalga chiqdi', !!toChannel);
    ok('kanaldagi matn — post matni', String(toChannel?.params.caption).startsWith('Tabassumingizni qaytarish'));
    ok('egasiga Instagram uchun rasm va matn (hujjat)', !!await waitFor('hujjat', () => sent.slice(before).find(s => s.method === 'sendDocument' && Number(s.params.chat_id) === OWNER)));
  } else ok("«Joylash»: vaqti kelmagan post rejaga qo'yildi", !toChannel);
  ok('egasining xabari yangilandi', !!await waitFor('caption edit', () => sent.slice(before).find(s => s.method === 'editMessageCaption')));

  const tipOrHoliday = (week.items as ContentItem[]).find(i => i.slot === 1)!;
  const b2 = sent.length;
  press(OWNER, `v|${tipOrHoliday.id}`, 102);
  ok('«Boshqa variant»: rasm almashtirildi', !!await waitFor('editMessageMedia', () => sent.slice(b2).find(s => s.method === 'editMessageMedia' && s.file)));

  const b3 = sent.length;
  press(OWNER, `e|${doctor!.id}`, 103);
  await waitFor('tahrir so\'rovi', () => sent.slice(b3).find(s => s.method === 'sendMessage' && /Yangi matnni yuboring/.test(String(s.params.text))));
  say(OWNER, 'Shifokorimiz sizni kutadi. 100% natija!');
  const warn = await waitFor('tahrir javobi', () => sent.slice(b3).find(s => s.method === 'sendMessage' && /Saqlandi/.test(String(s.params.text))));
  ok('«Tahrirlash»: saqlandi va filtr ogohlantirdi', !!warn && /tekshiring/.test(String(warn.params.text)));
  week = (await api(`/api/weeks/${monday}`, { token })).json;
  ok('tahrir panelda ham ko\'rinadi', (week.items as ContentItem[]).find(i => i.id === doctor!.id)?.caption.uz === 'Shifokorimiz sizni kutadi. 100% natija!');

  press(OWNER, `r|${(week.items as ContentItem[])[4].id}`, 104);
  await sleep(600);
  week = (await api(`/api/weeks/${monday}`, { token })).json;
  ok('«Kerak emas»: holat saqlandi', week.status[(week.items as ContentItem[])[4].id] === 'rejected');

  console.log('\n# Bemor postdagi havolani bosadi');
  const code = promo.id.replace(/-/g, '');
  const b4 = sent.length;
  say(PATIENT, `/start l-${created.json.id}-${code}`);
  const ask = await waitFor('raqam so\'rovi', () => sent.slice(b4).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === PATIENT));
  ok('bemordan raqam so\'raldi (tugma bilan)', JSON.stringify(ask?.params.reply_markup ?? '').includes('request_contact'));
  shareContact(PATIENT, '998001112233');
  const notify = await waitFor('egasiga murojaat', () => sent.slice(b4).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && /Yangi murojaat/.test(String(s.params.text))));
  ok('egasiga «Yangi murojaat» keldi, manbasi bilan', !!notify && /\+998001112233/.test(String(notify.params.text)) && /Aksiya/.test(String(notify.params.text)));
  const leadList = (await api('/api/leads', { token })).json.leads;
  ok('panel: murojaat ro\'yxatda, manbasi bilan', leadList?.length === 1 && leadList[0].phone === '+998001112233' && /Aksiya/.test(leadList[0].source));
  ok('panel: boshqa klinika bu murojaatni ko\'rmaydi', (await api('/api/leads', { token: otherToken })).json.leads.length === 0);
  const report = (await api(`/api/weeks/${monday}/report`, { token })).json;
  ok('natija: postdan 1 bosish, 1 raqam', report.counts?.[promo.id]?.clicks === 1 && report.counts[promo.id].contacts === 1);
  const called = await api(`/api/leads/${leadList[0].id}`, { method: 'PATCH', token, body: { stage: 'called' } });
  ok("murojaat: «qo'ng'iroq qilindi» belgilandi", called.status === 200);

  console.log('\n# Savol-javob');
  const b5 = sent.length;
  say(OWNER, 'Nechta odam yozildi?');
  const answer = await waitFor('javob', () => sent.slice(b5).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && /AI javobi/.test(String(s.params.text))));
  ok('egasi savol berdi — AI javob berdi', !!answer);
  const webAsk = await api('/api/ask', { token, body: { text: 'Qaysi post yaxshi ishladi?' } });
  ok('paneldan savol ham ishlaydi', /AI javobi/.test(webAsk.json.answer ?? ''));

  console.log('\n# Paneldagi amallar Telegramga tushadi');
  const b6 = sent.length;
  const slotItem = (week.items as ContentItem[])[3];
  const pv = await api(`/api/items/${slotItem.id}/action`, { token, body: { action: 'variant' } });
  ok('panel: variant', pv.status === 200);
  ok('panel: variant — egasining xabaridagi rasm ham almashdi', !!await waitFor('media', () => sent.slice(b6).find(s => s.method === 'editMessageMedia')));
  const pa = await api(`/api/weeks/${monday}/publish-all`, { token, body: {} });
  ok('panel: hammasini joylash', pa.status === 200 && pa.json.count >= 1, `${pa.json.count} ta`);
  const blocked = await api(`/api/items/${promo.id}/action`, { token, body: { action: 'undo' } });
  ok("chiqqan postni qaytarib bo'lmaydi — 409", !promoIsPast || blocked.status === 409, blocked.json.error);
  ok("boshqa klinika bu postni o'zgartira olmaydi", (await api(`/api/items/${promo.id}/action`, { token: otherToken, body: { action: 'reject' } })).status === 200
    && (await api(`/api/weeks/${monday}`, { token })).json.status[promo.id] === 'published');

  console.log('\n# Qayta ishga tushirish');
  const beforeRestart = sent.filter(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER).length;
  await sleep(1500);
  const after = sent.filter(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER).length;
  ok('paket qayta yuborilmaydi (bir hafta — bir marta)', after === beforeRestart);
  ok('AI so\'rovlari soni me\'yorida', ai.calls <= 6, `${ai.calls} ta`);
} finally {
  server.kill();
  tgServer.close();
  aiServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl qulfi */ }
}

const failed = results.filter(r => !r).length;
if (failed) console.log(`\n--- server jurnali ---\n${serverLog.slice(-3000)}`);
console.log(`\nNatija: ${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
