/**
 * Ulash ustasi — haqiqiy brauzerda (ko'rinmas oyna), soxta xizmatlar bilan: anketa telefonda to'ldiriladi → usta admin bo'lib
 * ochiladi → klinika qo'shiladi, anketa kod bilan yuklanadi → kalitlar bitta maydonga qo'yiladi → egasi botni ulaydi → DentaCRM,
 * kameralar (tarmoqdan topiladi), shaxsiy Telegram → bo'shliqlar egasidan Telegram'da so'raladi → yakun.
 * Har qadamning skrinshoti saqlanadi (yo'li oxirida chiqadi). Ishga tushirish: npm run build && npm run test:ui-setup
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer as createTcp } from 'node:net';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { crmServer, CRM_LOGIN } from './fakeCrm';
import { OWNER, json, listen, press, readBody, say, sent, sleep, tgServer, tgUserServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const keysServer = createServer(async (req, res) => {
  await readBody(req);
  if (req.url?.startsWith('/v1/messages')) return json(res, { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'O' }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 1 } });
  json(res, { models: [] });
});
let onvifHttpPort = 0;
const onvifHttp = createServer(async (req, res) => {
  const body = (await readBody(req)).toString();
  res.setHeader('content-type', 'application/soap+xml');
  if (body.includes('GetProfiles')) return res.end('<trt:Profiles token="sub"><tt:Width>640</tt:Width><tt:Height>360</tt:Height></trt:Profiles>');
  if (body.includes('GetStreamUri')) return res.end('<tt:Uri>rtsp://192.168.1.64:554/Streaming/Channels/102</tt:Uri>');
  res.end('');
});
const onvifUdp = createSocket('udp4');
onvifUdp.on('message', (_m, r) => onvifUdp.send(`<d:ProbeMatch><d:Scopes>onvif://www.onvif.org/name/HIKVISION onvif://www.onvif.org/hardware/DS-2CD1043G0-I</d:Scopes><d:XAddrs>http://127.0.0.1:${onvifHttpPort}/onvif/device_service</d:XAddrs></d:ProbeMatch>`, r.port, r.address));
const rtsp = createTcp(s => s.destroy());

const tgPort = await listen(tgServer), keysPort = await listen(keysServer), crmPort = await listen(crmServer), tgUserPort = await listen(tgUserServer);
onvifHttpPort = await listen(onvifHttp);
const udpPort = await new Promise<number>(d => onvifUdp.bind(0, '127.0.0.1', () => d(onvifUdp.address().port)));
const scanPort = await new Promise<number>(d => rtsp.listen(0, '127.0.0.1', () => d((rtsp.address() as { port: number }).port)));

const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-ui-setup-'));
const shots = join(tmpdir(), 'cerebro-ui-setup-shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const PORT = 3292, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '',
    TG_API_ID: '', TG_API_HASH: '', TG_USER_FAKE_URL: `http://127.0.0.1:${tgUserPort}`,
    TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ANTHROPIC_BASE_URL: `http://127.0.0.1:${keysPort}`, GEMINI_API_ROOT: `http://127.0.0.1:${keysPort}`,
    ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'ui-setup-secret', TICK_MS: '700', BACKUP_KEEP: '0',
    CAMERA_TEST_INPUT: JSON.stringify(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=5']), CAMERA_PROBE_TARGETS: `127.0.0.1:${udpPort}`, CAMERA_SCAN_HOSTS: `127.0.0.1:${scanPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const BOT = '7412589630:AAHk3vQx9LmP2wZr8TnB4yCd6fGh1JsK0eQ', CLAUDE = 'sk-ant-api03-Xr7bN2kQp9LmW4zT8vY1cD6fH3jS0aE5gU';
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const errors: string[] = [];
const watch = (p: Page) => {
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
};
let n = 0;
const shot = (p: Page, name: string) => p.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && String(s.params.text ?? '').includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();

try {
  // Anketa admin API orqali yaratiladi (admin sahifasi alohida sinaladi)
  const adminToken = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin-pass-1' }) })).json()).token;
  const code = (await (await fetch(`${base}/api/admin/anketa`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ label: 'Shifo Dent', industry: 'stomatologiya' }) })).json()).anketa.code as string;

  console.log('\n# Anketa — egasining telefonida');
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  watch(phone);
  await phone.goto(`${base}/#/anketa/${code}`);
  await phone.getByLabel('Qabulxona telefoni').fill('+998 71 200 45 67');
  await phone.getByLabel('Manzil', { exact: true }).fill('Chilonzor 9-kvartal, 14-uy');
  await phone.getByLabel('Dushanba ish vaqti').fill('09:00–19:00');
  await phone.getByRole('button', { name: "Dushanbadagini juma'gacha qo'yish" }).click();
  await phone.getByLabel('Yakshanba ish vaqti').locator('..').getByRole('checkbox').check();
  await phone.locator('textarea').nth(2).fill("Konsultatsiya — bepul\nTish tozalash — 250 000\nPlomba — 350 000\nTish tozalash — 300 000");
  ok('anketa: narxlar jonli tanildi, ziddiyat ko\'rsatildi', await phone.getByText('ikki xil narx yozilgan').isVisible());
  await phone.getByLabel(/Birinchi ko'rik/).fill('Bepul');
  await phone.getByLabel('Bemorlar dasturi').selectOption('dentacrm');
  await phone.getByLabel('Kameralar').fill('1');
  await phone.getByLabel(/O'rnatuvchiga yana/).fill(`token ${BOT}`);
  ok('anketa: token yozilsa — ogohlantiradi, yuborish yopiq', await phone.getByRole('alert').filter({ hasText: 'kalitga' }).isVisible() && await phone.getByRole('button', { name: 'Anketani yuborish' }).isDisabled());
  await phone.getByLabel(/O'rnatuvchiga yana/).fill('Shanba kuni ham ochiqmiz, keyin aytaman');
  await shot(phone, 'anketa-telefonda');
  await phone.getByRole('button', { name: 'Anketani yuborish' }).click();
  ok('anketa yuborildi, kod ko\'rsatildi', await phone.getByText('Rahmat, anketa yuborildi').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await shot(phone, 'anketa-yuborildi');

  console.log('\n# Ulash ustasi');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(`${base}/#/ulash`);
  await page.getByLabel('Admin paroli').fill('admin-pass-1');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.getByLabel('Klinika nomi').fill('Shifo Dent');
  await shot(page, 'usta-klinika-yangi');
  await page.getByRole('button', { name: "Klinikani qo'shish" }).click();
  ok("klinika qo'shildi, login-parol ko'rsatildi", await page.getByText("Klinika qo'shildi").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.getByLabel('Anketa kodi').fill(code.toLowerCase());
  await page.getByLabel('Anketa serveri').fill(base);
  await page.getByRole('button', { name: 'Yuklash' }).click();
  ok('anketa kod bilan yuklandi', await page.getByText('Yuklandi:').waitFor({ timeout: 8000 }).then(() => true, () => false));
  await shot(page, 'usta-anketa-yuklandi');

  await page.getByRole('button', { name: 'Davom etish' }).click();
  const box = page.getByRole('textbox').first();
  await box.click();
  await page.evaluate(t => navigator.clipboard?.writeText(t).catch(() => {}), '');
  await box.fill(`${BOT}\n${CLAUDE}\nrtsp://admin:kamera123@127.0.0.1:${scanPort}/Streaming/Channels/102\nhttp://127.0.0.1:${crmPort}\n+998 90 123 45 67\n${CRM_LOGIN.password}`);
  await page.getByRole('button', { name: 'Tekshirish' }).click();
  ok('kalitlar: bot tokeni tekshirildi', await page.getByText('@cerebro_test_bot ulandi').waitFor({ timeout: 10000 }).then(() => true, () => false));
  ok('kalitlar: Claude kaliti ishlayapti', await page.getByText(/Kalit ishlayapti/).waitFor({ timeout: 10000 }).then(() => true, () => false));
  ok("kalitlar: tanilmagan qator so'raladi", await page.getByText('Bu nima?').isVisible());
  await page.getByRole('button', { name: 'DentaCRM paroli' }).click();
  ok("kalitlar: maxfiy qiymat ekranda yashirin", !(await page.locator('ul').first().innerText()).includes('LmP2wZr8'));
  await shot(page, 'usta-kalitlar');

  await page.getByRole('button', { name: 'Davom etish' }).click();
  const link = await page.locator('code').first().innerText();
  ok("egasi uchun ulash havolasi chiqdi", link.includes('t.me/cerebro_test_bot?start=o-'), link);
  await shot(page, 'usta-egasi-kutilmoqda');
  let mark = sent.length;
  say(OWNER, `/start ${link.split('start=')[1]}`);
  await waitFor('ulandi', () => toOwner(mark, 'Ulandi'));
  ok("egasi ulandi — sahifa o'zi yangilandi", await page.getByText(/Egasi @cerebro_test_bot bilan ulangan/).waitFor({ timeout: 10000 }).then(() => true, () => false));

  await page.getByRole('button', { name: 'Davom etish' }).click();
  ok("DentaCRM: manzil va parol kalitlar maydonidan o'tdi", (await page.getByLabel('DentaCRM manzili').inputValue()).includes(String(crmPort)) && (await page.getByLabel('Parol').inputValue()) === CRM_LOGIN.password);
  await page.getByLabel('Login').fill(CRM_LOGIN.username);
  await page.getByRole('button', { name: 'Ulash va tekshirish' }).click();
  ok('DentaCRM ulandi', await page.getByText(/^Ulandi: /).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await shot(page, 'usta-dentacrm');

  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByRole('button', { name: 'Tarmoqdan qidirish' }).click();
  ok('kamera tarmoqdan topildi', await page.getByText('Hikvision · ').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.getByLabel('Kamera paroli').fill('kamera123');
  await page.getByRole('button', { name: 'Ulash', exact: true }).first().click();
  ok('kamera ulandi, kadr chiqdi', await page.getByAltText(/kamerasidan kadr/).first().waitFor({ timeout: 25000 }).then(() => true, () => false));
  await shot(page, 'usta-kameralar');

  await page.getByRole('button', { name: 'Davom etish' }).click();
  ok("shaxsiy Telegram: raqam kalitlar maydonidan", (await page.getByLabel('Raqam').inputValue()) === '+998 90 123 45 67');
  await page.getByRole('button', { name: 'Kod yuborish' }).click();
  await page.getByLabel('Kod').fill('12345');
  await page.getByRole('button', { name: 'Tasdiqlash' }).click();
  ok('shaxsiy Telegram ulandi', await page.getByText('Ulandi: ').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await shot(page, 'usta-shaxsiy-telegram');

  await page.getByRole('button', { name: 'Davom etish' }).click();
  await shot(page, 'usta-instagram');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  ok("bo'shliqlar ro'yxati: ikki narx va shanba", await page.getByText(/narxi ikki xil/).isVisible() && await page.getByText(/shanba kuni ish vaqti/).isVisible());
  await shot(page, 'usta-boshliqlar');
  mark = sent.length;
  await page.getByRole('button', { name: "Egasidan Telegram'da so'rash" }).click();
  const q1 = await waitFor('narx savoli', () => toOwner(mark, 'narxi ikki xil'));
  mark = sent.length;
  press(OWNER, buttons(q1).find(b => b.text === "300 000 so'm")!.callback_data!, q1!.id!);
  const q2 = await waitFor('shanba', () => toOwner(mark, 'ish vaqti yozilmagan'));
  mark = sent.length;
  say(OWNER, '09:00–15:00');
  await waitFor('keyingi', () => toOwner(mark, 'Ish vaqti:'));
  ok("egasi javob bergan sari ro'yxat yangilandi", !!q2 && await page.getByText(/narxi ikki xil/).waitFor({ state: 'detached', timeout: 12000 }).then(() => true, () => false));
  await shot(page, 'usta-boshliqlar-hal');

  await page.getByRole('button', { name: 'Yakunlash' }).click();
  await shot(page, 'usta-yakun');
  ok('yakun: tayyor qadamlar sanaldi', await page.getByText(/\d\/8 tayyor/).isVisible());
  await page.getByRole('link', { name: "Kabinetga o'tish" }).click();
  ok("«Kabinetga o'tish» — klinika kabineti ochildi (qayta kirishsiz)", await page.getByLabel("Palantir'ga yozing").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await shot(page, 'kabinet');

  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(narrow);
  await narrow.goto(`${base}/#/ulash`);
  await narrow.getByLabel('Admin paroli').fill('admin-pass-1');
  await narrow.getByRole('button', { name: 'Kirish' }).click();
  await sleep(1200);
  ok("tor ekranda sahifa yonga surilmaydi", await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(narrow, 'usta-telefonda');

  ok('brauzerda xato yo\'q', errors.length === 0, errors.slice(0, 5).join(' | '));
  ok("serverda kutilmagan xato yo'q", !/\[http\]|TypeError|ReferenceError/.test(log), log.split('\n').filter(l => /\[http\]|Error/.test(l)).slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
  await sleep(500);
  for (const s of [tgServer, keysServer, crmServer, tgUserServer, onvifHttp]) s.close();
  onvifUdp.close();
  rtsp.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`\nSkrinshotlar: ${shots}`);
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} o'tdi`);
process.exit(passed === results.length ? 0 : 1);
