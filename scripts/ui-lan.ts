/**
 * Qabulxonadagi boshqa kompyuter (klinika ichidagi tarmoq, server/lan.ts) — haqiqiy brauzerda (ko'rinmas oyna):
 *   server LISTEN_HOST=0.0.0.0 → panel shu kompyuterning ichki manzili bilan ochiladi (http://192.168.x.x — brauzer uchun himoyasiz sahifa,
 *   boshqa kompyuterdagi kabi) → «sozlashni davom ettirish» u yerdan ishlamaydi → egasi login-parol bilan kiradi → Sozlamalar →
 *   Xodimlar: manzillar ko'rinadi, «Nusxalash» himoyasiz sahifada ham ishlaydi (matnda manzil bor) → mikrofon tugmasi aniq sabab aytadi.
 * Tarmoq manzili bo'lmasa (kompyuter tarmoqqa ulanmagan) — sinov o'tkazib yuboriladi.
 * Ishga tushirish: npm run build && npm run test:ui-lan
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { listen, sleep, stopProcess, tgServer } from './fakes';
import { chromePath } from './chrome';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer);
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-ui-lan-'));
const PORT = 3300, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '0.0.0.0', DATA_DIR: dataDir, ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
    // Soxta ovoz kaliti: suhbatdagi mikrofon tugmasi chiqsin (bosilganda internetga chiqilmaydi — mikrofon brauzerda yo'q)
    BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', GEMINI_API_KEY: '', GROQ_API_KEY: 'gsk_sinov_soxta', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
    TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, SESSION_SECRET: 'ui-lan-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => server.kill());
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }

const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => (await (await fetch(`${base}${path}`, init)).json()) as T;
const post = (body: unknown, token?: string): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath: chromePath() });
const errors: string[] = [];
try {
  // O'rnatuvchi shu kompyuterda topshirdi (ulash ustasi — ui-profile.ts): egasining logini va paroli
  const setup = await json<{ token: string }>('/api/login/setup', post({}));
  const given = await json<{ login: string; password: string }>('/api/handover', post({ login: 'lanklinika' }, setup.token));
  const owner = await json<{ token: string }>('/api/login', post({ login: given.login, password: given.password }));
  const where = (await json<{ where: { lan: string[]; hub: string | null } }>('/api/team-access', { headers: { authorization: `Bearer ${owner.token}` } })).where;
  const lan = where.lan[0];
  if (!lan) {
    console.log("\n(tarmoq manzili yo'q — kompyuter tarmoqqa ulanmagan, sinov o'tkazib yuborildi)");
  } else {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    // Xodim logini so'raladi (window.prompt): taklif qilingani olinadi
    page.on('dialog', d => { void d.accept(d.type() === 'prompt' ? d.defaultValue() || 'dilnoza' : undefined); });
    // Nusxalangan matn: himoyasiz sahifada navigator.clipboard yo'q — eski «copy» buyrug'ini kuzatamiz (src/lib/clipboard.ts)
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      const original = document.execCommand.bind(document);
      document.execCommand = (cmd: string, ...rest: unknown[]) => {
        if (cmd === 'copy') {
          const el = document.activeElement as HTMLTextAreaElement | null;
          w.__copied.push(el && typeof el.value === 'string' ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? el.value.length) : String(document.getSelection()));
        }
        return original(cmd, ...(rest as [boolean?, string?]));
      };
    });

    console.log(`\n# Boshqa kompyuter: ${lan}`);
    await page.goto(`${lan}/#/`);
    await page.getByRole('heading', { name: 'Kabinetga kirish' }).waitFor({ timeout: 15_000 });
    ok("sahifa himoyasiz (http, boshqa kompyuterdagi kabi) — clipboard va mikrofon brauzerda yo'q",
      await page.evaluate(() => !window.isSecureContext && !navigator.clipboard && !navigator.mediaDevices));
    ok("«Sozlashni davom ettirish» yo'q (topshirilgan)", !(await page.getByRole('link', { name: 'Sozlashni davom ettirish' }).count()));
    const setupFromLan = await page.evaluate(async () => (await fetch('/api/login/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    ok("ichki manzildan parolsiz sozlash kirishi — yo'q", setupFromLan === 403 || setupFromLan === 409, String(setupFromLan));
    await page.getByLabel('Login').fill(given.login);
    await page.getByLabel('Parol').fill(given.password);
    await page.getByRole('button', { name: 'Kirish' }).click();
    await page.waitForFunction(() => !document.querySelector('h1')?.textContent?.includes('Kabinetga kirish'), null, { timeout: 15_000 });
    ok('egasi boshqa kompyuterdan login-parol bilan kirdi', !(await page.getByRole('heading', { name: 'Kabinetga kirish' }).count()));

    console.log('\n# Sozlamalar → Xodimlar kirishi');
    await page.goto(`${lan}/#/sozlamalar/xodimlar`);
    const box = page.getByTestId('panel-where');
    await box.waitFor({ timeout: 15_000 });
    ok('«Xodim panelni qayerdan ochadi»: klinika ichidagi manzil', (await box.textContent())?.includes(lan), (await box.textContent()) ?? '');
    await page.locator('#staff-name').fill('Dilnoza');
    await page.getByRole('button', { name: "Qo'shish" }).click();
    await page.getByRole('button', { name: 'Qabulxona sifatida kirsin' }).click();
    const creds = page.getByTestId('staff-creds');
    await creds.waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Nusxalash', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Nusxalandi' }).waitFor({ timeout: 5_000 }).catch(() => {});
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '');
    ok("«Nusxalash» himoyasiz sahifada ham ishladi: matnda manzil, login, parol", copied.includes(`Manzil: ${lan}`) && /Login: dilnoza/.test(copied) && /Parol: \S{8,}/.test(copied),
      copied.replace(/Parol: \S+/, 'Parol: •••'));
    ok('«Nusxalandi» deb aytildi', await page.getByRole('status').filter({ hasText: 'Nusxalandi' }).count() > 0);

    console.log('\n# Mikrofon');
    await page.goto(`${lan}/#/yordamchi/suhbat`);
    const mic = page.getByRole('button', { name: 'Ovozli xabar' });
    await mic.waitFor({ timeout: 15_000 });
    await mic.click();
    const said = page.getByRole('status').filter({ hasText: 'mikrofon ishlamaydi' });
    ok("mikrofon tugmasi: «ruxsat berilmadi» emas — aniq sabab", await said.waitFor({ timeout: 5_000 }).then(() => true, () => false));
    ok("brauzerda xato yo'q", !errors.length, errors.slice(0, 3).join(' | '));
  }
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  await browser.close();
  await stopProcess(server);
  tgServer.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
process.exit(failed ? 1 : 0);
