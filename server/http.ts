import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Artifact, InboxThread, LiveStatus } from '../src/types';
import { iso } from '../src/lib/week';
import { ask, resetConversation } from './agent';
import { checkPassword, hashPassword, issueToken, loginBlocked, loginFailed, loginOk, readToken, samePassword, verifyInitData } from './auth';
import { CLIENT_HEADER, RELAY_HEADER, RELAY_SECRET, SUPPORT_HEADER, remoteUrl } from './remote';
import { activate, licenseStatus } from './license';
import type { BotService } from './bot';
import { costUsd } from './claude';
import { cancelEntry, confirmEntry, entryView, undoEntry } from './crm/actions';
import { facts as notes, refresh as refreshVault } from './brain/vault';
import { syncTasks } from './brain/mirror';
import { aiUsage, businesses, chatLog, documents, inbox, leads, moneyEntries, outbound, publicLead, replies, supportOpen, supportVisits, tasks, type BusinessRow } from './db';
import { askSupport, notifySupportVisit } from './supportAsk';
import { docFileName, markdownToDocx } from './docx';
import { env, voiceEnabled } from './env';
import { SilenceError, transcribe } from './stt';
import { FileError, MAX_FILE_BYTES, intakeText, takeFile } from './intake/index';
import { INTERVIEW_START, interviewReply, interviewStart, interviewing } from './brain/interview';
import { approveReply, dismissReply, ownerWrites, replySettings } from './inbox/core';
import { cancelInstagramLogin, disconnectInstagram, instagramAvailable, instagramStatus, startInstagramLogin } from './inbox/instagram';
import { disconnectInstagramApi, instagramApiConnectUrl, instagramApiStatus } from './inbox/instagramApi';
import { disconnectTelegramUser, loginCode, loginPassword, loginStart, telegramUserAccount, telegramUserAvailable } from './inbox/telegramUser';
import { AutoReplySchema, BusinessSchema, emptyBusiness } from './validate';
import { containsSecret } from '../src/lib/secrets';
import { mountSetup } from './setup/routes';
import { crmStatus } from './crm/index';
import { mountCrm } from './crm/routes';
import { mountBrain } from './brain/routes';
import { mountCamera } from './camera/routes';
import { mountVoice } from './voice/routes';
import { mountRequests } from './requests/routes';
import { mountPhone } from './phone/routes';
import { dashboard } from './analytics';
import { funnel } from './funnel';
import { clientCard } from './clientCard';
import { MAX_PERIOD_DAYS, daysIn, periodDays, type PeriodKey } from '../src/lib/dashboard';
import { phoneChanged } from './people';
import { forgetLead } from './forget';
import { telegramBusinessStatus } from './inbox/telegramBusiness';
import { mountOrders } from './orders/routes';
import { mountAttention } from './attention';
import { mountTeamDay } from './teamDay';
import { mountInsights } from './insights/routes';
import { APP_VERSION } from './version';
import { diagnostics, sendDiagnostics } from './diagnostics';

type Handler = (req: Request, res: Response) => unknown;

/** support — Palantir jamoasi kirishi: egasini Telegram'ga ulash havolasi berilmaydi (u bilan jamoa o'zini egasi qilib, ruxsat o'chirilganda ham kira olardi) */
function status(biz: BusinessRow, bot: BotService, support = false): LiveStatus {
  const username = bot.username();
  return {
    bot: bot.enabled ? username : null,
    ai: env.aiEnabled,
    voice: voiceEnabled(),
    ownerLinked: !!biz.ownerChatId,
    linkUrl: username && !support ? `https://t.me/${username}?start=o-${biz.linkCode}` : null,
    generalLink: username ? `https://t.me/${username}?start=l-${biz.id}` : null,
    telegramUser: { enabled: env.tgPersonal, available: telegramUserAvailable(), account: telegramUserAccount(biz.id) },
    telegramBusiness: telegramBusinessStatus(biz.id),
    remote: { url: remoteUrl(), miniApp: !!remoteUrl() && remoteUrl()!.startsWith('https://') && !!username },
    instagram: { enabled: env.igViaBrowser, available: instagramAvailable(), ...instagramStatus(biz.id) },
    instagramApi: instagramApiStatus(biz.id),
    crm: crmStatus(biz.id),
  };
}

/** Jurnaldagi narsaning hozirgi holati (post joylangan, xabar yuborilgan…) */
function current(bizId: string, a: Artifact): Artifact {
  switch (a.type) {
    case 'outbound': { const o = outbound.get(bizId, a.outbound.id); return o ? { type: 'outbound', outbound: o } : a; }
    case 'task': { const t = tasks.get(bizId, a.task.id); return t ? { type: 'task', task: t } : a; }
    case 'money': { const m = moneyEntries.get(bizId, a.entry.id); return m ? { type: 'money', entry: entryView(m) } : a; }
    default: return a;
  }
}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const TaskCreate = z.object({ title: z.string().trim().min(1).max(200), dueAt: localTime.nullable().optional(), notes: z.string().trim().max(1000).nullable().optional() });
/** call: true — eslatma vaqtida qo'ng'iroq qilinsin (Telegram orqali AI yoki ovozli xabar); faqat yangi vazifada */
const TaskNew = TaskCreate.extend({ call: z.boolean().optional() });
const TaskPatch = TaskCreate.partial().extend({ status: z.enum(['open', 'done', 'cancelled']).optional() });
const LeadCreate = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  source: z.string().trim().max(80).nullable().optional(),
});
const LeadPatch = LeadCreate.omit({ source: true }).extend({
  stage: z.enum(['new', 'contacted', 'won', 'lost']).optional(),
  nextStep: z.string().trim().max(200).nullable().optional(),
  nextAt: localTime.nullable().optional(),
});
const orNull = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() ? s.trim() : null);

