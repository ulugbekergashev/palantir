/**
 * Klinika o'z Claude obunasiga panel orqali kiradi (server/subscription/login.ts) — soxta `claude` bilan (scripts/fake-claude.mjs),
 * haqiqiy brauzerda (ko'rinmas oyna), API kalitsiz:
 *   holat «kirilmagan», kirishsiz obunaga o'tib bo'lmaydi → Ulash ustasi → Kalitlar → «Claude obunasiga kirish» → havola (terminal
 *   belgilarisiz) va kod maydoni → noto'g'ri kod rad etiladi → to'g'ri kod → «Kirilgan: Claude Max», AI obunaga o'tdi, Claude kaliti
 *   majburiy emas → server qayta yoqilsa ham obunada qoladi → server kompyuterida brauzer o'zi tugatadi → bekor qilish → xato.
 * Ishga tushirish: npm run build && npm run test:ui-obuna
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { KeyView, ObunaStatus } from '../src/types';
import { listen, sleep, stopProcess, tgServer } from './fakes';
import { chromePath } from './chrome';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer);
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-ui-obuna-'));
const stateFile = join(dataDir, 'soxta-claude.json');
const fake = (s: Record<string, unknown>) => writeFileSync(stateFile, JSON.stringify(s));
fake({ loggedIn: false, mode: 'code' });

const PORT = 3301, base = `http://127.0.0.1:${PORT}`;
let log = '';
const start = async (): Promise<ChildProcess> => {
  const proc = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
      AI_ENGINE: '', CLAUDE_BIN: resolve('scripts/fake-claude.mjs'), FAKE_CLAUDE_STATE: stateFile, CLAUDE_CODE_OAUTH_TOKEN: '',
      BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, SESSION_SECRET: 'ui-obuna-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', d => { log += d; });
  proc.stderr?.on('data', d => { log += d; });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  return proc;
};
let server = await start();
process.on('exit', () => server.kill());

let token = '';
const call = async <T>(path: string, body?: unknown): Promise<{ status: number; json: T }> => {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as T };
};
const status = async () => (await call<ObunaStatus>('/keys/obuna?fresh=1')).json;
const claudeKeyRequired = async () => (await call<{ keys: KeyView[] }>('/keys')).json.keys.find(k => k.name === 'ANTHROPIC_API_KEY')?.required;
const aiOn = async () => (await call<{ status: { ai: boolean } }>('/me')).json.status.ai;
const until = async (cond: () => Promise<boolean>, ms = 10_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await cond()) return true; return false; };

const browser = await chromium.launch({ executablePath: chromePath() });
const errors: string[] = [];
try {
  token = (await call<{ token: string }>('/login/setup', {})).json.token;

  console.log('\n# Holat: kalit ham, obuna ham yo\'q');
  const s0 = await status();
  ok("Claude dasturi topildi, kirilmagan, AI API yo'lida", s0.available && !s0.loggedIn && s0.engine === 'api' && !s0.apiKey, JSON.stringify(s0));
  ok('Claude kaliti hozircha majburiy, AI o\'chiq', await claudeKeyRequired() === true && await aiOn() === false);
  const early = await call<{ error: string }>('/keys/obuna/engine', { engine: 'subscription' });
  ok("kirmasdan obunaga o'tib bo'lmaydi", early.status === 400 && /kiring/.test(early.json.error), JSON.stringify(early));
  const noLogin = await call<{ error: string }>('/keys/obuna/kod', { code: 'goodcode#state1' });
  ok("kirish boshlanmagan bo'lsa kod qabul qilinmaydi", noLogin.status === 409, JSON.stringify(noLogin));

  console.log('\n# Ulash ustasi → Kalitlar → Claude obunasi (boshqa qurilmadan kod bilan)');
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/#/ulash`);
  await page.locator('aside').getByRole('button', { name: /Kalitlar/ }).click();
  const card = page.getByTestId('claude-obuna');
  await card.getByRole('button', { name: 'Claude obunasiga kirish' }).click();
  const link = card.getByRole('link', { name: /Havolani ochish/ });
  await link.waitFor({ timeout: 10_000 });
  const href = await link.getAttribute('href');
  ok('havola chiqdi, terminal belgilarisiz', href === 'https://claude.com/cai/oauth/authorize?code=true&client_id=sinov&state=state1', String(href));
  ok("«server kompyuterida brauzer ochildi» deyiladi", await card.getByText(/Server kompyuterida brauzer ochildi/).isVisible());

  await card.getByLabel("Sahifa ko'rsatgan kod").fill('yarim kod');
  await card.getByRole('button', { name: 'Kodni yuborish' }).click();
  ok("chala kod (bo'sh joy, #siz) rad etildi — kirish davom etadi", await card.getByRole('alert').filter({ hasText: "Kod to'liq emas" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await card.getByLabel("Sahifa ko'rsatgan kod").fill('goodcode#state1');
  await card.getByRole('button', { name: 'Kodni yuborish' }).click();
  const done = await card.getByText('Kirilgan: Claude Max · klinika@example.uz').waitFor({ timeout: 10_000 }).then(() => true, () => false);
  ok('to\'g\'ri kod → «Kirilgan: Claude Max · klinika@example.uz»', done);
  ok('«AI shu obuna orqali ishlayapti»', await card.getByText('AI shu obuna orqali ishlayapti.').isVisible());

  const s1 = await status();
  ok("server: AI obunaga o'tdi", s1.loggedIn && s1.engine === 'subscription' && s1.plan === 'max', JSON.stringify(s1));
  ok('Claude kaliti endi majburiy emas', await claudeKeyRequired() === false);
  ok('AI yoqildi (API kalitsiz)', await aiOn() === true);

  console.log('\n# Server qayta yoqildi — tanlov saqlangan');
  await stopProcess(server);
  server = await start();
  token = (await call<{ token: string }>('/login/setup', {})).json.token;
  ok('qayta yoqilgach ham AI obunada', (await status()).engine === 'subscription');

  console.log('\n# Server kompyuterida brauzer o\'zi tugatadi');
  fake({ loggedIn: false, mode: 'auto' });
  await call('/keys/obuna/kirish', {});
  ok('kod kiritmasdan kirildi (brauzer qaytdi)', await until(async () => { const s = await status(); return s.loggedIn && !s.login?.running; }));

  console.log('\n# Bekor qilish va xato');
  fake({ loggedIn: false, mode: 'code' });
  await call('/keys/obuna/kirish', {});
  await fetch(`${base}/api/keys/obuna/kirish`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  ok('bekor qilindi', await until(async () => (await status()).login?.error === 'Bekor qilindi'));
  fake({ loggedIn: false, mode: 'fail' });
  await call('/keys/obuna/kirish', {});
  ok('Claude rad etsa — sababi ko\'rinadi', await until(async () => /403/.test((await status()).login?.error ?? '')), (await status()).login?.error ?? '');
  await page.reload();
  await page.locator('aside').getByRole('button', { name: /Kalitlar/ }).click();
  ok('panelda «Kirilmadi: …» va qayta kirish tugmasi', await card.getByRole('alert').filter({ hasText: 'Kirilmadi:' }).waitFor({ timeout: 10_000 }).then(() => true, () => false)
    && await card.getByRole('button', { name: 'Claude obunasiga kirish' }).isVisible());
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
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
process.exit(failed ? 1 : 0);
