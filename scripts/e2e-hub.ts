/**
 * Hub nazorati sinovi:  npm run test:hub
 *   klinika holatini yuboradi (versiya, baza nashri, disk) → admin ro'yxatida ko'rinadi → kompyuter o'chdi (Palantir to'xtatildi) →
 *   HUB_OFFLINE_MS dan keyin sotuvchiga Telegram'da bir marta «aloqa yo'q» → Palantir qayta yondi → «yana aloqada».
 *   Tashqi zaxira: kunlik zaxira shifrlanib hubga keladi, hub uni o'qiy olmaydi, sotuvchining maxfiy kaliti (va restore-backup) ochadi.
 *   Diagnostika: admin panelidan hubga — holat va jurnallar, kalitlarsiz.
 *   Palantir jamoasi: hubdagi «Panelni ochish» — egasining roziligi bilan (Telegram'da ✅/✖️ yoki doimiy ruxsat), har kirish egasiga
 *   aytiladi va yopiladi, soxtalashtirib bo'lmaydi. O'zi ulangan kompyuter — sotuvchi kompyuter kodi bilan tasdiqlaguncha karantinda.
 * Haqiqiy hub va Palantir jarayonlari, soxta Telegram (sotuvchining boti ham, klinika boti ham — bitta soxta server).
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { SCHEMA_VERSION } from '../server/migrate';
import { unseal } from '../server/offsiteCrypto';
import { parseHubCode } from '../src/lib/hubCode';
import { OWNER, listen, press, say, sent, sleep, tgServer, waitFor, stopProcess, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const VERSION = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version;
const ALERT_CHAT = 5005;
const keyPem = () => { const k = generateKeyPairSync('x25519'); return { public: String(k.publicKey.export({ type: 'spki', format: 'pem' })), private: String(k.privateKey.export({ type: 'pkcs8', format: 'pem' })) }; };
const VENDOR = keyPem(), STRANGER = keyPem();
/** Litsenziya: sinov uchun sotuvchi kaliti (haqiqiysi ~/.palantir/litsenziya.pem) va kompyuter kodi */
const LICENSE = generateKeyPairSync('ed25519'), MACHINE = 'ABCD-1234-EF56-7890';
const tgPort = await listen(tgServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-hub-'));
const HUB_PORT = 3411, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3298, base = `http://127.0.0.1:${PORT}`;
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
const adminList = async () => (await (await fetch(`${HUB}/admin/clinics`, { headers: { authorization: 'Bearer hub-admin-sinov-kaliti-0123456789' } })).json() as { clinics: { id: string; name: string; online: boolean; seenAt: string | null; status: { version: string; schema: number; diskFreeMb: number; businesses: number; problems: unknown[] } | null }[] }).clinics;
/** waitFor'ning so'rov yuboradigan (async) ko'rinishi */
async function until<T>(what: string, fn: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const v = await fn().catch(() => undefined); if (v) return v; }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && String(s.params.text).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const button = (s: Sent | undefined, code: string) => buttons(s).find(b => b.callback_data?.startsWith(`${code}|`))?.callback_data;
const toVendor = (mark: number, needle: string) => sent.slice(mark).filter(s => s.method === 'sendMessage' && Number(s.params.chat_id) === ALERT_CHAT && String(s.params.text).includes(needle));

try {
  start('hub/server.ts', {
    PORT: String(HUB_PORT), HUB_DB: path.join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_ADMIN_KEY: 'hub-admin-sinov-kaliti-0123456789',
    HUB_BOT_TOKEN: '777:HUB', HUB_ALERT_CHAT: String(ALERT_CHAT), HUB_TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, HUB_OFFLINE_MS: '2500', HUB_WATCH_MS: '300',
    HUB_BACKUP_DIR: path.join(work, 'hub-zaxira'),
    LICENSE_SIGNING_KEY: LICENSE.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  });
  ok('hub ishga tushdi', await up(`${HUB}/health`));

  console.log('\n# Admin va kalitlar');
  ok("admin ro'yxati kalitsiz — 401", (await fetch(`${HUB}/admin/clinics`)).status === 401);
  const clinic = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: { authorization: 'Bearer hub-admin-sinov-kaliti-0123456789' }, body: JSON.stringify({ name: 'Shifo Dent' }) })).json() as { clinicId: string; code: string };
  const listed = (await adminList()).find(c => c.id === clinic.clinicId);
  ok("yangi klinika ro'yxatda: hali ko'rinmagan, holati yo'q", !!listed && listed.seenAt === null && !listed.online && listed.status === null, JSON.stringify(listed));
  const fake = await fetch(`${HUB}/api/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${clinic.clinicId}.xato` }, body: '{}' });
  ok("noto'g'ri kalit bilan holat — 401", fake.status === 401);

  console.log('\n# Klinika holati');
  const palantirEnv = {
    // Klinika boti (soxta Telegram): egasini ulash havolasi jamoa kirishiga berilmasligini tekshirish uchun
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '123:CLINIC', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ANTHROPIC_API_KEY: '', ADMIN_PASSWORD: 'admin-pass-1',
    MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '3', BACKUP_FIRST_MS: '800', BACKUP_PUBLIC_KEY: VENDOR.public, GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    PALANTIR_HUB: clinic.code, HEARTBEAT_MS: '400', REQUEST_HOURS: '0-24',
    LICENSE_MACHINE_ID: MACHINE, LICENSE_PUBLIC_KEY: LICENSE.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  let palantir = start('server/index.ts', palantirEnv);
  ok('Palantir ishga tushdi', await up(`${base}/api/health`));
  const seen = await until('holat', async () => (await adminList()).find(c => c.id === clinic.clinicId && c.status?.version), 15_000);
  ok(`admin ro'yxatida: aloqada, versiya ${VERSION}, baza v${SCHEMA_VERSION}, diskdagi joy`, !!seen && seen.online && seen.status!.version === VERSION && seen.status!.schema === SCHEMA_VERSION
    && seen.status!.diskFreeMb > 0 && Array.isArray(seen.status!.problems), JSON.stringify(seen?.status));

  console.log('\n# Tashqi zaxira');
  const admin = { authorization: 'Bearer hub-admin-sinov-kaliti-0123456789' };
  const listBackups = async () => (await (await fetch(`${HUB}/admin/backups`, { headers: admin })).json() as { backups: { clinicId: string; file: string; size: number }[] }).backups;
  const backup = await until('zaxira', async () => (await listBackups()).find(b => b.clinicId === clinic.clinicId), 20_000);
  ok('hubga kunlik zaxira keldi', !!backup && backup.size > 1000, JSON.stringify(backup));
  const blob = Buffer.from(await (await fetch(`${HUB}/admin/backups/${clinic.clinicId}/${backup!.file}`, { headers: admin })).arrayBuffer());
  ok("hubda ochiq ma'lumot yo'q (bazaning SQLite sarlavhasi ko'rinmaydi)", blob.length === backup!.size && !blob.includes('SQLite format 3'));
  const opened = unzipSync(new Uint8Array(unseal(VENDOR.private, blob)));
  ok("sotuvchining maxfiy kaliti bilan ochiladi: baza va session.secret", Buffer.from(opened['palantir.db'] ?? []).subarray(0, 15).toString() === 'SQLite format 3' && !!opened['session.secret'], Object.keys(opened).join(', '));
  ok('begona kalit bilan ochilmaydi', (() => { try { unseal(STRANGER.private, blob); return false; } catch { return true; } })());
  ok("admin kalitsiz yuklab bo'lmaydi", (await fetch(`${HUB}/admin/backups/${clinic.clinicId}/${backup!.file}`)).status === 401);
  const notBackup = await fetch(`${HUB}/api/backup?day=2026-01-01`, { method: 'POST', headers: { authorization: `Bearer ${parseHubCode(clinic.code)!.key}` }, body: 'oddiy matn' });
  ok('zaxira bo\'lmagan fayl — 400, saqlanmaydi', notBackup.status === 400 && !(await listBackups()).some(b => b.file === '2026-01-01.pzb'));
  const keyFile = path.join(work, 'kalit.pem'), pzb = path.join(work, 'z.pzb'), out = path.join(work, 'ochilgan');
  fs.writeFileSync(keyFile, VENDOR.private);
  fs.writeFileSync(pzb, blob);
  const restored = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'scripts/restore-backup.ts', pzb, '--key', keyFile, '--out', out], { encoding: 'utf8' });
  ok('npm run restore-backup: papkaga ochdi', restored.status === 0 && fs.existsSync(path.join(out, 'palantir.db')) && fs.existsSync(path.join(out, 'session.secret')), (restored.stdout + restored.stderr).trim());
  const reported = await until('holatda zaxira', async () => (await adminList()).find(c => c.id === clinic.clinicId && (c.status as { lastOffsite?: { ok: boolean } } | null)?.lastOffsite?.ok), 10_000);
  ok("hub holatida: oxirgi tashqi zaxira yetdi", !!reported);

  console.log('\n# Diagnostika');
  const palantirAdmin = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin-pass-1' }) })).json() as { token: string }).token;
  const diag = await (await fetch(`${base}/api/admin/diag`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${palantirAdmin}` }, body: '{}' })).json() as { sent?: boolean; file?: string };
  ok('admin panelidan diagnostika hubga yuborildi', diag.sent === true && !!diag.file, JSON.stringify(diag));
  const diagText = await (await fetch(`${HUB}/admin/diag/${clinic.clinicId}/${diag.file}`, { headers: admin })).text();
  ok("ichida holat va nashr bor; admin paroli va hub kaliti yo'q", diagText.startsWith('Palantir diagnostika') && diagText.includes(`"version": "${VERSION}"`)
    && !diagText.includes('admin-pass-1') && !diagText.includes(parseHubCode(clinic.code)!.key.split('.')[1]), diagText.slice(0, 80));
  ok("diagnostikani admin kalitsiz o'qib bo'lmaydi", (await fetch(`${HUB}/admin/diag/${clinic.clinicId}/${diag.file}`)).status === 401);

  console.log('\n# Masofadan kirish: panel hub orqali (port ochilmaydi)');
  const R = `${HUB}/c/${clinic.clinicId}`;
  const viaHub = (p: string, init: RequestInit = {}) => fetch(`${R}${p}`, init);
  const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const moved = await fetch(R, { redirect: 'manual' });
  ok("/c/<klinika> → «/» bilan (panel fayllari nisbiy yo'l bilan)", moved.status === 301 && moved.headers.get('location') === `/c/${clinic.clinicId}/`);
  const health = await viaHub('/api/health');
  ok("hub orqali panel serveri javob berdi; Telegram ichida ochilishi mumkin, boshqa saytga joylab bo'lmaydi", health.status === 200 && (await health.json() as { ok: boolean }).ok
    && String(health.headers.get('content-security-policy')).includes('frame-ancestors') && !health.headers.get('x-frame-options'));
  if (fs.existsSync('dist/index.html')) {
    const index = await viaHub('/', { headers: { accept: 'text/html' } });
    ok('panelning o\'zi ham hub orqali ochiladi (nisbiy fayl yo\'llari)', index.status === 200 && (await index.text()).includes('./assets/'));
  }
  await fetch(`${base}/api/admin/businesses`, { ...json({ name: 'Shifo Dent', login: 'shifo', password: 'secret12' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${palantirAdmin}` } });
  const remoteLogin = await (await viaHub('/api/login', json({ login: 'shifo', password: 'secret12' }))).json() as { token?: string };
  ok('egasi hub orqali login va parol bilan kirdi', !!remoteLogin.token && (await viaHub('/api/me', { headers: { authorization: `Bearer ${remoteLogin.token}` } })).status === 200);
  const closed = await Promise.all(['/api/admin/login', '/api/setup', '/api/voice/knowledge'].map(async p => (await viaHub(p, p === '/api/admin/login' ? json({ password: 'admin-pass-1' }) : {})).status));
  ok("masofadan yopiq: admin, ulash ustasi, ovozli agent yo'llari — 403", closed.every(c => c === 403), closed.join(','));
  const tries: number[] = [];
  // Har urinishda boshqa soxta X-Forwarded-For: HUB_TRUST_PROXY yoqilmagan — e'tiborga olinmaydi
  for (let i = 0; i < 9; i++) {
    const attempt = json({ login: 'shifo', password: `xato-${i}` });
    tries.push((await viaHub('/api/login', { ...attempt, headers: { ...attempt.headers, 'x-forwarded-for': `10.0.0.${i}` } })).status);
  }
  const localOk = (await fetch(`${base}/api/login`, json({ login: 'shifo', password: 'secret12' }))).status;
  ok("masofadan parol taxmin qilish — 8 tadan keyin 429, soxta X-Forwarded-For yordam bermaydi (klinikadagi kirishga tegmaydi)", tries.slice(0, 8).every(c => c === 401) && tries[8] === 429 && localOk === 200, tries.join(','));
  ok("noma'lum klinika — 404", (await fetch(`${HUB}/c/0000000000/api/health`)).status === 404);

  console.log("\n# Palantir jamoasi: hubdagi «Panelni ochish» — egasining roziligi bilan");
  const panel = (body: unknown = {}, key = 'hub-admin-sinov-kaliti-0123456789') =>
    fetch(`${HUB}/admin/clinics/${clinic.clinicId}/panel`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  ok('admin kalitisiz — 401', (await panel({}, 'xato')).status === 401);
  const adminPage = await fetch(`${HUB}/admin`);
  ok("admin sahifasi: «Panelni ochish», «Tasdiqlash», boshqa saytga joylab bo'lmaydi", adminPage.status === 200 && adminPage.headers.get('x-frame-options') === 'DENY' && /Panelni ochish[\s\S]*Tasdiqlash|Tasdiqlash[\s\S]*Panelni ochish/.test(await adminPage.text()));
  const owner = { authorization: `Bearer ${remoteLogin.token}` };
  type MeView = { status: { linkUrl: string | null } };
  const ownerMe = await (await viaHub('/api/me', { headers: owner })).json() as MeView;
  const unlinked = await panel();
  ok("egasi ruxsat bermagan va Telegram'ga ulanmagan — jamoa kira olmaydi (standart: o'chiq)", unlinked.status === 403 && String((await unlinked.json() as { error?: string }).error).includes("Telegram'ga ulanmagan"));
  let mark = sent.length;
  say(OWNER, `/start ${String(ownerMe.status.linkUrl).split('start=')[1]}`);
  ok('egasi botga ulandi', !!(await waitFor('egasi ulandi', () => toOwner(mark, 'ulandi') || toOwner(mark, 'Shifo Dent'), 15_000)));
  /** Jamoa «Panelni ochish» bosadi, egasi Telegram'da javob beradi */
  const askTeam = async (answer: 'ja' | 'jx') => {
    const from = sent.length;
    const pending = panel();
    const asked = await waitFor("egasidan so'rov", () => toOwner(from, 'kirmoqchi'), 15_000);
    const data = button(asked, answer);
    if (asked && data) press(OWNER, data, asked.id!);
    return { asked, response: await pending, from };
  };
  const denied = await askTeam('jx');
  ok("jamoa kirmoqchi: egasiga Telegram'da ✅/✖️; rad etsa — kirish yo'q", !!button(denied.asked, 'ja') && denied.response.status === 403
    && String((await denied.response.json() as { error?: string }).error).includes('rad'));
  const allowed = await askTeam('ja');
  let teamToken = ((await allowed.response.json()) as { token?: string }).token ?? '';
  const asTeam = (p: string, init: RequestInit = {}) => viaHub(p, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${teamToken}` } });
  ok("egasi ruxsat berdi — jamoa kirdi (bitta biznes — so'ralmaydi)", !!teamToken && (await asTeam('/api/me')).status === 200);
  const told = await waitFor('kirdi xabari', () => toOwner(allowed.from, 'kirdi'), 10_000);
  ok("har kirish egasiga Telegram'da aytiladi — «Kirishni yopish» tugmasi bilan", !!button(told, 'jy'), String(told?.params.text ?? ''));
  const wizard = await Promise.all(['/api/setup', '/api/admin/login', '/api/voice/knowledge'].map(async p => (await asTeam(p, p === '/api/admin/login' ? json({ password: 'admin-pass-1' }) : {})).status));
  ok('jamoaga ulash ustasi masofadan ochiq; admin va ovozli agent — baribir yopiq', wizard[0] === 200 && wizard[1] === 403 && wizard[2] === 403, wizard.join(','));
  ok("klinikaning o'zida jamoa kirishini olib bo'lmaydi (faqat hub orqali)", (await fetch(`${base}/api/login/support`, json({}))).status === 403);
  const forged = await viaHub('/api/login/support', { ...json({}), headers: { 'content-type': 'application/json', 'x-palantir-support': 'x', 'x-palantir-relay': 'x' } });
  ok("oddiy /c/ so'rovi jamoa belgisini soxtalashtira olmaydi", forged.status === 403);
  const upper = [(await viaHub('/API/admin/login', json({ password: 'admin-pass-1' }))).status, (await viaHub('/Api/Setup', { headers: owner })).status];
  ok("yo'l katta harf bilan ham yopiq (/API/admin, egasiga /Api/Setup)", upper.every(c => c === 403), upper.join(','));
  const teamMe = await (await asTeam('/api/me')).json() as MeView;
  const teamSetup = await (await asTeam('/api/setup')).json() as { setup: MeView };
  ok("egasini Telegram'ga ulash havolasi jamoaga berilmaydi (o'zini egasi qilib ola olmasin)", !!ownerMe.status.linkUrl?.includes('?start=o-') && teamMe.status.linkUrl === null && teamSetup.setup.status.linkUrl === null,
    `${ownerMe.status.linkUrl} / ${teamMe.status.linkUrl}`);
  ok('admin sahifasi panel oynasidan ajratilgan (COOP)', adminPage.headers.get('cross-origin-opener-policy') === 'same-origin');
  const access = await (await viaHub('/api/account/support', { headers: owner })).json() as { allowed: boolean; until: string | null; mine: boolean; visits: { at: string }[] };
  ok("egasi Sozlamalarda ko'radi: doimiy ruxsat yo'q, bir martalik ruxsat muddati, jamoa kirgani yozilgan", !access.allowed && !!access.until && !access.mine && access.visits.length === 1, JSON.stringify(access));
  const teamPut = await asTeam('/api/account/support', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }) });
  ok("jamoa ruxsatni o'zgartira olmaydi va egasini chiqarib yubora olmaydi", teamPut.status === 403 && (await asTeam('/api/account/sign-out-others', json({}))).status === 403);
  const station = await asTeam('/api/phone/stations', json({ name: 'Resepshn' }));
  ok("jamoa telefon stansiyasi kodini ololmaydi (kirish yopilgandan keyin ham qolib ketadigan kalit)", station.status === 403);
  mark = sent.length;
  press(OWNER, button(told, 'jy')!, told!.id!);
  ok("egasi Telegram'da «Kirishni yopish» — jamoa darhol chiqarildi", !!(await until('yopildi', async () => ((await asTeam('/api/me')).status === 401 ? true : undefined), 10_000)));
  ok("egasining o'z kirishi ishlayveradi", (await viaHub('/api/me', { headers: owner })).status === 200);
  await viaHub('/api/account/support', { method: 'PUT', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }) });
  mark = sent.length;
  const standing = await panel();
  teamToken = ((await standing.json()) as { token?: string }).token ?? '';
  ok("egasi doimiy ruxsat berdi: jamoa so'ramasdan kiradi, egasiga baribir aytiladi", standing.status === 200 && (await asTeam('/api/me')).status === 200
    && !toOwner(mark, 'kirmoqchi') && !!(await waitFor('kirdi', () => toOwner(mark, 'kirdi'), 10_000)));
  const old = teamToken;
  const off = await viaHub('/api/account/support', { method: 'PUT', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ allowed: false }) });
  ok("egasi Sozlamalarda yopdi: jamoaning ochiq kirishi darhol bekor", off.status === 200 && (await asTeam('/api/me')).status === 401);
  await viaHub('/api/account/support', { method: 'PUT', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }) });
  const fresh = await (await panel()).json() as { token?: string };
  ok("egasi qayta yoqdi: eski jamoa kirishi qaytmaydi, yangisi ishlaydi", (await viaHub('/api/me', { headers: { authorization: `Bearer ${old}` } })).status === 401
    && (await viaHub('/api/me', { headers: { authorization: `Bearer ${fresh.token}` } })).status === 200);
  await fetch(`${base}/api/admin/businesses`, { ...json({ name: 'Ikkinchi', login: 'ikkinchi', password: 'secret12' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${palantirAdmin}` } });
  const which = await panel();
  const choice = await which.json() as { businesses?: { id: string; name: string }[] };
  const second = choice.businesses?.find(b => b.name === 'Ikkinchi');
  const secondTry = second ? await panel({ business: second.id }) : null;
  ok("bir nechta biznes — qaysi biri so'raladi; har biznesda o'z egasining roziligi kerak", which.status === 409 && choice.businesses?.length === 2 && !!second
    && secondTry?.status === 403, JSON.stringify(choice));

  console.log('\n# Litsenziya: kalitsiz muddat');
  type LicenseView = { activated: boolean; machineId: string; daysLeft: number; blocked: boolean };
  const lic = async () => ((await (await fetch(`${base}/api/license`)).json()) as { license: LicenseView }).license;
  const before = await lic();
  ok('yangi o\'rnatish: aktivlashtirilmagan, 14 kun qoldi, panel ochiq', !before.activated && before.daysLeft === 14 && !before.blocked && before.machineId === MACHINE
    && (await viaHub('/api/me', { headers: owner })).status === 200, JSON.stringify(before));
  const wrong = await fetch(`${base}/api/license`, json({ key: 'PAL1-soxta-kalit' }));
  ok("noto'g'ri kalit — 400, aktivlashmaydi", wrong.status === 400 && !(await lic()).activated);
  const licShown = await until('litsenziya holati', async () => (await adminList()).find(c => c.id === clinic.clinicId && (c.status as { license?: { activated: boolean; daysLeft: number } } | null)?.license?.daysLeft === 14), 10_000);
  ok("hub ro'yxatida: litsenziyasiz, 14 kun", !!licShown);
  ok("hub admin kalitisiz litsenziya bermaydi", (await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/license`, { method: 'POST' })).status === 401);

  console.log("\n# Kompyuter o'chdi");
  mark = sent.length;
  await stopProcess(palantir);
  const lost = await waitFor('aloqa yo\'q', () => toVendor(mark, "aloqa yo'q")[0], 15_000);
  ok("sotuvchiga: «Shifo Dent» bilan aloqa yo'q — oxirgi ko'ringan vaqti bilan", !!lost && String(lost.params.text).includes('«Shifo Dent»') && /\d{2}:\d{2}/.test(String(lost.params.text)), String(lost?.params.text ?? ''));
  ok("admin ro'yxatida — aloqada emas", !(await adminList()).find(c => c.id === clinic.clinicId)!.online);
  await sleep(1500);
  ok('takrorlanmaydi (bir marta)', toVendor(mark, "aloqa yo'q").length === 1);
  const offline = await until('aloqada emas sahifasi', async () => {
    const r = await fetch(`${HUB}/c/${clinic.clinicId}/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
    return r.status === 503 || r.status === 504 ? await r.text() : undefined;
  }, 30_000);
  ok("panel havolasi: kompyuter o'chiq — «aloqada emas» sahifasi (ko'pi bilan 15 soniya, 2 daqiqa kutib qolmaydi)", !!offline?.includes('aloqada emas'));
  // O'chiq turganda 30 kun o'tdi (litsenziya fayli: shu kompyuterning birinchi ishga tushgan payti)
  const licFile = path.join(work, 'data', 'litsenziya.json');
  const licData = JSON.parse(fs.readFileSync(licFile, 'utf8')) as { key: string | null; firstRun: Record<string, string> };
  fs.writeFileSync(licFile, JSON.stringify({ ...licData, firstRun: { ...licData.firstRun, [MACHINE]: new Date(Date.now() - 30 * 86_400_000).toISOString() } }));

  console.log('\n# Kompyuter qayta yondi');
  mark = sent.length;
  palantir = start('server/index.ts', palantirEnv);
  ok('Palantir qayta ishga tushdi', await up(`${base}/api/health`));
  ok('sotuvchiga: «Shifo Dent» yana aloqada', !!(await waitFor('yana aloqada', () => toVendor(mark, '«Shifo Dent» yana aloqada')[0], 15_000)));
  ok("admin ro'yxatida — yana aloqada", (await adminList()).find(c => c.id === clinic.clinicId)!.online);

  console.log('\n# Litsenziya: muddat tugadi → Hub\'dan bir bosishda');
  const expired = await lic();
  const blockedMe = await viaHub('/api/me', { headers: owner });
  ok('30 kundan keyin: panel yopiq (LITSENZIYA), litsenziya holati va kirish ochiq', expired.blocked && expired.daysLeft === 0 && blockedMe.status === 403
    && (await blockedMe.json() as { code?: string }).code === 'LITSENZIYA' && (await fetch(`${base}/api/health`)).ok);
  const locked = await waitFor('panel yopildi xabari', () => toOwner(mark, 'paneli yopildi'), 15_000);
  ok("egasiga Telegram'da: panel yopildi, bot ishlayapti, kompyuter kodi bilan (faqat Telegram ishlatadigan egasi ham biladi)", !!locked && String(locked.params.text).includes(MACHINE), String(locked?.params.text ?? ''));
  await sleep(1000);
  ok('ogohlantirish takrorlanmaydi', sent.slice(mark).filter(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && String(s.params.text).includes('paneli yopildi')).length === 1);
  const given = await fetch(`${HUB}/admin/clinics/${clinic.clinicId}/license`, { method: 'POST', headers: admin });
  const givenJson = await given.json() as { license?: LicenseView; error?: string };
  ok("hub «Aktivlashtirish»: kod so'raldi, imzolandi, klinikaga yuborildi", given.status === 200 && givenJson.license?.activated === true, JSON.stringify(givenJson));
  ok('panel yana ochiq, holat — aktivlashtirilgan', (await lic()).activated && (await viaHub('/api/me', { headers: owner })).status === 200);
  const afterList = (await adminList()).find(c => c.id === clinic.clinicId);
  ok("hub ro'yxatida darhol: litsenziya bor", (afterList?.status as { license?: { activated: boolean } } | null)?.license?.activated === true);

  console.log("\n# O'zi ulanish: yangi o'rnatilgan kompyuter Hub kodini o'zi oladi");
  const NEW_MACHINE = '1111-2222-3333-4444', NEW_PORT = 3297;
  const newcomerEnv = {
    ...palantirEnv, PORT: String(NEW_PORT), DATA_DIR: path.join(work, 'data-yangi'), BOT_TOKEN: '', PALANTIR_HUB: '', HUB_URL: HUB, LICENSE_MACHINE_ID: NEW_MACHINE,
  };
  type Listed = { id: string; name: string; online: boolean; self?: boolean; approved?: boolean; machineId?: string | null };
  const mine = async () => (await adminList() as Listed[]).filter(c => c.machineId === NEW_MACHINE);
  let newcomer = start('server/index.ts', newcomerEnv);
  ok('yangi Palantir ishga tushdi (Hub kodisiz)', await up(`http://127.0.0.1:${NEW_PORT}/api/health`));
  const joined = await until("o'zi ulangan kompyuter", async () => (await mine()).find(c => c.online), 15_000);
  ok("hub /admin ro'yxatida: o'zi ulangan, tasdiqlanmagan, kompyuter kodi va nomi bilan, aloqada", !!joined && joined.self === true && joined.approved === false && joined.name.length > 0, JSON.stringify(joined));
  const N = `${HUB}/c/${joined!.id}`;
  const quarantined = [await fetch(`${N}/`, { headers: { accept: 'text/html' } }), await fetch(`${N}/api/health`)];
  const qPage = await quarantined[0].text();
  ok("karantin: tasdiqlanmagan kompyuter /c/ orqali hech narsa bermaydi (sahifa ham, API ham) — 403", quarantined.every(r => r.status === 403) && qPage.includes('tasdiqlanmagan') && !qPage.includes('./assets/'),
    quarantined.map(r => r.status).join(','));
  const qPanel = await fetch(`${HUB}/admin/clinics/${joined!.id}/panel`, { method: 'POST', headers: admin });
  const qLicense = await fetch(`${HUB}/admin/clinics/${joined!.id}/license`, { method: 'POST', headers: admin });
  ok('karantin: jamoa kirishi va litsenziya yopiq — 409', qPanel.status === 409 && qLicense.status === 409, `${qPanel.status},${qLicense.status}`);
  const approve = (id: string, machineId: string, key = admin) => fetch(`${HUB}/admin/clinics/${id}/approve`, { method: 'POST', headers: key, body: JSON.stringify({ machineId }) });
  ok('tasdiqlash admin kalitisiz — 401', (await approve(joined!.id, NEW_MACHINE, { authorization: 'Bearer xato' })).status === 401);
  ok("boshqa kompyuter kodi bilan tasdiqlanmaydi — 409", (await approve(joined!.id, '9999-9999-9999-9999')).status === 409);
  const approvedNew = await approve(joined!.id, NEW_MACHINE.toLowerCase().replace(/-/g, ''));
  ok('egasi aytgan kod bilan tasdiqlandi (yozilishi farq qilsa ham) — panel hub orqali ochiladi', approvedNew.status === 200 && (await fetch(`${N}/api/health`)).status === 200);
  await stopProcess(newcomer);
  newcomer = start('server/index.ts', newcomerEnv);
  ok('qayta yonganda ham ishlaydi', await up(`http://127.0.0.1:${NEW_PORT}/api/health`));
  await sleep(1500);
  ok("qayta yonganda ikkinchi marta ro'yxatdan o'tmaydi (saqlangan kod bilan)", (await mine()).length === 1, JSON.stringify(await mine()));
  const register = (machineId: string) => fetch(`${HUB}/api/register`, { method: 'POST', body: JSON.stringify({ machineId, name: 'sinov' }) });
  ok("noto'g'ri kompyuter kodi — 400", (await register('xato')).status === 400);
  const regs: Response[] = [];
  for (let i = 0; i < 3; i++) regs.push(await register('5555-6666-7777-8888'));
  ok("bir manzildan sutkada 3 tadan ko'p emas — keyingisi 429", regs.map(r => r.status).join() === '200,200,429', regs.map(r => r.status).join());
  const [a, b] = await Promise.all(regs.slice(0, 2).map(r => r.json() as Promise<{ clinicId: string; code: string }>));
  const fakeBackup = await fetch(`${HUB}/api/backup?day=2026-01-02`, {
    method: 'POST', headers: { authorization: `Bearer ${parseHubCode(a.code)!.key}` }, body: Buffer.concat([Buffer.from('PALANTIR-ZAXIRA-1\n'), Buffer.alloc(4096)]),
  });
  ok("karantin: tasdiqlanmagan kompyuter zaxira yubora olmaydi (hub diskini to'ldira olmaydi) — 403", fakeBackup.status === 403);
  ok("bir xil kod bilan ikki yozuv: biri tasdiqlanadi, ikkinchisi — yo'q (takror yoki soxta)",
    (await approve(a.clinicId, '5555-6666-7777-8888')).status === 200 && (await approve(b.clinicId, '5555-6666-7777-8888')).status === 409);
  const delApproved = await fetch(`${HUB}/admin/clinics/${a.clinicId}/delete`, { method: 'POST', headers: admin });
  const delFake = await fetch(`${HUB}/admin/clinics/${b.clinicId}/delete`, { method: 'POST', headers: admin });
  ok("tasdiqlangan yozuv o'chirilmaydi, tasdiqlanmagani o'chadi", delApproved.status === 409 && delFake.status === 200 && !(await adminList()).some(c => c.id === b.clinicId));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  // Tugashini kutib: ohista to'xtayotgan server keyingi sinovning porti va hubiga xalaqit bermasin
  await Promise.all(procs.map(p => stopProcess(p)));
  tgServer.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
