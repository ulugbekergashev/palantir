/**
 * Panel → Marketing → Targetolog. Pul bilan bog'liq hammasi — kabinetni ulash, limitlar, ishga tushirish, davom ettirish, rejani
 * o'zgartirish — faqat egasi (asOwner). Reja tuzish, to'xtatish va bekor qilish — jamoa kirishi ham (pul sarflamaydi).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { AdsView } from '../../src/types';
import { newId, type BusinessRow } from '../db';
import { ImageError, toPostJpeg } from '../marketing/image';
import { AdsError } from './graph';
import { cancel, card, connect, disconnect, ensureUploadDir, imagePath, launch, pause, problemsOf, propose, resolveCities, resume, spendNow, uploadDir } from './campaigns';
import { PlanSchema, planSummary, type Spend } from './plan';
import { availableImages, planFromTask } from './planner';
import { TargetError, adsStore } from './store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Money = z.number().min(0).max(1_000_000);
const MAX_UPLOADS = 60;
const Id = (req: Request) => String(req.params.id).slice(0, 20);

function failed(res: Response, e: unknown): void {
  if (e instanceof TargetError || e instanceof AdsError || e instanceof ImageError) { res.status(409).json({ error: e.message }); return; }
  console.error('[targetolog]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

/** Panel va bosh ekran har 30 soniyada so'raydi: Meta'ga sarf so'rovi daqiqada bir martadan ko'p ketmasin */
const SPEND_TTL_MS = 60_000;
const spendCache = new Map<string, { at: number; spend: Spend | null }>();
async function cachedSpend(biz: BusinessRow): Promise<Spend | null> {
  const hit = spendCache.get(biz.id);
  if (hit && Date.now() - hit.at < SPEND_TTL_MS) return hit.spend;
  const c = adsStore.connection(biz.id);
  const spend = c ? await spendNow(biz, c).catch(() => null) : null;
  spendCache.set(biz.id, { at: Date.now(), spend });
  return spend;
}
/** Amaldan keyin (ishga tushirish, to'xtatish) — yangi sarf */
const fresh = (bizId: string) => { spendCache.delete(bizId); };

/** Panel ko'rinishi: token hech qachon chiqmaydi; sarf Meta'dan (javob bermasa — null) */
export async function adsView(biz: BusinessRow): Promise<AdsView> {
  const c = adsStore.connection(biz.id);
  const spend = c ? await cachedSpend(biz) : null;
  const campaigns = await Promise.all(adsStore.campaigns(biz.id).map(async x => ({
    id: x.id, task: x.task, plan: x.plan, status: x.status, currency: x.currency, spent: x.spent, results: x.results, clicks: x.clicks, impressions: x.impressions,
    metaCampaignId: x.metaCampaignId, error: x.error, stopReason: x.stopReason, createdAt: x.createdAt, launchedAt: x.launchedAt, endsAt: x.endsAt, checkedAt: x.checkedAt,
    problems: x.status === 'proposed' ? await problemsOf(biz, x.plan, spend) : [],
    summary: planSummary(x.plan, x.currency),
  })));
  return {
    account: c ? { adAccountId: c.adAccountId, accountName: c.accountName, pageId: c.pageId, pageName: c.pageName, igActorId: c.igActorId, currency: c.currency, tokenSet: !!c.token } : null,
    limits: adsStore.limits(biz.id), spend, campaigns, images: availableImages(biz.id),
  };
}

