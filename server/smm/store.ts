/**
 * SMM-menejer kalendari: har post — sana, vaqt, kanal, format, mavzu, matn, slaydlar (dizayn) va rasmlar.
 * Holat: idea (reja) → drawing (tayyorlanmoqda) → ready (egasi ko'rishi kerak) → approved (vaqti kelganda o'zi chiqadi) →
 * publishing → published; failed — sababi bilan; handed — avtomatik joylab bo'lmaydi, rasm va matn egasiga yuborildi; cancelled.
 * Holat faqat kutilganidan o'zgaradi (move): ikki bosish ikki marta joylamaydi
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env';
import { newId, sql, type Row } from '../db';
import type { DesignFormat, DesignTemplate } from './design';

sql.exec(`
CREATE TABLE IF NOT EXISTS smm_posts (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, day TEXT NOT NULL, time TEXT NOT NULL, channel TEXT NOT NULL, format TEXT NOT NULL,
  pillar TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '',
  slides TEXT NOT NULL DEFAULT '[]', images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, error TEXT, url TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS smm_posts_due ON smm_posts (status, day, time);
CREATE INDEX IF NOT EXISTS smm_posts_biz ON smm_posts (business_id, day);
`);
// Tayyorlanayotganda yoki joylanayotganda server to'xtagan
sql.run("UPDATE smm_posts SET status = 'idea', error = 'Tayyorlash to''xtadi — qayta tayyorlang' WHERE status = 'drawing'");
sql.run("UPDATE smm_posts SET status = 'failed', error = 'Joylanayotganda server to''xtadi — kanalda tekshiring' WHERE status = 'publishing'");

export const CHANNELS = ['telegram', 'instagram'] as const;
export type SmmChannel = (typeof CHANNELS)[number];
export const POST_FORMATS = ['post', 'carousel', 'story'] as const;
export type SmmFormat = (typeof POST_FORMATS)[number];
export type SmmStatus = 'idea' | 'drawing' | 'ready' | 'approved' | 'publishing' | 'published' | 'failed' | 'handed' | 'cancelled';

/** Bitta slayd: shablon va matnlari (surat alohida — images) */
export interface Slide { template: DesignTemplate; headline: string; sub: string | null; badge: string | null; bullets: string[]; cta: string | null }

export interface SmmPost {
  id: string; day: string; time: string; channel: SmmChannel; format: SmmFormat; pillar: string; title: string; angle: string;
  caption: string; slides: Slide[]; images: string[]; status: SmmStatus; error: string | null; url: string | null; createdAt: string; updatedAt: string;
}

export class SmmError extends Error {}

/** Kanal va formatdan rasm o'lchami: storis 9:16, Telegram posti 16:9 muqova, Instagram (va karusel) — 4:5 */
export const designFormat = (p: Pick<SmmPost, 'channel' | 'format'>): DesignFormat =>
  p.format === 'story' ? 'story' : p.channel === 'telegram' && p.format === 'post' ? 'cover' : 'post';

