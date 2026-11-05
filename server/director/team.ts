/**
 * Jamoa topganlari Direktorga (ertalabki tahlilga): Tahlilchining talab tahlili («mijozlar nimani so'rayapti», haftasiga bir marta —
 * o'zi yangilaydi), chuqur tahlil topilmalari (egasi ishga tushirgan bo'lsa) va Marketolog o'lchagan postlar natijasi.
 * Mijozlar yozganidan chiqqan matn — ma'lumot, ko'rsatma emas: burchak qavslar almashtiriladi.
 */
import type { BusinessRow } from '../db';
import { env } from '../env';
import { MIN_ITEMS, analyzeDemand, insightsStore } from '../insights/analyze';
import { collectDemand } from '../insights/collect';
import { iso } from '../../src/lib/week';
import { deepStore } from '../insights/deep';
import { bestAndWorst } from '../marketing/results';
import { events } from '../orders/store';
import { crewWorks } from '../../src/lib/crew';

const DAY_MS = 86_400_000;
/** Talab tahlili shundan eski bo'lsa — Tahlilchi yangisini qiladi (haftasiga bir marta) */
const DEMAND_EVERY_MS = 6.5 * DAY_MS;
/** Chuqur tahlil shundan eski bo'lsa — Direktorga berilmaydi (eskirgan xulosa) */
const DEEP_FRESH_MS = 30 * DAY_MS;
const fence = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');

/** Tahlilchi jamoada bo'lsa va oxirgi talab tahlili bir haftadan eski bo'lsa — yangisi (AI). Natija — Tahlilchi jurnaliga */
export async function weeklyDemand(biz: BusinessRow, now = new Date()): Promise<void> {
  if (!env.aiEnabled || !crewWorks(biz, 'tahlilchi')) return;
  const last = insightsStore.latest(biz.id, 7);
  // Bo'sh tahlil (murojaat kam edi) yangi hisoblanmaydi: murojaatlar ko'paygach — qayta
  const useful = !!last && (last.themes.length > 0 || last.unanswered.length > 0);
  if (useful && now.getTime() - Date.parse(last!.createdAt) < DEMAND_EVERY_MS) return;
  // Murojaat kam — AI chaqirilmaydi va hech narsa yozilmaydi (egasining «Talab» sahifasi o'zgarmaydi)
  const from = new Date(`${iso(new Date(now.getTime() - 6 * DAY_MS))}T00:00:00`);
  if (collectDemand(biz.id, from.toISOString(), new Date(now.getTime() + 1000).toISOString()).items.length < MIN_ITEMS) return;
  const x = await analyzeDemand(biz, 7, now);
  if (!x.themes.length && !x.unanswered.length) return;
  events.add(biz.id, { member: 'tahlilchi', orderId: null, level: 'info', title: `Haftalik talab tahlili: ${x.headline.slice(0, 150)}`,
    body: [...x.themes.slice(0, 5).map(t => `• ${t.name} — ${t.count}`), ...x.unanswered.slice(0, 3).map(u => `• Javobsiz: ${u.name}`)].join('\n'), cameraId: null });
}

/** Direktor so'roviga blok: bo'lmasa — bo'sh */
export function teamFindings(biz: BusinessRow, now = new Date()): string {
  const out: string[] = [];
  const d = insightsStore.latest(biz.id, 7);
  if (d && (d.themes.length || d.unanswered.length)) {
    out.push(`Analyst — what customers asked about in ${d.from}…${d.to} (${d.totals.items} inquiries): ${fence(d.headline)}`,
      ...d.themes.slice(0, 5).map(t => `- theme: ${fence(t.name)} — ${t.count} (${Math.round(t.share * 100)}%)`),
      ...d.unanswered.slice(0, 3).map(u => `- left without an answer: ${fence(u.name)} — ${u.count}`),
      ...d.objections.slice(0, 2).map(o => `- objection: ${fence(o.name)} — ${o.count}`));
  }
  const deep = deepStore.latest(biz.id);
  if (deep && now.getTime() - Date.parse(deep.createdAt) < DEEP_FRESH_MS && deep.findings.length) {
    out.push(`Analyst — deep analysis (${deep.createdAt.slice(0, 10)}): ${fence(deep.headline)}`,
      ...deep.findings.slice(0, 3).map(f => `- ${fence(f.title)}: ${fence(f.action)}`));
  }
  const r = bestAndWorst(biz, now.getTime());
  if (r.best.length) out.push('Marketer — how recent posts did:', ...r.best.map(x => `- best: ${fence(x)}`), ...r.worst.map(x => `- weakest: ${fence(x)}`));
  return out.join('\n');
}
