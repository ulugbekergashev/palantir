/**
 * Palantir Hub — rasmiy Instagram (Meta) bilan klinikalar orasidagi kichik bulut xizmati. Meta'ga bitta ilova va bitta ochiq HTTPS manzil
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
 *   4. Nazorat: klinika har so'rovda «ko'rinadi» (/api/pull ~25 soniyada) va 5 daqiqada /api/heartbeat bilan holatini yuboradi
 *      (versiya, baza nashri, diskdagi joy, kanallardagi ochiq muammolar — mijoz ma'lumoti emas). HUB_OFFLINE_MS dan beri
 *      ko'rinmasa — sotuvchiga Telegram'da bir marta (kompyuter o'chgan bo'lsa o'zi ayta olmaydi), qaytsa — «yana aloqada».
 *      Ro'yxat: GET /admin/clinics (admin kaliti bilan).
 *   5. Tashqi zaxira: klinika kunlik zaxirasini sotuvchining ochiq kaliti bilan shifrlab /api/backup ga yuboradi — hub uni o'qiy olmaydi,
 *      faqat saqlaydi (har klinikaga oxirgi HUB_BACKUP_KEEP ta). GET /admin/backups — ro'yxat, /admin/backups/<klinika>/<fayl> — yuklab olish;
 *      ochish: scripts/restore-backup.ts (sotuvchining maxfiy kaliti bilan).
 *   6. Diagnostika: egasi botga /diagnostika yozsa (yoki admin panelidan) — klinika holati va jurnallar oxiri /api/diag ga keladi
 *      (kalitlarsiz); GET /admin/diag — ro'yxat, /admin/diag/<klinika>/<fayl> — o'qish. Har klinikaga oxirgi 10 tasi.
 *
 *   8. Masofadan kirish: /c/<klinika>/… — egasining telefoni (Telegram Mini App yoki brauzer) panelni hub orqali ochadi. So'rov
 *      klinikaning uzun so'roviga (/api/pull → relays) qo'shiladi, klinika uni o'zidagi panel serveriga beradi va javobni
 *      /api/relay/<id> ga qaytaradi. So'rovlar faqat xotirada (bazaga yozilmaydi): hub qayta ishga tushsa, eski so'rov qayta
 *      bajarilmaydi. Kirish — klinika panelining o'z paroli yoki Telegram Mini App imzosi; hub tanani saqlamaydi va yozmaydi.
 *   9. Palantir jamoasi: GET /admin — klinikalar va «Panelni ochish». Admin kaliti bilan POST /admin/clinics/<klinika>/panel →
 *      klinikaga belgilangan so'rov (support) → klinika parolsiz 12 soatlik kirish beradi, agar egasi ruxsatni o'chirmagan bo'lsa;
 *      har kirish egasining Sozlamalarida ko'rinadi. Oddiy /c/ so'rovi bu belgini ololmaydi.
 *   7. Meta talablari: ochiq sahifalar /privacy, /terms, /data-deletion (legal.ts); Meta chaqiradigan /ig/deauthorize (egasi ilovani
 *      Instagram'dan olib tashladi) va /ig/data-deletion (ma'lumotni o'chirish so'rovi) — signed_request ilova siri bilan tekshiriladi.
 *      Hub o'zidagini o'chiradi (akkaunt bog'lanishi, kutayotgan xabarlar) va klinikaga navbat orqali buyruq beradi: tokenni va
 *      Instagram'dan kelgan ma'lumotni o'chirish; klinika bajargach /api/ig/deleted — holat sahifasi «bajarildi».
 *
 * Sozlama (muhit o'zgaruvchilari): IG_APP_ID, IG_APP_SECRET, HUB_PUBLIC_URL, HUB_VERIFY_TOKEN, HUB_ADMIN_KEY, PORT, HUB_DB;
 * ochiq sahifalar uchun HUB_OPERATOR (xizmatni taqdim etuvchi, yuridik nomi) va HUB_CONTACT_EMAIL;
 * proksi ortida (Railway) — HUB_TRUST_PROXY=1 (masofadan kirishda mijoz manzili X-Forwarded-For'dan);
 * nazorat uchun HUB_BOT_TOKEN (sotuvchining boti) va HUB_ALERT_CHAT (xabar boradigan chat), HUB_OFFLINE_MS (standart 15 daqiqa).
 * Ishga tushirish: npm run hub
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adminPage } from './admin.ts';
import { deletionPage, deletionStatusPage, privacyPage, termsPage, type DeletionView, type LegalInfo } from './legal.ts';

/** Admin kaliti hamma klinikaning paneli, zaxirasi va diagnostikasini ochadi: qisqasi qabul qilinmaydi (hub:deploy 32 belgili yaratadi) */
const MIN_ADMIN_KEY = 24;
const cfg = {
  port: Number(process.env.PORT) || 3400,
  db: resolve(process.env.HUB_DB || 'hub-data/hub.db'),
  appId: process.env.IG_APP_ID || '',
  appSecret: process.env.IG_APP_SECRET || '',
  publicUrl: (process.env.HUB_PUBLIC_URL || '').replace(/\/+$/, ''),
  verifyToken: process.env.HUB_VERIFY_TOKEN || '',
  adminKey: (process.env.HUB_ADMIN_KEY ?? '').length >= MIN_ADMIN_KEY ? process.env.HUB_ADMIN_KEY! : '',
  // Faqat sinov uchun: soxta Instagram
  authUrl: process.env.IG_AUTH_URL || 'https://www.instagram.com/oauth/authorize',
  tokenUrl: process.env.IG_TOKEN_URL || 'https://api.instagram.com/oauth/access_token',
  graphUrl: (process.env.IG_GRAPH_URL || 'https://graph.instagram.com').replace(/\/+$/, ''),
  graphVersion: process.env.IG_GRAPH_VERSION || 'v25.0',
  botToken: process.env.HUB_BOT_TOKEN || '',
  alertChat: process.env.HUB_ALERT_CHAT || '',
  // Faqat sinov uchun: soxta Telegram
  telegramApi: (process.env.HUB_TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/+$/, ''),
  offlineMs: Number(process.env.HUB_OFFLINE_MS) || 15 * 60_000,
  watchMs: Number(process.env.HUB_WATCH_MS) || 60_000,
  backupDir: resolve(process.env.HUB_BACKUP_DIR || join(dirname(resolve(process.env.HUB_DB || 'hub-data/hub.db')), 'zaxira')),
  backupKeep: Number(process.env.HUB_BACKUP_KEEP) || 7,
  backupMaxBytes: (Number(process.env.HUB_BACKUP_MAX_MB) || 512) * 1_048_576,
  diagDir: resolve(process.env.HUB_DIAG_DIR || join(dirname(resolve(process.env.HUB_DB || 'hub-data/hub.db')), 'diagnostika')),
  // Hub xosting proksisi ortida (Railway va h.k.): mijoz manzili — X-Forwarded-For'ning oxirgisi (proksi qo'shgani)
  trustProxy: process.env.HUB_TRUST_PROXY === '1',
  operator: process.env.HUB_OPERATOR || 'Palantir',
  contactEmail: process.env.HUB_CONTACT_EMAIL || '',
};
const DIAG_KEEP = 10;
/** Tashqi zaxira fayli shu belgi bilan boshlanadi (server/offsiteCrypto.ts) — boshqa narsa saqlanmaydi */
const BACKUP_MAGIC = Buffer.from('PALANTIR-ZAXIRA-1\n');
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
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deletions (code TEXT PRIMARY KEY, ig_user_id TEXT NOT NULL, clinic_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT);`);
// Eski hub bazasiga nazorat ustunlari: status — oxirgi holat (JSON), alerted_at — «aloqa yo'q» aytilgan payt
{
  const have = new Set((db.prepare('PRAGMA table_info(clinics)').all() as { name: string }[]).map(c => c.name));
  for (const [name, type] of [['status', 'TEXT'], ['alerted_at', 'TEXT']]) if (!have.has(name)) db.exec(`ALTER TABLE clinics ADD COLUMN ${name} ${type}`);
}
// Ilova doirasidagi foydalanuvchi id'si (/me → id): Meta signed_request'da qaysi id kelishi aniq emas — ikkalasi bo'yicha topiladi
{
  const have = new Set((db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map(c => c.name));
  if (!have.has('app_user_id')) db.exec('ALTER TABLE accounts ADD COLUMN app_user_id TEXT');
}

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
const makeHubCode = (url: string, clinicId: string, secret: string) => `phub.${Buffer.from(url.replace(/\/+$/, '')).toString('base64url')}.${clinicId}.${secret}`;
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

// ─── Masofadan kirish (relay) ────────────────────────────────────────────────

/** support — admin kaliti bilan ochilgan so'rov (Palantir jamoasi): klinika faqat /api/login/support da qabul qiladi */
interface Relay { id: string; method: string; path: string; headers: Record<string, string>; body: string; ip: string; support?: boolean }
interface RelayAnswer { status: number; headers: Record<string, string>; body: string }
/** Klinika olishi kerak bo'lgan so'rovlar va javobini kutayotganlar — faqat xotirada */
const relayQueue = new Map<string, Relay[]>();
const relayWaiting = new Map<string, { clinic: string; done: (a: RelayAnswer | null) => void }>();
const RELAY_TIMEOUT_MS = 120_000;
/** Telefondan keladigan so'rov (fayl yuklash ham) va klinikadan keladigan javob (panel fayllari, kamera modeli) */
const RELAY_MAX_REQUEST = 15 * 1_048_576, RELAY_MAX_ANSWER = 40 * 1_048_576;
/** Klinika aloqada: uzun so'rovi hozir kutib turibdi yoki shuncha vaqt ichida ko'ringan (javob bilan keyingi so'rov orasida — millisoniyalar) */
const RELAY_GAP_MS = 3_000;
/** Klinika so'rovni shuncha vaqtda olmasa — u aslida aloqada emas (o'chgan, internet uzilgan): telefon kutib qolmasin */
const RELAY_PICKUP_MS = 15_000;
const RELAY_REQUEST_HEADERS = ['content-type', 'authorization', 'accept', 'accept-language', 'if-none-match'];
const RELAY_ANSWER_HEADERS = ['content-type', 'cache-control', 'etag', 'content-disposition', 'last-modified'];
/** Bir manzildan daqiqasiga (panel ochilganda o'nlab fayl va so'rov) */
const RELAY_PER_MINUTE = 600;
const relayHits = new Map<string, { n: number; until: number }>();
function relayAllowed(ip: string): boolean {
  const now = Date.now();
  if (relayHits.size > 5000) for (const [k, v] of relayHits) if (v.until < now) relayHits.delete(k);
  const h = relayHits.get(ip);
  if (!h || h.until < now) { relayHits.set(ip, { n: 1, until: now + 60_000 }); return true; }
  return ++h.n <= RELAY_PER_MINUTE;
}
/**
 * Telefonning manzili (so'rovlar soni va parol urinishlari shu bo'yicha sanaladi). Proksi ortida hamma bitta manzildan kelgandek
 * ko'rinadi — HUB_TRUST_PROXY=1 bo'lsa X-Forwarded-For'ning oxirgisi (uni proksining o'zi qo'shadi, mijoz soxtalashtira olmaydi)
 */
function clientIp(req: IncomingMessage): string {
  const forwarded = cfg.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean).at(-1) : undefined;
  return forwarded || req.socket.remoteAddress || '';
}
const pick = (from: Record<string, unknown>, names: string[]) =>
  Object.fromEntries(names.flatMap(n => (typeof from[n] === 'string' ? [[n, from[n] as string]] : [])));
const offlinePage = (name: string) => page('Klinika kompyuteri aloqada emas', `«${esc(name)}» kompyuteri hozir internetga ulanmagan yoki o'chiq. U yoqilgach panel shu havoladan ochiladi.`);

