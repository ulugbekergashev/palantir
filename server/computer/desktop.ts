/**
 * Butun kompyuterda ishlash (Claude computer_toolset_20260801 a'zolari): ekran rasmi, sichqoncha, klaviatura.
 * Ekran rasmi Claude uchun 1280×800 ichiga kichraytiriladi (tavsiya etilgan o'lcham); u bergan koordinatalar haqiqiy ekranga qaytarib hisoblanadi.
 * Haydovchilar: Windows — o'zimiz yig'adigan C# yordamchi (helper/PalantirDesk.cs, csc.exe); macOS — screencapture/sips va JXA
 * (helper/mac-input.js; «Ekranni yozish» va «Maxsus imkoniyatlar» ruxsatlari kerak); sinovda — soxta ekran (COMPUTER_FAKE_SCREEN).
 * Desktopda element nomi ko'rinmaydi — xavfli amallar egasidan model orqali (confirm_with_owner) va ish boshida rejani tasdiqlatib so'raladi.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import type { MemberResult } from './browser';
import { pngSize, solidPng } from './png';

export const DESKTOP_MAX = { width: 1280, height: 800 };
const MAX_WAIT_S = 60, MAX_HOLD_S = 10;
const HELPER_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'helper');

/** Kompyuter a'zolari: zoom yoqilgan (mayda yozuvlar uchun); boshqalari — standart */
export const COMPUTER_TOOLSET: Anthropic.Beta.BetaComputerToolset20260801 = { type: 'computer_toolset_20260801' };

/** Haqiqiy ekran piksellarida ishlaydigan haydovchi */
export interface Driver {
  size(): Promise<{ width: number; height: number }>;
  /** Ekran (yoki uning qismi) — out o'lchamiga keltirilgan PNG */
  capture(region: { x: number; y: number; w: number; h: number }, out: { width: number; height: number }): Promise<Buffer>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number, button: 'left' | 'right' | 'middle', count: number, mods: string): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
  drag(x0: number, y0: number, x: number, y: number): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number, mods: string): Promise<void>;
  type(text: string): Promise<void>;
  key(combo: string, repeat: number): Promise<void>;
  hold(combo: string, ms: number): Promise<void>;
  cursor(): Promise<{ x: number; y: number }>;
  close(): void;
}

// ─── Windows ──────────────────────────────────────────────────────────────────

const compilers = (): string[] => {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  return [join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')];
};

/** Yordamchini yig'adi (manba o'zgarsa — qayta). Qaytaradi: .exe yo'li */
export async function ensureDeskExe(dir: string): Promise<string> {
  const source = join(HELPER_DIR, 'PalantirDesk.cs');
  const tag = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 12);
  const exe = join(dir, 'palantir-desk.exe'), stamp = join(dir, 'palantir-desk.version');
  if (existsSync(exe) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === tag) return exe;
  const csc = compilers().find(p => existsSync(p));
  if (!csc) throw new Error(".NET Framework 4 kompilyatori (csc.exe) topilmadi — kompyuter yordamchisini yig'ib bo'lmadi");
  mkdirSync(dir, { recursive: true });
  const tmp = `${exe}.tmp.exe`;
  await new Promise<void>((resolve, reject) => {
    execFile(csc, ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', `/out:${tmp}`, source], { windowsHide: true, timeout: 60_000 }, (err, stdout) => {
      if (err) reject(new Error(`Kompyuter yordamchisi yig'ilmadi: ${String(stdout || err.message).trim().slice(0, 300)}`));
      else resolve();
    });
  });
  renameSync(tmp, exe);
  writeFileSync(stamp, tag);
  return exe;
}

