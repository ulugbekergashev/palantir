/**
 * Baza: bitta SQLite fayl (Node'ning o'zidagi node:sqlite).
 * Biznes profili — JSON; vazifalar, mijozlar, hujjatlar, postlar, xabarlar,
 * eslab qolingan faktlar va suhbatlar — alohida jadvallarda.
 * Har bir so'rov biznes id'si bilan cheklangan (bizneslar bir-birini ko'rmaydi).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type {
  Artifact, Business, ChatEntry, ContentItem, Doc, InboxMessage, Lead, LeadChannel, LeadStage, Note, Outbound, OutboundStatus, Post, PostStatus,
  MoneyEntry, MoneyKind, MoneyStatus, ReplyBooking, ReplyDraft, ReplyStatus, Task, TaskStatus, VisitChange,
} from '../src/types';
import type { Call, CallLine, Camera, CameraSession, CameraZone, Knowledge, KnowledgeKind, ZoneKind } from '../src/types';
import { phoneKey } from '../src/lib/phone';
import { env } from './env';

const db = new DatabaseSync(env.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, profile TEXT NOT NULL,
  owner_chat_id TEXT UNIQUE, link_code TEXT NOT NULL UNIQUE, channel_id TEXT, channel_title TEXT,
  active INTEGER NOT NULL DEFAULT 1, brief_date TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT, due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open', reminded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks (status, due_at);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT, phone TEXT, username TEXT, tg_user_id TEXT,
  stage TEXT NOT NULL DEFAULT 'new', note TEXT, source TEXT, post_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_biz ON leads (business_id, created_at);
CREATE INDEX IF NOT EXISTS leads_tg ON leads (tg_user_id, updated_at);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, item TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  channel_message_id INTEGER, published_at TEXT, owner_message_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbound (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, text TEXT NOT NULL, lead_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', sent_count INTEGER NOT NULL DEFAULT 0, owner_message_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS money_entries (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', note TEXT, crm_id TEXT, owner_message_id INTEGER, created_at TEXT NOT NULL, done_at TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  business_id TEXT PRIMARY KEY, system TEXT NOT NULL, tools_key TEXT NOT NULL, messages TEXT NOT NULL,
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relays (
  owner_chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, lead_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (owner_chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS chat_log (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, channel TEXT NOT NULL, role TEXT NOT NULL,
  text TEXT NOT NULL, artifacts TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_log_biz ON chat_log (business_id, created_at);
CREATE TABLE IF NOT EXISTS connections (
  business_id TEXT NOT NULL, kind TEXT NOT NULL, secret TEXT NOT NULL, account TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL, PRIMARY KEY (business_id, kind)
);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, lead_id TEXT NOT NULL, channel TEXT NOT NULL, direction TEXT NOT NULL,
  author TEXT NOT NULL, text TEXT NOT NULL, ext_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_lead ON inbox (lead_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_ext ON inbox (business_id, channel, ext_id);
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, lead_id TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL, note TEXT, due_at TEXT, owner_message_id INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS replies_due ON replies (status, due_at);
`);

/** Eski bazaga yangi ustunlar (jadval allaqachon bor bo'lsa CREATE ularni qo'shmaydi) */
function ensureColumns(table: string, columns: Record<string, string>): void {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));
  for (const [name, type] of Object.entries(columns)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
ensureColumns('replies', { booking: 'TEXT', booked_at: 'TEXT', question: 'TEXT', visit_change: 'TEXT', changed_at: 'TEXT' });
ensureColumns('businesses', { interview: 'TEXT', owner_phone: 'TEXT', setup: 'TEXT', outcome: 'TEXT', evening_date: 'TEXT', brief_sent_date: 'TEXT' });
ensureColumns('tasks', { call_to: 'TEXT', spoken: 'INTEGER NOT NULL DEFAULT 0', lead_id: 'TEXT' });
ensureColumns('leads', { channel: "TEXT NOT NULL DEFAULT 'manual'", bot_started: 'INTEGER NOT NULL DEFAULT 0', tg_access_hash: 'TEXT', ig_user_id: 'TEXT', ig_thread: 'TEXT', last_inbound_at: 'TEXT', next_step: 'TEXT', next_at: 'TEXT', phone_key: 'TEXT', patient_id: 'TEXT' });
db.exec(`UPDATE leads SET channel = 'bot', bot_started = 1 WHERE tg_user_id IS NOT NULL AND channel = 'manual' AND ig_user_id IS NULL AND tg_access_hash IS NULL`);
db.exec('CREATE INDEX IF NOT EXISTS leads_ig ON leads (business_id, ig_user_id)');
db.exec('CREATE INDEX IF NOT EXISTS leads_phone ON leads (business_id, phone_key)');
// Eski bazada telefoni bor, kaliti yo'q mijozlar (bir marta)
for (const r of db.prepare('SELECT id, phone FROM leads WHERE phone IS NOT NULL AND phone_key IS NULL').all() as { id: string; phone: string }[]) {
  db.prepare('UPDATE leads SET phone_key = ? WHERE id = ?').run(phoneKey(r.phone), r.id);
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Qisqa id: faqat harf va raqam (Telegram havolasi va tugmalarida ishlatiladi) */
export const newId = (len = 10): string => [...randomBytes(len)].map(b => ALPHABET[b % ALPHABET.length]).join('');
const nowIso = () => new Date().toISOString();

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const one = <T,>(sql: string, map: (r: Raw) => T, ...args: SQLInputValue[]): T | undefined => {
  const r = db.prepare(sql).get(...args) as Raw | undefined;
  return r ? map(r) : undefined;
};
const many = <T,>(sql: string, map: (r: Raw) => T, ...args: SQLInputValue[]): T[] =>
  (db.prepare(sql).all(...args) as Raw[]).map(map);
const run = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
/** Alohida fayldagi jadvallar uchun (so'rovlar, xodimlar): shu baza va shu yordamchilar */
export const sql = {
  exec: (text: string) => db.exec(text), one, many, run, ensureColumns, nowIso, str, num,
  /** Bir nechta yozuv — hammasi yoki hech biri */
  tx<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const r = work(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};
export type Row = Raw;

// ─── Bizneslar ────────────────────────────────────────────────────────────────

export interface BusinessRow {
  id: string;
  login: string;
  passwordHash: string;
  profile: Business;
  ownerChatId: string | null;
  linkCode: string;
  channelId: string | null;
  channelTitle: string | null;
  active: boolean;
  /** Ertalabki xulosa oxirgi marta qaysi kuni yuborilgan (YYYY-MM-DD) */
  briefDate: string | null;
  /** Birinchi kun suhbatining holati (JSON, brain/interview.ts); null — suhbat ochiq emas */
  interview: string | null;
  /** Egasining telefoni: «qo'ng'iroq qilib eslat» shu raqamga (egasi bir marta aytadi, eslab qolinadi) */
  ownerPhone: string | null;
  /** O'rnatish holati (JSON, setup/state.ts): anketadan qolgan hal qilinmagan narsalar — narx ziddiyatlari, egasida bor kanallar */
  setup: string | null;
  /** Natijasi so'ralgan vazifa (JSON, outcome.ts): egasining keyingi gapi shu vazifaning natijasi deb olinadi */
  outcome: string | null;
  /** Kechki «kun qanday o'tdi» savoli oxirgi marta qaysi kuni berilgan (YYYY-MM-DD) */
  eveningDate: string | null;
  /** Ertalabki reja haqiqatan yuborilgan kun (briefDate — ko'rib chiqilgan kun, aytadigan narsa bo'lmasa ham) */
  briefSentDate: string | null;
  createdAt: string;
}

const toBusiness = (r: Raw): BusinessRow => ({
  id: String(r.id),
  login: String(r.login),
  passwordHash: String(r.password_hash),
  profile: JSON.parse(String(r.profile)) as Business,
  ownerChatId: str(r.owner_chat_id),
  linkCode: String(r.link_code),
  channelId: str(r.channel_id),
  channelTitle: str(r.channel_title),
  active: Number(r.active) === 1,
  briefDate: str(r.brief_date),
  interview: str(r.interview),
  ownerPhone: str(r.owner_phone),
  setup: str(r.setup),
  outcome: str(r.outcome),
  eveningDate: str(r.evening_date),
  briefSentDate: str(r.brief_sent_date),
  createdAt: String(r.created_at),
});

const BIZ_COLUMNS = {
  passwordHash: 'password_hash', profile: 'profile', ownerChatId: 'owner_chat_id', channelId: 'channel_id', linkCode: 'link_code',
  channelTitle: 'channel_title', active: 'active', briefDate: 'brief_date', interview: 'interview', ownerPhone: 'owner_phone',
  setup: 'setup', outcome: 'outcome', eveningDate: 'evening_date', briefSentDate: 'brief_sent_date',
} as const;

export const businesses = {
  create(login: string, passwordHash: string, profile: Business): BusinessRow {
    const id = newId(8);
    run('INSERT INTO businesses (id, login, password_hash, profile, link_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, login, passwordHash, JSON.stringify(profile), newId(12), nowIso());
    return businesses.byId(id)!;
  },
  byId: (id: string) => one('SELECT * FROM businesses WHERE id = ?', toBusiness, id),
  byLogin: (login: string) => one('SELECT * FROM businesses WHERE login = ?', toBusiness, login),
  /** Ulanish havolasi uchun yangi kod (har ulanishdan keyin almashadi — eski havola qayta ishlatilmaydi) */
  newLinkCode: (): string => newId(12),
  byLinkCode: (code: string) => one('SELECT * FROM businesses WHERE link_code = ?', toBusiness, code),
  byOwnerChat: (chatId: string) => one('SELECT * FROM businesses WHERE owner_chat_id = ? AND active = 1', toBusiness, chatId),
  all: () => many('SELECT * FROM businesses ORDER BY created_at DESC', toBusiness),
  update(id: string, patch: Partial<Pick<BusinessRow, keyof typeof BIZ_COLUMNS>>): void {
    const entries = Object.entries(patch) as [keyof typeof BIZ_COLUMNS, unknown][];
    if (!entries.length) return;
    // Bitta Telegram chat — bitta biznes: boshqasiga ulansa, eskisi uziladi
    if (patch.ownerChatId) run('UPDATE businesses SET owner_chat_id = NULL WHERE owner_chat_id = ? AND id <> ?', patch.ownerChatId, id);
    const sets = entries.map(([k]) => `${BIZ_COLUMNS[k]} = ?`).join(', ');
    const values = entries.map(([k, v]) => (k === 'profile' ? JSON.stringify(v) : k === 'active' ? (v ? 1 : 0) : (v as string | null)));
    run(`UPDATE businesses SET ${sets} WHERE id = ?`, ...values, id);
  },
};

// ─── Vazifalar ────────────────────────────────────────────────────────────────

const toTask = (r: Raw): Task & { businessId: string } => ({
  id: String(r.id),
  businessId: String(r.business_id),
  title: String(r.title),
  notes: str(r.notes),
  dueAt: str(r.due_at),
  status: String(r.status) as TaskStatus,
  remindedAt: str(r.reminded_at),
  createdAt: String(r.created_at),
  callTo: str(r.call_to),
  spoken: Number(r.spoken) === 1,
  leadId: str(r.lead_id),
});

export const tasks = {
  create(businessId: string, title: string, dueAt: string | null, notes: string | null, alert: { callTo?: string | null; spoken?: boolean; leadId?: string | null } = {}): Task {
    const id = newId(8);
    run('INSERT INTO tasks (id, business_id, title, notes, due_at, call_to, spoken, lead_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, title, notes, dueAt, alert.callTo ?? null, alert.spoken ? 1 : 0, alert.leadId ?? null, nowIso(), nowIso());
    return tasks.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM tasks WHERE business_id = ? AND id = ?', toTask, businessId, id),
  list: (businessId: string, status: TaskStatus | 'all' = 'all', limit = 200) =>
    status === 'all'
      ? many("SELECT * FROM tasks WHERE business_id = ? AND status <> 'cancelled' ORDER BY status = 'done', COALESCE(due_at, '9999'), created_at DESC LIMIT ?", toTask, businessId, limit)
      : many('SELECT * FROM tasks WHERE business_id = ? AND status = ? ORDER BY COALESCE(due_at, \'9999\'), created_at DESC LIMIT ?', toTask, businessId, status, limit),
  update(businessId: string, id: string, patch: { title?: string; notes?: string | null; dueAt?: string | null; status?: TaskStatus }): Task | undefined {
    const cur = tasks.get(businessId, id);
    if (!cur) return undefined;
    const dueChanged = patch.dueAt !== undefined && patch.dueAt !== cur.dueAt;
    run(`UPDATE tasks SET title = ?, notes = ?, due_at = ?, status = ?, reminded_at = ?, updated_at = ? WHERE business_id = ? AND id = ?`,
      patch.title ?? cur.title, patch.notes !== undefined ? patch.notes : cur.notes, patch.dueAt !== undefined ? patch.dueAt : cur.dueAt,
      patch.status ?? cur.status, dueChanged ? null : cur.remindedAt, nowIso(), businessId, id);
    return tasks.get(businessId, id);
  },
  /** Eslatish vaqti kelgan (mahalliy vaqt satri solishtiriladi) */
  due: (localNow: string) =>
    many(`SELECT t.* FROM tasks t JOIN businesses b ON b.id = t.business_id
      WHERE b.active = 1 AND t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at <= ? AND t.reminded_at IS NULL`, toTask, localNow),
  markReminded: (id: string) => run('UPDATE tasks SET reminded_at = ? WHERE id = ?', nowIso(), id),
  /** Haftalik yakun: oraliqda bajarilgan vazifalar soni (bajarilgan paytdagi updated_at bo'yicha) */
  doneBetween: (businessId: string, fromIso: string, toIso: string) =>
    Number((db.prepare("SELECT COUNT(*) n FROM tasks WHERE business_id = ? AND status = 'done' AND updated_at >= ? AND updated_at < ?").get(businessId, fromIso, toIso) as Raw).n),
  /** Oraliqda egasiga yuborilgan eslatmalar soni (bosh ekran: «Bugun jamoa nima qildi») */
  remindedBetween: (businessId: string, fromIso: string, toIso: string) =>
    Number((db.prepare('SELECT COUNT(*) n FROM tasks WHERE business_id = ? AND reminded_at >= ? AND reminded_at < ?').get(businessId, fromIso, toIso) as Raw).n),
};

// ─── Mijozlar (lidlar) ────────────────────────────────────────────────────────

export interface LeadRow extends Lead {
  businessId: string;
  tgUserId: string | null;
  tgAccessHash: string | null;
  igUserId: string | null;
  /** Instagram'dagi suhbat (Direct) — Palantir shu suhbatga yozadi */
  igThread: string | null;
  /** Palantir botida /start bosgan — bot unga yoza oladi */
  botStarted: boolean;
  postId: string | null;
}

const connected = (businessId: string, kind: string) => !!db.prepare('SELECT 1 FROM connections WHERE business_id = ? AND kind = ?').get(businessId, kind);

const toLead = (r: Raw): LeadRow => {
  const businessId = String(r.business_id);
  const channel = String(r.channel) as LeadChannel;
  const lastInboundAt = str(r.last_inbound_at);
  const botStarted = Number(r.bot_started) === 1;
  // Telefon bo'yicha faqat egasi o'zi kiritgan mijozga yoziladi (telegramUser.ts dagi qoida bilan bir xil)
  const viaTelegram = (channel === 'telegram' || channel === 'manual') && !!((r.tg_user_id && r.tg_access_hash) || r.username || (r.phone && channel === 'manual'))
    && connected(businessId, 'telegram');
  const viaInstagram = channel === 'instagram' && !!r.ig_thread && (connected(businessId, 'instagram') || connected(businessId, 'instagram_api'));
  return {
    id: String(r.id),
    businessId,
    name: str(r.name),
    phone: str(r.phone),
    username: str(r.username),
    tgUserId: str(r.tg_user_id),
    tgAccessHash: str(r.tg_access_hash),
    igUserId: str(r.ig_user_id),
    igThread: str(r.ig_thread),
    botStarted,
    reachable: botStarted || viaTelegram || viaInstagram,
    channel,
    lastInboundAt,
    stage: String(r.stage) as LeadStage,
    note: str(r.note),
    source: str(r.source),
    nextStep: str(r.next_step),
    nextAt: str(r.next_at),
    patientId: str(r.patient_id),
    postId: str(r.post_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
};

/** Panelga ko'rsatiladigan qismi (ichki id va kalitlarsiz) */
export const publicLead = (l: LeadRow): Lead => ({
  id: l.id, name: l.name, phone: l.phone, username: l.username, reachable: l.reachable, channel: l.channel, lastInboundAt: l.lastInboundAt,
  stage: l.stage, note: l.note, source: l.source, nextStep: l.nextStep, nextAt: l.nextAt, patientId: l.patientId ?? null, createdAt: l.createdAt, updatedAt: l.updatedAt,
});

export interface ChannelPerson {
  tgUserId?: string;
  tgAccessHash?: string;
  igUserId?: string;
  igThread?: string;
  name: string | null;
  username: string | null;
  phone?: string | null;
}

export const leads = {
  /** Qo'lda qo'shilgan (egasi aytdi) */
  add(businessId: string, v: { name: string | null; phone: string | null; note: string | null; source: string | null; username?: string | null }): LeadRow {
    const id = newId(10);
    run('INSERT INTO leads (id, business_id, name, phone, phone_key, username, note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, v.name, v.phone, phoneKey(v.phone), v.username ?? null, v.note, v.source, nowIso(), nowIso());
    return leads.get(businessId, id)!;
  },
  /** Havola orqali botga kelgan odam: bir biznesda bir odam — bitta yozuv */
  fromTelegram(businessId: string, tgUserId: string, name: string | null, username: string | null, source: string | null, postId: string | null): LeadRow {
    const existing = one('SELECT * FROM leads WHERE business_id = ? AND tg_user_id = ?', toLead, businessId, tgUserId);
    if (existing) {
      run('UPDATE leads SET bot_started = 1, updated_at = ? WHERE id = ?', nowIso(), existing.id);
      return leads.get(businessId, existing.id)!;
    }
    const id = newId(10);
    run(`INSERT INTO leads (id, business_id, name, username, tg_user_id, source, post_id, channel, bot_started, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'bot', 1, ?, ?)`,
      id, businessId, name, username, tgUserId, source, postId, nowIso(), nowIso());
    return leads.get(businessId, id)!;
  },
  /** Bot, shaxsiy Telegram yoki Instagram'da yozgan odam: topiladi yoki yaratiladi; oxirgi yozgan kanali belgilanadi */
  fromChannel(businessId: string, channel: 'telegram' | 'instagram' | 'bot', p: ChannelPerson, source: string): { lead: LeadRow; created: boolean } {
    const existing = p.igUserId
      ? one('SELECT * FROM leads WHERE business_id = ? AND ig_user_id = ?', toLead, businessId, p.igUserId)
      : p.tgUserId ? one('SELECT * FROM leads WHERE business_id = ? AND tg_user_id = ?', toLead, businessId, p.tgUserId) : undefined;
    const now = nowIso();
    if (existing) {
      run(`UPDATE leads SET channel = ?, last_inbound_at = ?, updated_at = ?, name = COALESCE(name, ?), username = COALESCE(username, ?),
        phone = COALESCE(phone, ?), phone_key = COALESCE(phone_key, ?), tg_access_hash = COALESCE(?, tg_access_hash), ig_thread = COALESCE(?, ig_thread) WHERE id = ?`,
        channel, now, now, p.name, p.username, p.phone ?? null, phoneKey(p.phone), p.tgAccessHash ?? null, p.igThread ?? null, existing.id);
      return { lead: leads.get(businessId, existing.id)!, created: false };
    }
    const id = newId(10);
    run(`INSERT INTO leads (id, business_id, name, username, phone, phone_key, tg_user_id, tg_access_hash, ig_user_id, ig_thread, channel, source, last_inbound_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, businessId, p.name, p.username, p.phone ?? null, phoneKey(p.phone), p.tgUserId ?? null, p.tgAccessHash ?? null, p.igUserId ?? null, p.igThread ?? null, channel, source, now, now, now);
    return { lead: leads.get(businessId, id)!, created: true };
  },
  /** Egasi birinchi yozgan odam (Palantir Telegram'da topib yozdi) — Telegram id'si saqlanadi */
  setTelegramPeer: (businessId: string, id: string, tgUserId: string, accessHash: string) =>
    run("UPDATE leads SET tg_user_id = ?, tg_access_hash = ?, channel = CASE WHEN channel = 'manual' THEN 'telegram' ELSE channel END WHERE business_id = ? AND id = ?",
      tgUserId, accessHash, businessId, id),
  get: (businessId: string, id: string) => one('SELECT * FROM leads WHERE business_id = ? AND id = ?', toLead, businessId, id),
  byTelegram: (businessId: string, tgUserId: string) => one('SELECT * FROM leads WHERE business_id = ? AND tg_user_id = ?', toLead, businessId, tgUserId),
  byInstagram: (businessId: string, igUserId: string) => one('SELECT * FROM leads WHERE business_id = ? AND ig_user_id = ?', toLead, businessId, igUserId),
  /** Botga yozayotgan odam qaysi biznes mijozi (oxirgi bosgan havolasi bo'yicha) */
  latestForUser: (tgUserId: string) => one('SELECT * FROM leads WHERE tg_user_id = ? AND bot_started = 1 ORDER BY updated_at DESC LIMIT 1', toLead, tgUserId),
  list: (businessId: string, stage: LeadStage | 'all' = 'all', sinceIso?: string, limit = 300) =>
    many(`SELECT * FROM leads WHERE business_id = ? AND (? = 'all' OR stage = ?) AND created_at >= ? ORDER BY created_at DESC LIMIT ?`,
      toLead, businessId, stage, stage, sinceIso ?? '0000', limit),
  update(businessId: string, id: string, patch: { stage?: LeadStage; note?: string | null; phone?: string | null; name?: string | null; nextStep?: string | null; nextAt?: string | null }): LeadRow | undefined {
    const cur = leads.get(businessId, id);
    if (!cur) return undefined;
    const pick = <K extends keyof typeof patch>(k: K, old: LeadRow[K & keyof LeadRow]) => (patch[k] !== undefined ? patch[k] : old);
    // Yutildi yoki yo'qotildi — keyingi qadam qolmaydi (rejada «bugun qilish kerak» bo'lib chiqmasin), yangisi to'liq berilmasa
    const closed = (patch.stage === 'won' || patch.stage === 'lost') && !(patch.nextStep && patch.nextAt);
    const phone = pick('phone', cur.phone);
    run('UPDATE leads SET stage = ?, note = ?, phone = ?, phone_key = ?, name = ?, next_step = ?, next_at = ?, updated_at = ? WHERE business_id = ? AND id = ?',
      patch.stage ?? cur.stage, pick('note', cur.note), phone, phoneKey(phone), pick('name', cur.name),
      closed ? null : pick('nextStep', cur.nextStep), closed ? null : pick('nextAt', cur.nextAt),
      nowIso(), businessId, id);
    return leads.get(businessId, id);
  },
  /** Haftalik yakun: oraliqda qo'shilgan mijozlar soni */
  addedBetween: (businessId: string, fromIso: string, toIso: string) =>
    Number((db.prepare('SELECT COUNT(*) n FROM leads WHERE business_id = ? AND created_at >= ? AND created_at < ?').get(businessId, fromIso, toIso) as Raw).n),
  /** Kunlik reja uchun: faol (yutilmagan va yo'qotilmagan) mijozlar */
  active: (businessId: string, limit = 2000) =>
    // Eng uzoq jim turganlari birinchi: chegaraga yetsa ham «unutilgan»lar tushib qolmasin
    many("SELECT * FROM leads WHERE business_id = ? AND stage IN ('new', 'contacted') ORDER BY updated_at ASC LIMIT ?", toLead, businessId, limit),
  markInbound: (id: string) => run('UPDATE leads SET last_inbound_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id),
  /** Shu telefon raqamli mijozlar (kalit — oxirgi 9 raqam), eng eskisi birinchi */
  byPhone: (businessId: string, phone: string | null) => {
    const key = phoneKey(phone);
    return key ? many('SELECT * FROM leads WHERE business_id = ? AND phone_key = ? ORDER BY created_at', toLead, businessId, key) : [];
  },
  setPatient: (businessId: string, id: string, patientId: string | null) => run('UPDATE leads SET patient_id = ? WHERE business_id = ? AND id = ?', patientId, businessId, id),
};

// ─── Ulanishlar: shaxsiy Telegram, Instagram (maxfiy qismi shifrlangan) ──────

/** instagram — brauzer orqali (egasining akkaunti); instagram_api — rasmiy Instagram API (Meta ilovasi, Palantir Hub orqali) */
export type ConnectionKind = 'telegram' | 'instagram' | 'instagram_api' | 'dentacrm' | 'sip_line';
export interface ConnectionRow { businessId: string; kind: ConnectionKind; secret: string; account: Record<string, string>; meta: Record<string, string>; updatedAt: string }

const toConnection = (r: Raw): ConnectionRow => ({
  businessId: String(r.business_id), kind: String(r.kind) as ConnectionKind, secret: String(r.secret),
  account: JSON.parse(String(r.account)), meta: JSON.parse(String(r.meta)), updatedAt: String(r.updated_at),
});

export const connections = {
  get: (businessId: string, kind: ConnectionKind) => one('SELECT * FROM connections WHERE business_id = ? AND kind = ?', toConnection, businessId, kind),
  all: (kind: ConnectionKind) => many('SELECT * FROM connections WHERE kind = ?', toConnection, kind),
  byAccount: (kind: ConnectionKind, accountId: string) =>
    one("SELECT * FROM connections WHERE kind = ? AND json_extract(account, '$.id') = ?", toConnection, kind, accountId),
  save(businessId: string, kind: ConnectionKind, secret: string, account: Record<string, string>, meta: Record<string, string> = {}): void {
    run(`INSERT INTO connections (business_id, kind, secret, account, meta, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (business_id, kind) DO UPDATE SET secret = excluded.secret, account = excluded.account, meta = excluded.meta, updated_at = excluded.updated_at`,
      businessId, kind, secret, JSON.stringify(account), JSON.stringify(meta), nowIso());
  },
  setMeta: (businessId: string, kind: ConnectionKind, meta: Record<string, string>) =>
    run('UPDATE connections SET meta = ? WHERE business_id = ? AND kind = ?', JSON.stringify(meta), businessId, kind),
  /** Bir nechta maydonni o'zgartiradi (qolganlari joyida qoladi); undefined — o'chiradi */
  patchMeta(businessId: string, kind: ConnectionKind, patch: Record<string, string | undefined>): void {
    const cur = connections.get(businessId, kind);
    if (!cur) return;
    const meta: Record<string, string> = { ...cur.meta };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete meta[k]; else meta[k] = v; }
    connections.setMeta(businessId, kind, meta);
  },
  setSecret: (businessId: string, kind: ConnectionKind, secret: string) =>
    run('UPDATE connections SET secret = ?, updated_at = ? WHERE business_id = ? AND kind = ?', secret, nowIso(), businessId, kind),
  remove: (businessId: string, kind: ConnectionKind) => run('DELETE FROM connections WHERE business_id = ? AND kind = ?', businessId, kind),
};

// ─── Mijozlar bilan yozishma va javoblar ──────────────────────────────────────

const toInbox = (r: Raw): InboxMessage => ({
  id: String(r.id), leadId: String(r.lead_id), channel: String(r.channel) as LeadChannel, direction: String(r.direction) as InboxMessage['direction'],
  by: String(r.author) as InboxMessage['by'], text: String(r.text), createdAt: String(r.created_at),
});

export const inbox = {
  /** Qo'shadi; shu xabar (ext_id) allaqachon bo'lsa — null (webhook qayta yuborsa ikki marta ishlanmaydi) */
  add(businessId: string, m: { leadId: string; channel: LeadChannel; direction: 'in' | 'out'; by: InboxMessage['by']; text: string; extId?: string | null; at?: string }): InboxMessage | null {
    const id = newId(12);
    const r = run('INSERT OR IGNORE INTO inbox (id, business_id, lead_id, channel, direction, author, text, ext_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, m.leadId, m.channel, m.direction, m.by, m.text, m.extId ?? null, m.at ?? nowIso());
    // Mijozga yozildi — u «unutilgan» emas (kunlik reja oxirgi faollikni shundan biladi)
    if (Number(r.changes) && m.direction === 'out') run('UPDATE leads SET updated_at = ? WHERE business_id = ? AND id = ?', nowIso(), businessId, m.leadId);
    return Number(r.changes) ? one('SELECT * FROM inbox WHERE id = ?', toInbox, id)! : null;
  },
  has: (businessId: string, channel: LeadChannel, extId: string) =>
    !!db.prepare('SELECT 1 FROM inbox WHERE business_id = ? AND channel = ? AND ext_id = ?').get(businessId, channel, extId),
  thread: (businessId: string, leadId: string, limit = 30) =>
    many('SELECT * FROM (SELECT *, rowid AS rn FROM inbox WHERE business_id = ? AND lead_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, rn',
      toInbox, businessId, leadId, limit),
  last: (businessId: string, leadId: string) =>
    one('SELECT * FROM inbox WHERE business_id = ? AND lead_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', toInbox, businessId, leadId),
  /** Yozishmasi bor mijozlar, oxirgi xabar bo'yicha */
  threads: (businessId: string, limit = 100) =>
    many('SELECT lead_id, MAX(created_at) AS at FROM inbox WHERE business_id = ? GROUP BY lead_id ORDER BY at DESC LIMIT ?', r => String(r.lead_id), businessId, limit),
};

/** question — Palantir egasidan so'ragan umumiy savol (javobini eslab qolish mumkin); o'rganilgach bo'shatiladi */
export type ReplyRow = ReplyDraft & { businessId: string; ownerMessageId: number | null; question: string | null };

const BOOKING_FIELDS = ['doctorId', 'doctorName', 'date', 'time', 'name', 'phone'] as const;
/** Buzilgan yozuv ro'yxatni to'xtatmasin va oddiy javobga ham aylanmasin: maydonlari bo'sh qabul hech qanday tekshiruvdan o'tmaydi */
function toBooking(raw: unknown): ReplyBooking | null {
  if (!raw) return null;
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(String(raw)) ?? {}; } catch { /* pastda bo'sh maydonlar */ }
  const field = (k: string) => (typeof j[k] === 'string' ? j[k] : '');
  const [doctorId, doctorName, date, time, name, phone] = BOOKING_FIELDS.map(field);
  return { doctorId, doctorName, date, time, name, phone };
}

const toReply = (r: Raw): ReplyRow => ({
  id: String(r.id), businessId: String(r.business_id), leadId: String(r.lead_id), channel: String(r.channel) as LeadChannel, text: String(r.text),
  status: String(r.status) as ReplyStatus, note: str(r.note), dueAt: str(r.due_at), ownerMessageId: num(r.owner_message_id), createdAt: String(r.created_at),
  booking: toBooking(r.booking), bookedAt: str(r.booked_at), question: str(r.question),
  change: toChange(r.visit_change), changedAt: str(r.changed_at),
});
const toChange = (v: unknown): VisitChange | null => {
  try { const c = v ? JSON.parse(String(v)) as VisitChange : null; return c && (c.kind === 'move' || c.kind === 'cancel') && c.appointmentId ? c : null; } catch { return null; }
};

export const replies = {
  create(businessId: string, v: { leadId: string; channel: LeadChannel; text: string; status: 'pending' | 'scheduled' | 'sent'; note: string | null; dueAt: string | null; booking?: ReplyBooking | null; question?: string | null; change?: VisitChange | null }): ReplyRow {
    const id = newId(10);
    run('INSERT INTO replies (id, business_id, lead_id, channel, text, status, note, due_at, booking, question, visit_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, v.leadId, v.channel, v.text, v.status, v.note, v.dueAt, v.booking ? JSON.stringify(v.booking) : null, v.question || null, v.change ? JSON.stringify(v.change) : null, nowIso());
    return replies.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM replies WHERE business_id = ? AND id = ?', toReply, businessId, id),
  open: (businessId: string, leadId: string) =>
    many("SELECT * FROM replies WHERE business_id = ? AND lead_id = ? AND status IN ('pending', 'scheduled') ORDER BY created_at", toReply, businessId, leadId),
  /** Biznes bo'yicha egasining tasdig'ini kutayotgan javoblar (kunlik reja uchun) */
  /** Egasining tasdig'ini kutayotgan javoblar (bosh ekran: «Sizni kutyapti»), yangisi tepada */
  pendingList: (businessId: string, limit = 20) =>
    many("SELECT * FROM replies WHERE business_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT ?", toReply, businessId, limit),
  pendingTotal: (businessId: string) =>
    Number((db.prepare("SELECT COUNT(*) n FROM replies WHERE business_id = ? AND status = 'pending'").get(businessId) as Raw).n),
  countPending: (businessId: string, leadId: string) =>
    Number((db.prepare("SELECT COUNT(*) n FROM replies WHERE business_id = ? AND lead_id = ? AND status = 'pending'").get(businessId, leadId) as Raw).n),
  /** Vaqti kelgan javoblar. Qabulli javob bu yo'l bilan hech qachon ketmaydi: u faqat qabul CRM'ga yozilgach yuboriladi */
  due: (nowIsoStr: string) => many("SELECT * FROM replies WHERE status = 'scheduled' AND due_at <= ? AND booking IS NULL", toReply, nowIsoStr),
  /** Holatni o'zgartiradi, faqat kutilgan holatdan (ikki marta yuborilmasin) — o'zgargan bo'lsa true */
  move: (businessId: string, id: string, from: ReplyStatus[], to: ReplyStatus) =>
    Number(run(`UPDATE replies SET status = ? WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`, to, businessId, id, ...from).changes) > 0,
  /** Egasidagi kartaga «Reply» qilinganda: o'sha karta qaysi taklif edi */
  byOwnerMessage: (businessId: string, messageId: number) => one('SELECT * FROM replies WHERE business_id = ? AND owner_message_id = ?', toReply, businessId, messageId),
  /**
   * Shu mijoz bo'yicha egasidan so'ralgan oxirgi savol (shu vaqtdan beri). Bir marta olinadi: egasining bitta javobi ikki marta o'rganilmasin
   */
  takeQuestion(businessId: string, leadId: string, sinceIso: string): string | null {
    const r = one('SELECT id, question FROM replies WHERE business_id = ? AND lead_id = ? AND question IS NOT NULL AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT 1', x => ({ id: String(x.id), question: String(x.question) }), businessId, leadId, sinceIso);
    if (!r || Number(run('UPDATE replies SET question = NULL WHERE business_id = ? AND id = ? AND question IS NOT NULL', businessId, r.id).changes) === 0) return null;
    // Shu mijozning eskirgan takliflaridagi savollar ham yopiladi: keyingi (boshqa mavzudagi) xabar ularga javob deb olinmasin
    run('UPDATE replies SET question = NULL WHERE business_id = ? AND lead_id = ? AND question IS NOT NULL', businessId, leadId);
    return r.question;
  },
  setOwnerMessage: (businessId: string, id: string, messageId: number) =>
    run('UPDATE replies SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
  /** CRM'ga yozish boshlangan, lekin tugagani qayd etilmagan qabullar (server o'sha paytda to'xtagan) */
  unfinished: () => many("SELECT * FROM replies WHERE status = 'sent' AND booking IS NOT NULL AND booked_at IS NULL", toReply),
  /** Qabul CRM'ga yozildi (javob yuborilmay qolsa, qayta urinishda ikkinchi marta yozilmasin) */
  setBooked: (businessId: string, id: string) => run('UPDATE replies SET booked_at = ? WHERE business_id = ? AND id = ?', nowIso(), businessId, id),
  setChanged: (businessId: string, id: string) => run('UPDATE replies SET changed_at = ? WHERE business_id = ? AND id = ?', nowIso(), businessId, id),
  /** Shu mijoz uchun shu paytdan beri o'zi ko'chirilgan/bekor qilingan qabullar (tasdiqsiz yozish chegarasi) */
  changes: (businessId: string, leadId: string, sinceIso: string) =>
    Number((db.prepare('SELECT COUNT(*) n FROM replies WHERE business_id = ? AND lead_id = ? AND changed_at >= ?').get(businessId, leadId, sinceIso) as Raw).n),
  /**
   * Shu vaqtdan beri qabulli javoblar soni: butun biznes, bitta suhbat yoki bitta telefon bo'yicha.
   * Hozir yozilayotgani ham kiradi (holat CRM'ga murojaatdan oldin «sent» bo'ladi) — ketma-ket so'rovlar chegaradan o'tib ketmasin
   */
  bookings(businessId: string, sinceIso: string, by: { leadId?: string; phone?: string } = {}): number {
    const filters = [by.leadId ? 'AND lead_id = ?' : '', by.phone ? "AND CASE WHEN json_valid(booking) THEN json_extract(booking, '$.phone') END = ?" : ''].join(' ');
    const args = [by.leadId, by.phone].filter((v): v is string => !!v);
    return Number((db.prepare(`SELECT COUNT(*) n FROM replies WHERE business_id = ? AND booking IS NOT NULL AND status = 'sent' AND created_at >= ? ${filters}`)
      .get(businessId, sinceIso, ...args) as Raw).n);
  },
};

// ─── Hujjatlar ────────────────────────────────────────────────────────────────

const toDoc = (r: Raw): Doc => ({ id: String(r.id), title: String(r.title), kind: String(r.kind), markdown: String(r.markdown), createdAt: String(r.created_at) });

export const documents = {
  create(businessId: string, title: string, kind: string, markdown: string): Doc {
    const id = newId(10);
    run('INSERT INTO documents (id, business_id, title, kind, markdown, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, businessId, title, kind, markdown, nowIso());
    return documents.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM documents WHERE business_id = ? AND id = ?', toDoc, businessId, id),
  list: (businessId: string, limit = 200) => many('SELECT * FROM documents WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toDoc, businessId, limit),
};

// ─── Postlar ──────────────────────────────────────────────────────────────────

export interface PostRow extends Post { businessId: string; ownerMessageId: number | null; channelMessageId: number | null }

const toPost = (r: Raw): PostRow => ({
  id: String(r.id),
  businessId: String(r.business_id),
  item: JSON.parse(String(r.item)) as ContentItem,
  status: String(r.status) as PostStatus,
  inChannel: r.channel_message_id != null,
  channelMessageId: num(r.channel_message_id),
  publishedAt: str(r.published_at),
  ownerMessageId: num(r.owner_message_id),
  createdAt: String(r.created_at),
});

export const posts = {
  create(businessId: string, item: ContentItem): PostRow {
    const id = item.id;
    run('INSERT INTO posts (id, business_id, item, created_at) VALUES (?, ?, ?, ?)', id, businessId, JSON.stringify(item), nowIso());
    return posts.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM posts WHERE business_id = ? AND id = ?', toPost, businessId, id),
  list: (businessId: string, limit = 100) => many("SELECT * FROM posts WHERE business_id = ? AND status <> 'deleted' ORDER BY created_at DESC LIMIT ?", toPost, businessId, limit),
  setItem: (businessId: string, id: string, item: ContentItem) => run('UPDATE posts SET item = ? WHERE business_id = ? AND id = ?', JSON.stringify(item), businessId, id),
  setStatus: (businessId: string, id: string, status: PostStatus) => run('UPDATE posts SET status = ? WHERE business_id = ? AND id = ?', status, businessId, id),
  setPublished: (businessId: string, id: string, channelMessageId: number | null) =>
    run("UPDATE posts SET status = 'published', published_at = ?, channel_message_id = ? WHERE business_id = ? AND id = ?", nowIso(), channelMessageId, businessId, id),
  setOwnerMessage: (businessId: string, id: string, messageId: number) => run('UPDATE posts SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
};

// ─── Mijozlarga xabar (follow-up) ─────────────────────────────────────────────

export interface OutboundRow extends Outbound { businessId: string; ownerMessageId: number | null }

const toOutbound = (r: Raw): OutboundRow => {
  const ids = JSON.parse(String(r.lead_ids)) as string[];
  // Palantir yoza oladiganlar: botga yozgan, shaxsiy Telegram yoki Instagram orqali yozishgan
  const reachable = ids.filter(id => leads.get(String(r.business_id), id)?.reachable).length;
  return {
    id: String(r.id), businessId: String(r.business_id), text: String(r.text), leadIds: ids, reachable,
    status: String(r.status) as OutboundStatus, sentCount: Number(r.sent_count), ownerMessageId: num(r.owner_message_id), createdAt: String(r.created_at),
  };
};

export const outbound = {
  create(businessId: string, text: string, leadIds: string[]): OutboundRow {
    const id = newId(10);
    run('INSERT INTO outbound (id, business_id, text, lead_ids, created_at) VALUES (?, ?, ?, ?, ?)', id, businessId, text, JSON.stringify(leadIds), nowIso());
    return outbound.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM outbound WHERE business_id = ? AND id = ?', toOutbound, businessId, id),
  list: (businessId: string, limit = 50) => many('SELECT * FROM outbound WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toOutbound, businessId, limit),
  /** Shu paytdan beri tayyorlangan xabarlar soni (bosh ekran: «Bugun jamoa nima qildi») */
  countSince: (businessId: string, fromIso: string) =>
    Number((db.prepare('SELECT COUNT(*) n FROM outbound WHERE business_id = ? AND created_at >= ?').get(businessId, fromIso) as Raw).n),
  /** Faqat qoralama holatidan o'tadi (ikki marta yuborilmasin) — o'zgargan bo'lsa true */
  finish: (businessId: string, id: string, status: 'sent' | 'cancelled', sentCount = 0) =>
    Number(run("UPDATE outbound SET status = ?, sent_count = ? WHERE business_id = ? AND id = ? AND status = 'draft'", status, sentCount, businessId, id).changes) > 0,
  setSentCount: (businessId: string, id: string, n: number) => run('UPDATE outbound SET sent_count = ? WHERE business_id = ? AND id = ?', n, businessId, id),
  setOwnerMessage: (businessId: string, id: string, messageId: number) => run('UPDATE outbound SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
};

// ─── Pul yozuvlari (DentaCRM) ─────────────────────────────────────────────────

/** payload — CRM'ga yoziladigan ma'lumot (JSON, faqat server yozadi: crm/actions.ts) */
export type MoneyRow = Omit<MoneyEntry, 'canUndo'> & { businessId: string; payload: string; crmId: string | null; ownerMessageId: number | null; doneAt: string | null };

const lines = (raw: unknown): string[] => {
  try { const v: unknown = JSON.parse(String(raw)); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};
const toMoney = (r: Raw): MoneyRow => ({
  id: String(r.id), businessId: String(r.business_id), kind: String(r.kind) as MoneyKind, payload: String(r.payload), title: String(r.title), details: lines(r.details),
  status: String(r.status) as MoneyStatus, note: str(r.note), crmId: str(r.crm_id), ownerMessageId: num(r.owner_message_id), createdAt: String(r.created_at), doneAt: str(r.done_at),
});

export const moneyEntries = {
  create(businessId: string, kind: MoneyKind, payload: string, title: string, details: string[]): MoneyRow {
    const id = newId(10);
    run('INSERT INTO money_entries (id, business_id, kind, payload, title, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, businessId, kind, payload, title, JSON.stringify(details), nowIso());
    return moneyEntries.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM money_entries WHERE business_id = ? AND id = ?', toMoney, businessId, id),
  /** Holat faqat kutilgan holatdan o'tadi (ikki marta bosilsa — bir marta yoziladi); o'zgargan bo'lsa true. patch'da berilmagan maydon o'zgarmaydi */
  move(businessId: string, id: string, from: MoneyStatus[], to: MoneyStatus, patch: { note?: string | null; crmId?: string; doneAt?: string } = {}): boolean {
    const sets = ['status = ?', ...('note' in patch ? ['note = ?'] : []), ...(patch.crmId ? ['crm_id = ?'] : []), ...(patch.doneAt ? ['done_at = ?'] : [])];
    const values: SQLInputValue[] = [to, ...('note' in patch ? [patch.note ?? null] : []), ...(patch.crmId ? [patch.crmId] : []), ...(patch.doneAt ? [patch.doneAt] : [])];
    return Number(run(`UPDATE money_entries SET ${sets.join(', ')} WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`, ...values, businessId, id, ...from).changes) > 0;
  },
  setOwnerMessage: (businessId: string, id: string, messageId: number) => run('UPDATE money_entries SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
  /** Kunlik chegara uchun: shu vaqtdan beri yozilganlar (ortga qaytarilgani ham), hozir yozilayotgan va natijasi noma'lumlar — soni va jami summasi */
  usedSince(businessId: string, sinceIso: string): { count: number; sum: number } {
    const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(json_extract(payload, '$.amount')), 0) total FROM money_entries WHERE business_id = ? AND (done_at >= ? OR (status IN ('running', 'unknown') AND created_at >= ?))")
      .get(businessId, sinceIso, sinceIso) as Raw;
    return { count: Number(r.n), sum: Number(r.total) };
  },
  /** Aynan shunday, hali tasdiqlanmagan taklif (bir xil gap ikki marta aytilsa ikkita karta emas — bitta yozuv) */
  findDraft: (businessId: string, payload: string, sinceIso: string) =>
    one("SELECT * FROM money_entries WHERE business_id = ? AND payload = ? AND status = 'draft' AND created_at >= ? ORDER BY created_at DESC LIMIT 1", toMoney, businessId, payload, sinceIso),
  /** Yozish boshlangan, lekin tugagani qayd etilmaganlar (server o'sha paytda to'xtagan) */
  running: () => many("SELECT * FROM money_entries WHERE status = 'running'", toMoney),
};

// ─── Eslab qolingan faktlar ───────────────────────────────────────────────────

const toNote = (r: Raw): Note => ({ id: String(r.id), text: String(r.text), createdAt: String(r.created_at) });

export const notes = {
  add(businessId: string, text: string): Note {
    const id = newId(8);
    run('INSERT INTO notes (id, business_id, text, created_at) VALUES (?, ?, ?, ?)', id, businessId, text, nowIso());
    return { id, text, createdAt: nowIso() };
  },
  list: (businessId: string) => many('SELECT * FROM notes WHERE business_id = ? ORDER BY created_at', toNote, businessId),
  remove: (businessId: string, id: string) => Number(run('DELETE FROM notes WHERE business_id = ? AND id = ?', businessId, id).changes) > 0,
};

// ─── Suhbat (Claude bilan) va jurnal ──────────────────────────────────────────

export interface Conversation { system: string; toolsKey: string; messages: unknown[]; startedAt: string; updatedAt: string }

/** Claude bilan suhbat: biznesga bitta (Telegram ham, panel ham shu suhbatni davom ettiradi) */
export const conversations = {
  get: (businessId: string) => one('SELECT * FROM conversations WHERE business_id = ?',
    (r): Conversation => ({ system: String(r.system), toolsKey: String(r.tools_key), messages: JSON.parse(String(r.messages)), startedAt: String(r.started_at), updatedAt: String(r.updated_at) }),
    businessId),
  save(businessId: string, c: Omit<Conversation, 'updatedAt'>): void {
    run(`INSERT INTO conversations (business_id, system, tools_key, messages, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (business_id) DO UPDATE SET system = excluded.system, tools_key = excluded.tools_key, messages = excluded.messages,
      started_at = excluded.started_at, updated_at = excluded.updated_at`,
      businessId, c.system, c.toolsKey, JSON.stringify(c.messages), c.startedAt, nowIso());
  },
  reset: (businessId: string) => run('DELETE FROM conversations WHERE business_id = ?', businessId),
};

/** Egasiga yuborilgan mijoz xabari → qaysi mijoz (egasi shu xabarga javob yozsa, mijozga boradi) */
export const relays = {
  add: (ownerChatId: string, messageId: number, leadId: string) =>
    run('INSERT OR REPLACE INTO relays (owner_chat_id, message_id, lead_id, created_at) VALUES (?, ?, ?, ?)', ownerChatId, messageId, leadId, nowIso()),
  leadFor: (ownerChatId: string, messageId: number) =>
    one('SELECT lead_id FROM relays WHERE owner_chat_id = ? AND message_id = ?', r => String(r.lead_id), ownerChatId, messageId),
};

export const chatLog = {
  add(businessId: string, channel: ChatEntry['channel'], role: ChatEntry['role'], text: string, artifacts: Artifact[] = []): ChatEntry {
    const id = newId(12);
    const createdAt = nowIso();
    run('INSERT INTO chat_log (id, business_id, channel, role, text, artifacts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, businessId, channel, role, text, JSON.stringify(artifacts), createdAt);
    return { id, role, channel, text, artifacts, createdAt };
  },
  recent: (businessId: string, limit = 60) => many('SELECT * FROM (SELECT * FROM chat_log WHERE business_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at',
    (r): ChatEntry => ({ id: String(r.id), role: String(r.role) as ChatEntry['role'], channel: String(r.channel) as ChatEntry['channel'], text: String(r.text), artifacts: r.artifacts ? JSON.parse(String(r.artifacts)) : [], createdAt: String(r.created_at) }),
    businessId, limit),
};

// ─── Kameralar va qo'ng'iroqlar ──────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT NOT NULL, zones TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS camera_sessions (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, camera_id TEXT NOT NULL, zone_id TEXT NOT NULL, kind TEXT NOT NULL, zone_name TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE INDEX IF NOT EXISTS camera_sessions_day ON camera_sessions (business_id, started_at);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT, started_at TEXT NOT NULL, duration_sec INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL, transcript TEXT NOT NULL DEFAULT '[]', booked TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_keys (business_id TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_bookings (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS calls_day ON calls (business_id, started_at);
`);
ensureColumns('cameras', { seen_from: 'TEXT', stream: 'TEXT', stream_host: 'TEXT', profile: 'TEXT' });

/** Buzilgan JSON butun sahifani yiqitmasin: o'qilmasa — bo'sh ro'yxat */
const list = <T,>(v: unknown): T[] => { try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : []; } catch { return []; } };
const toCamera = (r: Raw): Camera => ({ id: String(r.id), name: String(r.name), zones: list<CameraZone>(r.zones), createdAt: String(r.created_at), lastSeenAt: str(r.last_seen_at), seenFrom: str(r.seen_from), ip: str(r.stream_host), feed: null, profile: str(r.profile) });
const toSession = (r: Raw): CameraSession => ({
  id: String(r.id), cameraId: String(r.camera_id), zoneId: String(r.zone_id), kind: String(r.kind) as ZoneKind, zoneName: String(r.zone_name), startedAt: String(r.started_at), endedAt: str(r.ended_at),
});

export const cameras = {
  list: (businessId: string) => many('SELECT * FROM cameras WHERE business_id = ? ORDER BY created_at', toCamera, businessId),
  get: (businessId: string, id: string) => one('SELECT * FROM cameras WHERE business_id = ? AND id = ?', toCamera, businessId, id),
  create(businessId: string, name: string): Camera {
    const id = newId(10);
    run('INSERT INTO cameras (id, business_id, name, created_at) VALUES (?, ?, ?, ?)', id, businessId, name, nowIso());
    return cameras.get(businessId, id)!;
  },
  setProfile: (businessId: string, id: string, profile: string | null) => run('UPDATE cameras SET profile = ? WHERE business_id = ? AND id = ?', profile, businessId, id),
  setZones: (businessId: string, id: string, zones: CameraZone[]) => run('UPDATE cameras SET zones = ? WHERE business_id = ? AND id = ?', JSON.stringify(zones), businessId, id),
  /** IP kamera manzili: shifrlangan holda (ichida kamera paroli bor); host — panelda ko'rsatish uchun. null — uziladi */
  setStream: (businessId: string, id: string, sealed: string | null, host: string | null) => run('UPDATE cameras SET stream = ?, stream_host = ? WHERE business_id = ? AND id = ?', sealed, host, businessId, id),
  stream: (businessId: string, id: string) => one('SELECT stream FROM cameras WHERE business_id = ? AND id = ?', r => str(r.stream), businessId, id) ?? null,
  /** Hamma bizneslarning IP kameralari (kamera dvigateli uchun) */
  streams: () => many('SELECT id, business_id, stream FROM cameras WHERE stream IS NOT NULL', r => ({ id: String(r.id), businessId: String(r.business_id), stream: String(r.stream) })),
  /** Kadr keldi. seenFrom — uzluksiz kadr oqimi boshlangan payt (uzilishdan keyin yangilanadi) */
  seen: (businessId: string, id: string, at: string, seenFrom: string) => run('UPDATE cameras SET last_seen_at = ?, seen_from = ? WHERE business_id = ? AND id = ?', at, seenFrom, businessId, id),
  remove(businessId: string, id: string): void {
    run('DELETE FROM camera_sessions WHERE business_id = ? AND camera_id = ?', businessId, id);
    run('DELETE FROM cameras WHERE business_id = ? AND id = ?', businessId, id);
  },
};

export const cameraSessions = {
  open(businessId: string, cameraId: string, zone: { id: string; kind: ZoneKind; name: string }, startedAt: string): string {
    const id = newId(12);
    run('INSERT INTO camera_sessions (id, business_id, camera_id, zone_id, kind, zone_name, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, businessId, cameraId, zone.id, zone.kind, zone.name, startedAt);
    return id;
  },
  /** Zonadagi ochiq seansni yopadi (bo'lmasa — hech narsa qilmaydi) */
  close: (businessId: string, cameraId: string, zoneId: string, endedAt: string) =>
    run('UPDATE camera_sessions SET ended_at = ? WHERE business_id = ? AND camera_id = ? AND zone_id = ? AND ended_at IS NULL', endedAt, businessId, cameraId, zoneId),
  /** Server to'xtab qolgan bo'lsa ochiq qolgan seanslar: kameradan oxirgi kadr kelgan paytda yopiladi */
  closeDangling: () => run('UPDATE camera_sessions SET ended_at = MAX(started_at, COALESCE((SELECT c.last_seen_at FROM cameras c WHERE c.id = camera_sessions.camera_id), started_at)) WHERE ended_at IS NULL'),
  between: (businessId: string, from: string, to: string) =>
    many('SELECT * FROM camera_sessions WHERE business_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at', toSession, businessId, from, to),
};

const toCall = (r: Raw): Call => ({
  id: String(r.id), phone: String(r.phone), name: str(r.name), startedAt: String(r.started_at), durationSec: Number(r.duration_sec), outcome: String(r.outcome),
  transcript: list<CallLine>(r.transcript), booked: str(r.booked),
  // MicroSIP ustunlari (phone/store.ts qo'shadi): eski bazada bo'lmasa — ovozli agent qo'ng'irog'i
  source: r.source === 'microsip' ? 'microsip' : 'voice', direction: (str(r.direction) as Call['direction']) ?? null, status: (str(r.status) as Call['status']) ?? null,
  leadId: str(r.lead_id), hasRecording: !!r.recording, review: (str(r.review) as Call['review']) ?? 'none',
  analysis: (() => { try { return r.analysis ? JSON.parse(String(r.analysis)) : null; } catch { return null; } })(),
});

export const calls = {
  create(businessId: string, c: Omit<Call, 'id'>): Call {
    const id = newId(12);
    run('INSERT INTO calls (id, business_id, phone, name, started_at, duration_sec, outcome, transcript, booked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, c.phone, c.name, c.startedAt, c.durationSec, c.outcome, JSON.stringify(c.transcript), c.booked, nowIso());
    return { id, ...c };
  },
  recent: (businessId: string, limit = 50) => many('SELECT * FROM calls WHERE business_id = ? ORDER BY started_at DESC LIMIT ?', toCall, businessId, limit),
  /** Shu mijoz kartasiga bog'langan qo'ng'iroqlar (lead_id ustuni phone/store.ts da qo'shiladi) */
  forLead: (businessId: string, leadId: string, limit = 50) => many('SELECT * FROM calls WHERE business_id = ? AND lead_id = ? ORDER BY started_at DESC LIMIT ?', toCall, businessId, leadId, limit),
  /** Shu paytdan beri saqlangan qo'ng'iroqlar (server vaqti bo'yicha — agent yuborgan vaqtga ishonilmaydi) */
  savedSince: (businessId: string, since: string) => Number(one('SELECT COUNT(*) AS n FROM calls WHERE business_id = ? AND created_at >= ?', r => Number(r.n), businessId, since) ?? 0),
};

/** Ovozli agent yozgan qabullar: chegaralar shu yerdan sanaladi (agentning o'zi aytganidan emas) */
export const voiceBookings = {
  add: (businessId: string, phone: string) => run('INSERT INTO voice_bookings (id, business_id, phone, created_at) VALUES (?, ?, ?, ?)', newId(12), businessId, phone, nowIso()),
  since: (businessId: string, since: string, phone?: string) => Number(one(`SELECT COUNT(*) AS n FROM voice_bookings WHERE business_id = ? AND created_at >= ?${phone ? ' AND phone = ?' : ''}`, r => Number(r.n), businessId, since, ...(phone ? [phone] : [])) ?? 0),
};

/** Ovozli agent kaliti: bazada faqat xeshi turadi */
export const voiceKeys = {
  hash: (businessId: string) => one('SELECT hash FROM voice_keys WHERE business_id = ?', r => String(r.hash), businessId) ?? null,
  set: (businessId: string, hash: string) => run('INSERT INTO voice_keys (business_id, hash, created_at) VALUES (?, ?, ?) ON CONFLICT(business_id) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at', businessId, hash, nowIso()),
};

// ─── Ikkinchi miya ───────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, kind TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
  status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_biz ON knowledge (business_id, kind);
`);

const toKnowledge = (r: Raw): Knowledge => ({
  id: String(r.id), kind: String(r.kind) as KnowledgeKind, question: String(r.question), answer: String(r.answer), status: r.status === 'suggested' ? 'suggested' : 'active',
  source: String(r.source), createdAt: String(r.created_at),
});

/** Savol-javoblar, egasining tuzatishlari va hujjat namunalari (faktlar — notes jadvalida) */
export const knowledge = {
  add(businessId: string, k: Omit<Knowledge, 'id' | 'createdAt'>): Knowledge {
    const id = newId(10), createdAt = nowIso();
    run('INSERT INTO knowledge (id, business_id, kind, question, answer, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, businessId, k.kind, k.question, k.answer, k.status, k.source, createdAt);
    return { id, ...k, createdAt };
  },
  get: (businessId: string, id: string) => one('SELECT * FROM knowledge WHERE business_id = ? AND id = ?', toKnowledge, businessId, id) ?? null,
  list: (businessId: string, kind?: KnowledgeKind) =>
    many(`SELECT * FROM knowledge WHERE business_id = ?${kind ? ' AND kind = ?' : ''} ORDER BY created_at, rowid`, toKnowledge, ...(kind ? [businessId, kind] : [businessId])),
  update(businessId: string, id: string, patch: Partial<Pick<Knowledge, 'question' | 'answer' | 'status'>>): Knowledge | null {
    const old = knowledge.get(businessId, id);
    if (!old) return null;
    const next = { ...old, ...patch };
    run('UPDATE knowledge SET question = ?, answer = ?, status = ? WHERE business_id = ? AND id = ?', next.question, next.answer, next.status, businessId, id);
    return next;
  },
  remove: (businessId: string, id: string) => Number(run('DELETE FROM knowledge WHERE business_id = ? AND id = ?', businessId, id).changes) > 0,
  /** Egasi javob bermagan eski takliflar o'chadi (kutayotganlar ro'yxati to'lib, o'rganish to'xtab qolmasin) */
  expireSuggested: (businessId: string, beforeIso: string) => run("DELETE FROM knowledge WHERE business_id = ? AND status = 'suggested' AND created_at < ?", businessId, beforeIso),
  /** Shu turdagi eng yangi `keep` tasi qoladi, eskilari o'chadi */
  trim: (businessId: string, kind: KnowledgeKind, keep: number) =>
    run('DELETE FROM knowledge WHERE business_id = ? AND kind = ? AND id NOT IN (SELECT id FROM knowledge WHERE business_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)', businessId, kind, businessId, kind, keep),
};

// ─── Egasiga xabarlar navbati ────────────────────────────────────────────────
db.exec('CREATE TABLE IF NOT EXISTS owner_notices (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id TEXT NOT NULL, html TEXT NOT NULL, created_at TEXT NOT NULL)');

/**
 * Egasiga albatta yetishi kerak bo'lgan xabarlar (to'xtab qolgan pul yozuvi yoki qabul, yetkazilmagan mijoz xabari).
 * Bazada turadi: Telegram javob bermasa yoki server qayta tushsa ham yo'qolmaydi — jadval (scheduler.ts) yuborib, keyin o'chiradi
 */
export const notices = {
  add: (businessId: string, html: string) => run('INSERT INTO owner_notices (business_id, html, created_at) VALUES (?, ?, ?)', businessId, html, nowIso()),
  list: (limit = 20) => many('SELECT * FROM owner_notices ORDER BY id LIMIT ?', r => ({ id: Number(r.id), businessId: String(r.business_id), html: String(r.html), createdAt: String(r.created_at) }), limit),
  remove: (id: number) => run('DELETE FROM owner_notices WHERE id = ?', id),
};

// ─── AI xarajati ─────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  business_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day, kind)
);
`);

export interface AiUsageRow { businessId: string; day: string; kind: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
/** Kun, biznes va ish turi bo'yicha model so'rovlari soni va tokenlar (chegara va xarajat hisobi uchun) */
export const aiUsage = {
  /** So'rov yuborilishidan OLDIN sanaladi: javobsiz qolgan yoki uzilgan so'rov ham chegaraga kiradi */
  hit: (businessId: string, day: string, kind: string) =>
    run('INSERT INTO ai_usage (business_id, day, kind, calls) VALUES (?, ?, ?, 1) ON CONFLICT(business_id, day, kind) DO UPDATE SET calls = calls + 1', businessId, day, kind),
  tokens: (businessId: string, day: string, kind: string, t: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
    run('UPDATE ai_usage SET input = input + ?, output = output + ?, cache_read = cache_read + ?, cache_write = cache_write + ? WHERE business_id = ? AND day = ? AND kind = ?', t.input, t.output, t.cacheRead, t.cacheWrite, businessId, day, kind),
  calls: (businessId: string, day: string, kind: string) => one('SELECT calls FROM ai_usage WHERE business_id = ? AND day = ? AND kind = ?', r => Number(r.calls), businessId, day, kind) ?? 0,
  since: (day: string): AiUsageRow[] => many('SELECT * FROM ai_usage WHERE day >= ? ORDER BY day DESC, business_id, kind', r => ({
    businessId: String(r.business_id), day: String(r.day), kind: String(r.kind), calls: Number(r.calls),
    input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write),
  }), day),
};

// ─── Server kalitlari (ulash ustasida kiritiladi) ────────────────────────────
db.exec('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');

/** Server bo'yicha kalitlar: qiymat shifrlangan holda (secret.ts) keladi va shunday saqlanadi */
export const settings = {
  all: () => many('SELECT * FROM settings ORDER BY name', r => ({ name: String(r.name), value: String(r.value), updatedAt: String(r.updated_at) })),
  set: (name: string, sealed: string) => run('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', name, sealed, nowIso()),
  remove: (name: string) => run('DELETE FROM settings WHERE name = ?', name),
};

// ─── Anketalar (o'rnatishdan oldin egasi to'ldiradi) ─────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS anketa (
  code TEXT PRIMARY KEY, label TEXT NOT NULL, industry TEXT NOT NULL, data TEXT, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
`);

export interface AnketaRow { code: string; label: string; industry: string; data: string | null; status: string; createdAt: string; updatedAt: string; expiresAt: string }
const toAnketa = (r: Raw): AnketaRow => ({
  code: String(r.code), label: String(r.label), industry: String(r.industry), data: str(r.data), status: String(r.status),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), expiresAt: String(r.expires_at),
});
export const anketas = {
  create(code: string, label: string, industry: string, expiresAt: string): AnketaRow {
    run('INSERT INTO anketa (code, label, industry, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', code, label, industry, nowIso(), nowIso(), expiresAt);
    return anketas.get(code)!;
  },
  get: (code: string) => one('SELECT * FROM anketa WHERE code = ?', toAnketa, code),
  list: () => many('SELECT * FROM anketa ORDER BY created_at DESC LIMIT 200', toAnketa),
  save: (code: string, data: string, status: string) => run('UPDATE anketa SET data = ?, status = ?, updated_at = ? WHERE code = ?', data, status, nowIso(), code),
  remove: (code: string) => run('DELETE FROM anketa WHERE code = ?', code),
  /** Muddati o'tganlari o'chadi: anketada manzil, telefon, narxlar bor — keraksiz turmasin */
  expire: () => run('DELETE FROM anketa WHERE expires_at < ?', nowIso()),
};

export const closeDb = () => db.close();
/** Bazaning to'liq, izchil nusxasi boshqa faylga (server ishlab turganda ham xavfsiz). Fayl oldindan bo'lmasligi kerak */
export const copyDb = (file: string): void => { db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); };
