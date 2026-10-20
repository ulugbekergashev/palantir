/**
 * Instagram Direct — egasining o'z akkaunti orqali, Meta ilovasisiz.
 *
 * Cerebro shu kompyuterdagi Chrome (yoki Edge)ni alohida profil bilan ochadi:
 *   ulash  — ko'rinadigan oynada egasi Instagram'ga o'zi kiradi (parol Cerebro'ga berilmaydi,
 *            ikki bosqichli tekshiruv ham o'sha oynada). Keyin brauzer ko'rinmas holda ishlaydi;
 *   o'qish — har ~40 soniyada Direct (asosiy, «Umumiy» va «So'rovlar») sahifaning ichidan,
 *            instagram.com o'zi ishlatadigan so'rov bilan olinadi;
 *   yozish — suhbat ochiladi, matn yoziladi, Enter — odam kabi.
 *
 * Bu Instagram'ning rasmiy yo'li emas — akkaunt cheklanishi mumkin. Shuning uchun: faqat yozgan
 * odamga javob (birinchi bo'lib yozilmaydi), kunlik chegara, tasodifiy kechikishlar; Instagram
 * qayta kirishni so'rasa yoki cheklov qo'ysa — Cerebro to'xtaydi va egasiga aytadi.
 *
 * Ikki haydovchi: Playwright (haqiqiy brauzer) va sinov uchun soxta (IG_FAKE_URL).
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { iso, stamp } from '../../src/lib/week';
import { installedBrowser } from '../browserPath';
import { businesses, connections, leads, type BusinessRow, type ConnectionRow, type LeadRow } from '../db';
import { env } from '../env';
import { notifyOwner, onIncoming, onOwnerOutgoing, registerSender, replySettings } from './core';

const IG = 'https://www.instagram.com';
/** instagram.com veb-ilovasining o'z identifikatori — brauzerdagi Instagram so'rovlari shu bilan boradi */
const WEB_APP_ID = '936619743392459';
const INBOX = (folder?: number) => `/api/v1/direct_v2/inbox/?persistentBadging=true&limit=20&thread_message_limit=20${folder === undefined ? '' : `&folder=${folder}`}`;
const PENDING = '/api/v1/direct_v2/pending_inbox/?persistentBadging=true&limit=20&thread_message_limit=20';
/** Instagram cheklov qo'ysa — shuncha vaqt hech narsa qilinmaydi */
const PAUSE_MS = 12 * 3600_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Odamdek: har safar boshqacha kechikish */
const pause = (min: number, max: number) => sleep(min + Math.random() * (max - min));

/** Instagram qayta kirishni so'radi (login) yoki cheklov qo'ydi (limit) — ishlash to'xtatiladi */
export class IgStop extends Error {
  constructor(message: string, readonly kind: 'login' | 'limit') { super(message); }
}
/** Brauzer yopilib qolgan — qayta ochiladi */
class Detached extends Error {
  constructor() { super('Instagram brauzeri ishlamayapti — birozdan keyin qayta ochiladi'); }
}

interface Reply { status: number; url: string; body: string }

