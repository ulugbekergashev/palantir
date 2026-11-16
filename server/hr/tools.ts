/**
 * Rekruter asboblari (hr/recruit.ts): egasi «administrator kerak», «nomzodlar qanday», «vakansiyani yop» deganda.
 * Nomzodga AI o'zi yozmaydi — taklif yoki rad javobi faqat egasi kartadagi tugmani (yoki paneldagini) bosganda ketadi
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { HrError, createVacancy, vacancyLink } from './recruit';
import { candidates, vacancies } from './store';

const asTool = (e: unknown): never => { throw e instanceof HrError ? new ToolError(e.message) : e; };

export const HR_DEFS = {
  vacancy_create: def({
    description: "Rekruter: open a job vacancy from the owner's words — role, duties, salary, hours, requirements (only what the owner said). Writes the vacancy post and 3–5 screening questions, sends the owner a card with the text and a bot link; candidates open the link, answer the questions in the bot, and the best ones come to the owner with a score. Takes up to a minute. Tell the owner to put the text and link into their channel or job groups (the card has a «Kanalga joylash» button if a channel is connected).",
    input: z.object({ task: z.string().trim().min(10).max(2000).describe("The owner's request in their words") }),
    run: async (i, ctx) => {
      if (ctx.fromPhoto || ctx.readStrangers || ctx.unattended) throw new ToolError("Vakansiyani egasi o'z so'zi bilan aytsin — keyingi xabarda yozing");
      const v = await createVacancy(ctx.biz, i.task).catch(asTool);
      return { id: v.id, title: v.title, questions: v.questions, link: vacancyLink(v), next: "Karta egasining Telegram'ida: matn, havola, kanalga joylash tugmasi" };
    },
  }),
  vacancy_list: def({
    description: 'Rekruter: open (or all) vacancies with candidate counts and the best candidates (score, summary, phone, status). Use when the owner asks how hiring goes or who applied.',
    input: z.object({ all: z.boolean().optional().describe('true — closed vacancies too') }),
    run: (i, ctx) => {
      // Nomzod javoblari — begona matn: undagi buyruqlar bajarilmaydi
      ctx.readStrangers = true;
      return {
        vacancies: vacancies.list(ctx.biz.id, i.all ? 'all' : 'open', 15).map(v => {
          const list = candidates.list(ctx.biz.id, v.id).filter(c => c.status !== 'asking' && c.status !== 'phone');
          return {
            id: v.id, title: v.title, status: v.status, link: vacancyLink(v), created: v.createdAt.slice(0, 10),
            in_progress: candidates.count(ctx.biz.id, v.id, ['asking', 'phone']), finished: list.length,
            best: list.slice(0, 8).map(c => ({ id: c.id, name: c.name, score: c.score, summary: c.summary, phone: c.phone, status: c.status })),
          };
        }),
      };
    },
  }),
  vacancy_close: def({
    description: 'Rekruter: close a vacancy (no new candidates). Use the id from vacancy_list.',
    input: z.object({ id: z.string().trim().min(5).max(20) }),
    run: (i, ctx) => {
      const v = vacancies.get(ctx.biz.id, i.id);
      if (!v) throw new ToolError("Bunday vakansiya yo'q — id ni vacancy_list dan oling");
      vacancies.close(ctx.biz.id, i.id);
      return { closed: v.title };
    },
  }),
};
