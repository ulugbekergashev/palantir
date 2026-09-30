import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Artifact, LiveStatus } from '../src/types';
import { ask, resetConversation } from './agent';
import { checkPassword, hashPassword, issueToken, loginBlocked, loginFailed, loginOk, readToken, samePassword } from './auth';
import type { BotService } from './bot';
import { businesses, chatLog, documents, leads, notes, outbound, posts, tasks, type BusinessRow } from './db';
import { docFileName, markdownToDocx } from './docx';
import { env, voiceEnabled } from './env';
import { SilenceError, transcribe } from './stt';
import { BusinessSchema, emptyBusiness } from './validate';

type Handler = (req: Request, res: Response) => unknown;

function status(biz: BusinessRow, bot: BotService): LiveStatus {
  const username = bot.username();
  return {
    bot: bot.enabled ? username : null,
    ai: env.aiEnabled,
    voice: voiceEnabled(),
    ownerLinked: !!biz.ownerChatId,
    linkUrl: username ? `https://t.me/${username}?start=o-${biz.linkCode}` : null,
    channel: biz.channelId ? { id: biz.channelId, title: biz.channelTitle } : null,
    generalLink: username ? `https://t.me/${username}?start=l-${biz.id}` : null,
  };
}

/** Jurnaldagi narsaning hozirgi holati (post joylangan, xabar yuborilgan…) */
function current(bizId: string, a: Artifact): Artifact {
  switch (a.type) {
    case 'post': { const p = posts.get(bizId, a.post.id); return p ? { type: 'post', post: p } : a; }
    case 'outbound': { const o = outbound.get(bizId, a.outbound.id); return o ? { type: 'outbound', outbound: o } : a; }
    case 'task': { const t = tasks.get(bizId, a.task.id); return t ? { type: 'task', task: t } : a; }
    default: return a;
  }
}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const TaskCreate = z.object({ title: z.string().trim().min(1).max(200), dueAt: localTime.nullable().optional(), notes: z.string().trim().max(1000).nullable().optional() });
const TaskPatch = TaskCreate.partial().extend({ status: z.enum(['open', 'done', 'cancelled']).optional() });
const LeadCreate = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  source: z.string().trim().max(80).nullable().optional(),
});
const LeadPatch = LeadCreate.omit({ source: true }).extend({ stage: z.enum(['new', 'contacted', 'won', 'lost']).optional() });
const orNull = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() ? s.trim() : null);

