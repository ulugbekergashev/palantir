/**
 * Brauzerda ishlash (Claude browser_toolset_20260801 a'zolari): alohida Chrome profili (egasining shaxsiy brauzeriga tegilmaydi),
 * har bir a'zo — Playwright orqali. Sahifa o'qilganda har elementga «ref_N» beriladi (sahifa almashguncha o'zgarmaydi).
 * Xavfsizlik: har bir so'rov (yo'naltirish ham) policy.ts dan o'tadi — shu kompyuter va ichki tarmoq yopiq; parol maydoniga AI yozmaydi;
 * yuborish/to'lash/o'chirish kabi tugma yoki formadagi Enter — avval egasidan so'raladi (approve).
 */
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { chromium, type Browser, type BrowserContext, type Dialog, type ElementHandle, type Page, type Request } from 'playwright-core';
import { installedBrowser } from '../browserPath';
import { PolicyError, allowedRequest, checkUrl, riskyClick, riskyKey, type ElementInfo, type SitePolicy } from './policy';
import { MONEY_ZONE, cardLike, moneyControl } from './money';
import { DownloadWatch, ownerDownloadsDir } from './ownDownloads';
import { describeDialog, dialogStep, fromDialog, type OpenDialog } from './browserDialog';

export type ResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam['content'], string | undefined>;
export interface MemberResult { content: ResultContent; isError?: boolean }
/** Egasidan so'rash (Telegram tugmalari): true — ruxsat, false — rad etdi, null — javob bo'lmadi (vaqt tugadi) */
export type Approver = (what: string) => Promise<boolean | null>;

export const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 30_000, ACTION_TIMEOUT_MS = 15_000, MAX_TREE = 50_000, MAX_TEXT = 50_000, MAX_WAIT_S = 30;
/** Orqaga/oldinga/yangilashdan keyin sahifa yuklanishi shuncha kutiladi */
const HISTORY_SETTLE_MS = 10_000;

/** Brauzer a'zolari: sichqonchani bosib turish va tugmani ushlab turish kerak emas (tasodifiy bosilib qolishi xavfli) */
export const BROWSER_TOOLSET: Anthropic.Beta.BetaBrowserToolset20260801 = {
  type: 'browser_toolset_20260801',
  configs: { left_mouse_down: { enabled: false }, left_mouse_up: { enabled: false }, hold_key: { enabled: false } },
};

