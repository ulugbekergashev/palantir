/**
 * Meta AI — egasining o'z meta.ai akkaunti orqali, Meta ilovasisiz va API kalitsiz (Marketolog xodimi ishlatadi).
 *
 * Palantir shu kompyuterdagi Chrome (yoki Edge)ni alohida profil bilan ochadi:
 *   ulash  — ko'rinadigan oynada egasi meta.ai'ga o'zi kiradi (Facebook yoki Instagram akkaunti bilan; parol Palantir'ga
 *            berilmaydi). Kirgach oyna yopiladi;
 *   so'rash — kerak bo'lganda brauzer ko'rinmas holda ochiladi: yangi suhbat, savol yoziladi, javob tugaguncha kutiladi
 *            va matni olinadi («Nusxa olish» tugmasi bergan matn — egasining clipboard'iga tegilmaydi; bo'lmasa — sahifadan).
 *            Bir muddat ish bo'lmasa brauzer yopiladi.
 *
 * Bu Meta'ning rasmiy yo'li emas: sayt o'zgarsa tuzatish kerak bo'ladi, juda faol ishlatilsa akkaunt cheklanishi mumkin.
 * Shuning uchun: bir vaqtda bitta savol, kunlik chegara, odamdek kechikishlar. «Qayta kiring» faqat meta.ai «Войти»ni aniq
 * ko'rsatganda — sekin internet yoki sayt nosozligi oddiy xato bo'lib qoladi (keyingi savol yana urinadi).
 *
 * Ikki haydovchi: Playwright (haqiqiy brauzer) va sinov uchun soxta (META_AI_FAKE_URL).
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { iso } from '../../src/lib/week';
import { installedBrowser } from '../browserPath';
import { businesses, connections, type BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';

const KIND = 'meta_ai';
/** Javob shuncha vaqtda tugamasa — to'xtatiladi (chuqur qidiruv uzoq ketadi) */
const ANSWER_MS = 4 * 60_000;
/** Matn shuncha vaqt o'zgarmasa — javob tugagan */
const SETTLE_MS = 5_000;
/** Ish bo'lmasa ko'rinmas brauzer shuncha vaqtdan keyin yopiladi (xotira) */
const IDLE_MS = 10 * 60_000;
/** Sahifa ochilib, kirilgan-kirilmagani ma'lum bo'lguncha */
const PAGE_MS = 30_000;
/** Javob deb hisoblanadigan eng qisqa matn (undan qisqasi — hali «o'ylayapti») */
const MIN_ANSWER = 20;
const MAX_PROMPT = 4000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pause = (min: number, max: number) => sleep(min + Math.random() * (max - min));
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** meta.ai «Войти»ni ko'rsatdi — egasi qayta kirishi kerak */
export class MetaAiLogin extends Error {
  constructor() { super("Meta AI qayta kirishni so'rayapti"); }
}
/** Ulanmagan, chegara yoki oddiy (o'tkinchi) xato — egasiga sababi bilan */
export class MetaAiError extends Error {}
/** Ko'rinmas brauzer yopilgan (bo'sh turib yoki xatodan keyin) — qayta ochiladi */
class Closed extends Error {}

interface Driver {
  /** Ko'rinadigan oynada egasi o'zi kiradi; kirgach oyna yopiladi. Qaytaradi — brauzerning odatiy User-Agent'i */
  login(bizId: string, signal: AbortSignal): Promise<{ userAgent: string }>;
  /** Saqlangan profil bilan fonda ochadi. Kirilmagan — MetaAiLogin; sahifa ochilmadi — MetaAiError */
  attach(bizId: string, userAgent: string | undefined): Promise<void>;
  /** Ko'rinmas brauzer ochiqmi */
  alive(bizId: string): boolean;
  /** wipe — profil o'chiriladi (egasi uzdi); o'chmasa — MetaAiError */
  detach(bizId: string, wipe: boolean): Promise<void>;
  /** Yangi suhbatda savol beradi va javob matnini qaytaradi. Brauzer yopiq — Closed */
  ask(bizId: string, prompt: string): Promise<string>;
  /** Yangi suhbatda rasm chizdiradi va birinchi rasmni qaytaradi (bayt). Brauzer yopiq — Closed */
  image(bizId: string, prompt: string): Promise<Buffer>;
  /** Server to'xtayapti: hamma oyna (kirish oynasi ham) yopiladi */
  closeAll(): Promise<void>;
}

