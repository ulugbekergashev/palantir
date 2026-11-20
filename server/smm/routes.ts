/**
 * Panel → Marketing → SMM-menejer → Kalendar. Kalendar tuzish va tayyorlash AI'ga pul sarflaydi — jamoa kirishi ham (Kontent ishi);
 * tasdiqlash (post kanalga o'zi chiqadi) — faqat egasi
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { addDays, iso } from '../../src/lib/week';
import type { BusinessRow } from '../db';
import { pictureMaker } from '../content/picture';
import { DAYS_MAX, DAYS_MIN, PER_WEEK_MAX, PER_WEEK_MIN, makeCalendar } from './plan';
import { approve, approveRange, prepareAhead, prepareOne, preparing, reject, reopen } from './prepare';
import { SmmError, imageFile, smmStore } from './store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Id = (req: Request) => String(req.params.id).slice(0, 24);

function failed(res: Response, e: unknown): void {
  if (e instanceof SmmError) { res.status(409).json({ error: e.message }); return; }
  console.error('[smm]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

/** Kalendar: kechadan boshlab (kechagi chiqqanlari ham ko'rinsin) */
export function smmView(biz: BusinessRow) {
  return {
    posts: smmStore.from(biz.id, iso(addDays(new Date(), -1))),
    preparing: preparing(biz.id),
    picture: !!pictureMaker(biz),
  };
}

export function mountSmm(app: Express, { asBiz, asOwner, bad }: Deps): void {
  app.get('/api/smm', asBiz((_req, res, biz) => res.json(smmView(biz))));

  app.post('/api/smm/calendar', asBiz(async (req, res, biz) => {
    const p = z.object({ days: z.number().int().min(DAYS_MIN).max(DAYS_MAX), perWeek: z.number().int().min(PER_WEEK_MIN).max(PER_WEEK_MAX), wish: z.string().max(600).default('') }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await makeCalendar(biz, p.data); res.json(smmView(biz)); } catch (e) { failed(res, e); }
  }));

  // Fonda: har post bir-ikki daqiqa; tayyorlari egasiga Telegram'da ham
  app.post('/api/smm/prepare', asBiz((req, res, biz) => {
    const p = z.object({ days: z.number().int().min(1).max(DAYS_MAX) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      const r = prepareAhead(biz, iso(addDays(new Date(), 1)), iso(addDays(new Date(), p.data.days)));
      void r.done.catch(e => console.error('[smm] tayyorlash:', (e as Error).message));
      res.json({ queued: r.queued, ...smmView(biz) });
    } catch (e) { failed(res, e); }
  }));

  app.post('/api/smm/:id/prepare', asBiz((req, res, biz) => {
    try {
      void prepareOne(biz, Id(req)).catch(e => console.error('[smm] tayyorlash:', (e as Error).message));
      res.json(smmView(biz));
    } catch (e) { failed(res, e); }
  }));

  app.post('/api/smm/:id/approve', asOwner((req, res, biz) => {
    try {
      if (!approve(biz, Id(req))) return res.status(409).json({ error: 'Faqat tayyor postni tasdiqlash mumkin' });
      return res.json(smmView(biz));
    } catch (e) { return failed(res, e); }
  }));
  // Hammasini tasdiqlash — faqat egasi panelda ko'rgan postlar (ids)
  app.post('/api/smm/approve', asOwner((req, res, biz) => {
    const p = z.object({ from: Day, to: Day, ids: z.array(z.string().max(24)).max(200) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    return res.json({ approved: approveRange(biz, p.data.from, p.data.to, { ids: p.data.ids }), ...smmView(biz) });
  }));
  // Chiqmay qolgan tayyor post — qayta ko'rib tasdiqlash uchun (AI qayta yozmaydi)
  app.post('/api/smm/:id/reopen', asOwner((req, res, biz) => {
    if (!reopen(biz, Id(req))) return res.status(409).json({ error: 'Faqat chiqmay qolgan tayyor postni qaytarish mumkin' });
    return res.json(smmView(biz));
  }));
  app.post('/api/smm/:id/reject', asBiz((req, res, biz) => {
    if (!reject(biz, Id(req))) return res.status(409).json({ error: 'Chiqqan postni olib tashlab bo\'lmaydi' });
    return res.json(smmView(biz));
  }));

  // Sana, vaqt yoki matn: tasdiqlangan post matni o'zgarsa — qayta tasdiq kerak (store.edit)
  app.patch('/api/smm/:id', asOwner((req, res, biz) => {
    const p = z.object({ day: Day.optional(), time: Time.optional(), caption: z.string().trim().min(1).max(2200).optional() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (!smmStore.edit(biz.id, Id(req), p.data)) return res.status(409).json({ error: "Bu postni o'zgartirib bo'lmaydi" });
    return res.json(smmView(biz));
  }));

  app.get('/api/smm/image/:name', asBiz((req, res, biz) => {
    const path = imageFile(biz.id, String(req.params.name).slice(0, 40));
    if (!path || !existsSync(path)) return res.status(404).json({ error: "Rasm yo'q" });
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    return res.end(readFileSync(path));
  }));
}
