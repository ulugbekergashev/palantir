/**
 * Panel → Marketing → Kontent-meyker: qoralamalar, manbalar, kanal va uslub. Kanalga chiqarish va kanalni ulash — faqat egasi
 * (uning kanali nomidan); ko'rish, manba qo'shish va qoralama yozdirish — jamoa kirishi ham
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { ContentError, MAX_DRAFT, contentStore } from './store';
import { cancelDraft, connectChannel, disconnectChannel, editDraft, factoryRunning, publishDraft, runFactory, topicDraft } from './factory';
import { normalizeHandle } from './telegram';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Settings = z.object({
  style: z.string().max(2000).optional(),
  lang: z.enum(['uz', 'ru']).optional(),
  perRun: z.number().int().min(1).max(5).optional(),
  auto: z.boolean().optional(),
});
const Id = (req: Request) => String(req.params.id).slice(0, 20);

function failed(res: Response, e: unknown): void {
  if (e instanceof ContentError) { res.status(409).json({ error: e.message }); return; }
  console.error('[kontent]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

export function mountContent(app: Express, { asBiz, asOwner, bad }: Deps): void {
  const view = (biz: BusinessRow) => ({
    settings: contentStore.settings(biz.id), sources: contentStore.sources(biz.id), drafts: contentStore.drafts(biz.id), running: factoryRunning(biz.id),
  });

  app.get('/api/content', asBiz((_req, res, biz) => { res.json(view(biz)); }));

  app.put('/api/content/settings', asOwner((req, res, biz) => {
    const p = Settings.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    contentStore.saveSettings(biz.id, p.data);
    res.json(view(biz));
  }));

  app.post('/api/content/channel', asOwner(async (req, res, biz) => {
    const p = z.object({ channel: z.string().trim().min(3).max(200) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await connectChannel(biz, p.data.channel); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/content/channel', asOwner((_req, res, biz) => { disconnectChannel(biz); res.json(view(biz)); }));

  app.post('/api/content/sources', asBiz((req, res, biz) => {
    const p = z.object({ handle: z.string().trim().min(3).max(200) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const handle = normalizeHandle(p.data.handle);
    if (!handle) return res.status(400).json({ error: "Kanal havolasi noto'g'ri — @kanal_nomi yoki t.me/kanal_nomi (faqat ochiq kanallar)" });
    try { contentStore.addSource(biz.id, handle); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/content/sources/:id', asBiz((req, res, biz) => { contentStore.removeSource(biz.id, Id(req)); res.json(view(biz)); }));

  // AI yozadi (bir necha o'n soniya): javob tugagach qaytadi
  app.post('/api/content/run', asBiz(async (_req, res, biz) => {
    try { const r = await runFactory(biz); res.json({ ...view(biz), note: r.note }); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/topic', asBiz(async (req, res, biz) => {
    const p = z.object({ topic: z.string().trim().min(5).max(2000) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await topicDraft(biz, p.data.topic); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.patch('/api/content/drafts/:id', asOwner(async (req, res, biz) => {
    const p = z.object({ text: z.string().min(1).max(MAX_DRAFT) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await editDraft(biz, Id(req), p.data.text); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/drafts/:id/publish', asOwner(async (req, res, biz) => {
    try { await publishDraft(biz, Id(req)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/content/drafts/:id', asBiz((req, res, biz) => {
    try { cancelDraft(biz, Id(req)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));
}
