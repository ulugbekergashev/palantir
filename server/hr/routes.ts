/**
 * Panel → HR → Rekruter: vakansiyalar va nomzodlar. Vakansiya ochish, kanalga joylash, yopish va nomzod bo'yicha qaror — faqat egasi
 * (asOwner): nomzodga xabar egasining qarori bilan ketadi. Ko'rish — egasi va boshqaruvchi xodim (asBiz)
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { HrError, createVacancy, decideCandidate, postVacancy, vacancyLink } from './recruit';
import { candidates, vacancies, type Candidate, type Vacancy } from './store';
import { TrainError, score, startTraining, trainings, type Training } from './train';
import { staff } from '../requests/store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Id = (req: Request) => String(req.params.id).slice(0, 20);
const TaskSchema = z.object({ task: z.string().trim().min(10).max(2000) });
const DecisionSchema = z.object({ invite: z.boolean() });
const TrainSchema = z.object({ staffId: z.string().trim().min(1).max(20), focus: z.string().trim().max(500).optional() });

function failed(res: Response, e: unknown): void {
  if (e instanceof HrError || e instanceof TrainError) { res.status(409).json({ error: e.message }); return; }
  console.error('[rekruter]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

/** Javob berib bo'lmagan (savollar o'rtasida) nomzodlar — faqat soni; tugatganlari — to'liq */
const candidateView = (c: Candidate) => ({
  id: c.id, name: c.name, username: c.username, phone: c.phone, answers: c.answers, status: c.status, score: c.score, summary: c.summary, createdAt: c.createdAt,
});
const vacancyView = (biz: BusinessRow, v: Vacancy) => {
  const all = candidates.list(biz.id, v.id);
  return {
    id: v.id, title: v.title, text: v.text, questions: v.questions, status: v.status, link: vacancyLink(v), createdAt: v.createdAt, closedAt: v.closedAt,
    inProgress: all.filter(c => c.status === 'asking' || c.status === 'phone').length,
    candidates: all.filter(c => c.status !== 'asking' && c.status !== 'phone').map(candidateView),
  };
};

/** Murabbiy: kurs va natija (savollar matni ham — egasi ko'rsin) */
const trainingView = (bizId: string, t: Training) => {
  const s = score(t);
  return {
    id: t.id, title: t.title, staffId: t.staffId, staffName: staff.byId(bizId, t.staffId)?.name ?? null, status: t.status, lesson: t.lesson,
    lessons: t.lessons.map(l => ({ title: l.title, questions: l.quiz.length })), right: s.right, answered: t.answers.length, total: s.total, weak: s.weak,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
};

export function mountHr(app: Express, { asBiz, asOwner, bad }: Deps): void {
  const view = (biz: BusinessRow) => ({
    vacancies: vacancies.list(biz.id, 'all', 30).map(v => vacancyView(biz, v)),
    trainings: trainings.list(biz.id, 30).map(t => trainingView(biz.id, t)),
    staff: staff.list(biz.id).map(s => ({ id: s.id, name: s.name, linked: s.linked })),
  });

  app.get('/api/hr', asBiz((_req, res, biz) => { res.json(view(biz)); }));
  app.post('/api/hr/vacancies', asOwner(async (req, res, biz) => {
    const p = TaskSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await createVacancy(biz, p.data.task); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));
  app.post('/api/hr/vacancies/:id/post', asOwner(async (req, res, biz) => {
    try { await postVacancy(biz, Id(req)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));
  app.post('/api/hr/vacancies/:id/close', asOwner((req, res, biz) => {
    if (!vacancies.get(biz.id, Id(req))) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    vacancies.close(biz.id, Id(req));
    res.json(view(biz));
  }));
  app.post('/api/hr/trainings', asOwner(async (req, res, biz) => {
    const p = TrainSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await startTraining(biz, p.data.staffId, p.data.focus ?? ''); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));
  app.post('/api/hr/trainings/:id/cancel', asOwner((req, res, biz) => {
    if (!trainings.cancel(biz.id, Id(req))) return res.status(409).json({ error: 'Kurs allaqachon yopilgan' });
    res.json(view(biz));
  }));
  app.post('/api/hr/candidates/:id/decision', asOwner(async (req, res, biz) => {
    const p = DecisionSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { const said = await decideCandidate(biz, Id(req), p.data.invite); res.json({ ...view(biz), said }); } catch (e) { failed(res, e); }
  }));
}
