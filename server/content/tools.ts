/** Yordamchi asbobi: egasining Telegram kanali uchun qoralamalar (Kontent-meyker). Chiqarish — faqat egasining tugmasi bilan */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { ContentError, runFactory, topicDraft } from './factory';

export const CONTENT_DEFS = {
  content_drafts: def({
    description: "Prepare posts for the owner's own Telegram channel (the Kontent-meyker / content factory). With a topic: one post on that topic (\"kanalimga Gemini haqida post yoz\"). Without a topic: fresh drafts from the Telegram channels the owner follows as sources. Each draft goes to the owner in Telegram with a «Kanalga joylash» button; nothing is published until the owner taps it — tell them that. Takes up to a minute.",
    input: z.object({
      topic: z.string().trim().min(5).max(2000).nullable().optional().describe("The owner's topic or a link's text, in their words; omit for drafts from the followed channels"),
    }),
    run: async (i, ctx) => {
      // Natijada manbalardan olingan (begona) material bor: shu gapda bilimga yozuvchi asboblar yopiladi
      ctx.readStrangers = true;
      try {
        if (i.topic) {
          const d = await topicDraft(ctx.biz, i.topic);
          return { drafts: 1, preview: d.text.slice(0, 300), note: "Qoralama egasining Telegram'ida — «Kanalga joylash» tugmasi bilan" };
        }
        const r = await runFactory(ctx.biz);
        return { drafts: r.made, note: r.note };
      } catch (e) {
        if (e instanceof ContentError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),
};
