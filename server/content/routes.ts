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
import { brandStore, makeBrandBook, setNarrator } from './brand';
import { mirrorBrand } from './brandPage';
import { PLAN_MAX, PLAN_MIN, makePlan, planDraft, planInstagram, planStore } from './plan';
import { PostError, posts } from '../marketing/posts';
import { PictureError, pictureMaker } from './picture';
import { editScenes, makeVideo, videoAudio, videoStore, voiceVideo } from './video';
import { renderState, startRender, videoMp4 } from './render';
import { MAX_VIDEO_CAPTION, videoToChannel } from './publish';
import { voiceProvider } from './speech';
import { NARRATORS } from '../../src/lib/narrators';

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
const Answers = z.object({
  whose: z.enum(['company', 'personal']), what: z.string().max(600), audience: z.string().max(600), values: z.string().max(600),
  tone: z.string().max(600), avoid: z.string().max(600), look: z.string().max(600),
}).partial();
const Scenes = z.array(z.object({ kind: z.enum(['hook', 'point', 'claim', 'sign']), text: z.string().max(200), voice: z.string().max(400) })).min(1).max(10);

/** AI ishi (brend-buk, reja, video) bir biznesda bittadan: ikki marta bosilsa ikki marta pul ketmasin */
const aiBusy = new Set<string>();
async function once<T>(bizId: string, fn: () => Promise<T>): Promise<T> {
  if (aiBusy.has(bizId)) throw new ContentError('Kontent-meyker hozir boshqa ishni yozyapti — tugashini kuting');
  aiBusy.add(bizId);
  try { return await fn(); } finally { aiBusy.delete(bizId); }
}

const WEEK_MS = 7 * 86_400_000;
/** Instagram postlari (Kontent-meyker): tasdiq kutayotgan, oxirgi 7 kunda chiqqan, rasm chizilayotgani bormi */
function igCounts(bizId: string): { waiting: number; week: number; drawing: boolean } {
  const list = posts.list(bizId);
  const since = Date.now() - WEEK_MS;
  return {
    waiting: list.filter(p => p.status === 'draft' || p.status === 'failed' || p.status === 'unknown').length,
    week: list.filter(p => p.status === 'published' && Date.parse(p.publishedAt ?? '') > since).length,
    drawing: list.some(p => p.status === 'drawing'),
  };
}

function failed(res: Response, e: unknown): void {
  if (e instanceof ContentError || e instanceof PostError || e instanceof PictureError) { res.status(409).json({ error: e.message }); return; }
  console.error('[kontent]', e);
  res.status(500).json({ error: "Ichki xato — qayta urinib ko'ring" });
}

