/**
 * Cerebro Hub — rasmiy Instagram (Meta) bilan klinikalar orasidagi kichik bulut xizmati. Meta'ga bitta ilova va bitta ochiq HTTPS manzil
 * kerak; klinika kompyuterlari esa internetga port ochmaydi. Hub:
 *
 *   1. OAuth: klinika «Instagram'ni ulash» bosadi → hub imzolagan havola → instagram.com'da egasi kiradi va ruxsat beradi →
 *      /ig/callback → kod tokenga almashtiriladi (ilova siri faqat hubda) → 60 kunlik token klinikaga navbat orqali beriladi
 *      (hubda saqlanmaydi: klinika olgach o'chadi).
 *   2. Webhook: Meta xabarni /ig/webhook ga yuboradi (X-Hub-Signature-256 tekshiriladi) → Instagram akkaunti bo'yicha klinika
 *      navbatiga qo'yiladi.
 *   3. Navbat: klinika /api/pull ga uzun so'rov bilan ulanib turadi (25 soniyagacha kutadi) — chiquvchi so'rov, port ochish shart emas.
 *      Klinika oflayn bo'lsa xabarlar 3 kun saqlanadi.
 *
 * Javobni klinika o'zi yuboradi: graph.instagram.com'ga o'z tokeni bilan (hub orqali emas).
 *
 * Sozlama (muhit o'zgaruvchilari): IG_APP_ID, IG_APP_SECRET, HUB_PUBLIC_URL, HUB_VERIFY_TOKEN, HUB_ADMIN_KEY, PORT, HUB_DB.
 * Ishga tushirish: npm run hub
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const cfg = {
  port: Number(process.env.PORT) || 3400,
  db: resolve(process.env.HUB_DB || 'hub-data/hub.db'),
  appId: process.env.IG_APP_ID || '',
  appSecret: process.env.IG_APP_SECRET || '',
  publicUrl: (process.env.HUB_PUBLIC_URL || '').replace(/\/+$/, ''),
  verifyToken: process.env.HUB_VERIFY_TOKEN || '',
  adminKey: process.env.HUB_ADMIN_KEY || '',
  // Faqat sinov uchun: soxta Instagram
  authUrl: process.env.IG_AUTH_URL || 'https://www.instagram.com/oauth/authorize',
  tokenUrl: process.env.IG_TOKEN_URL || 'https://api.instagram.com/oauth/access_token',
  graphUrl: (process.env.IG_GRAPH_URL || 'https://graph.instagram.com').replace(/\/+$/, ''),
  graphVersion: process.env.IG_GRAPH_VERSION || 'v25.0',
};
const SCOPES = 'instagram_business_basic,instagram_business_manage_messages';
const STATE_TTL_MS = 3_600_000;
const PULL_WAIT_MS = 25_000;
const KEEP_EVENTS_MS = 3 * 86_400_000;
const MAX_BODY = 1024 * 1024;
const MAX_EVENTS_PER_PULL = 100;

mkdirSync(dirname(cfg.db), { recursive: true });
const db = new DatabaseSync(cfg.db);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS clinics (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT);
CREATE TABLE IF NOT EXISTS accounts (ig_user_id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, business_id TEXT NOT NULL, username TEXT, connected_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, clinic_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_clinic ON events (clinic_id, seq);
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);

/** OAuth holatini imzolash kaliti: birinchi ishga tushishda yaratiladi va bazada qoladi */
const stateSecret = ((): string => {
  const row = db.prepare("SELECT value FROM meta WHERE name = 'state_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const v = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO meta (name, value) VALUES ('state_secret', ?)").run(v);
  return v;
})();

