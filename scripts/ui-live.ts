/**
 * Panelning brauzer sinovi (to'liq versiya): server + soxta Telegram/Claude + tayyor build.
 * Talab: npm run build; Chrome o'rnatilgan; playwright-core (PLAYWRIGHT_CORE yo'li).
 * Ishga tushirish: npx tsx scripts/ui-live.ts <skrinshot papkasi>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleClinic } from '../src/data/sampleClinic';
import { OWNER, PATIENT, aiServer, listen, say, sent, shareContact, sleep, tgServer, waitFor } from './fakes';

const OUT = process.argv[2] || join(tmpdir(), 'cerebro-ui');
mkdirSync(OUT, { recursive: true });
const require = createRequire(process.env.PLAYWRIGHT_CORE || 'C:/Users/Hp Vitus Gaming/Desktop/denta7/package.json');
// playwright-core bu loyihada o'rnatilmagan (boshqa papkadan olinadi) — tipi qo'lda
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require('playwright-core') as { chromium: any };

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer);
const aiPort = await listen(aiServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-ui-'));
const PORT = 3291;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const errors: string[] = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tashkent', locale: 'uz-UZ', acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m: { type: () => string; text: () => string }) => { if (m.type() === 'error' && !/401|409|400/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
page.on('dialog', (d: { accept: () => void }) => d.accept());
const shot = (name: string, full = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });

try {
  console.log('\n# Admin');
  await page.goto(`${base}/#/admin`, { waitUntil: 'networkidle' });
  await page.getByLabel('Admin paroli').fill('admin-pass-1');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByLabel('Klinika nomi').fill('Marvarid Dent');
  await page.getByLabel('Login').fill('marvarid');
  await page.getByLabel('Parol').fill('secret12');
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText("«Marvarid Dent» qo'shildi").waitFor({ timeout: 10000 });
  ok('admin: klinika qo\'shildi, ro\'yxatda', await page.getByRole('cell', { name: 'Marvarid Dent' }).isVisible());
  await shot('01-admin');

  console.log('\n# Klinika kirishi');
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.getByLabel('Login').fill('marvarid');
  await page.getByLabel('Parol').fill('xato-parol');
  await page.getByRole('button', { name: 'Kirish' }).click();
  ok("noto'g'ri parol — xabar", await page.getByRole('alert').filter({ hasText: "noto'g'ri" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.getByLabel('Parol').fill('secret12');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByRole('heading', { name: 'Haftalik paket' }).waitFor({ timeout: 15000 });
  ok('kirdi — haftalik paket ochildi', true);

  // Profil: API orqali namuna ma'lumot (onboarding formasini keyin brauzerda tekshiramiz)
  const token = await page.evaluate(() => localStorage.getItem('cerebro_token'));
  const put = await fetch(`${base}/api/clinic`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(sampleClinic()) });
  ok('profil saqlandi (API)', put.ok);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('main article').first().waitFor();
  await page.getByText('AI', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {});
  const aiChips = await page.locator('main article').getByText('AI', { exact: true }).count();
  ok('AI yozgan postlar belgilangan', aiChips >= 3, `${aiChips} ta`);
  ok('5 ta material', (await page.locator('main article').count()) === 5);
  await shot('02-paket');

  console.log('\n# Klinika va brend (avtosaqlash)');
  await page.getByRole('button', { name: 'Klinika va brend' }).first().click();
  const nameInput = page.locator('label', { hasText: 'Klinika nomi' }).locator('input');
  await nameInput.fill('Marvarid Dent Plus');
  await page.getByText('Saqlandi ✓').waitFor({ timeout: 8000 });
  const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  ok('avtosaqlash: serverda yangi nom', me.clinic.name === 'Marvarid Dent Plus');
  await nameInput.fill('Marvarid Dent');
  await page.getByText('Saqlandi ✓').waitFor({ timeout: 8000 });
  await shot('03-klinika', true);

  console.log('\n# Telegram ulash');
  await page.getByRole('button', { name: 'Telegram bot' }).first().click();
  const link = await page.getByRole('link', { name: 'Telegramni ulash' }).getAttribute('href');
  ok('ulash havolasi bor', /start=o-/.test(link ?? ''), link ?? '');
  say(OWNER, `/start ${new URL(link!).searchParams.get('start')}`);
  await waitFor('paket', () => sent.filter(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER).length >= 5);
  await page.getByRole('button', { name: 'Haftalik paket' }).first().click();
  await page.getByRole('button', { name: 'Telegram bot' }).first().click();
  await page.getByText('Ulangan. Har dushanba').waitFor({ timeout: 8000 });
  ok('panel: Telegram ulangan', true);
  await page.getByLabel('Kanal manzili').fill('@yoq');
  await page.getByRole('button', { name: 'Ulash', exact: true }).click();
  ok('kanal xato — tushunarli xabar', await page.getByText('Kanal topilmadi').isVisible({ timeout: 5000 }).catch(() => false));
  await page.getByLabel('Kanal manzili').fill('@test_channel');
  await page.getByRole('button', { name: 'Ulash', exact: true }).click();
  await page.getByText('Test kanal').first().waitFor({ timeout: 8000 });
  ok('kanal ulandi', true);
  await shot('04-telegram');

  console.log('\n# Joylash');
  await page.getByRole('button', { name: 'Haftalik paket' }).first().click();
  const first = page.locator('main article').first();
  await first.getByRole('button', { name: 'Joylash' }).click();
  await first.getByText(/Joylandi|Rejada/).waitFor({ timeout: 8000 });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'networkidle' });
  const status = await page.locator('main article').first().innerText();
  ok('post joylandi (kanalga chiqdi) yoki rejada', /Joylandi|Rejada/.test(status));
  ok('chiqqan postni qaytarib bo\'lmaydi (tugma o\'chiq)', !/Joylandi/.test(status) || await page.locator('main article').first().getByRole('button', { name: 'Qaytarish' }).isDisabled());
  await shot('05-joylandi');

  console.log('\n# Murojaat');
  const promoId = await page.evaluate(async (t: string) => {
    const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const w = await (await fetch(`/api/weeks/${key}`, { headers: { authorization: `Bearer ${t}` } })).json();
    return w.items[0].id as string;
  }, token);
  const clinicId = new URL(me.status.generalLink).searchParams.get('start')!.slice(2);
  say(PATIENT, `/start l-${clinicId}-${promoId.replace(/-/g, '')}`);
  await sleep(1200);
  shareContact(PATIENT, '998001112233');
  await waitFor('egasiga murojaat', () => sent.find(s => /Yangi murojaat/.test(String(s.params.text))));
  await page.getByRole('button', { name: 'Murojaatlar' }).first().click();
  await page.getByText('+998001112233').waitFor({ timeout: 8000 });
  ok('murojaat ro\'yxatda, manbasi bilan', await page.getByText(/posti/).first().isVisible());
  await page.getByRole('button', { name: "Qo'ng'iroq qildim" }).click();
  await page.getByRole('button', { name: "Qo'ng'iroq qilingan" }).waitFor({ timeout: 5000 });
  ok("«Qo'ng'iroq qildim» belgilandi", true);
  await shot('06-murojaatlar');

  await page.getByRole('button', { name: 'Natijalar' }).first().click();
  await page.getByText('Havolani bosganlar').waitFor();
  const report = await page.locator('main').innerText();
  ok('natijalar: 1 bosish, 1 raqam', /Havolani bosganlar\s*1/.test(report) && /Raqam qoldirganlar\s*1/.test(report));
  await shot('07-natijalar');

  console.log('\n# Savol (telefon maketi)');
  await page.getByRole('button', { name: 'Haftalik paket' }).first().click();
  await page.getByRole('button', { name: 'Nechta lid keldi?' }).click();
  await page.getByText('AI javobi').waitFor({ timeout: 8000 });
  ok('paneldagi bot javob berdi', true);

  console.log('\n# Demo hali ishlaydi');
  await page.goto(`${base}/#/demo`, { waitUntil: 'networkidle' });
  await page.locator('main article').first().waitFor();
  ok('demo: 5 ta material', (await page.locator('main article').count()) === 5);

  console.log('\n# Telefon');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript((t: string) => { localStorage.setItem('cerebro_token', t); }, token);
  const mp = await mobile.newPage();
  mp.on('pageerror', (e: Error) => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await mp.locator('main article').first().waitFor({ timeout: 15000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('telefonda sig\'adi', overflow <= 1, `${overflow}px`);
  await mp.screenshot({ path: join(OUT, '08-telefon.png') });
  await mobile.close();
} catch (e) {
  ok('xatosiz tugadi', false, (e as Error).message.split('\n')[0]);
  await shot('xato').catch(() => {});
} finally {
  await browser.close();
  server.kill();
  tgServer.close();
  aiServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nSahifa xatolari: ${errors.length ? [...new Set(errors)].join(' | ') : "yo'q"}`);
const failed = results.filter(r => !r).length;
if (failed) console.log(`\n--- server jurnali ---\n${log.slice(-2500)}`);
console.log(`Natija: ${results.length - failed}/${results.length} OK`);
process.exit(failed || errors.length ? 1 : 0);
