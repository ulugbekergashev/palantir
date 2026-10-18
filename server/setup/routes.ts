/**
 * Ulash ustasi yo'llari.
 *   Admin: server kalitlari (tekshirib saqlash), biznes kabinetiga kirish, anketalar (o'rnatuvchining serverida yaratiladi).
 *   Ochiq: anketa formasi (kod bilan; parol yo'q — kod o'zi kalit, urinishlar soni cheklangan).
 *   Kabinet: anketani yuklash (kod yoki fayl), bo'shliqlar ro'yxati, egasidan Telegram'da so'rash.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { LiveStatus } from '../../src/types';
import { ANKETA_CODE, cleanCode } from '../../src/lib/anketa';
import { isKeyName } from '../../src/lib/secrets';
import { issueToken, loginBlocked, loginFailed } from '../auth';
import type { BotService } from '../bot';
import { packOf } from '../brain/index';
import { packView } from '../brain/logic';
import { vault } from '../brain/vault';
import { anketas, businesses, type BusinessRow } from '../db';
import { keyList, removeKey, setKey } from '../keys';
import { anketaData, anketaView, applyAnketa, createAnketa, fetchAnketa, liveAnketa, parseAnketa } from './anketa';
import { gapsOf } from './gaps';
import { setupOf } from './state';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  asAdmin: (fn: Handler) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
  bot: BotService;
  statusOf: (bizId: string) => LiveStatus;
}

const KeyBody = z.object({ value: z.string().max(400), force: z.boolean().optional() });
const NewAnketa = z.object({ label: z.string().trim().min(1).max(60), industry: z.string().trim().max(80).default('stomatologiya') });
const SaveAnketa = z.object({ data: z.unknown(), submit: z.boolean().optional() });
const ImportAnketa = z.union([
  z.object({ code: z.string().trim().min(8).max(12), source: z.string().trim().min(8).max(300) }),
  z.object({ data: z.unknown() }),
]);
/** Kabinetga kirish (ulash ustasi admin nomidan): qisqa muddatli token */
const SESSION_DAYS = 1;
/** Bitta anketa bir soatda shuncha marta saqlanadi (egasi har maydondan keyin saqlaydi; undan ko'pi — suiiste'mol) */
const MAX_SAVES_PER_HOUR = 300;
const saves = new Map<string, { hour: number; count: number }>();
const saveAllowed = (code: string): boolean => {
  const hour = Math.floor(Date.now() / 3_600_000);
  const s = saves.get(code);
  const count = s?.hour === hour ? s.count + 1 : 1;
  if (saves.size > 5000) saves.clear();
  saves.set(code, { hour, count });
  return count <= MAX_SAVES_PER_HOUR;
};

