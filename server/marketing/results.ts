/**
 * Marketolog natijani o'lchaydi — chiqqan kontent qanday ishladi (oxirgi 30 kun):
 *   Telegram kanal posti va videosi — ko'rishlar (kanalning ochiq t.me/s sahifasidan; yopiq kanalda — o'lchanmaydi);
 *   Instagram posti — layk, izoh, video ko'rishi (egasining profil sahifasi so'rovi — kuniga bir marta);
 *   reklama — sarf va natija (Targetolog kuzatuvidan, ads/store.ts).
 * Kuniga bir marta jadval bilan (Marketolog jamoada bo'lsa) yoki panelda «Yangilash». Eng yaxshi va eng sust postlar kontent-rejaga
 * beriladi (content/plan.ts): nima ishlagani — ko'proq, nima ishlamagani — kamroq.
 */
import type { ResultItem, ResultsView } from '../../src/types';
import { sql, type BusinessRow } from '../db';
import { adsStore } from '../ads/store';
import { channelOutlet } from '../content/factory';
import { contentStore } from '../content/store';
import { fetchChannelViews } from '../content/telegram';
import { videoStore } from '../content/video';
import { instagramOwnPosts, type IgPostStats } from '../inbox/instagram';
import { posts } from './posts';

sql.exec(`
CREATE TABLE IF NOT EXISTS content_results (
  business_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, views INTEGER, likes INTEGER, comments INTEGER, checked_at TEXT NOT NULL,
  PRIMARY KEY (business_id, kind, ref_id)
);
`);

const DAYS = 30;
const DAY_MS = 86_400_000;
/** Panelda «Yangilash» — shundan tez-tez emas (Instagram so'rovi akkaunt xavfsizligi uchun kam bo'lsin) */
const REFRESH_MS = 30 * 60_000;

type Kind = 'telegram' | 'video' | 'instagram';
interface Stat { views: number | null; likes: number | null; comments: number | null; checkedAt: string }

export interface MeasureDeps {
  channelViews: (handle: string) => Promise<Map<number, number>>;
  igPosts: (bizId: string) => Promise<IgPostStats[] | null>;
}
const LIVE: MeasureDeps = { channelViews: fetchChannelViews, igPosts: instagramOwnPosts };

const save = (bizId: string, kind: Kind, refId: string, s: Omit<Stat, 'checkedAt'>) =>
  sql.run(`INSERT INTO content_results (business_id, kind, ref_id, views, likes, comments, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (business_id, kind, ref_id) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments, checked_at = excluded.checked_at`,
    bizId, kind, refId, s.views, s.likes, s.comments, sql.nowIso());

function stats(bizId: string): Map<string, Stat> {
  const rows = sql.many('SELECT * FROM content_results WHERE business_id = ?', r => ({
    key: `${String(r.kind)}:${String(r.ref_id)}`, views: sql.num(r.views), likes: sql.num(r.likes), comments: sql.num(r.comments), checkedAt: String(r.checked_at),
  }), bizId);
  return new Map(rows.map(r => [r.key, r]));
}