class WindowsDriver implements Driver {
  private queue: Promise<unknown> = Promise.resolve();
  private buf = '';
  private waiting: ((line: string) => void)[] = [];
  private constructor(private proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d: string) => {
      this.buf += d;
      for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line) this.waiting.shift()?.(line);
      }
    });
    proc.on('exit', () => { for (const w of this.waiting.splice(0)) w('{"ok":false,"error":"yordamchi to\'xtadi"}'); });
    // Ishga tushmasa (antivirus to'sdi) — server yiqilmasin
    proc.on('error', () => { for (const w of this.waiting.splice(0)) w('{"ok":false,"error":"yordamchi ishga tushmadi"}'); });
    proc.stderr.resume();
  }

  static async start(dir: string): Promise<WindowsDriver> {
    const exe = await ensureDeskExe(dir);
    return new WindowsDriver(spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  }

  private call<T = Record<string, unknown>>(cmd: Record<string, unknown>): Promise<T> {
    const next = this.queue.then(() => new Promise<T>((resolve, reject) => {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) return reject(new Error("yordamchi to'xtagan"));
      this.waiting.push(line => {
        // Javob «data» hodisasida keladi: buzuq qator serverni yiqitmasin
        let r: { ok: boolean; error?: string } & T;
        try { r = JSON.parse(line); } catch { return reject(new Error(`yordamchi tushunarsiz javob berdi: ${line.slice(0, 100)}`)); }
        if (r.ok) resolve(r); else reject(new Error(r.error || 'yordamchi xatosi'));
      });
      this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
    }));
    this.queue = next.catch(() => {});
    return next;
  }

  async size() { const r = await this.call<{ w: number; h: number }>({ cmd: 'size' }); return { width: r.w, height: r.h }; }
  async capture(g: { x: number; y: number; w: number; h: number }, out: { width: number; height: number }) {
    const r = await this.call<{ png: string }>({ cmd: 'capture', x: g.x, y: g.y, cw: g.w, ch: g.h, outW: out.width, outH: out.height });
    return Buffer.from(r.png, 'base64');
  }
  async move(x: number, y: number) { await this.call({ cmd: 'move', x, y }); }
  async click(x: number, y: number, button: string, count: number, mods: string) { await this.call({ cmd: 'click', x, y, button, count, mods }); }
  async down() { await this.call({ cmd: 'down' }); }
  async up() { await this.call({ cmd: 'up' }); }
  async drag(x0: number, y0: number, x: number, y: number) {
    await this.call({ cmd: 'move', x: x0, y: y0 });
    await this.call({ cmd: 'down' });
    for (let i = 1; i <= 12; i++) await this.call({ cmd: 'move', x: Math.round(x0 + (x - x0) * i / 12), y: Math.round(y0 + (y - y0) * i / 12) });
    await this.call({ cmd: 'up' });
  }
  async scroll(x: number, y: number, dx: number, dy: number, mods: string) { await this.call({ cmd: 'scroll', x, y, dx, dy, mods }); }
  async type(text: string) { await this.call({ cmd: 'type', text }); }
  async key(combo: string, repeat: number) { await this.call({ cmd: 'key', combo, repeat }); }
  async hold(combo: string, ms: number) { await this.call({ cmd: 'hold', combo, ms }); }
  async cursor() { return this.call<{ x: number; y: number }>({ cmd: 'cursor' }); }
  close() { try { this.proc.stdin.end(); this.proc.kill(); } catch { /* allaqachon to'xtagan */ } }
}

// ─── macOS ────────────────────────────────────────────────────────────────────

const run = (cmd: string, args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(cmd, args, { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(stdout)));
});

class MacDriver implements Driver {
  /** Ekran piksellari / nuqtalar (Retina'da 2) — sichqoncha nuqtalarda ishlaydi */
  private constructor(private scale: number, private px: { width: number; height: number }, private tmp: string) {}

