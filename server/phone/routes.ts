/**
 * Panel: MicroSIP holati, ulash va uzish, raqam terish; qo'ng'iroq yozuvini tinglash va qayta tahlil.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { RECORDINGS_DIR, connectPhone, dialFor, disconnectPhone, phoneStatus, review } from './index';
import { MIME } from './recordings';
import { phoneCalls } from './store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
}

export function mountPhone(app: Express, { asBiz, bad, fail }: Deps): void {
  app.get('/api/phone', asBiz(async (_req, res, biz) => res.json({ phone: await phoneStatus(biz) })));

  app.post('/api/phone/connect', asBiz(async (req, res, biz) => {
    try { res.json({ phone: await connectPhone(biz, req.body?.overwrite === true) }); } catch (e) { fail(res, e); }
  }));

  app.post('/api/phone/disconnect', asBiz(async (_req, res, biz) => {
    try { res.json({ phone: await disconnectPhone(biz) }); } catch (e) { fail(res, e); }
  }));

  app.post('/api/phone/dial', asBiz(async (req, res, biz) => {
    const p = z.object({ phone: z.string().trim().min(3).max(40), requestId: z.string().trim().max(20).optional() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { res.json(await dialFor(biz, p.data.phone, p.data.requestId)); } catch (e) { fail(res, e); }
  }));

  /** Yozuvni tinglash: faqat shu biznesning qo'ng'irog'i, fayl nomi bazadan (yo'l so'rovdan olinmaydi) */
  app.get('/api/calls/:id/audio', asBiz((req, res, biz) => {
    const c = phoneCalls.get(biz.id, String(req.params.id));
    const file = c?.recording ? path.join(RECORDINGS_DIR, path.basename(c.recording)) : null;
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Yozuv yo\'q' });
    res.setHeader('content-type', MIME[path.extname(file).slice(1)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=3600');
    fs.createReadStream(file).pipe(res);
  }));

  app.post('/api/calls/:id/review', asBiz(async (req, res, biz) => {
    const c = phoneCalls.get(biz.id, String(req.params.id));
    if (!c?.recording) return res.status(404).json({ error: "Yozuv yo'q" });
    await review(biz.id, c.id);
    res.json({ call: phoneCalls.get(biz.id, c.id) });
  }));
}
