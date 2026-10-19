/**
 * Topshiriqlar va xodim jurnali — panel yo'llari. Topshiriq ikki qadamda: egasining gapi → AI tushunchasi (saqlanmaydi, egasi ko'radi)
 * → saqlash. Saqlanadigan tuzilma qayta tekshiriladi (kamera va zona shu biznesniki, vaqtlar to'g'ri). Kameraga savol va kamera tavsifi ham shu yerda.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { OrderMember } from '../../src/types';
import { AiLimitError } from '../claude';
import type { BotService } from '../bot';
import { cameras, type BusinessRow } from '../db';
import { resetConversation } from '../agent';
import { cameraFrame } from '../camera/routes';
import { askFrame } from './look';
import { MIN_LOOK_EVERY, conditionHolds, countIn, inWindow } from './logic';
import { parseOrder } from './parse';
import { runLook, runScheduled } from './run';
import { EVENTS_PAGE, MAX_ORDERS, events, orders } from './store';
import { forgetWatchCache, frameState } from './watch';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
  bot: BotService;
}

const MEMBERS = ['qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi'] as const;
const Member = z.enum(MEMBERS);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Days = z.array(z.number().int().min(1).max(7)).max(7);
const Id = z.string().max(20);
const SpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('standing') }),
  z.object({ kind: z.literal('schedule'), at: HHMM, days: Days }),
  z.object({
    kind: z.literal('watch'), cameraId: Id.nullable(), zoneId: Id.nullable(), condition: z.enum(['crowd', 'linger', 'empty', 'presence']),
    people: z.number().int().min(1).max(40), minutes: z.number().int().min(0).max(1440), from: HHMM.nullable(), to: HHMM.nullable(),
  }),
  z.object({
    kind: z.literal('look'), cameraId: Id.nullable(), at: HHMM.nullable(), days: Days, everyMin: z.number().int().min(0).max(1440),
    from: HHMM.nullable(), to: HHMM.nullable(), question: z.string().trim().min(3).max(400),
  }),
]);
const Text = z.string().trim().min(3).max(600);
const ParseSchema = z.object({ member: Member, text: Text });
const CreateSchema = z.object({ member: Member, text: Text, spec: SpecSchema, summary: z.string().trim().min(3).max(300) });
const AskSchema = z.object({ question: z.string().trim().min(2).max(400), cameraId: Id.optional() });
const ProfileSchema = z.object({ profile: z.string().trim().max(600) });

export function mountOrders(app: Express, { asBiz, bad, fail, bot }: Deps): void {
  const aiError = (res: Response, e: unknown) => (e instanceof AiLimitError ? res.status(429).json({ error: "Bugungi AI chegarasi tugadi — ertaga yana ishlaydi." }) : fail(res, e, 502));
  /** Topshiriq o'zgardi: kamera qoidalari darhol yangisini ko'rsin, suhbat esa yangi ko'rsatma bilan boshlansin */
  const changed = (bizId: string, orderId?: string) => { forgetWatchCache(orderId); resetConversation(bizId); };

  app.get('/api/orders', asBiz((req, res, biz) => {
    const m = Member.safeParse(req.query.member);
    res.json({ orders: orders.list(biz.id, m.success ? m.data : undefined) });
  }));

  app.post('/api/orders/parse', asBiz(async (req, res, biz) => {
    const p = ParseSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { res.json({ parsed: await parseOrder(biz, p.data.member, p.data.text, cameras.list(biz.id)) }); } catch (e) { aiError(res, e); }
  }));

  app.post('/api/orders', asBiz((req, res, biz) => {
    const p = CreateSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const { member, text, spec, summary } = p.data;
    if (orders.count(biz.id, member) >= MAX_ORDERS) return res.status(400).json({ error: `Bitta xodimga ${MAX_ORDERS} tadan ko'p topshiriq berilmaydi` });
    const camOnly = spec.kind === 'watch' || spec.kind === 'look';
    if (camOnly && member !== 'kuzatuvchi') return res.status(400).json({ error: 'Kamera topshirig\'i faqat Kuzatuvchiga' });
    if (camOnly && spec.cameraId) {
      const cam = cameras.get(biz.id, spec.cameraId);
      if (!cam) return res.status(400).json({ error: 'Kamera topilmadi' });
      if (spec.kind === 'watch' && spec.zoneId && !cam.zones.some(z => z.id === spec.zoneId)) return res.status(400).json({ error: 'Zona topilmadi' });
    }
    if (spec.kind === 'look' && !spec.at && spec.everyMin < MIN_LOOK_EVERY) return res.status(400).json({ error: `AI ko'zi ${MIN_LOOK_EVERY} daqiqadan tez-tez qaramaydi` });
    const order = orders.create(biz.id, member as OrderMember, text, spec, summary);
    changed(biz.id);
    res.json({ order });
  }));

  app.patch('/api/orders/:id', asBiz((req, res, biz) => {
    const p = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (!orders.setActive(biz.id, String(req.params.id), p.data.active)) return res.status(404).json({ error: 'Topilmadi' });
    changed(biz.id, String(req.params.id));
    res.json({ order: orders.get(biz.id, String(req.params.id)) });
  }));

  app.delete('/api/orders/:id', asBiz((req, res, biz) => {
    if (!orders.remove(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    changed(biz.id, String(req.params.id));
    res.json({ ok: true });
  }));

  // Sinab ko'rish: jadvaldagi ish va AI ko'zi — hozir bajariladi; kamera qoidasi — hozirgi kadrda shart bajarilyaptimi
  app.post('/api/orders/:id/run', asBiz(async (req, res, biz) => {
    const o = orders.get(biz.id, String(req.params.id));
    if (!o) return res.status(404).json({ error: 'Topilmadi' });
    try {
      if (o.spec.kind === 'schedule') return res.json({ result: await runScheduled(bot, biz, o) });
      if (o.spec.kind === 'look') return res.json({ result: await runLook(biz, o, false) });
      if (o.spec.kind === 'standing') return res.json({ result: "Doimiy ko'rsatma — xodim har ishida shunga amal qiladi." });
      const spec = o.spec;
      const now = new Date();
      const lines = cameras.list(biz.id).filter(c => !spec.cameraId || c.id === spec.cameraId).map(c => {
        const f = frameState(c.id);
        if (!f || now.getTime() - f.at > 60_000) return `${c.name}: hozir kadr kelmayapti`;
        const n = countIn(c, spec.zoneId, f.people);
        const ok = inWindow(spec.from, spec.to, now) && conditionHolds(spec.condition, n, spec.people);
        return `${c.name}: hozir ${n} kishi — ${ok ? `shart bajarilyapti${spec.minutes ? `, ${spec.minutes} daqiqa davom etsa xabar beraman` : ', xabar beraman'}` : inWindow(spec.from, spec.to, now) ? 'shart bajarilmayapti' : `hozir kuzatuv vaqti emas (${spec.from}–${spec.to})`}`;
      });
      res.json({ result: lines.join('\n') || "Kamera yo'q" });
    } catch (e) { aiError(res, e); }
  }));

  app.get('/api/agents/:member/events', asBiz((req, res, biz) => {
    const m = Member.safeParse(req.params.member);
    if (!m.success) return bad(res, m.error);
    const camera = typeof req.query.camera === 'string' ? req.query.camera.slice(0, 20) : undefined;
    const before = typeof req.query.before === 'string' ? req.query.before.slice(0, 30) : undefined;
    res.json({ events: events.list(biz.id, m.data, { cameraId: camera, before }), page: EVENTS_PAGE });
  }));

  app.get('/api/agents/events/:id/image', asBiz((req, res, biz) => {
    const image = events.image(biz.id, String(req.params.id));
    if (!image) return res.status(404).json({ error: "Kadr yo'q" });
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.end(image);
  }));

  // Kameraga savol: IP kameradan kadr → AI ko'zi javobi (brauzer kamerasining kadri serverda yo'q)
  app.post('/api/cameras/ask', asBiz(async (req, res, biz) => {
    const p = AskSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const list = cameras.list(biz.id).filter(c => !p.data.cameraId || c.id === p.data.cameraId);
    if (!list.length) return res.status(404).json({ error: 'Kamera topilmadi' });
    try {
      const answers = [];
      for (const cam of list.slice(0, 4)) {
        const frame = await cameraFrame(biz.id, cam.id);
        answers.push({ cameraId: cam.id, name: cam.name, answer: frame ? await askFrame(biz.id, cam, p.data.question, frame) : 'Kadr olinmadi — kamera ulanmagan yoki javob bermayapti.' });
      }
      res.json({ answers });
    } catch (e) { aiError(res, e); }
  }));

  // Hozir har kamerada nechta odam (oxirgi daqiqadagi kadr bo'yicha)
  app.get('/api/cameras/live', asBiz((_req, res, biz) => {
    const now = Date.now();
    const live: Record<string, { at: string; people: number }> = {};
    for (const c of cameras.list(biz.id)) {
      const f = frameState(c.id);
      if (f && now - f.at < 60_000) live[c.id] = { at: new Date(f.at).toISOString(), people: f.people.length };
    }
    res.json({ live });
  }));

  app.put('/api/cameras/:id/profile', asBiz((req, res, biz) => {
    const p = ProfileSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const cam = cameras.get(biz.id, String(req.params.id));
    if (!cam) return res.status(404).json({ error: 'Kamera topilmadi' });
    cameras.setProfile(biz.id, cam.id, p.data.profile || null);
    res.json({ camera: cameras.get(biz.id, cam.id) });
  }));
}
