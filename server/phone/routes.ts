/**
 * Panel: MicroSIP holati, ulash va uzish, raqam terish; qo'ng'iroq yozuvini tinglash va qayta tahlil.
 */
import fs from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { loginBlocked, loginFailed, loginOk } from '../auth';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { remoteUrl } from '../remote';
import { staff } from '../requests/store';
import { RECORDINGS_DIR, connectPhone, dialFor, disconnectPhone, phoneStatus, review, stationEvent, stationRecording } from './index';
import { AUDIO_EXT, MIME } from './recordings';
import { saveStationRecording, stations, takeCommands, queueDial, type Station } from './stations';
import { phoneCalls } from './store';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  /** Faqat egasining o'zi (Palantir jamoasi kirishi bilan emas) */
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
  /** Urinishlarni sanash uchun mijoz manzili (hub orqali kelganda — telefonning/kompyuterning haqiqiy manzili) */
  clientKey: (req: Request) => string;
}

/** Boshqa kompyuter ulanishi mumkin bo'lgan manzillar: klinika tarmog'i (server hamma tarmoqda tinglasa) va Palantir Hub */
function stationServers(): { lan: string[]; hub: string | null } {
  const all = !env.listenHost || env.listenHost === '0.0.0.0' || env.listenHost === '::';
  const lan = all ? Object.values(networkInterfaces()).flat().flatMap(i => (i && i.family === 'IPv4' && !i.internal ? [`http://${i.address}:${env.port}`] : [])) : [];
  return { lan, hub: remoteUrl()?.replace(/\/$/, '') ?? null };
}

const EVENTS = ['incoming', 'answer', 'start', 'end', 'outgoing'] as const;
/** Kompyuterdan bitta yozuv (klinika tarmog'idan; hub orqali — hub chegarasi 15 MB) */
const MAX_RECORDING = '60mb';

