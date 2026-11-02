/**
 * Direktor — panel uchun: oxirgi tahlil, tasdiq kutayotgan takliflar va qarorlar jurnali; «Hozir tahlil qil»; topshirish / kerak emas.
 * Qabulxona xodimiga yopiq (server/access.ts: /api/director RECEPTION ro'yxatida yo'q).
 */
import type { Express, Handler, Request, Response } from 'express';
import { z } from 'zod';
import { AiLimitError } from '../claude';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { approveMove, declineMove, DirectorError, directorView, readNumbers, runDirector } from './index';
import { goals, MAX_GOALS, progress } from './goals';
import { METRIC_KEYS, METRICS, type MetricKey } from './logic';

interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  fail: (res: Response, e: unknown, code?: number) => unknown;
}

const lastRun = new Map<string, number>();
const running = new Set<string>();

export function mountDirector(app: Express, { asBiz, fail }: Deps): void {
  app.get('/api/director', asBiz((_req, res, biz) => { res.json(directorView(biz)); }));

  app.post('/api/director/run', asBiz(async (_req, res, biz) => {
    if (running.has(biz.id)) return res.status(409).json({ error: 'Direktor hozir tahlil qilyapti — bir oz kuting' });
    // Qo'lda tahlil tez-tez emas (har biri — AI so'rovi)
    if (Date.now() - (lastRun.get(biz.id) ?? 0) < env.directorRunGapMs) return res.status(429).json({ error: 'Hozirgina tahlil qilindi — ikki daqiqadan keyin qayta urining' });
    running.add(biz.id);
    lastRun.set(biz.id, Date.now());
    try {
      await runDirector(biz);
      res.json(directorView(biz));
    } catch (e) {
      if (e instanceof AiLimitError) res.status(429).json({ error: 'Bugungi AI chegarasi tugadi — ertaga yana ishlaydi.' });
      else fail(res, e, 502);
    } finally {
      running.delete(biz.id);
    }
  }));

  // Maqsadlar: joriy qiymat har safar yangi hisoblanadi (oxirgi 7 to'liq kun)
  const goalList = async (biz: BusinessRow) => {
    const numbers = await readNumbers(biz);
    return goals.list(biz.id).map(g => progress(g, numbers));
  };
  app.get('/api/goals', asBiz(async (_req, res, biz) => {
    try { res.json({ goals: await goalList(biz) }); } catch (e) { fail(res, e); }
  }));

  app.post('/api/goals', asBiz(async (req, res, biz) => {
    const p = z.object({ metric: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]), target: z.number().finite().min(0).max(1e12) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "Ko'rsatkich va maqsad (son) kerak" });
    const list = goals.list(biz.id);
    if (list.length >= MAX_GOALS && !list.some(g => g.metric === p.data.metric)) return res.status(400).json({ error: `${MAX_GOALS} tadan ko'p maqsad qo'yilmaydi — keraksizini o'chiring` });
    if (METRICS[p.data.metric].unit === '%' && p.data.target > 100) return res.status(400).json({ error: 'Foiz 100 dan oshmaydi' });
    goals.set(biz.id, p.data.metric, p.data.target);
    try { res.json({ goals: await goalList(biz) }); } catch (e) { fail(res, e); }
  }));

  app.delete('/api/goals/:id', asBiz((req, res, biz) => {
    if (!goals.remove(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  }));

  app.post('/api/director/moves/:id', asBiz((req, res, biz) => {
    const p = z.object({ decision: z.enum(['approve', 'decline']) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "decision: approve yoki decline" });
    try {
      const message = p.data.decision === 'approve' ? approveMove(biz, String(req.params.id)) : declineMove(biz, String(req.params.id));
      res.json({ message, ...directorView(biz) });
    } catch (e) {
      if (e instanceof DirectorError) return res.status(e.message === 'Taklif topilmadi' ? 404 : 400).json({ error: e.message });
      fail(res, e);
    }
  }));
}