interface Driver {
  /** Ko'rinadigan oynada egasi o'zi kiradi; kirgach oyna yopiladi. Qaytaradi — brauzerning odatiy User-Agent'i */
  login(bizId: string, signal: AbortSignal): Promise<{ userAgent: string }>;
  /** Saqlangan profil bilan fonda ochadi; akkauntga kirilmagan bo'lsa — false */
  attach(bizId: string, userAgent: string | undefined): Promise<boolean>;
  /** wipe — Instagram'dan chiqadi va profilni o'chiradi */
  detach(bizId: string, wipe: boolean): Promise<void>;
  /** instagram.com ichidan so'rov (brauzer cookie'lari bilan) */
  request(bizId: string, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<Reply>;
  /** Suhbatni ochadi, matnni yozadi va yuboradi */
  type(bizId: string, threadIds: string[], text: string): Promise<void>;
}

// ─── Playwright (haqiqiy brauzer) ─────────────────────────────────────────────

function findBrowser(): string | null {
  if (env.igBrowser) return existsSync(env.igBrowser) ? env.igBrowser : null;
  return installedBrowser();
}

const NOT_NOW = /^(not now|hozir emas|keyinroq|не сейчас)$/i;
const ACCEPT = /^(accept|qabul qilish|принять)$/i;
const onLoginPage = (url: string) => /\/accounts\/login|\/challenge\//.test(url);

function playwright(executablePath: string): Driver {
  const live = new Map<string, { ctx: BrowserContext; page: Page; at: number }>();
  // Bitta sahifada ish navbat bilan (yozayotganda so'rov sahifani buzmasin)
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, next);
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  };
  const dir = (bizId: string) => join(env.dataDir, 'instagram', bizId);
  const launch = async (bizId: string, headless: boolean, userAgent?: string) => {
    const { chromium } = await import('playwright-core');
    mkdirSync(dir(bizId), { recursive: true });
    return chromium.launchPersistentContext(dir(bizId), {
      executablePath, headless, viewport: headless ? { width: 1280, height: 860 } : null,
      // Oddiy brauzerdan farqi bilinmasin: "avtomatlashtirilgan" belgisi va "HeadlessChrome" yo'q
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
        ...(headless ? (userAgent ? [`--user-agent=${userAgent}`] : []) : ['--window-size=1100,900'])],
    });
  };
  const loggedIn = async (ctx: BrowserContext) => (await ctx.cookies(IG).catch(() => [])).some(c => c.name === 'sessionid' && !!c.value);
  const close = async (bizId: string) => {
    const s = live.get(bizId);
    live.delete(bizId);
    await s?.ctx.close().catch(() => {});
  };
  const session = (bizId: string) => {
    const s = live.get(bizId);
    if (!s || s.page.isClosed()) throw new Detached();
    return s;
  };
  const openInbox = async (s: { page: Page; at: number }) => {
    await s.page.goto(`${IG}/direct/inbox/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    s.at = Date.now();
  };

  return {
    async login(bizId, signal) {
      await serial(bizId, () => close(bizId));
      const ctx = await launch(bizId, false);
      let closed = false;
      ctx.on('close', () => { closed = true; });
      try {
        const page = ctx.pages()[0] ?? await ctx.newPage();
        await page.goto(`${IG}/accounts/login/`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await page.bringToFront().catch(() => {});
        const userAgent = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
        const end = Date.now() + 15 * 60_000;
        for (;;) {
          if (signal.aborted) throw new Error('Bekor qilindi');
          if (closed) throw new Error("Oyna yopildi — Instagram'ga kirilmadi");
          if (Date.now() > end) throw new Error('15 daqiqa kutildi — qaytadan urining');
          if (await loggedIn(ctx) && !onLoginPage(page.url())) break;
          await sleep(1500);
        }
        // «Kirish ma'lumotlarini saqlaysizmi?» kabi sahifalar — cookie yozilib bo'lsin
        await sleep(3000);
        return { userAgent };
      } finally {
        await ctx.close().catch(() => {});
      }
    },

    attach: (bizId, userAgent) => serial(bizId, async () => {
      await close(bizId);
      const ctx = await launch(bizId, !env.igShowBrowser, userAgent);
      const s = { ctx, page: ctx.pages()[0] ?? await ctx.newPage(), at: 0 };
      await openInbox(s).catch(() => {});
      if (!(await loggedIn(ctx)) || onLoginPage(s.page.url())) {
        await ctx.close().catch(() => {});
        return false;
      }
      live.set(bizId, s);
      ctx.on('close', () => { if (live.get(bizId)?.ctx === ctx) live.delete(bizId); });
      return true;
    }),

    detach: (bizId, wipe) => serial(bizId, async () => {
      if (wipe) {
        await live.get(bizId)?.page.evaluate(async appId => {
          const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? '';
          await fetch('/api/v1/web/accounts/logout/ajax/', {
            method: 'POST', credentials: 'include', body: 'one_tap_app_login=0',
            headers: { 'x-ig-app-id': appId, 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/x-www-form-urlencoded' },
          });
        }, WEB_APP_ID).catch(() => {});
      }
      await close(bizId);
      // Windows'da brauzer fayllarni qo'yib yuborguncha biroz vaqt ketadi
      if (wipe) for (let i = 0; i < 6; i++) { try { rmSync(dir(bizId), { recursive: true, force: true }); break; } catch { await sleep(500); } }
    }),

    request: (bizId, method, path, form) => serial(bizId, async () => {
      const s = session(bizId);
      // Sahifa uzoq ochiq tursa xotira o'sadi — yarim soatda bir yangilanadi
      if (!s.page.url().startsWith(IG) || Date.now() - s.at > 30 * 60_000) await openInbox(s);
      if (onLoginPage(s.page.url())) return { status: 401, url: s.page.url(), body: '' };
      return s.page.evaluate(async ({ method, path, form, appId }) => {
        const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? '';
        const r = await fetch(path, {
          method, credentials: 'include',
          headers: {
            'x-ig-app-id': appId, 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest',
            'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') ?? '0',
            ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: form ? new URLSearchParams(form).toString() : undefined,
        });
        return { status: r.status, url: r.url, body: await r.text() };
      }, { method, path, form, appId: WEB_APP_ID });
    }),

    type: (bizId, threadIds, text) => serial(bizId, async () => {
      const s = session(bizId);
      const { page } = s;
      const box = page.locator('div[role="textbox"][contenteditable="true"]').first();
      let ready = false;
      for (const id of threadIds) {
        await page.goto(`${IG}/direct/t/${id}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        s.at = Date.now();
        if (onLoginPage(page.url())) throw new IgStop("Instagram qayta kirishni so'rayapti", 'login');
        for (let i = 0; i < 20 && !ready; i++) {
          // «Bildirishnomalarni yoqing» kabi oynalar
          const notNow = page.getByRole('button', { name: NOT_NOW }).first();
          if (await notNow.isVisible().catch(() => false)) await notNow.click().catch(() => {});
          // «So'rovlar»dagi suhbat: avval qabul qilinadi
          const accept = page.getByRole('button', { name: ACCEPT }).first();
          if (await accept.isVisible().catch(() => false)) { await pause(500, 1200); await accept.click().catch(() => {}); }
          ready = await box.isVisible().catch(() => false);
          if (!ready) await sleep(1000);
        }
        if (ready) break;
      }
      if (!ready) throw new Error("Instagram'da suhbat oynasi ochilmadi");
      await pause(700, 1800);
      await box.click();
      // Enter — yuborish, Shift+Enter — yangi qator
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i) await page.keyboard.press('Shift+Enter');
        if (lines[i]) await page.keyboard.insertText(lines[i]);
        await pause(120, 400);
      }
      await pause(500, 1400);
      await page.keyboard.press('Enter');
      // Yuborilgach yozish maydoni bo'shaydi
      const sent = await page.waitForFunction(el => !(el as HTMLElement).innerText.trim(), await box.elementHandle(), { timeout: 15_000 })
        .then(() => true, () => false);
      if (!sent) {
        await box.press('ControlOrMeta+A').catch(() => {});
        await box.press('Backspace').catch(() => {});
        throw new Error('Instagram xabarni yubormadi');
      }
      await pause(800, 1600);
    }),
  };
}

