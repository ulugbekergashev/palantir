/**
 * Raqamlar asbobi (Yordamchi va Tahlilchi topshiriqlari): paneldagi «Raqamlar» va Direktor o'qiydigan hisob — bitta manbadan
 * (analytics.ts dashboard, funnel.ts). Davr nomlari panel bilan bir xil: «7 kun» — kechagacha to'liq 7 kun.
 * Ilgari yordamchida raqam o'qiydigan asbob yo'q edi: «har dushanba hisobot» topshirig'i raqamsiz qolardi.
 */
import { z } from 'zod';
import { periodDays, previousPeriod, type PeriodKey } from '../src/lib/dashboard';
import { dashboard } from './analytics';
import { funnel } from './funnel';
import { crmConnected } from './crm/index';
import { ToolError, def } from './toolkit';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Juda uzun davr so'ralsa (bir yildan ko'p) — hisob og'ir, foydasi kam */
const MAX_DAYS = 366;
const LABEL: Record<PeriodKey, string> = { today: 'bugun', yesterday: 'kecha', week: '7 kun', month: '30 kun', custom: 'tanlangan davr' };

const pair = (now: number, prev: number) => ({ now, prev });

export const NUMBER_DEFS = {
  business_numbers: def({
    description: "The business's numbers for a period — the same figures the owner sees on the panel and the Director reads. "
      + 'Inquiries (by channel), answered and the median first-reply time, still unanswered, requests (opened, closed, open now), booked, new customers — each with the previous period of the same length. '
      + "With DentaCRM linked also the funnel: how many of those who wrote or called came and paid, and «Murojaatlardan tushum» (revenue from inquiries, so'm) — this is not the clinic's total revenue. "
      + "period: today, yesterday, week (the last 7 full days, ending yesterday — the panel calls it «7 kun»), month (the last 30 full days, «30 kun»), or custom with from/to (YYYY-MM-DD). "
      + 'Use it for any report or question about numbers; do not guess numbers.',
    input: z.object({
      period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']).default('week'),
      from: z.string().regex(DATE).optional().describe('custom only: first day, YYYY-MM-DD'),
      to: z.string().regex(DATE).optional().describe('custom only: last day, YYYY-MM-DD'),
    }),
    run: async (i, ctx) => {
      const now = new Date();
      if (i.period === 'custom') {
        if (!i.from || !i.to || i.from > i.to) throw new ToolError("custom davr uchun from va to kerak (YYYY-MM-DD, from ≤ to)");
        if ((Date.parse(i.to) - Date.parse(i.from)) / 86_400_000 > MAX_DAYS) throw new ToolError(`Davr ${MAX_DAYS} kundan oshmasin`);
      }
      const period = periodDays(i.period, now, i.from && i.to ? { from: i.from, to: i.to } : undefined);
      const k = dashboard(ctx.biz, period, now).kpi;
      const out: Record<string, unknown> = {
        period: { label: LABEL[period.key], from: period.from, to: period.to, previous: previousPeriod(period) },
        inquiries: { ...pair(k.inquiries.value, k.inquiries.prev), instagram: k.inquiries.instagram, telegram: k.inquiries.telegram, calls: k.inquiries.calls },
        answered: { ...pair(k.answered.value, k.answered.prev), median_first_reply_min: k.answered.responseMin, prev_median_first_reply_min: k.answered.prevResponseMin },
        unanswered: { ...pair(k.unanswered.value, k.unanswered.prev), messages: k.unanswered.messages, missed_calls: k.unanswered.missedCalls },
        requests: { opened: pair(k.requests.value, k.requests.prev), closed: k.requests.closed, open_now: k.requests.open, median_close_min: k.requests.closeMin },
        booked: pair(k.booked.value, k.booked.prev),
        new_customers: pair(k.newLeads.value, k.newLeads.prev),
      };
      if (!crmConnected(ctx.biz.id)) return { ...out, crm: 'DentaCRM ulanmagan — kelgan, to\'lagan va tushum yo\'q' };
      try {
        const [cur, prev] = await Promise.all([funnel(ctx.biz, period, now), funnel(ctx.biz, previousPeriod(period), now)]);
        return {
          ...out,
          funnel_from_inquiries: {
            came: cur.came && prev.came ? pair(cur.came.total, prev.came.total) : null,
            paid: cur.paid && prev.paid ? pair(cur.paid.total, prev.paid.total) : null,
            murojaatlardan_tushum_som: cur.revenue && prev.revenue ? pair(cur.revenue.total, prev.revenue.total) : null,
          },
        };
      } catch (e) {
        console.error(`[raqamlar] DentaCRM (${ctx.biz.profile.name}):`, (e as Error).message);
        return { ...out, crm: `DentaCRM raqamlari olinmadi: ${(e as Error).message.slice(0, 200)}` };
      }
    },
  }),
};
