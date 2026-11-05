/** Panel → Kontent-meyker → Postlar → Instagram: qoralamalar, rasm, yangi post (egasining surati yoki AI chizadi), matn yozdirish, joylash */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { ContentError } from '../content/store';
import { PictureError, pictureMaker } from '../content/picture';
import { MetaAiError } from './metaAi';
import { ImageError } from './image';
import { MAX_CAPTION, PostError, cancelPost, createDraft, draftWithPicture, editCaption, postImage, postView, posts, publishPost, writeCaption } from './posts';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const Caption = z.string().trim().min(1).max(MAX_CAPTION);
/** Panel rasmni o'zi kichraytirib yuboradi (2048 px); base64 — express.json chegarasi (8 MB) ichida */
const PhotoSchema = z.object({ caption: Caption, image: z.string().min(100).max(8_000_000) });
const DrawSchema = z.object({ caption: Caption, description: z.string().trim().min(10).max(1000) });
const Id = (req: Request) => String(req.params.id).slice(0, 20);

/** Kutilgan xato — egasiga sababi; boshqasi — ichki */
function failed(res: Response, e: unknown): void {
  if (e instanceof PostError || e instanceof ImageError || e instanceof MetaAiError || e instanceof ContentError || e instanceof PictureError) { res.status(409).json({ error: e.message }); return; }
  console.error('[postlar]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

export function mountMarketing(app: Express, { asBiz, asOwner, bad }: Deps): void {
  const view = (biz: BusinessRow) => posts.list(biz.id).map(p => postView(biz, p));

  // picture — kim rasm chiza oladi (Meta AI, Gemini yoki hech kim: egasi o'z suratini qo'shadi)
  app.get('/api/posts', asBiz((_req, res, biz) => { res.json({ posts: view(biz), picture: pictureMaker(biz) }); }));

  app.get('/api/posts/:id/image', asBiz((req, res, biz) => {
    const p = posts.get(biz.id, Id(req)), img = p && postImage(p.id);
    if (!img) return res.status(404).json({ error: 'Rasm yo\'q' });
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.end(img);
  }));

  app.post('/api/posts', asBiz(async (req, res, biz) => {
    const p = PhotoSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      const image = Buffer.from(p.data.image.replace(/^data:[^,]*,/, ''), 'base64');
      res.json({ post: await createDraft(biz, { caption: p.data.caption, image, source: 'photo' }) });
    } catch (e) { failed(res, e); }
  }));

  app.post('/api/posts/draw', asBiz((req, res, biz) => {
    const p = DrawSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { res.json({ post: draftWithPicture(biz, p.data.caption, p.data.description) }); } catch (e) { failed(res, e); }
  }));

  app.post('/api/posts/caption', asBiz(async (req, res, biz) => {
    const p = z.object({ topic: z.string().trim().min(3).max(600) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { res.json({ caption: await writeCaption(biz, p.data.topic) }); } catch (e) { failed(res, e); }
  }));

  // Matnni faqat egasi o'zgartiradi: Telegram kartasi (joylash tugmasi) shu matnga qayta yuboriladi
  app.patch('/api/posts/:id', asOwner(async (req, res, biz) => {
    const p = z.object({ caption: Caption }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await editCaption(biz, Id(req), p.data.caption); res.json({ posts: view(biz) }); } catch (e) { failed(res, e); }
  }));

  // Instagram'ga chiqarish — egasining akkaunti nomidan: faqat egasi (jamoa kirishi emas)
  app.post('/api/posts/:id/publish', asOwner(async (req, res, biz) => {
    const confirmUnknown = (req.body as { confirm?: unknown } | undefined)?.confirm === true;
    try { await publishPost(biz, Id(req), { confirmUnknown }); res.json({ posts: view(biz) }); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/posts/:id', asBiz((req, res, biz) => {
    try { cancelPost(biz, Id(req)); res.json({ posts: view(biz) }); } catch (e) { failed(res, e); }
  }));
}
