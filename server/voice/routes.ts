/**
 * Ovozli agent uchun darvoza: tashqi agent (masalan Aisha) telefon suhbati paytida shu yo'llarni chaqiradi —
 * bo'sh vaqtni so'raydi, qabulga yozadi, suhbat tugagach uning matnini topshiradi. Qabulga yozish qoidalari yozishmadagi bilan bir xil (reception.ts).
 * Agent panel foydalanuvchisi emas: unga faqat shu yo'llarga yaraydigan alohida kalit beriladi (bazada xeshi turadi, panelda qayta yaratiladi).
 * Agentning gapiga ishonilmaydi: chegaralar server o'zi yozgan qabullardan sanaladi, javobda boshqa bemorlar haqida hech narsa chiqmaydi.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { knowledgeText } from '../brain/index';
import { CrmError } from '../crm/dentacrm';
import { normPhone } from '../crm/logic';
import { bookForCustomer, bookingLine, checkBooking, scheduleText } from '../crm/reception';
import { businesses, calls, voiceBookings, voiceKeys, type BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';
import { leadForPhone } from '../people';
import { openRequest } from '../requests/index';
import { newVoiceKey, voiceKeyOwner } from './agentKey';
import { applyLine, lineRouting, lineView, newAdminPassword, routeNow, saveRouting, saveTrunk, transferNow } from './line';
import { adoptVoiceKey } from './serviceEnv';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const HOUR_MS = 3_600_000, DAY_MS = 24 * HOUR_MS;
/** Bitta telefon haftasiga shuncha marta yozila oladi; 10 daqiqada jami shuncha qabul; soatiga shuncha qo'ng'iroq saqlanadi; shundan ko'pi egasiga yozilmaydi */
const PER_PHONE_WEEK = 2, BURST = 6, CALLS_PER_HOUR = 120, NOTIFY_PER_HOUR = 20;
const UNAVAILABLE = "Bu vaqtga yozib bo'lmadi. Boshqa vaqt taklif qiling yoki administratorga uzating.";
const HANDOFF = "Bu so'rovni administrator hal qiladi — qo'ng'iroqni unga uzating.";
const LIMIT = "Hozir qabulga yozib bo'lmaydi — qo'ng'iroqni administratorga uzating.";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * AI telefonda kimning yordamchisi deb tanishadi: biznes (klinika) nomi; nom berilmagan yoki dasturning o'z nomi bo'lsa —
 * egasining ismi («Ulug'bekning AI yordamchisi»)
 */
export function assistantOf(biz: BusinessRow): string {
  const name = biz.profile.name.trim(), owner = biz.profile.ownerName.trim();
  // «Cerebro» — eski nom: eski bazalarda biznes nomi shunday qolgan bo'lishi mumkin
  const generic = !name || /^(cerebro|palantir|mening biznesim)$/i.test(name);
  return generic && owner ? owner : name || 'klinika';
}

function bizOf(req: Request): BusinessRow | null {
  const bizId = voiceKeyOwner(req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  const biz = bizId ? businesses.byId(bizId) : undefined;
  return biz?.active ? biz : null;
}

/** Uzun matn rad etilmaydi, qirqiladi: bitta uzun gap sababli butun qo'ng'iroq yo'qolmasin */
const cut = (max: number) => z.string().transform(s => s.trim().slice(0, max));
const need = (max: number) => cut(max).refine(s => s.length > 0, "bo'sh");
const BookSchema = z.object({ doctorId: need(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), name: need(80), phone: need(24) });
const CallSchema = z.object({
  phone: need(24), name: cut(80).nullable().optional(), startedAt: z.iso.datetime({ offset: true }).optional(), durationSec: z.number().min(0).transform(n => Math.min(7200, Math.round(n))),
  outcome: need(120), booked: cut(120).nullable().optional(),
  transcript: z.array(z.object({ who: z.enum(['ai', 'caller']), text: cut(600) })).max(2000).transform(list => list.filter(l => l.text).slice(0, 200)),
});
const RequestSchema = z.object({
  phone: need(24), name: cut(80).nullable().optional(), kind: z.enum(['callback', 'booking', 'change', 'complaint', 'other']).default('callback'),
  summary: need(400), when: cut(120).nullable().optional(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
});
/** Agent soatiga shuncha so'rov ochadi (adashgan agent qabulxonani to'ldirmasin) */
const REQUESTS_PER_HOUR = 30;
const agentRequests = new Map<string, number[]>();
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Asterisk sozlamasiga tushadi: faqat xavfsiz belgilar (qator uzilishi, izoh va bo'lim belgisi o'tmaydi) */
const SipText = z.string().trim().regex(/^[^\s;[\]]*$/, "bo'shliq va ; [ ] belgilari bo'lmasin");
const TrunkSchema = z.object({
  host: SipText.min(3).max(120).regex(/^[A-Za-z0-9.-]+$/, 'server manzili: sip.uztelecom.uz yoki IP'),
  port: z.number().int().min(1).max(65_535).default(5060),
  login: SipText.min(1).max(64),
  number: z.string().trim().max(20).regex(/^\+?\d*$/, 'raqam: faqat raqamlar'),
  /** Bo'sh — eski parol qoladi */
  password: SipText.max(128).optional(),
});
const RoutingSchema = z.object({
  mode: z.enum(['ai', 'ai_transfer', 'day_admin']), ring: z.number().int().min(5).max(60),
  days: z.array(z.number().int().min(1).max(7)).max(7), from: HHMM, to: HHMM,
});

export function mountVoice(app: Express, { asBiz, bad }: Deps): void {
  const asAgent = (fn: (req: Request, res: Response, biz: BusinessRow) => unknown): Handler => (req, res) => {
    const biz = bizOf(req);
    if (!biz) return res.status(401).json({ error: "Kalit noto'g'ri" });
    return fn(req, res, biz);
  };

  // Panel: qo'ng'iroqlar ro'yxati va agent kaliti
  app.get('/api/calls', asBiz((_req, res, biz) => res.json({ calls: calls.recent(biz.id) })));
  app.get('/api/voice/key', asBiz((_req, res, biz) => res.json({ exists: !!voiceKeys.hash(biz.id) })));
  app.post('/api/voice/key', asBiz((_req, res, biz) => {
    const key = newVoiceKey(biz.id);
    adoptVoiceKey(biz.id, key);
    res.json({ key });
  }));

  // Agent: bo'sh vaqtlar (model o'qiydigan matn)
  // Asterisk har kiruvchi qo'ng'iroqda so'raydi (extensions.conf, [kiruvchi]): «admin:20» — avval administrator telefoni, yoki «ai»
  app.get('/api/voice/route', asAgent((_req, res, biz) => { res.type('text/plain').send(routeNow(lineRouting(biz.id), new Date())); }));
  // AI qabulxona (sip_live.py): hozir administratorga o'tkaza oladimi — ish vaqtida «ai_transfer» rejimida necha soniya jiringlashi, bo'lmasa null
  app.get('/api/voice/handoff', asAgent((_req, res, biz) => { res.json({ ring: transferNow(lineRouting(biz.id), new Date()) }); }));

  // ─── Panel: telefon liniyasi (Sozlamalar → Telefon liniyasi) ───
  app.get('/api/phone/line', asBiz(async (_req, res, biz) => { res.json({ line: await lineView(biz) }); }));
  // Sozlama saqlandi, lekin Asterisk'ka o'rnatib bo'lmadi (WSL yo'q, Asterisk to'xtagan) — egasi sababini ko'radi
  const applied = async (res: Response, biz: BusinessRow) => {
    let warning: string | null = null;
    try { await applyLine(); } catch (e) { warning = (e as Error).message; }
    res.json({ line: await lineView(biz), warning });
  };
  app.put('/api/phone/line/trunk', asBiz(async (req, res, biz) => {
    const p = TrunkSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const { password, ...trunk } = p.data;
    try { saveTrunk(biz, trunk, password || null); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    await applied(res, biz);
  }));
  app.put('/api/phone/line/routing', asBiz(async (req, res, biz) => {
    const p = RoutingSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    saveRouting(biz, p.data);
    res.json({ line: await lineView(biz, false) });
  }));
  app.post('/api/phone/line/admin', asBiz(async (_req, res, biz) => {
    newAdminPassword(biz);
    await applied(res, biz);
  }));

  app.get('/api/voice/slots', asAgent(async (_req, res, biz) => {
    const schedule = await scheduleText(biz.id);
    if (!schedule) return res.status(409).json({ error: HANDOFF, code: 'handoff' });
    res.json({ schedule });
  }));

  // Agent: qabulga yozish
  // Agent: biznes haqida mijozga aytsa bo'ladigan bilim (narxlar, manzil, egasi tasdiqlagan javoblar)
  app.get('/api/voice/knowledge', asAgent((_req, res, biz) => res.json({ knowledge: knowledgeText(biz), who: assistantOf(biz) })));

  app.post('/api/voice/book', asAgent(async (req, res, biz) => {
    const p = BookSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const phone = normPhone(p.data.phone);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const over = voiceBookings.since(biz.id, midnight.toISOString()) >= env.voiceDailyBookings || voiceBookings.since(biz.id, ago(600_000)) >= BURST
      || voiceBookings.since(biz.id, ago(7 * DAY_MS), phone) >= PER_PHONE_WEEK;
    if (over) return res.status(429).json({ error: LIMIT, code: 'limit' });
    try {
      const ask = { ...p.data, doctorName: '' };
      const ready = await checkBooking(biz, ask);
      // Sabab agentga aytilmaydi: unda boshqa bemorning ismi yoki shifokorning shaxsiy izohi bo'lishi mumkin
      if ('problem' in ready) return res.status(409).json({ error: UNAVAILABLE, code: 'unavailable' });
      // Telefon boshqa ism bilan bazada bo'lsa — begona kartaga yozib qo'ymaslik uchun odam hal qiladi
      if (ready.others.length) return res.status(409).json({ error: HANDOFF, code: 'handoff' });
      await bookForCustomer(biz, ask);
      voiceBookings.add(biz.id, phone);
      res.json({ booked: bookingLine({ ...ask, doctorName: ready.doctorName }) });
    } catch (e) {
      if (e instanceof CrmError) return res.status(409).json({ error: UNAVAILABLE, code: 'unavailable' });
      throw e;
    }
  }));

  // Agent: qo'ng'iroq qiluvchi odam bilan gaplashishni so'radi (qayta qo'ng'iroq, surish, shikoyat) — qabulxonaga so'rov
  app.post('/api/voice/requests', asAgent(async (req, res, biz) => {
    const p = RequestSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const recent = (agentRequests.get(biz.id) ?? []).filter(t => t > Date.now() - HOUR_MS);
    if (recent.length >= REQUESTS_PER_HOUR) return res.status(429).json({ error: "Juda ko'p so'rov — keyinroq", code: 'limit' });
    agentRequests.set(biz.id, [...recent, Date.now()]);
    const phone = normPhone(p.data.phone) || p.data.phone;
    const lead = leadForPhone(biz, phone, { name: p.data.name || null, source: "Qo'ng'iroq (ovozli agent)" });
    const { request } = await openRequest(biz, lead.id, { kind: p.data.kind, phone, name: p.data.name || null, summary: p.data.summary, whenText: p.data.when || null, dueAt: p.data.dueAt || null, source: 'voice' });
    res.json({ request: { id: request.id } });
  }));

  // Agent: tugagan qo'ng'iroq
  app.post('/api/voice/calls', asAgent(async (req, res, biz) => {
    const p = CallSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const saved = calls.savedSince(biz.id, ago(HOUR_MS));
    if (saved >= CALLS_PER_HOUR) return res.status(429).json({ error: "Juda ko'p qo'ng'iroq — keyinroq yuboring", code: 'limit' });
    const c = p.data;
    // Agent aytgan vaqt oxirgi sutka ichida bo'lsagina olinadi (kelajakdagi sana ro'yxat boshini egallab olmasin)
    const at = c.startedAt ? Date.parse(c.startedAt) : NaN;
    const startedAt = at <= Date.now() && at >= Date.now() - DAY_MS ? new Date(at).toISOString() : new Date().toISOString();
    const call = calls.create(biz.id, { phone: c.phone, name: c.name || null, startedAt, durationSec: c.durationSec, outcome: c.outcome, transcript: c.transcript, booked: c.booked || null });
    if (saved < NOTIFY_PER_HOUR) await notifyOwner(biz, `📞 <b>${esc(call.name ?? call.phone)}</b> — ${esc(call.outcome)}${call.booked ? `\n📅 ${esc(call.booked)}` : ''}`).catch(() => null);
    res.json({ call: { id: call.id } });
  }));
}
