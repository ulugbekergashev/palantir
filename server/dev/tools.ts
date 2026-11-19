/**
 * Yordamchi asboblari: egasining o'z loyihalari kodida ish (Dasturchi, jobs.ts). Ish fonda boradi — yordamchi darhol «boshladim» deydi,
 * hisobot va «Qabul qilish» tugmasi keyin Telegram'ga keladi. Ro'yxatda faqat .env da DEV_PROJECTS bo'lsa (klinika o'rnatmalarida yo'q).
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { buildable, runningBuild, startBuild, stopBuild } from './build';
import { DevError, codeJobs, codeView, runningCodeJob, startCodeJob, stopCodeJob } from './jobs';
import { findProject, projects } from './projects';

const names = () => projects().map(p => p.name).join(', ');

export const DEV_DEFS = {
  code_task: def({
    description: `Give a programming task on one of the owner's own software projects to the developer agent (Claude Code): fix a bug a client reported, change or add a feature, or answer a question about the code ("why does X happen"). Projects: ${names() || '(none)'}. The work runs in the background in a separate copy of the project and takes minutes; the report comes to Telegram with buttons to accept the changes into the project, discard them, or see the diff. Nothing is pushed, deployed or released — the owner does that. Write the task fully and concretely in the owner's words: what is wrong or wanted, where in the product (screen, button, report), for which client if said, and what the result should be; do not invent details the owner did not give — if the project or the wish is unclear, ask the owner first. To correct or extend the job that is waiting for the owner's decision ("no, make it blue", "also add…"), set continue_last — the last such job of that project continues in the same working copy and conversation (job_id picks an older one). One job at a time. Tell the owner you started and that the report will come in Telegram — do not wait for it.`,
    input: z.object({
      project: z.string().trim().min(1).max(60).describe("Project name from the list (the owner may say it loosely: «X Klinik» → xclinic)"),
      task: z.string().trim().min(5).max(4000).describe("The full task in the owner's words"),
      title: z.string().trim().max(90).optional().describe("One short line in the owner's language naming the task (up to 90 chars), e.g. «XClinic: hisobotda sof foyda noto'g'ri» — shown first in Telegram messages"),
      continue_last: z.boolean().optional().describe("true — this is a correction or addition to the project's last job that awaits the owner's decision (status review); it continues instead of a new job starting"),
      job_id: z.string().trim().max(20).optional().describe("Continue this particular job (status review) — only when it is not the last one"),
    }),
    run: (i, ctx) => {
      // Topshiriq matni egasining shu payt yozgani emas bo'lishi mumkin (rasm, mijoz xabari, internet, jadval) — avval egasi tasdiqlaydi
      const confirmFirst = !!(ctx.fromPhoto || ctx.unattended || ctx.readStrangers);
      // Hisobot va «Qabul qilish» tugmasi faqat Telegram'da: usiz ish hal qilinmay qolib ketardi
      if (!ctx.biz.ownerChatId) throw new ToolError("Egasi Telegram'ni ulamagan — kod ishining hisoboti va «Qabul qilish» tugmasi Telegram'ga keladi. Avval panelda Telegram'ni ulang");
      const name = findProject(i.project)?.name;
      const lastReview = i.continue_last && name ? codeJobs.recent(ctx.biz.id, 30).find(j => j.project === name && j.status === 'review') : null;
      if (i.continue_last && !i.job_id && !lastReview) throw new ToolError("Bu loyihada qaror kutayotgan ish yo'q — davom ettiradigan narsa yo'q. Yangi topshiriq sifatida bering (continue_last siz)");
      try {
        const job = startCodeJob(ctx.biz, { project: i.project, task: i.task, title: i.title ?? null, confirmFirst, continueId: i.job_id ?? lastReview?.id ?? null });
        return {
          started: true, job_id: job.id, project: job.project,
          note: confirmFirst
            ? "Egasiga Telegram'da «Kodda ish boshlaymi?» tugmasi bordi — tasdiqlagach boshlanadi. Hisobot Telegram'ga keladi."
            : "Boshlandi. Hisobot va «Qabul qilish» tugmasi Telegram'ga keladi; o'zgarish egasi qabul qilmaguncha loyihaga tushmaydi.",
        };
      } catch (e) {
        if (e instanceof DevError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),

  code_status: def({
    description: "The developer job running now (if any) and the last ones with their status and reports: review — waiting for the owner's accept/discard; done — answered without code changes; accepted, discarded, failed, stopped. Use when the owner asks how the code task is going, what was done, or to find the job_id to continue.",
    input: z.object({}),
    run: (_i, ctx) => {
      // Hisobot kod, test chiqishi va loglardan olingan matn — begona: shu javobda tasdiqsiz yangi ish boshlanmaydi
      ctx.readStrangers = true;
      const now = runningCodeJob(ctx.biz.id);
      return { running: now ? codeView(now) : null, building: runningBuild(ctx.biz.id), recent: codeJobs.recent(ctx.biz.id, 6).filter(j => j.id !== now?.id).map(codeView), projects: projects().map(p => p.name) };
    },
  }),

  code_stop: def({
    description: "Stop the developer job or the build running now (the owner said stop / to'xtat). What the developer job already did is kept and comes for the owner's decision.",
    input: z.object({}),
    run: (_i, ctx) => {
      const job = stopCodeJob(ctx.biz.id), build = stopBuild(ctx.biz.id);
      if (!job && !build) throw new ToolError("Hozir kod ishi ham, yig'ish ham bajarilmayapti");
      return { stopped: true };
    },
  }),

  code_build: def({
    description: `Build the installer (setup .exe) of one of the owner's projects from the project's folder as it is now, and put the ready file on the owner's desktop (the old file with the same name is replaced). Runs in the background and takes several minutes; progress and the result come to Telegram. Projects that can be built: ${buildable().map(p => p.name).join(', ') || '(none configured)'}. Use when the owner asks to build / "yig'" / "собери" / wants the file or exe — typically after accepting a developer job. Sending the file to clients is the owner's job. Tell the owner you started — do not wait.`,
    input: z.object({ project: z.string().trim().min(1).max(60).describe('Project name from the list') }),
    run: (i, ctx) => {
      try {
        return { started: true, ...startBuild(ctx.biz, i.project), note: "Yig'ish boshlandi. Tayyor fayl ish stoliga qo'yiladi, xabar Telegram'ga keladi." };
      } catch (e) {
        if (e instanceof DevError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),
};
