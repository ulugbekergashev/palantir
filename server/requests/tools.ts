/**
 * Yordamchi asboblari: so'rovlar (qo'ng'iroq qilish, qabul, surish, shikoyat). Egasi «kim qo'ng'iroq qilishni so'radi»,
 * «Malikaga qo'ng'iroq qildim, ertaga keladi», «Sardorga ertaga qo'ng'iroq qilish kerak» deganda.
 */
import { z } from 'zod';
import type { LeadRequest } from '../../src/types';
import { leads } from '../db';
import { ToolError, def } from '../toolkit';
import { RequestError, closeRequest, noAnswer, openRequest } from './index';
import { requests } from './store';

const view = (r: LeadRequest) => ({
  id: r.id, kind: r.kind, status: r.status, customer_id: r.leadId, name: r.name, phone: r.phone, what: r.summary,
  ...(r.whenText || r.dueAt ? { when: r.whenText, due_at: r.dueAt } : {}), source: r.source, created: r.createdAt,
  ...(r.attempts ? { no_answer_attempts: r.attempts } : {}), ...(r.result ? { result: r.result } : {}), ...(r.doneBy ? { by: r.doneBy } : {}),
});
const KIND = z.enum(['callback', 'booking', 'change', 'complaint', 'other']);

export const REQUEST_DEFS = {
  list_requests: def({
    description: 'Requests where a customer waits for staff to act: "callback" (asked to be phoned or left a number), "booking" (wants an appointment that was not booked in the chat), "change" (move or cancel a visit), "complaint". They come from Instagram, Telegram, missed calls and the voice agent, and go to the reception staff in Telegram with buttons. Open ones first, oldest first.',
    input: z.object({ status: z.enum(['open', 'closed', 'all']).optional().describe('Default: open') }),
    run: (i, ctx) => {
      ctx.readStrangers = true;
      const list = requests.list(ctx.biz.id, i.status ?? 'open', 60);
      return { open_total: requests.openCount(ctx.biz.id), requests: list.map(view) };
    },
  }),

  open_request: def({
    description: 'Open a request for the reception staff (they get a Telegram card with Done / No answer buttons and reminders), when the owner says someone must be phoned or handled: "Sardorga ertaga 10 da qo\'ng\'iroq qilish kerak". Give customer_id when the customer is known (list_leads), else the phone.',
    input: z.object({
      kind: KIND,
      customer_id: z.string().trim().max(20).optional(),
      phone: z.string().trim().max(40).optional(),
      name: z.string().trim().max(80).optional(),
      what: z.string().trim().min(1).max(400).describe('What the staff member must do, in Uzbek, short'),
      due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().describe('Local time to do it, YYYY-MM-DDTHH:MM'),
    }),
    run: async (i, ctx) => {
      if (!i.customer_id && !i.phone) throw new ToolError('customer_id yoki phone kerak');
      if (i.customer_id && !leads.get(ctx.biz.id, i.customer_id)) throw new ToolError(`Mijoz topilmadi: ${i.customer_id}`);
      const { request, created } = await openRequest(ctx.biz, i.customer_id ?? null, { kind: i.kind, phone: i.phone, name: i.name, summary: i.what, dueAt: i.due_at, source: 'owner' });
      return { request: view(request), created, status: 'sent to the reception staff in Telegram' };
    },
  }),

  close_request: def({
    description: 'Record what happened with a request: "done" (handled, with the result), "no_answer" (phoned, nobody picked up — staff are reminded again in 30 minutes, up to 3 attempts) or "cancelled". The staff cards in Telegram update too.',
    input: z.object({ request_id: z.string().trim().min(1).max(20), outcome: z.enum(['done', 'no_answer', 'cancelled']), result: z.string().trim().max(400).optional() }),
    run: async (i, ctx) => {
      const by = ctx.biz.profile.ownerName || 'Egasi';
      try {
        const r = i.outcome === 'no_answer' ? await noAnswer(ctx.biz, i.request_id, by) : await closeRequest(ctx.biz, i.request_id, i.outcome, by, i.result ?? null);
        return { request: view(r) };
      } catch (e) {
        if (e instanceof RequestError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),
};