// ─── Soxta haydovchi (faqat sinov: IG_FAKE_URL) ───────────────────────────────

function fake(base: string): Driver {
  const live = new Set<string>();
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json() as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  return {
    async login(bizId, signal) {
      // Soxta xizmat «egasi oynada kirdi» deguncha kutadi
      for (;;) {
        if (signal.aborted) throw new Error('Bekor qilindi');
        if ((await post<{ done: boolean }>('/login', { bizId })).done) return { userAgent: 'FakeChrome/1.0' };
        await sleep(100);
      }
    },
    async attach(bizId) {
      const { ok } = await post<{ ok: boolean }>('/attach', { bizId });
      if (ok) live.add(bizId);
      return ok;
    },
    async detach(bizId, wipe) {
      live.delete(bizId);
      await post('/detach', { bizId, wipe }).catch(() => {});
    },
    async request(bizId, method, path, form) {
      if (!live.has(bizId)) throw new Detached();
      return post<Reply>('/request', { bizId, method, path, form });
    },
    async type(bizId, threadIds, text) {
      if (!live.has(bizId)) throw new Detached();
      await post('/type', { bizId, threadIds, text });
    },
  };
}

const driver: Driver | null = env.igFakeUrl ? fake(env.igFakeUrl) : (() => { const exe = findBrowser(); return exe ? playwright(exe) : null; })();
export const instagramAvailable = () => !!driver;
const need = () => {
  if (!driver) throw new Error('Bu kompyuterda Google Chrome yoki Microsoft Edge topilmadi');
  return driver;
};

