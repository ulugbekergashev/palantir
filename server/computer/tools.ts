/**
 * Yordamchi asboblari: kompyuterdagi ish (brauzer yoki butun ekran). Ish fonda boradi (jobs.ts) — yordamchi darhol «boshladim» deydi,
 * natija va fayllar keyin Telegram'ga keladi. Faqat .env da COMPUTER_USE yoqilgan bo'lsa ro'yxatda bo'ladi.
 */
import { z } from 'zod';
import { env } from '../env';
import { ToolError, def } from '../toolkit';
import { ComputerError, computerJobs, jobView, modeEnabled, runningJob, startJob, stopJob } from './jobs';

export const COMPUTER_DEFS = {
  computer_task: def({
    description: "Do a task on the owner's computer in the background and report back in Telegram: in a browser (open sites, search, read, fill forms, download files — e.g. \"soliq.uz dan dalolatnomani yuklab ol\", \"OLX da shu narxdagi kreslolarni top\", \"bankdagi ko'chirmani yuklab ol\") or, with where=desktop, on the whole screen with mouse and keyboard (programs other than the browser, e.g. 1C, Excel, files). Write the task fully and concretely in the owner's words: site, what to find or do, what result to bring. Before sending, submitting, paying or deleting anything the owner gets a Telegram button to approve. The browser keeps logins made with the /brauzer command; the operator never types passwords. One task at a time; it takes minutes. Tell the owner you started and that the result will come in Telegram — do not wait.",
    input: z.object({
      task: z.string().trim().min(5).max(2000).describe('The full task in the owner\'s words'),
      where: z.enum(['browser', 'desktop']).optional().describe('browser (default) — a separate Chrome window; desktop — the whole computer screen, only when a desktop program is needed'),
    }),
    run: (i, ctx) => {
      const mode = i.where ?? (modeEnabled('browser') ? 'browser' : 'desktop');
      // Topshiriq matni egasining shu payt yozgani emas bo'lishi mumkin (rasm, mijoz xabari, internet, jadval) — boshlashdan oldin egasi tasdiqlaydi
      const confirmFirst = !!(ctx.fromPhoto || ctx.unattended || ctx.readStrangers);
      try {
        const job = startJob(ctx.biz, i.task, mode, confirmFirst);
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
export const computerEnabled = (): boolean => env.computerUse !== '';
