/**
 * Bitta kompyuter — bitta profil sinovi:  npm run test:profile
 *   O'rnatish (ONE_PROFILE=1) profilni o'zi yaratadi, ikkinchisini ochib bo'lmaydi → sozlash bosqichi: shu kompyuterdan parolsiz,
 *   klinika tarmog'idan va Hub'ning oddiy /c/ havolasidan — yo'q → Hub'da «Yangi klinika» kodi qo'yiladi → Hub «sozlanmoqda» deb ko'radi,
 *   «Sozlash» egasidan so'ramasdan ochiladi, masofadan klinika ma'lumoti va kalitlar → «Egasiga topshirish»: login va parol bir marta,
 *   o'rnatuvchining kirishi (shu kompyuterdagi ham, Hub orqali ham) tugaydi → endi jamoa faqat egasining ruxsati bilan.
 * Haqiqiy hub va Palantir jarayonlari, soxta Telegram.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { listen, OWNER, press, say, sent, sleep, stopProcess, tgServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const ADMIN_KEY = 'hub-admin-sinov-kaliti-0123456789';
const tgPort = await listen(tgServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-profil-'));
const HUB_PORT = 3413, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3297, base = `http://127.0.0.1:${PORT}`;
const procs: ChildProcess[] = [];
process.on('exit', () => { for (const p of procs) p.kill(); });
let log = '';
const start = (script: string, env: Record<string, string>) => {
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', script], { env: { ...process.env, DOTENV: '0', ASTERISK_WSL: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  procs.push(p);
  return p;
};
const up = async (url: string) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
async function until<T>(what: string, fn: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const v = await fn().catch(() => undefined); if (v) return v; }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
const admin = { authorization: `Bearer ${ADMIN_KEY}` };
/** Shu kompyuterdan, lekin boshqa Host nomi bilan (fetch Host sarlavhasini o'zgartirmaydi) — javob kodi */
const withHost = (host: string, p = '/api/health') => new Promise<number>(done => {
  const r = http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, res => { res.resume(); done(res.statusCode ?? 0); });
  r.on('error', () => done(0));
});
const post = (body: unknown, token?: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
type Clinic = { id: string; online: boolean; status: { setup?: boolean; label?: string } | null };
const hubClinic = async (id: string) => ((await (await fetch(`${HUB}/admin/clinics`, { headers: admin })).json()) as { clinics: Clinic[] }).clinics.find(c => c.id === id);
const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const phase = async () => await (await fetch(`${base}/api/profile/phase`)).json() as { setup: boolean; oneProfile: boolean; name: string | null; hub: string | null };

try {
  start('hub/server.ts', { PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_ADMIN_KEY: ADMIN_KEY, HUB_BACKUP_DIR: path.join(work, 'hub-zaxira') });
  ok('hub ishga tushdi', await up(`${HUB}/health`));
  const clinic = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Shifo Dent' }) })).json() as { clinicId: string; code: string };
  ok('Hub: «Yangi klinika» — ulanish kodi berildi', clinic.code?.startsWith('palantirhub.'));

  start('server/index.ts', {
    PORT: String(PORT), LISTEN_HOST: '0.0.0.0', DATA_DIR: path.join(work, 'data'), ONE_PROFILE: '1', BOT_TOKEN: '123:CLINIC', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', PALANTIR_HUB: '', HUB_AUTO: '0',
    ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'profil-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0', HEARTBEAT_MS: '400',
  });
  ok('Palantir ishga tushdi', await up(`${base}/api/health`));

  console.log('\n# Bitta kompyuter — bitta profil');
  const p0 = await phase();
  ok("profil o'zi yaratildi, sozlash bosqichida, Hub hali yo'q", p0.oneProfile && p0.setup && p0.name === 'Yangi biznes' && p0.hub === null, JSON.stringify(p0));
  // Klinikada admin yo'q: .env dagi ADMIN_PASSWORD to'g'ri bo'lsa ham kirib bo'lmaydi, admin yo'llari ham yopiq
  const adminLogin = await fetch(`${base}/api/admin/login`, post({ password: 'admin-pass-1' }));
  ok("klinikada admin yo'q: to'g'ri admin paroli bilan ham — 404", adminLogin.status === 404);
  const second = await fetch(`${base}/api/admin/businesses`, post({ name: 'Boshqa ish', login: 'boshqa', password: 'secret12' }));
  ok("admin yo'llari ham yopiq (ikkinchi profil ochilmaydi) — 404", second.status === 404);
  const early = await fetch(`${base}/api/login/forgot`, post({}));
  ok("sozlash bosqichida «Parolni unutdingizmi?» — hali topshirilmagan (409)", early.status === 409);

  console.log('\n# Sozlash bosqichi: kim kira oladi');
  const local = await (await fetch(`${base}/api/login/setup`, post({}))).json() as { token?: string };
  ok("shu kompyuterdan — parolsiz", !!local.token && (await fetch(`${base}/api/me`, auth(local.token))).status === 200);
  const lan = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lan) {
    const fromLan = await fetch(`http://${lan}:${PORT}/api/login/setup`, post({})).catch(() => null);
    ok('klinika tarmog\'idagi boshqa kompyuterdan — yo\'q (403)', fromLan?.status === 403, `${lan} → ${fromLan?.status}`);
  } else console.log('    (tarmoq manzili yo\'q — tarmoqdan sinov o\'tkazib yuborildi)');
  const tunnel = await fetch(`${base}/api/login/setup`, { ...post({}), headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' } });
  ok("shu kompyuterdagi tunnel/proksi orqali — yo'q (403)", tunnel.status === 403);
  const keys = await fetch(`${base}/api/keys`, auth(local.token!));
  ok('klinika kalitlari — profilning o\'zida (admin parolisiz)', keys.status === 200 && ((await keys.json()) as { keys: { name: string }[] }).keys.some(k => k.name === 'BOT_TOKEN'));

  console.log('\n# Ulanish kodi: kompyuter Hub\'dagi yozuvga ulanadi');
  const put = await fetch(`${base}/api/keys/PALANTIR_HUB`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${local.token}` }, body: JSON.stringify({ value: clinic.code }) });
  ok('kod qo\'yildi va tekshirildi', put.status === 200, put.status === 200 ? '' : JSON.stringify(await put.json()));
  ok('profil: Hub — kod bilan', (await phase()).hub === 'code');
  const listed = await until('Hub ro\'yxatida «sozlanmoqda»', async () => { const c = await hubClinic(clinic.clinicId); return c?.online && c.status?.setup === true ? c : undefined; }, 20_000);
  ok("Hub: klinika aloqada va «sozlanmoqda» (egasiga topshirilmagan)", !!listed);

  console.log('\n# Masofadan sozlash (Hub → «Sozlash»)');
  const R = `${HUB}/c/${clinic.clinicId}`;
  const anon = await fetch(`${R}/api/login/setup`, post({}));
  ok("Hub'ning oddiy /c/ havolasidan parolsiz kirib bo'lmaydi — 403", anon.status === 403);
  const opened = await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/panel`, { method: 'POST', headers: admin, body: '{}' });
  const support = await opened.json() as { token?: string; error?: string };
  ok("«Sozlash»: egasi yo'q — so'ramasdan ochildi", opened.status === 200 && !!support.token, support.error ?? '');
  const me = await (await fetch(`${R}/api/me`, auth(support.token!))).json() as { business: Record<string, unknown> & { name: string }; offeringsRev: string };
  const saved = await fetch(`${R}/api/business`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${support.token}` },
    body: JSON.stringify({ ...me.business, name: 'Shifo Dent', address: 'Toshkent, Chilonzor 7', hours: 'Du–Sh 9:00–20:00', offeringsRev: me.offeringsRev }) });
  ok('masofadan: klinika nomi, manzil, ish vaqti saqlandi', saved.status === 200 && (await phase()).name === 'Shifo Dent', saved.status === 200 ? '' : JSON.stringify(await saved.json()));
  const remoteKeys = await fetch(`${R}/api/keys`, auth(support.token!));
  ok('masofadan: klinika kalitlari ochiq (Palantir xodimi)', remoteKeys.status === 200);

  console.log('\n# Egasiga topshirish');
  const given = await (await fetch(`${R}/api/handover`, post({ login: 'shifodent' }, support.token))).json() as { login?: string; password?: string; error?: string };
  ok('login va yangi parol bir marta berildi', given.login === 'shifodent' && (given.password?.length ?? 0) >= 12, given.error ?? '');
  ok("o'rnatuvchining Hub orqali kirishi tugadi — 401", (await fetch(`${R}/api/me`, auth(support.token!))).status === 401);
  ok("shu kompyuterdagi sozlash kirishi ham tugadi — 401", (await fetch(`${base}/api/me`, auth(local.token!))).status === 401);
  const again = await fetch(`${base}/api/login/setup`, post({}));
  ok('parolsiz kirish yopildi — 409', again.status === 409);
  ok('profil: sozlash bosqichi tugadi', (await phase()).setup === false);
  const owner = await (await fetch(`${base}/api/login`, post({ login: 'shifodent', password: given.password }))).json() as { token?: string };
  ok('egasi berilgan login va parol bilan kirdi', !!owner.token && (await fetch(`${base}/api/me`, auth(owner.token))).status === 200);
  ok("egasining telefonidan (Hub orqali) bot tokenini almashtirib bo'lmaydi — 403", (await fetch(`${R}/api/keys`, auth(owner.token!))).status === 403);
  const twice = await fetch(`${base}/api/handover`, post({}, owner.token));
  ok('qayta topshirib bo\'lmaydi — 400', twice.status === 400);

  console.log('\n# Klinika ichidagi tarmoq (LISTEN_HOST=0.0.0.0, server/lan.ts)');
  ok("begona sayt nomi bilan (DNS rebinding) — 421", await withHost('evil.example') === 421 && await withHost(`palantir.evil.example:${PORT}`) === 421);
  ok("tashqi IP nomi bilan — 421", await withHost(`203.0.113.7:${PORT}`) === 421);
  ok("ichki IP, localhost va kompyuter nomi bilan — ochiladi", await withHost(`192.168.1.10:${PORT}`) === 200 && await withHost(`localhost:${PORT}`) === 200
    && await withHost(`${hostname()}:${PORT}`) === 200 && await withHost(`[::1]:${PORT}`) === 200);
  const where = (await (await fetch(`${base}/api/team-access`, auth(owner.token!))).json() as { where: { lan: string[]; hub: string | null } }).where;
  ok("Sozlamalar → Xodimlar kirishi: klinika ichidagi manzil(lar) va Hub havolasi", where.lan.every(u => new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${PORT}$`).test(u))
    && where.hub?.startsWith(`${HUB}/c/`), JSON.stringify(where));
  if (where.lan[0]) {
    // Ko'rsatilgan manzilning o'zi ishlaydi: qabulxonadagi kompyuter shu bilan kiradi
    const viaLan = await (await fetch(`${where.lan[0]}/api/login`, post({ login: 'shifodent', password: given.password }))).json() as { token?: string };
    ok('ko\'rsatilgan ichki manzil bilan boshqa kompyuterdan kirildi', !!viaLan.token && (await fetch(`${where.lan[0]}/api/me`, auth(viaLan.token))).status === 200, where.lan[0]);
  } else console.log("    (tarmoq manzili yo'q — boshqa kompyuterdan kirish sinovi o'tkazib yuborildi)");

  console.log('\n# Topshirilgandan keyin — faqat egasining ruxsati bilan');
  const after = await until('Hub: «sozlanmoqda» yo\'qoldi', async () => { const c = await hubClinic(clinic.clinicId); return c?.status && c.status.setup === false ? c : undefined; }, 10_000);
  ok("Hub: endi oddiy klinika («sozlanmoqda» emas)", !!after);
  const asked = await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/panel`, { method: 'POST', headers: admin, body: '{}' });
  ok("«Panelni ochish»: egasi Telegram'ni ulamagan va ruxsat bermagan — kirilmaydi (403)", asked.status === 403, ((await asked.json()) as { error?: string }).error ?? '');

  // Egasi Telegram'ni shu yerda ulaydi — shuning uchun oxirida (yuqoridagi «ulamagan» holati buzilmasin)
  console.log("\n# Parolni unutdi — Telegram orqali (admin yo'q)");
  const noTg = await fetch(`${base}/api/login/forgot`, post({}));
  ok("Telegram ulanmagan — tiklab bo'lmaydi, Palantir xodimiga (409)", noTg.status === 409 && ((await noTg.json()) as { error: string }).error.includes('Palantir xodimi'));
  const status = await (await fetch(`${base}/api/me`, auth(owner.token!))).json() as { status: { linkUrl: string | null } };
  let mark = sent.length;
  say(OWNER, `/start ${String(status.status.linkUrl).split('start=')[1]}`);
  ok('egasi Telegram\'ni uladi', !!await waitFor('egasi ulandi', () => to(OWNER, mark, 'ulandi') || to(OWNER, mark, 'Shifo Dent')));
  mark = sent.length;
  const forgotAsk = await fetch(`${base}/api/login/forgot`, post({}));
  const ask = await waitFor("Telegram'ga so'rov", () => to(OWNER, mark, 'parolini tiklash'));
  ok("«Parolni unutdingizmi?» — egasining Telegram'iga «Ha / Yo'q» so'rovi, parol hali o'zgarmagan", forgotAsk.status === 200 && !!ask
    && buttons(ask).some(b => b.callback_data?.startsWith('pa|')) && (await fetch(`${base}/api/me`, auth(owner.token!))).status === 200);
  ok('qayta-qayta bosib egasini ko\'mib bo\'lmaydi — 429', (await fetch(`${base}/api/login/forgot`, post({}))).status === 429);
  mark = sent.length;
  press(OWNER, buttons(ask).find(b => b.callback_data?.startsWith('pa|'))!.callback_data!, ask!.id!);
  const fresh = await waitFor('yangi parol keldi', () => to(OWNER, mark, 'Yangi parol'));
  const newPassword = /Parol: <code>([^<]+)<\/code>/.exec(textOf(fresh))?.[1];
  ok("«Ha» — yangi parol Telegram'ga keldi", !!newPassword && textOf(fresh).includes('shifodent'));
  ok('eski kirish yopildi — 401', (await fetch(`${base}/api/me`, auth(owner.token!))).status === 401);
  const oldPw = await fetch(`${base}/api/login`, post({ login: 'shifodent', password: given.password }));
  const relog = await (await fetch(`${base}/api/login`, post({ login: 'shifodent', password: newPassword }))).json() as { token?: string };
  ok('eski parol ishlamaydi, yangisi bilan kirdi', oldPw.status === 401 && !!relog.token);
  press(OWNER, buttons(ask).find(b => b.callback_data?.startsWith('pa|'))!.callback_data!, ask!.id!);
  await sleep(800);
  ok('o\'sha tugmani qayta bosish — parol yana almashmaydi', (await fetch(`${base}/api/me`, auth(relog.token!))).status === 200);
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  // Tugashini kutib: ohista to'xtayotgan server keyingi sinovning portiga xalaqit bermasin
  await Promise.all(procs.map(p => stopProcess(p)));
  tgServer.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