/** Klinika aloqada: uzun so'rovi hozir kutib turibdi yoki hozirgina ko'ringan */
const clinicOnline = (clinicId: string, seenAt: string | null) => !!waiters.get(clinicId)?.size || (!!seenAt && Date.now() - Date.parse(seenAt) < RELAY_GAP_MS);

/** So'rovni klinika navbatiga qo'yadi va javobini kutadi. Klinika olmasa yoki javob bermasa — null */
async function dispatch(clinicId: string, r: Omit<Relay, 'id'>): Promise<RelayAnswer | null> {
  const id = randomBytes(9).toString('hex');
  const answer = await new Promise<RelayAnswer | null>(done => {
    const timer = setTimeout(() => { relayWaiting.delete(id); done(null); }, RELAY_TIMEOUT_MS);
    const pickup = setTimeout(() => {
      if (!(relayQueue.get(clinicId) ?? []).some(x => x.id === id)) return;
      clearTimeout(timer);
      relayWaiting.delete(id);
      done(null);
    }, RELAY_PICKUP_MS);
    relayWaiting.set(id, { clinic: clinicId, done: a => { clearTimeout(timer); clearTimeout(pickup); relayWaiting.delete(id); done(a); } });
    relayQueue.set(clinicId, [...(relayQueue.get(clinicId) ?? []), { ...r, id }]);
    for (const wake of waiters.get(clinicId) ?? []) wake();
  });
  if (!answer) relayQueue.set(clinicId, (relayQueue.get(clinicId) ?? []).filter(x => x.id !== id));
  return answer;
}