export const smmDir = (bizId: string): string => {
  const dir = join(env.dataDir, 'smm', bizId.replace(/[^A-Za-z0-9]/g, ''));
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** «<post>-<versiya>-<slayd>.jpg»: har tayyorlashda yangi versiya — panel eski (keshdagi) rasmni ko'rsatmasin */
const FILE = /^[a-z0-9]{8,24}-[a-z0-9]{4,12}-\d{1,2}\.jpg$/;
/** Post mazmunining belgisi: Telegram tugmasi shu mazmunga bog'lanadi (qayta tayyorlangan postni eski karta tasdiqlamaydi) */
export const postMark = (p: Pick<SmmPost, 'caption' | 'images'>) => createHash('sha256').update(`${p.caption}\n${p.images.join(',')}`).digest('hex').slice(0, 8);
/** Shuncha vaqt o'tib ketgan post chiqarilmaydi va tasdiqlanmaydi — yangi vaqt kerak */
export const STALE_MS = 6 * 3600_000;
export const postTime = (p: Pick<SmmPost, 'day' | 'time'>) => Date.parse(`${p.day}T${p.time}:00`);
/** Rasm fayli yo'li — faqat shu biznes papkasidan */
export const imageFile = (bizId: string, name: string): string | null => (FILE.test(name) ? join(smmDir(bizId), name) : null);

const toPost = (r: Row): SmmPost => ({
  id: String(r.id), day: String(r.day), time: String(r.time), channel: String(r.channel) as SmmChannel, format: String(r.format) as SmmFormat,
  pillar: String(r.pillar), title: String(r.title), angle: String(r.angle), caption: String(r.caption),
  slides: JSON.parse(String(r.slides)) as Slide[], images: JSON.parse(String(r.images)) as string[], status: String(r.status) as SmmStatus,
  error: sql.str(r.error), url: sql.str(r.url), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

export type NewPost = Pick<SmmPost, 'day' | 'time' | 'channel' | 'format' | 'pillar' | 'title' | 'angle'>;

export const smmStore = {
  add(bizId: string, p: NewPost): SmmPost {
    const id = newId(12).toLowerCase().replace(/[^a-z0-9]/g, 'x');
    const now = sql.nowIso();
    sql.run(`INSERT INTO smm_posts (id, business_id, day, time, channel, format, pillar, title, angle, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?)`, id, bizId, p.day, p.time, p.channel, p.format, p.pillar.slice(0, 80), p.title.slice(0, 300), p.angle.slice(0, 1000), now, now);
    return smmStore.get(bizId, id)!;
  },
  get: (bizId: string, id: string) => sql.one('SELECT * FROM smm_posts WHERE business_id = ? AND id = ?', toPost, bizId, id),
  /** Kalendar: shu kundan boshlab (bekor qilinganlarsiz) */
  from: (bizId: string, day: string, limit = 120) =>
    sql.many(`SELECT * FROM smm_posts WHERE business_id = ? AND day >= ? AND status <> 'cancelled' ORDER BY day, time LIMIT ${limit}`, toPost, bizId, day),
  /** Reja yangilanganda: hali tayyorlanmagan g'oyalar shu kundan keyin o'chiriladi (tayyorlari qoladi) */
  dropIdeas: (bizId: string, fromDay: string) => sql.run("DELETE FROM smm_posts WHERE business_id = ? AND day >= ? AND status = 'idea'", bizId, fromDay),
  move: (bizId: string, id: string, from: SmmStatus[], to: SmmStatus, extra: { error?: string | null; url?: string | null } = {}) =>
    Number(sql.run(`UPDATE smm_posts SET status = ?, error = ?, url = COALESCE(?, url), updated_at = ? WHERE business_id = ? AND id = ? AND status IN (${from.map(() => '?').join(',')})`,
      to, extra.error ?? null, extra.url ?? null, sql.nowIso(), bizId, id, ...from).changes) > 0,
  setContent: (bizId: string, id: string, caption: string, slides: Slide[], images: string[]) =>
    sql.run('UPDATE smm_posts SET caption = ?, slides = ?, images = ?, updated_at = ? WHERE business_id = ? AND id = ?',
      caption, JSON.stringify(slides), JSON.stringify(images), sql.nowIso(), bizId, id),
  /** Egasi panelda: sana, vaqt yoki matn (tasdiqlangani qayta ko'rish uchun «ready»ga qaytadi) */
  edit: (bizId: string, id: string, patch: Partial<Pick<SmmPost, 'day' | 'time' | 'caption'>>) => {
    const cur = smmStore.get(bizId, id);
    if (!cur || !['idea', 'ready', 'approved', 'failed'].includes(cur.status)) return false;
    const status = cur.status === 'approved' && patch.caption !== undefined ? 'ready' : cur.status;
    sql.run('UPDATE smm_posts SET day = ?, time = ?, caption = ?, status = ?, updated_at = ? WHERE business_id = ? AND id = ?',
      patch.day ?? cur.day, patch.time ?? cur.time, patch.caption ?? cur.caption, status, sql.nowIso(), bizId, id);
    return true;
  },
  /** Chiqmagan, lekin tayyor (matn va rasm bor) post — qayta ko'rib tasdiqlash uchun «ready»ga; AI bilan qayta tayyorlash shart emas */
  reopen: (bizId: string, id: string) =>
    Number(sql.run("UPDATE smm_posts SET status = 'ready', error = NULL, updated_at = ? WHERE business_id = ? AND id = ? AND status = 'failed' AND images <> '[]'", sql.nowIso(), bizId, id).changes) > 0,
  /** Vaqti kelgan tasdiqlanganlar (hamma bizneslar): sana va vaqt — mahalliy (server/tz.ts). Ishlamaydigan biznes navbatni to'sib qo'ymasin — keng chegara */
  due: (day: string, time: string) =>
    sql.many("SELECT business_id AS b, id FROM smm_posts WHERE status = 'approved' AND (day < ? OR (day = ? AND time <= ?)) ORDER BY day, time LIMIT 500",
      r => ({ bizId: String(r.b), id: String(r.id) }), day, day, time),
};
