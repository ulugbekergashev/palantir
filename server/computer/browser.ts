/**
 * Brauzerda ishlash (Claude browser_toolset_20260801 a'zolari): alohida Chrome profili (egasining shaxsiy brauzeriga tegilmaydi),
 * har bir a'zo — Playwright orqali. Sahifa o'qilganda har elementga «ref_N» beriladi (sahifa almashguncha o'zgarmaydi).
 * Xavfsizlik: har bir so'rov (yo'naltirish ham) policy.ts dan o'tadi — shu kompyuter va ichki tarmoq yopiq; parol maydoniga AI yozmaydi;
 * yuborish/to'lash/o'chirish kabi tugma yoki formadagi Enter — avval egasidan so'raladi (approve).
 */
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { chromium, type BrowserContext, type ElementHandle, type Page, type Request } from 'playwright-core';
import { installedBrowser } from '../browserPath';
import { PolicyError, allowedRequest, checkUrl, riskyClick, riskyKey, type ElementInfo, type SitePolicy } from './policy';

export type ResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam['content'], string | undefined>;
export interface MemberResult { content: ResultContent; isError?: boolean }
/** Egasidan so'rash (Telegram tugmalari): true — ruxsat */
export type Approver = (what: string) => Promise<boolean>;

export const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 30_000, ACTION_TIMEOUT_MS = 15_000, MAX_TREE = 50_000, MAX_TEXT = 50_000, MAX_WAIT_S = 30;

/** Brauzer a'zolari: sichqonchani bosib turish va tugmani ushlab turish kerak emas (tasodifiy bosilib qolishi xavfli) */
export const BROWSER_TOOLSET: Anthropic.Beta.BetaBrowserToolset20260801 = {
  type: 'browser_toolset_20260801',
  configs: { left_mouse_down: { enabled: false }, left_mouse_up: { enabled: false }, hold_key: { enabled: false } },
};