const text = (t: string): MemberResult => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): MemberResult => ({ content: [{ type: 'text', text: t }], isError: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clampWait = (s: unknown) => Math.max(0, Math.min(MAX_WAIT_S, Number(s) || 0));
/** G'ildirak hodisasiga javob kutiladigan eng ko'p vaqt (keyin — JS bilan aylantiriladi) */
const WHEEL_MS = 3_000;
/** scroll_to: Playwright o'zi aylantirishini shuncha kutadi (keyin — JS bilan yoki «yashirin» deb aytiladi) */
const SCROLL_TO_MS = 3_000;
/** screenshot: kadr shuncha kutiladi */
const SHOT_MS = 8_000;
/** form_input: Playwright belgi qo'yishini shuncha kutadi (keyin — elementning o'z bosilishi) */
const CHECK_MS = 3_000;
/**
 * Bitta a'zoning eng uzoq vaqti (egasidan ruxsat kutilgan vaqt hisobga kirmaydi): sahifa javob bermay qolsa ish abadiy osilmaydi —
 * model xabar oladi va boshqa yo'l tanlaydi
 */
const MEMBER_MAX_MS = 150_000;

/**
 * Sahifada ishlaydi: (x, y) nuqtadagi eng yaqin aylanadigan ro'yxat (Google Maps natijalari kabi) yoki butun sahifa.
 * Qaytaradi — uning hozirgi holati; apply — shu ro'yxatni (dx, dy) ga aylantiradi
 */
function scrollAt(a: { x: number; y: number; dx: number; dy: number; apply: boolean }): string {
  // Ichida nomli funksiya yo'q: yig'uvchi (esbuild keepNames) unga __name qo'shadi — sahifada u yo'q
  let el = document.elementFromPoint(a.x, a.y);
  for (; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if ((a.dy !== 0 && /auto|scroll|overlay/.test(s.overflowY) && el.scrollHeight > el.clientHeight)
      || (a.dx !== 0 && /auto|scroll|overlay/.test(s.overflowX) && el.scrollWidth > el.clientWidth)) break;
  }
  const box = el && el !== document.documentElement && el !== document.body ? el : null;
  if (a.apply) (box ?? window).scrollBy(a.dx, a.dy);
  return box ? `${box.scrollLeft},${box.scrollTop}` : `${window.scrollX},${window.scrollY}`;
}

const isBlank = (url: string) => !url || url === 'about:blank' || url.startsWith('chrome://newtab');

/** Sahifada ishlaydigan kod: elementlar daraxti (ref bilan), elementni ref yoki nuqta bo'yicha topish, element haqida ma'lumot */
const PAGE_HELPERS = `(() => {
  if (window.__pal) return;
  const S = { n: 0, byRef: new Map(), byEl: new WeakMap() };
  const refOf = el => { let r = S.byEl.get(el); if (!r) { r = 'ref_' + (++S.n); S.byEl.set(el, r); S.byRef.set(r, el); } return r; };
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const INPUT_ROLE = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', file: 'file' };
  const roleOf = el => {
    const r = el.getAttribute('role'); if (r) return r;
    const t = el.tagName;
    if (t === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button';
    if (t === 'INPUT') return INPUT_ROLE[(el.type || 'text').toLowerCase()] || 'textbox';
    if (t === 'SELECT') return 'combobox';
    if (t === 'TEXTAREA') return 'textbox';
    if (/^H[1-6]$/.test(t)) return 'heading';
    if (t === 'IMG') return el.alt ? 'img' : '';
    if (t === 'LI') return 'listitem';
    if (t === 'TABLE') return 'table';
    if (t === 'TR') return 'row';
    if (t === 'TD' || t === 'TH') return 'cell';
    if (t === 'OPTION') return 'option';
    if (t === 'FORM') return 'form';
    if (t === 'DIALOG') return 'dialog';
    return '';
  };
  const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider', 'option', 'tab', 'menuitem', 'switch', 'file']);
  const nameOf = el => {
    const aria = el.getAttribute('aria-label'); if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '); if (clean(t)) return clean(t); }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      if (clean(lab)) return clean(lab);
      if (el.placeholder) return clean(el.placeholder);
      if (['submit', 'button', 'reset'].includes((el.type || '').toLowerCase())) return clean(el.value || '');
      return clean(el.name || el.title || '');
    }
    if (el.tagName === 'IMG') return clean(el.alt);
    return clean(el.innerText || el.textContent || el.title || '');
  };
  // Elementlar iframe ichida ham bo'lishi mumkin (boshqa window): uslub va o'lcham o'z oynasidan
  const winOf = el => el.ownerDocument.defaultView || window;
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = winOf(el).getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const onScreen = el => { const r = el.getBoundingClientRect(), w = winOf(el); return r.bottom > 0 && r.right > 0 && r.top < w.innerHeight && r.left < w.innerWidth; };
  /** Shu saytning iframe'i ichidagi hujjat (boshqa saytniki — null: brauzer ichini ko'rsatmaydi) */
  const frameDoc = el => { if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') return null; try { return el.contentDocument && el.contentDocument.body ? el.contentDocument : null; } catch (e) { return null; } };
  /** Ichki bolalar: Shadow DOM (ochiq), iframe hujjati, oddiy bolalar — Reddit, YouTube, matn muharrirlari tugmalari shular ichida */
  const kids = el => { const f = frameDoc(el); if (f) return [f.body]; return el.shadowRoot ? [...el.shadowRoot.children, ...el.children] : [...el.children]; };
  const frameHost = el => { if (el.tagName !== 'IFRAME' || frameDoc(el)) return ''; try { return new URL(el.src, location.href).host; } catch (e) { return ''; } };
  const ownText = el => clean(Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
  const describe = (el, role) => {
    const name = cut(nameOf(el), 100);
    let line = role + (role === 'heading' ? '(' + el.tagName[1] + ')' : '') + (name ? ' "' + name.replace(/"/g, "'") + '"' : '');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') line += el.checked ? ' checked' : ' unchecked';
      else if (type === 'password') line += ' password' + (el.value ? ' (filled)' : ' (empty)');
      else if (!['submit', 'button', 'reset', 'image', 'file'].includes(type)) line += ' value="' + cut(clean(el.value), 120).replace(/"/g, "'") + '"';
    }
    if (el.tagName === 'SELECT') line += ' selected="' + cut(clean(el.options[el.selectedIndex]?.text || ''), 80) + '"';
    if (el.disabled) line += ' disabled';
    if (role === 'link' && el.getAttribute('href')) line += ' -> ' + cut(el.getAttribute('href'), 120);
    return line;
  };
  const MAX_DOM_DEPTH = 400;
  const tree = (filter, depth, rootRef) => {
    const root = rootRef ? S.byRef.get(rootRef) : document.body;
    if (!root || !root.isConnected) return null;
    const out = [];
    const walk = (el, d, level) => {
      // depth — ko'rsatilgan daraxt chuqurligi, DOM qavatlari emas: Facebook kabi saytlarda tugmalar 30+ div ichida, ilgari ular umuman ko'rinmasdi
      if (level > depth || d > MAX_DOM_DEPTH || !el || el.nodeType !== 1) return;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'].includes(el.tagName)) return;
      if (!visible(el) && el.tagName !== 'OPTION') return;
      const role = roleOf(el);
      const interactive = INTERACTIVE.has(role) || el.isContentEditable;
      let next = level;
      const foreign = frameHost(el);
      if (foreign) { out.push('  '.repeat(level) + 'iframe (boshqa sayt: ' + foreign + " — ichi o'qilmaydi, screenshot bilan ko'ring) [" + refOf(el) + ']'); return; }
      const show = filter === 'interactive' ? interactive : (role || ownText(el));
      if (show && (filter === 'all' || filter === 'interactive' || onScreen(el))) {
        const line = role ? describe(el, role) : 'text "' + cut(ownText(el), 160).replace(/"/g, "'") + '"';
        out.push('  '.repeat(level) + line + ' [' + refOf(el) + ']');
        next = level + 1;
      }
      if (role === 'select' || el.tagName === 'SELECT') return;
      for (const c of kids(el)) walk(c, d + 1, next);
    };
    walk(root, 0, 0);
    return out.join('\\n');
  };
  const info = el => el ? { tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: roleOf(el), name: nameOf(el), inForm: !!el.closest('form'), password: el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password' } : null;
  const clickable = el => el && el.closest('button, a[href], input[type=submit], input[type=button], [role=button], [role=link], summary, label') || el;
  /** Nuqtadagi eng ichki element: Shadow DOM va shu saytning iframe'i ichiga ham tushadi */
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    for (let i = 0; el && i < 20; i++) {
      const f = frameDoc(el);
      if (f) { const r = el.getBoundingClientRect(); x -= r.left; y -= r.top; const inner = f.elementFromPoint(x, y); if (!inner) break; el = inner; continue; }
      const inner = el.shadowRoot && el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  const deepActive = () => {
    let el = document.activeElement;
    for (let i = 0; el && i < 20; i++) {
      const f = frameDoc(el);
      const inner = f ? f.activeElement : el.shadowRoot && el.shadowRoot.activeElement;
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  window.__pal = {
    tree, info,
    el: ref => { const e = S.byRef.get(ref); return e && e.isConnected ? e : null; },
    at: (x, y) => info(clickable(deepAt(x, y))),
    active: () => info(deepActive()),
    text: () => {
      const m = document.querySelector('main, [role=main], article');
      const base = (m && clean(m.innerText).length > 200 ? m : document.body).innerText;
      // innerText iframe va Shadow DOM ichini olmaydi — ular oxiriga qo'shiladi
      const extra = [];
      const seen = (el, d) => {
        if (d > MAX_DOM_DEPTH || extra.length > 200) return;
        const f = frameDoc(el);
        if (f) { const t = clean(f.body.innerText); if (t) extra.push(t); }
        if (el.shadowRoot) { const t = clean([...el.shadowRoot.children].map(c => c.innerText || '').join(' ')); if (t) extra.push(t); }
        for (const c of el.children) seen(c, d + 1);
        if (el.shadowRoot) for (const c of el.shadowRoot.children) seen(c, d + 1);
      };
      seen(document.body, 0);
      return extra.length ? base + '\\n\\n' + extra.join('\\n\\n') : base;
    },
  };
})()`;

/** «ctrl+a», «Enter», «shift+Tab» → Playwright nomlari */
const KEY_NAMES: Record<string, string> = {
  ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Meta', cmd: 'Meta', command: 'Meta', meta: 'Meta', win: 'Meta',
  enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', space: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  pageup: 'PageUp', page_up: 'PageUp', pagedown: 'PageDown', page_down: 'PageDown', home: 'Home', end: 'End', insert: 'Insert',
};
export const playwrightCombo = (combo: string) => combo.split('+').map(p => {
  const k = p.trim();
  const named = KEY_NAMES[k.toLowerCase()];
  if (named) return named;
  if (/^f([1-9]|1[0-2])$/i.test(k)) return k.toUpperCase();
  return k.length === 1 ? k : k[0].toUpperCase() + k.slice(1);
}).join('+');

export interface BrowserOptions {
  profileDir: string;
  downloadsDir: string;
  headless: boolean;
  policy: SitePolicy;
  approve: Approver;
  /**
   * Egasining o'z Chrome'i (ownChrome.ts): yangi brauzer ochilmaydi — o'sha Chrome'da yordamchining o'z vkladkasi ochiladi.
   * Qoidalar (ichki tarmoq yopiq) va yordamchi skripti faqat o'z vkladkalariga qo'yiladi; egasining vkladkalari ro'yxatda ham yo'q
   */
  attach?: Browser;
  /** attach rejimida kuzatiladigan «Yuklanmalar» papkasi (sinovda — boshqa papka; odatda egasining Chrome sozlamasidan) */
  ownerDownloads?: string;
}

type Target = { type: 'coordinate'; x: number; y: number } | { type: 'ref'; ref: string };

export class BrowserSession {
  private tabs = new Map<string, Page>();
  private ids = new WeakMap<Page, string>();
  private active = '';
  private n = 0;
  readonly downloads: string[] = [];
  /** Saqlanayotgan yuklamalar va modelga aytilganlari soni */
  private saving: Promise<void>[] = [];
  private announced = 0;

  private constructor(private ctx: BrowserContext, private o: BrowserOptions) {}

  static async open(o: BrowserOptions): Promise<BrowserSession> {
    if (o.attach) return BrowserSession.attach(o.attach, o);
    const exe = installedBrowser();
    if (!exe) throw new Error('Bu kompyuterda Google Chrome yoki Microsoft Edge topilmadi — brauzerda ishlash uchun bittasini o\'rnating');
    mkdirSync(o.profileDir, { recursive: true });
    mkdirSync(o.downloadsDir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(o.profileDir, {
      executablePath: exe, headless: o.headless, viewport: VIEWPORT, acceptDownloads: true, locale: 'uz-UZ',
      args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate'],
    });
    const s = new BrowserSession(ctx, o);
    // Har bir so'rov (sahifa, yo'naltirish, rasm, skript) — ichki tarmoqqa va ro'yxatdan tashqari saytga ketmaydi
    await ctx.route('**/*', route => (allowedRequest(route.request().url(), o.policy) ? route.continue() : route.abort('blockedbyclient')));
    await ctx.addInitScript(PAGE_HELPERS);
    ctx.on('page', p => s.adopt(p));
    for (const p of ctx.pages()) s.adopt(p);
    if (!s.tabs.size) s.adopt(await ctx.newPage());
    return s;
  }

  /** Egasining Chrome'ida: faqat o'z vkladkalari (va ulardan ochilgan oynalar) — egasinikilariga tegilmaydi */
  private static async attach(browser: Browser, o: BrowserOptions): Promise<BrowserSession> {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error("Chrome'ning oynasi topilmadi — Chrome'ni oching");
    mkdirSync(o.downloadsDir, { recursive: true });
    const s = new BrowserSession(ctx, o);
    s.shared = true;
    // Egasining Chrome'ida yuklamalar Playwright'ga kelmaydi — Chrome'ning o'z papkasidan olinadi (ownDownloads.ts)
    s.watch = new DownloadWatch(o.ownerDownloads ?? ownerDownloadsDir(), o.downloadsDir);
    s.onPage = p => { void p.opener().then(op => { if (op && s.ids.has(op)) void s.own(p); }).catch(() => {}); };
    ctx.on('page', s.onPage);
    await s.own(await ctx.newPage());
    return s;
  }

  /** Egasining Chrome'ida: qoidalar va yordamchi skripti shu vkladkaga (butun profilga emas) */
  private async own(p: Page): Promise<void> {
    if (this.ids.has(p)) return;
    this.adopt(p);
    await p.route('**/*', route => (allowedRequest(route.request().url(), this.o.policy) ? route.continue() : route.abort('blockedbyclient')));
    await p.addInitScript(PAGE_HELPERS);
  }

  /** Egasining Chrome'iga ulangan (attach) — yopilganda faqat o'z vkladkalari yopiladi */
  private shared = false;
  private watch: DownloadWatch | null = null;
  /** Ochiq brauzer oynalari (alert/confirm/prompt) — vkladka bo'yicha; ochilganda kutayotgan a'zo darhol javob oladi */
  private readonly dialogs = new Map<Page, { d: Dialog; o: OpenDialog }>();
  private readonly dialogWaiters = new Set<() => void>();
  /** Egasidan ruxsat kutilyapti (bu vaqt a'zo vaqtiga kirmaydi) va oxirgi so'rov tugagan payt */
  private asking = false;
  private askedAt = 0;
  private onPage: ((p: Page) => void) | null = null;

  private adopt(p: Page): void {
    if (this.ids.has(p)) return;
    const id = `tab-${++this.n}`;
    this.tabs.set(id, p);
    this.ids.set(p, id);
    this.active = id;
    p.setDefaultTimeout(ACTION_TIMEOUT_MS);
    p.on('close', () => { this.tabs.delete(id); this.dialogs.delete(p); if (this.active === id) this.active = [...this.tabs.keys()].at(-1) ?? ''; });
    // Tinglovchi bor — Playwright oynani o'zi yopmaydi: model ko'radi va javob beradi. Sahifadan chiqish so'rovi (beforeunload) — rozi
    p.on('dialog', d => {
      if (d.type() === 'beforeunload') { void d.accept().catch(() => {}); return; }
      this.dialogs.set(p, { d, o: fromDialog(d) });
      for (const w of this.dialogWaiters) w();
    });
    p.on('download', d => {
      const file = join(this.o.downloadsDir, basename(d.suggestedFilename()).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'fayl');
      this.saving.push(d.saveAs(file).then(() => { this.downloads.push(file); }, () => {}));
    });
  }

  private page(tabId?: string): Page {
    const p = this.tabs.get(tabId || this.active);
    if (!p) throw new PolicyError(`Tab topilmadi: ${tabId ?? this.active}`);
    return p;
  }

  private async helpers(p: Page): Promise<void> {
    // Sahifa init skriptidan oldin ochilgan bo'lsa (about:blank) — qo'lda
    await p.evaluate(PAGE_HELPERS).catch(() => {});
  }

  private async state(): Promise<Anthropic.Beta.BetaBrowserStateBlockParam> {
    // Oynasi ochiq vkladkada sarlavha o'qib bo'lmaydi (osilib qoladi)
    const title = (p: Page) => (this.dialogs.has(p) ? Promise.resolve('(brauzer oynasi ochiq)') : Promise.race([p.title().catch(() => ''), sleep(3_000).then(() => '')]));
    const tabs = await Promise.all([...this.tabs.entries()].map(async ([id, p]) => ({ tab_id: id, title: (await title(p)).slice(0, 200), url: p.url(), active: id === this.active })));
    return { type: 'browser_state', tabs };
  }

  /**
   * Shu amalda ochilgan (va ochiq qolgan) vkladkalar — browser_state.state_changes dagi tab_opened. API new_tab natijasida aynan bittasini
   * talab qiladi: bo'lmasa butun ish «400» bilan yiqilardi (2026-11-20: uchta saytni alohida vkladkalarda ochish)
   */
  private async withOpenedTabs(r: MemberResult, before: Set<string>): Promise<MemberResult> {
    const opened = [...this.tabs.keys()].filter(id => !before.has(id));
    if (!opened.length) return r;
    const isState = (b: ResultContent[number]): b is Anthropic.Beta.BetaBrowserStateBlockParam => (b as { type?: string }).type === 'browser_state';
    const fresh = await this.state();
    const rest = r.content.filter(b => !isState(b));
    return { ...r, content: [...rest, { ...fresh, state_changes: opened.map(tab_id => ({ type: 'tab_opened' as const, tab_id })) }] };
  }

  private async withState(t: string, before?: { url: string; title: string }): Promise<MemberResult> {
    const p = this.page();
    const now = { url: p.url(), title: await p.title().catch(() => '') };
    const changed = !before || before.url !== now.url || before.title !== now.title;
    return { content: [{ type: 'text', text: t }, ...(changed ? [await this.state()] : [])] };
  }

  private async element(p: Page, ref: string): Promise<ElementHandle<Element>> {
    await this.helpers(p);
    const h = await p.evaluateHandle(r => (window as unknown as { __pal?: { el: (r: string) => Element | null } }).__pal?.el(r) ?? null, ref);
    const el = h.asElement() as ElementHandle<Element> | null;
    if (!el) throw new PolicyError(`Error: ${ref} is stale or not found on the current page. Re-read the page to get fresh references.`);
    return el;
  }

  private async infoAt(p: Page, t: Target): Promise<{ point: { x: number; y: number }; info: ElementInfo & { password?: boolean } | null }> {
    await this.helpers(p);
    if (t.type === 'ref') {
      const el = await this.element(p, t.ref);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const box = await el.boundingBox();
      if (!box) throw new PolicyError(`${t.ref} ekranda ko'rinmayapti`);
      const info = await el.evaluate(e => (window as unknown as { __pal: { info: (e: Element) => ElementInfo } }).__pal.info(e));
      return { point: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, info };
    }
    const info = await p.evaluate(([x, y]) => (window as unknown as { __pal?: { at: (x: number, y: number) => ElementInfo | null } }).__pal?.at(x, y) ?? null, [t.x, t.y] as const);
    return { point: { x: t.x, y: t.y }, info };
  }

  private async gate(what: string | null): Promise<MemberResult | null> {
    if (!what) return null;
    const host = (() => { try { return new URL(this.page().url()).host; } catch { return ''; } })();
    this.asking = true;
    const ok = await this.o.approve(`${what}${host ? ` — ${host}` : ''}`).finally(() => { this.asking = false; this.askedAt = Date.now(); });
    if (ok === true) return null;
    // Javob bo'lmagani — «rad etdi» emas (2026-11-19: 10 daqiqa jim turgan egasi hisobotda «ruxsat bermadingiz» deb yozildi)
    return fail(ok === null
      ? `Egasi javob bermadi (kutish vaqti tugadi): ${what}. Bu amalni bajarmang; hisobotda «egasi javob bermadi» deb ayting — «rad etdi» demang.`
      : `Egasi ruxsat bermadi: ${what}. Bu amalni bajarmang; boshqa yo'l kerak bo'lsa — egasiga hisobotda ayting.`);
  }

  /**
   * Amal sahifani almashtirsa (forma yuborish, havola) — yangi sahifa yuklanguncha kutadi. Kutilmasa, darhol kelgan keyingi amal
   * (sahifani o'qish) rejalashtirilgan yuborishni bekor qilib qo'yadi
   */
  private async settled<T>(p: Page, act: () => Promise<T>): Promise<T> {
    let navigating = false, done = false;
    const main = (r: Request) => r.isNavigationRequest() && r.frame() === p.mainFrame();
    const onRequest = (r: Request) => { if (main(r)) { navigating = true; done = false; } };
    const onEnd = (r: Request) => { if (main(r)) done = true; };
    const onLoaded = () => { done = true; };
    p.on('request', onRequest);
    p.on('requestfailed', onEnd);
    p.on('domcontentloaded', onLoaded);
    try {
      const out = await act();
      await sleep(250);
      const end = Date.now() + NAV_TIMEOUT_MS;
      while (navigating && !done && Date.now() < end && !p.isClosed()) await sleep(100);
      return out;
    } finally {
      p.off('request', onRequest);
      p.off('requestfailed', onEnd);
      p.off('domcontentloaded', onLoaded);
    }
  }

  private async withModifiers<T>(p: Page, modifiers: unknown, fn: () => Promise<T>): Promise<T> {
    const keys = typeof modifiers === 'string' && modifiers ? modifiers.split('+').map(k => playwrightCombo(k)) : [];
    for (const k of keys) await p.keyboard.down(k);
    try { return await fn(); } finally { for (const k of keys.reverse()) await p.keyboard.up(k).catch(() => {}); }
  }

  /** Bitta a'zoni bajaradi. Kutilgan xatolar (eski ref, taqiqlangan manzil, ruxsat yo'q) — is_error natija, boshqasi ham shunday */
  async run(name: string, input: Record<string, unknown>): Promise<MemberResult> {
    let r: MemberResult;
    const tabsBefore = new Set(this.tabs.keys());
    try {
      const open = this.openDialog();
      r = open ? await this.answerDialog(open.p, name, input) : await this.untilDialog(this.member(name, input));
      if (!r.isError) r = await this.withOpenedTabs(r, tabsBefore);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0].slice(0, 300);
      r = fail(e instanceof PolicyError ? msg : `Bajarilmadi: ${msg}`);
    }
    // Yuklab olingan fayllar — modelga aytiladi (hisobotda nomini yozsin)
    const fresh = (await this.saved(30_000, false)).slice(this.announced);
    this.announced += fresh.length;
    return fresh.length ? { ...r, content: [...r.content, { type: 'text', text: `Yuklab olindi: ${fresh.map(f => basename(f)).join(', ')}` }] } : r;
  }

  private openDialog(): { p: Page; o: OpenDialog } | null {
    const active = this.tabs.get(this.active);
    const hit = (active && this.dialogs.has(active) ? active : null) ?? [...this.dialogs.keys()][0];
    return hit ? { p: hit, o: this.dialogs.get(hit)!.o } : null;
  }

  /**
   * A'zo tugashini kutadi — lekin oyna ochilsa (bosish alert chiqardi) yoki sahifa MEMBER_MAX_MS javob bermasa, darhol qaytadi.
   * Oyna ochiq turganda bosish (CDP) oyna yopilguncha tugamaydi: kutilsa, ish shu yerda abadiy turib qolardi
   */
  private async untilDialog(work: Promise<MemberResult>): Promise<MemberResult> {
    const start = Date.now();
    let wake = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const interrupt = new Promise<'dialog' | 'timeout'>(res => {
      wake = () => res('dialog');
      this.dialogWaiters.add(wake);
      timer = setInterval(() => { if (!this.asking && Date.now() - Math.max(start, this.askedAt) > MEMBER_MAX_MS) res('timeout'); }, 1_000);
    });
    try {
      const out = await Promise.race([work, interrupt]);
      if (out !== 'dialog' && out !== 'timeout') return out;
      work.catch(() => {});
      const open = this.openDialog();
      if (open) return text(describeDialog(open.o));
      return fail(`Amal ${MEMBER_MAX_MS / 1000} s da tugamadi — sahifa javob bermayapti. Sahifani qayta o'qing (read_page) yoki boshqa yo'l tanlang`);
    } finally {
      this.dialogWaiters.delete(wake);
      clearInterval(timer);
    }
  }

  /** Oyna ochiq: a'zo unga javob (browserDialog.ts) */
  private async answerDialog(p: Page, name: string, input: Record<string, unknown>): Promise<MemberResult> {
    const entry = this.dialogs.get(p)!;
    const step = dialogStep(entry.o, name, input);
    if (step.do === 'refuse') return fail(step.why);
    if (step.do === 'wait') {
      await sleep(clampWait(input.duration) * 1000);
      return text(this.dialogs.has(p) ? describeDialog(entry.o) : 'OK');
    }
    if (step.do === 'typed') {
      entry.o = { ...entry.o, typed: step.text };
      return text(`Oynaga yozildi: «${step.text}» — hali yuborilmadi. Yuborish: key "Enter"`);
    }
    if (step.do === 'accept' && step.ask) {
      const stop = await this.gate(step.ask);
      if (stop) return stop;
    }
    this.dialogs.delete(p);
    // Oyna boshqa yo'l bilan yopilgan bo'lsa (sayt o'zi, egasi) — xato emas
    await (step.do === 'accept' ? entry.d.accept(step.text) : entry.d.dismiss()).catch(() => {});
    await sleep(300);
    return this.untilDialog(this.withState(step.do === 'accept' ? 'Oynada OK bosildi' : 'Oyna bekor qilindi (Cancel)'));
  }

  /**
   * Yuklab olingan fayllar (saqlanayotganlari tugashini ko'pi bilan ms kutadi). settleOwner=false — har qadamdan keyin: egasining papkasida
   * hali yozilayotgan fayl kutilmaydi (keyingi qadamda yoki ish oxirida olinadi)
   */
  async saved(ms = 30_000, settleOwner = true): Promise<string[]> {
    if (this.saving.length) await Promise.race([Promise.all(this.saving.splice(0)), new Promise(r => setTimeout(r, ms))]);
    if (this.watch) this.downloads.push(...(settleOwner ? await this.watch.settle(ms) : this.watch.collect().files));
    return [...this.downloads];
  }

  private async member(name: string, i: Record<string, unknown>): Promise<MemberResult> {
    const tabId = typeof i.tab_id === 'string' ? i.tab_id : undefined;
    switch (name) {
      case 'navigate': {
        const p = this.page(tabId);
        const before = { url: p.url(), title: await p.title().catch(() => '') };
        const url = String(i.url ?? '');
        // Orqaga/oldinga: Chrome sahifani keshdan tiklaganda (Google qidiruvi) «load» kelmaydi — 30 s kutib yiqilardi (2026-11-20).
        // O'tish boshlanishi kutiladi, keyin sahifa ko'pi bilan HISTORY_SETTLE_MS yuklanadi
        const history = { timeout: NAV_TIMEOUT_MS, waitUntil: 'commit' as const };
        const settle = () => p.waitForLoadState('domcontentloaded', { timeout: HISTORY_SETTLE_MS }).catch(() => {});
        if (url === 'back') { await p.goBack(history); await settle(); }
        else if (url === 'forward') { await p.goForward(history); await settle(); }
        else if (url === 'reload') { await p.reload(history); await settle(); }
        else {
          const target = checkUrl(url, this.o.policy);
          const res = await p.goto(target, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }).catch(e => {
            if (/ERR_BLOCKED_BY_CLIENT/.test(String(e))) throw new PolicyError('Sahifa yo\'naltirildi, lekin yangi manzil ruxsat etilmagan (ichki tarmoq yoki ro\'yxatdan tashqari) — ochilmadi');
            throw e;
          });
          if (res && res.status() >= 400) return this.withState(`Ochildi, lekin sayt ${res.status()} qaytardi: ${p.url()}`, before);
        }
        await this.helpers(p);
        return this.withState(`Ochildi: ${p.url()}`, before);
      }
      case 'screenshot': {
        // scale: css — rasm piksellari = bosish koordinatalari. Egasining Chrome'ida Windows masshtabi 125% bo'lsa rasm 1.25 baravar katta chiqib,
        // model bosgan joy adashardi (2026-11-19, Meta Business: «koordinatalar mos kelmadi»)
        // Egasining Chrome'i yig'ilgan yoki vkladka orqa fonda bo'lsa Chrome kadr chizmaydi — 15 s kutib yiqilardi (2026-11-20, texnomart.uz)
        const png = await this.page(tabId).screenshot({ type: 'png', scale: 'css', timeout: SHOT_MS }).catch(() => null);
        if (!png) return fail("Rasm olinmadi: Chrome oynasi yig'ilgan yoki bu vkladka orqa fonda — sahifani read_page, find va get_page_text bilan o'qing va ref bilan bosing");
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }] };
      }
      case 'zoom': {
        const r = Array.isArray(i.region) ? (i.region as number[]).map(Number) : [];
        if (r.length !== 4 || r[2] <= r[0] || r[3] <= r[1]) return fail('region: [x0, y0, x1, y1] bo\'lishi kerak');
        const png = await this.page(tabId).screenshot({ type: 'png', clip: { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] } });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }] };
      }
      case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click': {
        const p = this.page(tabId);
        const { point, info } = await this.infoAt(p, i.target as Target);
        // To'lash, pul o'tkazish, sotib olish — bosilmaydi, egasining ruxsati bilan ham (money.ts)
        if (name !== 'right_click' && info?.name && moneyControl(info.name)) return fail(`«${info.name.slice(0, 60)}» — ${MONEY_ZONE}`);
        const stop = await this.gate(name === 'right_click' ? null : riskyClick(info));
        if (stop) return stop;
        const before = { url: p.url(), title: await p.title().catch(() => '') };
        const button = name === 'right_click' ? 'right' : name === 'middle_click' ? 'middle' : 'left';
        const clickCount = name === 'double_click' ? 2 : name === 'triple_click' ? 3 : 1;
        await this.settled(p, () => this.withModifiers(p, i.modifiers, () => p.mouse.click(point.x, point.y, { button, clickCount })));
        return this.withState(`Bosildi${info?.name ? `: ${info.role || info.tag} «${info.name.slice(0, 60)}»` : ''}`, before);
      }
      case 'hover': case 'mouse_move': {
        const p = this.page(tabId);
        const { point } = await this.infoAt(p, i.target as Target);
        await p.mouse.move(point.x, point.y);
        return text('OK');
      }
      case 'left_click_drag': {
        const p = this.page(tabId);
        const from = i.from as Target, to = i.target as Target;
        if (from?.type !== 'coordinate' || to?.type !== 'coordinate') return fail('from va target — coordinate bo\'lishi kerak');
        await p.mouse.move(from.x, from.y);
        await p.mouse.down();
        await p.mouse.move(to.x, to.y, { steps: 12 });
        await p.mouse.up();
        return text('OK');
      }
      case 'scroll': {
        const p = this.page(tabId);
        const t = i.target as Target | undefined;
        // Egasining Chrome'ida oyna o'lchami VIEWPORT emas — markaz haqiqiy oynadan olinadi
        const size = p.viewportSize() ?? await p.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const at = t?.type === 'coordinate' ? t : { x: size.width / 2, y: size.height / 2 };
        const amount = Math.max(1, Math.min(10, Number(i.scroll_amount) || 3)) * 120;
        const dir = String(i.scroll_direction);
        const move = { x: at.x, y: at.y, dx: dir === 'left' ? -amount : dir === 'right' ? amount : 0, dy: dir === 'up' ? -amount : dir === 'down' ? amount : 0 };
        // G'ildirak — haqiqiy hodisa (sayt o'zi yuklaydi). Egasining Chrome'ida vkladka orqa fonda bo'lsa Chrome uni chizmaydi va hodisa
        // javobsiz osilib qoladi (2026-11-19, Google Maps: «aylantirib bo'lmadi») — shunda yoki ro'yxat qimirlamasa, o'sha nuqtadagi ro'yxat JS bilan
        const before = await p.evaluate(scrollAt, { ...move, apply: false });
        const wheeled = await Promise.race([
          p.mouse.move(at.x, at.y).then(() => p.mouse.wheel(move.dx, move.dy)).then(() => true, () => false),
          sleep(WHEEL_MS).then(() => false),
        ]);
        await sleep(300);
        if (!wheeled || await p.evaluate(scrollAt, { ...move, apply: false }) === before) await p.evaluate(scrollAt, { ...move, apply: true });
        return text('OK');
      }
      case 'scroll_to': {
        const t = i.target as Target;
        if (t?.type !== 'ref') return fail('target — ref bo\'lishi kerak');
        const el = await this.element(this.page(tabId), t.ref);
        // Playwright element ko'rinishini kutadi: yashirin element (yopiq savol-javob) yoki orqa fondagi vkladka — 15 s osilib qolardi (2026-11-19, olcha.uz)
        if (await el.scrollIntoViewIfNeeded({ timeout: SCROLL_TO_MS }).then(() => true, () => false)) return text('OK');
        const shown = await el.evaluate(e => {
          const r = e.getBoundingClientRect();
          if (r.width < 1 && r.height < 1) return false;
          e.scrollIntoView({ block: 'center' });
          return true;
        });
        return shown ? text('OK') : fail("Bu element yashirin (sahifada ko'rinmaydi) — uni ochadigan tugmani (savol, «Batafsil», «Yana») bosing yoki matnini get_page_text bilan o'qing");
      }
      case 'type': {
        const p = this.page(tabId);
        await this.helpers(p);
        const active = await p.evaluate(() => (window as unknown as { __pal?: { active: () => (ElementInfo & { password?: boolean }) | null } }).__pal?.active() ?? null);
        if (active?.password) return fail('Bu parol maydoni — parolni AI kiritmaydi. Egasi /brauzer bilan saytga o\'zi kirib olsin; hisobotda ayting.');
        const t = String(i.text ?? '');
        if (cardLike(t)) return fail(`Karta raqami yozilmaydi. ${MONEY_ZONE}`);
        // Matn ichidagi yangi qator — Enter: formada yuboradi
        const stop = await this.gate(/[\r\n]/.test(t) ? riskyKey('Enter', active) : null);
        if (stop) return stop;
        const before = { url: p.url(), title: await p.title().catch(() => '') };
        await this.settled(p, () => p.keyboard.type(t, { delay: 15 }));
        return this.withState('OK', before);
      }
      case 'key': {
        const p = this.page(tabId);
        await this.helpers(p);
        const keys = String(i.text ?? '').trim();
        const active = await p.evaluate(() => (window as unknown as { __pal?: { active: () => ElementInfo | null } }).__pal?.active() ?? null);
        // To'lov tugmasi ustida Enter yoki probel — bosish bilan bir xil
        if (/\b(enter|return|space)\b/i.test(keys) && active?.name && moneyControl(active.name)) return fail(`«${active.name.slice(0, 60)}» — ${MONEY_ZONE}`);
        const stop = await this.gate(riskyKey(keys, active));
        if (stop) return stop;
        const before = { url: p.url(), title: await p.title().catch(() => '') };
        const repeat = Math.max(1, Math.min(100, Number(i.repeat) || 1));
        await this.settled(p, async () => {
          for (let n = 0; n < repeat; n++) for (const combo of keys.split(/\s+/).filter(Boolean)) await p.keyboard.press(playwrightCombo(combo));
        });
        return this.withState('OK', before);
      }
      case 'wait': {
        await sleep(clampWait(i.duration) * 1000);
        return text('OK');
      }
      case 'read_page': {
        const p = this.page(tabId);
        await this.helpers(p);
        const filter = i.filter === 'interactive' || i.filter === 'all' ? i.filter : 'visible';
        const depth = Math.max(1, Number(i.depth) || 15);
        const tree = await p.evaluate(([f, d, r]) => (window as unknown as { __pal: { tree: (f: string, d: number, r: string | null) => string | null } }).__pal.tree(f, d, r), [filter, depth, typeof i.ref === 'string' ? i.ref : null] as const);
        if (tree === null) return fail(`Error: ${String(i.ref)} is stale or not found on the current page. Re-read the page to get fresh references.`);
        const body = tree || '(sahifada ko\'rinadigan element yo\'q)';
        return text(body.length > MAX_TREE ? `${body.slice(0, MAX_TREE)}\n… (qisqartirildi: ${body.length} belgi; ref bilan qismini o'qing)` : body);
      }
      case 'find': {
        const p = this.page(tabId);
        await this.helpers(p);
        const all = (await p.evaluate(() => (window as unknown as { __pal: { tree: (f: string, d: number, r: null) => string } }).__pal.tree('all', 40, null))) ?? '';
        const words = String(i.query ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
        const scored = all.split('\n').map(l => ({ l: l.trim(), s: words.filter(w => l.toLowerCase().includes(w)).length })).filter(x => x.s > 0);
        scored.sort((a, b) => b.s - a.s);
        return text(scored.length ? scored.slice(0, 20).map(x => x.l).join('\n') : 'Mos element topilmadi. read_page bilan sahifani o\'qing.');
      }
      case 'get_page_text': {
        const p = this.page(tabId);
        await this.helpers(p);
        const t = (await p.evaluate(() => (window as unknown as { __pal: { text: () => string } }).__pal.text())).trim();
        return text(t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n… (qisqartirildi)` : t || '(sahifada matn yo\'q)');
      }
      case 'form_input': {
        const p = this.page(tabId);
        const t = i.target as Target;
        if (t?.type !== 'ref') return fail('target — ref bo\'lishi kerak');
        const el = await this.element(p, t.ref);
        // Yorliq («Bacon» matni) berilsa — uning maydoni (Playwright check() yorliqni o'zi maydonga yo'naltiradi; fill esa yiqilardi)
        const kind = await el.evaluate(e => {
          const c = e instanceof HTMLLabelElement && e.control ? e.control : e;
          return { tag: c.tagName, type: ((c as HTMLInputElement).type || '').toLowerCase() };
        });
        if (kind.type === 'password') return fail('Bu parol maydoni — parolni AI kiritmaydi. Egasi /brauzer bilan saytga o\'zi kirib olsin; hisobotda ayting.');
        const value = i.value;
        if (cardLike(String(value ?? ''))) return fail(`Karta raqami yozilmaydi. ${MONEY_ZONE}`);
        if (kind.tag === 'SELECT') await el.selectOption({ label: String(value) }).catch(() => el.selectOption(String(value)));
        else if (kind.type === 'checkbox' || kind.type === 'radio') {
          const on = value === true || value === 'true';
          // Playwright sahifa chizilishini kutadi — egasining Chrome'ida orqa fondagi vkladkada 15 s osilib yiqilardi (2026-11-19, httpbin):
          // 3 s dan keyin — elementning o'z bosilishi (saytning hodisalari ishlaydi)
          if (!await (on ? el.check({ timeout: CHECK_MS }) : el.uncheck({ timeout: CHECK_MS })).then(() => true, () => false)) {
            const now = await el.evaluate((e, want) => {
              const box = (e instanceof HTMLLabelElement && e.control ? e.control : e) as HTMLInputElement;
              if (box.checked !== want) box.click();
              return box.checked;
            }, on);
            if (now !== on) return fail(on ? "Belgi qo'yilmadi (sayt bosishni qabul qilmadi)" : 'Belgi olib tashlanmadi (sayt bosishni qabul qilmadi)');
          }
        } else await el.fill(String(value ?? ''));
        return text('OK');
      }
      case 'new_tab': {
        const p = await this.ctx.newPage();
        if (this.shared) await this.own(p);
        else this.adopt(p);
        return { content: [await this.state()] };
      }
      case 'list_tabs': return { content: [await this.state()] };
      case 'switch_tab': {
        const p = this.page(tabId);
        this.active = this.ids.get(p)!;
        await p.bringToFront().catch(() => {});
        return { content: [await this.state()] };
      }
      case 'close_tab': {
        const p = this.page(tabId);
        if (this.tabs.size === 1) await this.ctx.newPage().then(n => (this.shared ? this.own(n) : this.adopt(n)));
        await p.close();
        return { content: [await this.state()] };
      }
      default:
        return fail(`Bu a'zo yoqilmagan: ${name}`);
    }
  }

  async close(): Promise<void> {
    // Ochiq qolgan oyna — bekor (egasining vkladkasi to'xtab qolmasin)
    await Promise.all([...this.dialogs.values()].map(({ d }) => d.dismiss().catch(() => {})));
    this.dialogs.clear();
    if (!this.shared) {
      await this.ctx.close().catch(() => {});
      return;
    }
    // Egasining Chrome'i: ish vkladkasi yopilmaydi — egasi natijani ko'radi, o'sha joydan o'zi davom etadi, qo'yilgan musiqa o'chmaydi
    // (2026-11-19 egasi: «вкладку закрыл — зачем?»). Vkladka endi egasiniki: Palantir qoidalari (sayt cheklovi) olib tashlanadi; bo'sh vkladkalar yopiladi
    if (this.onPage) this.ctx.off('page', this.onPage);
    await Promise.all([...this.tabs.values()].map(p => (isBlank(p.url()) ? p.close() : p.unrouteAll({ behavior: 'ignoreErrors' })).catch(() => {})));
  }
}
