/**
 * Panelning brauzer sinovi (AI jamoa paneli: Cerebro, Qabulxona, Yordamchi, Kuzatuvchi, Tahlilchi, Miya, Sozlamalar): server + soxta Telegram/Claude/ovoz + tayyor build.
 * Talab: npm run build; Chrome o'rnatilgan (CHROME — boshqa yo'l bo'lsa).
 * Ishga tushirish: npx tsx scripts/ui-live.ts <skrinshot papkasi>
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';
import { xlsxFile } from './e2e-intake';
import { CUSTOMER, TG_SESSION, aiServer, igWeb, igWebServer, listen, say, sent, shareContact, sleep, stt, sttServer, tgServer, tgUser, tgUserServer, waitFor } from './fakes';

const OUT = process.argv[2] || join(tmpdir(), 'cerebro-ui');
mkdirSync(OUT, { recursive: true });

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer);
const aiPort = await listen(aiServer);
const sttPort = await listen(sttServer);
const tgUserPort = await listen(tgUserServer);
const igPort = await listen(igWebServer);
const crmPort = await listen(crmServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-ui-'));
const PORT = 3291;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
    VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', GEMINI_API_KEY: 'g-test', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, SESSION_SECRET: 'ui-secret', MORNING_HOUR: '0',
    ASTERISK_WSL: '0', INBOX_DEBOUNCE_MS: '300', TG_USER_FAKE_URL: `http://127.0.0.1:${tgUserPort}`, IG_POLL_MS: '700', IG_FAKE_URL: `http://127.0.0.1:${igPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
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
  await page.getByLabel('Xabar', { exact: true }).fill(text);
  await page.getByLabel('Xabar', { exact: true }).press('Enter');
};
// Bo'limlar chap ustunda (telefonda — pastki panel): Cerebro, AI jamoa, Miya, Sozlamalar. Xodim ichidagi varaq — manzil bilan
const rail = () => page.locator('nav[aria-label="Bo\'limlar"]');
const nav = async (label: string) => { await rail().getByRole('link', { name: label, exact: true }).click(); };
const go = async (hash: string) => { await page.goto(`${base}/#/${hash}`, { waitUntil: 'networkidle' }); };
const tabOn = (name: string) => page.locator('nav[aria-label="Varaqlar"]').getByRole('link', { name, exact: false });
const visible = (l: { waitFor: (o: { timeout: number }) => Promise<unknown> }, ms = 8000) => l.waitFor({ timeout: ms }).then(() => true, () => false);

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
  ok("admin: biznes qo'shildi, ro'yxatda", await visible(page.getByRole('cell', { name: 'Mebel Uyi' })));
  await shot('01-admin');

  console.log('\n# Kirish va bosh ekran (Cerebro)');
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.getByLabel('Login').fill('mebel');
  await page.getByLabel('Parol').fill('secret12');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByLabel("Cerebro'ga yozing").waitFor({ timeout: 10000 });
  ok('kirdi: bosh ekran — ovozli sfera va yozish qatori', await page.getByRole('button', { name: 'Cerebro bilan gaplashish' }).isVisible());
  // Logotip havolasi (rasm, matnsiz) ro'yxatga kirmaydi
  const items = (await rail().getByRole('link').allInnerTexts()).map(t => t.trim().split('\n')[0]).filter(Boolean);
  ok("menyu: Cerebro, to'rt AI xodim, Miya, Sozlamalar", items.join(', ') === 'Cerebro, Qabulxona, Yordamchi, Kuzatuvchi, Tahlilchi, Miya, Sozlamalar', items.join(' | '));
  ok("menyu: «Quloq» tugmasi bor (o'chiq)", await rail().getByRole('button', { name: /Quloq/ }).getAttribute('aria-pressed') === 'false');
  await page.getByLabel("Cerebro'ga yozing").fill('Bugun nima qilishim kerak?');
  await page.getByLabel("Cerebro'ga yozing").press('Enter');
  ok("bosh ekran: yozilgan savolga javob shu yerda karta bo'lib chiqadi", await visible(page.getByRole('region', { name: 'Natijalar' }).getByText('Bugun:').first(), 15000));
  await shot('02a-home', true);

  console.log('\n# Yordamchi: suhbat');
  await nav('Yordamchi');
  await tabOn('Suhbat').click();
  await page.getByLabel('Xabar', { exact: true }).waitFor({ timeout: 10000 });
  ok("suhbat: bosh ekranda yozilgan savol shu yerda (bitta suhbat)", await visible(page.locator('[data-chat-log]').getByText('Bugun nima qilishim kerak?').first()));
  ok("suhbat: yonida Xotira paneli", await page.getByRole('heading', { name: 'Xotira' }).isVisible());

  await send('Ertaga soat 10 da bankka borishni eslat');
  const chip = page.getByText(/⏰ Ertaga 10:00/);
  await chip.waitFor({ timeout: 15000 }).catch(() => {});
  await shot('02b-eslatma');
  ok('eslatma: vazifa kartasi suhbatda', await chip.isVisible());

  await send('Kameralarni och');
  ok("suhbatda «Kameralarni och» deyilsa — Kuzatuvchi ochiladi", await visible(page.getByRole('heading', { name: 'Kuzatuvchi', exact: true })) && page.url().endsWith('#/cameras'), page.url());
  await go('yordamchi/suhbat');

  await send('Aliyevga tijorat taklifi tayyorla');
  await page.getByText('Tijorat taklifi — Aliyev').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: "Ko'rish" }).first().click();
  ok("hujjat: ko'rinishida jadval", await page.getByRole('cell', { name: 'Stol' }).isVisible());
  const [docDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Yuklab olish' }).first().click()]);
  ok('hujjat: .docx yuklab olindi', docDl.suggestedFilename().endsWith('.docx'), docDl.suggestedFilename());
  await shot('03-chat');

  console.log('\n# Ovozli xabar');
  const before = stt.gemini;
  stt.text = 'Bugun nima qilishim kerak?';
  await page.getByRole('button', { name: 'Ovozli xabar' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Yozishni tugatish va yuborish' }).click();
  const voiced = page.locator('[data-msg="owner"]').filter({ hasText: 'Ovozli xabar' }).filter({ hasText: 'Bugun nima qilishim kerak?' });
  ok('ovozli xabar: ovoz → WAV → matn → javob, belgisi bilan', await visible(voiced, 15000) && stt.gemini === before + 1 && stt.lastMime === 'audio/wav' && stt.lastAudio.subarray(0, 4).toString() === 'RIFF');

  console.log('\n# Xotira');
  await page.getByLabel('Eslab qolsin').fill('Yetkazish 500 mingdan bepul');
  await page.getByRole('button', { name: "Xotiraga qo'shish" }).click();
  ok("xotira: fakt qo'shildi", await visible(page.getByRole('heading', { name: 'Xotira' }).locator('..').locator('..').getByText('Yetkazish 500 mingdan bepul')));
  await page.getByRole('button', { name: 'Unutsin: Yetkazish 500 mingdan bepul' }).click();
  ok("xotira: fakt o'chirildi", await page.getByRole('button', { name: 'Unutsin: Yetkazish 500 mingdan bepul' }).waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false));

  console.log('\n# Yordamchi: ish stoli va ishlar');
  await go('tasks');
  ok("eski manzil (#/tasks) Yordamchi → Ishlar varag'iga olib boradi", await tabOn('Ishlar').getAttribute('aria-current') === 'page');
  await page.getByLabel('Vazifa').fill("Yetkazib beruvchiga qo'ng'iroq");
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText("Yetkazib beruvchiga qo'ng'iroq").waitFor();
  ok("vazifa: qo'shildi (muddatsiz)", await page.getByText('Muddatsiz (1)').isVisible());
  ok("AI yaratgan vazifa ham ro'yxatda", await page.getByText('Bankka borish').first().isVisible());
  await page.getByRole('button', { name: "Bajarildi: Yetkazib beruvchiga qo'ng'iroq" }).click();
  await page.getByText(/Bajarilgan \(1\)/).waitFor();
  ok('vazifa: bajarildi', true);
  await shot('05-ishlar');
  await go('yordamchi/stol');
  ok("ish stoli: tayyorlangan hujjat «Hujjatlar»da", await visible(page.getByText('Tijorat taklifi — Aliyev').first()));
  await shot('05b-ish-stoli', true);

  console.log('\n# Topshiriqlar');
  await go('yordamchi/topshiriqlar');
  ok('topshiriqlar: misollar va bo\'sh holat', await visible(page.getByText('Hali topshiriq yo\'q.', { exact: false })) && await page.getByRole('button', { name: /kun rejamni yubor/ }).isVisible());
  const auth = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('cerebro_token'))}`, 'content-type': 'application/json' };
  await fetch(`${base}/api/orders`, { method: 'POST', headers: auth, body: JSON.stringify({ member: 'yordamchi', text: 'Har kuni 8:30 da kun rejamni yubor', spec: { kind: 'schedule', at: '08:30', days: [] }, summary: 'Har kuni 08:30 da kun rejangizni yuboraman.' }) });
  await page.reload({ waitUntil: 'networkidle' });
  ok("topshiriq: ro'yxatda — tushunchasi, vaqti va yoqish tugmasi", await visible(page.getByText('Har kuni 08:30 da kun rejangizni yuboraman.')) && await page.getByText(/Jadval · 08:30 · har kuni/).isVisible());
  await shot('05c-topshiriqlar', true);

  console.log('\n# Qabulxona');
  await go('requests');
  ok("eski manzil (#/requests) Qabulxona → So'rovlar: bo'sh holat va xodimlar", await tabOn("So'rovlar").getAttribute('aria-current') === 'page'
    && await visible(page.getByText("Ochiq so'rov yo'q")) && await visible(page.getByText('Qabulxona xodimlari')));
  await go('qabulxona');
  ok("qabulxona bugun: murojaat yo'q — nima bo'lishi va qanday sinash", await visible(page.getByRole('heading', { name: "Hali murojaat yo'q" })) && await page.getByRole('button', { name: "Qabulxonaga qo'ng'iroq qilish" }).isVisible());
  await shot('06a-qabulxona', true);

  console.log('\n# Mijozlar (Qabulxona → Yozishmalar)');
  const leadsNow = async () => (await (await fetch(`${base}/api/leads`, { headers: auth })).json() as { leads: { name: string | null; phone: string | null; stage: string; note: string | null }[] }).leads;
  const until = async (met: () => Promise<boolean>, ms = 10_000): Promise<boolean> => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await met()) return true;
    return false;
  };
  await go('yordamchi/suhbat');
  await send("Yangi mijoz qo'sh: Aziz Karimov, 2 ta stol so'radi");
  await until(async () => (await leadsNow()).some(l => l.name === 'Aziz Karimov'));
  await go('qabulxona/yozishmalar');
  await page.getByRole('button', { name: /Aziz Karimov/ }).click();
  ok("mijozlar: yordamchi qo'shgan mijoz ro'yxatda (yozishmasi yo'q bo'lsa ham)", await visible(page.getByText("Bu mijoz bilan hali yozishma yo'q.")));
  await page.getByLabel('Mijoz holati').selectOption('contacted');
  await page.getByLabel('Mijoz haqida izoh').fill('Juma kuni qayta aloqa');
  await page.getByLabel('Mijoz haqida izoh').blur();
  const kept = await until(async () => (await leadsNow()).some(l => l.name === 'Aziz Karimov' && l.stage === 'contacted' && l.note === 'Juma kuni qayta aloqa'));
  ok("mijoz: holati va izohi saqlandi", kept);
  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json() as { status: { generalLink: string } };
  const bizId = me.status.generalLink.split('start=l-')[1];
  say(CUSTOMER, `/start l-${bizId}`);
  await waitFor('mijozga salom', () => sent.find(s => Number(s.params.chat_id) === CUSTOMER));
  shareContact(CUSTOMER, '998911112233');
  await until(async () => (await leadsNow()).some(l => l.phone === '+998911112233'));
  await go('yordamchi/suhbat');
  await send('Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla');
  await page.getByText('tanlaganingiz uchun rahmat').first().waitFor({ timeout: 15000 });
  await go('qabulxona/yozishmalar');
  await page.getByText('Yuborishni kutayotgan xabarlar').waitFor();
  ok("mijozlar: botdan kelgan mijoz — kanal belgisi bilan ro'yxatda", await page.getByText('Bot', { exact: true }).first().isVisible());
  await shot('06-leads');
  await page.getByRole('button', { name: /Yuborish \(1\)/ }).click();
  await page.getByText('Yuborildi: 1 ta').first().waitFor({ timeout: 10000 });
  ok('xabar: tasdiqlab yuborildi', !!sent.find(s => Number(s.params.chat_id) === CUSTOMER && String(s.params.text).includes('rahmat')));

  console.log('\n# Sozlamalar');
  await nav('Sozlamalar');
  ok("sozlamalar: ulanishlar plitkalari (holati bilan)", await visible(page.getByRole('navigation', { name: 'Ulanishlar' }).getByRole('link', { name: /Telefon liniyasi/ })));
  ok("sozlamalar: savdo sohasida DentaCRM plitkasi yo'q", await page.getByRole('navigation', { name: 'Ulanishlar' }).getByRole('link', { name: /DentaCRM/ }).count() === 0);
  await page.getByLabel('Egasi (yordamchi shunday murojaat qiladi)').fill('Aziz');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).first().click();
  await page.getByText('Saqlandi').first().waitFor({ timeout: 10000 });
  ok('sozlamalar: egasining ismi saqlandi', true);
  await page.getByRole('radio', { name: /O'zi javob bersin/ }).click();
  await page.getByLabel('Kutish vaqti').waitFor();
  ok("javob rejimi: «O'zi javob bersin» tanlandi", await page.getByRole('radio', { name: /O'zi javob bersin/ }).getAttribute('aria-checked') === 'true');
  await page.getByRole('radio', { name: /Men tasdiqlayman/ }).click();
  await shot('04-settings', true);

  await go('sozlamalar/telegram');
  ok('telegram: ulash havolasi', (await page.getByRole('link', { name: "Telegram'da ochish" }).getAttribute('href'))?.includes('start=o-'));
  await page.getByLabel('Telefon raqamingiz').fill('+998 90 111 22 33');
  await page.getByRole('button', { name: 'Kod olish' }).click();
  await page.getByLabel("Telegram'ga kelgan kod").fill('12345');
  await page.getByRole('button', { name: 'Kirish', exact: true }).click();
  ok('shaxsiy Telegram: kod bilan kirildi', await visible(page.getByText('Aziz Egasi · @aziz_owner'), 10000));
  await shot('07-telegram');

  await go('sozlamalar/instagram');
  ok("Instagram: rasmiy yo'l — hub kodi so'raladi; brauzer orqali — zaxira", await visible(page.getByText('Cerebro Hub kodi')));
  await page.getByText("Meta ilovasisiz — shu kompyuterdagi brauzer orqali").click();
  await page.getByRole('button', { name: "Instagram'ga kirish" }).click();
  ok("Instagram: oyna ochildi, panel kutyapti", await visible(page.getByText("o'sha oynada akkauntingizga kiring"), 10000));
  igWeb.loggedIn = true;
  await page.getByText('Instagram ulandi').waitFor({ timeout: 10000 });
  ok('Instagram: egasi kirdi — ulandi', await page.getByText('@mebel_uyi').isVisible());
  await shot('11-instagram', true);

  await go('sozlamalar/telefon');
  ok("telefon liniyasi: holat, shahar raqami formasi, kim javob beradi, administrator telefoni", await visible(page.getByRole('heading', { name: 'Shahar raqami (Uztelecom)' }))
    && await page.getByRole('heading', { name: 'Kim javob beradi' }).isVisible() && await page.getByRole('heading', { name: 'Administrator telefoni' }).isVisible());
  await page.getByRole('radio', { name: /Ish vaqtida — administrator/ }).check();
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await page.getByText(/keyingi qo.ng.iroqdan kuchga kiradi/).first().waitFor({ timeout: 10000 });
  const line = await (await fetch(`${base}/api/phone/line`, { headers: auth })).json() as { line: { routing: { mode: string } } };
  ok('telefon liniyasi: «ish vaqtida administrator» saqlandi', line.line.routing.mode === 'day_admin');
  await shot('11c-telefon', true);

  // DentaCRM: plitka klinikada yoki ulangan bo'lsa ko'rinadi — API orqali ulab, holatini tekshiramiz
  crm.seed(new Date().toISOString().slice(0, 10), new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const crmJoined = await page.evaluate(async (body: unknown) => (await fetch('/api/crm', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('cerebro_token')}` }, body: JSON.stringify(body),
  })).status, { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN });
  await go('sozlamalar/dentacrm');
  await page.reload({ waitUntil: 'networkidle' });
  ok("DentaCRM: ulangan holat — klinika nomi, parol sahifada yo'q", crmJoined === 200 && await visible(page.getByText(`Tabassum Dental · 127.0.0.1:${crmPort}`), 10000)
    && !(await page.content()).includes(CRM_LOGIN.password));
  await shot('11b-dentacrm', true);

  console.log('\n# Tahlilchi va Kuzatuvchi');
  await nav('Tahlilchi');
  ok('tahlilchi: raqamlar va topshiriqlar varaqlari', await visible(page.getByRole('heading', { name: 'Tahlilchi' })) && await tabOn('Topshiriqlar').isVisible());
  await shot('12a-tahlilchi', true);
  await nav('Kuzatuvchi');
  ok("kuzatuvchi: kamera yo'q — nima qiladi va qanday ulanadi", await visible(page.getByRole('heading', { name: "Kuzatuvchi hali hech narsani ko'rmayapti" })) && await tabOn('Kameralar').isVisible());

  console.log('\n# Qabulxona: yozishma');
  tgUser.incoming(TG_SESSION, '6001', 'Stol narxi qancha?', { name: 'Bobur', username: 'bobur_t' });
  await sleep(1500);
  await go('qabulxona');
  ok("qabulxona bugun: yangi yozishma suhbatlar ro'yxatida", await visible(page.getByRole('region', { name: 'Suhbatlar' }).getByText('Bobur').first(), 10000));
  await shot('12-qabulxona-suhbat', true);
  await go('qabulxona/yozishmalar');
  await page.getByRole('button', { name: /Bobur/ }).click();
  await page.getByText('Javob taklifi — tasdiqlaysizmi?').waitFor({ timeout: 10000 });
  ok("suhbat: mijoz gapi va Cerebro taklifi ko'rinadi", await page.getByText('Stol narxi qancha?').last().isVisible());
  await page.getByRole('button', { name: 'Yuborish', exact: true }).click();
  await page.getByText('Yuborildi').first().waitFor({ timeout: 10000 });
  ok("taklif tasdiqlandi — egasining Telegrami orqali ketdi", !!tgUser.sent.find(m => m.to.userId === '6001' && m.text.includes('1 500 000')));
  await page.getByLabel('Mijozga xabar').fill('Yetkazib berish ham bepul');
  await page.getByRole('button', { name: 'Mijozga yuborish' }).click();
  await waitFor('panel xabari', () => tgUser.sent.find(m => m.text === 'Yetkazib berish ham bepul'));
  ok('panel orqali mijozga yozildi', !!tgUser.sent.find(m => m.text === 'Yetkazib berish ham bepul'));

  console.log('\n# Fayl tashlash');
  await go('yordamchi/suhbat');
  await page.locator('input[type="file"]').setInputFiles({ name: 'Narxnoma_kuz.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxFile([['Xizmat', 'Narx'], ['Shkaf sinov', 1200000], ['Parta sinov', 2300000]]) });
  await page.getByText(/«Narxnoma kuz» o'qildi/).first().waitFor({ timeout: 15000 });
  ok("fayl: skrepka orqali tashlandi — suhbatda «o'qildi» va «2 ta narx topildi»", await page.getByText(/2 ta narx topildi/).first().isVisible() && await page.getByRole('button', { name: 'Fayl biriktirish' }).isVisible());
  await shot('15-file-chat');
  await go('miya/savollar');
  await page.getByRole('button', { name: 'Narxlar jadvaliga (2)' }).click();
  await page.getByText('Narxlar jadvalga tushdi').first().waitFor({ timeout: 10000 });
  ok("fayl: Miya → «Savollar va narxlar»da bir tugma bilan narxlar jadvalga tushdi", await page.getByRole('button', { name: "Narxni o'chirish: Shkaf sinov" }).count() === 1 && await page.getByRole('button', { name: 'Narxlar jadvaliga (2)' }).count() === 0);

  console.log('\n# Miya');
  await page.getByLabel('Yangi fakt').fill('Ish kuni 9 dan 19 gacha');
  await page.getByLabel('Yangi fakt').press('Enter');
  ok("miya: fakt qo'shildi", await visible(page.getByText('Ish kuni 9 dan 19 gacha').first(), 5000));
  await page.getByRole('button', { name: /Qanday to'lash mumkin\?/ }).click();
  await page.getByLabel("Qanday to'lash mumkin?").fill('Naqd, karta va Click');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).first().click();
  ok('miya: tayyor savolga javob yozildi, hisob yangilandi', await visible(page.getByText(/savollar · 1\/\d+/), 10000));
  await page.getByLabel("Narx ro'yxatini shu yerga tashlang").fill('Divan — 4,5 mln\nKreslo 900 ming\nYetkazish — bepul\nBreket 350');
  ok("miya: narx ro'yxati o'qildi, tushunilmagan qator alohida ko'rsatildi", (await page.getByText(/4.500.000 so'm/).isVisible()) && (await page.getByText(/«Breket 350»/).isVisible()));
  await page.getByRole('button', { name: '3 ta narxni saqlash' }).click();
  await page.getByText('Narxlar saqlandi').first().waitFor({ timeout: 10000 });
  ok("miya: bepul xizmat fakt bo'lib saqlandi", await page.getByText('Yetkazish — bepul', { exact: true }).isVisible());
  await page.getByRole('button', { name: "Narxni o'chirish: Kreslo" }).click();
  const gone = await page.getByRole('button', { name: "Narxni o'chirish: Kreslo" }).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
  ok("miya: narxlar ro'yxati shu sahifada — bittasi o'chirildi, qolgani joyida", gone && (await page.getByRole('button', { name: "Narxni o'chirish: Divan" }).count()) === 1);
  await shot('14-miya', true);
  await go('miya');
  ok("miya: sahifalar (Obsidian kabi) — «Biznes haqida» ro'yxatda", await visible(page.getByText('Biznes haqida').first(), 10000));
  await shot('14b-miya-sahifalar');

  console.log('\n# Birinchi kun suhbati');
  await go('miya/savollar');
  await page.getByRole('button', { name: "Suhbatda so'rab chiq" }).click();
  await page.getByText(/ta savolim bor/).first().waitFor({ timeout: 10000 });
  ok("suhbat: Miya'dagi tugma suhbatni ochadi — Cerebro birinchi javobsiz savolni so'raydi", page.url().endsWith('#/chat') && await page.getByText('Cerebro savol beryapti').isVisible());
  await shot('17-interview');
  const gapAnswers: [RegExp, string][] = [[/Manzilingiz qayer/, 'Chilonzor 9-kvartal, 14-uy'], [/qaysi raqamga qo'ng'iroq/, '+998 71 200 45 67'], [/Ish vaqtingiz qanday/, 'Du–Sh 09:00–20:00']];
  let gapsAnswered = 0;
  for (const [question, answer] of gapAnswers) {
    if (!(await page.getByText(question).last().isVisible())) continue;
    await send(answer);
    await page.getByText(/✅ .*yozdim/).nth(gapsAnswered).waitFor({ timeout: 10000 });
    gapsAnswered++;
  }
  ok("suhbat: avval bo'shliqlar so'raldi, javobi «Biznes haqida»ga yozildi", gapsAnswered > 0, `${gapsAnswered} ta`);
  await send('Buyurtma bergan kuni, ertasiga yetkazamiz');
  await page.getByText(/Yozib oldim/).first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: "To'xtatish" }).click();
  await page.getByText(new RegExp(`Savollarni to'xtatdim: ${gapsAnswered + 1} ta javob oldim`)).first().waitFor({ timeout: 10000 });
  ok("suhbat: javob yozib olindi; «To'xtatish» suhbatni yopdi — tugmalar yo'qoldi", await page.getByText('Cerebro savol beryapti').count() === 0);

  console.log('\n# Telefon ekrani');
  await page.setViewportSize({ width: 390, height: 844 });
  await go('yordamchi/suhbat');
  await page.getByLabel('Xabar', { exact: true }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("telefon: gorizontal siljish yo'q", overflow <= 0, `${overflow}px`);
  await shot('09-mobile-chat');
  const box = await rail().boundingBox();
  ok("telefon: bo'limlar pastki panelda", !!box && box.y > 700, JSON.stringify(box));
  await nav('Cerebro');
  ok('telefon: pastki paneldan bosh ekranga', await visible(page.getByLabel("Cerebro'ga yozing")) && page.url().endsWith('#/ai'));
  await shot('09b-mobile-home', true);
  for (const p of ['ai', 'qabulxona', 'qabulxona/yozishmalar', 'yordamchi/stol', 'yordamchi/jurnal', 'kuzatuvchi', 'tahlilchi', 'sozlamalar/telefon', 'miya']) {
    await go(p);
    await sleep(300);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`telefon: ${p} — sig'adi`, o <= 0, `${o}px`);
    if (p === 'yordamchi/jurnal') await shot('10-mobile-ishlar');
    if (p === 'qabulxona') await shot('13-mobile-qabulxona');
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
  tgUserServer.close();
  igWebServer.close();
  crmServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl band */ }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi · skrinshotlar: ${OUT}`);
if (passed !== results.length) { console.log(log.slice(-3000)); process.exit(1); }
process.exit(0);