const text = (t: string): MemberResult => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): MemberResult => ({ content: [{ type: 'text', text: t }], isError: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clampWait = (s: unknown) => Math.max(0, Math.min(MAX_WAIT_S, Number(s) || 0));

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
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const onScreen = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
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
  const tree = (filter, depth, rootRef) => {
    const root = rootRef ? S.byRef.get(rootRef) : document.body;
    if (!root || !root.isConnected) return null;
    const out = [];
    const walk = (el, d, level) => {
      if (d > depth || !(el instanceof Element)) return;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'].includes(el.tagName)) return;
      if (!visible(el) && el.tagName !== 'OPTION') return;
      const role = roleOf(el);
      const interactive = INTERACTIVE.has(role) || el.isContentEditable;
      let next = level;
      const show = filter === 'interactive' ? interactive : (role || ownText(el));
      if (show && (filter === 'all' || filter === 'interactive' || onScreen(el))) {
        const line = role ? describe(el, role) : 'text "' + cut(ownText(el), 160).replace(/"/g, "'") + '"';
        out.push('  '.repeat(level) + line + ' [' + refOf(el) + ']');
        next = level + 1;
      }
      if (role === 'select' || el.tagName === 'SELECT') return;
      for (const c of el.children) walk(c, d + 1, next);
    };
    walk(root, 0, 0);
    return out.join('\\n');
  };
  const info = el => el ? { tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: roleOf(el), name: nameOf(el), inForm: !!el.closest('form'), password: el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password' } : null;
  const clickable = el => el && el.closest('button, a[href], input[type=submit], input[type=button], [role=button], [role=link], summary, label') || el;
  window.__pal = {
    tree, info,
    el: ref => { const e = S.byRef.get(ref); return e && e.isConnected ? e : null; },
    at: (x, y) => info(clickable(document.elementFromPoint(x, y))),
    active: () => info(document.activeElement),
    text: () => { const m = document.querySelector('main, [role=main], article'); return (m && clean(m.innerText).length > 200 ? m : document.body).innerText; },
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

  private adopt(p: Page): void {
    if (this.ids.has(p)) return;
    const id = `tab-${++this.n}`;
    this.tabs.set(id, p);
    this.ids.set(p, id);
    this.active = id;
    p.setDefaultTimeout(ACTION_TIMEOUT_MS);
    p.on('close', () => { this.tabs.delete(id); if (this.active === id) this.active = [...this.tabs.keys()].at(-1) ?? ''; });
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
    const tabs = await Promise.all([...this.tabs.entries()].map(async ([id, p]) => ({ tab_id: id, title: (await p.title().catch(() => '')).slice(0, 200), url: p.url(), active: id === this.active })));
    return { type: 'browser_state', tabs };
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
    const ok = await this.o.approve(`${what}${host ? ` — ${host}` : ''}`);
    return ok ? null : fail(`Egasi ruxsat bermadi: ${what}. Bu amalni bajarmang; boshqa yo'l kerak bo'lsa — egasiga hisobotda ayting.`);
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
    try {
      r = await this.member(name, input);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0].slice(0, 300);
      r = fail(e instanceof PolicyError ? msg : `Bajarilmadi: ${msg}`);
    }
    // Yuklab olingan fayllar — modelga aytiladi (hisobotda nomini yozsin)
    const fresh = (await this.saved()).slice(this.announced);
    this.announced += fresh.length;
    return fresh.length ? { ...r, content: [...r.content, { type: 'text', text: `Yuklab olindi: ${fresh.map(f => basename(f)).join(', ')}` }] } : r;
  }

  /** Yuklab olingan fayllar (saqlanayotganlari tugashini ko'pi bilan ms kutadi) */
  async saved(ms = 30_000): Promise<string[]> {
    if (this.saving.length) await Promise.race([Promise.all(this.saving.splice(0)), new Promise(r => setTimeout(r, ms))]);
    return [...this.downloads];
  }

  private async member(name: string, i: Record<string, unknown>): Promise<MemberResult> {
    const tabId = typeof i.tab_id === 'string' ? i.tab_id : undefined;
    switch (name) {
      case 'navigate': {
        const p = this.page(tabId);
        const before = { url: p.url(), title: await p.title().catch(() => '') };
        const url = String(i.url ?? '');
        if (url === 'back') await p.goBack({ timeout: NAV_TIMEOUT_MS });
        else if (url === 'forward') await p.goForward({ timeout: NAV_TIMEOUT_MS });
        else if (url === 'reload') await p.reload({ timeout: NAV_TIMEOUT_MS });
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
        const png = await this.page(tabId).screenshot({ type: 'png' });
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
        const at = t?.type === 'coordinate' ? t : { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
        const amount = Math.max(1, Math.min(10, Number(i.scroll_amount) || 3)) * 120;
        const dir = String(i.scroll_direction);
        await p.mouse.move(at.x, at.y);
        await p.mouse.wheel(dir === 'left' ? -amount : dir === 'right' ? amount : 0, dir === 'up' ? -amount : dir === 'down' ? amount : 0);
        await sleep(300);
        return text('OK');
      }
      case 'scroll_to': {
        const t = i.target as Target;
        if (t?.type !== 'ref') return fail('target — ref bo\'lishi kerak');
        await (await this.element(this.page(tabId), t.ref)).scrollIntoViewIfNeeded();
        return text('OK');
      }
      case 'type': {
        const p = this.page(tabId);
        await this.helpers(p);
        const active = await p.evaluate(() => (window as unknown as { __pal?: { active: () => (ElementInfo & { password?: boolean }) | null } }).__pal?.active() ?? null);
        if (active?.password) return fail('Bu parol maydoni — parolni AI kiritmaydi. Egasi /brauzer bilan saytga o\'zi kirib olsin; hisobotda ayting.');
        const t = String(i.text ?? '');
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
        const kind = await el.evaluate(e => ({ tag: e.tagName, type: ((e as HTMLInputElement).type || '').toLowerCase() }));
        if (kind.type === 'password') return fail('Bu parol maydoni — parolni AI kiritmaydi. Egasi /brauzer bilan saytga o\'zi kirib olsin; hisobotda ayting.');
        const value = i.value;
        if (kind.tag === 'SELECT') await el.selectOption({ label: String(value) }).catch(() => el.selectOption(String(value)));
        else if (kind.type === 'checkbox' || kind.type === 'radio') await (value === true || value === 'true' ? el.check() : el.uncheck());
        else await el.fill(String(value ?? ''));
        return text('OK');
      }
      case 'new_tab': {
        const p = await this.ctx.newPage();
        this.adopt(p);
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
        if (this.tabs.size === 1) await this.ctx.newPage().then(n => this.adopt(n));
        await p.close();
        return { content: [await this.state()] };
      }
      default:
        return fail(`Bu a'zo yoqilmagan: ${name}`);
    }
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => {});
  }
}
