/**
 * «Kompyuterda ishlash»ni egasi Sozlamalarda o'zi yoqadi — sinov (soxta Telegram va Claude, brauzer ochilmaydi):
 *   standart o'chiq: yordamchida computer_task yo'q, Telegram menyusida /brauzer yo'q; egasi yoqdi — qayta ishga tushirmasdan
 *   asbob ham, buyruq ham paydo bo'ladi; xodim ko'radi, lekin o'zgartira olmaydi (403); kirish oynasi manzili tekshiriladi;
 *   o'chirildi — yana yo'qoladi. .env da COMPUTER_USE berilgan bo'lsa — o'rnatuvchining qarori: «sozlangan», egasi o'zgartira olmaydi (409).
 * Ishga tushirish: npm run test:computer-toggle
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ai, aiServer, listen, sent, sleep, stopProcess, tgServer } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const tgPort = await listen(tgServer), aiPort = await listen(aiServer);
const dirs: string[] = [];
let log = '';

function boot(port: number, extra: Record<string, string>): ChildProcess {
  const dataDir = mkdtempSync(join(tmpdir(), 'palantir-kompyuter-'));
  dirs.push(dataDir);
  const p = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(port), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'toggle-secret', TICK_MS: '500',
      MORNING_HOUR: '99', EVENING_HOUR: '99', WEB_SEARCH: '0', BACKUP_KEEP: '0', COMPUTER_USE: '', CHROME_USER_DATA: join(dataDir, 'chrome-yoq'),
      GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout!.on('data', d => { log += d; });
  p.stderr!.on('data', d => { log += d; });
  return p;
}

const client = (base: string) => async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
  const r = await fetch(base + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
};
async function ready(base: string) {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* hali */ } await sleep(250); }
  throw new Error(`server ko'tarilmadi: ${base}`);
}
async function owner(api: ReturnType<typeof client>) {
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Mebel Uyi', industry: 'mebel', login: 'mebel', password: 'secret12' } });
  return (await api('/api/login', { body: { login: 'mebel', password: 'secret12' } })).json.token as string;
}
/** Panel suhbatiga gap — yordamchiga borgan asboblar nomi */
async function toolsOnChat(api: ReturnType<typeof client>, token: string): Promise<string[]> {
  const before = ai.requests.length;
  await api('/api/chat', { token, body: { text: "Meta Business'da Leadboost nomini Verion IT Company deb o'zgartir" } });
  const req = ai.requests.slice(before).find(r => Array.isArray(r.tools) && r.tools.length > 0);
  return (req?.tools ?? []).map(t => String(t.name));
}
const commandsSince = (mark: number) => sent.slice(mark).filter(s => s.method === 'setMyCommands')
  .map(s => (s.params.commands as { command: string }[] | string | undefined)).map(c => JSON.stringify(c ?? ''));
async function waitCommands(mark: number, cond: (cmds: string) => boolean) {
  for (let i = 0; i < 40; i++) { const last = commandsSince(mark).at(-1); if (last && cond(last)) return last; await sleep(150); }
  return commandsSince(mark).at(-1) ?? '';
}