export function mountPhone(app: Express, { asBiz, asOwner, bad, fail, clientKey }: Deps): void {
  app.get('/api/phone', asBiz(async (_req, res, biz) => res.json({ phone: await phoneStatus(biz) })));

  app.post('/api/phone/connect', asBiz(async (req, res, biz) => {
    try { res.json({ phone: await connectPhone(biz, req.body?.overwrite === true) }); } catch (e) { fail(res, e); }
  }));

  app.post('/api/phone/disconnect', asBiz(async (_req, res, biz) => {
    try { res.json({ phone: await disconnectPhone(biz) }); } catch (e) { fail(res, e); }
  }));

  app.post('/api/phone/dial', asBiz(async (req, res, biz) => {
    const p = z.object({ phone: z.string().trim().min(3).max(40), requestId: z.string().trim().max(20).optional(), stationId: z.string().trim().max(20).optional() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { res.json(await dialFor(biz, p.data.phone, p.data.requestId, { stationId: p.data.stationId })); } catch (e) { fail(res, e); }
  }));

  // ─── Qabulxonadagi boshqa kompyuterlar (stations.ts) ─────────────────────────
  app.get('/api/phone/stations', asBiz((_req, res, biz) => { res.json({ stations: stations.list(biz.id), servers: stationServers() }); }));

  const StationBody = z.object({ name: z.string().trim().min(1).max(60), staffId: z.string().trim().max(20).nullable().optional() });
  const knownStaff = (biz: BusinessRow, id: string | null | undefined) => !id || staff.list(biz.id).some(x => x.id === id);
  // Ulash kodi — faqat egasiga: jamoa kirishi bilan olingan kod stansiya kaliti bo'lib, egasi kirishni yopgandan keyin ham ishlab qolardi
  app.post('/api/phone/stations', asOwner((req, res, biz) => {
    const p = StationBody.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (!knownStaff(biz, p.data.staffId)) return res.status(400).json({ error: "Bunday xodim yo'q" });
    // Kod faqat shu javobda: o'sha kompyuterda Stansiya.cmd ga kiritiladi
    res.json({ ...stations.create(biz.id, p.data.name, p.data.staffId ?? null), servers: stationServers() });
  }));
  app.patch('/api/phone/stations/:id', asBiz((req, res, biz) => {
    const p = z.object({ staffId: z.string().trim().max(20).nullable() }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (!stations.get(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    if (!knownStaff(biz, p.data.staffId)) return res.status(400).json({ error: "Bunday xodim yo'q" });
    stations.setStaff(biz.id, String(req.params.id), p.data.staffId);
    res.json({ station: stations.get(biz.id, String(req.params.id)) });
  }));
  app.delete('/api/phone/stations/:id', asBiz((req, res, biz) => {
    if (!stations.remove(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  }));

  // Kompyuterdagi yordamchi (PalantirCall.exe agent): kod → kalit, keyin «Authorization: Station <kalit>»
  app.post('/api/phone/station/pair', (req, res) => {
    const key = `pair:${clientKey(req)}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    const made = typeof req.body?.code === 'string' ? stations.pair(req.body.code.slice(0, 40)) : null;
    if (!made) {
      loginFailed(key);
      return res.status(401).json({ error: "Kod noto'g'ri yoki eskirgan — panelda yangisini oling" });
    }
    loginOk(key);
    res.json({ token: made.token, station: { id: made.station.id, name: made.station.name } });
  });
  const asStation = (fn: (req: Request, res: Response, st: Station) => unknown): Handler => (req, res) => {
    const st = stations.byToken(req.get('authorization'));
    if (!st) return res.status(401).json({ error: "Kompyuter ulanmagan yoki paneldan olib tashlangan" });
    return fn(req, res, st);
  };
  app.post('/api/phone/station/events', asStation(async (req, res, st) => {
    const p = z.object({ events: z.array(z.object({ event: z.enum(EVENTS), number: z.string().max(64), at: z.string().max(40) })).max(200) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    for (const e of p.data.events) await stationEvent(st, e);
    res.json({ ok: true, accepted: p.data.events.length });
  }));
  app.post('/api/phone/station/recording', express.raw({ type: () => true, limit: MAX_RECORDING }), asStation((req, res, st) => {
    const name = String(req.query.name ?? ''), born = Number(req.query.born), mtime = Number(req.query.mtime);
    if (!AUDIO_EXT.test(name) || !Number.isFinite(born) || !Number.isFinite(mtime) || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'name (wav/mp3/ogg/opus), born, mtime (ms) va fayl kerak' });
    }
    saveStationRecording(st.id, name, born, mtime, req.body);
    stationRecording(st);
    res.json({ ok: true });
  }));
  app.get('/api/phone/station/commands', asStation(async (req, res, st) => {
    const wait = Math.min(25_000, Math.max(0, (Number(req.query.wait) || 0) * 1000));
    const gone = new Promise<void>(done => res.on('close', () => done()));
    const list = await takeCommands(st.id, wait, gone);
    // Kompyuter shu orada uzilgan bo'lsa — buyruq yo'qolmasin
    if (res.destroyed) { for (const c of list) queueDial(st.id, c.number); return; }
    res.json({ commands: list });
  }));

  /** Yozuvni tinglash: faqat shu biznesning qo'ng'irog'i, fayl nomi bazadan (yo'l so'rovdan olinmaydi) */
  app.get('/api/calls/:id/audio', asBiz((req, res, biz) => {
    const c = phoneCalls.get(biz.id, String(req.params.id));
    const file = c?.recording ? path.join(RECORDINGS_DIR, path.basename(c.recording)) : null;
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Yozuv yo\'q' });
    res.setHeader('content-type', MIME[path.extname(file).slice(1)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=3600');
    fs.createReadStream(file).pipe(res);
  }));

  app.post('/api/calls/:id/review', asBiz(async (req, res, biz) => {
    const c = phoneCalls.get(biz.id, String(req.params.id));
    if (!c?.recording) return res.status(404).json({ error: "Yozuv yo'q" });
    await review(biz.id, c.id);
    res.json({ call: phoneCalls.get(biz.id, c.id) });
  }));
}
