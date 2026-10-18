/**
 * Panelning brauzer sinovi: server + soxta Telegram/Claude/ovoz + tayyor build.
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
    ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
    VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', GEMINI_API_KEY: 'g-test', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, SESSION_SECRET: 'ui-secret', MORNING_HOUR: '0',
    INBOX_DEBOUNCE_MS: '300', TG_USER_FAKE_URL: `http://127.0.0.1:${tgUserPort}`, IG_POLL_MS: '700', IG_FAKE_URL: `http://127.0.0.1:${igPort}`,
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
  await page.getByLabel('Xabar').fill(text);
  await page.getByLabel('Xabar').press('Enter');
};
// Keng ekranda bo'limlar yon panelda doim ko'rinadi («Menyu» tugmasi faqat tor ekranda — pastda telefon bo'limida tekshiriladi)
const nav = async (label: string) => {
  await page.locator('aside').getByRole('button', { name: label }).click();
};

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
  await page.getByLabel("Cerebro'ga savol").waitFor({ timeout: 10000 });
  ok("kirdi: bosh sahifa ochildi — hali hech narsa ulanmagan, ishga tushirish ro'yxati ko'rinadi", await page.getByRole('heading', { name: "Cerebro'ni ishga tushirish" }).waitFor({ timeout: 10000 }).then(() => true, () => false)
    && await page.locator('aside').getByRole('button', { name: 'Bosh sahifa' }).getAttribute('aria-current') === 'page');
  ok("kirdi: keng ekranda bo'limlar yon panelda doim ko'rinadi (menyu tugmasi yo'q)", await page.locator('aside').getByRole('button', { name: 'Ulanishlar' }).isVisible()
    && (await page.locator('aside').getAttribute('inert')) === null && await page.getByRole('button', { name: 'Menyu', exact: true }).count() === 0);
  await shot('02a-home-fresh', true);
  await nav('Yordamchi');
  await page.getByLabel('Xabar').waitFor({ timeout: 10000 });
  ok("kirdi: bo'sh holatda faqat so'rov qatori (sarlavha va tugmalar yo'q)", !(await page.getByRole('heading', { name: 'Yordamchi' }).isVisible()) && (await page.getByLabel('Xabar').getAttribute('placeholder') ?? '').startsWith('«'));
  await shot('02-chat-empty');

  await send('Bugun nima qilishim kerak?');
  await page.getByText('Bugun: 0 ta vazifa').waitFor({ timeout: 15000 });
  ok("savol yozildi: javob keldi, suhbat sarlavhasi paydo bo'ldi", await page.getByRole('heading', { name: 'Yordamchi' }).isVisible());

  await send('Ertaga soat 10 da bankka borishni eslat');
  const chip = page.getByText(/⏰ Ertaga 10:00/);
  await chip.waitFor({ timeout: 15000 }).catch(() => {});
  await shot('02b-eslatma');
  ok('eslatma: vazifa kartasi suhbatda', await chip.isVisible());

  await page.getByLabel('Xabar').fill('Kameralarni och');
  await page.getByLabel('Xabar').press('Enter');
  await page.getByRole('heading', { name: 'Kameralar' }).waitFor({ timeout: 8000 }).catch(() => {});
  ok("suhbatda «Kameralarni och» deyilsa — bo'lim ochiladi", page.url().endsWith('#/cameras'), page.url());
  await nav('Yordamchi');

  await send('Aliyevga tijorat taklifi tayyorla');
  await page.getByText('Tijorat taklifi — Aliyev').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: "Ko'rish" }).click();
  ok("hujjat: ko'rinishida jadval", await page.getByRole('cell', { name: 'Stol' }).isVisible());
  const [docDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Yuklab olish' }).click()]);
  ok('hujjat: .docx yuklab olindi', docDl.suggestedFilename().endsWith('.docx'), docDl.suggestedFilename());

  await shot('03-chat');

  console.log('\n# Mikrofon');
  const before = stt.gemini;
  stt.text = 'Bugun nima qilishim kerak?';
  await page.getByRole('button', { name: 'Ovoz bilan aytish' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Yozishni tugatish va yuborish' }).click();
  await page.getByText('🎙 Bugun nima qilishim kerak?').waitFor({ timeout: 15000 });
  ok('mikrofon: ovoz → WAV → matn → javob', stt.gemini === before + 1 && stt.lastMime === 'audio/wav' && stt.lastAudio.subarray(0, 4).toString() === 'RIFF');

  console.log('\n# Sozlamalar (profil formasi yo\'q — qolgani ikkinchi miyada)');
  ok("menyuda «Biznes profili» bo'limi yo'q", (await page.locator('aside').getByRole('button', { name: 'Biznes profili' }).count()) === 0);
  await page.locator('aside').getByRole('button', { name: 'Ulanishlar' }).click();
  await page.getByLabel('Egasi (yordamchi shunday murojaat qiladi)').fill('Aziz');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await page.getByText('Saqlandi').first().waitFor({ timeout: 10000 });
  ok('sozlamalar: egasining ismi saqlandi', true);
  await shot('04-settings', true);

  console.log('\n# Menyu: bo\'limlar kamaydi');
  const menuItems = await page.locator('aside nav button').allInnerTexts();
  ok("menyu: bosh sahifa va yetti bo'lim — Vazifalar, Hujjatlar, Postlar, Suhbatlar alohida emas", menuItems.map(t => t.trim().split('\n')[0]).join(', ') === "Bosh sahifa, Yordamchi, Jurnal, Mijozlar, Qo'ng'iroqlar, Kameralar, Ikkinchi miya, Ulanishlar", menuItems.join(' | '));
  await page.goto(`${base}/#/tasks`, { waitUntil: 'networkidle' });
  ok("eski manzil (#/tasks) Jurnalga olib boradi", await page.getByRole('heading', { name: 'Jurnal' }).waitFor({ timeout: 8000 }).then(() => true, () => false));

  console.log('\n# Jurnal: vazifalar shu yerda');
  await nav('Jurnal');
  await page.getByLabel('Vazifa').fill("Yetkazib beruvchiga qo'ng'iroq");
  await page.getByRole('button', { name: "Qo'shish" }).click();
  await page.getByText("Yetkazib beruvchiga qo'ng'iroq").waitFor();
  ok("vazifa: Jurnalda qo'shildi (muddatsiz)", await page.getByText('Muddatsiz (1)').isVisible());
  ok("AI yaratgan vazifa ham ro'yxatda", await page.getByText('Bankka borish').isVisible());
  await page.getByRole('button', { name: "Bajarildi: Yetkazib beruvchiga qo'ng'iroq" }).click();
  await page.getByText(/Bajarilgan \(1\)/).waitFor();
  ok('vazifa: bajarildi', true);
  await shot('05-journal-tasks');

  console.log('\n# Mijozlar');
  const auth = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('cerebro_token'))}` };
  const leadsNow = async () => (await (await fetch(`${base}/api/leads`, { headers: auth })).json() as { leads: { name: string | null; phone: string | null; stage: string; note: string | null }[] }).leads;
  await nav('Yordamchi');
  await send("Yangi mijoz qo'sh: Aziz Karimov, 2 ta stol so'radi");
  // waitFor sinxron shartni kutadi; serverdan so'rab tekshirish uchun — alohida kutish
  const until = async (met: () => Promise<boolean>, ms = 10_000): Promise<boolean> => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await met()) return true;
    return false;
  };
  await until(async () => (await leadsNow()).some(l => l.name === 'Aziz Karimov'));
  await nav('Mijozlar');
  await page.getByRole('button', { name: /Aziz Karimov/ }).click();
  ok("mijozlar: yordamchi qo'shgan mijoz ro'yxatda (yozishmasi yo'q bo'lsa ham)", await page.getByText("Bu mijoz bilan hali yozishma yo'q.").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.getByLabel('Mijoz holati').selectOption('contacted');
  await page.getByLabel('Mijoz haqida izoh').fill('Juma kuni qayta aloqa');
  await page.getByLabel('Mijoz haqida izoh').blur();
  const kept = await until(async () => (await leadsNow()).some(l => l.name === 'Aziz Karimov' && l.stage === 'contacted' && l.note === 'Juma kuni qayta aloqa'));
  ok('mijoz: holati va izohi suhbat tepasida o\'zgartirildi va saqlandi', kept && await page.getByLabel('Mijoz holati').inputValue() === 'contacted' && await page.getByLabel('Mijoz haqida izoh').inputValue() === 'Juma kuni qayta aloqa', JSON.stringify((await leadsNow()).find(l => l.name === 'Aziz Karimov')));
  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json() as { status: { generalLink: string } };
  const bizId = me.status.generalLink.split('start=l-')[1];
  say(CUSTOMER, `/start l-${bizId}`);
  await waitFor('mijozga salom', () => sent.find(s => Number(s.params.chat_id) === CUSTOMER));
  shareContact(CUSTOMER, '998911112233');
  for (let i = 0; i < 50; i++) {
    if ((await leadsNow()).some(l => l.phone === '+998911112233')) break;
    await sleep(200);
  }
  await nav('Yordamchi');
  await send('Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla');
  await page.getByText('tanlaganingiz uchun rahmat').first().waitFor({ timeout: 15000 });
  await nav('Mijozlar');
  await page.getByText('Yuborishni kutayotgan xabarlar').waitFor();
  ok("mijozlar: botdan kelgan mijoz — kanal belgisi bilan ro'yxatda", await page.getByText('Bot', { exact: true }).first().isVisible());
  await shot('06-leads');
  await page.getByRole('button', { name: /Yuborish \(1\)/ }).click();
  await page.getByText('Yuborildi: 1 ta').first().waitFor({ timeout: 10000 });
  ok('xabar: tasdiqlab yuborildi', !!sent.find(s => Number(s.params.chat_id) === CUSTOMER && String(s.params.text).includes('rahmat')));

  console.log('\n# Hujjatlar (Ikkinchi miya ichida)');
  await nav('Ikkinchi miya');
  // Sahifa ochilgach ro'yxat yuklanishini kutadi (darhol tekshirilsa, sekin mashinada hali chizilmagan bo'ladi)
  ok("hujjatlar: Ikkinchi miyada ro'yxatda, Word tugmasi bilan", await page.getByText('Tijorat taklifi — Aliyev').first().waitFor({ timeout: 10000 }).then(() => true, () => false) && await page.getByRole('button', { name: 'Yuklab olish' }).first().isVisible());
  await shot('08-brain-documents', true);

  console.log('\n# Ulanishlar');
  await nav('Ulanishlar');
  ok('ulash havolasi', (await page.getByRole('link', { name: "Telegram'da ochish" }).getAttribute('href'))?.includes('start=o-'));
  ok("ulanishlar: kanal bo'limi yo'q (post yasash olib tashlangan)", (await page.getByLabel('Kanal manzili').count()) === 0);
  await shot('07-telegram');

  console.log('\n# Shaxsiy Telegram va Instagram');
  await nav('Ulanishlar');
  await page.getByLabel('Telefon raqamingiz').fill('+998 90 111 22 33');
  await page.getByRole('button', { name: 'Kod olish' }).click();
  await page.getByLabel("Telegram'ga kelgan kod").fill('12345');
  await page.getByRole('button', { name: 'Kirish', exact: true }).click();
  await page.getByText('Aziz Egasi · @aziz_owner').waitFor({ timeout: 10000 });
  ok('shaxsiy Telegram: kod bilan kirildi', true);
  // Instagram: soxta "oyna" — egasi kirdi deb belgilanguncha kutadi
  await page.getByRole('button', { name: "Instagram'ga kirish" }).click();
  await page.getByText("o'sha oynada akkauntingizga kiring").waitFor({ timeout: 10000 });
  ok("Instagram: oyna ochildi, panel kutyapti", true);
  await shot('11a-instagram-waiting');
  igWeb.loggedIn = true;
  await page.getByText('Instagram ulandi').waitFor({ timeout: 10000 });
  ok('Instagram: egasi kirdi — ulandi', await page.getByText('@mebel_uyi').isVisible());
  await page.getByRole('radio', { name: /O'zi javob bersin/ }).click();
  await page.getByLabel('Kutish vaqti').waitFor();
  ok("javob rejimi: «O'zi javob bersin» tanlandi", await page.getByRole('radio', { name: /O'zi javob bersin/ }).getAttribute('aria-checked') === 'true');
  await page.getByRole('radio', { name: /Men tasdiqlayman/ }).click();
  await sleep(500);
  await shot('11-connections', true);

  // DentaCRM: bo'lim klinikalarda yoki ulangan bo'lsa ko'rinadi — bu yerda API orqali ulab, holatini tekshiramiz
  crm.seed(new Date().toISOString().slice(0, 10), new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  ok("DentaCRM: klinika bo'lmagan biznesda bo'lim yashirin", await page.getByText('DentaCRM — qabullar va tushum').count() === 0);
  const crmJoined = await page.evaluate(async (body: unknown) => (await fetch('/api/crm', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('cerebro_token')}` }, body: JSON.stringify(body),
  })).status, { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('DentaCRM — qabullar va tushum').waitFor({ timeout: 10000 });
  ok('DentaCRM: ulangan holat — klinika nomi, parol sahifada yo\'q', crmJoined === 200 && await page.getByText(`Tabassum Dental · 127.0.0.1:${crmPort}`).isVisible()
    && !(await page.content()).includes(CRM_LOGIN.password));
  await shot('11b-dentacrm', true);

  console.log('\n# Bosh sahifa');
  await nav('Bosh sahifa');
  const clinicDay = page.getByRole('region', { name: 'Klinika kuni' });
  await clinicDay.getByText('jami').waitFor({ timeout: 10000 });
  const { day } = await (await fetch(`${base}/api/crm/day`, { headers: auth })).json() as { day: { total: number; revenue: { total: number }; doctors: { doctor: string }[] } };
  const dayShown = (await clinicDay.innerText()).replace(/\s+/g, ' ');
  ok("bosh sahifa: klinika kuni — qabullar soni, tushum va shifokorlar DentaCRM'dagi bilan bir xil", dayShown.includes(`jami ${day.total}`) && dayShown.includes(`${day.revenue.total.toLocaleString('ru-RU').replace(/\s/g, ' ')} so'm`)
    && day.doctors.every(d => dayShown.includes(d.doctor)), dayShown.slice(0, 200));
  await shot('11c-home-clinic', true);
  const lastChat = async () => (await (await fetch(`${base}/api/chat`, { headers: auth })).json() as { entries: { id: string; role: string; text: string }[] }).entries.at(-1);
  const chatBefore = (await lastChat())?.id;
  await page.getByLabel("Cerebro'ga savol").fill('Bugun nima qilishim kerak?');
  await page.getByLabel("Cerebro'ga savol").press('Enter');
  const answered = await until(async () => { const last = await lastChat(); return !!last && last.id !== chatBefore && last.role === 'assistant' && last.text.startsWith('Bugun:'); });
  ok("bosh sahifa: yozilgan savol suhbat sahifasiga o'tadi va u yerda yuboriladi — javob keladi", answered && page.url().endsWith('#/chat') && await page.getByRole('heading', { name: 'Yordamchi' }).isVisible());

  console.log('\n# Mijozlar: yozishma');
  tgUser.incoming(TG_SESSION, '6001', 'Stol narxi qancha?', { name: 'Bobur', username: 'bobur_t' });
  await sleep(1500);
  await nav('Mijozlar');
  await page.getByRole('button', { name: /Bobur/ }).click();
  await page.getByText('Javob taklifi — tasdiqlaysizmi?').waitFor({ timeout: 10000 });
  ok("suhbat: mijoz gapi va Cerebro taklifi ko'rinadi", await page.getByText('Stol narxi qancha?').last().isVisible());
  await shot('12-inbox');
  await page.getByRole('button', { name: 'Yuborish', exact: true }).click();
  await page.getByText('Yuborildi').first().waitFor({ timeout: 10000 });
  ok("taklif tasdiqlandi — egasining Telegrami orqali ketdi", !!tgUser.sent.find(m => m.to.userId === '6001' && m.text.includes("1 500 000")));
  await page.getByLabel('Mijozga xabar').fill("Yetkazib berish ham bepul");
  await page.getByRole('button', { name: 'Mijozga yuborish' }).click();
  await waitFor('panel xabari', () => tgUser.sent.find(m => m.text === 'Yetkazib berish ham bepul'));
  ok('panel orqali mijozga yozildi', !!tgUser.sent.find(m => m.text === 'Yetkazib berish ham bepul'));

  console.log('\n# Fayl tashlash');
  await nav('Yordamchi');
  await page.locator('input[type="file"]').setInputFiles({ name: 'Narxnoma_kuz.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxFile([['Xizmat', 'Narx'], ['Shkaf sinov', 1200000], ['Parta sinov', 2300000]]) });
  await page.getByText(/«Narxnoma kuz» o'qildi/).first().waitFor({ timeout: 15000 });
  ok("fayl: skrepka orqali tashlandi — suhbatda «o'qildi» va «2 ta narx topildi»", await page.getByText(/2 ta narx topildi/).first().isVisible() && await page.getByRole('button', { name: 'Fayl biriktirish' }).isVisible());
  await shot('15-file-chat');
  await nav('Ikkinchi miya');
  await page.getByRole('button', { name: 'Narxlar jadvaliga (2)' }).click();
  await page.getByText('Narxlar jadvalga tushdi').first().waitFor({ timeout: 10000 });
  ok("fayl: «Ikkinchi miya»da bir tugma bilan narxlar jadvalga tushdi, taklif yopildi", await page.getByRole('button', { name: "Narxni o'chirish: Shkaf sinov" }).count() === 1 && await page.getByRole('button', { name: 'Narxlar jadvaliga (2)' }).count() === 0);
  await shot('16-file-brain', true);

  console.log('\n# Ikkinchi miya');
  await nav('Ikkinchi miya');
  await page.getByRole('heading', { name: 'Ikkinchi miya' }).waitFor();
  await page.getByLabel('Yangi fakt').fill('Yetkazish 500 mingdan bepul');
  await page.getByLabel('Yangi fakt').press('Enter');
  await page.getByText('Yetkazish 500 mingdan bepul').waitFor({ timeout: 5000 });
  ok('miya: fakt qo\'shildi', true);
  await page.getByRole('button', { name: /Qanday to'lash mumkin\?/ }).click();
  await page.getByLabel("Qanday to'lash mumkin?").fill('Naqd, karta va Click');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).first().click();
  // Javob saqlangach sarlavhadagi hisob yangilanadi (matnning o'zi yozish maydonida ham bor — unga qarab bo'lmaydi)
  const counted = await page.getByText(/savollar · 1\/\d+/).waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok('miya: tayyor savolga javob yozildi, hisob yangilandi', counted);
  await page.getByLabel("Narx ro'yxatini shu yerga tashlang").fill('Divan — 4,5 mln\nKreslo 900 ming\nYetkazish — bepul\nBreket 350');
  ok("miya: narx ro'yxati o'qildi, tushunilmagan qator alohida ko'rsatildi", (await page.getByText(/4.500.000 so'm/).isVisible()) && (await page.getByText(/«Breket 350»/).isVisible()));
  await shot('14-brain');
  await page.getByRole('button', { name: '3 ta narxni saqlash' }).click();
  await page.getByText('Narxlar saqlandi').first().waitFor({ timeout: 10000 });
  ok('miya: bepul xizmat fakt bo\'lib saqlandi', await page.getByText('Yetkazish — bepul', { exact: true }).isVisible());
  await page.getByRole('button', { name: "Narxni o'chirish: Kreslo" }).click();
  const gone = await page.getByRole('button', { name: "Narxni o'chirish: Kreslo" }).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
  ok("miya: narxlar ro'yxati shu sahifada — bittasi o'chirildi, qolgani joyida", gone && (await page.getByRole('button', { name: "Narxni o'chirish: Divan" }).count()) === 1);
  ok("miya: «Biznes haqida» sahifasi egasining sahifalari orasida", await page.getByText('Biznes haqida', { exact: true }).first().isVisible());

  console.log('\n# Birinchi kun suhbati');
  await page.getByRole('button', { name: "Suhbatda so'rab chiq" }).click();
  await page.getByText(/ta savolim bor/).first().waitFor({ timeout: 10000 });
  ok("suhbat: «Ikkinchi miya»dagi tugma suhbat sahifasini ochadi — Cerebro birinchi javobsiz savolni so'raydi", page.url().endsWith('#/chat') && await page.getByText('Cerebro savol beryapti').isVisible());
  await shot('17-interview');
  // Avval bo'shliqlar so'raladi (yozilmagan manzil, telefon, ish vaqti) — har biriga o'ziga mos javob, keyin tayyor savol
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
  await page.goto(`${base}/#/chat`, { waitUntil: 'networkidle' });
  await page.getByLabel('Xabar').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("telefon: gorizontal siljish yo'q", overflow <= 0, `${overflow}px`);
  await shot('09-mobile-chat');
  // Tor ekranda bo'limlar yuqori chapdagi «Menyu» tugmasi ortida: tortma yopiq (inert), tugma bosilsa ochiladi, bo'lim tanlansa yopiladi
  const hidden = await page.getByRole('button', { name: 'Menyu', exact: true }).isVisible() && (await page.locator('aside').getAttribute('inert')) !== null;
  await page.getByRole('button', { name: 'Menyu', exact: true }).click();
  await page.locator('aside').getByRole('button', { name: 'Bosh sahifa' }).click();
  await page.getByLabel("Cerebro'ga savol").waitFor({ timeout: 10000 });
  ok("telefon: bo'limlar yuqori chapdagi menyu tugmasi ortida — ochiladi, bo'lim tanlansa yopiladi", hidden && page.url().endsWith('#/home') && (await page.locator('aside').getAttribute('inert')) !== null);
  await shot('09b-mobile-home', true);
  for (const p of ['home', 'inbox', 'journal', 'telegram', 'brain']) {
    await page.goto(`${base}/#/${p}`, { waitUntil: 'networkidle' });
    await sleep(300);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`telefon: ${p} — sig'adi`, o <= 0, `${o}px`);
    if (p === 'journal') await shot('10-mobile-journal');
    if (p === 'inbox') await shot('13-mobile-inbox');
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
