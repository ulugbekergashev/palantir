/**
 * Kim nima qila oladi — sinov:  npm run test:team
 *   Hub: har kishining o'z hisobi (asoschi / o'rnatuvchi), asosiy kalit faqat birinchi asoschini ochish uchun, huquqlar,
 *   parol almashsa yoki hisob yopilsa — eski kirish bekor, jurnal (kim, qachon, qaysi klinika), klinika egasi kim kirganini ko'radi.
 *   Klinika: egasi xodimga login beradi (qabulxona / boshqaruvchi), xodim faqat o'z bo'limini ochadi, huquq almashsa, parol
 *   yangilansa yoki kirish yopilsa — ochiq kirish darhol tugaydi.
 * Haqiqiy hub va Palantir jarayonlari, soxta Telegram.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listen, sleep, stopProcess, tgServer } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const ADMIN_KEY = 'hub-admin-sinov-kaliti-jamoa-0123456';
const tgPort = await listen(tgServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-jamoa-'));
const HUB_PORT = 3415, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3287, base = `http://127.0.0.1:${PORT}`;
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
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const post = (body: unknown, token?: string) => ({ method: 'POST', headers: token ? bearer(token) : { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string, token: string) => fetch(url, { headers: bearer(token) });
const json = async <T>(r: Response | Promise<Response>) => await (await r).json() as T;

try {
  start('hub/server.ts', { PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_ADMIN_KEY: ADMIN_KEY, HUB_BACKUP_DIR: path.join(work, 'hub-zaxira') });
  ok('hub ishga tushdi', await up(`${HUB}/health`));

  console.log("\n# Hub: shaxsiy hisoblar");
  ok('kirmagan — 401', (await fetch(`${HUB}/admin/clinics`)).status === 401);
  const master = await json<{ member: { name: string; role: string } }>(get(`${HUB}/admin/me`, ADMIN_KEY));
  ok('asosiy kalit — asoschi («Asosiy kalit»)', master.member?.role === 'founder' && master.member.name === 'Asosiy kalit');
  const f = await json<{ member: { id: string }; password: string }>(fetch(`${HUB}/admin/team`, post({ name: "Ulug'bek", login: 'ulugbek', role: 'founder' }, ADMIN_KEY)));
  const i = await json<{ member: { id: string }; password: string }>(fetch(`${HUB}/admin/team`, post({ name: 'Sardor', login: 'sardor', role: 'installer' }, ADMIN_KEY)));
  ok('asoschi va o\'rnatuvchi qo\'shildi — parol bir marta', f.password?.length >= 12 && i.password?.length >= 12);
  ok('band login — 409', (await fetch(`${HUB}/admin/team`, post({ name: 'Yana', login: 'sardor' }, ADMIN_KEY))).status === 409);
  const bad = await fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: 'xato-parol' }));
  ok("noto'g'ri parol — 401", bad.status === 401);
  const founder = await json<{ token: string; member: { role: string } }>(fetch(`${HUB}/admin/login`, post({ login: 'ulugbek', password: f.password })));
  const installer = await json<{ token: string; member: { role: string } }>(fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: i.password })));
  ok("o'z logini bilan kirdi (rollar to'g'ri)", founder.member?.role === 'founder' && installer.member?.role === 'installer');

  console.log("\n# O'rnatuvchining huquqi");
  ok("klinikalar ro'yxati — ochiq", (await get(`${HUB}/admin/clinics`, installer.token)).status === 200);
  ok("jamoani boshqarish, jurnal, zaxiralar — yo'q (403)", (await fetch(`${HUB}/admin/team`, post({ name: 'X', login: 'xxx' }, installer.token))).status === 403
    && (await get(`${HUB}/admin/audit`, installer.token)).status === 403 && (await get(`${HUB}/admin/backups`, installer.token)).status === 403);
  const clinic = await json<{ clinicId: string; code: string }>(fetch(`${HUB}/admin/clinics`, post({ name: 'Shifo Dent' }, installer.token)));
  ok("o'rnatuvchi «Yangi klinika» ochdi", clinic.code?.startsWith('palantirhub.'));
  ok("litsenziya va o'chirish — faqat asoschi (403)", (await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/license`, post({}, installer.token))).status === 403
    && (await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/delete`, post({}, installer.token))).status === 403);

  start('server/index.ts', {
    PORT: String(PORT), DATA_DIR: path.join(work, 'data'), ONE_PROFILE: '1', BOT_TOKEN: '123:CLINIC', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', PALANTIR_HUB: clinic.code, HUB_AUTO: '0',
    ADMIN_PASSWORD: '', SESSION_SECRET: 'jamoa-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0', HEARTBEAT_MS: '400',
  });
  ok('Palantir ishga tushdi', await up(`${base}/api/health`));
  const other = await json<{ password: string }>(fetch(`${HUB}/admin/team`, post({ name: 'Jasur', login: 'jasur', role: 'installer' }, ADMIN_KEY)));
  const jasur = (await json<{ token: string }>(fetch(`${HUB}/admin/login`, post({ login: 'jasur', password: other.password })))).token;
  const online = await until('klinika aloqada', async () => ((await json<{ clinics: { id: string; online: boolean }[] }>(get(`${HUB}/admin/clinics`, installer.token))).clinics.find(c => c.id === clinic.clinicId)?.online ? true : undefined), 20_000);
  ok('klinika Hub\'ga ulandi', !!online);

  ok("boshqa o'rnatuvchi bu klinikani ko'rmaydi va ochmaydi (404); asoschi ko'radi", (await json<{ clinics: unknown[] }>(get(`${HUB}/admin/clinics`, jasur))).clinics.length === 0
    && (await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/panel`, post({}, jasur))).status === 404
    && (await json<{ clinics: { id: string }[] }>(get(`${HUB}/admin/clinics`, founder.token))).clinics.some(c => c.id === clinic.clinicId));
  console.log("\n# Kim kirgani — klinikada ham");
  const R = `${HUB}/c/${clinic.clinicId}`;
  const opened = await json<{ token?: string; error?: string }>(fetch(`${HUB}/admin/clinics/${clinic.clinicId}/panel`, post({}, installer.token)));
  ok("o'rnatuvchi «Sozlash» bilan kirdi", !!opened.token, opened.error ?? '');
  const given = await json<{ login?: string; password?: string }>(fetch(`${R}/api/handover`, post({ login: 'shifodent' }, opened.token)));
  const owner = (await json<{ token: string }>(fetch(`${base}/api/login`, post({ login: 'shifodent', password: given.password })))).token;
  const visits = await json<{ visits: { who: string | null }[] }>(get(`${base}/api/account/support`, owner));
  ok('egasi Sozlamalarda ko\'radi: «Sardor kirgan»', visits.visits?.[0]?.who === 'Sardor', JSON.stringify(visits.visits?.[0]));
  const audit = await json<{ audit: { actor: string; action: string; clinicId: string | null }[] }>(get(`${HUB}/admin/audit`, founder.token));
  ok("jurnal: Sardor klinika ochdi va paneliga kirdi", audit.audit?.some(a => a.actor === 'Sardor' && a.action === 'klinika.yaratildi' && a.clinicId === clinic.clinicId)
    && audit.audit.some(a => a.actor === 'Sardor' && a.action === 'panel.ochildi' && a.clinicId === clinic.clinicId));
  const perClinic = await json<{ audit: { clinicId: string | null }[] }>(get(`${HUB}/admin/audit?clinic=${clinic.clinicId}`, founder.token));
  ok('jurnal klinika bo\'yicha', perClinic.audit.length >= 2 && perClinic.audit.every(a => a.clinicId === clinic.clinicId));

  console.log("\n# Hisobni yopish va parol");
  ok("o'zini yopib bo'lmaydi — 400", (await fetch(`${HUB}/admin/team/${f.member.id}/off`, post({}, founder.token))).status === 400);
  ok('asoschi o\'rnatuvchini yopdi — ochiq kirishi darhol 401', (await fetch(`${HUB}/admin/team/${i.member.id}/off`, post({}, founder.token))).status === 200
    && (await get(`${HUB}/admin/clinics`, installer.token)).status === 401);
  ok("yopiq hisob bilan kirib bo'lmaydi", (await fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: i.password }))).status === 401);
  await fetch(`${HUB}/admin/team/${i.member.id}/on`, post({}, founder.token));
  const fresh = await json<{ password: string }>(fetch(`${HUB}/admin/team/${i.member.id}/reset`, post({}, founder.token)));
  ok('yangi parol: eskisi ishlamaydi, yangisi ishlaydi', (await fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: i.password }))).status === 401
    && (await fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: fresh.password }))).status === 200);
  const changed = await json<{ token?: string }>(fetch(`${HUB}/admin/me/password`, post({ current: f.password, next: 'yangi-parol-asoschi' }, founder.token)));
  ok("o'z parolini almashtirdi: eski kirish 401, yangisi ishlaydi", !!changed.token && (await get(`${HUB}/admin/me`, founder.token)).status === 401 && (await get(`${HUB}/admin/me`, changed.token!)).status === 200);
  // Oxirida: shu manzildan kirish 15 daqiqaga to'siladi (oldingi xato urinishlar ham sanaladi)
  const tries: number[] = [];
  for (let n = 0; n < 9; n++) tries.push((await fetch(`${HUB}/admin/login`, post({ login: 'begona', password: 'x' }))).status);
  const cut = tries.indexOf(429);
  ok("parol taxmin qilish — 8 xatodan keyin 429", cut > 0 && tries.slice(0, cut).every(s => s === 401) && tries.slice(cut).every(s => s === 429), tries.join(','));
  ok("to'silgan manzildan to'g'ri parol bilan ham — 429 (15 daqiqa)", (await fetch(`${HUB}/admin/login`, post({ login: 'sardor', password: fresh.password }))).status === 429);

  console.log('\n# Klinika xodimlari: qabulxona');
  const staffId = (await json<{ staff: { id: string; name: string }[] }>(fetch(`${base}/api/staff`, post({ name: 'Dilnoza' }, owner)))).staff.find(s => s.name === 'Dilnoza')!.id;
  ok("egasining logini xodimga berilmaydi — 409", (await fetch(`${base}/api/team-access/${staffId}`, post({ access: 'reception', login: 'shifodent' }, owner))).status === 409);
  const grant = await json<{ member: { login: string; access: string }; password: string }>(fetch(`${base}/api/team-access/${staffId}`, post({ access: 'reception', login: 'dilnoza' }, owner)));
  ok('egasi kirish berdi — parol bir marta', grant.member?.access === 'reception' && grant.password?.length >= 10);
  let staff = (await json<{ token: string }>(fetch(`${base}/api/login`, post({ login: 'dilnoza', password: grant.password })))).token;
  const me = await json<{ who: { kind: string; name: string; access: string } }>(get(`${base}/api/me`, staff));
  ok("xodim o'z logini bilan kirdi — panel uni xodim deb biladi", me.who?.kind === 'staff' && me.who.name === 'Dilnoza' && me.who.access === 'reception', JSON.stringify(me.who));
  const st = async (method: string, p: string, body?: unknown) => (await fetch(`${base}${p}`, { method, headers: bearer(staff), body: body === undefined ? undefined : JSON.stringify(body) })).status;
  ok("ochiq: so'rovlar, yozishmalar, mijozlar, qo'ng'iroqlar", (await st('GET', '/api/requests')) === 200 && (await st('GET', '/api/inbox')) === 200 && (await st('GET', '/api/leads')) === 200 && (await st('GET', '/api/calls')) === 200);
  ok("yopiq: Yordamchi, tahlil, kameralar, Miya", (await st('GET', '/api/chat')) === 403 && (await st('GET', '/api/insights')) === 403 && (await st('GET', '/api/cameras')) === 403 && (await st('GET', '/api/brain')) === 403);
  ok("yopiq: klinika ma'lumotini o'zgartirish, xodim qo'shish, kalitlar, parol", (await st('PUT', '/api/business', {})) === 403 && (await st('POST', '/api/staff', { name: 'X' })) === 403
    && (await st('GET', '/api/keys')) === 403 && (await st('POST', '/api/account/password', { current: 'a', next: 'bbbbbbbbbb' })) === 403 && (await st('GET', '/api/team-access')) === 403);
  ok("yopiq: AI xodimlarga topshiriq (Marketolog va h.k.)", (await st('POST', '/api/orders', { member: 'marketolog', text: 'x' })) === 403 && (await st('GET', '/api/orders?member=qabulxona')) === 403);
  const list = await json<{ staff: Record<string, unknown>[] }>(get(`${base}/api/staff`, staff));
  ok("xodimlar ro'yxatida boshqalarning logini ko'rinmaydi", list.staff?.length === 1 && !('login' in list.staff[0]) && !('access' in list.staff[0]));

  console.log('\n# Boshqaruvchi');
  ok("huquq almashdi — ochiq kirish darhol tugadi", (await fetch(`${base}/api/team-access/${staffId}`, post({ access: 'manager' }, owner))).status === 200 && (await st('GET', '/api/requests')) === 401);
  staff = (await json<{ token: string }>(fetch(`${base}/api/login`, post({ login: 'dilnoza', password: grant.password })))).token;
  ok('boshqaruvchi: Yordamchi, tahlil, kameralar ochiq', (await st('GET', '/api/chat')) === 200 && (await st('GET', '/api/insights')) === 200 && (await st('GET', '/api/cameras')) === 200);
  ok("boshqaruvchiga ham yopiq: kalitlar, xodimlar kirishi, pul tasdig'i, ulash ustasi", (await st('GET', '/api/keys')) === 403 && (await st('GET', '/api/team-access')) === 403
    && (await st('POST', '/api/crm/money/x/approve')) === 403 && (await st('GET', '/api/setup')) === 403);
  ok("oxirida slash bilan ham yopiq (telefon kaliti)", (await st('POST', '/api/voice/key/')) === 403 && (await st('POST', '/api/voice/key')) === 403 && (await st('GET', '/api/keys/')) === 403);
  const viaHub = await fetch(`${R}/api/login`, post({ login: 'dilnoza', password: grant.password }));
  ok("xodim telefondan (Hub orqali) ham kiradi", viaHub.status === 200);

  console.log('\n# Parol va kirishni yopish');
  const reset = await json<{ password: string }>(fetch(`${base}/api/team-access/${staffId}/reset`, post({}, owner)));
  ok("yangi parol: ochiq kirish va eski parol bekor", (await st('GET', '/api/requests')) === 401 && (await fetch(`${base}/api/login`, post({ login: 'dilnoza', password: grant.password }))).status === 401);
  staff = (await json<{ token: string }>(fetch(`${base}/api/login`, post({ login: 'dilnoza', password: reset.password })))).token;
  ok('yangi parol bilan kirdi', (await st('GET', '/api/requests')) === 200);
  await fetch(`${base}/api/team-access/${staffId}`, { method: 'DELETE', headers: bearer(owner) });
  ok("egasi yopdi: xodim darhol chiqdi va qayta kira olmaydi", (await st('GET', '/api/requests')) === 401 && (await fetch(`${base}/api/login`, post({ login: 'dilnoza', password: reset.password }))).status === 401);
  ok("egasining o'z kirishi joyida", (await get(`${base}/api/me`, owner)).status === 200);
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await Promise.all(procs.map(p => stopProcess(p)));
  tgServer.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
