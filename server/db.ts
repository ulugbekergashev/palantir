/**
 * Baza: bitta SQLite fayl (Node'ning o'zidagi node:sqlite). Klinika profili —
 * JSON (xizmatlar, shifokorlar, brend birga o'zgaradi), postlar va lidlar —
 * alohida jadvallarda.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { AiText, Clinic, ItemEdit, ItemStatus, Lang } from '../src/types';
import { env } from './env';

const db = new DatabaseSync(env.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS clinics (
  id              TEXT PRIMARY KEY,
  login           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  profile         TEXT NOT NULL,
  owner_chat_id   TEXT UNIQUE,
  link_code       TEXT NOT NULL UNIQUE,
  channel_id      TEXT,
  channel_title   TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  sent_week       TEXT,
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  clinic_id          TEXT NOT NULL,
  item_id            TEXT NOT NULL,
  week               TEXT NOT NULL,
  seed               INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending',
  edits              TEXT,
  ai                 TEXT,
  owner_message_id   INTEGER,
  published_at       TEXT,
  channel_message_id INTEGER,
  publish_error      TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (clinic_id, item_id)
);
CREATE INDEX IF NOT EXISTS items_due ON items (status, published_at);
CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,
  clinic_id   TEXT NOT NULL,
  item_id     TEXT,
  tg_user_id  TEXT NOT NULL,
  name        TEXT,
  username    TEXT,
  phone       TEXT,
  stage       TEXT NOT NULL DEFAULT 'clicked',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_clinic ON leads (clinic_id, created_at);
CREATE INDEX IF NOT EXISTS leads_user ON leads (tg_user_id, updated_at);
`);

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Qisqa id: faqat harf va raqam (Telegram havolasida ajratgich sifatida "-" ishlatiladi) */
export const newId = (len = 10): string => [...randomBytes(len)].map(b => ALPHABET[b % ALPHABET.length]).join('');

const nowIso = () => new Date().toISOString();

// ─── Klinikalar ───────────────────────────────────────────────────────────────

