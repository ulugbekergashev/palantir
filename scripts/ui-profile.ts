/**
 * Bitta kompyuter — bitta profil: ulash ustasi haqiqiy brauzerda (ko'rinmas oyna).
 *   Kirish sahifasi «sozlanmoqda» deydi → «Sozlashni davom ettirish» — admin parolisiz, Hub kodisiz → klinika ma'lumoti saqlanadi →
 *   «Klinika kalitlari» → «Egasiga topshirish»: login va parol bir marta → kirish sahifasi, endi faqat login-parol bilan.
 * Skrinshotlar saqlanadi (yo'li oxirida). Ishga tushirish: npm run build && npm run test:ui-profile
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { listen, sleep, stopProcess, tgServer } from './fakes';
import { chromePath } from './chrome';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer);
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-ui-profil-'));
const shots = join(tmpdir(), 'palantir-ui-profil-shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const PORT = 3296, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
    BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'ui-profil-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => server.kill());
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const browser = await chromium.launch({ executablePath: chromePath() });
const errors: string[] = [];
let n = 0;
const shot = (p: Page, name: string) => p.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });

  console.log('\n# Kirish sahifasi: profil hali egasiga topshirilmagan');
  await page.goto(`${base}/#/`);
  const banner = page.getByText('Palantir hali sozlanmoqda');
  await banner.waitFor({ timeout: 15_000 });
  ok('«Palantir hali sozlanmoqda» va «Sozlashni davom ettirish»', await page.getByRole('link', { name: 'Sozlashni davom ettirish' }).isVisible());
  await shot(page, 'kirish-sozlanmoqda');
  await page.getByRole('link', { name: 'Sozlashni davom ettirish' }).click();

  console.log('\n# Ulash ustasi — admin parolisiz');
  await page.locator('#p-name').waitFor({ timeout: 15_000 });
  ok('usta parolsiz ochildi: birinchi qadam — klinika ma\'lumotlari', !(await page.getByText('Admin paroli').count()));
  // Kompyuter Hub'ga o'zi ulanadi: «phub.» kodi so'ralmaydi (zaxira yo'l — «Kalitlar» maydoni)
  ok("Hub ulanish kodi so'ralmaydi", !(await page.getByText('Palantir ulanish kodi').count()) && !(await page.locator('#hub-code').count()));
  ok('klinikani tanlash/qo\'shish yo\'q (profil bitta)', !(await page.getByRole('button', { name: /Yangi klinika/ }).count()));
  await page.locator('#p-name').fill('Shifo Dent');
  await page.locator('#p-address').fill('Toshkent, Chilonzor 7');
  // Yangi profil sohasiz: soha yozilmaguncha saqlanmaydi (AI shunga qarab gapiradi)
  ok("yangi profil klinika emas: soha bo'sh va majburiy", await page.locator('#p-industry').inputValue() === '' && await page.locator('#p-industry').evaluate(el => (el as HTMLInputElement).required));
  await page.locator('#p-industry').fill('stomatologiya');
  await page.getByRole('button', { name: 'Saqlash' }).click();
  await page.getByRole('status').filter({ hasText: 'Saqlandi' }).waitFor({ timeout: 10_000 });
  ok('klinika nomi saqlandi va yon panelda ko\'rinadi', await page.locator('aside').getByText('Shifo Dent').isVisible());
  await shot(page, 'klinika');

  await page.locator('aside').getByRole('button', { name: /Kalitlar/ }).click();
  await page.getByText('Klinika kalitlari').waitFor({ timeout: 10_000 });
  ok('«Klinika kalitlari» (server kalitlari emas)', !(await page.getByText('Server kalitlari').count()));
  ok("jadvalda Hub kodi yo'q (egasi bilmasdan o'chirib qo'ymasin)", !(await page.getByText('Palantir Hub kodi').count()));
  await shot(page, 'kalitlar');

  console.log('\n# Egasiga topshirish');
  await page.locator('aside').getByRole('button', { name: /Tayyor/ }).click();
  await page.locator('#handover-login').waitFor({ timeout: 10_000 });
  ok('login nomzodi klinika nomidan', (await page.locator('#handover-login').inputValue()) === 'shifodent');
  ok('admin sahifasiga havola yo\'q', !(await page.getByRole('link', { name: 'Admin sahifasi' }).count()));
  await shot(page, 'topshirish');
  await page.getByRole('button', { name: 'Egasiga topshirish' }).click();
  const creds = page.getByTestId('handover-creds');
  await creds.waitFor({ timeout: 10_000 });
  const text = (await creds.textContent()) ?? '';
  const password = /parol: (\S+)/.exec(text)?.[1] ?? '';
  ok('login va parol bir marta ko\'rsatildi', text.includes('login: shifodent') && password.length >= 12, text.replace(password, '•••'));
  await shot(page, 'topshirildi');
  const leave = page.getByRole('button', { name: 'Tayyor — kirish sahifasiga' });
  ok('parol yozib olinmaguncha «Tayyor» bosilmaydi', await leave.isDisabled());
  await page.getByLabel('Login va parolni yozib oldim').check();
  await leave.click();

  console.log('\n# Endi — faqat login va parol bilan');
  await page.getByRole('heading', { name: 'Kabinetga kirish' }).waitFor({ timeout: 15_000 });
  await sleep(600);
  ok('«sozlanmoqda» yo\'q', !(await page.getByText('Palantir hali sozlanmoqda').count()));
  // Klinikada admin yo'q: havola yo'q, «Parolni unutdingizmi?» — Telegram orqali (server/passwordReset.ts)
  ok("kirish sahifasida «Admin» havolasi yo'q, «Parolni unutdingizmi?» bor", !(await page.getByRole('link', { name: /admin/i }).count())
    && await page.getByRole('button', { name: 'Parolni unutdingizmi?' }).isVisible());
  await page.getByRole('button', { name: 'Parolni unutdingizmi?' }).click();
  await page.getByRole('status').waitFor({ timeout: 10_000 });
  ok("Telegram ulanmagan — «Palantir xodimiga murojaat qiling»", (await page.getByRole('status').textContent())?.includes('Palantir xodimiga'));
  await page.goto(`${base}/#/admin`);
  await page.getByRole('heading', { name: 'Kabinetga kirish' }).waitFor({ timeout: 15_000 });
  ok("#/admin — kirish sahifasiga qaytaradi (admin paroli so'ralmaydi)", !(await page.getByLabel('Admin paroli').count()) && page.url().endsWith('#/'));
  await page.getByLabel('Login').fill('shifodent');
  await page.getByLabel('Parol').fill(password);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForFunction(() => !document.querySelector('h1')?.textContent?.includes('Kabinetga kirish'), null, { timeout: 15_000 });
  ok('egasi berilgan parol bilan kirdi', !(await page.getByRole('heading', { name: 'Kabinetga kirish' }).count()));
  await page.goto(`${base}/#/ulash`);
  await page.locator('#p-name').waitFor({ timeout: 15_000 });
  ok('egasi ham ulash ustasini ochadi (topshirish tugmasisiz)', !(await page.locator('#handover-login').count()));
  await shot(page, 'egasi-ustada');
  ok("brauzerda xato yo'q", !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await browser.close();
  await stopProcess(server);
  tgServer.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\nSkrinshotlar: ${shots}`);
console.log(`${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
process.exit(failed ? 1 : 0);