// ─── Instagram so'rovlari ─────────────────────────────────────────────────────

interface IgUser { pk?: string | number; pk_id?: string; username?: string; full_name?: string; friendship_status?: { following?: boolean } }
interface IgItem {
  item_id: string; user_id: string | number; timestamp: string | number; item_type?: string; text?: string;
  link?: { text?: string }; reel_share?: { text?: string };
}
interface IgThread { thread_id: string; thread_v2_id?: string; users?: IgUser[]; items?: IgItem[]; is_group?: boolean; last_activity_at?: string | number }
interface IgInbox { viewer?: IgUser; inbox?: { threads?: IgThread[] } }

async function call<T>(bizId: string, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
  const r = await need().request(bizId, method, path, form);
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(r.body); } catch { /* HTML — kirish sahifasi yoki xato */ }
  const msg = String(j?.message ?? '');
  if (/\/challenge\//.test(r.url) || /checkpoint|challenge/.test(msg) || j?.checkpoint_url) {
    throw new IgStop("Instagram akkauntni tekshirmoqchi — telefoningizda Instagram'ni ochib tasdiqlang", 'login');
  }
  if (onLoginPage(r.url) || msg === 'login_required' || r.status === 401) throw new IgStop("Instagram qayta kirishni so'rayapti", 'login');
  if (msg === 'feedback_required' || j?.spam === true || r.status === 429) throw new IgStop("Instagram vaqtincha cheklov qo'ydi", 'limit');
  if (!j || r.status >= 400 || j.status === 'fail') throw new Error(`Instagram: ${msg || `javob ${r.status}`}`);
  return j as T;
}

/** Instagram vaqtlari mikrosoniyada — millisoniyaga */
const toMs = (t: string | number | undefined) => {
  const n = Number(t ?? 0);
  return n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
};

function itemText(it: IgItem): string | null {
  switch (it.item_type) {
    case 'text': return it.text?.trim() || null;
    case 'link': return (it.link?.text ?? it.text)?.trim() || null;
    case 'like': return '❤️';
    case 'action_log': case 'placeholder': return null;
    case 'voice_media': return '[ovozli xabar]';
    case 'media': case 'raw_media': case 'visual_media': case 'animated_media': return '[rasm yoki video]';
    case 'reel_share': return it.reel_share?.text?.trim() ? `${it.reel_share.text.trim()} (storisingizga javob)` : '[storisingizga javob]';
    default: return it.text?.trim() || '[post yoki havola ulashdi]';
  }
}

/** Suhbat manzili: yangi (v2) va eski id — ikkalasi ham saqlanadi, sahifa qaysi biri bilan ochilsa */
const threadKey = (t: IgThread) => `${t.thread_v2_id ?? ''}|${t.thread_id}`;
const threadIds = (key: string) => { const [v2, v1] = key.split('|'); return { v1, list: [v2, v1].filter(Boolean) }; };

// ─── Holat ────────────────────────────────────────────────────────────────────

const logins = new Map<string, { abort: AbortController; error: string | null; running: boolean }>();
/** «So'rovlar»dagi suhbatlar — javobdan oldin qabul qilinadi */
const requests = new Map<string, Set<string>>();
const nextPoll = new Map<string, number>();
const attaching = new Set<string>();
const retryAt = new Map<string, number>();

