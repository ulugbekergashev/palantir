/**
 * Palantir kengaytmasi: shu kompyuterdagi Palantir (ws://127.0.0.1:3200/api/ext) bilan doimiy aloqa. Palantir egasining Chrome'ida
 * ishlaganda brauzerni shu kengaytma orqali boshqaradi — Chrome «Allow remote debugging?» so'ramaydi, egasining boshqa vkladkalari
 * Palantir'ga umuman ko'rinmaydi: buyruqlar faqat Palantir o'zi ochgan vkladkalarga (va ulardan ochilgan oynalarga) bajariladi.
 *
 * Tuzilish Microsoft Playwright'ning «Playwright Extension» ko'prigidan olingan (Apache-2.0,
 * https://github.com/microsoft/playwright/tree/main/packages/extension): xabarlar chrome.* chaqiruvlari bilan bir xil shaklda.
 *   Palantir → kengaytma: { id, method, params[] } — chrome.debugger.attach/detach/sendCommand, chrome.tabs.create/remove, session.end, ping
 *   kengaytma → Palantir: { id, result } | { id, error } va hodisalar { method, params[] } (chrome.debugger.onEvent/onDetach, chrome.tabs.onCreated/onRemoved)
 */
const PALANTIR_URLS = ['ws://127.0.0.1:3200/api/ext', 'ws://[::1]:3200/api/ext'];
const RECONNECT_MAX_MS = 15_000;
const VERSION = chrome.runtime.getManifest().version;

/** Brauzer holatini o'zgartiradigan (vkladkaga emas) CDP buyruqlari — Palantir ularni yubormaydi, yuborsa ham bajarilmaydi */
const BLOCKED_METHODS = new Set([
  'Storage.setCookies', 'Storage.clearCookies', 'Storage.clearDataForOrigin', 'Network.clearBrowserCookies', 'Network.clearBrowserCache',
  'Browser.grantPermissions', 'Browser.resetPermissions', 'Browser.setPermission', 'Browser.setDownloadBehavior', 'Browser.close', 'Browser.crash',
  'Target.createTarget', 'Target.closeTarget', 'Target.attachToTarget', 'Target.activateTarget', 'Target.createBrowserContext', 'Target.disposeBrowserContext',
  'SystemInfo.getProcessInfo',
]);

let socket = null;
let retryMs = 1_000;
let connecting = false;
/** Palantir'ning vkladkalari (faqat shularga buyruq bajariladi) va debugger ulangan vkladkalar */
const owned = new Set();
const attached = new Set();

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
const emit = (method, params) => send({ method, params });

function badge(on) {
  chrome.action.setBadgeText({ text: on ? '✓' : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#1f9d55' }).catch(() => {});
  chrome.action.setTitle({ title: on ? 'Palantir: ulangan' : "Palantir: ulanmagan (Palantir shu kompyuterda ishlab turibdimi?)" }).catch(() => {});
}

function ownTab(target) {
  const tabId = target?.tabId;
  if (typeof tabId !== 'number' || !owned.has(tabId)) throw new Error('Bu vkladka Palantirniki emas');
  if (target.extensionId || target.targetId) throw new Error('Faqat vkladka');
  return tabId;
}

/** Ish tugadi: Palantir'ning vkladkalaridan debugger uziladi (Chrome'dagi «debugging» paneli yo'qoladi), vkladkalarning o'zi ochiq qoladi */
async function endSession() {
  const ids = [...attached];
  attached.clear();
  owned.clear();
  await Promise.all(ids.map(tabId => chrome.debugger.detach({ tabId }).catch(() => {})));
}

const handlers = {
  'chrome.debugger.attach': async ([target, version]) => {
    const tabId = ownTab(target);
    if (attached.has(tabId)) return {};
    await chrome.debugger.attach({ tabId }, version || '1.3');
    attached.add(tabId);
    return {};
  },
  'chrome.debugger.detach': async ([target]) => {
    const tabId = ownTab(target);
    attached.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    return {};
  },
  'chrome.debugger.sendCommand': async ([target, method, params]) => {
    const tabId = ownTab(target);
    if (BLOCKED_METHODS.has(method)) throw new Error(`${method} — ruxsat yo'q (brauzer holatini o'zgartiradi)`);
    const t = target.sessionId ? { tabId, sessionId: target.sessionId } : { tabId };
    return await chrome.debugger.sendCommand(t, method, params);
  },
  'chrome.tabs.create': async ([props]) => {
    const tab = await chrome.tabs.create({ url: props?.url || 'about:blank', active: props?.active !== false });
    owned.add(tab.id);
    return tab;
  },
  'chrome.tabs.remove': async ([tabIds]) => {
    const ids = (Array.isArray(tabIds) ? tabIds : [tabIds]).filter(id => owned.has(id));
    if (ids.length) await chrome.tabs.remove(ids);
    return {};
  },
  'session.end': async () => { await endSession(); return {}; },
  ping: async () => ({ pong: Date.now() }),
};

async function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (!msg || typeof msg.id !== 'number' || typeof msg.method !== 'string') return;
  const handler = Object.hasOwn(handlers, msg.method) ? handlers[msg.method] : null;
  try {
    if (!handler) throw new Error(`Noma'lum buyruq: ${msg.method}`);
    send({ id: msg.id, result: await handler(Array.isArray(msg.params) ? msg.params : []) });
  } catch (e) {
    send({ id: msg.id, error: String(e?.message ?? e) });
  }
}

function connect(i = 0) {
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  let ws;
  try { ws = new WebSocket(PALANTIR_URLS[i % PALANTIR_URLS.length]); } catch { connecting = false; return schedule(i + 1); }
  const timer = setTimeout(() => ws.close(), 5_000);
  ws.onopen = () => {
    clearTimeout(timer);
    connecting = false;
    socket = ws;
    retryMs = 1_000;
    badge(true);
    emit('extension.hello', [{ version: VERSION, userAgent: navigator.userAgent }]);
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    clearTimeout(timer);
    connecting = false;
    if (socket === ws) {
      socket = null;
      badge(false);
      void endSession();
    }
    schedule(i + 1);
  };
  ws.onerror = () => {};
}

function schedule(i) {
  setTimeout(() => connect(i), retryMs);
  retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined && attached.has(source.tabId)) emit('chrome.debugger.onEvent', [source, method, params]);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined || !attached.has(source.tabId)) return;
  attached.delete(source.tabId);
  emit('chrome.debugger.onDetach', [source, reason]);
});
// Palantir'ning vkladkasidan ochilgan yangi oyna (target=_blank, popup) — ham uniki
chrome.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId !== undefined && owned.has(tab.openerTabId)) {
    owned.add(tab.id);
    emit('chrome.tabs.onCreated', [tab]);
  }
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (!owned.has(tabId)) return;
  owned.delete(tabId);
  attached.delete(tabId);
  emit('chrome.tabs.onRemoved', [tabId, info]);
});

// Service worker uxlab qolsa ham aloqa tiklanadi: har 30 soniyada uyg'otib tekshiradi
chrome.alarms.create('palantir-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());
// Oldingi service worker qoldirgan debugger ulanishlari (u to'satdan to'xtagan bo'lsa) — uziladi, aks holda «debugging» paneli osilib qoladi
chrome.debugger.getTargets().then(ts => Promise.all(ts.filter(t => t.attached && t.tabId !== undefined)
  .map(t => chrome.debugger.detach({ tabId: t.tabId }).catch(() => {})))).catch(() => {});
badge(false);
connect();