export interface ClinicRow {
  id: string;
  login: string;
  passwordHash: string;
  profile: Clinic;
  ownerChatId: string | null;
  linkCode: string;
  channelId: string | null;
  channelTitle: string | null;
  active: boolean;
  sentWeek: string | null;
  createdAt: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

const toClinic = (r: Raw | undefined): ClinicRow | undefined => r && {
  id: String(r.id),
  login: String(r.login),
  passwordHash: String(r.password_hash),
  profile: JSON.parse(String(r.profile)) as Clinic,
  ownerChatId: str(r.owner_chat_id),
  linkCode: String(r.link_code),
  channelId: str(r.channel_id),
  channelTitle: str(r.channel_title),
  active: Number(r.active) === 1,
  sentWeek: str(r.sent_week),
  createdAt: String(r.created_at),
};

const clinicQ = {
  insert: db.prepare(`INSERT INTO clinics (id, login, password_hash, profile, link_code, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM clinics WHERE id = ?'),
  byLogin: db.prepare('SELECT * FROM clinics WHERE login = ?'),
  byLink: db.prepare('SELECT * FROM clinics WHERE link_code = ?'),
  byOwner: db.prepare('SELECT * FROM clinics WHERE owner_chat_id = ?'),
  all: db.prepare('SELECT * FROM clinics ORDER BY created_at DESC'),
};

const CLINIC_COLUMNS = {
  passwordHash: 'password_hash',
  profile: 'profile',
  ownerChatId: 'owner_chat_id',
  channelId: 'channel_id',
  channelTitle: 'channel_title',
  active: 'active',
  sentWeek: 'sent_week',
} as const;
type ClinicPatch = Partial<Pick<ClinicRow, keyof typeof CLINIC_COLUMNS>>;

export const clinics = {
  create(login: string, passwordHash: string, profile: Clinic): ClinicRow {
    const id = newId(8);
    clinicQ.insert.run(id, login, passwordHash, JSON.stringify(profile), newId(12), nowIso());
    return clinics.byId(id)!;
  },
  byId: (id: string) => toClinic(clinicQ.byId.get(id) as Raw | undefined),
  byLogin: (login: string) => toClinic(clinicQ.byLogin.get(login) as Raw | undefined),
  byLinkCode: (code: string) => toClinic(clinicQ.byLink.get(code) as Raw | undefined),
  byOwnerChat: (chatId: string) => toClinic(clinicQ.byOwner.get(chatId) as Raw | undefined),
  all: () => (clinicQ.all.all() as Raw[]).map(r => toClinic(r)!),
  update(id: string, patch: ClinicPatch): void {
    const entries = Object.entries(patch) as [keyof typeof CLINIC_COLUMNS, unknown][];
    if (!entries.length) return;
    // Egasi boshqa klinikaga ulansa — eski bog'lanish uziladi (bitta chat — bitta klinika)
    if (patch.ownerChatId) db.prepare('UPDATE clinics SET owner_chat_id = NULL WHERE owner_chat_id = ? AND id <> ?').run(patch.ownerChatId, id);
    const sets = entries.map(([k]) => `${CLINIC_COLUMNS[k]} = ?`).join(', ');
    const values = entries.map(([k, v]) => (k === 'profile' ? JSON.stringify(v) : k === 'active' ? (v ? 1 : 0) : (v as string | null)));
    db.prepare(`UPDATE clinics SET ${sets} WHERE id = ?`).run(...values, id);
  },
};

// ─── Postlar ──────────────────────────────────────────────────────────────────

export interface StoredAi {
  seed: number;
  /** null — AI yozolmadi yoki qoidadan o'tmadi, bankdagi matn ishlatiladi */
  text: AiText | null;
}

export interface ItemRow {
  clinicId: string;
  itemId: string;
  week: string;
  seed: number;
  status: ItemStatus;
  edits: Partial<Record<Lang, ItemEdit>> | null;
  ai: StoredAi | null;
  ownerMessageId: number | null;
  publishedAt: string | null;
  channelMessageId: number | null;
  publishError: string | null;
  attempts: number;
}

const toItem = (r: Raw | undefined): ItemRow | undefined => r && {
  clinicId: String(r.clinic_id),
  itemId: String(r.item_id),
  week: String(r.week),
  seed: Number(r.seed),
  status: String(r.status) as ItemStatus,
  edits: r.edits ? JSON.parse(String(r.edits)) : null,
  ai: r.ai ? JSON.parse(String(r.ai)) : null,
  ownerMessageId: r.owner_message_id == null ? null : Number(r.owner_message_id),
  publishedAt: str(r.published_at),
  channelMessageId: r.channel_message_id == null ? null : Number(r.channel_message_id),
  publishError: str(r.publish_error),
  attempts: Number(r.attempts),
};

const itemQ = {
  get: db.prepare('SELECT * FROM items WHERE clinic_id = ? AND item_id = ?'),
  week: db.prepare('SELECT * FROM items WHERE clinic_id = ? AND week = ?'),
  ensure: db.prepare(`INSERT OR IGNORE INTO items (clinic_id, item_id, week, updated_at) VALUES (?, ?, ?, ?)`),
  due: db.prepare(`SELECT i.* FROM items i JOIN clinics c ON c.id = i.clinic_id
    WHERE c.active = 1 AND i.status = 'published' AND i.published_at IS NULL AND i.attempts < 3`),
  recentAi: db.prepare(`SELECT ai FROM items WHERE clinic_id = ? AND week < ? AND week >= ? AND ai IS NOT NULL`),
};

const ITEM_COLUMNS = {
  seed: 'seed',
  status: 'status',
  edits: 'edits',
  ai: 'ai',
  ownerMessageId: 'owner_message_id',
  publishedAt: 'published_at',
  channelMessageId: 'channel_message_id',
  publishError: 'publish_error',
  attempts: 'attempts',
} as const;
type ItemPatch = Partial<Pick<ItemRow, keyof typeof ITEM_COLUMNS>>;

export const items = {
  get: (clinicId: string, itemId: string) => toItem(itemQ.get.get(clinicId, itemId) as Raw | undefined),
  forWeek: (clinicId: string, week: string) => (itemQ.week.all(clinicId, week) as Raw[]).map(r => toItem(r)!),
  /** Qatorni (bo'lmasa — yaratib) yangilaydi */
  update(clinicId: string, itemId: string, patch: ItemPatch): ItemRow {
    itemQ.ensure.run(clinicId, itemId, itemId.slice(0, 10), nowIso());
    const entries = Object.entries(patch) as [keyof typeof ITEM_COLUMNS, unknown][];
    if (entries.length) {
      const sets = entries.map(([k]) => `${ITEM_COLUMNS[k]} = ?`).join(', ');
      const values = entries.map(([k, v]) => ((k === 'edits' || k === 'ai') && v != null ? JSON.stringify(v) : (v as string | number | null)));
      db.prepare(`UPDATE items SET ${sets}, updated_at = ? WHERE clinic_id = ? AND item_id = ?`).run(...values, nowIso(), clinicId, itemId);
    }
    return items.get(clinicId, itemId)!;
  },
  /** Tasdiqlangan, lekin hali joylanmagan (vaqti kelganini chaqiruvchi tekshiradi) */
  due: () => (itemQ.due.all() as Raw[]).map(r => toItem(r)!),
  /** Oldingi haftalarda AI yozgan matnlar — takrorlanmasin */
  recentAi(clinicId: string, beforeWeek: string, sinceWeek: string): AiText[] {
    return (itemQ.recentAi.all(clinicId, beforeWeek, sinceWeek) as Raw[])
      .map(r => (JSON.parse(String(r.ai)) as StoredAi).text)
      .filter((t): t is AiText => !!t);
  },
};

// ─── Lidlar ───────────────────────────────────────────────────────────────────

export type LeadStage = 'clicked' | 'contact' | 'called';

export interface LeadRow {
  id: string;
  clinicId: string;
  itemId: string | null;
  tgUserId: string;
  name: string | null;
  username: string | null;
  phone: string | null;
  stage: LeadStage;
  createdAt: string;
  updatedAt: string;
}

const toLead = (r: Raw | undefined): LeadRow | undefined => r && {
  id: String(r.id),
  clinicId: String(r.clinic_id),
  itemId: str(r.item_id),
  tgUserId: String(r.tg_user_id),
  name: str(r.name),
  username: str(r.username),
  phone: str(r.phone),
  stage: String(r.stage) as LeadStage,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
};

const leadQ = {
  insert: db.prepare(`INSERT INTO leads (id, clinic_id, item_id, tg_user_id, name, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM leads WHERE id = ?'),
  sameClick: db.prepare(`SELECT * FROM leads WHERE clinic_id = ? AND tg_user_id = ? AND item_id IS ? ORDER BY created_at DESC LIMIT 1`),
  latestForUser: db.prepare(`SELECT * FROM leads WHERE tg_user_id = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1`),
  forClinic: db.prepare(`SELECT * FROM leads WHERE clinic_id = ? AND stage <> 'clicked' ORDER BY created_at DESC LIMIT ?`),
  forItems: db.prepare(`SELECT * FROM leads WHERE clinic_id = ? AND item_id LIKE ?`),
};

export const leads = {
  /** Postdagi havola bosildi: bir odam bir postdan bir marta sanaladi */
  click(clinicId: string, itemId: string | null, tgUserId: string, name: string | null, username: string | null): LeadRow {
    const existing = toLead(leadQ.sameClick.get(clinicId, tgUserId, itemId) as Raw | undefined);
    if (existing) {
      db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(nowIso(), existing.id);
      return { ...existing, updatedAt: nowIso() };
    }
    const id = newId(12);
    leadQ.insert.run(id, clinicId, itemId, tgUserId, name, username, nowIso(), nowIso());
    return leads.byId(id)!;
  },
  byId: (id: string) => toLead(leadQ.byId.get(id) as Raw | undefined),
  /** Shu odamning oxirgi 7 kundagi bosishi (raqam yuborganda qaysi klinikaga tegishli ekanini bilish uchun) */
  latestForUser: (tgUserId: string) =>
    toLead(leadQ.latestForUser.get(tgUserId, new Date(Date.now() - 7 * 86_400_000).toISOString()) as Raw | undefined),
  setContact(id: string, phone: string, name: string | null): void {
    db.prepare(`UPDATE leads SET phone = ?, name = COALESCE(?, name), stage = CASE WHEN stage = 'called' THEN stage ELSE 'contact' END, updated_at = ? WHERE id = ?`)
      .run(phone, name, nowIso(), id);
  },
  setStage(clinicId: string, id: string, stage: LeadStage): boolean {
    const r = db.prepare('UPDATE leads SET stage = ?, updated_at = ? WHERE id = ? AND clinic_id = ?').run(stage, nowIso(), id, clinicId);
    return Number(r.changes) > 0;
  },
  /** Raqam qoldirganlar (eng yangisi birinchi) */
  forClinic: (clinicId: string, limit = 200) => (leadQ.forClinic.all(clinicId, limit) as Raw[]).map(r => toLead(r)!),
  /** Haftadagi postlar bo'yicha: bosishlar va raqam qoldirganlar */
  countsForWeek(clinicId: string, week: string): Record<string, { clicks: number; contacts: number }> {
    const out: Record<string, { clicks: number; contacts: number }> = {};
    for (const r of (leadQ.forItems.all(clinicId, `${week}-%`) as Raw[]).map(x => toLead(x)!)) {
      const c = (out[r.itemId!] ??= { clicks: 0, contacts: 0 });
      c.clicks++;
      if (r.stage !== 'clicked') c.contacts++;
    }
    return out;
  },
};

export const closeDb = () => db.close();
