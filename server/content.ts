/**
 * Klinikaning bir haftalik paketi: generator rejasi + bazadagi holat, variant,
 * tahrir va AI matni. Panel ham, bot ham paketni shu yerdan oladi.
 */
import type { AiText, ItemMeta, WeekView } from '../src/types';

export type { ItemMeta, WeekView };
import { buildItem, planWeek, withEdits } from '../src/lib/generator';
import { addDays, fromIso, iso, mondayOf } from '../src/lib/week';
import { aiTemplates, writeTexts } from './ai';
import { items, type ClinicRow } from './db';

let botUsername = '';
export const setBotUsername = (u: string) => { botUsername = u; };
export const getBotUsername = () => botUsername;

/** "2026-09-28-0" → "202609280" (Telegram havolasi uchun) */
export const itemCode = (itemId: string) => itemId.replace(/-/g, '');
/** "202609280" → "2026-09-28-0" */
export const itemIdFromCode = (code: string) =>
  /^\d{9}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}-${code.slice(8)}` : null;

/** Postdagi yozilish havolasi: bot ulangan bo'lsa — bot orqali (kim qaysi postdan kelgani sanaladi) */
export const bookingLink = (clinicId: string) => (itemId: string) =>
  botUsername ? `https://t.me/${botUsername}?start=l-${clinicId}-${itemCode(itemId)}` : undefined;

/** Haftaning dushanbasi (YYYY-MM-DD) to'g'rimi */
export const isMonday = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key) && iso(mondayOf(fromIso(key))) === key;

export function viewWeek(clinic: ClinicRow, monday: string): WeekView {
  const rows = new Map(items.forWeek(clinic.id, monday).map(r => [r.itemId, r]));
  const seeds = Object.fromEntries([...rows].map(([id, r]) => [id, r.seed]));
  const plans = planWeek(clinic.profile, fromIso(monday), seeds);
  const ai: Record<string, AiText | undefined> = {};
  for (const [id, r] of rows) if (r.ai?.text && r.ai.seed === r.seed) ai[id] = r.ai.text;
  const base = plans.map(p => buildItem(clinic.profile, p, { ai, bookingLink: bookingLink(clinic.id) }));
  return {
    monday,
    base,
    items: base.map(it => withEdits(it, rows.get(it.id)?.edits)),
    status: Object.fromEntries(base.map(it => [it.id, rows.get(it.id)?.status ?? 'pending'])),
    meta: Object.fromEntries(base.map(it => {
      const r = rows.get(it.id);
      return [it.id, { publishedAt: r?.publishedAt ?? null, error: r?.publishError ?? null, inChannel: !!r?.channelMessageId }];
    })),
    aiPending: inFlight.has(`${clinic.id}:${monday}`),
  };
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Hali AI yozmagan postlarga matn yozdiradi (bir hafta uchun bir vaqtda bitta so'rov).
 * Faqat kutilayotgan, tahrirlanmagan postlar — egasi tasdiqlagan yoki o'zgartirgan matn almashmaydi.
 */
export function ensureAi(clinic: ClinicRow, monday: string): Promise<void> {
  const key = `${clinic.id}:${monday}`;
  const running = inFlight.get(key);
  if (running) return running;
  // O'tgan haftalar — tarix, qayta yozilmaydi
  if (monday < iso(mondayOf(new Date()))) return Promise.resolve();

  const rows = new Map(items.forWeek(clinic.id, monday).map(r => [r.itemId, r]));
  const seeds = Object.fromEntries([...rows].map(([id, r]) => [id, r.seed]));
  const need = planWeek(clinic.profile, fromIso(monday), seeds).filter(p => {
    const r = rows.get(p.id);
    return aiTemplates.has(p.template) && (r?.status ?? 'pending') === 'pending' && !r?.edits && r?.ai?.seed !== p.seed;
  });
  if (!need.length) return Promise.resolve();

  const avoid = items.recentAi(clinic.id, monday, iso(addDays(fromIso(monday), -70)))
    .map(t => t.uz.title).filter(Boolean);
  const job = writeTexts(clinic.profile, need, avoid)
    .then(res => {
      if (!res.ok) return;
      for (const p of need) {
        if (!(p.id in res.texts)) continue;
        const current = items.get(clinic.id, p.id);
        // Kutish paytida egasi variantni almashtirgan yoki tasdiqlagan bo'lsa — tegilmaydi
        if (current && (current.seed !== p.seed || current.status !== 'pending' || current.edits)) continue;
        items.update(clinic.id, p.id, { seed: p.seed, ai: { seed: p.seed, text: res.texts[p.id] } });
      }
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/** Joriy hafta dushanbasi */
export const thisMonday = (now = new Date()) => iso(mondayOf(now));
