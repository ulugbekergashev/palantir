/**
 * Yordamchi asboblari: kompyuterdagi ish (brauzer yoki butun ekran). Ish fonda boradi (jobs.ts) — yordamchi darhol «boshladim» deydi,
 * natija va fayllar keyin Telegram'ga keladi. Ro'yxatda faqat yoqilgan bo'lsa: egasi Sozlamalar → «Kompyuterda ishlash» da yoki .env COMPUTER_USE.
 */
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { ToolError, def } from '../toolkit';
import { openForOwner, searchYoutube } from './media';
import { ComputerError, computerJobs, computerModeOf, jobView, modeEnabled, runningJob, startJob, stopJob } from './jobs';

export const COMPUTER_DEFS = {
  computer_task: def({
    description: "Do a task on the owner's computer in the background and report back in Telegram: in a browser (open sites, search, read, fill forms, download files — e.g. \"soliq.uz dan dalolatnomani yuklab ol\", \"OLX da shu narxdagi kreslolarni top\") or, with where=desktop, on the whole screen with mouse and keyboard (programs other than the browser, e.g. 1C, Excel, files). Write the task fully and concretely in the owner's words: site, what to find or do, what result to bring. Before sending, submitting or deleting anything the owner gets a Telegram button to approve. Money is closed: banks, internet banking, payment systems, paying, transferring money and buying are blocked in code even with the owner's approval — such a task is refused; tell the owner to do it themselves (you can still give numbers, reports and calculations). Reading is not money: prices in shops, the Central Bank (cbu.uz) exchange rate, test forms — send them. Never refuse from memory because a similar task was refused earlier in the chat: the rules get fixed, so call this tool again; it tells you itself if the task is closed. The browser keeps logins made with the /brauzer command; the operator never types passwords. Not for playing music or videos — use play_media for that (instant, no approval). One task at a time; it takes minutes. Tell the owner you started and that the result will come in Telegram — do not wait.",
    input: z.object({
      task: z.string().trim().min(5).max(2000).describe('The full task in the owner\'s words'),
      title: z.string().trim().max(90).optional().describe('One short line in the owner\'s language naming the task (up to 90 chars), e.g. «Meta: Leadboost nomini Verion IT Company ga o\'zgartirish» — shown first in Telegram messages and buttons'),
      where: z.enum(['browser', 'desktop']).optional().describe('browser (default) — a separate Chrome window; desktop — the whole computer screen, only when a desktop program is needed'),
    }),
    run: (i, ctx) => {
      const mode = i.where ?? (modeEnabled('browser', ctx.biz) ? 'browser' : 'desktop');
      // Topshiriq matni egasining shu payt yozgani emas bo'lishi mumkin (rasm, mijoz xabari, internet, jadval) — boshlashdan oldin egasi tasdiqlaydi
      const confirmFirst = !!(ctx.fromPhoto || ctx.unattended || ctx.readStrangers);
      try {
        const job = startJob(ctx.biz, i.task, mode, confirmFirst, i.title ?? null);
        return {
          started: true, job_id: job.id, where: mode,
          note: mode === 'desktop' || confirmFirst
            ? "Egasiga Telegram'da «Boshlaymi?» tugmasi bordi — tasdiqlagach boshlanadi. Natija Telegram'ga keladi."
            : "Boshlandi. Xavfli qadamlar oldidan egasidan Telegram'da so'raladi; natija va fayllar Telegram'ga keladi; to'xtatish — /toxta.",
        };
      } catch (e) {
        if (e instanceof ComputerError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),

  play_media: def({
    description: "Play a song or music or open a video for the owner RIGHT NOW (\"qo'shiq qo'y\", \"musiqa yoq\", \"включи песню\", \"YouTube'da … ni och\"): finds it on YouTube and opens it in the owner's browser on this computer — they see and hear it at once, no approval and no Chrome connection needed. Use this, never computer_task, for music and videos. Give a good search query (artist + song; for 'something by X' just the artist). The result lists the opened video and other matches; to switch, call again with video_id. Say in one short line what is playing.",
    input: z.object({
      query: z.string().trim().min(2).max(200).describe('YouTube search query, e.g. «Minor Zamonnoma» or «Shahzoda Ayt»'),
      video_id: z.string().regex(/^[\w-]{11}$/).optional().describe('Open exactly this video (an id from the previous result) instead of the first match'),
    }),
    run: async (i, ctx) => {
      // Egasisiz (jadval, avtomatik ish) — ochilmaydi. Begona matn (internet qidiruvi) to'smaydi: ochiladigan narsa faqat YouTube video sahifasi
      if (ctx.unattended) throw new ToolError("Musiqa/video faqat egasining o'z buyrug'i bilan ochiladi");
      const found = await searchYoutube(i.query).catch((e: Error) => { throw new ToolError(`YouTube'da qidirib bo'lmadi: ${e.message}`); });
      const pick = i.video_id
        ? found.find(v => v.id === i.video_id) ?? { id: i.video_id, title: i.query, url: `https://www.youtube.com/watch?v=${i.video_id}` }
        : found[0];
      if (!pick) throw new ToolError(`YouTube'da «${i.query}» topilmadi`);
      openForOwner(pick.url);
      return { playing: pick.title, url: pick.url, other_matches: found.filter(v => v.id !== pick.id).map(v => ({ video_id: v.id, title: v.title })) };
    },
  }),

  computer_status: def({
    description: 'The computer task running now (if any) and the last finished ones with their reports. Use when the owner asks how the computer task is going or what it found.',
    input: z.object({}),
    run: (_i, ctx) => {
      // Hisobotda sahifalardan olingan matn bor — begona matn
      ctx.readStrangers = true;
      const now = runningJob(ctx.biz.id);
      return { running: now ? jobView(now) : null, recent: computerJobs.recent(ctx.biz.id, 5).filter(j => j.id !== now?.id).map(jobView) };
    },
  }),

  computer_stop: def({
    description: 'Stop the computer task running now (the owner said stop / to\'xtat).',
    input: z.object({}),
    run: (_i, ctx) => {
      if (!stopJob(ctx.biz.id)) throw new ToolError('Hozir kompyuterda ish bajarilmayapti');
      return { stopped: true };
    },
  }),
};

/** Asboblar ro'yxatiga qo'shiladimi */
export const computerEnabled = (biz: Pick<BusinessRow, 'computerUse'> | null | undefined): boolean => computerModeOf(biz) !== '';
