/**
 * Panelning brauzer sinovi: server + soxta Telegram/Claude/ovoz + tayyor build.
 * Talab: npm run build; Chrome o'rnatilgan; playwright-core (PLAYWRIGHT_CORE yo'li).
 * Ishga tushirish: npx tsx scripts/ui-live.ts <skrinshot papkasi>
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CUSTOMER, aiServer, listen, say, sent, shareContact, sleep, stt, sttServer, tgServer, waitFor } from './fakes';

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
const sttPort = await listen(sttServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-ui-'));
const PORT = 3291;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
    GEMINI_API_KEY: 'g-test', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, SESSION_SECRET: 'ui-secret', MORNING_HOUR: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors: string[] = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tashkent', locale: 'uz-UZ', acceptDownloads: true, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m: { type: () => string; text: () => string }) => { if (m.type() === 'error' && !/401|409|400/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
page.on('dialog', (d: { accept: () => void }) => d.accept());
const shot = (name: string, full = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
const send = async (text: string) => {
  await page.getByLabel('Xabar').fill(text);
  await page.getByLabel('Xabar').press('Enter');
};
const nav = (label: string) => page.locator('aside').getByRole('button', { name: label }).click();

try {
  console.log('\n# Admin');
  await page.goto(`${base}/#/admin`, { waitUntil: 'networkidle' });
  await page.getByLabel('Admin paroli').fill('admin-pass-1');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByLabel('Biznes nomi').fill('Mebel Uyi');
  await page.getByLabel('Soha').fill("mebel do'koni");
  await page.getByLabel('Login').fill('mebel');
  await page.getByLabel('Parol').fill('secret12');
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText("«Mebel Uyi» qo'shildi").waitFor({ timeout: 10000 });
  ok("admin: biznes qo'shildi, ro'yxatda", await page.getByRole('cell', { name: 'Mebel Uyi' }).isVisible());
  await shot('01-admin');

  console.log('\n# Kirish va suhbat');
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.getByLabel('Login').fill('mebel');
  await page.getByLabel('Parol').fill('secret12');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByText('Men — Cerebro').waitFor({ timeout: 10000 });
  ok("kirdi: yordamchi, bo'sh holatda takliflar", await page.getByRole('button', { name: 'Bugun nima qilishim kerak?' }).isVisible());
  await shot('02-chat-empty');

  await page.getByRole('button', { name: 'Bugun nima qilishim kerak?' }).click();
  await page.getByText('Bugun: 0 ta vazifa').waitFor({ timeout: 15000 });
  ok('taklif bosildi: javob keldi', true);

  await send('Ertaga soat 10 da bankka borishni eslat');
  const chip = page.getByText(/⏰ Ertaga 10:00/);
  await chip.waitFor({ timeout: 15000 }).catch(() => {});
  await shot('02b-eslatma');
  ok('eslatma: vazifa kartasi suhbatda', await chip.isVisible());

  await send('Aliyevga tijorat taklifi tayyorla');
  await page.getByText('Tijorat taklifi — Aliyev').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: "Ko'rish" }).click();
  ok("hujjat: ko'rinishida jadval", await page.getByRole('cell', { name: 'Stol' }).isVisible());
  const [docDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Yuklab olish' }).click()]);
  ok('hujjat: .docx yuklab olindi', docDl.suggestedFilename().endsWith('.docx'), docDl.suggestedFilename());

  await send('Dam olish kunlari aksiyasi haqida post qil');
  await page.locator('main svg[role="img"]').first().waitFor({ timeout: 15000 });
  ok("post: rasm suhbatda ko'rindi", await page.locator('main svg[role="img"]').first().isVisible());
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).first().click()]);
  ok('post: PNG yuklab olindi', pngDl.suggestedFilename().endsWith('.png'), pngDl.suggestedFilename());
  await shot('03-chat');

  console.log('\n# Mikrofon');
  const before = stt.gemini;
  stt.text = 'Bugun nima qilishim kerak?';
  await page.getByRole('button', { name: 'Ovoz bilan aytish' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Yozishni tugatish va yuborish' }).click();
  await page.getByText('🎙 Bugun nima qilishim kerak?').waitFor({ timeout: 15000 });
  ok('mikrofon: ovoz → WAV → matn → javob', stt.gemini === before + 1 && stt.lastMime === 'audio/wav' && stt.lastAudio.subarray(0, 4).toString() === 'RIFF');

  console.log('\n# Biznes profili');
  await nav('Biznes profili');
  await page.getByLabel('Egasi (yordamchi shunday murojaat qiladi)').fill('Aziz');
  await page.getByLabel('Telefon').fill('+998 90 000 00 00');
  await page.getByLabel('Rang: #0F766E').click();
  await page.getByRole('button', { name: "Qo'shish" }).first().click();
  await page.getByLabel('Nomi', { exact: true }).last().fill('Stol');
  await page.getByLabel('Narx').last().fill('1500000');
  await page.getByPlaceholder("Masalan: 500 ming so'mdan").fill("Yetkazish 500 mingdan bepul");
  await page.getByPlaceholder("Masalan: 500 ming so'mdan").press('Enter');
  await page.getByText('Yetkazish 500 mingdan bepul').waitFor({ timeout: 5000 });
  ok('eslab qolinganlar: qo\'shildi', true);
  await page.getByRole('button', { name: 'Saqlash' }).click();
  await page.getByText("Saqlandi — yordamchi yangi ma'lumotni biladi").waitFor({ timeout: 10000 });
  ok('profil: saqlandi', true);
  await shot('04-business', true);

  console.log('\n# Vazifalar');
  await nav('Vazifalar');
  await page.getByLabel('Vazifa').fill("Yetkazib beruvchiga qo'ng'iroq");
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText("Yetkazib beruvchiga qo'ng'iroq").waitFor();
  ok("vazifa: qo'shildi (muddatsiz)", await page.getByText('Muddatsiz (1)').isVisible());
  ok("AI yaratgan vazifa ham ro'yxatda", await page.getByText('Bankka borish').isVisible());
  await page.getByRole('button', { name: "Bajarildi: Yetkazib beruvchiga qo'ng'iroq" }).click();
  await page.getByText('Bajarilgan (1)').waitFor();
  ok('vazifa: bajarildi', true);
  await shot('05-tasks');

  console.log('\n# Mijozlar');
  await nav('Mijozlar');
  await page.getByLabel('Ism').fill('Aziz Karimov');
  await page.getByLabel('Telefon').fill('+998 90 123 45 67');
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText('Aziz Karimov').waitFor();
  const auth = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('cerebro_token'))}` };
  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json() as { status: { generalLink: string } };
  const bizId = me.status.generalLink.split('start=l-')[1];
  say(CUSTOMER, `/start l-${bizId}`);
  await waitFor('mijozga salom', () => sent.find(s => Number(s.params.chat_id) === CUSTOMER));
  shareContact(CUSTOMER, '998911112233');
  for (let i = 0; i < 50; i++) {
    const { leads } = await (await fetch(`${base}/api/leads`, { headers: auth })).json() as { leads: { phone: string | null }[] };
    if (leads.some(l => l.phone === '+998911112233')) break;
    await sleep(200);
  }
  await nav('Yordamchi');
  await send('Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla');
  await page.getByText('tanlaganingiz uchun rahmat').first().waitFor({ timeout: 15000 });
  await nav('Mijozlar');
  await page.getByText('Yuborishni kutayotgan xabarlar').waitFor();
  ok("mijozlar: Telegram'dan kelgan mijoz «botda»", await page.getByText('botda').isVisible());
  await shot('06-leads');
  await page.getByRole('button', { name: /Yuborish \(1\)/ }).click();
  await page.getByText('Yuborildi: 1 ta').first().waitFor({ timeout: 10000 });
  ok('xabar: tasdiqlab yuborildi', !!sent.find(s => Number(s.params.chat_id) === CUSTOMER && String(s.params.text).includes('rahmat')));

  console.log('\n# Hujjatlar va postlar');
  await nav('Hujjatlar');
  ok("hujjatlar: ro'yxatda", await page.getByText('Tijorat taklifi — Aliyev').isVisible());
  await nav('Postlar');
  const publish = page.getByRole('button', { name: 'Kanalga joylash' });
  ok('postlar: kanal ulanmagan — joylash tugmasi o\'chiq', await publish.isDisabled());

  console.log('\n# Telegram');
  await nav('Telegram');
  ok('ulash havolasi', (await page.getByRole('link', { name: "Telegram'da ochish" }).getAttribute('href'))?.includes('start=o-'));
  await page.getByLabel('Kanal manzili').fill('@test_channel');
  await page.getByRole('button', { name: 'Ulash' }).click();
  await page.getByText('Ulangan:').first().waitFor({ timeout: 10000 });
  ok('kanal ulandi', await page.getByText('Test kanal').isVisible());
  await shot('07-telegram');
  await nav('Postlar');
  await page.getByRole('button', { name: 'Kanalga joylash' }).click();
  await page.getByText('Kanalga joylandi').first().waitFor({ timeout: 10000 });
  ok('post kanalga joylandi', !!sent.find(s => s.method === 'sendPhoto' && Number(s.params.chat_id) < 0));
  await shot('08-posts');

  console.log('\n# Telefon ekrani');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#/chat`, { waitUntil: 'networkidle' });
  await page.getByLabel('Xabar').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("telefon: gorizontal siljish yo'q", overflow <= 0, `${overflow}px`);
  await shot('09-mobile-chat');
  for (const p of ['tasks', 'leads', 'business', 'telegram']) {
    await page.goto(`${base}/#/${p}`, { waitUntil: 'networkidle' });
    await sleep(300);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`telefon: ${p} — sig'adi`, o <= 0, `${o}px`);
    if (p === 'leads') await shot('10-mobile-leads');
  }

  ok("brauzerda xato yo'q", errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
  await shot('xato').catch(() => {});
} finally {
  await browser.close();
  server.kill();
  tgServer.close();
  aiServer.close();
  sttServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl band */ }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi · skrinshotlar: ${OUT}`);
if (passed !== results.length) { console.log(log.slice(-3000)); process.exit(1); }
process.exit(0);