export function createApp(bot: BotService) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '8mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const token = (req: Request) => req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const asBiz = (fn: (req: Request, res: Response, biz: BusinessRow) => unknown): Handler => (req, res) => {
    const s = readToken(token(req));
    const biz = s?.role === 'business' ? businesses.byId(s.sub) : undefined;
    if (!biz || !biz.active) return res.status(401).json({ error: 'Qayta kiring' });
    return fn(req, res, biz);
  };
  const asAdmin = (fn: Handler): Handler => (req, res) => {
    if (readToken(token(req))?.role !== 'admin' || !env.adminPassword) return res.status(401).json({ error: 'Admin sifatida kiring' });
    return fn(req, res);
  };
  const bad = (res: Response, error: z.ZodError) =>
    res.status(400).json({ error: "Ma'lumot noto'g'ri", details: error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) });
  const fail = (res: Response, e: unknown, code = 409) => res.status(code).json({ error: (e as Error).message });

  app.get('/api/health', (_req, res) => { res.json({ ok: true, bot: bot.enabled, ai: env.aiEnabled, voice: voiceEnabled() }); });

  // ─── Kirish ────────────────────────────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    const key = `b:${req.ip}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const { login, password } = req.body ?? {};
    const biz = typeof login === 'string' ? businesses.byLogin(login.trim().toLowerCase()) : undefined;
    if (!biz || typeof password !== 'string' || !checkPassword(password, biz.passwordHash) || !biz.active) {
      loginFailed(key);
      return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    }
    loginOk(key);
    res.json({ token: issueToken(biz.id, 'business') });
  });

  app.get('/api/me', asBiz((_req, res, biz) => res.json({ business: biz.profile, status: status(biz, bot) })));

  app.put('/api/business', asBiz((req, res, biz) => {
    const parsed = BusinessSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error);
    businesses.update(biz.id, { profile: parsed.data });
    // Yordamchi yangi profilni bilsin — keyingi gapdan yangi suhbat
    resetConversation(biz.id);
    res.json({ business: parsed.data });
  }));

  // ─── Suhbat ────────────────────────────────────────────────────────────────
  app.get('/api/chat', asBiz((_req, res, biz) => {
    res.json({ entries: chatLog.recent(biz.id, 100).map(e => ({ ...e, artifacts: e.artifacts.map(a => current(biz.id, a)) })) });
  }));

  app.post('/api/chat', asBiz(async (req, res, biz) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
    if (!text) return res.status(400).json({ error: "Xabar bo'sh" });
    const reply = await ask(biz.id, 'web', text);
    res.json({ entries: reply.entries });
  }));

  // Panel mikrofoni: brauzer WAV yuboradi → matn → yordamchi
  app.post('/api/chat/voice', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }), asBiz(async (req, res, biz) => {
    if (!voiceEnabled()) return res.status(400).json({ error: "Ovoz xizmati sozlanmagan" });
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'Ovoz yozilmadi' });
    let text: string;
    try {
      text = await transcribe(audio, req.get('content-type') || 'audio/wav', biz.profile.contentLang ?? 'uz',
        [biz.profile.name, biz.profile.ownerName, ...biz.profile.offerings.map(o => o.name), ...biz.profile.team.map(m => m.name)].filter(Boolean));
    } catch (e) {
      return res.status(e instanceof SilenceError ? 400 : 502).json({ error: e instanceof SilenceError ? 'Hech narsa eshitilmadi' : "Ovozni tanib bo'lmadi" });
    }
    const reply = await ask(biz.id, 'web', text, { voice: true });
    res.json({ entries: reply.entries });
  }));

  app.post('/api/chat/reset', asBiz((_req, res, biz) => {
    resetConversation(biz.id);
    res.json({ ok: true });
  }));

  // ─── Vazifalar ─────────────────────────────────────────────────────────────
  app.get('/api/tasks', asBiz((req, res, biz) => {
    const s = String(req.query.status ?? 'all');
    res.json({ tasks: tasks.list(biz.id, s === 'open' || s === 'done' ? s : 'all', 500) });
  }));

  app.post('/api/tasks', asBiz((req, res, biz) => {
    const p = TaskCreate.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    res.json({ task: tasks.create(biz.id, p.data.title, p.data.dueAt ?? null, orNull(p.data.notes) ?? null) });
  }));

  app.patch('/api/tasks/:id', asBiz((req, res, biz) => {
    const p = TaskPatch.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const t = tasks.update(biz.id, String(req.params.id), { ...p.data, notes: orNull(p.data.notes) });
    if (!t) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ task: t });
  }));

  // ─── Mijozlar va ularga xabarlar ───────────────────────────────────────────
  app.get('/api/leads', asBiz((_req, res, biz) => { res.json({ leads: leads.list(biz.id, 'all', undefined, 1000) }); }));

  app.post('/api/leads', asBiz((req, res, biz) => {
    const p = LeadCreate.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const name = orNull(p.data.name) ?? null;
    const phone = orNull(p.data.phone) ?? null;
    if (!name && !phone) return res.status(400).json({ error: 'Ism yoki telefon kiriting' });
    res.json({ lead: leads.add(biz.id, { name, phone, note: orNull(p.data.note) ?? null, source: orNull(p.data.source) ?? "qo'lda" }) });
  }));

  app.patch('/api/leads/:id', asBiz((req, res, biz) => {
    const p = LeadPatch.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const l = leads.update(biz.id, String(req.params.id), { stage: p.data.stage, note: orNull(p.data.note), phone: orNull(p.data.phone), name: orNull(p.data.name) });
    if (!l) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ lead: l });
  }));

  app.get('/api/followups', asBiz((_req, res, biz) => { res.json({ followups: outbound.list(biz.id, 100) }); }));

  app.post('/api/followups/:id/send', asBiz(async (req, res, biz) => {
    try {
      const r = await bot.sendFollowup(biz, String(req.params.id));
      res.json({ ...r, followup: outbound.get(biz.id, String(req.params.id)) });
    } catch (e) { fail(res, e); }
  }));

  app.post('/api/followups/:id/cancel', asBiz(async (req, res, biz) => {
    try {
      await bot.cancelFollowup(biz, String(req.params.id));
      res.json({ followup: outbound.get(biz.id, String(req.params.id)) });
    } catch (e) { fail(res, e); }
  }));

  // ─── Hujjatlar ─────────────────────────────────────────────────────────────
  app.get('/api/documents', asBiz((_req, res, biz) => { res.json({ documents: documents.list(biz.id) }); }));

  app.get('/api/documents/:id/docx', asBiz(async (req, res, biz) => {
    const d = documents.get(biz.id, String(req.params.id));
    if (!d) return res.status(404).json({ error: 'Topilmadi' });
    const buf = await markdownToDocx(d.title, d.markdown, biz.profile);
    const name = docFileName(d.title);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  }));

  // ─── Postlar ───────────────────────────────────────────────────────────────
  app.get('/api/posts', asBiz((_req, res, biz) => { res.json({ posts: posts.list(biz.id) }); }));

  app.post('/api/posts/:id/publish', asBiz(async (req, res, biz) => {
    try {
      await bot.publishPost(biz, String(req.params.id));
      res.json({ post: posts.get(biz.id, String(req.params.id)) });
    } catch (e) { fail(res, e); }
  }));

  app.delete('/api/posts/:id', asBiz((req, res, biz) => {
    const p = posts.get(biz.id, String(req.params.id));
    if (!p) return res.status(404).json({ error: 'Topilmadi' });
    if (p.status === 'published') return res.status(409).json({ error: 'Joylangan postni bu yerdan o\'chirib bo\'lmaydi' });
    posts.setStatus(biz.id, p.id, 'deleted');
    res.json({ ok: true });
  }));

  // ─── Eslab qolingan faktlar ────────────────────────────────────────────────
  app.get('/api/notes', asBiz((_req, res, biz) => { res.json({ notes: notes.list(biz.id) }); }));

  app.post('/api/notes', asBiz((req, res, biz) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    if (!text) return res.status(400).json({ error: "Matn bo'sh" });
    const n = notes.add(biz.id, text);
    resetConversation(biz.id);
    res.json({ note: n });
  }));

  app.delete('/api/notes/:id', asBiz((req, res, biz) => {
    if (!notes.remove(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    resetConversation(biz.id);
    res.json({ ok: true });
  }));

  // ─── Telegram kanal ────────────────────────────────────────────────────────
  app.post('/api/channel', asBiz(async (req, res, biz) => {
    const ref = typeof req.body?.channel === 'string' ? req.body.channel.slice(0, 100) : '';
    if (!ref.trim()) return res.status(400).json({ error: 'Kanal manzilini kiriting' });
    try {
      const ch = await bot.verifyChannel(ref);
      businesses.update(biz.id, { channelId: ch.id, channelTitle: ch.title });
      res.json({ status: status(businesses.byId(biz.id)!, bot) });
    } catch (e) { fail(res, e, 400); }
  }));

  app.delete('/api/channel', asBiz((_req, res, biz) => {
    businesses.update(biz.id, { channelId: null, channelTitle: null });
    res.json({ status: status(businesses.byId(biz.id)!, bot) });
  }));

  // ─── Admin: bizneslar ──────────────────────────────────────────────────────
  app.post('/api/admin/login', (req, res) => {
    const key = `a:${req.ip}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    if (!env.adminPassword || !samePassword(req.body?.password, env.adminPassword)) {
      loginFailed(key);
      return res.status(401).json({ error: env.adminPassword ? "Parol noto'g'ri" : 'ADMIN_PASSWORD berilmagan' });
    }
    loginOk(key);
    res.json({ token: issueToken('admin', 'admin', 7) });
  });

  app.get('/api/admin/businesses', asAdmin((_req, res) => {
    res.json({
      businesses: businesses.all().map(b => ({
        id: b.id, login: b.login, name: b.profile.name, industry: b.profile.industry, active: b.active, createdAt: b.createdAt,
        ownerLinked: !!b.ownerChatId, channel: b.channelTitle,
      })),
    });
  }));

  app.post('/api/admin/businesses', asAdmin((req, res) => {
    const { name, login, password, industry } = req.body ?? {};
    const cleanLogin = typeof login === 'string' ? login.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return res.status(400).json({ error: 'Biznes nomini kiriting' });
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanLogin)) return res.status(400).json({ error: 'Login: 3–32 ta lotin harfi yoki raqam' });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi' });
    if (businesses.byLogin(cleanLogin)) return res.status(409).json({ error: 'Bu login band' });
    const b = businesses.create(cleanLogin, hashPassword(password), emptyBusiness(name.trim(), typeof industry === 'string' ? industry.trim().slice(0, 80) : ''));
    res.json({ id: b.id });
  }));

  app.patch('/api/admin/businesses/:id', asAdmin((req, res) => {
    const biz = businesses.byId(String(req.params.id));
    if (!biz) return res.status(404).json({ error: 'Topilmadi' });
    const { active, password } = req.body ?? {};
    if (typeof password === 'string') {
      if (password.length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi' });
      businesses.update(biz.id, { passwordHash: hashPassword(password) });
    }
    if (typeof active === 'boolean') businesses.update(biz.id, { active });
    res.json({ ok: true });
  }));

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Topilmadi' }); });

  // Tayyor panel (npm run build) — shu serverning o'zidan
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => { res.sendFile(resolve(dist, 'index.html')); });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http]', err);
    res.status(500).json({ error: 'Serverda xato' });
  });

  return app;
}