/** Cerebro yuborgan xabar Direct'da qaytib ko'rinadi — egasiniki deb o'ylamaslik uchun */
const ours = new Map<string, number>();
const oursKey = (bizId: string, thread: string, text: string) => `${bizId}|${thread}|${text.replace(/\s+/g, ' ').trim()}`;
function isOurs(bizId: string, thread: string, text: string): boolean {
  const k = oursKey(bizId, thread, text);
  const t = ours.get(k);
  if (!t) return false;
  ours.delete(k);
  return Date.now() - t < 30 * 60_000;
}

function problemOf(c: ConnectionRow): { text: string; relogin: boolean } | null {
  if (c.meta.problem) return { text: c.meta.problem, relogin: true };
  const until = Number(c.meta.pausedUntil ?? 0);
  if (until > Date.now()) return { text: `Instagram cheklov qo'ygan — Cerebro ${stamp(new Date(until)).replace('T', ' ')} gacha Instagram'da hech narsa qilmaydi`, relogin: false };
  return null;
}

export function instagramStatus(bizId: string): { account: string | null; waiting: boolean; problem: string | null; relogin: boolean } {
  const c = connections.get(bizId, 'instagram');
  const l = logins.get(bizId);
  if (l?.running) return { account: c ? `@${c.account.username}` : null, waiting: true, problem: null, relogin: false };
  const p = c ? problemOf(c) : null;
  return { account: c ? `@${c.account.username}` : null, waiting: false, problem: l?.error ?? p?.text ?? null, relogin: !!l?.error || !!p?.relogin };
}

/** Instagram to'xtatdi yoki brauzer yopildi */
async function trouble(bizId: string, e: unknown): Promise<void> {
  const biz = businesses.byId(bizId);
  if (e instanceof IgStop) {
    if (e.kind === 'login') {
      connections.patchMeta(bizId, 'instagram', { problem: e.message });
      await need().detach(bizId, false).catch(() => {});
      if (biz) await notifyOwner(biz, `⚠️ ${e.message}. Cerebro Instagram'da javob berishni to'xtatdi.\nQayta ulash: panel → Ulanishlar → «Instagram'ga kirish».`).catch(() => {});
    } else {
      connections.patchMeta(bizId, 'instagram', { pausedUntil: String(Date.now() + PAUSE_MS) });
      if (biz) await notifyOwner(biz, `⚠️ ${e.message}. Akkauntingiz xavfsizligi uchun Cerebro 12 soat Instagram'da hech narsa qilmaydi — mijozlarga o'zingiz javob bering.`).catch(() => {});
    }
    return;
  }
  if (e instanceof Detached) {
    if (attaching.has(bizId) || (retryAt.get(bizId) ?? 0) > Date.now()) return;
    retryAt.set(bizId, Date.now() + 5 * 60_000);
    await reattach(bizId);
    return;
  }
  console.warn('[instagram]', (e as Error).message);
}

async function reattach(bizId: string): Promise<void> {
  const c = connections.get(bizId, 'instagram');
  if (!c || attaching.has(bizId)) return;
  attaching.add(bizId);
  try {
    if (!(await need().attach(bizId, c.meta.ua))) await trouble(bizId, new IgStop("Instagram qayta kirishni so'rayapti", 'login'));
  } catch (e) {
    console.error('[instagram] brauzer ochilmadi:', (e as Error).message);
  } finally {
    attaching.delete(bizId);
  }
}

// ─── Kiruvchi xabarlar ────────────────────────────────────────────────────────

/** Har ~IG_POLL_MS da (tasodifiy ±30%) har bir ulangan akkauntning Direct'i tekshiriladi */
export async function pollInstagram(): Promise<void> {
  if (!driver) return;
  for (const c of connections.all('instagram')) {
    const bizId = c.businessId;
    if (problemOf(c) || attaching.has(bizId) || logins.get(bizId)?.running || (nextPoll.get(bizId) ?? 0) > Date.now()) continue;
    nextPoll.set(bizId, Date.now() + env.igPollMs * (0.7 + Math.random() * 0.6));
    try {
      await pollOne(c);
    } catch (e) {
      await trouble(bizId, e);
    }
  }
}

