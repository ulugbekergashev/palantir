/**
 * Panel: so'rovlar navbati (ochiq — eng eskisi birinchi), qo'lda so'rov ochish va yopish, qabulxona xodimlari (Telegram havolasi bilan).
 * Paneldan yopilgan so'rov Telegram'dagi kartalarda ham yopiladi.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { BotService } from '../bot';
import { businesses, leads, publicLead, type BusinessRow } from '../db';
import { RequestError, addResult, closeRequest, noAnswer, openRequest } from './index';
import { requests, staff, type StaffRow } from './store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  bot: BotService;
}

const KIND = z.enum(['callback', 'booking', 'change', 'complaint', 'other']);
const NewRequest = z.object({
  kind: KIND,
  leadId: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().max(80).optional(),
  summary: z.string().trim().min(1).max(500),
  whenText: z.string().trim().max(120).optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
}).refine(v => v.leadId || v.phone, { message: 'Mijoz yoki telefon kerak' });
const Verb = z.enum(['done', 'cancel', 'no-answer', 'note']);
const MAX_STAFF = 20;

export function mountRequests(app: Express, { asBiz, bad, bot }: Deps): void {
  const by = (biz: BusinessRow) => biz.profile.ownerName ? `${biz.profile.ownerName} (panel)` : 'Panel';
  const withLead = (biz: BusinessRow) => (r: ReturnType<typeof requests.list>[number]) => {
    const lead = r.leadId ? leads.get(biz.id, r.leadId) : undefined;
    return { ...r, lead: lead ? publicLead(lead) : null };
  };

  app.get('/api/requests', asBiz((req, res, biz) => {
    const which = req.query.which === 'closed' ? 'closed' : req.query.which === 'all' ? 'all' : 'open';
    res.json({ requests: requests.list(biz.id, which, 300).map(withLead(biz)), open: requests.openCount(biz.id) });
  }));

  app.post('/api/requests', asBiz(async (req, res, biz) => {
    const p = NewRequest.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const v = p.data;
    if (v.leadId && !leads.get(biz.id, v.leadId)) return res.status(404).json({ error: 'Mijoz topilmadi' });
    const { request } = await openRequest(biz, v.leadId ?? null, { ...v, source: 'panel' });
    res.json({ request: withLead(biz)(request) });
  }));

  app.post('/api/requests/:id/:verb', asBiz(async (req, res, biz) => {
    const verb = Verb.safeParse(req.params.verb);
    if (!verb.success) return res.status(404).json({ error: 'Topilmadi' });
    const id = String(req.params.id);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    try {
      const r = verb.data === 'done' ? await closeRequest(biz, id, 'done', by(biz), text || null)
        : verb.data === 'cancel' ? await closeRequest(biz, id, 'cancelled', by(biz), text || null)
        : verb.data === 'no-answer' ? await noAnswer(biz, id, by(biz))
        : text ? await addResult(biz, id, text, by(biz)) : null;
      if (!r) return res.status(400).json({ error: 'Matn kerak' });
      res.json({ request: withLead(biz)(r) });
    } catch (e) {
      if (e instanceof RequestError) return res.status(409).json({ error: e.message });
      throw e;
    }
  }));

  // ─── Qabulxona xodimlari ───────────────────────────────────────────────────
  const view = (s: StaffRow) => {
    const name = bot.username();
    return { id: s.id, name: s.name, role: s.role, linked: s.linked, createdAt: s.createdAt, link: !s.linked && name ? `https://t.me/${name}?start=s-${s.linkCode}` : null };
  };
  const team = (biz: BusinessRow) => ({ staff: staff.list(biz.id).map(view), copyToOwner: (businesses.byId(biz.id) ?? biz).profile.requestsCopy !== false, bot: !!bot.username() });

  app.get('/api/staff', asBiz((_req, res, biz) => res.json(team(biz))));

  app.post('/api/staff', asBiz((req, res, biz) => {
    const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (staff.list(biz.id).length >= MAX_STAFF) return res.status(409).json({ error: `Ko'pi bilan ${MAX_STAFF} ta xodim` });
    staff.create(biz.id, p.data.name);
    res.json(team(biz));
  }));

  app.delete('/api/staff/:id', asBiz((req, res, biz) => {
    staff.remove(biz.id, String(req.params.id));
    res.json(team(biz));
  }));

  /** Xodimlar ulangan bo'lsa ham so'rovlar nusxasi egasiga kelsinmi */
  app.put('/api/staff/copy', asBiz((req, res, biz) => {
    const p = z.object({ copyToOwner: z.boolean() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const fresh = businesses.byId(biz.id) ?? biz;
    businesses.update(biz.id, { profile: { ...fresh.profile, requestsCopy: p.data.copyToOwner } });
    res.json(team(biz));
  }));
}