  static async start(): Promise<MacDriver> {
    const tmp = join(tmpdir(), `palantir-ekran-${process.pid}.png`);
    const allow = (what: string) => `«Tizim sozlamalari → Maxfiylik va xavfsizlik → ${what}» ro'yxatiga Palantir'ni ishga tushirgan dasturni (Terminal yoki node) qo'shing va Palantir'ni qayta ishga tushiring`;
    const px = await run('screencapture', ['-x', '-m', '-t', 'png', tmp]).then(() => pngSize(readFileSync(tmp)), () => null);
    if (!px) throw new Error(`Ekran rasmi olinmadi: ${allow('Ekranni yozib olish')}`);
    const pts = JSON.parse(await MacDriver.input({ cmd: 'points' })) as { w: number; trusted: boolean };
    if (!pts.trusted) throw new Error(`Sichqoncha va klaviaturaga ruxsat yo'q: ${allow('Maxsus imkoniyatlar')}`);
    return new MacDriver(px.width / pts.w, px, tmp);
  }

  private static input(cmd: Record<string, unknown>): Promise<string> {
    return run('osascript', ['-l', 'JavaScript', join(HELPER_DIR, 'mac-input.js'), JSON.stringify(cmd)]);
  }
  private async send(cmd: Record<string, unknown>) {
    const r = JSON.parse(await MacDriver.input(cmd)) as { ok: boolean; error?: string };
    if (!r.ok) throw new Error(r.error || 'yordamchi xatosi');
    return r;
  }
  private pt = (v: number) => v / this.scale;

  async size() { return this.px; }
  async capture(g: { x: number; y: number; w: number; h: number }, out: { width: number; height: number }) {
    const whole = g.x === 0 && g.y === 0 && g.w === this.px.width && g.h === this.px.height;
    const args = ['-x', '-m', '-t', 'png', ...(whole ? [] : ['-R', [g.x, g.y, g.w, g.h].map(v => Math.round(this.pt(v))).join(',')]), this.tmp];
    await run('screencapture', args);
    await run('sips', ['--resampleHeightWidth', String(out.height), String(out.width), this.tmp]);
    return readFileSync(this.tmp);
  }
  async move(x: number, y: number) { await this.send({ cmd: 'move', x: this.pt(x), y: this.pt(y) }); }
  async click(x: number, y: number, button: string, count: number, mods: string) { await this.send({ cmd: 'click', x: this.pt(x), y: this.pt(y), button, count, mods }); }
  async down() { await this.send({ cmd: 'down' }); }
  async up() { await this.send({ cmd: 'up' }); }
  async drag(x0: number, y0: number, x: number, y: number) { await this.send({ cmd: 'drag', x0: this.pt(x0), y0: this.pt(y0), x: this.pt(x), y: this.pt(y) }); }
  async scroll(x: number, y: number, dx: number, dy: number, mods: string) { await this.send({ cmd: 'scroll', x: this.pt(x), y: this.pt(y), dx, dy, mods }); }
  async type(text: string) { await this.send({ cmd: 'type', text }); }
  async key(combo: string, repeat: number) { await this.send({ cmd: 'key', combo, repeat }); }
  async hold(combo: string, ms: number) { await this.send({ cmd: 'hold', combo, ms }); }
  async cursor() { const r = JSON.parse(await MacDriver.input({ cmd: 'cursor' })) as { x: number; y: number }; return { x: r.x * this.scale, y: r.y * this.scale }; }
  close() { rmSync(this.tmp, { force: true }); }
}

// ─── Sinov: soxta ekran ───────────────────────────────────────────────────────