const PORT = 3321, PORT_FIXED = 3322;
const server = boot(PORT, {});
let fixed: ChildProcess | null = null;
try {
  const base = `http://127.0.0.1:${PORT}`, api = client(base);
  await ready(base);
  const token = await owner(api);

  console.log('\n# Standart: o\'chiq');
  const v0 = (await api('/api/account/computer', { token })).json;
  ok("o'chiq, egasi o'zgartira oladi", v0.browser === false && v0.fixed === false && v0.owner === true && v0.job === null, JSON.stringify(v0));
  ok("yordamchida computer_task yo'q", !(await toolsOnChat(api, token)).includes('computer_task'));
  ok("kirish oynasi ochilmaydi — «Sozlamalarda yoqing»", await (async () => {
    const r = await api('/api/account/computer/login', { token, body: {} });
    return r.status === 409 && /Sozlamalar/.test(r.json.error);
  })());

  console.log('\n# Egasi yoqdi');
  let mark = sent.length;
  const on = await api('/api/account/computer', { token, method: 'PUT', body: { browser: true } });
  ok('yoqildi', on.status === 200 && on.json.browser === true && on.json.desktop === false, JSON.stringify(on.json));
  const tools = await toolsOnChat(api, token);
  ok('qayta ishga tushirmasdan yordamchiga computer_task qo\'shildi', tools.includes('computer_task') && tools.includes('computer_stop'), tools.filter(t => t.startsWith('computer')).join(','));
  ok("Telegram menyusida /brauzer va /toxta paydo bo'ldi", /brauzer/.test(await waitCommands(mark, c => /brauzer/.test(c))) && /toxta/.test(commandsSince(mark).at(-1) ?? ''));
  ok('qayta o\'qilganda ham yoqiq (bazada)', (await api('/api/account/computer', { token })).json.browser === true);

  console.log('\n# Manzil tekshiruvi');
  ok("file:, javascript:, ftp: — 400", (await Promise.all(['file:///C:/Windows', 'javascript:alert(1)', 'ftp://x.uz', 'business.facebook.com'].map(url => api('/api/account/computer/login', { token, body: { url } }))))
    .every(r => r.status === 400));
  ok("noto'g'ri ma'lumot (browser: 'ha') — 400", (await api('/api/account/computer', { token, method: 'PUT', body: { browser: 'ha' } })).status === 400);
  ok("ochiq oyna yo'q — yopish xatosiz", (await api('/api/account/computer/login', { token, method: 'DELETE' })).json.closed === false);

  console.log('\n# Xodim');
  const staffId = (await api('/api/staff', { token, body: { name: 'Dilnoza' } })).json.staff.find((s: { name: string }) => s.name === 'Dilnoza').id;
  const grant = (await api(`/api/team-access/${staffId}`, { token, body: { access: 'manager', login: 'dilnoza' } })).json;
  const staff = (await api('/api/login', { body: { login: 'dilnoza', password: grant.password } })).json.token;
  const sv = await api('/api/account/computer', { token: staff });
  ok("xodimga bo'lim yopiq (hisob sozlamalari — faqat egasiga)", sv.status === 403, `${sv.status} ${JSON.stringify(sv.json)}`);
  ok("xodim yoqa/o'chira olmaydi, oyna ocholmaydi — 403", (await api('/api/account/computer', { token: staff, method: 'PUT', body: { browser: false } })).status === 403
    && (await api('/api/account/computer/login', { token: staff, body: {} })).status === 403 && (await api('/api/account/computer/login', { token: staff, method: 'DELETE' })).status === 403
    && (await api('/api/account/computer/chrome-setup', { token: staff, body: {} })).status === 403);
  ok("xodim urinishidan keyin ham yoqiq", (await api('/api/account/computer', { token })).json.browser === true);

  console.log("\n# «Mening Chrome'im»");
  const chrome = await api('/api/account/computer', { token, method: 'PUT', body: { mode: 'chrome' } });
  ok("tanlandi: mode chrome, ulanish hali yoqilmagan (Chrome'da DevToolsActivePort yo'q)", chrome.status === 200 && chrome.json.mode === 'chrome' && chrome.json.browser === true
    && chrome.json.chrome?.debugging === false && chrome.json.chrome?.connected === false, JSON.stringify(chrome.json));
  ok('yordamchida computer_task bor', (await toolsOnChat(api, token)).includes('computer_task'));
  const ownLogin = await api('/api/account/computer/login', { token, body: {} });
  ok("alohida kirish oynasi kerak emas — 409, «o'z Chrome'ingizda»", ownLogin.status === 409 && /o'z Chrome/.test(ownLogin.json.error), JSON.stringify(ownLogin.json));
  ok("noto'g'ri rejim — 400", (await api('/api/account/computer', { token, method: 'PUT', body: { mode: 'hammasi' } })).status === 400);
  const back = await api('/api/account/computer', { token, method: 'PUT', body: { mode: 'browser' } });
  ok("alohida brauzerga qaytdi (chrome holati yo'q)", back.json.mode === 'browser' && back.json.chrome === null, JSON.stringify(back.json));

  console.log('\n# Egasi o\'chirdi');
  mark = sent.length;
  const off = await api('/api/account/computer', { token, method: 'PUT', body: { browser: false } });
  ok("o'chirildi", off.status === 200 && off.json.browser === false);
  ok("yordamchidan computer_task olib tashlandi", !(await toolsOnChat(api, token)).includes('computer_task'));
  ok("Telegram menyusidan /brauzer olib tashlandi", !/brauzer/.test(await waitCommands(mark, c => !/brauzer/.test(c))));

  console.log('\n# .env da o\'rnatuvchi yoqqan (COMPUTER_USE=browser)');
  fixed = boot(PORT_FIXED, { COMPUTER_USE: 'browser' });
  const fbase = `http://127.0.0.1:${PORT_FIXED}`, fapi = client(fbase);
  await ready(fbase);
  const ftoken = await owner(fapi);
  const fv = (await fapi('/api/account/computer', { token: ftoken })).json;
  ok("yoqiq va «o'rnatuvchi sozlagan»", fv.browser === true && fv.fixed === true, JSON.stringify(fv));
  const fput = await fapi('/api/account/computer', { token: ftoken, method: 'PUT', body: { browser: false } });
  ok("egasi o'chira olmaydi — 409, tushuntirish bilan", fput.status === 409 && /o'rnatuvchi/.test(fput.json.error), JSON.stringify(fput.json));
  ok("asbob bor (avvalgidek)", (await toolsOnChat(fapi, ftoken)).includes('computer_task'));
  ok('server xatosiz', !/\[kompyuter\]|TypeError|ReferenceError/.test(log), log.split('\n').filter(l => /\[kompyuter\]|Error/.test(l)).slice(0, 3).join(' | '));
} catch (e) {
  ok('sinov yiqildi', false, (e as Error).stack ?? String(e));
} finally {
  await stopProcess(server);
  if (fixed) await stopProcess(fixed);
  for (const s of [tgServer, aiServer]) s.close();
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Windows: fayl hali band */ } }
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) { console.log(log.split('\n').slice(-40).join('\n')); process.exit(1); }
process.exit(0);
