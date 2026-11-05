/**
 * Direktor Telegram'da: ertalabki hisobot (kuniga bir marta; Yordamchining kun rejasi bilan bitta xabarda — scheduler.ts
 * morningMessage) va «✅ topshirish / ✖️ kerak emas» tugmalari. Hisobot faqat aytadigan narsa bo'lsa: muammo, taklif yoki
 * tekshirilgan qaror natijasi.
 */
import { iso } from '../../src/lib/week';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { approveMove, declineMove, DirectorError, directorMoves, directorRuns, runDirector } from './index';
import { moveButtons, reportHtml } from './logic';

interface Sender { sendText(chatId: string, html: string, buttons?: { text: string; data: string }[][]): Promise<void> }

/** Ertalab: bugun hali tahlil qilinmagan bo'lsa — tahlil; aytadigan narsa bo'lsa — hisobot va tugmalar (yuborilmaydi) */
export async function directorReport(biz: BusinessRow, now = new Date()): Promise<{ html: string; buttons: { text: string; data: string }[][] } | null> {
  if (!env.aiEnabled || directorRuns.onDay(biz.id, iso(now))) return null;
  const r = await runDirector(biz, now);
  const html = reportHtml({ numbers: r.numbers, plan: r.plan, moves: r.moves, checked: r.checked });
  return html ? { html, buttons: moveButtons(r.moves) } : null;
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
