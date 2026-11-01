/**
 * Yordamchi asboblari (Targetolog): reja tuzish, holat, to'xtatish. ISHGA TUSHIRISH ASBOBI YO'Q — pul faqat egasi Telegram kartasidagi
 * yoki paneldagi tugmani bosganda sarflanadi (yordamchi o'zi boshlay olmaydi)
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { pause, propose } from './campaigns';
import { money, planSummary } from './plan';
import { planFromTask } from './planner';
import { TargetError, adsStore } from './store';

const asTool = (e: unknown): never => { throw e instanceof TargetError ? new ToolError(e.message) : e; };

export const ADS_DEFS = {
  ads_plan: def({
    description: "Plan a paid Meta ad campaign (Facebook + Instagram) from the owner's task — the Targetolog. Write the task fully in the owner's words: what to advertise, total budget and currency, how many days, city, audience, where people should write (Instagram Direct, WhatsApp, Messenger or a website). The plan goes to the owner in Telegram with a «Ishga tushirish» button; nothing is launched and no money is spent until the owner taps it — tell them that. If the owner gave no budget, still plan and tell them the budget is needed. Takes up to a minute.",
    input: z.object({ task: z.string().trim().min(10).max(2000).describe("The owner's task in their words") }),
    run: async (i, ctx) => {
      // Rejani faqat egasining o'z gapi tuzadi: rasm yoki mijoz matnidan emas
      if (ctx.fromPhoto || ctx.readStrangers || ctx.unattended) throw new ToolError("Reklama rejasini egasi o'z so'zi bilan, o'zi kuzatib turganda aytsin — keyingi xabarda yozing");
      const plan = await planFromTask(ctx.biz, i.task).catch(asTool);
      const c = await propose(ctx.biz, i.task, plan).catch(asTool);
      return { plan: planSummary(c.plan, c.currency), notes: c.plan.notes, next: "Reja egasining Telegram'ida — «Ishga tushirish» tugmasi bilan (limitlar tekshiriladi)" };
    },
  }),
  ads_status: def({
    description: "Current Meta ad campaigns of the Targetolog: status, spend, results (conversations started or link clicks), and the owner's spending limits.",
    input: z.object({}),
    run: (_i, ctx) => {
      const l = adsStore.limits(ctx.biz.id);
      return {
        campaigns: adsStore.campaigns(ctx.biz.id).slice(0, 15).map(c => ({
          id: c.id, name: c.plan.name, status: c.status, budget: c.plan.budget === null ? null : money(c.plan.budget, c.currency), spent: money(c.spent, c.currency),
          results: c.results, ends: c.endsAt?.slice(0, 10) ?? null, ...(c.stopReason ? { stopped: c.stopReason } : {}), ...(c.error ? { error: c.error } : {}),
        })),
        limits: l, connected: !!adsStore.connection(ctx.biz.id),
      };
    },
  }),
  ads_pause: def({
    description: 'Pause a running Meta ad campaign (stops spending immediately). Use the id from ads_status.',
    input: z.object({ campaign_id: z.string().trim().min(5).max(20) }),
    run: async (i, ctx) => {
      const c = await pause(ctx.biz, i.campaign_id).catch(asTool);
      return { paused: c.plan.name, spent: money(c.spent, c.currency) };
    },
  }),
};