async function pollOne(c: ConnectionRow): Promise<void> {
  const bizId = c.businessId;
  const since = Number(c.meta.cursor ?? Date.now());
  const main = await call<IgInbox>(bizId, 'GET', INBOX());
  const viewer = String(main.viewer?.pk ?? c.account.id);
  // «Umumiy» papka faqat biznes akkauntlarda bor — bo'lmasa bo'sh
  const general = await call<IgInbox>(bizId, 'GET', INBOX(1)).catch(e => { if (e instanceof IgStop) throw e; return {} as IgInbox; });
  const pending = await call<IgInbox>(bizId, 'GET', PENDING);
  const reqs = requests.get(bizId) ?? requests.set(bizId, new Set()).get(bizId)!;
  let newest = since;
  const seen = new Set<string>();
  for (const [box, isRequest] of [[main, false], [general, false], [pending, true]] as const) {
    for (const t of box.inbox?.threads ?? []) {
      if (seen.has(t.thread_id)) continue;
      seen.add(t.thread_id);
      if (isRequest) reqs.add(t.thread_id);
      const user = t.users?.[0];
      if (t.is_group || t.users?.length !== 1 || !user || toMs(t.last_activity_at) <= since) continue;
      const fresh = (t.items ?? []).filter(i => toMs(i.timestamp) > since).sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
      for (const it of fresh) {
        newest = Math.max(newest, toMs(it.timestamp));
        const text = itemText(it);
        if (text) onItem(bizId, t, user, it, text, viewer, isRequest);
      }
    }
  }
  if (newest > since) connections.patchMeta(bizId, 'instagram', { cursor: String(newest) });
}

function onItem(bizId: string, t: IgThread, user: IgUser, it: IgItem, text: string, viewer: string, isRequest: boolean): void {
  const biz = businesses.byId(bizId);
  const userId = String(user.pk ?? user.pk_id ?? '');
  if (!biz?.active || !userId) return;
  if (String(it.user_id) === viewer) {
    if (!isOurs(bizId, t.thread_id, text)) onOwnerOutgoing(biz, 'instagram', { igUserId: userId }, text, it.item_id);
    return;
  }
  const settings = replySettings(biz);
  if (settings.mode === 'off') return;
  // Egasi kuzatadigan odamlar (tanishlar) — sozlamada ruxsat bo'lsa yoki allaqachon mijoz bo'lsa
  if (user.friendship_status?.following && !settings.contacts && !leads.byInstagram(biz.id, userId)) return;
  onIncoming(biz, {
    channel: 'instagram',
    person: { igUserId: userId, igThread: threadKey(t), name: user.full_name?.trim() || null, username: user.username || null },
    text, extId: it.item_id, source: isRequest ? "Instagram (so'rov)" : 'Instagram',
  });
}

// ─── Yuborish ─────────────────────────────────────────────────────────────────

