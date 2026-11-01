/**
 * Kim nima qila oladi — haqiqiy brauzerda (ko'rinmas oyna):  npm run build && npm run test:ui-team
 *   Hub /admin: asoschi o'z logini bilan kiradi, «Jamoa»da o'rnatuvchi qo'shadi (parol bir marta), «Jurnal»da ko'radi;
 *   o'rnatuvchiga «Jamoa» va «Jurnal» yo'q.
 *   Klinika: egasi Sozlamalar → Xodimlar'da xodimga «Qabulxona» kirishini beradi; xodim kirsa — faqat Qabulxona, Sozlamalarsiz.
 * Skrinshotlar saqlanadi (yo'li oxirida).
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { listen, sleep, stopProcess, tgServer } from './fakes';
import { chromePath } from './chrome';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const ADMIN_KEY = 'hub-admin-sinov-kaliti-ui-jamoa-0123';
const tgPort = await listen(tgServer);
const work = mkdtempSync(join(tmpdir(), 'palantir-ui-jamoa-'));
const shots = join(tmpdir(), 'palantir-ui-jamoa-shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const HUB_PORT = 3416, HUB = `http://127.0.0.1:${HUB_PORT}`;
const PORT = 3288, base = `http://127.0.0.1:${PORT}`;
const procs: ChildProcess[] = [];
process.on('exit', () => { for (const p of procs) p.kill(); });
let log = '';
const start = (script: string, env: Record<string, string>) => {
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', script], { env: { ...process.env, DOTENV: '0', ASTERISK_WSL: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  procs.push(p);
};
const up = async (url: string) => { for (let i = 0; i < 240; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
const post = (body: unknown, token?: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

start('hub/server.ts', { PORT: String(HUB_PORT), HUB_DB: join(work, 'hub.db'), HUB_PUBLIC_URL: HUB, HUB_ADMIN_KEY: ADMIN_KEY, HUB_BACKUP_DIR: join(work, 'hub-zaxira') });
start('server/index.ts', {
  PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: join(work, 'data'), ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
  BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
  TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ADMIN_PASSWORD: '', SESSION_SECRET: 'ui-jamoa-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
});

const browser = await chromium.launch({ executablePath: chromePath() });
const errors: string[] = [];
let n = 0;
const shot = (p: Page, name: string) => p.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
const watch = (p: Page) => {
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
};

try {
  ok('hub va Palantir ishga tushdi', await up(`${HUB}/health`) && await up(`${base}/api/health`));
  const founder = await (await fetch(`${HUB}/admin/team`, post({ name: "Ulug'bek", login: 'ulugbek', role: 'founder' }, ADMIN_KEY))).json() as { password: string };

  console.log('\n# Hub /admin: asoschi');
  const hub = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  watch(hub);
  await hub.goto(`${HUB}/admin`);
  await hub.locator('#lg').fill('ulugbek');
  await hub.locator('#k').fill(founder.password);
  await hub.locator('#key button').click();
  await hub.locator('#bar').waitFor({ timeout: 10_000 });
  ok("o'z logini bilan kirdi: ismi va roli", ((await hub.locator('#me').textContent()) ?? '').includes("Ulug'bek · asoschi"));
  ok('«Jamoa» va «Jurnal» ko\'rinadi', await hub.locator('#tabTeam').isVisible() && await hub.locator('#tabAudit').isVisible());
  await hub.locator('#tabTeam').click();
  await hub.locator('#mn').fill('Sardor');
  await hub.locator('#ml').fill('sardor');
  await hub.locator('#addm button').click();
  await hub.locator('#mcode code').waitFor({ timeout: 10_000 });
  const line = (await hub.locator('#mcode code').textContent()) ?? '';
  const installerPass = /parol: (\S+)/.exec(line)?.[1] ?? '';
  ok("o'rnatuvchi qo'shildi — login va parol bir marta", line.includes('login: sardor') && installerPass.length >= 12);
  ok("ro'yxatda: Sardor · o'rnatuvchi", ((await hub.locator('#members').textContent()) ?? '').includes("sardor · o'rnatuvchi"));
  await hub.locator('#tabAudit').click();
  await hub.locator('#log li').first().waitFor({ timeout: 10_000 });
  ok("jurnalda: «Ulug'bek jamoaga qo'shdi»", ((await hub.locator('#log').textContent()) ?? '').includes("Ulug'bek jamoaga qo'shdi"));
  await shot(hub, 'hub-asoschi');
  await hub.locator('#out').click();
  ok('«Chiqish» — kirish oynasi qaytdi', await hub.locator('#key').isVisible() && !(await hub.locator('#bar').isVisible()));

  console.log("\n# Hub /admin: o'rnatuvchi");
  await hub.locator('#lg').fill('sardor');
  await hub.locator('#k').fill(installerPass);
  await hub.locator('#key button').click();
  await hub.locator('#bar').waitFor({ timeout: 10_000 });
  ok("o'rnatuvchiga «Jamoa» va «Jurnal» yo'q, «Yangi klinika» bor", !(await hub.locator('#tabTeam').isVisible()) && !(await hub.locator('#tabAudit').isVisible()) && await hub.locator('#new').isVisible());
  await shot(hub, 'hub-ornatuvchi');

  console.log('\n# Klinika: egasi xodimga kirish beradi');
  const setup = await (await fetch(`${base}/api/login/setup`, post({}))).json() as { token: string };
  const given = await (await fetch(`${base}/api/handover`, post({ login: 'shifodent' }, setup.token))).json() as { password: string };
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  watch(page);
  await page.goto(`${base}/#/`);
  await page.getByLabel('Login').fill('shifodent');
  await page.getByLabel('Parol').fill(given.password);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForFunction(() => !document.querySelector('h1')?.textContent?.includes('Kabinetga kirish'), null, { timeout: 15_000 });
  await page.goto(`${base}/#/sozlamalar/xodimlar`);
  await page.getByText('Xodimlar kirishi', { exact: true }).waitFor({ timeout: 15_000 });
  await page.locator('#staff-name').fill('Dilnoza');
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByRole('button', { name: 'Qabulxona sifatida kirsin' }).waitFor({ timeout: 10_000 });
  page.once('dialog', d => { void d.accept('dilnoza'); });
  await page.getByRole('button', { name: 'Qabulxona sifatida kirsin' }).click();
  const creds = page.getByTestId('staff-creds');
  await creds.waitFor({ timeout: 10_000 });
  const text = (await creds.textContent()) ?? '';
  const staffPass = /parol: (\S+)/.exec(text)?.[1] ?? '';
  ok('xodimga login va parol bir marta ko\'rsatildi', text.includes('login: dilnoza') && staffPass.length >= 10);
  ok("ro'yxatda: Qabulxona · dilnoza · hali kirmagan", ((await page.locator('main').textContent()) ?? '').includes('Qabulxona · dilnoza · hali kirmagan'));
  await shot(page, 'egasi-xodimlar');

  console.log('\n# Xodim kiradi — faqat Qabulxona');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${base}/#/`);
  await page.reload();
  await page.getByLabel('Login').fill('dilnoza');
  await page.getByLabel('Parol').fill(staffPass);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/qabulxona'), null, { timeout: 15_000 });
  ok('xodim to\'g\'ri Qabulxonaga tushdi', page.url().includes('#/qabulxona'));
  const nav = page.getByRole('navigation', { name: "Bo'limlar" });
  ok("yon ustunda faqat Qabulxona: Yordamchi, Miya, Sozlamalar yo'q", await nav.getByRole('link', { name: 'Qabulxona' }).count() > 0
    && !(await nav.getByRole('link', { name: 'Miya' }).count()) && !(await nav.getByRole('link', { name: 'Sozlamalar' }).count()) && !(await nav.getByRole('link', { name: 'Palantir', exact: true }).count()));
  await page.goto(`${base}/#/sozlamalar`);
  await page.waitForFunction(() => window.location.hash.startsWith('#/qabulxona'), null, { timeout: 10_000 });
  ok('Sozlamalar manzilini yozsa ham — Qabulxonaga qaytadi', page.url().includes('#/qabulxona'));
  await sleep(800);
  await shot(page, 'xodim-qabulxona');
  ok("brauzerda xato yo'q", !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await browser.close();
  await Promise.all(procs.map(p => stopProcess(p)));
  tgServer.close();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\nSkrinshotlar: ${shots}`);
console.log(`${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
process.exit(failed ? 1 : 0);