// ─── Playwright (haqiqiy brauzer) ─────────────────────────────────────────────

/** Sahifadagi narsalar: meta.ai interfeysi tili egasiniki (ruscha, inglizcha, o'zbekcha) */
const COMPOSER = 'textarea[aria-label*="Meta AI" i], textarea[placeholder*="Meta AI" i], input[aria-label*="Meta AI" i], input[placeholder*="Meta AI" i], [contenteditable="true"][aria-label*="Meta AI" i], [contenteditable="true"][role="textbox"]';
const LOGIN_BUTTON = '[data-testid="login-button"]';
/** Xabar darajasidagi «Nusxa olish» (kod yoki jadvalning «Копировать код» tugmasi emas) */
const COPY = /^(copy|копировать|скопировать|nusxa olish|nusxalash)$/i;
const STOP = /^(stop|остановить|прекратить|to'xtatish)/i;
/** «Nusxa olish» bosilganda matn egasining clipboard'iga emas — sahifaning o'zida qoladi (window.__palantirCopied) */
const CLIPBOARD_TRAP = `(() => {
  if (!/(^|\\.)meta\\.ai$/.test(location.hostname)) return;
  const keep = t => { window.__palantirCopied = String(t); return Promise.resolve(); };
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: keep,
      write: async items => { for (const item of items) if (item.types.includes('text/plain')) await keep(await (await item.getType('text/plain')).text()); },
      readText: () => Promise.resolve(window.__palantirCopied || ''),
    } });
  } catch (e) { /* bo'lmasa — matn sahifadan olinadi */ }
})();`;
const isMetaAi = (url: string) => { try { return /(^|\.)meta\.ai$/.test(new URL(url).hostname); } catch { return false; } };

type Seen = 'in' | 'out' | 'unknown';

function playwright(executablePath: string): Driver {
  const live = new Map<string, { ctx: BrowserContext; page: Page; usedAt: number; busy: boolean; idle: NodeJS.Timeout | null }>();
  /** Kirish oynalari — server to'xtaganda ular ham yopiladi */
  const windows = new Set<BrowserContext>();
  // Bitta akkauntda ish navbat bilan (ikki savol bir sahifani buzmasin)
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, next);
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  };
  const dir = (bizId: string) => join(env.dataDir, 'meta-ai', bizId);
  const launch = async (bizId: string, headless: boolean, userAgent?: string) => {
    const { chromium } = await import('playwright-core');
    mkdirSync(dir(bizId), { recursive: true });
    return chromium.launchPersistentContext(dir(bizId), {
      executablePath, headless, viewport: headless ? { width: 1280, height: 860 } : null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
        ...(headless ? (userAgent ? [`--user-agent=${userAgent}`] : []) : ['--window-size=1100,900'])],
    });
  };
  const close = async (bizId: string) => {
    const s = live.get(bizId);
    live.delete(bizId);
    if (s?.idle) clearTimeout(s.idle);
    await s?.ctx.close().catch(() => {});
  };
  /** Sahifa holati: «Войти» ko'rinsa yoki Facebook/Instagram kirish sahifasi — kirilmagan; savol maydoni bor — kirilgan */
  const seen = async (page: Page): Promise<Seen> => {
    if (!isMetaAi(page.url())) return /facebook\.com|instagram\.com|meta\.com/.test(page.url()) ? 'out' : 'unknown';
    if (await page.locator(LOGIN_BUTTON).first().isVisible().catch(() => false)) return 'out';
    return await page.locator(COMPOSER).first().isVisible().catch(() => false) ? 'in' : 'unknown';
  };
  /** Bosh sahifa (yangi suhbat) va uning holati; «Войти» kech chiqishi mumkin — kirilgan deyishdan oldin biroz kutiladi */
  const home = async (page: Page): Promise<Seen> => {
    await page.goto(`${env.metaAiUrl}/`, { waitUntil: 'domcontentloaded', timeout: PAGE_MS }).catch(() => {});
    let state: Seen = 'unknown', inSince = 0;
    for (const end = Date.now() + PAGE_MS; Date.now() < end; await sleep(500)) {
      state = await seen(page);
      if (state === 'out') return 'out';
      if (state !== 'in') { inSince = 0; continue; }
      inSince ||= Date.now();
      if (Date.now() - inSince >= 1500) return 'in';
    }
    return state === 'in' ? 'in' : 'unknown';
  };
  /** Bo'sh turgan brauzer yopiladi — savol ketayotgan paytda emas */
  const touch = (bizId: string) => {
    const s = live.get(bizId);
    if (!s) return;
    s.usedAt = Date.now();
    if (s.idle) clearTimeout(s.idle);
    s.idle = setTimeout(() => { void serial(bizId, async () => { const cur = live.get(bizId); if (cur === s && !s.busy && Date.now() - s.usedAt >= IDLE_MS) await close(bizId); }); }, IDLE_MS);
    s.idle.unref();
  };

  /** Javob tugaguncha kutadi va matnini oladi. Har qadam vaqt bilan cheklangan — qotib qolgan sahifa navbatni ushlab turmaydi */
  async function answer(page: Page, prompt: string): Promise<string> {
    const copyButtons = page.getByRole('button', { name: COPY });
    const head = flat(prompt).slice(0, 60), whole = flat(prompt);
    const pageText = () => page.evaluate(() => (document.querySelector('main') ?? document.body).innerText);
    /** Savoldan keyingi matn (savol topilmasa — bo'sh: yon panel va boshqa suhbatlar javob bo'lib qolmasin) */
    const after = (text: string) => { const t = flat(text), at = t.lastIndexOf(head); return at >= 0 ? t.slice(at + Math.min(whole.length, t.length - at)).trim() : ''; };
    const end = Date.now() + ANSWER_MS;
    let last = '', stableSince = Date.now();
    for (;;) {
      if (Date.now() > end) throw new MetaAiError("Meta AI 4 daqiqada javob bermadi — keyinroq qayta urinib ko'ring");
      await sleep(1500);
      if (await page.locator(LOGIN_BUTTON).first().isVisible({ timeout: 5_000 }).catch(() => false)) throw new MetaAiLogin();
      const now = after(await pageText());
      if (now !== last) { last = now; stableSince = Date.now(); continue; }
      const generating = await page.getByRole('button', { name: STOP }).first().isVisible({ timeout: 5_000 }).catch(() => false);
      if (!generating && last.length >= MIN_ANSWER && Date.now() - stableSince >= SETTLE_MS) break;
    }
    const n = await copyButtons.count();
    if (n) {
      await page.evaluate(() => { (window as unknown as { __palantirCopied?: string }).__palantirCopied = ''; });
      await copyButtons.nth(n - 1).click({ timeout: 5_000 }).catch(() => {});
      await sleep(400);
      const copied = await page.evaluate(() => (window as unknown as { __palantirCopied?: string }).__palantirCopied ?? '').catch(() => '');
      // Nusxa — oxirgi javobniki bo'lsa (savolning o'zi emas)
      if (copied.trim().length >= MIN_ANSWER && flat(copied) !== whole) return copied.trim();
    }
    return last;
  }
  /** Javobda paydo bo'lgan katta rasm (oldin sahifada bo'lmagan) — chizib bo'lingach, birinchisi */
  async function picture(page: Page, prompt: string, before: Set<string>): Promise<Buffer> {
    // Faqat savoldan keyin (javob ichida) paydo bo'lgan rasmlar: bosh sahifaning kech yuklangan kartalari tanlanmasin
    const head = flat(prompt).slice(0, 40);
    const fresh = () => page.evaluate(h => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let anchor: Node | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').replace(/\s+/g, ' ').includes(h)) anchor = n;
      return [...document.images]
        .filter(i => i.complete && i.naturalWidth >= 400 && (!anchor || (anchor.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING)))
        .map(i => i.currentSrc || i.src);
    }, head).then(list => list.filter(s => s && !before.has(s)));
    const end = Date.now() + ANSWER_MS;
    let last = '', stableSince = Date.now();
    for (;;) {
      if (Date.now() > end) throw new MetaAiError("Meta AI 4 daqiqada rasm chizmadi — keyinroq qayta urinib ko'ring");
      await sleep(1500);
      if (await page.locator(LOGIN_BUTTON).first().isVisible({ timeout: 5_000 }).catch(() => false)) throw new MetaAiLogin();
      const now = (await fresh().catch(() => [] as string[])).join('|');
      if (now !== last) { last = now; stableSince = Date.now(); continue; }
      const generating = await page.getByRole('button', { name: STOP }).first().isVisible({ timeout: 5_000 }).catch(() => false);
      if (last && !generating && Date.now() - stableSince >= SETTLE_MS) break;
    }
    const src = last.split('|')[0];
    // Brauzer cookie'lari bilan, sahifa CORS'isiz (rasm boshqa domenda — Meta CDN)
    if (/^https?:/.test(src)) {
      const r = await page.context().request.get(src, { timeout: 30_000 });
      if (r.ok()) return Buffer.from(await r.body());
    }
    // data:/blob: yoki yuklab bo'lmadi — rasm elementining o'zi suratga olinadi (belgi qo'yib topiladi: src va currentSrc farq qilishi mumkin)
    await page.evaluate(s => { const img = [...document.images].find(i => (i.currentSrc || i.src) === s); img?.setAttribute('data-palantir-pick', '1'); }, src);
    return page.locator('img[data-palantir-pick="1"]').first().screenshot({ timeout: 10_000, type: 'png' });
  }
  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) => {
    let t: NodeJS.Timeout | undefined;
    return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new MetaAiError(what)), ms); })]).finally(() => clearTimeout(t));
  };
  /** Yangi suhbatda yozadi va natijani take bilan oladi (before — yozishdan oldin sahifadagi rasmlar) */
  const send = <T,>(bizId: string, prompt: string, take: (page: Page, before: Set<string>) => Promise<T>): Promise<T> => serial(bizId, async () => {
    const s = live.get(bizId);
    if (!s || s.page.isClosed()) throw new Closed();
    const { page } = s;
    s.busy = true;
    try {
      // Har savol — yangi suhbat: oldingi javoblar aralashmasin
      const state = await home(page);
      if (state === 'out') throw new MetaAiLogin();
      if (state !== 'in') throw new MetaAiError("meta.ai sahifasi ochilmadi — keyinroq qayta urinib ko'ring");
      const box = page.locator(COMPOSER).first();
      const single = await box.evaluate(el => el.tagName === 'INPUT', undefined, { timeout: 5_000 });
      await pause(600, 1500);
      await box.click({ timeout: 10_000 });
      await box.fill(single ? flat(prompt) : prompt, { timeout: 10_000 });
      await pause(400, 1000);
      // Yuborishdan oldingi lahzadagi rasmlar — javobdagilar shundan keyin paydo bo'ladi
      const before = new Set(await page.evaluate(() => [...document.images].map(i => i.currentSrc || i.src)));
      await page.keyboard.press('Enter');
      return await withTimeout(take(page, before), ANSWER_MS + 30_000, "Meta AI 4 daqiqada javob bermadi — keyinroq qayta urinib ko'ring");
    } catch (e) {
      // Chala qolgan yoki qotgan sahifa keyingi savolga o'tmasin — brauzer yopiladi, keyingi savol yangidan ochadi
      await close(bizId);
      throw e;
    } finally {
      s.busy = false;
      touch(bizId);
    }
  });

  return {
    async login(bizId, signal) {
      await serial(bizId, () => close(bizId));
      const ctx = await launch(bizId, false);
      windows.add(ctx);
      let closed = false;
      ctx.on('close', () => { closed = true; });
      try {
        const page = ctx.pages()[0] ?? await ctx.newPage();
        await page.goto(`${env.metaAiUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await page.bringToFront().catch(() => {});
        const userAgent = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
        const end = Date.now() + 15 * 60_000;
        // «Войти» bir marta ko'ringan bo'lsa — kirish tugagani aniq; profil avvaldan kirgan bo'lsa — uzoqroq kuzatiladi («Войти» kech chiqmasin)
        let sawOut = false, streak = 0;
        for (;;) {
          if (signal.aborted) throw new Error('Bekor qilindi');
          if (closed) throw new Error("Oyna yopildi — Meta AI'ga kirilmadi");
          if (Date.now() > end) throw new Error('15 daqiqa kutildi — qaytadan urining');
          const s = await seen(page);
          if (s === 'out') sawOut = true;
          streak = s === 'in' ? streak + 1 : 0;
          if (streak >= (sawOut ? 3 : 10)) break;
          await sleep(1500);
        }
        await sleep(2000);
        if (signal.aborted) throw new Error('Bekor qilindi');
        return { userAgent };
      } finally {
        windows.delete(ctx);
        await ctx.close().catch(() => {});
      }
    },

    attach: (bizId, userAgent) => serial(bizId, async () => {
      await close(bizId);
      const ctx = await launch(bizId, !env.metaAiShowBrowser, userAgent);
      try {
        // Matn ko'rinishida: tsx funksiyalarga qo'shadigan yordamchi (__name) sahifada yo'q
        await ctx.addInitScript(CLIPBOARD_TRAP);
        const page = ctx.pages()[0] ?? await ctx.newPage();
        const state = await home(page);
        if (state === 'out') throw new MetaAiLogin();
        if (state !== 'in') throw new MetaAiError("meta.ai ochilmadi (internet sekin yoki sayt javob bermayapti) — keyinroq qayta urinib ko'ring");
        live.set(bizId, { ctx, page, usedAt: Date.now(), busy: false, idle: null });
        ctx.on('close', () => { if (live.get(bizId)?.ctx === ctx) live.delete(bizId); });
        touch(bizId);
      } catch (e) {
        await ctx.close().catch(() => {});
        throw e;
      }
    }),

    alive: bizId => { const s = live.get(bizId); return !!s && !s.page.isClosed(); },

    detach: (bizId, wipe) => serial(bizId, async () => {
      await close(bizId);
      if (!wipe) return;
      for (let i = 0; ; i++) {
        try { rmSync(dir(bizId), { recursive: true, force: true }); return; } catch (e) {
          // Windows'da brauzer fayllarni qo'yib yuborguncha biroz vaqt ketadi
          if (i >= 6) throw new MetaAiError(`Brauzer profili o'chirilmadi (${(e as Error).message.split('\n')[0]}) — bir daqiqadan keyin «Uzish»ni yana bosing`);
          await sleep(500);
        }
      }
    }),

    ask: (bizId, prompt) => send(bizId, prompt, page => answer(page, prompt)),
    image: (bizId, prompt) => send(bizId, prompt, (page, before) => picture(page, prompt, before)),

    async closeAll() {
      for (const ctx of windows) await ctx.close().catch(() => {});
      windows.clear();
      for (const bizId of [...live.keys()]) await close(bizId);
    },
  };
}