const now = () => new Date().toISOString();
/** Klinika ulanish kodi — ko'rinishi src/lib/hubCode.ts dagi bilan bir xil (hub alohida joylanadi, shuning uchun nusxa) */
const makeHubCode = (url: string, clinicId: string, secret: string) => `chub.${Buffer.from(url.replace(/\/+$/, '')).toString('base64url')}.${clinicId}.${secret}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const newId = () => randomBytes(5).toString('hex');

// ─── Navbat ──────────────────────────────────────────────────────────────────

const waiters = new Map<string, Set<() => void>>();
function enqueue(clinicId: string, kind: string, payload: unknown): void {
  db.prepare('INSERT INTO events (clinic_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(clinicId, kind, JSON.stringify(payload), now());
  for (const wake of waiters.get(clinicId) ?? []) wake();
}
const pending = (clinicId: string, after: number) =>
  (db.prepare('SELECT seq, kind, payload FROM events WHERE clinic_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(clinicId, after, MAX_EVENTS_PER_PULL) as { seq: number; kind: string; payload: string }[])
    .map(e => ({ seq: e.seq, kind: e.kind, payload: JSON.parse(e.payload) as unknown }));
setInterval(() => { db.prepare('DELETE FROM events WHERE created_at < ?').run(new Date(Date.now() - KEEP_EVENTS_MS).toISOString()); }, 3_600_000).unref();

// ─── Yordamchilar ────────────────────────────────────────────────────────────

const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json') => {
  res.statusCode = code;
  res.setHeader('content-type', type === 'application/json' ? 'application/json; charset=utf-8' : `${type}; charset=utf-8`);
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
};
function readRaw(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise(ok => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => ok(size > MAX_BODY ? null : Buffer.concat(chunks)));
    req.on('error', () => ok(null));
  });
}
const bearer = (req: IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
/** «klinika.maxfiy» → klinika id (kalit to'g'ri bo'lsa) */
function clinicOf(req: IncomingMessage): string | null {
  const [id, secret] = bearer(req).split('.');
  if (!id || !secret) return null;
  const row = db.prepare('SELECT key_hash FROM clinics WHERE id = ?').get(id) as { key_hash: string } | undefined;
  if (!row || !sameText(row.key_hash, sha(secret))) return null;
  db.prepare('UPDATE clinics SET seen_at = ? WHERE id = ?').run(now(), id);
  return id;
}
const page = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#13161d"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** OAuth holati: klinika, biznes, muddat — imzolangan (begona odam boshqa klinika nomidan ulay olmasin) */
const signState = (clinicId: string, businessId: string) => {
  const body = Buffer.from(JSON.stringify({ c: clinicId, b: businessId, e: Date.now() + STATE_TTL_MS, n: randomBytes(6).toString('hex') })).toString('base64url');
  return `${body}.${createHmac('sha256', stateSecret).update(body).digest('base64url')}`;
};
function readState(state: string): { c: string; b: string } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !sameText(sig, createHmac('sha256', stateSecret).update(body).digest('base64url'))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as { c: string; b: string; e: number };
    return s.e > Date.now() && typeof s.c === 'string' && typeof s.b === 'string' ? s : null;
  } catch { return null; }
}
const graphJson = async (r: Response) => {
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error(String((j.error as { message?: string } | undefined)?.message ?? j.error_message ?? r.status));
  return j;
};

// ─── Yo'llar ─────────────────────────────────────────────────────────────────

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://hub');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, { ok: true, instagram: !!(cfg.appId && cfg.appSecret && cfg.publicUrl) });

  // Admin: yangi klinika — ulanish kodi bir marta ko'rsatiladi (bazada faqat xeshi)
  if (p === '/admin/clinics' && req.method === 'POST') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { name?: string };
    const id = newId(), secret = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO clinics (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(id, String(body.name ?? 'Klinika').slice(0, 80), sha(secret), now());
    return send(res, 200, { clinicId: id, code: makeHubCode(cfg.publicUrl || `http://127.0.0.1:${cfg.port}`, id, secret) });
  }

  // Klinika: kalit ishlaydimi (ulash ustasidagi tekshiruv)
  if (p === '/api/ping') return clinicOf(req) ? send(res, 200, { ok: true, instagram: !!(cfg.appId && cfg.appSecret && cfg.publicUrl) }) : send(res, 401, { error: 'Hub kodi noto\'g\'ri' });

  // Klinika: Instagram'ga kirish havolasi (egasi brauzerda ochadi)
  if (p === '/api/ig/connect-url' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    if (!cfg.appId || !cfg.appSecret || !cfg.publicUrl) return send(res, 503, { error: 'Hubda Meta ilovasi sozlanmagan (IG_APP_ID, IG_APP_SECRET, HUB_PUBLIC_URL)' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { businessId?: string };
    if (!body.businessId || !/^[a-z0-9]{4,20}$/.test(body.businessId)) return send(res, 400, { error: 'businessId kerak' });
    const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: `${cfg.publicUrl}/ig/callback`, response_type: 'code', scope: SCOPES, state: signState(clinic, body.businessId) });
    return send(res, 200, { url: `${cfg.authUrl}?${q}` });
  }

  // Klinika: Instagram akkauntini uzdi — hub xabarlarini boshqa yubormaydi
  if (p === '/api/ig/forget' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { igUserId?: string };
    db.prepare('DELETE FROM accounts WHERE ig_user_id = ? AND clinic_id = ?').run(String(body.igUserId ?? ''), clinic);
    return send(res, 200, { ok: true });
  }

  // Meta: egasi ruxsat berdi (yoki rad etdi)
  if (p === '/ig/callback') {
    const state = readState(url.searchParams.get('state') ?? '');
    if (!state) return send(res, 400, page('Havola eskirgan', 'Panelga qayting va «Instagram\'ni ulash»ni qayta bosing.'), 'text/html');
    if (url.searchParams.get('error')) return send(res, 200, page('Ulanmadi', 'Ruxsat berilmadi. Panelga qayting va qayta urining.'), 'text/html');
    const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '');
    try {
      const short = await graphJson(await fetch(cfg.tokenUrl, { method: 'POST', body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: `${cfg.publicUrl}/ig/callback`, code }) }));
      const first = (Array.isArray(short.data) ? short.data[0] : short) as { access_token?: string; permissions?: string | string[] };
      const longLived = await graphJson(await fetch(`${cfg.graphUrl}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: cfg.appSecret, access_token: String(first.access_token) })}`));
      const token = String(longLived.access_token);
      const me = await graphJson(await fetch(`${cfg.graphUrl}/${cfg.graphVersion}/me?fields=user_id,username`, { headers: { authorization: `Bearer ${token}` } }));
      // Webhook'dagi entry.id — Instagram professional akkaunt id'si (user_id)
      const igUserId = String(me.user_id ?? me.id), username = String(me.username ?? '');
      db.prepare(`INSERT INTO accounts (ig_user_id, clinic_id, business_id, username, connected_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (ig_user_id) DO UPDATE SET clinic_id = excluded.clinic_id, business_id = excluded.business_id, username = excluded.username, connected_at = excluded.connected_at`)
        .run(igUserId, state.c, state.b, username, now());
      enqueue(state.c, 'ig_token', { businessId: state.b, igUserId, username, token, expiresIn: Number(longLived.expires_in) || 5_184_000, permissions: first.permissions ?? null });
      return send(res, 200, page('✓ Instagram ulandi', `@${esc(username)} — Cerebro endi Direct xabarlarini oladi va javob beradi. Bu oynani yopishingiz mumkin.`), 'text/html');
    } catch (e) {
      console.error('[hub] OAuth:', (e as Error).message);
      return send(res, 502, page('Ulanmadi', `Instagram javobi: ${esc((e as Error).message).slice(0, 200)}. Panelga qayting va qayta urining.`), 'text/html');
    }
  }

  // Meta: webhook manzilini tasdiqlash
  if (p === '/ig/webhook' && req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && !!cfg.verifyToken && sameText(url.searchParams.get('hub.verify_token') ?? '', cfg.verifyToken);
    return ok ? send(res, 200, url.searchParams.get('hub.challenge') ?? '', 'text/plain') : send(res, 403, { error: 'verify token' });
  }

  // Meta: xabar keldi
  if (p === '/ig/webhook' && req.method === 'POST') {
    const raw = await readRaw(req);
    const sig = String(req.headers['x-hub-signature-256'] ?? '');
    const expected = `sha256=${createHmac('sha256', cfg.appSecret).update(raw ?? Buffer.alloc(0)).digest('hex')}`;
    if (!raw || !cfg.appSecret || !sameText(sig, expected)) return send(res, 401, { error: 'imzo' });
    let body: { object?: string; entry?: { id?: string }[] };
    try { body = JSON.parse(raw.toString()); } catch { return send(res, 400, { error: 'json' }); }
    for (const entry of body.entry ?? []) {
      const acc = db.prepare('SELECT clinic_id, business_id FROM accounts WHERE ig_user_id = ?').get(String(entry.id ?? '')) as { clinic_id: string; business_id: string } | undefined;
      if (acc) enqueue(acc.clinic_id, 'ig_entry', { businessId: acc.business_id, entry });
    }
    // Meta tez javob kutadi: ishlov klinikada
    return send(res, 200, { ok: true });
  }

  // Klinika: navbatdagi voqealar (after — oxirgi olingan seq: undan oldingilari o'chiriladi)
  if (p === '/api/pull') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    db.prepare('DELETE FROM events WHERE clinic_id = ? AND seq <= ?').run(clinic, after);
    let events = pending(clinic, after);
    if (!events.length) {
      const wait = Math.min(PULL_WAIT_MS, Math.max(0, Number(url.searchParams.get('wait')) || PULL_WAIT_MS));
      await new Promise<void>(done => {
        const set = waiters.get(clinic) ?? new Set();
        const wake = () => { clearTimeout(timer); set.delete(wake); done(); };
        const timer = setTimeout(wake, wait);
        set.add(wake);
        waiters.set(clinic, set);
        req.on('close', wake);
      });
      events = pending(clinic, after);
    }
    return send(res, 200, { events });
  }

  send(res, 404, { error: 'topilmadi' });
}

const server = createServer((req, res) => { route(req, res).catch(e => { console.error('[hub]', e); if (!res.headersSent) send(res, 500, { error: 'ichki xato' }); }); });
server.listen(cfg.port, () => {
  console.log(`Cerebro Hub: http://localhost:${cfg.port}`);
  console.log(`  Instagram: ${cfg.appId && cfg.appSecret && cfg.publicUrl ? `ilova ${cfg.appId}, ${cfg.publicUrl}` : "sozlanmagan (IG_APP_ID, IG_APP_SECRET, HUB_PUBLIC_URL)"}`);
  console.log(`  webhook: ${cfg.publicUrl || '<HUB_PUBLIC_URL>'}/ig/webhook · OAuth: ${cfg.publicUrl || '<HUB_PUBLIC_URL>'}/ig/callback`);
});
const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