/** Ekran o'rniga: o'lchami beriladi, har amal faylga yoziladi (sinov tekshiradi) */
export class FakeDriver implements Driver {
  private pos = { x: 0, y: 0 };
  constructor(private px: { width: number; height: number }, private log: string) {}
  private note(entry: Record<string, unknown>) { if (this.log) appendFileSync(this.log, `${JSON.stringify(entry)}\n`); }
  async size() { return this.px; }
  async capture(g: { x: number; y: number; w: number; h: number }, out: { width: number; height: number }) {
    this.note({ cmd: 'capture', ...g, ...out });
    return solidPng(out.width, out.height, [235, 238, 245], { x: Math.round(out.width / 2) - 20, y: Math.round(out.height / 2) - 10, w: 40, h: 20, rgb: [40, 90, 200] });
  }
  async move(x: number, y: number) { this.pos = { x, y }; this.note({ cmd: 'move', x, y }); }
  async click(x: number, y: number, button: string, count: number, mods: string) { this.pos = { x, y }; this.note({ cmd: 'click', x, y, button, count, mods }); }
  async down() { this.note({ cmd: 'down' }); }
  async up() { this.note({ cmd: 'up' }); }
  async drag(x0: number, y0: number, x: number, y: number) { this.pos = { x, y }; this.note({ cmd: 'drag', x0, y0, x, y }); }
  async scroll(x: number, y: number, dx: number, dy: number, mods: string) { this.note({ cmd: 'scroll', x, y, dx, dy, mods }); }
  async type(text: string) { this.note({ cmd: 'type', text }); }
  async key(combo: string, repeat: number) { this.note({ cmd: 'key', combo, repeat }); }
  async hold(combo: string, ms: number) { this.note({ cmd: 'hold', combo, ms }); }
  async cursor() { return this.pos; }
  close() { /* yo'q */ }
}

/** Shu kompyuter uchun haydovchi */
export async function startDriver(workDir: string, fake: string, fakeLog: string): Promise<Driver> {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(fake);
  if (m) return new FakeDriver({ width: Number(m[1]), height: Number(m[2]) }, fakeLog);
  if (process.platform === 'win32') return WindowsDriver.start(workDir);
  if (process.platform === 'darwin') return MacDriver.start();
  throw new Error('Butun kompyuterda ishlash hozircha faqat Windows va macOS da (bu kompyuterda — brauzer rejimi ishlaydi)');
}

// ─── A'zolar ──────────────────────────────────────────────────────────────────

const ok = (t = 'OK'): MemberResult => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): MemberResult => ({ content: [{ type: 'text', text: t }], isError: true });
const image = (png: Buffer): MemberResult => ({ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }] });
const point = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(Number(n))) ? [Number(v[0]), Number(v[1])] : null);
/** Kompyuterni bloklaydigan yoki tizimdan chiqaradigan tugmalar — AI bosmaydi */
const FORBIDDEN_KEYS = /ctrl\+alt\+(del|delete)|^(super|win|cmd)\+l$|cmd\+ctrl\+q/i;

export class DesktopSession {
  private constructor(private d: Driver, private px: { width: number; height: number }, readonly view: { width: number; height: number }) {}

  static async open(driver: Driver): Promise<DesktopSession> {
    const px = await driver.size();
    const k = Math.min(1, DESKTOP_MAX.width / px.width, DESKTOP_MAX.height / px.height);
    return new DesktopSession(driver, px, { width: Math.round(px.width * k), height: Math.round(px.height * k) });
  }

  /** Claude koordinatasi (kichraytirilgan rasm) → haqiqiy ekran pikseli */
  real(x: number, y: number): { x: number; y: number } {
    const kx = this.px.width / this.view.width, ky = this.px.height / this.view.height;
    return { x: Math.round(Math.min(this.view.width - 1, Math.max(0, x)) * kx), y: Math.round(Math.min(this.view.height - 1, Math.max(0, y)) * ky) };
  }

  async run(name: string, input: Record<string, unknown>): Promise<MemberResult> {
    try {
      return await this.member(name, input);
    } catch (e) {
      return fail(`Bajarilmadi: ${(e as Error).message.split('\n')[0].slice(0, 300)}`);
    }
  }

