/**
 * Egasining o'z Chrome'i (Sozlamalar → «Kompyuterda ishlash» → «Mening Chrome'im»): yordamchi egasi allaqachon kirgan saytlarda
 * (Facebook, Google…) qayta kirmasdan ishlaydi. Chrome 136+ asosiy profilga --remote-debugging-port bilan ulanishni yopgan; egasi
 * chrome://inspect/#remote-debugging da «Allow remote debugging for this browser instance» ni bir marta yoqadi — Chrome profil
 * papkasiga DevToolsActivePort yozadi, har yangi ulanishda «Allow?» deb so'raydi. Shuning uchun ulanish bitta va doimiy saqlanadi:
 * so'rov Chrome har ochilganda bir marta chiqadi.
 * Yordamchi o'z vkladkasini ochadi; egasining boshqa vkladkalarini o'qimaydi va yopmaydi (browser.ts, attach rejimi).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { installedBrowser } from '../browserPath';
import { extensionCdpUrl, extensionState } from './extRelay';

/** Egasi Chrome'da «Allow» ni bosishini shuncha kutadi (90 s kam edi: egasi Telegram xabarini ko'rib, Chrome'ga o'tguncha vaqt o'tdi — 2026-11-19) */
export const CONSENT_WAIT_MS = 5 * 60_000;
const PORT_CHECK_MS = 1_500;
const EXTENSION_CONNECT_MS = 30_000;
export const DEBUG_SETTINGS_URL = 'chrome://inspect/#remote-debugging';

export class OwnChromeError extends Error {
  constructor(readonly reason: 'not_enabled' | 'no_consent' | 'no_chrome', message: string) { super(message); }
}

/** Chrome profillari papkasi (CHROME_USER_DATA — sinovda boshqa papka) */
export const chromeDataDir = (): string => process.env.CHROME_USER_DATA
  || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data')
    : process.platform === 'darwin' ? join(process.env.HOME ?? '', 'Library', 'Application Support', 'Google', 'Chrome')
      : join(process.env.HOME ?? '', '.config', 'google-chrome'));

/** DevToolsActivePort: 1-qator — port, 2-qator — brauzer ulanish yo'li. Yo'q yoki buzuq bo'lsa — null */
export function readEndpoint(dir = chromeDataDir()): { port: number; url: string } | null {
  try {
    const [portLine, path] = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/).map(s => s.trim());
    const port = Number(portLine);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !path?.startsWith('/devtools/browser/')) return null;
    return { port, url: `ws://127.0.0.1:${port}${path}` };
  } catch {
    return null;
  }
}