const since = (now: number) => new Date(now - DAYS * DAY_MS).toISOString();
const firstLine = (s: string) => s.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 120) ?? '';
export const igCode = (url: string | null): string | null => (url ? /instagram\.com\/(?:p|reel)\/([^/?#]+)/.exec(url)?.[1] ?? null : null);

/** Kanalning ochiq nomi: saqlangan, bo'lmasa bot orqali bir marta aniqlanadi (eski ulanishlar) */
async function channelHandle(biz: BusinessRow): Promise<string | null> {
  const s = contentStore.settings(biz.id);
  if (!s.channelId) return null;
  if (s.channelHandle) return s.channelHandle;
  const outlet = channelOutlet();
  if (!outlet) return null;
  const ch = await outlet.resolve(s.channelId).catch(() => null);
  if (!ch?.username) return null;
  contentStore.saveSettings(biz.id, { channelHandle: ch.username });
  return ch.username;
}

const lastRun = new Map<string, number>();

/** O'lchash: nechta yozuv yangilandi (yoki nima uchun o'lchanmadi). force — panel tugmasi (30 daqiqada bir marta) */
export async function measure(biz: BusinessRow, deps: MeasureDeps = LIVE, o: { force?: boolean; now?: number } = {}): Promise<{ telegram: number | string; instagram: number | string }> {
  const now = o.now ?? Date.now();
  if (o.force && now - (lastRun.get(biz.id) ?? 0) < REFRESH_MS) throw new MeasureError("Yaqinda o'lchandi — yarim soatdan keyin qayta yangilasa bo'ladi");
  lastRun.set(biz.id, now);
  const from = since(now);
  let telegram: number | string = "kanal ulanmagan";
  const handle = await channelHandle(biz);
  if (contentStore.settings(biz.id).channelId && !handle) telegram = "kanal yopiq — ko'rishlar o'lchanmaydi";
  if (handle) {
    try {
      const views = await deps.channelViews(handle);
      telegram = 0;
      for (const d of contentStore.drafts(biz.id)) {
        if (d.status !== 'published' || !d.messageId || (d.publishedAt ?? '') < from || !views.has(d.messageId)) continue;
        save(biz.id, 'telegram', d.id, { views: views.get(d.messageId)!, likes: null, comments: null });
        telegram++;
      }
      for (const v of videoStore.list(biz.id)) {
        const msg = sql.one('SELECT channel_msg AS m FROM content_videos WHERE business_id = ? AND id = ?', r => sql.num(r.m), biz.id, v.id);
        if (!msg || (v.channelAt ?? '') < from || !views.has(msg)) continue;
        save(biz.id, 'video', v.id, { views: views.get(msg)!, likes: null, comments: null });
        telegram++;
      }
    } catch (e) {
      telegram = `kanal sahifasi ochilmadi: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  let instagram: number | string = 'Instagram ulanmagan';
  const ours = posts.list(biz.id).filter(p => p.status === 'published' && (p.publishedAt ?? '') >= from && igCode(p.url));
  if (ours.length) {
    const list = await deps.igPosts(biz.id);
    if (list) {
      const byCode = new Map(list.map(x => [x.code, x]));
      instagram = 0;
      for (const p of ours) {
        const s = byCode.get(igCode(p.url)!);
        if (!s) continue;
        save(biz.id, 'instagram', p.id, { views: s.views, likes: s.likes, comments: s.comments });
        instagram++;
      }
    }
  } else instagram = 0;
  return { telegram, instagram };
}

export class MeasureError extends Error {}

/** Jadval: kuniga bir marta (bugun o'lchanmagan bo'lsa) */
const measuredDay = new Map<string, string>();
export function measureDue(bizId: string, now: Date): boolean {
  const day = now.toISOString().slice(0, 10);
  if (measuredDay.get(bizId) === day) return false;
  measuredDay.set(bizId, day);
  return true;
}

/** Panel: oxirgi 30 kunda chiqqan kontent va reklama — natijalari bilan, yangisi oldin */
export function resultsView(biz: BusinessRow, now = Date.now()): ResultsView {
  const from = since(now);
  const st = stats(biz.id);
  const s = contentStore.settings(biz.id);
  const of = (kind: Kind, id: string) => st.get(`${kind}:${id}`);
  const items: ResultItem[] = [];
  for (const d of contentStore.drafts(biz.id)) {
    if (d.status !== 'published' || (d.publishedAt ?? '') < from) continue;
    const r = of('telegram', d.id);
    items.push({ kind: 'telegram', id: d.id, title: firstLine(d.text), at: d.publishedAt!, url: s.channelHandle && d.messageId ? `https://t.me/${s.channelHandle}/${d.messageId}` : null, views: r?.views ?? null, likes: null, comments: null, checkedAt: r?.checkedAt ?? null });
  }
  for (const v of videoStore.list(biz.id)) {
    if (!v.channelAt || v.channelAt < from) continue;
    const r = of('video', v.id);
    items.push({ kind: 'video', id: v.id, title: firstLine(v.topic), at: v.channelAt, url: null, views: r?.views ?? null, likes: null, comments: null, checkedAt: r?.checkedAt ?? null });
  }
  for (const p of posts.list(biz.id)) {
    if (p.status !== 'published' || (p.publishedAt ?? '') < from) continue;
    const r = of('instagram', p.id);
    items.push({ kind: 'instagram', id: p.id, title: firstLine(p.caption), at: p.publishedAt!, url: p.url, views: r?.views ?? null, likes: r?.likes ?? null, comments: r?.comments ?? null, checkedAt: r?.checkedAt ?? null });
  }
  const ads = adsStore.campaigns(biz.id).filter(c => c.launchedAt && c.launchedAt >= from).map(c => ({
    id: c.id, name: c.plan.name, status: c.status, at: c.launchedAt!, spent: c.spent, results: c.results, clicks: c.clicks, impressions: c.impressions, currency: c.currency,
  }));
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const checked = [...st.values()].map(x => x.checkedAt).sort().at(-1) ?? null;
  return { items, ads, checkedAt: checked, channelOpen: !s.channelId ? null : !!s.channelHandle };
}

/** Ishlaganini solishtirish uchun bitta son: ko'rish, bo'lmasa layk + izoh × 3 */
const score = (i: ResultItem) => (i.kind === 'instagram' ? (i.likes ?? 0) + 3 * (i.comments ?? 0) : i.views ?? 0);
const describe = (i: ResultItem) => {
  const where = i.kind === 'instagram' ? 'Instagram post' : i.kind === 'video' ? 'Telegram video' : 'Telegram post';
  const n = i.kind === 'instagram' ? `${i.likes ?? 0} likes, ${i.comments ?? 0} comments` : `${i.views ?? 0} views`;
  return `${where} «${i.title}»: ${n}`;
};

/**
 * Kontent-reja uchun: har joyda (Telegram, Instagram) eng yaxshi 3 ta va eng sust 2 ta o'lchangan post. Kamida 3 ta o'lchangan post
 * bo'lmasa — bo'sh (bitta-ikkita postdan xulosa chiqmaydi)
 */
export function bestAndWorst(biz: BusinessRow, now = Date.now()): { best: string[]; worst: string[] } {
  const measured = resultsView(biz, now).items.filter(i => i.checkedAt);
  const best: string[] = [], worst: string[] = [];
  for (const group of [measured.filter(i => i.kind !== 'instagram'), measured.filter(i => i.kind === 'instagram')]) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => score(b) - score(a));
    best.push(...sorted.slice(0, 3).map(describe));
    worst.push(...sorted.slice(3).slice(-2).map(describe));
  }
  return { best, worst };
}
