/** Jonli tekshiruv yo'llari: egasi va Palantir jamoasi — panel → Sozlamalar («Hammasini tekshirish»), o'rnatuvchi — npm run live (administrator paroli bilan) */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { businesses, type BusinessRow } from '../db';
import { LIVE_CHANNELS } from '../../src/lib/live';
import { LiveBusy, liveCheck } from './check';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asAdmin: (fn: Handler) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Body = z.object({
  deep: z.boolean().optional(),
  only: z.array(z.enum(LIVE_CHANNELS)).max(LIVE_CHANNELS.length).optional(),
  business: z.string().max(40).optional(),
});

function failed(res: Response, e: unknown): void {
  if (e instanceof LiveBusy) { res.status(409).json({ error: e.message }); return; }
  console.error('[tekshiruv]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

export function mountLive(app: Express, { asBiz, asAdmin, bad }: Deps): void {
  app.post('/api/live-check', asBiz(async (req, res, biz) => {
    const p = Body.safeParse(req.body ?? {});
    if (!p.success) return bad(res, p.error);
    try { res.json({ checks: await liveCheck(biz, p.data) }); } catch (e) { failed(res, e); }
  }));

  app.post('/api/admin/live-check', asAdmin(async (req, res) => {
    const p = Body.safeParse(req.body ?? {});
    if (!p.success) return bad(res, p.error);
    const list = businesses.all().filter(b => b.active && (!p.data.business || b.id === p.data.business || b.login === p.data.business));
    try {
      const out = [];
      // Bizneslar ketma-ket: bitta kompyuterdagi brauzer va CRM bir vaqtda ko'p so'rov bilan zo'riqmasin
      for (const b of list) out.push({ id: b.id, name: b.profile.name, checks: await liveCheck(b, p.data) });
      res.json({ businesses: out });
    } catch (e) { failed(res, e); }
  }));
}
