/**
 * Vazifa natijasi: uchrashuv, qo'ng'iroq, taklif yoki mijozga bog'liq vazifa bajarildi deb belgilansa, Cerebro natijasini so'raydi.
 * Egasining keyingi gapi (shu oraliqda) yordamchiga shu vazifa haqida ekanini aytib uzatiladi: yordamchi mijozni yangilaydi
 * (bosqich, izoh, keyingi qadam) va kerak bo'lsa keyingi vazifani qo'yadi. Holat bazada (businesses.outcome) — server qayta yonsa ham turadi.
 */
import type { Task } from '../src/types';
import { businesses, type BusinessRow } from './db';

/** taskId === DAY_OUTCOME — kechki «kun qanday o'tdi» savoli: tasks/leads — o'sha kungi ishlar (id'lar) */
interface Pending { taskId: string; title: string; leadId: string | null; at: string; tasks?: string[]; leads?: string[] }
export const DAY_OUTCOME = 'day';

/** Natijasi bo'ladigan ishlar: uchrashuv, qo'ng'iroq, gaplashish, taklif, demo, tashrif (o'zbek va rus tilida) */
const RESULTFUL = /uchrash|qo'ng'iroq|qongiroq|gaplash|bog'lan|taklif|demo|prezentats|ko'rsat|muzokara|tashrif|kelish|встреч|звон|позвон|предлож|демо|презентац|переговор|визит/i;
/** Natija shu vaqt ichida aytilmasa — so'rov eskiradi (keyingi gap oddiy gap bo'lib ketadi) */
const KEEP_MS = 3 * 3600_000;
const said = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");

export const wantsOutcome = (t: Pick<Task, 'title' | 'leadId'>): boolean => !!t.leadId || RESULTFUL.test(said(t.title));

export function askOutcome(biz: BusinessRow, t: Task): void {
  const p: Pending = { taskId: t.id, title: t.title, leadId: t.leadId ?? null, at: new Date().toISOString() };
  businesses.update(biz.id, { outcome: JSON.stringify(p) });
}

/** Kechki savol: egasining keyingi gapi — kunning yakuni, tilga olingan mijoz va vazifalar shundan yangilanadi */
export function askDay(biz: BusinessRow, taskIds: string[], leadIds: string[]): void {
  const p: Pending = { taskId: DAY_OUTCOME, title: '', leadId: null, at: new Date().toISOString(), tasks: taskIds, leads: leadIds };
  businesses.update(biz.id, { outcome: JSON.stringify(p) });
}

/** taskId berilsa — faqat o'sha vazifaning so'rovi bo'lsa yopiladi */
export function dropOutcome(bizId: string, taskId?: string): void {
  if (taskId) {
    const cur = businesses.byId(bizId)?.outcome;
    try { if (!cur || (JSON.parse(cur) as Pending).taskId !== taskId) return; } catch { /* buzilgan — yopiladi */ }
  }
  businesses.update(bizId, { outcome: null });
}

/**
 * Egasining gapi natija bo'lsa — yordamchiga uzatiladigan matn (so'rov olib tashlanadi); bo'lmasa null.
 * Vazifa nomi egasining o'z gapi (yoki yordamchi yozgan) — begona matn emas
 */
export function takeOutcome(biz: BusinessRow, text: string): string | null {
  if (!biz.outcome) return null;
  let p: Pending | null = null;
  try { p = JSON.parse(biz.outcome) as Pending; } catch { /* buzilgan — tashlanadi */ }
  dropOutcome(biz.id);
  if (!p?.taskId || Date.now() - Date.parse(p.at) > KEEP_MS) return null;
  if (p.taskId === DAY_OUTCOME) {
    const list = [p.tasks?.length ? `today's tasks: ${p.tasks.join(', ')}` : '', p.leads?.length ? `customers with a step due today: ${p.leads.join(', ')}` : ''].filter(Boolean).join('; ');
    return `(This is the owner's answer to the evening question "how did the day go". ${list ? `For reference, ${list} (ids; look them up with list_tasks and list_leads). ` : ''}For every task or customer the owner mentions: mark the task done or move it, and update the customer — stage, note, next step with next_at. Do not change anything the owner did not mention. Reply with a short list of what you recorded. If the message is clearly about something else, handle it as a normal request.)\n${text}`;
  }
  const about = `(The owner is reporting how the task "${p.title}" went${p.leadId ? `; it is about the customer with id ${p.leadId}` : ''}. Update that customer — stage, note, next step with next_at — and create the next task only if a follow-up is needed. Reply in one or two sentences with what you recorded. If the message is clearly about something else, handle it as a normal request.)`;
  return `${about}\n${text}`;
}
