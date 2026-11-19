/**
 * Palantir kengaytmasi (extension/ + server/computer/extRelay.ts) — haqiqiy Chrome bilan, ko'rinmas:
 *   «egasining Chrome'i» ochiladi, unga kengaytma o'rnatiladi; kengaytma Palantir'ga o'zi ulanadi; Palantir «Allow?» so'ramasdan ulanadi
 *   (DevToolsActivePort yo'q); faqat o'z vkladkasida ishlaydi — egasining vkladkasini ko'rmaydi, yopa olmaydi; sahifani o'qiydi, bosadi,
 *   yozadi; undan ochilgan oyna ham uniki; ichki tarmoq yopiq; ish tugaganda vkladka ochiq qoladi, ulanish uziladi, keyingi ish yana ulanadi.
 *   Begona sayt (Origin) kengaytma o'rniga ulana olmaydi.
 * Ishga tushirish: npm run test:extension
 */
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { chromePath } from './chrome';
import { listen, sleep } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const site = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.url === '/egasi') return res.end('<title>Egasining sahifasi</title><h1>maxfiy</h1>');
  if (req.url === '/uzun' || req.url === '/uzun-tiq') {
    const rows = Array.from({ length: 60 }, (_, i) => `<p>klinika ${i}</p>`).join('');
    // /uzun-tiq — g'ildirak hodisasi yutiladi (orqa fondagi vkladka kabi: hodisa ro'yxatga yetmaydi)
    const swallow = req.url === '/uzun-tiq' ? `<script>addEventListener('wheel', e => e.preventDefault(), { passive: false })</script>` : '';
    return res.end(`<title>Uzun</title>${swallow}<div style="position:fixed;left:0;top:0;width:400px;height:300px;overflow-y:auto" onscroll="document.getElementById('s').textContent='aylandi:'+this.scrollTop">${rows}</div><h1 id="s" style="position:fixed;left:500px">aylandi:0</h1>`);
  }
  // Yopiladigan savol-javob (olcha.uz dagi narx kabi): «Narx» ko'rinadi, «Yopish» uni yashiradi
  if (req.url === '/faq') return res.end(`<title>FAQ</title><button onclick="document.getElementById('narx').style.display='none'">Yopish</button><div style="height:3000px"></div><p id="narx">Narx: 10 500 000</p>`);
  if (req.url === '/yubor') return res.end('<title>Yubor</title><button>Yuborish</button>');
  if (req.url === '/popup') return res.end('<title>Yangi oyna</title><h1>popup</h1>');
  res.end(`<title>Sinov sahifasi</title><h1 id="h">${req.url}</h1><input id="ism" aria-label="Ism"><button onclick="document.getElementById('h').textContent='bosildi:'+document.getElementById('ism').value">Tekshirish</button><a href="/popup" target="_blank">Oyna</a>`);
});
const sitePort = await listen(site);
const SITE = `http://127.0.0.1:${sitePort}`;

const dir = mkdtempSync(join(tmpdir(), 'palantir-ext-'));
process.env.CHROME_USER_DATA = join(dir, 'no-devtools'); // eski yo'l (DevToolsActivePort) yo'q — faqat kengaytma
const { attachExtensionRelay, extensionCommandForTest, extensionState } = await import('../server/computer/extRelay');
const { connectOwnChrome, doneWithOwnChrome, ownChromeState } = await import('../server/computer/ownChrome');
const { BrowserSession } = await import('../server/computer/browser');

const palantir = createServer((_q, r) => r.end('palantir'));
const port = await listen(palantir);
attachExtensionRelay(palantir, port);
// Kengaytma nusxasi shu sinov portiga qaraydi (haqiqiy Palantir 3200 da ishlab turgan bo'lishi mumkin)
cpSync('extension', join(dir, 'ext'), { recursive: true });
const bg = join(dir, 'ext', 'background.js');
writeFileSync(bg, readFileSync(bg, 'utf8').replaceAll(':3200/', `:${port}/`));

