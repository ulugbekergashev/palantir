/**
 * Palantir kengaytmasi (extension/) bilan ko'prik: egasining Chrome'ini masofaviy debugging portisiz va «Allow?» so'rovisiz boshqarish.
 *   /api/ext            — kengaytma ulanadi (faqat shu kompyuterdan va faqat Palantir kengaytmasining Origin'i bilan)
 *   /api/ext/cdp/<sir>  — Playwright (connectOverCDP) ulanadi: bu yerda brauzer darajasidagi CDP «taqlid» qilinadi, vkladka buyruqlari
 *                         kengaytmadagi chrome.debugger ga uzatiladi. Playwright faqat Palantir o'zi ochgan vkladkalarni ko'radi.
 * Tarjima qatlami Microsoft Playwright'ning CDP relay'idan olingan (Apache-2.0, packages/playwright-core/src/tools/mcp/browserModel.ts).
 * Avvalgi yo'l (Chrome'ning DevToolsActivePort'i) har ulanishda «Allow?» so'rardi va Playwright egasining hamma vkladkalariga ulanardi (2026-11-19).
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/** extension/manifest.json dagi «key» dan kelib chiqadigan doimiy ID */
export const EXTENSION_ID = 'beohfbpjkgnlbhpbbinpielchmhmodfd';
const EXT_PATH = '/api/ext';
const CDP_PATH = `/api/ext/cdp/${randomUUID()}`;
const COMMAND_TIMEOUT_MS = 60_000;
/** Kengaytmaning service worker'i uxlab qolmasin (Chrome 30 soniya jimlikdan keyin to'xtatadi) */
const PING_MS = 20_000;

type Json = Record<string, unknown>;
interface CdpMessage { id?: number; sessionId?: string; method?: string; params?: Json; result?: unknown; error?: { message: string } }
interface DebuggerTarget { tabId?: number; sessionId?: string }
interface TabSession { tabId: number; sessionId: string; targetInfo: Json | undefined; children: Set<string> }

const isLoopback = (a: string | undefined) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

/** Kengaytma bilan so'rov-javob kanali */
class Extension {
  private next = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private ping: NodeJS.Timeout;
  version = '';

  constructor(private ws: WebSocket, private onEvent: (method: string, params: unknown[]) => void, onClose: () => void) {
    ws.on('message', data => this.onMessage(data));
    ws.on('close', () => { clearInterval(this.ping); this.fail('Kengaytma uzildi'); onClose(); });
    ws.on('error', () => {});
    this.ping = setInterval(() => { void this.send('ping', []).catch(() => {}); }, PING_MS);
  }

  get open(): boolean { return this.ws.readyState === WebSocket.OPEN; }

  send<T = unknown>(method: string, params: unknown[]): Promise<T> {
    if (!this.open) return Promise.reject(new Error("Palantir kengaytmasi ulanmagan"));
    const id = ++this.next;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`Kengaytma javob bermadi: ${method}`)); }, COMMAND_TIMEOUT_MS);
      this.waiting.set(id, { resolve: v => resolve(v as T), reject, timer });
    });
  }

  close(reason: string): void { if (this.open) this.ws.close(1000, reason); }

  private onMessage(data: RawData): void {
    let msg: { id?: number; method?: string; params?: unknown[]; result?: unknown; error?: string };
    try { msg = JSON.parse(data.toString()); } catch { return; }
    // Buzuq xabar (null, raqam) server jarayonini yiqitmasin
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.id !== 'number') {
      try {
        if (msg.method === 'extension.hello') this.version = String((msg.params?.[0] as Json | undefined)?.version ?? '').slice(0, 20);
        else if (typeof msg.method === 'string') this.onEvent(msg.method, Array.isArray(msg.params) ? msg.params : []);
      } catch (e) {
        console.error('[kengaytma] hodisani qayta ishlab bo\'lmadi:', (e as Error).message);
      }
      return;
    }
    const w = this.waiting.get(msg.id);
    if (!w) return;
    this.waiting.delete(msg.id);
    clearTimeout(w.timer);
    if (msg.error) w.reject(new Error(msg.error)); else w.resolve(msg.result);
  }

  private fail(reason: string): void {
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error(reason)); }
    this.waiting.clear();
  }
}

/** Bitta Playwright ulanishi: kengaytma orqali ko'rinadigan «brauzer» (faqat Palantir'ning vkladkalari) */
class CdpSession {
  private tabs = new Map<number, TabSession>();
  private autoAttach = false;
  private nextSession = 1;