export function mountAds(app: Express, { asBiz, asOwner, bad }: Deps): void {
  const reply = async (res: Response, biz: BusinessRow, changed = false) => { if (changed) fresh(biz.id); res.json(await adsView(biz)); };

  app.get('/api/ads', asBiz((_req, res, biz) => reply(res, biz)));

  app.post('/api/ads/connect', asOwner(async (req, res, biz) => {
    const p = z.object({ token: z.string().trim().min(20).max(1000), adAccountId: z.string().trim().min(5).max(30), pageId: z.string().trim().min(5).max(30), igActorId: z.string().trim().max(30).nullable().optional() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await connect(biz, p.data); await reply(res, biz, true); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/ads/connect', asOwner(async (_req, res, biz) => {
    try { disconnect(biz); await reply(res, biz, true); } catch (e) { failed(res, e); }
  }));

  app.put('/api/ads/limits', asOwner((req, res, biz) => {
    const p = z.object({ perCampaign: Money, daily: Money, monthly: Money }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (p.data.daily > p.data.monthly && p.data.monthly > 0) return res.status(400).json({ error: "Kunlik limit oylikdan katta bo'lmasin" });
    adsStore.saveLimits(biz.id, p.data);
    return reply(res, biz);
  }));

  // AI reja tuzadi (bir necha o'n soniya) — pul sarflamaydi: faqat taklif va egasiga karta
  app.post('/api/ads/plan', asBiz(async (req, res, biz) => {
    const p = z.object({ task: z.string().trim().min(10).max(2000) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await propose(biz, p.data.task, await planFromTask(biz, p.data.task)); await reply(res, biz); } catch (e) { failed(res, e); }
  }));

  // Rejani egasi o'zgartiradi (byudjet, kunlar, matn, rasm…): to'liq reja qayta tekshiriladi, yangi karta
  app.patch('/api/ads/campaigns/:id', asOwner(async (req, res, biz) => {
    const cur = adsStore.campaign(biz.id, Id(req));
    if (!cur || cur.status !== 'proposed') return res.status(409).json({ error: "Faqat ishga tushmagan rejani o'zgartirish mumkin" });
    const p = PlanSchema.safeParse({ ...cur.plan, ...(req.body as object) });
    if (!p.success) return bad(res, p.error);
    try {
      const c = adsStore.connection(biz.id);
      // Shahar o'zgargan bo'lsa — kodi qayta qidiriladi
      // Shahar kodi faqat Meta qidiruvidan: so'rov tanasidagi key olinmaydi — eski (tekshirilgan) kod yoki qayta qidiruv
      const cities = p.data.cities.map(x => ({ ...x, key: cur.plan.cities.find(o => o.name === x.name && o.key)?.key ?? null }));
      const plan = c ? await resolveCities(c, { ...p.data, cities }) : { ...p.data, cities };
      adsStore.setPlan(biz.id, cur.id, plan);
      await card(biz, cur.id).catch(() => {});
      await reply(res, biz);
    } catch (e) { failed(res, e); }
  }));

  app.post('/api/ads/campaigns/:id/launch', asOwner(async (req, res, biz) => {
    try { await launch(biz, Id(req)); await reply(res, biz, true); } catch (e) { failed(res, e); }
  }));
  app.post('/api/ads/campaigns/:id/pause', asBiz(async (req, res, biz) => {
    try { await pause(biz, Id(req)); await reply(res, biz, true); } catch (e) { failed(res, e); }
  }));
  app.post('/api/ads/campaigns/:id/resume', asOwner(async (req, res, biz) => {
    try { await resume(biz, Id(req)); await reply(res, biz, true); } catch (e) { failed(res, e); }
  }));
  app.delete('/api/ads/campaigns/:id', asBiz(async (req, res, biz) => {
    try { cancel(biz, Id(req)); await reply(res, biz); } catch (e) { failed(res, e); }
  }));

  // Reklama rasmi: panel kichraytirib yuboradi (base64) — Instagram o'lchamiga keltirilib, biznes papkasiga
  app.post('/api/ads/images', asBiz(async (req, res, biz) => {
    const p = z.object({ image: z.string().min(100).max(8_000_000) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      ensureUploadDir(biz.id);
      // Disk to'lmasin: biznesga eng ko'pi bilan MAX_UPLOADS rasm
      if (readdirSync(uploadDir(biz.id)).length >= MAX_UPLOADS) return res.status(409).json({ error: `Rasmlar ${MAX_UPLOADS} tadan oshdi — Instagram postlaridan tanlang` });
      const { jpeg } = await toPostJpeg(Buffer.from(p.data.image.replace(/^data:[^,]*,/, ''), 'base64'));
      const name = `${newId(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.jpg`;
      writeFileSync(join(uploadDir(biz.id), name), jpeg);
      res.json({ ref: `file:${name}`, ...(await adsView(biz)) });
    } catch (e) { failed(res, e); }
  }));

  app.get('/api/ads/image', asBiz((req, res, biz) => {
    const path = imagePath(String(req.query.ref ?? '').slice(0, 60), biz.id);
    if (!path) return res.status(404).json({ error: "Rasm yo'q" });
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    return res.end(readFileSync(path));
  }));
}
