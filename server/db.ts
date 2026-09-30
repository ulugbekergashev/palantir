/**
 * Baza: bitta SQLite fayl (Node'ning o'zidagi node:sqlite).
 * Biznes profili — JSON; vazifalar, mijozlar, hujjatlar, postlar, xabarlar,
 * eslab qolingan faktlar va suhbatlar — alohida jadvallarda.
 * Har bir so'rov biznes id'si bilan cheklangan (bizneslar bir-birini ko'rmaydi).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { Artifact, Business, ChatEntry, ContentItem, Doc, Lead, LeadStage, Note, Outbound, OutboundStatus, Post, PostStatus, Task, TaskStatus } from '../src/types';
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
`);

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
  createdAt: String(r.created_at),
});

const BIZ_COLUMNS = {
  passwordHash: 'password_hash', profile: 'profile', ownerChatId: 'owner_chat_id', channelId: 'channel_id',
  channelTitle: 'channel_title', active: 'active', briefDate: 'brief_date',
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
});

export const tasks = {
  create(businessId: string, title: string, dueAt: string | null, notes: string | null): Task {
    const id = newId(8);
    run('INSERT INTO tasks (id, business_id, title, notes, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, businessId, title, notes, dueAt, nowIso(), nowIso());
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
};

// ─── Mijozlar (lidlar) ────────────────────────────────────────────────────────

export interface LeadRow extends Lead { businessId: string; tgUserId: string | null; postId: string | null }

const toLead = (r: Raw): LeadRow => ({
  id: String(r.id),
  businessId: String(r.business_id),
  name: str(r.name),
  phone: str(r.phone),
  username: str(r.username),
  tgUserId: str(r.tg_user_id),
  reachable: !!r.tg_user_id,
  stage: String(r.stage) as LeadStage,
  note: str(r.note),
  source: str(r.source),
  postId: str(r.post_id),
  createdAt: String(r.created_at),
});

export const leads = {
  /** Qo'lda qo'shilgan (egasi aytdi) */
  add(businessId: string, v: { name: string | null; phone: string | null; note: string | null; source: string | null }): LeadRow {
    const id = newId(10);
    run('INSERT INTO leads (id, business_id, name, phone, note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, v.name, v.phone, v.note, v.source, nowIso(), nowIso());
    return leads.get(businessId, id)!;
  },
  /** Havola orqali botga kelgan odam: bir biznesda bir odam — bitta yozuv */
  fromTelegram(businessId: string, tgUserId: string, name: string | null, username: string | null, source: string | null, postId: string | null): LeadRow {
    const existing = one('SELECT * FROM leads WHERE business_id = ? AND tg_user_id = ?', toLead, businessId, tgUserId);
    if (existing) {
      run('UPDATE leads SET updated_at = ? WHERE id = ?', nowIso(), existing.id);
      return existing;
    }
    const id = newId(10);
    run('INSERT INTO leads (id, business_id, name, username, tg_user_id, source, post_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, businessId, name, username, tgUserId, source, postId, nowIso(), nowIso());
    return leads.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => one('SELECT * FROM leads WHERE business_id = ? AND id = ?', toLead, businessId, id),
  /** Shu Telegram foydalanuvchisining oxirgi yozuvi (qaysi biznesga yozayotganini bilish uchun) */
  latestForUser: (tgUserId: string) => one('SELECT * FROM leads WHERE tg_user_id = ? ORDER BY updated_at DESC LIMIT 1', toLead, tgUserId),
  list: (businessId: string, stage: LeadStage | 'all' = 'all', sinceIso?: string, limit = 300) =>
    many(`SELECT * FROM leads WHERE business_id = ? AND (? = 'all' OR stage = ?) AND created_at >= ? ORDER BY created_at DESC LIMIT ?`,
      toLead, businessId, stage, stage, sinceIso ?? '0000', limit),
  update(businessId: string, id: string, patch: { stage?: LeadStage; note?: string | null; phone?: string | null; name?: string | null }): LeadRow | undefined {
    const cur = leads.get(businessId, id);
    if (!cur) return undefined;
    run('UPDATE leads SET stage = ?, note = ?, phone = ?, name = ?, updated_at = ? WHERE business_id = ? AND id = ?',
      patch.stage ?? cur.stage, patch.note !== undefined ? patch.note : cur.note, patch.phone !== undefined ? patch.phone : cur.phone,
      patch.name !== undefined ? patch.name : cur.name, nowIso(), businessId, id);
    return leads.get(businessId, id);
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
  const reachable = ids.length
    ? Number((db.prepare(`SELECT COUNT(*) n FROM leads WHERE business_id = ? AND tg_user_id IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).get(String(r.business_id), ...ids) as Raw).n)
    : 0;
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
  /** Faqat qoralama holatidan o'tadi (ikki marta yuborilmasin) — o'zgargan bo'lsa true */
  finish: (businessId: string, id: string, status: 'sent' | 'cancelled', sentCount = 0) =>
    Number(run("UPDATE outbound SET status = ?, sent_count = ? WHERE business_id = ? AND id = ? AND status = 'draft'", status, sentCount, businessId, id).changes) > 0,
  setSentCount: (businessId: string, id: string, n: number) => run('UPDATE outbound SET sent_count = ? WHERE business_id = ? AND id = ?', n, businessId, id),
  setOwnerMessage: (businessId: string, id: string, messageId: number) => run('UPDATE outbound SET owner_message_id = ? WHERE business_id = ? AND id = ?', messageId, businessId, id),
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

export const closeDb = () => db.close();
