/**
 * Murabbiy asboblari (hr/train.ts): egasi «Dilnozani o'rgat», «narxlar bo'yicha test qil», «o'qish qanday ketyapti» deganda
 */
import { z } from 'zod';
import { ToolError, def } from '../toolkit';
import { staff } from '../requests/store';
import { TrainError, score, startTraining, trainings } from './train';

const asTool = (e: unknown): never => { throw e instanceof TrainError ? new ToolError(e.message) : e; };

export const TRAIN_DEFS = {
  training_start: def({
    description: "Murabbiy: start a short onboarding course for a staff member connected to the bot (reception staff). The course (2–6 lessons with quiz questions) is written only from the business's own knowledge — prices, rules, saved answers, team — and sent to the staff member in Telegram; they read, answer quiz buttons at their own pace, and the owner gets the result with the weak topics. Takes up to a minute. who: the staff member's name or id; focus: what to stress, in the owner's words (optional).",
    input: z.object({ who: z.string().trim().min(1).max(80), focus: z.string().trim().max(500).optional() }),
    run: async (i, ctx) => {
      if (ctx.fromPhoto || ctx.readStrangers || ctx.unattended) throw new ToolError("O'qitishni egasi o'z so'zi bilan boshlasin — keyingi xabarda yozing");
      const { training, trainee } = await startTraining(ctx.biz, i.who, i.focus ?? '').catch(asTool);
      return { started: training.title, for: trainee.name, lessons: training.lessons.map(l => l.title), next: `1-dars ${trainee.name}ning Telegram'iga yuborildi` };
    },
  }),
  training_list: def({
    description: 'Murabbiy: courses given to staff and their progress (lesson, right answers, weak topics).',
    input: z.object({}),
    run: (_i, ctx) => ({
      staff: staff.list(ctx.biz.id).map(s => ({ id: s.id, name: s.name, telegram: s.linked })),
      courses: trainings.list(ctx.biz.id, 20).map(t => {
        const s = score(t);
        return { id: t.id, title: t.title, for: staff.byId(ctx.biz.id, t.staffId)?.name ?? null, status: t.status, lesson: `${t.lesson + 1}/${t.lessons.length}`, right: s.right, answered: t.answers.length, total: s.total, weak: s.weak };
      }),
    }),
  }),
};