console.log('\n# Begona ulanishlar');
const evil = await new Promise<string>(done => {
  const w = new WebSocket(`ws://127.0.0.1:${port}/api/ext`, { origin: 'https://yomon-sayt.uz' });
  w.on('open', () => { w.close(); done('ochildi'); });
  w.on('error', () => done('rad'));
});
ok("begona sayt kengaytma o'rniga ulana olmaydi (Origin tekshiriladi)", evil === 'rad', evil);
ok("kengaytma yo'q — holat: ulanmagan", !extensionState().connected && !(await ownChromeState()).extension);

const owner = await chromium.launchPersistentContext(join(dir, 'egasi'), {
  executablePath: chromePath(), headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
try {
  const ownerTab = owner.pages()[0] ?? await owner.newPage();
  await ownerTab.goto(`${SITE}/egasi`);
  const cdp = await owner.browser()!.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked' as never, { path: join(dir, 'ext') } as never) as { id?: string };
  ok("kengaytma o'rnatildi, ID doimiy", loaded.id === 'beohfbpjkgnlbhpbbinpielchmhmodfd', loaded.id);
  for (let i = 0; i < 50 && !extensionState().connected; i++) await sleep(200);
  ok("kengaytma Palantir'ga o'zi ulandi", extensionState().connected, JSON.stringify(extensionState()));
  ok('panel holati: kengaytma bor — «Allow remote debugging» kerak emas', (await ownChromeState()).extension && (await ownChromeState()).debugging);

  console.log('\n# Ish');
  let asked = 0;
  const b = await connectOwnChrome(() => { asked++; }, 15_000);
  ok("ulandi, «Allow?» so'ralmadi", !!b && asked === 0, `so'rovlar: ${asked}`);
  const s = await BrowserSession.open({
    profileDir: '', downloadsDir: join(dir, 'yuklama'), headless: true, attach: b,
    approve: async () => false, policy: { allowedSites: [], allowHosts: [`127.0.0.1:${sitePort}`] },
  });
  const text = (r: { content: unknown[] }) => JSON.stringify(r.content);
  const listed = text(await s.run('list_tabs', {}));
  ok("faqat o'z vkladkasini ko'radi (egasiniki yo'q)", !listed.includes('/egasi') && (listed.match(/tab_id/g) ?? []).length === 1, listed.slice(0, 200));
  const nav = text(await s.run('navigate', { url: `${SITE}/ish` }));
  ok('sahifani ochdi', nav.includes('Sinov sahifasi'), nav.slice(0, 160));
  const page = text(await s.run('read_page', {}));
  const ref = (label: string) => page.match(new RegExp(`(ref_\\d+)[^\\]]*?${label}`))?.[1] ?? page.match(new RegExp(`${label}[^\\n]*?(ref_\\d+)`))?.[1];
  ok("sahifani o'qidi (tugma va maydon ko'rinadi)", page.includes('Tekshirish') && page.includes('Ism'), page.slice(0, 200));
  const input = ref('Ism'), button = ref('Tekshirish');
  await s.run('left_click', { target: { type: 'ref', ref: input } });
  await s.run('type', { text: 'Verion' });
  await s.run('left_click', { target: { type: 'ref', ref: button } });
  const after = text(await s.run('get_page_text', {}));
  ok('bosdi va yozdi (haqiqiy klik)', after.includes('bosildi:Verion'), after.slice(0, 160));
  // Google Maps kabi: ichki ro'yxat aylantiriladi (2026-11-19: kengaytma rejimida «aylantirib bo'lmadi»)
  await s.run('navigate', { url: `${SITE}/uzun` });
  const wheel = await s.run('scroll', { target: { type: 'coordinate', x: 200, y: 150 }, scroll_direction: 'down', scroll_amount: 3 });
  const scrolled = text(await s.run('get_page_text', {}));
  ok("ichki ro'yxat g'ildirak bilan aylandi", !wheel.isError && /aylandi:[1-9]/.test(scrolled), `${text(wheel).slice(0, 300)} | ${scrolled.slice(-40)}`);
  await s.run('navigate', { url: `${SITE}/uzun-tiq` });
  const stuck = await s.run('scroll', { target: { type: 'coordinate', x: 200, y: 150 }, scroll_direction: 'down', scroll_amount: 3 });
  const moved = text(await s.run('get_page_text', {}));
  await s.run('navigate', { url: `${SITE}/faq` });
  const faq = text(await s.run('find', { query: 'Narx: 10 500 000' }));
  const narx = faq.match(/ref_\d+/)?.[0] ?? '';
  const shownTo = await s.run('scroll_to', { target: { type: 'ref', ref: narx } });
  const close = text(await s.run('find', { query: 'Yopish' })).match(/ref_\d+/)?.[0] ?? '';
  await s.run('left_click', { target: { type: 'ref', ref: close } });
  const t0 = Date.now();
  const hiddenTo = await s.run('scroll_to', { target: { type: 'ref', ref: narx } });
  ok("scroll_to: ko'rinadigan elementga — OK; yashirin elementda 15 s osilmaydi, sababini aytadi", !!narx && !shownTo.isError && hiddenTo.isError === true
    && /yashirin/.test(text(hiddenTo)) && Date.now() - t0 < 8_000, `${narx} | ${text(shownTo).slice(0, 80)} | ${text(hiddenTo).slice(0, 120)} | ${Date.now() - t0} ms`);
  ok("g'ildirak yetib bormasa — ro'yxat baribir aylanadi (JS bilan)", !stuck.isError && /aylandi:[1-9]/.test(moved), `${text(stuck).slice(0, 300)} | ${moved.slice(-40)}`);
  const blocked = await s.run('navigate', { url: 'http://127.0.0.1:9/' });
  ok('ichki tarmoq yopiq', blocked.isError === true, text(blocked).slice(0, 120));
  await s.run('navigate', { url: `${SITE}/ish` });
  const page2 = text(await s.run('read_page', {}));
  const link = page2.match(/(ref_\d+)[^\]]*?Oyna/)?.[1] ?? page2.match(/Oyna[^\n]*?(ref_\d+)/)?.[1];
  await s.run('left_click', { target: { type: 'ref', ref: link } });
  await sleep(1500);
  const tabs2 = text(await s.run('list_tabs', {}));
  ok("undan ochilgan oyna ham Palantir'niki", tabs2.includes('/popup') && !tabs2.includes('/egasi'), tabs2.slice(0, 260));

  console.log("\n# Kengaytmaning o'z himoyasi (to'g'ridan-to'g'ri buyruqlar)");
  const raw = (m: string, p: unknown[]) => extensionCommandForTest(m, p).then(r => ({ ok: true, r }), (e: Error) => ({ ok: false, r: e.message }));
  const ids = Array.from({ length: 80 }, (_, n) => n + 1);
  const attachTries = await Promise.all(ids.map(id => raw('chrome.debugger.attach', [{ tabId: id }, '1.3'])));
  ok("begona (egasining) vkladkasiga ulanib bo'lmaydi", attachTries.every(t => !t.ok), `${attachTries.filter(t => t.ok).length} ta ulandi`);
  await raw('chrome.tabs.remove', [ids]);
  ok("egasining vkladkasini yopib bo'lmaydi", owner.pages().some(p => p.url().endsWith('/egasi')));
  const mine = await raw('chrome.tabs.create', [{ url: 'about:blank', active: false }]) as { ok: boolean; r: { id: number } };
  const tabId = mine.r.id;
  await raw('chrome.debugger.attach', [{ tabId }, '1.3']);
  const cookies = await raw('chrome.debugger.sendCommand', [{ tabId }, 'Network.getAllCookies', {}]);
  const storage = await raw('chrome.debugger.sendCommand', [{ tabId }, 'Storage.getCookies', {}]);
  const browserClose = await raw('chrome.debugger.sendCommand', [{ tabId }, 'Browser.close', {}]);
  const evalOk = await raw('chrome.debugger.sendCommand', [{ tabId }, 'Runtime.evaluate', { expression: '6*7', returnByValue: true }]);
  ok("cookie (butun profilniki) o'qilmaydi, brauzerni yopib bo'lmaydi", !cookies.ok && !storage.ok && !browserClose.ok, `${cookies.r} | ${storage.r}`);
  ok("vkladka ichidagi ish ruxsat", evalOk.ok && JSON.stringify(evalOk.r).includes('42'), JSON.stringify(evalOk.r).slice(0, 80));
  const second = await new Promise<string>(done => {
    const w = new WebSocket(`ws://127.0.0.1:${port}/api/ext`, { origin: 'chrome-extension://beohfbpjkgnlbhpbbinpielchmhmodfd' });
    w.on('close', (_c, reason) => done(reason.toString() || 'yopildi'));
    w.on('error', () => done('xato'));
  });
  ok('ikkinchi kengaytma rad etiladi, birinchisi ulangan qoladi', /allaqachon/.test(second) && extensionState().connected, second);
  const proxied = await new Promise<string>(done => {
    const w = new WebSocket(`ws://127.0.0.1:${port}/api/ext`, { origin: 'chrome-extension://beohfbpjkgnlbhpbbinpielchmhmodfd', headers: { 'x-forwarded-for': '203.0.113.5' } });
    w.on('open', () => { w.close(); done('ochildi'); });
    w.on('error', () => done('rad'));
  });
  ok("tunnel/proksi orqali (internetdan) ulanib bo'lmaydi", proxied === 'rad', proxied);

  await s.close();
  await doneWithOwnChrome();
  await sleep(800);
  const urls = owner.pages().map(p => p.url());
  ok("tugadi: ish vkladkasi ochiq, egasiniki joyida", urls.some(u => u.endsWith('/egasi')) && urls.some(u => u.endsWith('/ish')), urls.join(', '));
  ok('egasining vkladkasi tegilmagan', (await ownerTab.title()) === 'Egasining sahifasi');
  const afterEnd = await raw('chrome.debugger.sendCommand', [{ tabId }, 'Runtime.evaluate', { expression: '1' }]);
  ok("ish tugagach vkladkalar Palantir'niki emas — buyruq bajarilmaydi", !afterEnd.ok && /Palantirniki emas/.test(String(afterEnd.r)), String(afterEnd.r));

  console.log('\n# Keyingi ish');
  const b2 = await connectOwnChrome(() => { asked++; }, 15_000);
  const s2 = await BrowserSession.open({ profileDir: '', downloadsDir: join(dir, 'y2'), headless: true, attach: b2, approve: async () => null, policy: { allowedSites: [], allowHosts: [`127.0.0.1:${sitePort}`] } });
  const again = text(await s2.run('navigate', { url: `${SITE}/ikkinchi` }));
  ok("yana so'rovsiz ulandi va ishladi", asked === 0 && again.includes('/ikkinchi'), again.slice(0, 120));
  const listed2 = text(await s2.run('list_tabs', {}));
  ok("oldingi ishning vkladkalari endi egasiniki — ro'yxatda yo'q", !listed2.includes('/ish') && !listed2.includes('/popup'), listed2.slice(0, 200));
  // Egasi 10 daqiqa javob bermadi — «rad etdi» emas (2026-11-19: hisobotda «Siz ruxsat bermadingiz» deb yozilgan edi)
  await s2.run('navigate', { url: `${SITE}/yubor` });
  const send = text(await s2.run('find', { query: 'Yuborish' })).match(/ref_\d+/)?.[0] ?? '';
  const silent = await s2.run('left_click', { target: { type: 'ref', ref: send } });
  ok("egasi javob bermasa — «javob bermadi», «rad etdi» emas", silent.isError === true && /javob bermadi/.test(text(silent)) && !/ruxsat bermadi/.test(text(silent)), text(silent).slice(0, 160));
  await s2.close();
  await doneWithOwnChrome();
} catch (e) {
  ok('sinov yiqildi', false, (e as Error).stack ?? String(e));
} finally {
  await owner.close().catch(() => {});
  site.close();
  palantir.close();
  await sleep(300);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Windows: band */ }
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
