import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ItemEdit, Lang } from '../src/types';
import { applyAction, publishAll, saveEdit, type Action } from './actions';
import { checkPassword, hashPassword, issueToken, loginBlocked, loginFailed, loginOk, readToken, samePassword } from './auth';
import type { BotService } from './bot';
import { clinics, leads, type ClinicRow, type LeadStage } from './db';
import { ensureAi, getBotUsername, isMonday, thisMonday, viewWeek } from './content';
import { env } from './env';
import { answerQuestion } from './qa';
import { ClinicSchema, emptyClinic } from './validate';

type Handler = (req: Request, res: Response) => unknown;

/** Klinika sahifasidagi holat: nima ulangan, nima yo'q */
function status(clinic: ClinicRow, bot: BotService) {
  const username = getBotUsername();
  return {
    bot: bot.enabled ? username : null,
    ai: env.aiEnabled,
    ownerLinked: !!clinic.ownerChatId,
    linkUrl: username ? `https://t.me/${username}?start=o-${clinic.linkCode}` : null,
    channel: clinic.channelId ? { id: clinic.channelId, title: clinic.channelTitle } : null,
    generalLink: username ? `https://t.me/${username}?start=l-${clinic.id}` : null,
  };
}

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
  const asClinic = (fn: (req: Request, res: Response, clinic: ClinicRow) => unknown): Handler => (req, res) => {
    const s = readToken(token(req));
    const clinic = s?.role === 'clinic' ? clinics.byId(s.sub) : undefined;
    if (!clinic || !clinic.active) return res.status(401).json({ error: 'Qayta kiring' });
    return fn(req, res, clinic);
  };
  const asAdmin = (fn: Handler): Handler => (req, res) => {
    if (readToken(token(req))?.role !== 'admin' || !env.adminPassword) return res.status(401).json({ error: 'Admin sifatida kiring' });
    return fn(req, res);
  };
  /** Paneldagi o'zgarish egasining Telegramidagi xabarga ham tushadi (xato panelni to'xtatmaydi) */
  const syncTelegram = (clinicId: string, itemId: string, media = false) => {
    bot.refreshOwnerMessage(clinicId, itemId, media).catch(e => console.error('[bot] xabarni yangilash:', (e as Error).message));
  };
  /** Hafta ko'rinishi; joriy va keyingi haftalar uchun AI matnini orqa fonda boshlaydi */
  const weekResponse = (clinic: ClinicRow, monday: string) => {
    if (monday >= thisMonday()) {
      const job = ensureAi(clinic, monday);
      // AI tugagach egasining Telegramidagi xabarlar ham yangilansin
      job.then(() => { for (const it of viewWeek(clinics.byId(clinic.id)!, monday).items) syncTelegram(clinic.id, it.id, true); }).catch(() => {});
    }
    return viewWeek(clinic, monday);
  };

  app.get('/api/health', (_req, res) => { res.json({ ok: true, bot: bot.enabled, ai: env.aiEnabled }); });

  // ─── Kirish ────────────────────────────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    const key = `c:${req.ip}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const { login, password } = req.body ?? {};
    const clinic = typeof login === 'string' ? clinics.byLogin(login.trim().toLowerCase()) : undefined;
    if (!clinic || typeof password !== 'string' || !checkPassword(password, clinic.passwordHash) || !clinic.active) {
      loginFailed(key);
      return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    }
    loginOk(key);
    res.json({ token: issueToken(clinic.id, 'clinic') });
  });

  app.get('/api/me', asClinic((_req, res, clinic) => res.json({ clinic: clinic.profile, status: status(clinic, bot) })));

  app.put('/api/clinic', asClinic((req, res, clinic) => {
    const parsed = ClinicSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Ma'lumot noto'g'ri", details: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) });
    clinics.update(clinic.id, { profile: parsed.data });
    res.json({ clinic: parsed.data });
  }));

  // ─── Haftalik paket ────────────────────────────────────────────────────────
  app.get('/api/weeks/:monday', asClinic((req, res, clinic) => {
    const monday = String(req.params.monday);
    if (!isMonday(monday)) return res.status(400).json({ error: 'Sana dushanba emas' });
    res.json(weekResponse(clinic, monday));
  }));

  app.post('/api/items/:id/action', asClinic((req, res, clinic) => {
    const itemId = String(req.params.id);
    const action = req.body?.action as Action;
    if (!['publish', 'reject', 'undo', 'variant'].includes(action)) return res.status(400).json({ error: "Noma'lum amal" });
    const error = applyAction(clinic, itemId, action);
    if (error) return res.status(409).json({ error });
    syncTelegram(clinic.id, itemId, action === 'variant');
    if (action === 'publish') void bot.publishDue();
    res.json(weekResponse(clinics.byId(clinic.id)!, itemId.slice(0, 10)));
  }));

  app.put('/api/items/:id/edit', asClinic((req, res, clinic) => {
    const itemId = String(req.params.id);
    const edit = (req.body?.edit ?? null) as Partial<Record<Lang, ItemEdit>> | null;
    const error = saveEdit(clinic, itemId, edit && typeof edit === 'object' ? edit : null);
    if (error) return res.status(409).json({ error });
    syncTelegram(clinic.id, itemId);
    res.json(viewWeek(clinic, itemId.slice(0, 10)));
  }));

  app.post('/api/weeks/:monday/publish-all', asClinic((req, res, clinic) => {
    const monday = String(req.params.monday);
    if (!isMonday(monday)) return res.status(400).json({ error: 'Sana dushanba emas' });
    const ids = publishAll(clinic, monday);
    for (const id of ids) syncTelegram(clinic.id, id);
    void bot.publishDue();
    res.json({ count: ids.length, week: viewWeek(clinic, monday) });
  }));

  app.get('/api/weeks/:monday/report', asClinic((req, res, clinic) => {
    const monday = String(req.params.monday);
    if (!isMonday(monday)) return res.status(400).json({ error: 'Sana dushanba emas' });
    res.json({ week: viewWeek(clinic, monday), counts: leads.countsForWeek(clinic.id, monday) });
  }));

  // ─── Murojaatlar (lidlar) ──────────────────────────────────────────────────
  app.get('/api/leads', asClinic((_req, res, clinic) => {
    const list = leads.forClinic(clinic.id);
    // Qaysi postdan kelgani — sarlavhasi bilan
    const titles = new Map<string, string>();
    for (const week of new Set(list.map(l => l.itemId?.slice(0, 10)).filter(Boolean) as string[])) {
      for (const it of viewWeek(clinic, week).items) titles.set(it.id, `${it.topic.uz}: ${it.design.uz.title}`);
    }
    res.json({ leads: list.map(l => ({ ...l, source: l.itemId ? titles.get(l.itemId) ?? null : null })) });
  }));

  app.patch('/api/leads/:id', asClinic((req, res, clinic) => {
    const stage = req.body?.stage as LeadStage;
    if (!['contact', 'called'].includes(stage)) return res.status(400).json({ error: "Noma'lum holat" });
    if (!leads.setStage(clinic.id, String(req.params.id), stage)) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  }));

  app.post('/api/ask', asClinic(async (req, res, clinic) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 500).trim() : '';
    if (!text) return res.status(400).json({ error: "Savol bo'sh" });
    res.json({ answer: await answerQuestion(clinic, text) });
  }));

  // ─── Telegram ──────────────────────────────────────────────────────────────
  app.post('/api/channel', asClinic(async (req, res, clinic) => {
    const ref = typeof req.body?.channel === 'string' ? req.body.channel.slice(0, 100) : '';
    if (!ref.trim()) return res.status(400).json({ error: 'Kanal manzilini kiriting' });
    try {
      const ch = await bot.verifyChannel(ref);
      clinics.update(clinic.id, { channelId: ch.id, channelTitle: ch.title });
      res.json({ status: status(clinics.byId(clinic.id)!, bot) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }));

  app.delete('/api/channel', asClinic((_req, res, clinic) => {
    clinics.update(clinic.id, { channelId: null, channelTitle: null });
    res.json({ status: status(clinics.byId(clinic.id)!, bot) });
  }));

  app.post('/api/telegram/resend', asClinic(async (_req, res, clinic) => {
    if (!bot.enabled) return res.status(400).json({ error: 'Bot ulanmagan' });
    if (!clinic.ownerChatId) return res.status(400).json({ error: 'Avval Telegramni ulang' });
    await bot.sendPackage(clinic, thisMonday());
    res.json({ ok: true });
  }));

  // ─── Admin: klinikalar ─────────────────────────────────────────────────────
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

  app.get('/api/admin/clinics', asAdmin((_req, res) => {
    res.json({
      clinics: clinics.all().map(c => ({
        id: c.id, login: c.login, name: c.profile.name, active: c.active, createdAt: c.createdAt,
        ownerLinked: !!c.ownerChatId, channel: c.channelTitle, sentWeek: c.sentWeek,
      })),
    });
  }));

  app.post('/api/admin/clinics', asAdmin((req, res) => {
    const { name, login, password } = req.body ?? {};
    const cleanLogin = typeof login === 'string' ? login.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return res.status(400).json({ error: 'Klinika nomini kiriting' });
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanLogin)) return res.status(400).json({ error: 'Login: 3–32 ta lotin harfi yoki raqam' });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: "Parol kamida 6 belgi" });
    if (clinics.byLogin(cleanLogin)) return res.status(409).json({ error: 'Bu login band' });
    const c = clinics.create(cleanLogin, hashPassword(password), emptyClinic(name.trim()));
    res.json({ id: c.id });
  }));

  app.patch('/api/admin/clinics/:id', asAdmin((req, res) => {
    const clinic = clinics.byId(String(req.params.id));
    if (!clinic) return res.status(404).json({ error: 'Topilmadi' });
    const { active, password } = req.body ?? {};
    if (typeof password === 'string') {
      if (password.length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi' });
      clinics.update(clinic.id, { passwordHash: hashPassword(password) });
    }
    if (typeof active === 'boolean') clinics.update(clinic.id, { active });
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
