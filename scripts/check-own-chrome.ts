/**
 * Egasining o'z Chrome'iga ulanish (server/computer/ownChrome.ts + browser.ts attach rejimi) — haqiqiy Chrome bilan, ko'rinmas:
 *   alohida vaqtinchalik profil bilan Chrome ochiladi («egasining Chrome'i»: unda egasining vkladkasi bor), Chrome o'zi DevToolsActivePort
 *   yozadi — Palantir uni topib ulanadi; yordamchi o'z vkladkasida ishlaydi, egasining vkladkasini ko'rmaydi va unga tegmaydi;
 *   ichki tarmoq yopiq; ish tugaganda ish vkladkasi ochiq qoladi (cheklovsiz, endi egasiniki), bo'shi yopiladi; uzilgandan keyin ham Chrome tirik.
 *   Ulanish yoqilmagan (DevToolsActivePort yo'q yoki eskirgan) — tushunarli xato.
 * Ishga tushirish: npm run test:own-chrome
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from './chrome';
import { listen, sleep } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const site = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>${req.url === '/egasi' ? 'Egasining sahifasi' : 'Sinov sahifasi'}</title><h1>${req.url}</h1>`);
});
const port = await listen(site);
const SITE = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-own-chrome-'));
process.env.CHROME_USER_DATA = dataDir;
const { BrowserSession } = await import('../server/computer/browser');
const { OwnChromeError, connectOwnChrome, ownChromeState, readEndpoint, releaseOwnChrome } = await import('../server/computer/ownChrome');

console.log('\n# Ulanish yoqilmagan');
const off = await connectOwnChrome(undefined, 3_000).catch(e => e as Error);
ok("DevToolsActivePort yo'q — «yoqilmagan», chrome://inspect ko'rsatiladi", off instanceof OwnChromeError && off.reason === 'not_enabled' && /chrome:\/\/inspect/.test(off.message), String(off));
writeFileSync(join(dataDir, 'DevToolsActivePort'), '1\n/devtools/browser/eski\n');
const stale = await connectOwnChrome(undefined, 3_000).catch(e => e as Error);
ok('eskirgan fayl (Chrome yopiq, port yopiq) — «yoqilmagan»', stale instanceof OwnChromeError && stale.reason === 'not_enabled', String(stale));
rmSync(join(dataDir, 'DevToolsActivePort'));

const chrome = spawn(chromePath(), ['--headless=new', `--user-data-dir=${dataDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `${SITE}/egasi`], { stdio: 'ignore' });
try {
  for (let i = 0; i < 100 && !readEndpoint(); i++) await sleep(200);
  console.log('\n# Egasining Chrome\'i');
  ok("Chrome o'zi DevToolsActivePort yozdi — Palantir topdi", !!readEndpoint(), String(readEndpoint()?.url));
  let asked = 0;
  const b = await connectOwnChrome(() => { asked++; }, 15_000);
  const again = await connectOwnChrome(() => { asked++; }, 15_000);
  ok("ulandi; ikkinchi chaqiruv — o'sha ulanish (Chrome qayta «Allow?» so'ramaydi)", b === again && asked === 1, `so'rovlar: ${asked}`);
  ok('holat: ulanish yoqilgan va Palantir ulangan', JSON.stringify(await ownChromeState()).includes('"debugging":true') && (await ownChromeState()).connected);

  const approvals: string[] = [];
  const s = await BrowserSession.open({
    profileDir: '', downloadsDir: join(dataDir, 'yuklama'), headless: true, attach: b,
    approve: async what => { approvals.push(what); return false; },
    policy: { allowedSites: [], allowHosts: [`127.0.0.1:${port}`] },
  });
  const text = (r: { content: unknown[] }) => JSON.stringify(r.content);
  const listed = text(await s.run('list_tabs', {}));
  ok("yordamchi faqat o'z vkladkasini ko'radi (egasiniki ro'yxatda yo'q)", !listed.includes('/egasi') && (listed.match(/tab_id/g) ?? []).length === 1, listed.slice(0, 200));
  const nav = text(await s.run('navigate', { url: `${SITE}/ish` }));
  ok("o'z vkladkasida sahifani ochdi", nav.includes('/ish') && nav.includes('Sinov sahifasi'), nav.slice(0, 200));
  const page = text(await s.run('get_page_text', {}));
  ok("sahifani o'qidi (yordamchi skripti o'z vkladkasida ishlaydi)", page.includes('/ish'), page.slice(0, 120));
  const blocked = await s.run('navigate', { url: 'http://127.0.0.1:9/' });
  ok('ichki tarmoq yopiq (ruxsat berilmagan port)', blocked.isError === true, text(blocked).slice(0, 160));
  await s.run('new_tab', {});
  ok("yangi vkladka ham o'ziniki (2 ta, egasiniki yo'q)", (text(await s.run('list_tabs', {})).match(/tab_id/g) ?? []).length === 2);
  const ownerPage = b.contexts()[0].pages().find(p => p.url().endsWith('/egasi'));
  ok('egasining vkladkasi joyida, tegilmagan', !!ownerPage && ownerPage.url() === `${SITE}/egasi`);

  await s.close();
  const after = b.contexts()[0].pages().map(p => p.url());
  ok("tugadi: ish vkladkasi ochiq qoldi (egasi davom etadi), bo'sh vkladka yopildi, egasiniki joyida",
    after.some(u => u.endsWith('/egasi')) && after.some(u => u.endsWith('/ish')) && !after.some(u => u === 'about:blank'), after.join(', '));
  // Endi u egasining vkladkasi: Palantir sayt cheklovi olib tashlangan
  const other = createServer((_q, r) => r.end('boshqa sayt'));
  const otherPort = await listen(other);
  const left = b.contexts()[0].pages().find(p => p.url().endsWith('/ish'))!;
  const opened = await left.goto(`http://127.0.0.1:${otherPort}/`).then(r => !!r?.ok(), () => false);
  other.close();
  ok("qolgan vkladkada egasi istalgan saytni ochadi (Palantir cheklovi yo'q)", opened);
  await releaseOwnChrome();
  await sleep(500);
  ok("uzilgandan keyin Chrome tirik (egasining Chrome'i o'chmadi)", chrome.exitCode === null);
  const check = await chromium.connectOverCDP(readEndpoint()!.url);
  ok("qayta ulanish: egasining vkladkasi hamon ochiq", check.contexts()[0].pages().some(p => p.url().endsWith('/egasi')));
  await check.close().catch(() => {});
} catch (e) {
  ok('sinov yiqildi', false, (e as Error).stack ?? String(e));
} finally {
  chrome.kill();
  site.close();
  await sleep(500);
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Windows: band */ }
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);

