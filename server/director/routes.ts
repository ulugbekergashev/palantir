/**
 * Direktor — panel uchun: oxirgi tahlil, tasdiq kutayotgan takliflar va qarorlar jurnali; «Hozir tahlil qil»; topshirish / kerak emas.
 * Qabulxona xodimiga yopiq (server/access.ts: /api/director RECEPTION ro'yxatida yo'q).
 */
import type { Express, Handler, Request, Response } from 'express';
import { z } from 'zod';
import { AiLimitError } from '../claude';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { approveMove, declineMove, DirectorError, directorView, runDirector } from './index';

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