/** Uzun matn bo'laklarga (Instagram bitta xabarga ~1000 belgi oladi) */
function parts(text: string, max = 950): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/(\s+)/)) {
    if ((cur + word).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function sendDirect(biz: BusinessRow, lead: LeadRow, text: string): Promise<null> {
  const d = need();
  const c = connections.get(biz.id, 'instagram');
  if (!c || !lead.igThread) throw new Error('Instagram ulanmagan');
  const problem = problemOf(c);
  if (problem) throw new Error(problem.text);
  const today = iso(new Date());
  const sentToday = () => { const m = connections.get(biz.id, 'instagram')?.meta; return m?.day === today ? Number(m.sent ?? 0) : 0; };
  const chunks = parts(text);
  if (sentToday() + chunks.length > env.igDailyLimit) {
    throw new Error(`Bugun Instagram'da ${sentToday()} ta xabar yuborildi — akkaunt xavfsizligi uchun ertagacha shu yetarli. O'zingiz javob bering`);
  }
  const { v1, list } = threadIds(lead.igThread);
  try {
    if (requests.get(biz.id)?.has(v1)) {
      // «So'rovlar»dagi suhbat: avval qabul qilinadi (o'xshamasa — oynada «Qabul qilish» bosiladi)
      await call(biz.id, 'POST', `/api/v1/direct_v2/threads/${v1}/approve/`, {}).catch(e => { if (e instanceof IgStop) throw e; });
      requests.get(biz.id)?.delete(v1);
    }
    for (const p of chunks) {
      ours.set(oursKey(biz.id, v1, p), Date.now());
      await d.type(biz.id, list, p);
      connections.patchMeta(biz.id, 'instagram', { day: today, sent: String(sentToday() + 1) });
    }
  } catch (e) {
    if (e instanceof IgStop || e instanceof Detached) void trouble(biz.id, e);
    throw e;
  }
  return null;
}

// ─── Ulash ────────────────────────────────────────────────────────────────────

/** Ko'rinadigan oyna ochiladi — egasi Instagram'ga o'zi kiradi. Natija panelga holat orqali */
export function startInstagramLogin(biz: BusinessRow): void {
  const d = need();
  if (logins.get(biz.id)?.running) return;
  const state = { abort: new AbortController(), error: null as string | null, running: true };
  logins.set(biz.id, state);
  void (async () => {
    try {
      const { userAgent } = await d.login(biz.id, state.abort.signal);
      await connect(biz.id, userAgent);
    } catch (e) {
      state.error = state.abort.signal.aborted ? null : (e as Error).message;
      // Oldin ishlab turgan bo'lsa — o'sha holatiga qaytadi
      const c = connections.get(biz.id, 'instagram');
      if (c && !problemOf(c)) await d.attach(biz.id, c.meta.ua).catch(() => {});
    } finally {
      state.running = false;
    }
  })();
}

export const cancelInstagramLogin = (biz: BusinessRow) => { logins.get(biz.id)?.abort.abort(); };

async function connect(bizId: string, userAgent: string): Promise<void> {
  const d = need();
  if (!(await d.attach(bizId, userAgent))) throw new Error("Instagram'ga kirilmadi — qaytadan urining");
  let box: IgInbox;
  try {
    box = await call<IgInbox>(bizId, 'GET', INBOX());
    if (!box.viewer?.username) throw new Error("Instagram Direct ochilmadi — qaytadan urining");
  } catch (e) {
    await d.detach(bizId, false);
    throw e;
  }
  const v = box.viewer;
  const id = String(v.pk ?? v.pk_id ?? '');
  const prev = connections.get(bizId, 'instagram');
  const same = prev?.account.id === id;
  // O'sha akkaunt qayta ulansa — uzilgan paytdan beri yozganlar ham (ko'pi bilan bir kun); yangi akkaunt — faqat bundan keyingilar
  const cursor = same ? Math.max(Number(prev.meta.cursor ?? 0), Date.now() - 86_400_000) : Date.now();
  connections.save(bizId, 'instagram', '', { id, username: v.username ?? '', name: v.full_name ?? '' }, {
    cursor: String(cursor), ua: userAgent, ...(same && prev.meta.day ? { day: prev.meta.day, sent: prev.meta.sent ?? '0' } : {}),
  });
  nextPoll.delete(bizId);
}

export async function disconnectInstagram(biz: BusinessRow): Promise<void> {
  logins.get(biz.id)?.abort.abort();
  logins.delete(biz.id);
  connections.remove(biz.id, 'instagram');
  requests.delete(biz.id);
  await driver?.detach(biz.id, true);
}

export function startInstagram(): void {
  if (!driver) return;
  registerSender('instagram', {
    can: (biz, lead) => !!lead.igThread && !!connections.get(biz.id, 'instagram'),
    send: sendDirect,
  });
  for (const c of connections.all('instagram')) {
    if (!c.meta.problem) void reattach(c.businessId);
  }
}

export async function stopInstagram(): Promise<void> {
  if (!driver) return;
  for (const c of connections.all('instagram')) await driver.detach(c.businessId, false).catch(() => {});
}
