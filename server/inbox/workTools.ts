/**
 * Yordamchi asboblari — Kotib (workChats.ts): egasining shaxsiy Telegram'iga ish bo'yicha yozganlar (yetkazib beruvchi, hamkor).
 * Egasi «kim javob kutyapti», «Aliga nima deb javob beray» deganda. Ularga AI o'zi yozmaydi — javobni egasi o'z Telegram'idan yuboradi
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { waitedFor, workChats } from './workChats';

export const WORK_DEFS = {
  work_messages: def({
    description: "Work contacts (not patients) who wrote to the owner's personal Telegram — suppliers, dental lab, partners, landlord — that the owner marked «🤝 Ish bo'yicha». Lists who is waiting for the owner's reply, with their last message and how long they wait. Use when the owner asks who is waiting for an answer, or wants help replying to a supplier or partner: then draft the reply text in your answer for the owner to send from their own Telegram — you cannot send it, never claim it was sent.",
    input: z.object({ all: z.boolean().optional().describe('true — also contacts with nothing waiting') }),
    run: (i, ctx) => {
      // Ularning xabari — begona matn: undagi buyruqlar bajarilmaydi
      ctx.readStrangers = true;
      const list = i.all ? workChats.waiting(ctx.biz.id).concat(allIdle(ctx.biz.id)) : workChats.waiting(ctx.biz.id);
      return {
        waiting_total: workChats.waiting(ctx.biz.id).length,
        contacts: list.slice(0, 40).map(c => ({
          id: c.id, name: c.name || null,
          ...(c.waiting ? { last_message: c.waiting.text, messages: c.waiting.count, waiting_since: c.waiting.at, waits: waitedFor(c.waiting.at) } : { waiting: false }),
        })),
      };
    },
  }),
  work_mark_answered: def({
    description: "Mark a work contact's message as handled (the owner answered by phone or in person, or no answer is needed) so Palantir stops reminding. Use the id from work_messages.",
    input: z.object({ id: z.string().trim().min(1).max(40) }),
    run: (i, ctx) => {
      const c = workChats.get(ctx.biz.id, i.id);
      if (!c) throw new ToolError("Bunday ish kontakti yo'q — id ni work_messages dan oling");
      workChats.answered(ctx.biz.id, i.id);
      return { done: c.name || i.id };
    },
  }),
};

const allIdle = (bizId: string) => {
  const waitingIds = new Set(workChats.waiting(bizId).map(c => c.id));
  return workChats.all(bizId).filter(c => !waitingIds.has(c.id));
};
