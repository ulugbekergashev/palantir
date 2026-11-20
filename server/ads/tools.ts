/**
 * Yordamchi asboblari (Targetolog): reja tuzish, holat, to'xtatish. ISHGA TUSHIRISH ASBOBI YO'Q — pul faqat egasi Telegram kartasidagi
 * yoki paneldagi tugmani bosganda sarflanadi (yordamchi o'zi boshlay olmaydi)
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { imagePath, pause, propose, uploadVideo, videoFile } from './campaigns';
import { AdsError, graph } from './graph';
import { money, planSummary } from './plan';
import { availableImages, ownerBudget, planFromTask } from './planner';
import { TargetError, adsStore } from './store';

const asTool = (e: unknown): never => { throw e instanceof TargetError || e instanceof AdsError ? new ToolError(e.message) : e; };

export const ADS_DEFS = {
  ads_plan: def({
    description: "Plan a paid Meta ad campaign (Facebook + Instagram) from the owner's task — the Targetolog. Write the task fully in the owner's words: what to advertise, total budget and currency, how many days, city, audience, where people should write (Instagram Direct, WhatsApp, Messenger or a website). The plan goes to the owner in Telegram with a «Ishga tushirish» button; nothing is launched and no money is spent until the owner taps it — tell them that. If the owner gave no budget, still plan and tell them the budget is needed. Takes up to a minute.",
    input: z.object({ task: z.string().trim().min(10).max(2000).describe("The owner's task in their words") }),
    run: async (i, ctx) => {
      // Rejani faqat egasining o'z gapi tuzadi: rasm yoki mijoz matnidan emas
      if (ctx.fromPhoto || ctx.readStrangers || ctx.unattended) throw new ToolError("Reklama rejasini egasi o'z so'zi bilan, o'zi kuzatib turganda aytsin — keyingi xabarda yozing");
      // Byudjet faqat egasining o'z gapidan (egasi qarori 2026-11-16): topshiriq matnini model yozadi — u summa qo'shib yuborsa ham,
      // egasi aytmagan summa rejaga tushmaydi (byudjetsiz reja ishga tushmaydi, egasi summani o'zi yozadi)
      const plan = ownerBudget(await planFromTask(ctx.biz, i.task).catch(asTool), ctx.ownerSaid ?? '');
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
        images: availableImages(ctx.biz.id),
      };
    },
  }),
  ads_upload_media: def({
    description: "Upload one of the business's own pictures or videos to the Meta ad account for a creative (Meta's ads tools). ref comes from ads_status images (post:…, file:…, video:…). Returns image_hash for a picture, or video_id for a video. A video takes up to a few minutes.",
    input: z.object({ ref: z.string().trim().regex(/^(?:post|file|video):[A-Za-z0-9_.-]{6,40}$/) }),
    run: async (i, ctx) => {
      const c = adsStore.connection(ctx.biz.id);
      if (!c) throw new ToolError('Meta reklama kabineti ulanmagan (Marketing → Targetolog → Ulash)');
      const act = `act_${c.adAccountId}`;
      const video = videoFile(i.ref, ctx.biz.id);
      if (video) return { video_id: await uploadVideo(c, act, video, `palantir-${i.ref.replace(/\W/g, '-')}.mp4`).catch(asTool) };
      const path = imagePath(i.ref, ctx.biz.id);
      if (!path) throw new ToolError('Bunday rasm yo\'q — ads_status images ro\'yxatidan tanlang');
      const r = await graph<{ images?: Record<string, { hash?: string }> }>(c.token, 'POST', `${act}/adimages`, { bytes: readFileSync(path).toString('base64'), name: `palantir-${i.ref.replace(/\W/g, '-')}.jpg` })
        .catch(asTool);
      const hash = Object.values(r.images ?? {}).find(x => x?.hash)?.hash;
      if (!hash) throw new ToolError('Meta rasmni qabul qildi, lekin kodini qaytarmadi');
      return { image_hash: hash };
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