/** Port ochiqmi (Chrome yopilgandan keyin DevToolsActivePort eskirib qoladi) */
function portOpen(port: number): Promise<boolean> {
  return new Promise(done => {
    const s = connect({ host: '127.0.0.1', port });
    const end = (ok: boolean) => { s.destroy(); done(ok); };
    s.setTimeout(PORT_CHECK_MS, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

let live: Browser | null = null;
/** Ulanish Palantir kengaytmasi orqali (extRelay.ts): «Allow?» yo'q, har ish tugaganda uziladi — Chrome'dagi «debugging» paneli osilib qolmaydi */
let liveViaExtension = false;
let pending: Promise<Browser> | null = null;

export interface OwnChromeState { installed: boolean; debugging: boolean; connected: boolean; extension: boolean }

/** Panel uchun: Chrome bormi, egasi ulanishga ruxsat yoqqanmi, Palantir hozir ulanganmi */
export async function ownChromeState(): Promise<OwnChromeState> {
  const ep = readEndpoint();
  const extension = extensionState().connected;
  // Kengaytma ulangan bo'lsa — eski «Allow remote debugging» kerak emas: ulanish tayyor deb ko'rsatiladi
  return { installed: !!installedBrowser(), debugging: extension || (!!ep && await portOpen(ep.port)), connected: !!live?.isConnected(), extension };
}

const NOT_ENABLED = `Chrome'da ulanish yoqilmagan: Chrome'da ${DEBUG_SETTINGS_URL} sahifasini oching va «Allow remote debugging for this browser instance» ni yoqing (Palantir Sozlamalar → «Kompyuterda ishlash» dagi tugma o'zi ochadi). Chrome yopiq bo'lsa — oching.`;

/**
 * Egasining Chrome'iga ulanish (bitta, doimiy). onConsent — ulanish yangidan ochilayotganda (Chrome «Allow?» so'raydi) bir marta chaqiriladi:
 * egasiga Telegram'da aytish uchun
 */
export async function connectOwnChrome(onConsent?: () => void, waitMs = CONSENT_WAIT_MS): Promise<Browser> {
  if (live?.isConnected()) return live;
  if (pending) return pending;
  const viaExtension = extensionCdpUrl();
  if (viaExtension) {
    pending = chromium.connectOverCDP(viaExtension, { timeout: EXTENSION_CONNECT_MS, noDefaults: true }).then(b => {
      live = b;
      liveViaExtension = true;
      b.on('disconnected', () => { if (live === b) live = null; });
      return b;
    }, (e: Error) => { throw new OwnChromeError('not_enabled', `Palantir kengaytmasi orqali ulanib bo'lmadi: ${e.message.split('\n')[0].replace(/\/api\/ext\/cdp\/[\w-]+/g, '/api/ext/cdp/…').slice(0, 160)}`); })
      .finally(() => { pending = null; });
    return pending;
  }
  const ep = readEndpoint();
  if (!ep || !(await portOpen(ep.port))) throw new OwnChromeError('not_enabled', NOT_ENABLED);
  onConsent?.();
  pending = chromium.connectOverCDP(ep.url, { timeout: waitMs }).then(b => {
    live = b;
    liveViaExtension = false;
    b.on('disconnected', () => { if (live === b) live = null; });
    return b;
  }, (e: Error) => {
    throw /timeout/i.test(e.message)
      ? new OwnChromeError('no_consent', "Chrome'dagi «Allow» (ruxsat berish) so'roviga javob bo'lmadi — Chrome'ni oching, so'rovda «Allow» ni bosing va ishni qayta bering")
      : new OwnChromeError('not_enabled', `${NOT_ENABLED} (${e.message.split('\n')[0].slice(0, 120)})`);
  }).finally(() => { pending = null; });
  return pending;
}

/** Ulanish sozlamasi sahifasini egasining Chrome'ida ochadi (ochiq Chrome'da yangi vkladka bo'lib chiqadi) */
export function openDebugSettings(): void {
  const exe = installedBrowser();
  if (!exe || !/chrome/i.test(exe)) throw new OwnChromeError('no_chrome', 'Bu kompyuterda Google Chrome topilmadi');
  spawn(exe, [DEBUG_SETTINGS_URL], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

/** Palantir to'xtaganda: ulanish uziladi (Chrome'ning o'zi yopilmaydi) */
export async function releaseOwnChrome(): Promise<void> {
  const b = live;
  live = null;
  // connectOverCDP bilan ulangan brauzerda close() — faqat uzish; egasining Chrome'i ishlab qoladi
  if (b) await b.close().catch(() => {});
}

/** Ish tugadi: kengaytma orqali ulangan bo'lsa — uziladi (keyingi ish yangidan ulanadi, so'rovsiz); eski yo'lda ulanish saqlanadi («Allow?» qayta chiqmasin) */
export async function doneWithOwnChrome(): Promise<void> {
  if (liveViaExtension) await releaseOwnChrome();
}

/** Palantir kengaytmasining papkasi (nashr ichida: <Palantir papkasi>\extension) */
export const extensionDir = (): string => join(process.cwd(), 'extension');

/**
 * Kengaytmani o'rnatish: Chrome'da kengaytmalar sahifasi va Explorer'da kengaytma papkasi ochiladi — egasi «Developer mode» ni yoqib,
 * «Load unpacked» bilan shu papkani tanlaydi (bir marta). Chrome'ning o'zi chrome:// sahifani boshqa yo'l bilan ochishga yo'l qo'ymaydi
 */
export function openExtensionSetup(): { folder: string } {
  const exe = installedBrowser();
  if (!exe || !/chrome/i.test(exe)) throw new OwnChromeError('no_chrome', 'Bu kompyuterda Google Chrome topilmadi');
  const folder = extensionDir();
  spawn(exe, ['chrome://extensions'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  if (process.platform === 'win32') spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return { folder };
}