async function relay(req: IncomingMessage, res: ServerResponse, clinicId: string, path: string): Promise<void> {
  const clinic = db.prepare('SELECT name, seen_at FROM clinics WHERE id = ?').get(clinicId) as { name: string; seen_at: string | null } | undefined;
  if (!clinic) return send(res, 404, page('Topilmadi', "Bunday klinika yo'q."), 'text/html');
  const ip = clientIp(req);
  if (!relayAllowed(ip)) return send(res, 429, { error: "Ko'p so'rov — bir daqiqadan keyin" });
  const html = String(req.headers.accept ?? '').includes('text/html');
  if (!clinicOnline(clinicId, clinic.seen_at)) {
    return html ? send(res, 503, offlinePage(clinic.name), 'text/html') : send(res, 503, { error: 'Klinika kompyuteri aloqada emas' });
  }
  const raw = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRaw(req, RELAY_MAX_REQUEST);
  if (!raw) return send(res, 413, { error: 'Juda katta' });
  const answer = await dispatch(clinicId, { method: String(req.method), path, headers: pick(req.headers, RELAY_REQUEST_HEADERS), body: raw.toString('base64'), ip });
  if (!answer) {
    return html ? send(res, 504, offlinePage(clinic.name), 'text/html') : send(res, 504, { error: 'Klinika kompyuteri javob bermadi' });
  }
  res.statusCode = answer.status;
  for (const [k, v] of Object.entries(pick(answer.headers, RELAY_ANSWER_HEADERS))) res.setHeader(k, v);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Telegram Mini App veb-versiyada iframe ichida ochiladi; boshqa saytlar panelni o'z sahifasiga joylay olmaydi
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org");
  res.end(Buffer.from(answer.body, 'base64'));
}