/** So'rov tanasini o'qiydi (JSON bo'lmagan yuklama uchun). Chegaradan oshsa — null: ortig'i xotiraga olinmaydi, lekin javob yuborish uchun oxirigacha kutiladi */
function readBody(req: Request, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= max) chunks.push(chunk); });
    req.on('end', () => resolve(size > max ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Faqat shu kompyuter uchun ochilgan server (LISTEN_HOST): begona sayt brauzer orqali unga o'z nomi bilan murojaat qila olmasin */
const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|localhost)$/;
/** Kabinet parolining eng qisqa uzunligi (kabinetda mijozlar, pul va CRM bor) */
const MIN_PASSWORD = 8;
/** Palantir jamoasi kirishi 12 soat: hub sahifasidan istalgan payt qayta ochiladi */
const SUPPORT_SESSION_DAYS = 0.5;
/** Sozlamalarda egasiga ko'rsatiladigan oxirgi jamoa kirishlari */
const SUPPORT_VISITS_SHOWN = 20;
/** Admin panelida AI xarajati necha kun uchun ko'rsatiladi */
const USAGE_DAYS = 7;
/** Telefondagi AI yordamchi javobini shuncha kutadi (tgvoice/call_live.py PALANTIR_WAIT_S); undan kech javob Telegram'ga yuboriladi */
const PHONE_WAIT_MS = 9_000;

/** So'rov tanasining qolgani o'qib tashlanguncha kutadi (xotiraga olinmaydi). Juda uzoq davom etsa — kutilmaydi */
const DRAIN_MS = 60_000;
function drained(req: Request): Promise<void> {
  if (req.readableEnded) return Promise.resolve();
  return new Promise(done => {
    const timer = setTimeout(done, DRAIN_MS);
    const end = () => { clearTimeout(timer); done(); };
    req.once('end', end).once('error', end).once('close', end);
    req.resume();
  });
}

export function createApp(bot: BotService) {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', 1);
  if (LOOPBACK.test(env.listenHost)) {
    app.use((req, res, next) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
      if (host === 'localhost' || LOOPBACK.test(host) || host === '[::1]') return next();
      res.status(421).json({ error: "Bu manzil orqali ochib bo'lmaydi" });
    });
  }
  app.use(express.json({ limit: '8mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Masofadan (hub orqali) kelgan so'rov: shu jarayonning siri bilan belgilanadi (remote.ts) — tarmoqdagi begona kalla bilan soxtalashtirib bo'lmaydi
  const isRemote = (req: Request) => req.get(RELAY_HEADER) === RELAY_SECRET;
  /** Kirish urinishlarini sanash kaliti: masofadan — telefonning haqiqiy manzili (hub aytadi), «hub/» bilan: shu kompyuterga berilgan yengillik tegmasin */
  const clientKey = (req: Request) => (isRemote(req) ? `hub/${req.get(CLIENT_HEADER) ?? '?'}` : String(req.ip));
  /** Hub admin kaliti bilan ochilgan so'rov (remote.ts): faqat jamoa kirishini olish uchun */
  const isSupportRelay = (req: Request) => isRemote(req) && req.get(SUPPORT_HEADER) === RELAY_SECRET;

  const token = (req: Request) => req.get('authorization')?.replace(/^Bearer\s+/i, '');
  /** Amaldagi biznes kirishi: parol almashgan, «boshqa qurilmalardan chiqish» bosilgan yoki egasi jamoa kirishini o'chirgan bo'lsa — yo'q */
  const sessionOf = (req: Request) => {
    const s = readToken(token(req));
    const biz = s?.role === 'business' ? businesses.byId(s.sub) : undefined;
    if (!s || !biz || !biz.active || (s.v ?? 0) !== biz.tokenVer || (s.sup && (!supportOpen(biz) || (s.sv ?? 0) !== biz.supportVer))) return null;
    return { biz, support: s.sup === true };
  };
  const statusFor = (req: Request, biz: BusinessRow) => status(biz, bot, !!sessionOf(req)?.support);

  // Admin, ulash ustasi, anketa va ovozli agent (ichki xizmat) — faqat shu kompyuterda.
  // Palantir jamoasi (o'rnatuvchi) ulash ustasi va anketani masofadan ham ochadi; admin va ovozli agent — baribir yopiq.
  // Yo'l kichik harf bilan tekshiriladi: Express yo'llarni harf kattaligiga qaramay moslaydi (/API/admin ham admin yo'li)
  const REMOTE_CLOSED = /^\/api\/(admin|setup|anketa)(\/|$)|^\/api\/voice\/(?!key$)/;
  const SUPPORT_OPEN = /^\/api\/(setup|anketa)(\/|$)/;
  app.use((req, res, next) => {
    const path = req.path.toLowerCase();
    if (isRemote(req) && REMOTE_CLOSED.test(path) && !(SUPPORT_OPEN.test(path) && sessionOf(req)?.support)) {
      return res.status(403).json({ error: "Bu bo'lim faqat klinika kompyuterida ochiladi" });
    }
    next();
  });

  const asBiz = (fn: (req: Request, res: Response, biz: BusinessRow) => unknown): Handler => (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Qayta kiring' });
    // Kalitsiz ishlash muddati tugagan: panel yopiq (bot, kamera va boshqa xizmatlar ishlayveradi — license.ts)
    if (licenseStatus().blocked) return res.status(403).json({ error: 'Palantir aktivlashtirilmagan — kalitni kiriting', code: 'LITSENZIYA' });
    return fn(req, res, s.biz);
  };
  /** Faqat egasining o'zi (jamoa kirishi bilan emas): kirish va ruxsat sozlamalari */
  const asOwner = (fn: (req: Request, res: Response, biz: BusinessRow) => unknown): Handler => asBiz((req, res, biz) =>
    (sessionOf(req)?.support ? res.status(403).json({ error: 'Buni faqat klinika egasi o\'zgartiradi' }) : fn(req, res, biz)));
  const asAdmin = (fn: Handler): Handler => (req, res) => {
    if (readToken(token(req))?.role !== 'admin' || !env.adminPassword) return res.status(401).json({ error: 'Admin sifatida kiring' });
    return fn(req, res);
  };
  const bad = (res: Response, error: z.ZodError) =>
    res.status(400).json({ error: "Ma'lumot noto'g'ri", details: error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) });
  const fail = (res: Response, e: unknown, code = 409) => res.status(code).json({ error: (e as Error).message });

  app.get('/api/health', (_req, res) => { res.json({ ok: true, version: APP_VERSION, bot: bot.enabled, ai: env.aiEnabled, voice: voiceEnabled() }); });

  // ─── Kirish ────────────────────────────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    const key = `b:${clientKey(req)}`;
    const { login, password } = req.body ?? {};
    // Masofadan: manzil almashtirib urinishga qarshi — bitta login bo'yicha ham (klinikadagi kirishga tegmaydi)
    const perLogin = isRemote(req) && typeof login === 'string' ? `rl:${login.trim().toLowerCase().slice(0, 64)}` : null;
    if (loginBlocked(key) || (perLogin && loginBlocked(perLogin))) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const biz = typeof login === 'string' ? businesses.byLogin(login.trim().toLowerCase()) : undefined;
    if (!biz || typeof password !== 'string' || !checkPassword(password, biz.passwordHash) || !biz.active) {
      loginFailed(key);
      if (perLogin) loginFailed(perLogin);
      return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    }
    loginOk(key);
    if (perLogin) loginOk(perLogin);
    res.json({ token: issueToken(biz.id, 'business', 30, biz.tokenVer) });
  });

  // ─── Litsenziya ────────────────────────────────────────────────────────────
  // Kirishsiz: aktivlashtirish oynasi kirish sahifasidan oldin ham ko'rinadi (kompyuter kodi maxfiy emas). Kalitni soxtalashtirib
  // bo'lmaydi (sotuvchining imzosi) — urinishlar baribir sanaladi. Hub ham shu yo'llar orqali bir bosishda aktivlashtiradi
  app.get('/api/license', (_req, res) => { res.json({ license: licenseStatus() }); });
  app.post('/api/license', (req, res) => {
    const key = `lic:${clientKey(req)}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const done = activate(typeof req.body?.key === 'string' ? req.body.key.slice(0, 400) : '');
    if (!done) {
      loginFailed(key);
      return res.status(400).json({ error: "Kalit noto'g'ri yoki boshqa kompyuterniki — kompyuter kodini tekshirib, kalitni qayta so'rang" });
    }
    loginOk(key);
    res.json({ license: done });
  });

  // Telegram Mini App (bot → «Panel»): Telegram imzolagan ma'lumot bilan, parolsiz — faqat botga ulangan egasi
  app.post('/api/login/telegram', (req, res) => {
    const key = `t:${clientKey(req)}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const initData = typeof req.body?.initData === 'string' ? req.body.initData.slice(0, 4096) : '';
    const who = env.botToken && initData ? verifyInitData(initData, env.botToken) : null;
    if (!who) {
      loginFailed(key);
      return res.status(401).json({ error: "Telegram tasdig'i noto'g'ri yoki eskirgan — botda «Panel»ni qayta bosing" });
    }
    const biz = businesses.byOwnerChat(who.userId);
    if (!biz?.active) return res.status(403).json({ error: "Bu Telegram akkaunt biznesga ulanmagan — login va parol bilan kiring" });
    loginOk(key);
    res.json({ token: issueToken(biz.id, 'business', 30, biz.tokenVer) });
  });

  // Egasi o'z parolini almashtiradi: hamma qurilmalardagi kirish bekor, shu qurilmaga yangisi beriladi.
  // Joriy parol noto'g'ri — 403 (401 panelni «sessiya tugadi» deb chiqarib yuborardi)
  app.post('/api/account/password', asOwner((req, res, biz) => {
    const key = `p:${biz.id}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const { current, next } = req.body ?? {};
    if (typeof current !== 'string' || !checkPassword(current, biz.passwordHash)) {
      loginFailed(key);
      return res.status(403).json({ error: "Joriy parol noto'g'ri" });
    }
    loginOk(key);
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) return res.status(400).json({ error: `Yangi parol kamida ${MIN_PASSWORD} belgi` });
    if (next.length > 200) return res.status(400).json({ error: 'Parol juda uzun' });
    businesses.update(biz.id, { passwordHash: hashPassword(next) });
    res.json({ token: issueToken(biz.id, 'business', 30, businesses.revokeSessions(biz.id)) });
  }));

  // Telefon yo'qoldi yoki begona kompyuterda kirib qolgan: shu qurilmadan boshqa hamma joyda chiqiladi
  app.post('/api/account/sign-out-others', asOwner((_req, res, biz) => {
    res.json({ token: issueToken(biz.id, 'business', 30, businesses.revokeSessions(biz.id)) });
  }));

  // Palantir jamoasi: hubdagi «Panelni ochish» (admin kaliti bilan) — egasining roziligi bilan: doimiy ruxsat yoqilgan bo'lsa darhol,
  // aks holda Telegram'da so'raladi (supportAsk.ts). Har kirish egasiga Telegram'da aytiladi va Sozlamalarda yoziladi.
  // Bu kompyuterda bir nechta biznes bo'lsa — qaysi biri so'raladi (ro'yxat hubga qaytadi)
  app.post('/api/login/support', async (req, res) => {
    if (!isSupportRelay(req)) return res.status(403).json({ error: 'Faqat Palantir Hub orqali' });
    const active = businesses.all().filter(b => b.active);
    const wanted = typeof req.body?.business === 'string' ? req.body.business : null;
    const biz = wanted ? active.find(b => b.id === wanted) : active.length === 1 ? active[0] : undefined;
    if (!biz) {
      return res.status(active.length ? 409 : 404).json({
        error: active.length ? 'Qaysi biznes?' : "Bu kompyuterda biznes yo'q",
        businesses: active.map(b => ({ id: b.id, name: b.profile.name })),
      });
    }
    const hours = SUPPORT_SESSION_DAYS * 24;
    if (!supportOpen(biz)) {
      const answer = await askSupport(biz, hours);
      if (answer !== 'yes') {
        return res.status(403).json({
          error: answer === 'no' ? 'Klinika egasi rad etdi'
            : answer === 'timeout' ? "Klinika egasi Telegram'da javob bermadi — keyinroq qayta urining"
              : "Klinika egasi Telegram'ga ulanmagan va jamoa kirishini yoqmagan",
        });
      }
      businesses.grantSupport(biz.id, new Date(Date.now() + SUPPORT_SESSION_DAYS * 86_400_000).toISOString());
    }
    const now = businesses.byId(biz.id) ?? biz;
    supportVisits.add(biz.id, req.get(CLIENT_HEADER) ?? null);
    void notifySupportVisit(now, hours);
    res.json({ token: issueToken(biz.id, 'business', SUPPORT_SESSION_DAYS, now.tokenVer, now.supportVer) });
  });

  // Egasi: jamoa kira oladimi va qachon kirgan. mine — hozirgi kirish jamoaniki (u ruxsatni o'zgartira olmaydi)
  app.get('/api/account/support', asBiz((req, res, biz) => {
    const until = biz.supportUntil && Date.parse(biz.supportUntil) > Date.now() ? biz.supportUntil : null;
    res.json({ allowed: biz.supportAccess, until, hub: !!remoteUrl(), mine: !!sessionOf(req)?.support, visits: supportVisits.recent(biz.id, SUPPORT_VISITS_SHOWN) });
  }));
  app.put('/api/account/support', asOwner((req, res, biz) => {
    const p = z.object({ allowed: z.boolean() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (p.data.allowed) businesses.update(biz.id, { supportAccess: true });
    else businesses.closeSupport(biz.id);
    res.json({ allowed: p.data.allowed });
  }));

  /** Xizmatlar ro'yxatining «nusxa raqami»: panel qaysi nusxani tahrirlayotganini bildiradi */
  const offeringsRev = (list: BusinessRow['profile']['offerings']) => createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);

  // Boshqaruv paneli: davr ko'rsatkichlari, dinamika, jamoa, so'nggi murojaatlar
  app.get('/api/dashboard', asBiz((req, res, biz) => {
    const key = (['today', 'yesterday', 'week', 'month', 'custom'] as const).find(k => k === req.query.period) ?? 'today';
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    const p = periodDays(key as PeriodKey, new Date(), { from: day(req.query.from), to: day(req.query.to) });
    if (daysIn(p) > MAX_PERIOD_DAYS) return res.status(400).json({ error: `Oraliq ${MAX_PERIOD_DAYS} kundan oshmasin` });
    res.json({ dashboard: dashboard(biz, p) });
  }));
  // Voronka (DentaCRM'dan kelgan va to'laganlar bilan): sekinroq — panel alohida so'raydi
  app.get('/api/dashboard/funnel', asBiz(async (req, res, biz) => {
    const key = (['today', 'yesterday', 'week', 'month', 'custom'] as const).find(k => k === req.query.period) ?? 'today';
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    const p = periodDays(key as PeriodKey, new Date(), { from: day(req.query.from), to: day(req.query.to) });
    if (daysIn(p) > MAX_PERIOD_DAYS) return res.status(400).json({ error: `Oraliq ${MAX_PERIOD_DAYS} kundan oshmasin` });
    res.json({ funnel: await funnel(biz, p) });
  }));

  app.get('/api/me', asBiz((req, res, biz) => res.json({ business: biz.profile, status: statusFor(req, biz), offeringsRev: offeringsRev(biz.profile.offerings) })));

  app.put('/api/business', asBiz((req, res, biz) => {
    const parsed = BusinessSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error);
    // Xizmatlar shu orada boshqa joyda o'zgargan bo'lsa (ikkinchi miyadagi narxlar, yordamchi yozgani, boshqa oyna) — eski nusxa ustidan yozilmaydi
    const rev = typeof req.body?.offeringsRev === 'string' ? req.body.offeringsRev : null;
    if (rev && rev !== offeringsRev(biz.profile.offerings)) return res.status(409).json({ error: "Xizmatlar va narxlar boshqa joyda o'zgargan — sahifani yangilab, o'zgartirishni qayta kiriting" });
    // replyStyle — eski maydon (uslub endi papkadagi Uslub.md da): profil sahifasi uni o'zgartirmaydi
    const profile = { ...parsed.data, replyStyle: biz.profile.replyStyle };
    businesses.update(biz.id, { profile });
    // Papkadagi mundarija va narxlar nusxasi yangi profil bilan
    refreshVault(biz.id);
    // Yordamchi yangi profilni bilsin — keyingi gapdan yangi suhbat
    resetConversation(biz.id);
    res.json({ business: profile, offeringsRev: offeringsRev(profile.offerings) });
  }));

  // ─── Suhbat ────────────────────────────────────────────────────────────────
  app.get('/api/chat', asBiz((_req, res, biz) => {
    res.json({ entries: chatLog.recent(biz.id, 100).map(e => ({ ...e, artifacts: e.artifacts.map(a => current(biz.id, a)) })), interview: interviewing(biz) });
  }));

  /** Birinchi kun suhbati ochiq bo'lsa (yoki egasi «savollar» desa) — gap javob deb olinadi va yordamchiga ketmaydi. Aks holda null */
  const interviewTurn = (biz: BusinessRow, text: string, shown = text) => {
    const turn = INTERVIEW_START.test(text) ? interviewStart(biz) : interviewReply(biz, text);
    return turn ? { entries: [chatLog.add(biz.id, 'web', 'owner', shown), chatLog.add(biz.id, 'web', 'assistant', turn.text)], interview: turn.open } : null;
  };

  app.post('/api/chat', asBiz(async (req, res, biz) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
    if (!text) return res.status(400).json({ error: "Xabar bo'sh" });
    // Token yoki kalit suhbatga yozilmaydi: u modelga, jurnalga va bilimga tushib qolardi
    if (containsSecret(text)) return res.status(400).json({ error: "Xabarda maxfiy kalit bor — u yuborilmadi va saqlanmadi. Kalitlarni «Ulash» sahifasiga kiriting (#/ulash)." });
    const answered = interviewTurn(biz, text);
    if (answered) return res.json(answered);
    // phone: true — gap jonli qo'ng'iroqdan (tgvoice/): javob qisqa va ovozga mos bo'lsin
    const phone = req.body?.phone === true;
    const started = Date.now();
    const reply = await ask(biz.id, 'web', text, { phone });
    // Qo'ng'iroqda so'ralgan hujjat yoki rasm egasining Telegram'iga boradi (telefonda uni ko'rsatib bo'lmaydi). Javob kech qolsa —
    // telefondagi AI kutmay qo'ygan (PHONE_WAIT_MS): matni ham Telegram'ga. Qo'ng'iroq uzilgan bo'lsa ham natija yo'qolmaydi
    const late = Date.now() - started > PHONE_WAIT_MS;
    const deliver = phone && req.body?.deliver === 'telegram' && bot.enabled && !!biz.ownerChatId && (reply.artifacts.length > 0 || late);
    let delivered = false;
    if (deliver) {
      try {
        await bot.deliverReply(businesses.byId(biz.id) ?? biz, reply.text, reply.artifacts);
        delivered = true;
      } catch (e) {
        console.error("[telefon] Telegram'ga yetkazilmadi:", (e as Error).message);
      }
    }
    if (!res.headersSent && !res.writableEnded) res.json({ entries: reply.entries, interview: false, delivered });
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
    if (containsSecret(text)) return res.status(400).json({ error: "Gapda maxfiy kalit eshitildi — yuborilmadi va saqlanmadi. Kalitlarni «Ulash» sahifasiga kiriting (#/ulash)." });
    const answered = interviewTurn(biz, text.trim(), `🎙 ${text.trim()}`);
    if (answered) return res.json(answered);
    const reply = await ask(biz.id, 'web', text, { voice: true });
    res.json({ entries: reply.entries, interview: false });
  }));

  // Panel: egasi suhbatga fayl tashladi → o'qiladi, bilimga taklif bo'lib tushadi (model ishtirokisiz).
  // Fayl tanasi kirish tekshirilgandan KEYIN o'qiladi: begona so'rov serverga megabaytlab ma'lumot yuklatib qo'ymasin
  app.post('/api/chat/file', asBiz(async (req, res, biz) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 200) : '';
    if (!name) return res.status(400).json({ error: 'Fayl nomi kerak' });
    // Tana JSON deb yuborilsa, uni umumiy JSON o'quvchi allaqachon o'qib bo'lgan — bu yerda kutib qolinmaydi
    if (req.readableEnded || req.is('application/json')) return res.status(400).json({ error: 'Fayl «application/octet-stream» ko\'rinishida yuborilishi kerak' });
    // Ortiqcha tana xotiraga olinmaydi, lekin oxirigacha o'qib tashlanadi: ulanish uzib qo'yilsa, brauzer sababni emas, «aloqa yo'q»ni ko'radi
    // Javob tana oxirigacha kelgandan KEYIN yuboriladi: yuklash hali ketayotganda javob berib ulanish yopilsa, brauzer 413 ni emas, uzilishni ko'radi
    const tooBig = async () => { await drained(req); res.set('connection', 'close'); return res.status(413).json({ error: `Fayl ${MAX_FILE_BYTES / 1024 / 1024} MB dan katta — kichikroq qilib yuboring.` }); };
    if (Number(req.get('content-length') ?? 0) > MAX_FILE_BYTES) return tooBig();
    const bytes = await readBody(req, MAX_FILE_BYTES);
    if (!bytes) return tooBig();
    try {
      const taken = await takeFile(biz, name, bytes);
      res.json({ entries: [chatLog.add(biz.id, 'web', 'owner', `📎 ${taken.label}`), chatLog.add(biz.id, 'web', 'assistant', intakeText(taken))], suggestion: taken.suggestion.id });
    } catch (e) {
      if (e instanceof FileError) return res.status(400).json({ error: e.message });
      fail(res, e);
    }
  }));

  app.post('/api/chat/reset', asBiz((_req, res, biz) => {
    resetConversation(biz.id);
    res.json({ ok: true });
  }));

  // ─── Vazifalar ─────────────────────────────────────────────────────────────
  // Obsidian'dagi Vazifalar.md bilan: avval egasining o'zgartirishlari olinadi, o'zgarishdan keyin fayl yangilanadi
  app.get('/api/tasks', asBiz((req, res, biz) => {
    syncTasks(biz.id);
    const s = String(req.query.status ?? 'all');
    res.json({ tasks: tasks.list(biz.id, s === 'open' || s === 'done' ? s : 'all', 500) });
  }));

  app.post('/api/tasks', asBiz((req, res, biz) => {
    const p = TaskNew.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    syncTasks(biz.id);
    const task = tasks.create(biz.id, p.data.title, p.data.dueAt ?? null, orNull(p.data.notes) ?? null, { spoken: !!p.data.call && !!p.data.dueAt });
    syncTasks(biz.id);
    res.json({ task });
  }));

  app.patch('/api/tasks/:id', asBiz((req, res, biz) => {
    const p = TaskPatch.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    syncTasks(biz.id);
    const t = tasks.update(biz.id, String(req.params.id), { ...p.data, notes: orNull(p.data.notes) });
    if (!t) return res.status(404).json({ error: 'Topilmadi' });
    syncTasks(biz.id);
    res.json({ task: t });
  }));

  // ─── Mijozlar va ularga xabarlar ───────────────────────────────────────────
  app.get('/api/leads', asBiz((_req, res, biz) => { res.json({ leads: leads.list(biz.id, 'all', undefined, 1000).map(publicLead) }); }));

  app.post('/api/leads', asBiz((req, res, biz) => {
    const p = LeadCreate.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const name = orNull(p.data.name) ?? null;
    const phone = orNull(p.data.phone) ?? null;
    if (!name && !phone) return res.status(400).json({ error: 'Ism yoki telefon kiriting' });
    const added = leads.add(biz.id, { name, phone, note: orNull(p.data.note) ?? null, source: orNull(p.data.source) ?? "qo'lda" });
    // Shu raqam bilan yozishgan (Instagram, bot) odam bo'lsa — bitta karta
    res.json({ lead: publicLead((phone ? phoneChanged(biz, added.id) : undefined) ?? added) });
  }));

  // Mijoz kartasi: kanallari, so'rovlari, qo'ng'iroqlari, DentaCRM bemori
  app.get('/api/leads/:id/card', asBiz(async (req, res, biz) => {
    const card = await clientCard(biz, String(req.params.id));
    if (!card) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ card });
  }));

  app.patch('/api/leads/:id', asBiz((req, res, biz) => {
    const p = LeadPatch.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const l = leads.update(biz.id, String(req.params.id), {
      stage: p.data.stage, note: orNull(p.data.note), phone: orNull(p.data.phone), name: orNull(p.data.name),
      nextStep: orNull(p.data.nextStep), nextAt: p.data.nextAt,
    });
    if (!l) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ lead: publicLead((p.data.phone ? phoneChanged(biz, l.id) : undefined) ?? l) });
  }));

  // Mijoz so'rasa — karta va unga bog'liq hamma narsa (forget.ts). Yordamchi suhbati ham yangidan: unda mijozning ma'lumoti qolgan bo'lishi mumkin
  app.delete('/api/leads/:id', asBiz((req, res, biz) => {
    if (!forgetLead(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    resetConversation(biz.id);
    console.log(`[mijoz] ${biz.id}: karta egasining buyrug'i bilan o'chirildi`);
    res.json({ ok: true });
  }));

  // Pul yozuvi (DentaCRM): tasdiqlash, bekor qilish, shu kuni ortga qaytarish
  app.post('/api/crm/money/:id/:verb', asBiz(async (req, res, biz) => {
    const id = String(req.params.id);
    const verb = String(req.params.verb);
    try {
      if (verb === 'confirm') await confirmEntry(biz, id);
      else if (verb === 'cancel') cancelEntry(biz, id);
      else if (verb === 'undo') await undoEntry(biz, id);
      else return void res.status(404).json({ error: 'Topilmadi' });
      res.json({ entry: entryView(moneyEntries.get(biz.id, id)!) });
    } catch (e) {
      const row = moneyEntries.get(biz.id, id);
      res.status(409).json({ error: (e as Error).message, entry: row ? entryView(row) : null });
    } finally {
      void bot.refreshMoney(biz.id, id);
    }
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
    const buf = await markdownToDocx(d.title, d.markdown, biz.profile, d.kind);
    const name = docFileName(d.title);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
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

  // ─── Shaxsiy Telegram: kirish qadamlari ────────────────────────────────────
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  app.post('/api/telegram-user/start', asBiz(async (req, res, biz) => {
    try { await loginStart(biz, text(req.body?.phone, 30)); res.json({ ok: true }); } catch (e) { fail(res, e, 400); }
  }));
  app.post('/api/telegram-user/code', asBiz(async (req, res, biz) => {
    try { res.json(await loginCode(biz, text(req.body?.code, 12))); } catch (e) { fail(res, e, 400); }
  }));
  app.post('/api/telegram-user/password', asBiz(async (req, res, biz) => {
    try { res.json(await loginPassword(biz, typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '')); } catch (e) { fail(res, e, 400); }
  }));
  app.delete('/api/telegram-user', asBiz(async (req, res, biz) => {
    await disconnectTelegramUser(biz);
    res.json({ status: statusFor(req, businesses.byId(biz.id)!) });
  }));

  // ─── Instagram: shu kompyuterda oyna ochiladi, egasi o'zi kiradi ───────────
  // Rasmiy Instagram: hub bergan kirish havolasi (egasi brauzerda ochadi) va uzish
  app.post('/api/instagram/official', asBiz(async (_req, res, biz) => {
    try { res.json({ url: await instagramApiConnectUrl(biz) }); } catch (e) { fail(res, e); }
  }));
  app.delete('/api/instagram/official', asBiz(async (req, res, biz) => {
    await disconnectInstagramApi(biz);
    res.json({ status: statusFor(req, businesses.byId(biz.id)!) });
  }));

  app.post('/api/instagram/login', asBiz((req, res, biz) => {
    try { startInstagramLogin(biz); res.json({ status: statusFor(req, biz) }); } catch (e) { fail(res, e, 400); }
  }));
  app.post('/api/instagram/cancel', asBiz((_req, res, biz) => {
    cancelInstagramLogin(biz);
    res.json({ ok: true });
  }));
  app.delete('/api/instagram', asBiz(async (req, res, biz) => {
    await disconnectInstagram(biz);
    res.json({ status: statusFor(req, businesses.byId(biz.id)!) });
  }));

  mountCrm(app, { asBiz, bad, fail, statusOf: (bizId, req) => statusFor(req, businesses.byId(bizId)!) });
  mountCamera(app, { asBiz, bad });
  mountVoice(app, { asBiz, bad });
  mountRequests(app, { asBiz, bad, bot });
  mountPhone(app, { asBiz, asOwner, bad, fail, clientKey });
  mountBrain(app, { asBiz, bad, fail });
  mountOrders(app, { asBiz, bad, fail, bot });
  mountAttention(app, { asBiz });
  mountTeamDay(app, { asBiz });
  mountInsights(app, { asBiz });
  mountSetup(app, { asBiz, asAdmin, bad, fail, bot, statusOf: (bizId, req) => statusFor(req, businesses.byId(bizId)!) });

  // ─── Mijozlarga javob: rejim va yozishmalar ────────────────────────────────
  app.put('/api/business/auto-reply', asBiz((req, res, biz) => {
    const p = AutoReplySchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const profile = { ...biz.profile, autoReply: p.data };
    businesses.update(biz.id, { profile });
    res.json({ business: profile });
  }));

  /** Bir so'rovda ko'rsatiladigan yozishmalar (va alohida — yozishmasiz mijozlar) chegarasi */
  const INBOX_LIMIT = 200;
  app.get('/api/inbox', asBiz((_req, res, biz) => {
    // Yozishmasi borlar to'liq olinadi: ro'yxatga sig'magan eski suhbat «yozishmasi yo'q» bo'lib ko'rinmasin (kutayotgan javobi yashirinib qoladi)
    const everyone = inbox.threads(biz.id, 100_000);
    const active = everyone.slice(0, INBOX_LIMIT);
    const talking: InboxThread[] = active.flatMap(id => {
      const lead = leads.get(biz.id, id);
      return lead ? [{ lead: publicLead(lead), last: inbox.last(biz.id, id) ?? null, pending: replies.countPending(biz.id, id) }] : [];
    });
    // «Mijozlar» bitta ro'yxat: yozishmasi yo'q mijozlar ham (qo'lda qo'shilgan, hali yozmagan) shu yerda, yozishganlardan keyin
    const seen = new Set(everyone);
    const silent: InboxThread[] = leads.list(biz.id, 'all', undefined, 1000).filter(l => !seen.has(l.id)).slice(0, INBOX_LIMIT).map(l => ({ lead: publicLead(l), last: null, pending: 0 }));
    res.json({ threads: [...talking, ...silent], settings: replySettings(biz) });
  }));

  app.get('/api/inbox/:leadId', asBiz((req, res, biz) => {
    const lead = leads.get(biz.id, String(req.params.leadId));
    if (!lead) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ lead: publicLead(lead), messages: inbox.thread(biz.id, lead.id, 100), replies: replies.open(biz.id, lead.id) });
  }));

  app.post('/api/inbox/:leadId/send', asBiz(async (req, res, biz) => {
    const lead = leads.get(biz.id, String(req.params.leadId));
    if (!lead) return res.status(404).json({ error: 'Topilmadi' });
    const t = text(req.body?.text, 4000);
    if (!t) return res.status(400).json({ error: "Xabar bo'sh" });
    try {
      // replyId — egasi shu tayyor javobni «Tahrirlab yozish» orqali o'zgartirib yubordi
      await ownerWrites(biz, lead, t, typeof req.body?.replyId === 'string' ? req.body.replyId.slice(0, 40) : undefined);
      res.json({ messages: inbox.thread(biz.id, lead.id, 100), replies: replies.open(biz.id, lead.id) });
    } catch (e) { fail(res, e); }
  }));

  app.post('/api/replies/:id/send', asBiz(async (req, res, biz) => {
    try { await approveReply(biz, String(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  }));
  app.post('/api/replies/:id/dismiss', asBiz(async (req, res, biz) => {
    try { await dismissReply(biz, String(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
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
        ownerLinked: !!b.ownerChatId,
      })),
    });
  }));

  app.post('/api/admin/businesses', asAdmin((req, res) => {
    const { name, login, password, industry } = req.body ?? {};
    const cleanLogin = typeof login === 'string' ? login.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return res.status(400).json({ error: 'Biznes nomini kiriting' });
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanLogin)) return res.status(400).json({ error: 'Login: 3–32 ta lotin harfi yoki raqam' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return res.status(400).json({ error: `Parol kamida ${MIN_PASSWORD} belgi` });
    if (businesses.byLogin(cleanLogin)) return res.status(409).json({ error: 'Bu login band' });
    const b = businesses.create(cleanLogin, hashPassword(password), emptyBusiness(name.trim(), typeof industry === 'string' ? industry.trim().slice(0, 80) : ''));
    res.json({ id: b.id });
  }));

  app.patch('/api/admin/businesses/:id', asAdmin((req, res) => {
    const biz = businesses.byId(String(req.params.id));
    if (!biz) return res.status(404).json({ error: 'Topilmadi' });
    const { active, password } = req.body ?? {};
    if (typeof password === 'string') {
      if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Parol kamida ${MIN_PASSWORD} belgi` });
      businesses.update(biz.id, { passwordHash: hashPassword(password) });
      // Yangi parol — eski kirishlar (yo'qolgan telefon, begona kompyuter) bekor
      businesses.revokeSessions(biz.id);
    }
    if (typeof active === 'boolean') businesses.update(biz.id, { active });
    res.json({ ok: true });
  }));

  /** AI xarajati: oxirgi kunlar, biznes va kun bo'yicha (so'rovlar soni, tokenlar, taxminiy dollar) */
  app.get('/api/admin/usage', asAdmin((_req, res) => {
    const names = new Map(businesses.all().map(b => [b.id, b.profile.name]));
    const days = new Map<string, { day: string; businessId: string; business: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }>();
    for (const r of aiUsage.since(iso(new Date(Date.now() - (USAGE_DAYS - 1) * 86_400_000)))) {
      const key = `${r.day}|${r.businessId}`;
      const d = days.get(key) ?? { day: r.day, businessId: r.businessId, business: names.get(r.businessId) ?? r.businessId, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      days.set(key, { ...d, calls: d.calls + r.calls, input: d.input + r.input, output: d.output + r.output, cacheRead: d.cacheRead + r.cacheRead, cacheWrite: d.cacheWrite + r.cacheWrite });
    }
    res.json({ model: env.aiModel, usage: [...days.values()].map(d => ({ ...d, usd: Math.round(costUsd(d) * 100) / 100 })) });
  }));

  /** Diagnostika: hub kodi bo'lsa — hubga (sotuvchi oladi); bo'lmasa — matnning o'zi (panel faylga yuklab beradi) */
  app.post('/api/admin/diag', asAdmin(async (_req, res) => {
    try {
      const file = await sendDiagnostics();
      if (file) return res.json({ sent: true, file });
      const d = diagnostics();
      res.json({ sent: false, name: d.name, text: d.text });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  }));

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Topilmadi' }); });

  // Tayyor panel (npm run build) — shu serverning o'zidan
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => { res.sendFile(resolve(dist, 'index.html')); });
  }

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    // Buzuq yoki juda katta so'rov tanasi: xato obyekti ichida tana (parollar bilan) bo'ladi — u logga yozilmaydi
    if (err.type?.startsWith('entity.') || (err.status && err.status >= 400 && err.status < 500)) {
      return res.status(err.status ?? 400).json({ error: "So'rov noto'g'ri" });
    }
    console.error('[http]', err);
    res.status(500).json({ error: 'Serverda xato' });
  });

  return app;
}
