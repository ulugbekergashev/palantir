/**
 * Yordamchi asboblari (Kontent-meyker): egasining Telegram kanali uchun qoralamalar, brend-buk, kontent reja va video.
 * Kanalga chiqarish — faqat egasining tugmasi bilan; video panelda yig'iladi (Kontent-meyker → Video)
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { brandStore, makeBrandBook } from './brand';
import { ContentError, runFactory, topicDraft } from './factory';
import { PLAN_MAX, PLAN_MIN, makePlan } from './plan';
import { contentStore } from './store';
import { makeVideo } from './video';

/** Kutilgan xato (kalit yo'q, AI javobi buzuq) — egasiga aytiladigan sabab */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ContentError) throw new ToolError(e.message);
    throw e;
  }
}

export const CONTENT_DEFS = {
  content_drafts: def({
    description: "Prepare posts for the owner's own Telegram channel (the Kontent-meyker / content factory). With a topic: one post on that topic (\"kanalimga Gemini haqida post yoz\"). Without a topic: fresh drafts from the Telegram channels the owner follows as sources. Each draft goes to the owner in Telegram with a «Kanalga joylash» button; nothing is published until the owner taps it — tell them that. Takes up to a minute.",
    input: z.object({
      topic: z.string().trim().min(5).max(2000).nullable().optional().describe("The owner's topic or a link's text, in their words; omit for drafts from the followed channels"),
    }),
    run: async (i, ctx) => {
      // Natijada manbalardan olingan (begona) material bor: shu gapda bilimga yozuvchi asboblar yopiladi
      ctx.readStrangers = true;
      return guarded(async () => {
        if (i.topic) {
          const d = await topicDraft(ctx.biz, i.topic);
          return { drafts: 1, preview: d.text.slice(0, 300), note: "Qoralama egasining Telegram'ida — «Kanalga joylash» tugmasi bilan" };
        }
        const r = await runFactory(ctx.biz);
        return { drafts: r.made, note: r.note };
      });
    },
  }),

  content_brand_book: def({
    description: "Write (or rewrite) the brand book the Kontent-meyker follows: positioning, voice rules, banned words, colors, visual motif, content pillars. Use when the owner asks for a brand book / brand identity / «brend-buk», or wants posts and videos «in our own style». Pass what the owner told you in their words; anything not said is inferred from the business profile. whose=personal when it is the owner's personal brand (themselves as a founder/expert), company otherwise. Takes up to a minute. After it, point the owner to panel → Marketing → Kontent-meyker → Brend-buk to see colors and edit.",
    input: z.object({
      whose: z.enum(['company', 'personal']),
      what: z.string().max(600).optional().describe('What they do, in their words'),
      audience: z.string().max(600).optional(),
      values: z.string().max(600).optional(),
      tone: z.string().max(600).optional(),
      avoid: z.string().max(600).optional(),
      look: z.string().max(600).optional().describe('Color or style wishes'),
    }),
    run: async (i, ctx) => guarded(async () => {
      const b = await makeBrandBook(ctx.biz, i, contentStore.settings(ctx.biz.id).lang);
      const book = b.book!;
      return { name: book.name, positioning: book.positioning, voice: book.voice, pillars: book.pillars.map(p => `${p.name} ${p.share}%`), motif: book.motif };
    }),
  }),

  content_plan: def({
    description: `Make a content plan: ${PLAN_MIN}-${PLAN_MAX} post/video topics spread over the brand book's pillars (e.g. «25 ta post rejasi», «kontent strategiya»). If there is no brand book yet, one is written first from the business profile — say so and suggest refining it. Topics appear in panel → Marketing → Kontent-meyker → Reja, each with «Post» and «Video» buttons. Takes up to two minutes.`,
    input: z.object({
      count: z.number().int().min(PLAN_MIN).max(PLAN_MAX),
      wish: z.string().max(600).optional().describe("The owner's focus for the plan, in their words (themes, product to push)"),
    }),
    run: async (i, ctx) => guarded(async () => {
      const r = await makePlan(ctx.biz, i.count, i.wish ?? '');
      return { topics: r.items.map(t => `${t.n}. ${t.title}`), madeBrandBook: r.madeBrand };
    }),
  }),

  content_video: def({
    description: "Prepare a short vertical (9:16) video on a topic in the brand's style: the script (scenes with on-screen text and narration) and the narrator voice (ElevenLabs). The video itself is assembled and downloaded in panel → Marketing → Kontent-meyker → Video (it renders in the browser, ~30 seconds) — tell the owner to open it there. Needs a brand book; if missing, call content_brand_book first.",
    input: z.object({ topic: z.string().trim().min(5).max(600).describe('What the video is about, in the owner\'s words') }),
    run: async (i, ctx) => guarded(async () => {
      if (!brandStore.book(ctx.biz.id)) throw new ToolError("Brend-buk yo'q — avval content_brand_book");
      const v = await makeVideo(ctx.biz, i.topic);
      return {
        scenes: v.scenes.map(s => `${s.kind}: «${s.text}» — ${s.voice}`),
        voice: v.status === 'voiced' ? `tayyor (${Math.round(v.duration)} s)` : `yo'q: ${v.error ?? 'kalit kerak'}`,
        note: 'Videoni panelda yig\'ib yuklab olish: Marketing → Kontent-meyker → Video',
      };
    }),
  }),
};