export function mountContent(app: Express, { asBiz, asOwner, bad }: Deps): void {
  const view = (biz: BusinessRow) => ({
    settings: contentStore.settings(biz.id), sources: contentStore.sources(biz.id), drafts: contentStore.drafts(biz.id), running: factoryRunning(biz.id),
    brand: brandStore.get(biz.id), plan: planStore.list(biz.id), videos: videoStore.list(biz.id).map(v => ({ ...v, render: renderState(biz.id, v) })), voice: voiceProvider() !== null, voiceBy: voiceProvider(), busy: aiBusy.has(biz.id),
    picture: pictureMaker(biz), igPosts: igCounts(biz.id),
  });

  app.get('/api/content', asBiz((_req, res, biz) => {
    // Bu o'zgarishdan oldin yaratilgan brend-buk ham Miya papkasiga tushsin (o'zgarmagan bo'lsa yozilmaydi)
    mirrorBrand(biz.id, brandStore.book(biz.id));
    res.json(view(biz));
  }));

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

  // ─── Brend-buk, reja, video ───
  app.put('/api/content/brand', asOwner(async (req, res, biz) => {
    const p = Answers.safeParse(req.body?.answers ?? {});
    if (!p.success) return bad(res, p.error);
    try { await once(biz.id, () => makeBrandBook(biz, p.data, contentStore.settings(biz.id).lang)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  // Brend-buk yozilayotganda almashtirilmaydi: AI javobi tanlovni ustidan yozib yubormasin
  app.put('/api/content/brand/narrator', asOwner(async (req, res, biz) => {
    const p = z.object({ narrator: z.enum(NARRATORS.map(n => n.id) as [string, ...string[]]) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await once(biz.id, async () => setNarrator(biz.id, p.data.narrator)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/plan', asBiz(async (req, res, biz) => {
    const p = z.object({ count: z.number().int().min(PLAN_MIN).max(PLAN_MAX), wish: z.string().max(600).optional() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await once(biz.id, () => makePlan(biz, p.data.count, p.data.wish ?? '')); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/plan/:id/draft', asBiz(async (req, res, biz) => {
    try { await once(biz.id, () => planDraft(biz, Id(req))); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  // Instagram posti: matn yoziladi, rasm fonda chiziladi — qoralama Kontent-meyker → Postlar → Instagram'da va Telegram'da
  app.post('/api/content/plan/:id/instagram', asBiz(async (req, res, biz) => {
    try { await once(biz.id, () => planInstagram(biz, Id(req))); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/plan/:id/video', asBiz(async (req, res, biz) => {
    const item = planStore.get(biz.id, Id(req));
    if (!item) return res.status(404).json({ error: 'Mavzu topilmadi' });
    try {
      const v = await once(biz.id, () => makeVideo(biz, item.angle ? `${item.title}\n\n${item.angle}` : item.title));
      planStore.link(biz.id, item.id, 'video_id', v.id);
      res.json(view(biz));
    } catch (e) { failed(res, e); }
  }));

  app.delete('/api/content/plan/:id', asBiz((req, res, biz) => { planStore.remove(biz.id, Id(req)); res.json(view(biz)); }));

  app.post('/api/content/videos', asBiz(async (req, res, biz) => {
    const p = z.object({ topic: z.string().trim().min(5).max(600) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await once(biz.id, () => makeVideo(biz, p.data.topic)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.patch('/api/content/videos/:id', asOwner((req, res, biz) => {
    const p = z.object({ scenes: Scenes }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (aiBusy.has(biz.id)) return res.status(409).json({ error: 'Kontent-meyker hozir yozyapti — tugagach tahrirlang' });
    try { editScenes(biz.id, Id(req), p.data.scenes); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.post('/api/content/videos/:id/voice', asBiz(async (req, res, biz) => {
    try { await once(biz.id, () => voiceVideo(biz, Id(req))); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.get('/api/content/videos/:id/audio', asBiz((req, res, biz) => {
    const audio = videoAudio(biz.id, Id(req));
    if (!audio) return res.status(404).json({ error: "Ovoz hali yo'q" });
    res.setHeader('content-type', audio.mime);
    // Ssenariy tahrirlanib ovoz qayta yozilsa manzil o'sha: brauzer eski ovozni keshdan bermasin
    res.setHeader('cache-control', 'no-store');
    res.end(audio.data);
  }));

  // mp4 serverda yig'iladi (HyperFrames): navbatga qo'yish va tayyor faylni olish
  app.post('/api/content/videos/:id/render', asBiz((req, res, biz) => {
    try { startRender(biz.id, Id(req)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.get('/api/content/videos/:id/mp4', asBiz((req, res, biz) => {
    const file = videoMp4(biz.id, Id(req), !!req.query.poster);
    if (!file) return res.status(404).json({ error: "Video hali yig'ilmagan" });
    const v = videoStore.get(biz.id, Id(req));
    if (req.query.download && v) res.attachment(`${v.topic.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video'}.mp4`);
    // Qayta yig'ilsa manzil o'sha: brauzer eskisini keshdan bermasin
    res.sendFile(file, { headers: { 'cache-control': 'no-store' } });
  }));

  // Tayyor video egasining Telegram kanaliga — kanal egasining nomidan: faqat egasi
  app.post('/api/content/videos/:id/channel', asOwner(async (req, res, biz) => {
    const p = z.object({ caption: z.string().max(MAX_VIDEO_CAPTION) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { await videoToChannel(biz, Id(req), p.data.caption); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));

  app.delete('/api/content/videos/:id', asBiz((req, res, biz) => {
    if (aiBusy.has(biz.id)) return res.status(409).json({ error: "Kontent-meyker hozir yozyapti — tugagach o'chiring" });
    videoStore.remove(biz.id, Id(req));
    res.json(view(biz));
  }));

  app.delete('/api/content/drafts/:id', asBiz((req, res, biz) => {
    try { cancelDraft(biz, Id(req)); res.json(view(biz)); } catch (e) { failed(res, e); }
  }));
}