  private async member(name: string, i: Record<string, unknown>): Promise<MemberResult> {
    const mods = typeof i.text === 'string' && ['left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag', 'scroll'].includes(name) ? i.text : '';
    switch (name) {
      case 'screenshot':
        return image(await this.d.capture({ x: 0, y: 0, w: this.px.width, h: this.px.height }, this.view));
      case 'zoom': {
        const r = Array.isArray(i.region) ? (i.region as number[]).map(Number) : [];
        if (r.length !== 4 || r[2] <= r[0] || r[3] <= r[1]) return fail('region: [x0, y0, x1, y1] bo\'lishi kerak');
        const a = this.real(r[0], r[1]), b = this.real(r[2], r[3]);
        const w = Math.max(1, b.x - a.x), h = Math.max(1, b.y - a.y);
        const k = Math.min(DESKTOP_MAX.width / w, DESKTOP_MAX.height / h, 4);
        return image(await this.d.capture({ x: a.x, y: a.y, w, h }, { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }));
      }
      case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click': {
        const c = point(i.coordinate);
        const at = c ? this.real(c[0], c[1]) : await this.d.cursor();
        const button = name === 'right_click' ? 'right' : name === 'middle_click' ? 'middle' : 'left';
        await this.d.click(at.x, at.y, button, name === 'double_click' ? 2 : name === 'triple_click' ? 3 : 1, mods);
        return ok();
      }
      case 'mouse_move': {
        const c = point(i.coordinate);
        if (!c) return fail('coordinate: [x, y] kerak');
        const at = this.real(c[0], c[1]);
        await this.d.move(at.x, at.y);
        return ok();
      }
      case 'left_click_drag': {
        const s = point(i.start_coordinate), e = point(i.coordinate);
        if (!s || !e) return fail('start_coordinate va coordinate kerak');
        const a = this.real(s[0], s[1]), b = this.real(e[0], e[1]);
        await this.d.drag(a.x, a.y, b.x, b.y);
        return ok();
      }
      case 'left_mouse_down': await this.d.down(); return ok();
      case 'left_mouse_up': await this.d.up(); return ok();
      case 'cursor_position': {
        const p = await this.d.cursor();
        const x = Math.round(p.x * this.view.width / this.px.width), y = Math.round(p.y * this.view.height / this.px.height);
        return ok(`X=${x},Y=${y}`);
      }
      case 'scroll': {
        const c = point(i.coordinate);
        const at = c ? this.real(c[0], c[1]) : await this.d.cursor();
        const n = Math.max(1, Math.min(20, Math.round(Number(i.scroll_amount) || 3)));
        const dir = String(i.scroll_direction);
        await this.d.scroll(at.x, at.y, dir === 'left' ? -n : dir === 'right' ? n : 0, dir === 'up' ? -n : dir === 'down' ? n : 0, mods);
        return ok();
      }
      case 'type': {
        const t = String(i.text ?? '');
        if (t.length > 5000) return fail('Matn juda uzun (5000 belgidan ko\'p) — bo\'lib yozing');
        await this.d.type(t);
        return ok();
      }
      case 'key': {
        const combo = String(i.text ?? '').trim();
        if (!combo) return fail('text: tugma kerak');
        if (FORBIDDEN_KEYS.test(combo)) return fail(`«${combo}» — kompyuterni bloklaydigan yoki o'chiradigan tugma, bosilmaydi`);
        await this.d.key(combo, Math.max(1, Math.min(100, Number(i.repeat) || 1)));
        return ok();
      }
      case 'hold_key': {
        const combo = String(i.text ?? '').trim();
        if (FORBIDDEN_KEYS.test(combo)) return fail(`«${combo}» bosilmaydi`);
        await this.d.hold(combo, Math.max(0, Math.min(MAX_HOLD_S, Number(i.duration) || 0)) * 1000);
        return ok();
      }
      case 'wait':
        await new Promise(r => setTimeout(r, Math.max(0, Math.min(MAX_WAIT_S, Number(i.duration) || 0)) * 1000));
        return ok();
      default:
        return fail(`Bu a'zo yo'q: ${name}`);
    }
  }

  close(): void { this.d.close(); }
}