// ─── Yordamchilar ────────────────────────────────────────────────────────────

const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json') => {
  res.statusCode = code;
  res.setHeader('content-type', type === 'application/json' ? 'application/json; charset=utf-8' : `${type}; charset=utf-8`);
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
};
function readRaw(req: IncomingMessage, max = MAX_BODY): Promise<Buffer | null> {
  return new Promise(ok => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('end', () => ok(size > max ? null : Buffer.concat(chunks)));
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
const legal = (): LegalInfo => ({ operator: cfg.operator, email: cfg.contactEmail, publicUrl: cfg.publicUrl || `http://127.0.0.1:${cfg.port}` });
/** Meta signed_request: «imzo.ma'lumot» (base64url); imzo — ma'lumot qismining ilova siri bilan HMAC-SHA256'i */
function signedRequest(v: string): { user_id?: string | number } | null {
  const [sig, payload] = v.split('.');
  if (!sig || !payload || !cfg.appSecret) return null;
  if (!sameText(sig.replace(/=+$/, ''), createHmac('sha256', cfg.appSecret).update(payload).digest('base64url'))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { algorithm?: string; user_id?: string | number };
    return String(j.algorithm).toUpperCase() === 'HMAC-SHA256' ? j : null;
  } catch { return null; }
}
const page = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#13161d"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Klinika yuborgan holat: faqat ma'lum maydonlar, qisqartirilgan (begona narsa bazaga tushmasin) */
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const record = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
function cleanStatus(v: unknown) {
  const o = record(v);
  const problems = (Array.isArray(o.problems) ? o.problems : []).slice(0, 20).map(x => {
    const q = record(x);
    return { business: text(q.business, 80), label: text(q.label, 80), problem: text(q.problem, 300), since: text(q.since, 40) };
  });
  const u = o.lastUpdate ? record(o.lastUpdate) : null;
  const lastUpdate = u ? { from: text(u.from, 40), to: text(u.to, 40), result: text(u.result, 20), reason: text(u.reason, 500), at: text(u.at, 40) } : null;
  const b = o.lastOffsite ? record(o.lastOffsite) : null;
  const lastOffsite = b ? { day: text(b.day, 10), ok: b.ok === true, size: num(b.size), error: text(b.error, 300), at: text(b.at, 40) } : null;
  return { version: text(o.version, 40), schema: num(o.schema), startedAt: text(o.startedAt, 40), diskFreeMb: num(o.diskFreeMb), businesses: num(o.businesses), problems, lastUpdate, lastOffsite, at: now() };
}

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

  if (p === '/health') return send(res, 200, { ok: true, instagram: !!(cfg.appId && cfg.appSecret && cfg.publicUrl), legal: !!cfg.contactEmail });

  // Ochiq sahifalar (Meta ilovasi sozlamasida ko'rsatiladi)
  if (req.method === 'GET' && p === '/privacy') return send(res, 200, privacyPage(legal()), 'text/html');
  if (req.method === 'GET' && p === '/terms') return send(res, 200, termsPage(legal()), 'text/html');
  if (req.method === 'GET' && p === '/data-deletion') return send(res, 200, deletionPage(legal()), 'text/html');
  if (req.method === 'GET' && p === '/data-deletion/status') {
    const row = db.prepare('SELECT code, status, created_at, done_at FROM deletions WHERE code = ?').get(url.searchParams.get('id') ?? '') as { code: string; status: string; created_at: string; done_at: string | null } | undefined;
    const view: DeletionView | null = row ? { code: row.code, status: row.status === 'done' ? 'done' : 'pending', createdAt: row.created_at, doneAt: row.done_at } : null;
    return send(res, row ? 200 : 404, deletionStatusPage(legal(), view), 'text/html');
  }

  // Masofadan kirish: panel hub orqali (havola oxirida «/» bo'lsin — panel fayllari nisbiy yo'l bilan)
  const remote = /^\/c\/([0-9a-f]{10})(\/.*)?$/.exec(p);
  if (remote) {
    if (!remote[2]) { res.statusCode = 301; res.setHeader('location', `/c/${remote[1]}/${url.search}`); return void res.end(); }
    return relay(req, res, remote[1], `${remote[2]}${url.search}`);
  }

  // Klinika: masofadan kelgan so'rovga javob
  const answered = /^\/api\/relay\/([0-9a-f]{18})$/.exec(p);
  if (answered && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const w = relayWaiting.get(answered[1]);
    const raw = await readRaw(req, RELAY_MAX_ANSWER);
    if (!w || w.clinic !== clinic) return send(res, 404, { error: "So'rov topilmadi (vaqti o'tgan)" });
    if (!raw) { w.done({ status: 502, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ error: 'Javob juda katta' })).toString('base64') }); return send(res, 413, { error: 'Juda katta' }); }
    try {
      const a = JSON.parse(raw.toString()) as RelayAnswer;
      w.done({ status: Number(a.status) || 502, headers: a.headers && typeof a.headers === 'object' ? a.headers : {}, body: typeof a.body === 'string' ? a.body : '' });
    } catch { return send(res, 400, { error: 'json' }); }
    return send(res, 200, { ok: true });
  }

  // Meta: egasi ilovani Instagram'dan olib tashladi (deauthorize) yoki ma'lumotni o'chirishni so'radi (data deletion)
  if (req.method === 'POST' && (p === '/ig/deauthorize' || p === '/ig/data-deletion')) {
    const raw = await readRaw(req);
    const signed = signedRequest(new URLSearchParams(raw?.toString() ?? '').get('signed_request') ?? '');
    if (!signed?.user_id) return send(res, 400, { error: 'signed_request' });
    const uid = String(signed.user_id), deleting = p === '/ig/data-deletion';
    const code = deleting ? randomBytes(8).toString('hex') : '';
    const found = db.prepare('SELECT ig_user_id, clinic_id, business_id FROM accounts WHERE ig_user_id = ? OR app_user_id = ?').all(uid, uid) as { ig_user_id: string; clinic_id: string; business_id: string }[];
    for (const a of found) {
      db.prepare('DELETE FROM accounts WHERE ig_user_id = ?').run(a.ig_user_id);
      // Klinika hali olmagan xabarlar ham o'chadi
      db.prepare("DELETE FROM events WHERE clinic_id = ? AND kind = 'ig_entry' AND json_extract(payload, '$.entry.id') = ?").run(a.clinic_id, a.ig_user_id);
      enqueue(a.clinic_id, deleting ? 'ig_delete' : 'ig_revoked', { businessId: a.business_id, igUserId: a.ig_user_id, ...(deleting ? { code } : {}) });
    }
    console.log(`[hub] Meta: ${deleting ? "ma'lumotni o'chirish so'rovi" : 'ilova olib tashlandi'} — ${found.length ? `${found.length} ta akkaunt` : "bog'langan akkaunt yo'q"}`);
    if (!deleting) return send(res, 200, { ok: true });
    // Hubda bu akkauntdan hech narsa qolmagan bo'lsa — darhol bajarildi; aks holda klinika bajargach (/api/ig/deleted)
    db.prepare('INSERT INTO deletions (code, ig_user_id, clinic_id, status, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, uid, found[0]?.clinic_id ?? null, found.length ? 'pending' : 'done', now(), found.length ? null : now());
    return send(res, 200, { url: `${legal().publicUrl}/data-deletion/status?id=${code}`, confirmation_code: code });
  }

  // Klinika: Meta so'ragan o'chirishni bajardi
  if (p === '/api/ig/deleted' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { code?: string };
    const r = db.prepare("UPDATE deletions SET status = 'done', done_at = ? WHERE code = ? AND clinic_id = ? AND status = 'pending'").run(now(), String(body.code ?? ''), clinic);
    return send(res, 200, { ok: true, updated: Number(r.changes) });
  }

  // Admin: yangi klinika — ulanish kodi bir marta ko'rsatiladi (bazada faqat xeshi)
  if (p === '/admin/clinics' && req.method === 'POST') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { name?: string };
    const id = newId(), secret = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO clinics (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(id, String(body.name ?? 'Klinika').slice(0, 80), sha(secret), now());
    return send(res, 200, { clinicId: id, code: makeHubCode(cfg.publicUrl || `http://127.0.0.1:${cfg.port}`, id, secret) });
  }

  // Admin sahifasi: klinikalar va «Panelni ochish» (kalit sahifaning o'zida so'raladi — sahifada sir yo'q)
  if (p === '/admin' && req.method === 'GET') {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'same-origin');
    // Klinika paneli (shu manzilda, lekin klinika kompyuteri bergan) ochilgan oynadan bu sahifaga qo'l cho'za olmasin
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return send(res, 200, adminPage(), 'text/html');
  }

  // Admin: Palantir jamoasi sifatida klinika paneliga — klinika parolsiz kirish kalitini beradi (egasi ruxsatni o'chirmagan bo'lsa)
  const support = /^\/admin\/clinics\/([0-9a-f]{10})\/panel$/.exec(p);
  if (support && req.method === 'POST') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const clinic = db.prepare('SELECT seen_at FROM clinics WHERE id = ?').get(support[1]) as { seen_at: string | null } | undefined;
    if (!clinic) return send(res, 404, { error: "Bunday klinika yo'q" });
    if (!clinicOnline(support[1], clinic.seen_at)) return send(res, 503, { error: 'Klinika kompyuteri aloqada emas' });
    const body = JSON.parse((await readRaw(req))?.toString() || '{}') as { business?: unknown };
    const ask = typeof body.business === 'string' ? { business: body.business.slice(0, 40) } : {};
    const answer = await dispatch(support[1], {
      method: 'POST', path: '/api/login/support', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(ask)).toString('base64'), ip: clientIp(req), support: true,
    });
    if (!answer) return send(res, 504, { error: 'Klinika kompyuteri javob bermadi' });
    res.statusCode = answer.status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return void res.end(Buffer.from(answer.body, 'base64'));
  }

  // Admin: klinikalar — oxirgi ko'ringan payti va holati
  if (p === '/admin/clinics' && req.method === 'GET') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const rows = db.prepare('SELECT id, name, created_at, seen_at, status FROM clinics ORDER BY name').all() as { id: string; name: string; created_at: string; seen_at: string | null; status: string | null }[];
    return send(res, 200, {
      clinics: rows.map(r => ({
        id: r.id, name: r.name, createdAt: r.created_at, seenAt: r.seen_at,
        online: !!r.seen_at && Date.now() - Date.parse(r.seen_at) < cfg.offlineMs, status: r.status ? JSON.parse(r.status) as unknown : null,
      })),
    });
  }

  // Klinika: shifrlangan kunlik zaxira (hub ocha olmaydi) — oqim bilan faylga, hajmi cheklangan; oxirgi backupKeep tasi qoladi
  if (p === '/api/backup' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const day = url.searchParams.get('day') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'day: YYYY-MM-DD' });
    const dir = join(cfg.backupDir, clinic), tmp = join(dir, `.${day}-${randomBytes(4).toString('hex')}`), file = join(dir, `${day}.pzb`);
    mkdirSync(dir, { recursive: true });
    let size = 0;
    const limit = new Transform({ transform(chunk: Buffer, _e, done) { size += chunk.length; done(size > cfg.backupMaxBytes ? new Error('juda katta') : null, chunk); } });
    try {
      await pipeline(req, limit, createWriteStream(tmp));
      const head = Buffer.alloc(BACKUP_MAGIC.length), fd = openSync(tmp, 'r');
      try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
      if (!head.equals(BACKUP_MAGIC)) throw new Error('zaxira fayli emas');
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      return send(res, (e as Error).message === 'juda katta' ? 413 : 400, { error: (e as Error).message });
    }
    const all = readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.pzb$/.test(n)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - cfg.backupKeep))) rmSync(join(dir, old), { force: true });
    return send(res, 200, { ok: true, size });
  }

  // Admin: tashqi zaxiralar ro'yxati va yuklab olish (shifrlangan holida)
  if (p === '/admin/backups' && req.method === 'GET') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const list = existsSync(cfg.backupDir) ? readdirSync(cfg.backupDir).filter(c => /^[0-9a-f]{10}$/.test(c)).flatMap(clinic =>
      readdirSync(join(cfg.backupDir, clinic)).filter(n => /^\d{4}-\d{2}-\d{2}\.pzb$/.test(n)).map(name => {
        const st = statSync(join(cfg.backupDir, clinic, name));
        return { clinicId: clinic, file: name, size: st.size, at: st.mtime.toISOString() };
      })) : [];
    return send(res, 200, { backups: list });
  }
  const download = /^\/admin\/backups\/([0-9a-f]{10})\/(\d{4}-\d{2}-\d{2}\.pzb)$/.exec(p);
  if (download && req.method === 'GET') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const file = join(cfg.backupDir, download[1], download[2]);
    if (!existsSync(file)) return send(res, 404, { error: 'topilmadi' });
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename="${download[1]}-${download[2]}"`);
    await pipeline(createReadStream(file), res);
    return;
  }

  // Klinika: diagnostika (egasi yoki admin so'raganda) — sotuvchi yordam berishi uchun
  if (p === '/api/diag' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    const raw = await readRaw(req);
    if (!raw || !raw.length) return send(res, 413, { error: 'bo\'sh yoki juda katta' });
    const dir = join(cfg.diagDir, clinic), file = `${now().replace(/[:.]/g, '-')}.txt`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), raw);
    const all = readdirSync(dir).filter(n => n.endsWith('.txt')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - DIAG_KEEP))) rmSync(join(dir, old), { force: true });
    return send(res, 200, { ok: true, file });
  }
  if (p === '/admin/diag' && req.method === 'GET') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const list = existsSync(cfg.diagDir) ? readdirSync(cfg.diagDir).filter(c => /^[0-9a-f]{10}$/.test(c)).flatMap(clinic =>
      readdirSync(join(cfg.diagDir, clinic)).filter(n => n.endsWith('.txt')).map(file => ({ clinicId: clinic, file, size: statSync(join(cfg.diagDir, clinic, file)).size }))) : [];
    return send(res, 200, { diagnostics: list });
  }
  const diag = /^\/admin\/diag\/([0-9a-f]{10})\/([\w-]+\.txt)$/.exec(p);
  if (diag && req.method === 'GET') {
    if (!cfg.adminKey || !sameText(bearer(req), cfg.adminKey)) return send(res, 401, { error: 'admin kaliti noto\'g\'ri' });
    const file = join(cfg.diagDir, diag[1], diag[2]);
    if (!existsSync(file)) return send(res, 404, { error: 'topilmadi' });
    return send(res, 200, readFileSync(file, 'utf8'), 'text/plain');
  }

  // Klinika: holat (5 daqiqada) — nazorat ro'yxati uchun; mijoz ma'lumoti kelmaydi
  if (p === '/api/heartbeat' && req.method === 'POST') {
    const clinic = clinicOf(req);
    if (!clinic) return send(res, 401, { error: 'Hub kodi noto\'g\'ri' });
    let body: unknown;
    try { body = JSON.parse((await readRaw(req))?.toString() || '{}'); } catch { return send(res, 400, { error: 'json' }); }
    db.prepare('UPDATE clinics SET status = ? WHERE id = ?').run(JSON.stringify(cleanStatus(body)), clinic);
    return send(res, 200, { ok: true });
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
      const igUserId = String(me.user_id ?? me.id), username = String(me.username ?? ''), appUserId = me.id ? String(me.id) : null;
      db.prepare(`INSERT INTO accounts (ig_user_id, clinic_id, business_id, username, connected_at, app_user_id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (ig_user_id) DO UPDATE SET clinic_id = excluded.clinic_id, business_id = excluded.business_id, username = excluded.username,
          connected_at = excluded.connected_at, app_user_id = excluded.app_user_id`)
        .run(igUserId, state.c, state.b, username, now(), appUserId);
      enqueue(state.c, 'ig_token', { businessId: state.b, igUserId, username, token, expiresIn: Number(longLived.expires_in) || 5_184_000, permissions: first.permissions ?? null });
      return send(res, 200, page('✓ Instagram ulandi', `@${esc(username)} — Palantir endi Direct xabarlarini oladi va javob beradi. Bu oynani yopishingiz mumkin.`), 'text/html');
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
    // Masofadan kelgan so'rovlar navbatdan olinadi (bir marta beriladi: ikki marta bajarilmasin)
    const take = () => { const list = relayQueue.get(clinic) ?? []; relayQueue.delete(clinic); return list; };
    let relays = take();
    if (!events.length && !relays.length) {
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
      relays = take();
    }
    // Ulanish shu orada uzilgan bo'lsa — so'rovlar navbatga qaytadi (keyingi so'rovda olinadi)
    if (req.socket.destroyed && relays.length) { relayQueue.set(clinic, [...relays, ...(relayQueue.get(clinic) ?? [])]); return; }
    return send(res, 200, { events, relays });
  }

  send(res, 404, { error: 'topilmadi' });
}

// ─── Nazorat: klinika ko'rinmay qoldi ──────────────────────────────────────

const tashkent = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Sotuvchiga Telegram'da (HUB_BOT_TOKEN, HUB_ALERT_CHAT). Sozlanmagan yoki yetmagan bo'lsa — false: keyingi tekshiruvda qayta urinadi */
async function alert(message: string): Promise<boolean> {
  if (!cfg.botToken || !cfg.alertChat) return false;
  try {
    const r = await fetch(`${cfg.telegramApi}/bot${cfg.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.alertChat, text: message }), signal: AbortSignal.timeout(15_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
let watching = false;
async function watch(): Promise<void> {
  if (watching) return;
  watching = true;
  try {
    const cutoff = new Date(Date.now() - cfg.offlineMs).toISOString();
    const lost = db.prepare('SELECT id, name, seen_at FROM clinics WHERE seen_at IS NOT NULL AND seen_at < ? AND alerted_at IS NULL').all(cutoff) as { id: string; name: string; seen_at: string }[];
    for (const c of lost) {
      const minutes = Math.round((Date.now() - Date.parse(c.seen_at)) / 60_000);
      const said = await alert(`⚠️ «${c.name}» bilan aloqa yo'q — oxirgi marta ${tashkent(c.seen_at)} da (${minutes} daqiqa oldin). Kompyuter o'chgan, uxlab qolgan yoki internet uzilgan bo'lishi mumkin.`);
      if (said) db.prepare('UPDATE clinics SET alerted_at = ? WHERE id = ?').run(now(), c.id);
    }
    const back = db.prepare('SELECT id, name FROM clinics WHERE alerted_at IS NOT NULL AND seen_at > alerted_at').all() as { id: string; name: string }[];
    for (const c of back) if (await alert(`✅ «${c.name}» yana aloqada.`)) db.prepare('UPDATE clinics SET alerted_at = NULL WHERE id = ?').run(c.id);
  } finally {
    watching = false;
  }
}
setInterval(() => { void watch(); }, cfg.watchMs).unref();

const server = createServer((req, res) => { route(req, res).catch(e => { console.error('[hub]', e); if (!res.headersSent) send(res, 500, { error: 'ichki xato' }); }); });
// Bo'sh ulanish klientdan (fetch — ~4 s) uzoqroq ushlanadi: aks holda klinika qayta foydalanayotgan ulanishni hub yopib qo'yishi mumkin (ECONNRESET)
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(cfg.port, () => {
  console.log(`Palantir Hub: http://localhost:${cfg.port}`);
  console.log(`  Instagram: ${cfg.appId && cfg.appSecret && cfg.publicUrl ? `ilova ${cfg.appId}, ${cfg.publicUrl}` : "sozlanmagan (IG_APP_ID, IG_APP_SECRET, HUB_PUBLIC_URL)"}`);
  const pub = cfg.publicUrl || '<HUB_PUBLIC_URL>';
  console.log(`  webhook: ${pub}/ig/webhook · OAuth: ${pub}/ig/callback · deauthorize: ${pub}/ig/deauthorize · data deletion: ${pub}/ig/data-deletion`);
  console.log(`  sahifalar: ${pub}/privacy, /terms, /data-deletion — ${cfg.contactEmail ? `${cfg.operator}, ${cfg.contactEmail}` : "HUB_CONTACT_EMAIL berilmagan: Meta aloqa manzilisiz siyosatni qabul qilmaydi"}`);
  if (process.env.HUB_ADMIN_KEY && !cfg.adminKey) console.error(`  admin: HUB_ADMIN_KEY ${MIN_ADMIN_KEY} belgidan qisqa — admin yo'llari yopiq`);
  console.log(`  nazorat: ${cfg.botToken && cfg.alertChat ? `klinika ${Math.round(cfg.offlineMs / 60_000)} daqiqa ko'rinmasa — Telegram ${cfg.alertChat}` : "Telegram'ga aytilmaydi (HUB_BOT_TOKEN, HUB_ALERT_CHAT)"}`);
});
const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