// ─── Soxta haydovchi (faqat sinov: META_AI_FAKE_URL) ──────────────────────────

function fake(base: string): Driver {
  const live = new Set<string>();
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json() as T & { error?: string };
    if (r.status === 401) throw new MetaAiLogin();
    if (!r.ok) throw new MetaAiError(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  return {
    async login(bizId, signal) {
      for (;;) {
        if (signal.aborted) throw new Error('Bekor qilindi');
        if ((await post<{ done: boolean }>('/login', { bizId })).done) return { userAgent: 'FakeChrome/1.0' };
        await sleep(100);
      }
    },
    async attach(bizId) {
      await post('/attach', { bizId });
      live.add(bizId);
    },
    alive: bizId => live.has(bizId),
    async detach(bizId, wipe) {
      live.delete(bizId);
      await post('/detach', { bizId, wipe });
    },
    async ask(bizId, prompt) {
      if (!live.has(bizId)) throw new Closed();
      try {
        return (await post<{ text: string }>('/ask', { bizId, prompt })).text;
      } catch (e) {
        live.delete(bizId);
        throw e;
      }
    },
    async image(bizId, prompt) {
      if (!live.has(bizId)) throw new Closed();
      try {
        return Buffer.from((await post<{ base64: string }>('/image', { bizId, prompt })).base64, 'base64');
      } catch (e) {
        live.delete(bizId);
        throw e;
      }
    },
    async closeAll() { live.clear(); },
  };
}

function findBrowser(): string | null {
  if (env.igBrowser) return existsSync(env.igBrowser) ? env.igBrowser : null;
  return installedBrowser();
}

const driver: Driver | null = env.metaAiFakeUrl ? fake(env.metaAiFakeUrl) : (() => { const exe = findBrowser(); return exe ? playwright(exe) : null; })();
export const metaAiAvailable = () => !!driver;
const need = () => {
  if (!driver) throw new MetaAiError('Bu kompyuterda Google Chrome yoki Microsoft Edge topilmadi');
  return driver;
};

// ─── Holat ────────────────────────────────────────────────────────────────────

const logins = new Map<string, { abort: AbortController; error: string | null; running: boolean }>();

export interface MetaAiStatus { available: boolean; connected: boolean; waiting: boolean; problem: string | null; relogin: boolean; usedToday: number; dailyLimit: number }

const usedToday = (meta: Record<string, string> | undefined) => (meta?.day === iso(new Date()) ? Number(meta.used ?? 0) : 0);

export function metaAiStatus(bizId: string): MetaAiStatus {
  const c = connections.get(bizId, KIND);
  const l = logins.get(bizId);
  const base = { available: !!driver, connected: !!c, usedToday: usedToday(c?.meta), dailyLimit: env.metaAiDailyLimit };
  if (l?.running) return { ...base, waiting: true, problem: null, relogin: false };
  const problem = c?.meta.problem ?? l?.error ?? null;
  return { ...base, waiting: false, problem, relogin: !!problem };
}

/** Savol berib bo'ladimi (ulangan, muammo yo'q, chegara bor) — bo'lmasa MetaAiError sababi bilan. Fonda ishga tushirishdan oldin */
export function assertMetaAiReady(biz: BusinessRow): void {
  need();
  const c = connections.get(biz.id, KIND);
  if (!c) throw new MetaAiError("Meta AI ulanmagan — panel → Marketolog → Ulash'da akkauntingizga kiring");
  if (c.meta.problem) throw new MetaAiError(`${c.meta.problem} — panel → Marketolog → Ulash`);
  if (logins.get(biz.id)?.running) throw new MetaAiError('Meta AI oynasida kirish tugamagan');
  const used = usedToday(c.meta);
  if (used >= env.metaAiDailyLimit) throw new MetaAiError(`Bugun Meta AI'ga ${used} ta savol berildi — akkaunt xavfsizligi uchun ertagacha shu yetarli`);
}

/** meta.ai qayta kirishni so'radi — egasiga aytiladi, savollar to'xtaydi */
async function needsLogin(bizId: string, e: MetaAiLogin): Promise<void> {
  connections.patchMeta(bizId, KIND, { problem: e.message });
  await need().detach(bizId, false).catch(() => {});
  const biz = businesses.byId(bizId);
  if (biz) await notifyOwner(biz, `⚠️ ${e.message}. Marketolog Meta AI'dan foydalanishni to'xtatdi.\nQayta ulash: panel → Marketolog → Ulash.`).catch(() => {});
}

/** Kunlik hisob: savol ketmagan bo'lsa (xato) — qaytariladi, nosoz sayt chegarani yeb qo'ymasin */
function count(bizId: string, delta: 1 | -1): void {
  const c = connections.get(bizId, KIND);
  if (!c) return;
  connections.patchMeta(bizId, KIND, { day: iso(new Date()), used: String(Math.max(0, usedToday(c.meta) + delta)) });
}

/**
 * Meta AI'ga savol (yangi suhbatda) — javob matni. Bir necha daqiqa ketishi mumkin: chaqiruvchi uni fonda ishlatadi.
 * Xato bo'lsa MetaAiError (sababi egasiga aytsa bo'ladigan tilda)
 */
export const askMetaAi = (biz: BusinessRow, prompt: string): Promise<string> => use(biz, prompt, (d, text) => d.ask(biz.id, text));

/** Meta AI rasm chizadi (post uchun) — rasm baytlari. Kunlik chegara savollar bilan umumiy */
export const imagineMetaAi = (biz: BusinessRow, description: string): Promise<Buffer> =>
  use(biz, `Создай одно изображение для поста в Instagram (без текста на картинке): ${description}`, (d, text) => d.image(biz.id, text));

async function use<T>(biz: BusinessRow, prompt: string, call: (d: Driver, text: string) => Promise<T>): Promise<T> {
  assertMetaAiReady(biz);
  const d = need();
  const ua = connections.get(biz.id, KIND)?.meta.ua;
  const text = prompt.trim().slice(0, MAX_PROMPT);
  if (!text) throw new MetaAiError("Savol bo'sh");
  // Hisob kutishdan oldin: bir vaqtda kelgan ikki savol chegarani birga oshirib yubormasin
  count(biz.id, 1);
  try {
    if (!d.alive(biz.id)) await open(biz.id, ua);
    try {
      return await call(d, text);
    } catch (e) {
      // Brauzer bo'sh turib yopilgan — bir marta qayta ochiladi
      if (!(e instanceof Closed)) throw e;
      await open(biz.id, ua);
      return await call(d, text);
    }
  } catch (e) {
    count(biz.id, -1);
    if (e instanceof MetaAiLogin) {
      await needsLogin(biz.id, e);
      throw new MetaAiError(`${e.message} — panel → Marketolog → Ulash'da qayta kiring`);
    }
    if (e instanceof MetaAiError) throw e;
    console.error('[meta-ai]', (e as Error).message);
    throw new MetaAiError(`Meta AI bilan ishlab bo'lmadi: ${(e as Error).message.split('\n')[0].slice(0, 200)}`);
  }
}

/** Ko'rinmas brauzerni ochadi (bir vaqtda ikki so'rov — bitta ochilish) */
const opening = new Map<string, Promise<void>>();
function open(bizId: string, userAgent: string | undefined): Promise<void> {
  const busy = opening.get(bizId);
  if (busy) return busy;
  const p = need().attach(bizId, userAgent).finally(() => opening.delete(bizId));
  opening.set(bizId, p);
  return p;
}

// ─── Ulash ────────────────────────────────────────────────────────────────────

/** Ko'rinadigan oyna ochiladi — egasi meta.ai'ga o'zi kiradi. Natija panelga holat orqali */
export function startMetaAiLogin(biz: BusinessRow): void {
  const d = need();
  if (logins.get(biz.id)?.running) return;
  const state = { abort: new AbortController(), error: null as string | null, running: true };
  logins.set(biz.id, state);
  void (async () => {
    try {
      const { userAgent } = await d.login(biz.id, state.abort.signal);
      // Shu orada egasi «Uzish»ni bosgan yoki yangi kirish boshlangan bo'lsa — saqlanmaydi
      if (state.abort.signal.aborted || logins.get(biz.id) !== state) return;
      const prev = connections.get(biz.id, KIND);
      // O'sha kunning hisobi saqlanadi: qayta kirish chegarani nolga tushirmasin
      connections.save(biz.id, KIND, '', { id: 'meta.ai' }, { ua: userAgent, ...(prev?.meta.day ? { day: prev.meta.day, used: prev.meta.used ?? '0' } : {}) });
      await notifyOwner(biz, '📣 Meta AI ulandi — Marketolog endi raqobatchilar, akkauntingiz va videolar tahlilini Meta AI orqali qiladi.').catch(() => {});
    } catch (e) {
      state.error = state.abort.signal.aborted ? null : (e as Error).message;
    } finally {
      state.running = false;
    }
  })();
}

export const cancelMetaAiLogin = (biz: BusinessRow) => { logins.get(biz.id)?.abort.abort(); };

/** Uzish: profil (kirish ma'lumotlari) o'chiriladi; o'chmasa — ulanish qoladi va xato egasiga */
export async function disconnectMetaAi(biz: BusinessRow): Promise<void> {
  logins.get(biz.id)?.abort.abort();
  logins.delete(biz.id);
  if (driver) await driver.detach(biz.id, true);
  connections.remove(biz.id, KIND);
}

export async function stopMetaAi(): Promise<void> {
  await driver?.closeAll().catch(() => {});
}