  constructor(private ext: Extension, private client: WebSocket) {
    client.on('message', data => { void this.onClientMessage(data); });
    client.on('error', () => {});
  }

  /** Ish tugadi: vkladkalardan debugger uziladi, vkladkalarning o'zi egasida ochiq qoladi */
  async end(): Promise<void> {
    this.tabs.clear();
    await this.ext.send('session.end', []).catch(() => {});
  }

  closeClient(reason: string): void { if (this.client.readyState === WebSocket.OPEN) this.client.close(1000, reason); }

  private toClient(m: CdpMessage): void { if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(m)); }

  private async onClientMessage(data: RawData): Promise<void> {
    let m: CdpMessage;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.id !== 'number' || typeof m.method !== 'string') return;
    try {
      this.toClient({ id: m.id, sessionId: m.sessionId, result: await this.command(m.method, m.params ?? {}, m.sessionId) ?? {} });
    } catch (e) {
      this.toClient({ id: m.id, sessionId: m.sessionId, error: { message: (e as Error).message } });
    }
  }

  private async command(method: string, params: Json, sessionId: string | undefined): Promise<unknown> {
    switch (method) {
      case 'Browser.getVersion':
        return { protocolVersion: '1.3', product: 'Chrome/Palantir-Extension', userAgent: 'Palantir-Extension', jsVersion: '' };
      case 'Browser.setDownloadBehavior':
        return {};
      case 'Target.setAutoAttach':
        if (sessionId) break;
        this.autoAttach = true;
        return {};
      case 'Target.setDiscoverTargets':
        if (!sessionId) return {};
        break;
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] };
      case 'Target.createTarget':
        return this.createTarget(typeof params.url === 'string' ? params.url : undefined);
      case 'Target.closeTarget': {
        const s = this.find(t => t.targetInfo?.targetId === params.targetId);
        if (!s) return { success: false };
        await this.ext.send('chrome.tabs.remove', [s.tabId]);
        return { success: true };
      }
      case 'Target.getTargetInfo':
        return sessionId ? { targetInfo: this.find(t => t.sessionId === sessionId)?.targetInfo } : { targetInfo: { targetId: 'browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } };
    }
    return this.ext.send('chrome.debugger.sendCommand', [this.target(method, sessionId), method, params]);
  }

  private async createTarget(url: string | undefined): Promise<{ targetId: unknown }> {
    const tab = await this.ext.send<{ id?: number }>('chrome.tabs.create', [{ url: url || 'about:blank', active: true }]);
    if (typeof tab?.id !== 'number') throw new Error("Vkladka ochilmadi");
    const s = await this.attach(tab.id);
    return { targetId: s.targetInfo?.targetId };
  }

  private target(method: string, sessionId: string | undefined): DebuggerTarget {
    if (!sessionId) {
      const first = this.tabs.values().next().value;
      if (!first) throw new Error(`Vkladka yo'q (${method})`);
      return { tabId: first.tabId };
    }
    const own = this.find(t => t.sessionId === sessionId);
    if (own) return { tabId: own.tabId };
    const parent = this.find(t => t.children.has(sessionId));
    if (parent) return { tabId: parent.tabId, sessionId };
    throw new Error(`Sessiya topilmadi: ${sessionId}`);
  }

  private async attach(tabId: number): Promise<TabSession> {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    await this.ext.send('chrome.debugger.attach', [{ tabId }, '1.3']);
    const info = await this.ext.send<{ targetInfo?: Json }>('chrome.debugger.sendCommand', [{ tabId }, 'Target.getTargetInfo', {}]);
    const s: TabSession = { tabId, sessionId: `pal-tab-${this.nextSession++}`, targetInfo: info?.targetInfo, children: new Set() };
    this.tabs.set(tabId, s);
    this.toClient({ method: 'Target.attachedToTarget', params: { sessionId: s.sessionId, targetInfo: { ...s.targetInfo, attached: true }, waitingForDebugger: false } });
    return s;
  }

  private detach(tabId: number): void {
    const s = this.tabs.get(tabId);
    if (!s) return;
    this.tabs.delete(tabId);
    this.toClient({ method: 'Target.detachedFromTarget', params: { sessionId: s.sessionId, targetId: s.targetInfo?.targetId } });
  }

  onExtensionEvent(method: string, params: unknown[]): void {
    switch (method) {
      case 'chrome.tabs.onCreated': {
        const tab = params[0] as { id?: number } | undefined;
        if (typeof tab?.id === 'number' && this.autoAttach) void this.attach(tab.id).catch(() => {});
        return;
      }
      case 'chrome.tabs.onRemoved':
        this.detach(params[0] as number);
        return;
      case 'chrome.debugger.onDetach': {
        const src = params[0] as DebuggerTarget | undefined;
        if (typeof src?.tabId === 'number') this.detach(src.tabId);
        return;
      }
      case 'chrome.debugger.onEvent': {
        const [src, evMethod, evParams] = params as [DebuggerTarget, string, Json | undefined];
        const s = typeof src?.tabId === 'number' ? this.tabs.get(src.tabId) : undefined;
        if (!s) return;
        const child = evParams?.sessionId as string | undefined;
        if (evMethod === 'Target.attachedToTarget' && child) s.children.add(child);
        else if (evMethod === 'Target.detachedFromTarget' && child) s.children.delete(child);
        this.toClient({ sessionId: src.sessionId || s.sessionId, method: evMethod, params: evParams });
      }
    }
  }

  private find(pred: (s: TabSession) => boolean): TabSession | undefined {
    for (const s of this.tabs.values()) if (pred(s)) return s;
    return undefined;
  }
}