export function mountSetup(app: Express, { asBiz, asAdmin, bad, fail, bot, statusOf }: Deps): void {
  // ─── Admin: server kalitlari ────────────────────────────────────────────────
  app.get('/api/admin/keys', asAdmin((_req, res) => res.json({ keys: keyList() })));

  app.put('/api/admin/keys/:name', asAdmin(async (req, res) => {
    const name = String(req.params.name);
    if (!isKeyName(name)) return res.status(404).json({ error: 'Bunday kalit yo\'q' });
    const p = KeyBody.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const r = await setKey(name, p.data.value, p.data.force);
    if (!r.ok) return res.status(400).json({ error: r.error, canForce: r.canForce });
    res.json({ key: r.key, check: r.check });
  }));

  app.delete('/api/admin/keys/:name', asAdmin(async (req, res) => {
    const name = String(req.params.name);
    if (!isKeyName(name)) return res.status(404).json({ error: 'Bunday kalit yo\'q' });
    res.json({ key: await removeKey(name) });
  }));

  /** Ulash ustasi biznes kabineti nomidan ishlaydi (CRM, kameralar, Telegram): admin parolini bilgan kabinetga ham kira oladi */
  app.post('/api/admin/businesses/:id/session', asAdmin((req, res) => {
    const biz = businesses.byId(String(req.params.id));
    if (!biz || !biz.active) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ token: issueToken(biz.id, 'business', SESSION_DAYS) });
  }));

  // ─── Admin: anketalar ───────────────────────────────────────────────────────
  app.get('/api/admin/anketa', asAdmin((_req, res) => {
    anketas.expire();
    res.json({ anketas: anketas.list().map(anketaView) });
  }));

  app.post('/api/admin/anketa', asAdmin((req, res) => {
    const p = NewAnketa.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    res.json({ anketa: anketaView(createAnketa(p.data.label, p.data.industry)) });
  }));

  app.delete('/api/admin/anketa/:code', asAdmin((req, res) => {
    anketas.remove(cleanCode(String(req.params.code)));
    res.json({ ok: true });
  }));

  // ─── Ochiq: anketa formasi ──────────────────────────────────────────────────
  /** Kodni topish: noto'g'ri kodlar sanaladi (kodni terib topishga qarshi) */
  const found = (req: Request, res: Response) => {
    const key = `ank:${req.ip}`;
    if (loginBlocked(key)) { res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" }); return undefined; }
    const code = cleanCode(String(req.params.code));
    const row = ANKETA_CODE.test(code) ? liveAnketa(code) : undefined;
    if (!row) { loginFailed(key); res.status(404).json({ error: "Anketa topilmadi yoki muddati o'tgan" }); return undefined; }
    return row;
  };

  app.get('/api/anketa/:code', (req, res) => {
    const row = found(req, res);
    if (!row) return;
    res.setHeader('cache-control', 'no-store');
    res.json({ anketa: { ...anketaView(row), data: anketaData(row) } });
  });

  app.put('/api/anketa/:code', (req, res) => {
    const row = found(req, res);
    if (!row) return;
    if (!saveAllowed(row.code)) return res.status(429).json({ error: "Juda ko'p saqlandi — birozdan keyin urining" });
    const p = SaveAnketa.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const parsed = parseAnketa(p.data.data);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const status = p.data.submit || row.status === 'done' ? 'done' : 'draft';
    anketas.save(row.code, JSON.stringify(parsed.data), status);
    res.json({ anketa: anketaView(liveAnketa(row.code)!) });
  });

  // ─── Kabinet: o'rnatish ─────────────────────────────────────────────────────
  const setupView = (biz: BusinessRow) => {
    const fresh = businesses.byId(biz.id) ?? biz;
    const s = setupOf(fresh);
    const pack = packView(packOf(fresh), vault.list(biz.id, 'qa').filter(k => k.status === 'active'));
    return {
      has: s.has, anketa: s.anketa,
      gaps: gapsOf(fresh),
      pack: { answered: pack.filter(q => q.answer).length, total: pack.length },
      prices: fresh.profile.offerings.length,
      status: statusOf(biz.id),
    };
  };

  app.get('/api/setup', asBiz((_req, res, biz) => res.json({ setup: setupView(biz) })));

  app.post('/api/setup/anketa', asBiz(async (req, res, biz) => {
    const p = ImportAnketa.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    let data;
    let code: string | null = null;
    if ('code' in p.data) {
      code = cleanCode(p.data.code);
      if (!ANKETA_CODE.test(code)) return res.status(400).json({ error: "Kod ko'rinishi: ABCD-EFGH" });
      try { data = await fetchAnketa(p.data.source, code); } catch (e) { return fail(res, e, 400); }
    } else {
      const parsed = parseAnketa(p.data.data);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      data = parsed.data;
    }
    const result = applyAnketa(biz, data, code);
    res.json({ result, setup: setupView(biz) });
  }));

  /** Egasining Telegram'ida birinchi kun suhbati: bo'shliqlar, keyin tayyor savollar */
  app.post('/api/setup/ask', asBiz(async (_req, res, biz) => {
    if (!bot.enabled) return res.status(409).json({ error: 'Telegram bot ulanmagan — avval bot tokenini kiriting' });
    try { await bot.startInterview(biz); } catch (e) { return fail(res, e); }
    res.json({ setup: setupView(biz) });
  }));
}
