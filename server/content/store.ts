/**
 * Kontent-meyker ma'lumotlari: sozlamalar (egasining kanali, uslub, til), manbalar (kuzatiladigan ochiq kanallar) va qoralamalar.
 * Holat faqat kutilgan holatdan o'zgaradi (move): ikki marta bosilsa ikki marta joylanmaydi
 */
import type { ContentDraft, ContentSettings, ContentSource } from '../../src/types';
import { newId, sql, type Row } from '../db';

sql.exec(`
CREATE TABLE IF NOT EXISTS content_settings (
  business_id TEXT PRIMARY KEY, channel_id TEXT, channel_title TEXT, style TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'uz',
  per_run INTEGER NOT NULL DEFAULT 3, auto INTEGER NOT NULL DEFAULT 0, last_run TEXT
);
CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, handle TEXT NOT NULL, title TEXT, last_post INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE (business_id, handle)
);
CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, text TEXT NOT NULL, source_url TEXT, topic TEXT, status TEXT NOT NULL,
  message_id INTEGER, error TEXT, created_at TEXT NOT NULL, published_at TEXT
);
CREATE INDEX IF NOT EXISTS content_drafts_biz ON content_drafts (business_id, created_at);
`);
// Server joylash paytida to'xtagan: Telegram javobi noma'lum — qayta urinish egasining qarori (kanalda tekshiradi)
sql.run("UPDATE content_drafts SET status = 'failed', error = 'Joylanayotganda server to''xtadi — kanalda chiqqan-chiqmaganini tekshiring' WHERE status = 'publishing'");

/** Kanal postining eng uzun matni (Telegram chegarasi 4096) */
export const MAX_DRAFT = 4000;
export const MAX_SOURCES = 20;
const PAGE = 60;

/** Kutilgan xato — sababi egasiga ko'rsatiladi */
export class ContentError extends Error {}

const DEFAULTS: ContentSettings = { channelId: null, channelTitle: null, style: '', lang: 'uz', perRun: 3, auto: false, lastRun: null };

const toSettings = (r: Row): ContentSettings => ({
  channelId: sql.str(r.channel_id), channelTitle: sql.str(r.channel_title), style: String(r.style), lang: r.lang === 'ru' ? 'ru' : 'uz',
  perRun: Number(r.per_run), auto: Number(r.auto) === 1, lastRun: sql.str(r.last_run),
});
const toSource = (r: Row): ContentSource => ({ id: String(r.id), handle: String(r.handle), title: sql.str(r.title), lastPost: Number(r.last_post), createdAt: String(r.created_at) });
const toDraft = (r: Row): ContentDraft => ({
  id: String(r.id), text: String(r.text), sourceUrl: sql.str(r.source_url), topic: sql.str(r.topic), status: String(r.status) as ContentDraft['status'],
  messageId: sql.num(r.message_id), error: sql.str(r.error), createdAt: String(r.created_at), publishedAt: sql.str(r.published_at),
});

export const contentStore = {
  settings: (bizId: string): ContentSettings => sql.one('SELECT * FROM content_settings WHERE business_id = ?', toSettings, bizId) ?? DEFAULTS,
  saveSettings(bizId: string, patch: Partial<ContentSettings>): ContentSettings {
    const s = { ...contentStore.settings(bizId), ...patch };
    sql.run(`INSERT INTO content_settings (business_id, channel_id, channel_title, style, lang, per_run, auto, last_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (business_id) DO UPDATE SET channel_id = excluded.channel_id, channel_title = excluded.channel_title, style = excluded.style,
      lang = excluded.lang, per_run = excluded.per_run, auto = excluded.auto, last_run = excluded.last_run`,
      bizId, s.channelId, s.channelTitle, s.style, s.lang, s.perRun, s.auto ? 1 : 0, s.lastRun);
    return s;
  },

  /** Kanal boshqa biznesga ulanganmi */
  channelTaken: (channelId: string, exceptBiz: string) =>
    !!sql.one('SELECT 1 AS x FROM content_settings WHERE channel_id = ? AND business_id <> ?', r => r.x, channelId, exceptBiz),

  sources: (bizId: string) => sql.many('SELECT * FROM content_sources WHERE business_id = ? ORDER BY created_at', toSource, bizId),
  /** handle — tekshirilgan nom (telegram.ts normalizeHandle); boshidagi @ olib tashlanadi */
  addSource(bizId: string, raw: string, title: string | null = null): ContentSource {
    const handle = raw.trim().replace(/^@/, '');
    if (contentStore.sources(bizId).some(s => s.handle.toLowerCase() === handle.toLowerCase())) throw new ContentError(`@${handle} allaqachon qo'shilgan`);
    if (contentStore.sources(bizId).length >= MAX_SOURCES) throw new ContentError(`Manbalar ${MAX_SOURCES} tadan oshmaydi`);
    const id = newId(10);
    sql.run('INSERT INTO content_sources (id, business_id, handle, title, created_at) VALUES (?, ?, ?, ?, ?)', id, bizId, handle, title, sql.nowIso());
    return contentStore.sources(bizId).find(s => s.id === id)!;
  },
  removeSource: (bizId: string, id: string) => Number(sql.run('DELETE FROM content_sources WHERE business_id = ? AND id = ?', bizId, id).changes) > 0,
  sourceSeen: (bizId: string, id: string, lastPost: number, title: string | null) =>
    sql.run('UPDATE content_sources SET last_post = MAX(last_post, ?), title = COALESCE(?, title) WHERE business_id = ? AND id = ?', lastPost, title, bizId, id),

  drafts: (bizId: string) => sql.many(`SELECT * FROM content_drafts WHERE business_id = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT ${PAGE}`, toDraft, bizId),
  draft: (bizId: string, id: string) => sql.one('SELECT * FROM content_drafts WHERE business_id = ? AND id = ?', toDraft, bizId, id),
  addDraft(bizId: string, d: { text: string; sourceUrl: string | null; topic: string | null }): ContentDraft {
    const id = newId(12);
    sql.run("INSERT INTO content_drafts (id, business_id, text, source_url, topic, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
      id, bizId, d.text.slice(0, MAX_DRAFT), d.sourceUrl, d.topic, sql.nowIso());
    return contentStore.draft(bizId, id)!;
  },
  /** Matn faqat chiqmagan qoralamada o'zgaradi */
  setText: (bizId: string, id: string, text: string) =>
    Number(sql.run("UPDATE content_drafts SET text = ?, error = NULL WHERE business_id = ? AND id = ? AND status IN ('draft', 'failed')", text, bizId, id).changes) > 0,
  move: (bizId: string, id: string, from: ContentDraft['status'][], to: ContentDraft['status'], extra: { messageId?: number; error?: string | null } = {}) =>
    Number(sql.run(`UPDATE content_drafts SET status = ?, message_id = COALESCE(?, message_id), error = ?, published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
      WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`,
      to, extra.messageId ?? null, extra.error ?? null, to, sql.nowIso(), bizId, id, ...from).changes) > 0,
  waiting: (bizId: string) => sql.one("SELECT COUNT(*) AS n FROM content_drafts WHERE business_id = ? AND status IN ('draft', 'failed')", r => Number(r.n), bizId) ?? 0,
};