let ext: Extension | null = null;
let session: CdpSession | null = null;
let listenPort = 0;

/** Kengaytma hozir ulanganmi (Chrome ochiq va kengaytma o'rnatilgan) */
export const extensionState = (): { connected: boolean; version: string } => ({ connected: !!ext?.open, version: ext?.open ? ext.version : '' });

/** Playwright uchun manzil — kengaytma ulangan bo'lsa */
export const extensionCdpUrl = (): string | null => (ext?.open && listenPort ? `ws://127.0.0.1:${listenPort}${CDP_PATH}` : null);

function onExtension(ws: WebSocket): void {
  // Bitta kengaytma: ikkinchisi (masalan, boshqa Chrome profili) rad etiladi — aks holda ikkalasi bir-birini almashtirib turardi
  // va ishlayotgan ish uzilgan ulanishda qolardi. Birinchisi uzilsa (Chrome yopildi) — ikkinchisi keyingi urinishda ulanadi
  if (ext?.open) { ws.close(1000, 'Boshqa Chrome allaqachon ulangan'); return; }
  const me = new Extension(ws, (method, params) => session?.onExtensionEvent(method, params), () => {
    if (ext !== me) return;
    ext = null;
    session?.closeClient('Kengaytma uzildi');
  });
  ext = me;
}

function onPlaywright(ws: WebSocket): void {
  if (!ext?.open) { ws.close(1000, 'Kengaytma ulanmagan'); return; }
  if (session) { ws.close(1000, 'Boshqa ulanish ishlayapti'); return; }
  const me = new CdpSession(ext, ws);
  session = me;
  ws.on('close', () => { if (session === me) session = null; void me.end(); });
}

/** HTTP serverga ulanadi (main.ts): faqat /api/ext yo'llari; qolgan upgrade so'rovlariga tegmaydi */
export function attachExtensionRelay(server: Server, port: number): void {
  listenPort = port;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== EXT_PATH && path !== CDP_PATH) {
      if (path.startsWith(EXT_PATH)) socket.destroy();
      return;
    }
    // Faqat shu kompyuterdan; kengaytma yo'li — faqat Palantir kengaytmasidan (sayt Origin'ni soxtalashtira olmaydi)
    const okOrigin = path === CDP_PATH ? !req.headers.origin : req.headers.origin === `chrome-extension://${EXTENSION_ID}`;
    // Tunnel/proksi (ngrok, cloudflared, nginx) orqali kelgan so'rov ham 127.0.0.1 dan ko'rinadi — u «shu kompyuter» emas (http.ts fromThisPc kabi)
    const h = req.headers;
    const proxied = !!(h['x-forwarded-for'] || h.forwarded || h['x-real-ip'] || h['cf-connecting-ip']);
    if (!isLoopback(req.socket.remoteAddress) || proxied || !okOrigin) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => (path === EXT_PATH ? onExtension(ws) : onPlaywright(ws)));
  });
}

/** Faqat sinov uchun (scripts/check-extension.ts): kengaytmaga xom buyruq — uning o'z himoyasini tekshirish */
export const extensionCommandForTest = (method: string, params: unknown[]): Promise<unknown> =>
  ext?.open ? ext.send(method, params) : Promise.reject(new Error('Kengaytma ulanmagan'));
