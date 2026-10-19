/**
 * Talab tahlili (Tahlilchi → «Talab»): davrda mijozlar nimani so'radi, nimaga javob topilmadi, nima to'xtatdi va egasi nima qilsin.
 * Model faqat guruhlaydi (har bandni id bilan mavzuga biriktiradi) va xulosa yozadi; sanash, ulush va misollar — kodda (shape),
 * shuning uchun «9 kishi so'radi» degan raqam bandlar soniga teng va tekshirsa bo'ladi. Natija bazada saqlanadi — ochilganda pul ketmaydi.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Lang } from '../../src/types';
import { iso } from '../../src/lib/week';
import { think } from '../claude';
import { newId, sql, type BusinessRow } from '../db';
import { env } from '../env';
import { collectDemand, type DemandData } from './collect';
import { LIMITS, SCHEMA, shape, stripIds, systemPrompt, type Group, type RawGroup } from './logic';

export interface Insights {
  days: number; from: string; to: string; createdAt: string;
  totals: { items: number; messages: number; calls: number; requests: number };
  headline: string;
  themes: Group[];
  unanswered: Group[];
  objections: Group[];
  actions: { title: string; why: string }[];
  hours: number[]; days7: number[];
}

/** Model chaqirilmaydi: bunchadan kam murojaatda tahlil ma'nosiz */
export const MIN_ITEMS = 3;

sql.exec(`CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, days INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS insights_biz ON insights (business_id, days, created_at);`);

export const insightsStore = {
  latest: (bizId: string, days: number): Insights | null =>
    sql.one('SELECT data FROM insights WHERE business_id = ? AND days = ? ORDER BY created_at DESC LIMIT 1', r => JSON.parse(String(r.data)) as Insights, bizId, days) ?? null,
  save(bizId: string, x: Insights): void {
    sql.run('INSERT INTO insights (id, business_id, days, data, created_at) VALUES (?, ?, ?, ?, ?)', newId(10), bizId, x.days, JSON.stringify(x), x.createdAt);
    // Har davr uchun oxirgi 10 tasi qoladi
    sql.run('DELETE FROM insights WHERE business_id = ? AND days = ? AND id NOT IN (SELECT id FROM insights WHERE business_id = ? AND days = ? ORDER BY created_at DESC LIMIT 10)', bizId, x.days, bizId, x.days);
  },
};

function empty(days: number, from: string, to: string, data: DemandData, headline: string): Insights {
  return { days, from, to, createdAt: new Date().toISOString(), totals: { items: data.items.length, ...data.totals }, headline, themes: [], unanswered: [], objections: [], actions: [], hours: data.hours, days7: data.days };
}

/** Oxirgi `days` kun (bugun ham) tahlili; murojaat kam bo'lsa model chaqirilmaydi */
export async function analyzeDemand(biz: BusinessRow, days: number, now = new Date()): Promise<Insights> {
  const from = new Date(`${iso(new Date(now.getTime() - (days - 1) * 86_400_000))}T00:00:00`), to = now;
  const data = collectDemand(biz.id, from.toISOString(), new Date(to.getTime() + 1000).toISOString());
  const range = { from: iso(from), to: iso(to) };
  if (data.items.length < MIN_ITEMS) {
    const few = empty(days, range.from, range.to, data, "Bu davrda tahlil qilish uchun murojaat kam — mijozlar yozgan va qo'ng'iroq qilgan sari bu yerda ular nimani so'rayotgani chiqadi.");
    insightsStore.save(biz.id, few);
    return few;
  }
  const lang: Lang = biz.profile.contentLang === 'ru' ? 'ru' : 'uz';
  const res: Anthropic.Beta.BetaMessage = await think(biz.id, 'owner', {
    model: env.aiModel,
    max_tokens: 12_000,
    system: systemPrompt(lang),
    messages: [{ role: 'user', content: `Business: ${biz.profile.name} (${biz.profile.industry || 'industry not set'})\nPeriod: ${range.from} — ${range.to}\n\n<items>\n${data.items.map(i => `[${i.id}] ${i.text}`).join('\n')}\n</items>` }],
    thinking: { type: 'adaptive', display: 'omitted' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (res.stop_reason === 'refusal') throw new Error("Tahlil qilinmadi (model rad etdi)");
  const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
  const raw = JSON.parse(text) as { headline?: string; themes?: RawGroup[]; unanswered?: RawGroup[]; objections?: RawGroup[]; actions?: { title?: string; why?: string }[] };
  const result: Insights = {
    ...empty(days, range.from, range.to, data, stripIds(String(raw.headline ?? '')).slice(0, 400)),
    themes: shape(raw, data.items, true, 'themes'),
    unanswered: shape(raw, data.items, false, 'unanswered'),
    objections: shape(raw, data.items, false, 'objections'),
    actions: (raw.actions ?? []).map(a => ({ title: stripIds(String(a.title ?? '')).slice(0, 160), why: stripIds(String(a.why ?? '')).slice(0, 300) })).filter(a => a.title).slice(0, LIMITS.actions),
  };
  insightsStore.save(biz.id, result);
  return result;
}
