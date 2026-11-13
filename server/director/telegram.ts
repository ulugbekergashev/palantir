/**
 * Direktor Telegram'da: ertalabki hisobot (kuniga bir marta; Yordamchining kun rejasi bilan bitta xabarda — scheduler.ts
 * morningMessage) va «✅ topshirish / ✖️ kerak emas» tugmalari. Hisobot faqat aytadigan narsa bo'lsa: muammo, taklif yoki
 * tekshirilgan qaror natijasi.
 */
import { addDays, iso } from '../../src/lib/week';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { approveMove, declineMove, DirectorError, directorMoves, directorRuns, runDirector } from './index';
import { moveButtons, reportHtml, type Numbers, type ReportMove } from './logic';
import type { DirectorRun } from './store';

interface Sender { sendText(chatId: string, html: string, buttons?: { text: string; data: string }[][]): Promise<void> }

/**
 * Ertalab: bugun hali tahlil qilinmagan bo'lsa — tahlil; aytadigan narsa bo'lsa — hisobot va tugmalar (yuborilmaydi).
 * Bugungi tahlil allaqachon bor (ertalabki xabar internet uzilib yetmagan, qayta yuborilyapti) — hisobot saqlanganidan qayta
 * yig'iladi: aks holda qayta yuborilgan xabarda faqat kun rejasi qolib, Direktor takliflari tushib qolardi
 */
export async function directorReport(biz: BusinessRow, now = new Date()): Promise<{ html: string; buttons: { text: string; data: string }[][] } | null> {
  const today = directorRuns.onDay(biz.id, iso(now));
  if (today) return storedReport(biz, today);
  if (!env.aiEnabled) return null;
  const r = await runDirector(biz, now);
  const html = reportHtml({ numbers: r.numbers, plan: r.plan, moves: r.moves, checked: r.checked });
  return html ? { html, buttons: moveButtons(r.moves) } : null;
}

/** Saqlangan bugungi tahlildan: raqamlar, muammo va hali hal qilinmagan takliflar (raqami — tahlildagi tartibi, tugmalar bilan bir xil) */
function storedReport(biz: BusinessRow, run: DirectorRun): { html: string; buttons: { text: string; data: string }[][] } | null {
  let numbers: Numbers;
  try { numbers = JSON.parse(run.numbers) as Numbers; } catch { return null; }
  const plan = run.problem ? { summary: run.summary, problem: { title: run.problem, evidence: run.evidence ?? '' }, moves: [] } : null;
  const moves: ReportMove[] = directorMoves.ofRun(biz.id, run.id)
    .map((m, i) => ({ m, n: i + 1 }))
    .filter(({ m }) => m.status === 'taklif')
    .map(({ m, n }) => ({ n, id: m.id, member: m.member, task: m.task, why: m.why, metric: m.metric, checkAt: iso(addDays(new Date(run.createdAt), m.checkDays)) }));
  const html = reportHtml({ numbers, plan, moves, checked: [] });
  return html ? { html, buttons: moveButtons(moves) } : null;
}

/** Faqat Direktor hisoboti (alohida xabar). Qaytadi: yuborildimi */
export async function directorMorning(bot: Sender, biz: BusinessRow, now = new Date()): Promise<boolean> {
  if (!biz.ownerChatId) return false;
  const r = await directorReport(biz, now);
  if (!r) return false;
  await bot.sendText(biz.ownerChatId, r.html, r.buttons);
  return true;
}

/**
 * Tugma: dv — topshirish, dn — kerak emas. Qaytadi: egasiga qisqa javob va xabarda qoladigan tugmalar
 * (shu tahlilning hali hal qilinmagan takliflari)
 */
export function directorButton(biz: BusinessRow, code: 'dv' | 'dn', id: string): { toast: string; alert: boolean; keyboard: { text: string; data: string }[][] } {
  const runId = directorMoves.get(biz.id, id)?.runId;
  let toast: string, alert = false;
  try {
    toast = code === 'dv' ? approveMove(biz, id) : declineMove(biz, id);
  } catch (e) {
    if (!(e instanceof DirectorError)) console.error('[direktor] tugma:', e);
    toast = e instanceof DirectorError ? e.message : 'Ichki xato';
    alert = true;
  }
  // Raqam xabardagi tartib bilan qolsin: shu tahlil takliflari ichidagi o'rni; tugma faqat hal qilinmaganlarga
  const all = runId ? directorMoves.ofRun(biz.id, runId) : [];
  return { toast, alert, keyboard: moveButtons(all.map((m, i) => ({ n: i + 1, id: m.id, status: m.status })).filter(m => m.status === 'taklif')) };
}
