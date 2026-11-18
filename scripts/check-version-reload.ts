/**
 * Panel Palantir yangilanganda o'zini yangilaydi (src/lib/useVersionReload.ts) — ko'rinmas brauzerda, soat tezlashtiriladi:
 *   server nashri o'zgarmasa — sahifa qayta yuklanmaydi; o'zgarsa — yuklanadi; egasi matn yozib turgan bo'lsa — kutadi, yozuv yo'qolmaydi.
 * Talab: npm run build. Ishga tushirish: npm run test:version-reload
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from './chrome';
import { aiServer, listen, sleep, stopProcess, tgServer } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer), aiPort = await listen(aiServer);
const PORT = 3324, base = `http://127.0.0.1:${PORT}`, data = mkdtempSync(join(tmpdir(), 'palantir-nashr-'));
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: data, CHROME_USER_DATA: join(data, 'yoq'), BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 's'.repeat(64), MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0', COMPUTER_USE: '', GEMINI_API_KEY: '', GROQ_API_KEY: '' },
  stdio: 'ignore',
});
const api = async (p: string, o: { token?: string; body?: unknown } = {}) => (await fetch(base + p, { method: o.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json() as Promise<any>;
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Tabassum Dent', industry: 'stomatologiya', login: 'tab', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'tab', password: 'secret12' } })).token;

  const page = await browser.newPage();
  let version = '1.0.0', loads = 0;
  // Server nashri — sinov boshqaradi (haqiqiy server javobi, faqat version almashtiriladi)
  await page.route('**/api/health', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), version } });
  });
  page.on('load', () => { loads++; });
  await page.clock.install();
  await page.goto(base);
  await page.evaluate(t => localStorage.setItem('palantir_token', t), token);
  await page.goto(`${base}/#/sozlamalar/asosiy`);
  await page.waitForLoadState('networkidle');
  const start = loads;
  await page.clock.fastForward(130_000);
  await sleep(500);
  ok("nashr o'zgarmadi — sahifa qayta yuklanmadi", loads === start, `yuklanishlar: ${loads - start}`);

  // Egasi matn yozib turibdi — yangilash kutadi
  const input = page.locator('textarea, input:not([type]), input[type="text"], input[type="search"]').first();
  await input.click();
  await input.fill('yozilayotgan matn');
  version = '1.0.1';
  await page.clock.fastForward(61_000);
  await sleep(500);
  ok("nashr o'zgardi, lekin egasi yozyapti — kutdi, yozuv joyida", loads === start && (await input.inputValue()) === 'yozilayotgan matn', `yuklanishlar: ${loads - start}`);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reloaded = page.waitForEvent('load', { timeout: 15_000 }).then(() => true, () => false);
  await page.clock.fastForward(61_000);
  ok("yozish tugadi — panel o'zi yangilandi (yangi nashr)", await reloaded);
} catch (e) {
  ok('sinov yiqildi', false, (e as Error).stack ?? String(e));
} finally {
  await browser.close();
  await stopProcess(server);
  tgServer.close();
  aiServer.close();
  try { rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* band */ }
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
