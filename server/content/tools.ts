/**
 * Yordamchi asboblari (Kontent-meyker): Telegram kanali va Instagram uchun qoralamalar, brend-buk, kontent reja va video.
 * Chiqarish — faqat egasining tugmasi bilan; video mp4 shu kompyuterda yig'iladi (HyperFrames), panelda ko'riladi (Kontent-meyker → Video)
 */
import { z } from 'zod';
import { ToolError, assertOwnWords, def } from '../toolkit';
import { MetaAiError } from '../marketing/metaAi';
import { MAX_CAPTION, PostError, captionWarnings, draftWithPicture } from '../marketing/posts';
import { pictureMaker } from './picture';
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

  draft_post: def({
    description: "Prepare an Instagram post (a picture with a caption) — the Kontent-meyker's job, like channel posts and videos. Nothing is published until the owner presses «Instagram'ga joylash» in Telegram or in panel → Marketing → Kontent-meyker → Postlar. You write the caption yourself, in the business's content language: a hook line, the substance in 2-4 short lines, a call to action, 5-10 hashtags; no exaggerated promises (for clinics: no «kafolat», «og'riqsiz», «eng yaxshi»). The picture is drawn from image_description in the background — by Meta AI if the owner connected it (a few minutes, shares the daily Meta AI limit), otherwise by Gemini; describe what is in the picture concretely (scene, style, colours) and never ask for text inside the picture. If the owner wants their own photo, tell them to add it in panel → Kontent-meyker → Postlar → Instagram. Tell the owner the draft will come to Telegram for approval.",
    input: z.object({
      caption: z.string().trim().min(10).max(MAX_CAPTION).describe('The full post caption, ready to publish'),
      image_description: z.string().trim().min(10).max(1000).describe('What the picture should show'),
    }),
    run: (i, ctx) => {
      const maker = pictureMaker(ctx.biz);
      if (!maker) throw new ToolError("Rasm chizadigan xizmat ulanmagan (Meta AI yoki Gemini) — egasi o'z suratini panel → Kontent-meyker → Postlar'da qo'shsin");
      try {
        const p = draftWithPicture(ctx.biz, i.caption, i.image_description, maker);
        const warnings = captionWarnings(ctx.biz, p.caption);
        return {
          started: true, post_id: p.id, picture_by: maker === 'meta_ai' ? 'Meta AI' : 'Gemini',
          note: "The picture is being drawn in the background; the draft with the picture will come to the owner's Telegram with a «Joylash» button, and to panel → Kontent-meyker → Postlar.",
          ...(warnings.length ? { caption_warnings: warnings } : {}),
        };
      } catch (e) {
        if (e instanceof MetaAiError || e instanceof PostError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),

  content_brand_book: def({
    description: "Write (or rewrite) the brand book the Kontent-meyker follows: positioning, voice rules, banned words, colors, visual motif, content pillars. Use when the owner asks for a brand book / brand identity / «brend-buk», or wants posts and videos «in our own style». Pass what the owner told you in their words; anything not said is inferred from the business profile. whose=personal when it is the owner's personal brand (themselves as a founder/expert), company otherwise. Takes up to a minute. After it, point the owner to panel → Miya → Brend to see colors and edit — the whole team writes in this voice.",
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
      // Brend-buk keyingi hamma postlar ovozini belgilaydi: faqat egasining o'z gapidan (rasm, mijoz matni yoki jadvaldan emas)
      assertOwnWords(ctx);
      const b = await makeBrandBook(ctx.biz, i, contentStore.settings(ctx.biz.id).lang);
      const book = b.book!;
      return { name: book.name, positioning: book.positioning, voice: book.voice, pillars: book.pillars.map(p => `${p.name} ${p.share}%`), motif: book.motif };
    }),
  }),

  content_plan: def({
    description: `Make a content plan: ${PLAN_MIN}-${PLAN_MAX} post/video topics spread over the brand book's pillars (e.g. «25 ta post rejasi», «kontent strategiya»). If there is no brand book yet, one is written first from the business profile — say so and suggest refining it. It also uses the Marketolog's recent Meta AI research, if there is any. Topics appear in panel → Marketing → Kontent-meyker → Reja, each with «Telegram», «Instagram» and «Video» buttons. Takes up to two minutes.`,
    input: z.object({
      count: z.number().int().min(PLAN_MIN).max(PLAN_MAX),
      wish: z.string().max(600).optional().describe("The owner's focus for the plan, in their words (themes, product to push)"),
    }),
    run: async (i, ctx) => guarded(async () => {
      assertOwnWords(ctx);
      const r = await makePlan(ctx.biz, i.count, i.wish ?? '');
      return { topics: r.items.map(t => `${t.n}. ${t.title}`), madeBrandBook: r.madeBrand };
    }),
  }),

  content_video: def({
    description: "Prepare a short vertical (9:16) video on a topic in the brand's style: the script (scenes with on-screen text and narration) and the narrator voice (the brand book's narrator, Gemini TTS). After the voice is recorded, the finished mp4 (kinetic text in the brand's colors, word-by-word subtitles, scene transitions) is rendered automatically on this computer in 2–4 minutes; the owner watches and downloads it in panel → Marketing → Kontent-meyker → Video — tell them to open it there. Needs a brand book; if missing, call content_brand_book first.",
    input: z.object({ topic: z.string().trim().min(5).max(600).describe('What the video is about, in the owner\'s words') }),
    run: async (i, ctx) => guarded(async () => {
      // Ovoz pullik xizmatni (Gemini TTS, zaxira — ElevenLabs) ishlatadi: faqat egasi o'zi so'raganda
      assertOwnWords(ctx);
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
