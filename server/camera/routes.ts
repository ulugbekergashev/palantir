/**
 * Kameralar: ro'yxat, zonalar, kuzatuv va kunlik hisob.
 * Kuzatuv (observe) — odam topuvchi dvigatelning chiqishi: "shu kadrda odamlar mana bu joylarda". Dvigatel qayerda ishlashidan qat'i nazar
 * (IP kamera — shu serverdagi dvigatel, stream.ts; shu kompyuter kamerasi — brauzerda) seanslar bitta joyda sanaladi.
 * Shart: dvigatel kamida har 5 soniyada bitta kadr natijasini yuboradi — siyrakroq kelsa, zonaga kirish payqalmaydi (sessions.ts).
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { Camera, CameraFinding, CameraSession, CameraSummary, CameraZone } from '../../src/types';
import { iso } from '../../src/lib/week';
import { crmConnected, withCrm } from '../crm/index';
import { businesses, cameraSessions, cameras, newId, type BusinessRow } from '../db';
import { env } from '../env';
import { open, seal } from '../secret';
import { feedOf, ffmpegAvailable, parseStream, snapshot, startCameraEngine, syncEngine } from './stream';
import { candidatePaths, discoverCameras, onvifStreamUri, withCredentials } from './discover';
import { loginBlocked, loginFailed, loginOk } from '../auth';
import { findings, reconcile, type Sitting } from './reconcile';
import { flush, step, type States, type ZoneEvent } from './sessions';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const MAX_CAMERAS = 16, MAX_ZONES = 8, MAX_PEOPLE = 40;
const unit = z.number().min(0).max(1);
const BoxSchema = z.object({ x: unit, y: unit, w: unit.gt(0), h: unit.gt(0) }).refine(b => b.x + b.w <= 1.001 && b.y + b.h <= 1.001, 'kadrdan tashqarida');
const ZonesSchema = z.object({
  zones: z.array(BoxSchema.and(z.object({
    id: z.string().max(16).optional(), kind: z.enum(['chair', 'desk']), name: z.string().trim().min(1).max(40), doctorId: z.string().trim().max(60).nullable().optional(),
  }))).max(MAX_ZONES),
});
const ObserveSchema = z.object({ people: z.array(BoxSchema).max(MAX_PEOPLE) });
/**
 * Faqat mahalliy tarmoq manzili (kamera klinikaning o'zida) — server boshqa joyga so'rov yubormasin.
 * Shu kompyuterning o'zi (127.x) — yo'q: kamera nomi bilan o'z xizmatlarini paypaslab bo'lmasin (soxta kamera bilan sinovdan tashqari)
 */
const LOCAL_IP = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
const LOOPBACK_IP = /^127\.0\.0\.1$/;
const localIp = (ip: string): boolean => LOCAL_IP.test(ip) || (!!(env.cameraProbeTargets || env.cameraScanHosts) && LOOPBACK_IP.test(ip));
const ConnectSchema = z.object({
  ip: z.string().refine(localIp, 'mahalliy tarmoq manzili emas'),
  port: z.number().int().min(1).max(65_535).default(554),
  brand: z.string().trim().max(40).default(''),
  onvif: z.string().max(300).nullable().optional(),
  login: z.string().max(64),
  password: z.string().max(128),
  name: z.string().trim().min(1).max(40),
});
/** Bitta ulanishda shuncha manzil sinab ko'riladi, har biri shuncha kutiladi (so'rov uzoq osilib qolmasin) */
const MAX_TRIES = 8, TRY_TIMEOUT_MS = 8_000;
let discovering = false;
/** Kamera o'z manzilini boshqa IP bilan bersa (tashqi tarmoq uchun sozlangan) — biz topgan IP qo'yiladi */
const onHost = (rtsp: string, ip: string): string => { const u = new URL(rtsp); u.hostname = ip; return u.href; };
const hostsOf = (list: string) => list.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [host, port] = s.split(':'); return { host, port: Number(port) }; });
const discoveryOptions = () => ({
  ...(env.cameraProbeTargets ? { probeTargets: hostsOf(env.cameraProbeTargets), waitMs: 800 } : {}),
  ...(env.cameraScanHosts || env.cameraProbeTargets ? { scanHosts: hostsOf(env.cameraScanHosts) } : {}),
});
/** Taqvimda bor sana (2026-13-99 kabi yozuv o'tmaydi) */
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d)) === s; }, "taqvimda bunday sana yo'q");

/** Har kameraning zonalari holati (xotirada): server qayta tushsa, ochiq seanslar closeDangling bilan yopiladi */
const live = new Map<string, States>();
const thresholds = () => ({ enterMs: env.cameraEnterSec * 1000, leaveMs: env.cameraLeaveSec * 1000 });
const isoAt = (ms: number) => new Date(ms).toISOString();
const minuteOf = (isoTime: string) => { const d = new Date(isoTime); return d.getHours() * 60 + d.getMinutes(); };

function apply(biz: BusinessRow, cam: Camera, events: ZoneEvent[]): void {
  for (const e of events) {
    const zone = cam.zones.find(z => z.id === e.zoneId);
    if (e.type === 'end') cameraSessions.close(biz.id, cam.id, e.zoneId, isoAt(e.at));
    else if (zone) cameraSessions.open(biz.id, cam.id, zone, isoAt(e.at));
  }
}

/** Kadr natijasini qo'llaydi: seanslarni ochadi/yopadi, zonalarning hozirgi holatini qaytaradi */
export function observe(biz: BusinessRow, cam: Camera, people: { x: number; y: number; w: number; h: number }[], now = Date.now()): Record<string, 'empty' | 'entering' | 'open'> {
  const t = thresholds();
  const r = step(live.get(cam.id) ?? {}, cam.zones, people, now, t);
  live.set(cam.id, r.states);
  apply(biz, cam, r.events);
  // Kadrlar uzoq uzilgan bo'lsa, kamera "yangidan ko'ra boshladi": o'sha oraliqdagi qabullar haqida hukm chiqarilmaydi
  const silent = !cam.lastSeenAt || !cam.seenFrom || now - Date.parse(cam.lastSeenAt) > 2 * t.leaveMs;
  cameras.seen(biz.id, cam.id, isoAt(now), silent ? isoAt(now) : cam.seenFrom!);
  return Object.fromEntries(cam.zones.map(z => { const s = r.states[z.id]; return [z.id, s?.open ? 'open' : s?.since != null ? 'entering' : 'empty']; }));
}

/** Berilgan zonalarning (yoki hammasining) ochiq seanslarini oxirgi ko'rilgan paytda yopadi va holatini unutadi */
function reset(biz: BusinessRow, cam: Camera, zoneIds?: ReadonlySet<string>): void {
  const states = live.get(cam.id) ?? {};
  const drop = (id: string) => !zoneIds || zoneIds.has(id);
  apply(biz, cam, flush(Object.fromEntries(Object.entries(states).filter(([id]) => drop(id)))));
  const kept = Object.fromEntries(Object.entries(states).filter(([id]) => !drop(id)));
  if (Object.keys(kept).length) live.set(cam.id, kept); else live.delete(cam.id);
}

/** Kadr kelmay qolgan kameralar: odam hali "o'tirgan" bo'lib qolmasin */
function sweep(biz: BusinessRow, now = Date.now()): Camera[] {
  const list = cameras.list(biz.id);
  for (const cam of list) if (live.has(cam.id) && (!cam.lastSeenAt || now - Date.parse(cam.lastSeenAt) > thresholds().leaveMs)) reset(biz, cam);
  return list;
}

/** Bir kunning hisobi: kamera ko'rgani va (ulangan bo'lsa) DentaCRM bilan farqlar */
export async function daySummary(biz: BusinessRow, date: string, now = new Date()): Promise<CameraSummary> {
  const cams = sweep(biz, now.getTime());
  const [y, m, d] = date.split('-').map(Number);
  const sessions = cameraSessions.between(biz.id, new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString());
  const long = (s: CameraSession) => (s.endedAt ? Date.parse(s.endedAt) : now.getTime()) - Date.parse(s.startedAt) >= env.cameraMinSessionSec * 1000;
  const chairs = sessions.filter(s => s.kind === 'chair' && long(s));
  const base = { date, seated: chairs.length, deskVisits: sessions.filter(s => s.kind === 'desk').length, sessions };
  if (!crmConnected(biz.id)) return { ...base, crm: null, findings: [] };
  const zones = cams.flatMap(c => c.zones);
  const sittings: Sitting[] = chairs.map(s => ({ id: s.id, doctorId: zones.find(z => z.id === s.zoneId)?.doctorId ?? null, label: s.zoneName, startMin: minuteOf(s.startedAt), endMin: s.endedAt ? minuteOf(s.endedAt) : null }));
  // Kamera shu kuni uzluksiz ishlab turgan oraliq — faqat shu oraliqdagi qabullar haqida "ko'rinmadi" deyiladi
  const coverage = new Map<string, { fromMin: number; toMin: number }>();
  for (const c of cams) {
    if (!c.seenFrom || !c.lastSeenAt || iso(new Date(c.seenFrom)) !== date || iso(new Date(c.lastSeenAt)) !== date) continue;
    for (const z of c.zones) if (z.kind === 'chair' && z.doctorId) coverage.set(z.doctorId, { fromMin: minuteOf(c.seenFrom), toMin: minuteOf(c.lastSeenAt) });
  }
  try {
    const crm = await withCrm(biz.id, c => c.day(date));
    const nowMin = date < iso(now) ? 24 * 60 : date > iso(now) ? 0 : now.getHours() * 60 + now.getMinutes();
    return {
      ...base, findings: findings(reconcile(sittings, crm.appointments, nowMin, coverage)),
      crm: { visits: crm.appointments.filter(a => a.status === 'Completed' || a.status === 'Checked-In').length, payments: crm.transactions.filter(t => t.status === 'Paid' && t.type !== 'Balance').length },
    };
  } catch (e) {
    console.error('[kamera] DentaCRM bilan solishtirish:', (e as Error).message);
    const problem: CameraFinding = { level: 'warn', text: "DentaCRM javob bermadi — hozircha solishtirib bo'lmadi." };
    return { ...base, crm: null, findings: [problem] };
  }
}

/** Panelga: kamera va (IP kamera bo'lsa) kadr olish holati */
const view = (cam: Camera): Camera => ({ ...cam, feed: feedOf(cam.id, !!cam.ip) });
/** Bitta kadr bir necha soniya eslab qolinadi: sahifa qayta-qayta so'rasa kameraga har safar yangi ulanish ochilmasin */
const SNAPSHOT_KEEP_MS = 5_000;
const shots = new Map<string, { at: number; image: Promise<Buffer> }>();
function shot(cameraId: string, url: string): Promise<Buffer> {
  const had = shots.get(cameraId);
  if (had && Date.now() - had.at < SNAPSHOT_KEEP_MS) return had.image;
  const image = snapshot(url);
  shots.set(cameraId, { at: Date.now(), image });
  image.catch(() => { if (shots.get(cameraId)?.image === image) shots.delete(cameraId); });
  return image;
}

const sameBox = (a: CameraZone, b: { kind: string; x: number; y: number; w: number; h: number }) => a.kind === b.kind && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function mountCamera(app: Express, { asBiz, bad }: Deps): void {
  cameraSessions.closeDangling();
  // IP kameralar: dvigatel topgan odamlar brauzerdan kelgan kuzatuv bilan bir xil yo'ldan o'tadi
  startCameraEngine((businessId, cameraId, people) => {
    const biz = businesses.byId(businessId), cam = cameras.get(businessId, cameraId);
    if (biz?.active && cam) observe(biz, cam, people);
  });
  const found = (res: Response, biz: BusinessRow, id: string | string[] | undefined): Camera | null => {
    const cam = cameras.get(biz.id, String(id));
    if (!cam) res.status(404).json({ error: 'Kamera topilmadi' });
    return cam ?? null;
  };

  app.get('/api/cameras', asBiz((_req, res, biz) => res.json({
    cameras: sweep(biz).map(view), timing: { enterSec: env.cameraEnterSec, leaveSec: env.cameraLeaveSec, minSessionSec: env.cameraMinSessionSec },
  })));

  app.post('/api/cameras', asBiz((req, res, biz) => {
    const p = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (cameras.list(biz.id).length >= MAX_CAMERAS) return res.status(409).json({ error: `Ko'pi bilan ${MAX_CAMERAS} ta kamera` });
    res.json({ camera: cameras.create(biz.id, p.data.name) });
  }));

  /** Ulash ustasi: klinika tarmog'idagi kameralarni qidirish (bir necha soniya). Bir vaqtda bitta qidiruv */
  app.post('/api/cameras/discover', asBiz(async (_req, res, biz) => {
    if (!env.crmAllowPrivate) return res.status(403).json({ error: "Bu serverda IP kameralar o'chirilgan" });
    if (discovering) return res.status(429).json({ error: 'Qidiruv davom etyapti — biroz kuting' });
    discovering = true;
    try {
      const list = await discoverCameras(discoveryOptions());
      const taken = new Set(cameras.list(biz.id).map(c => c.ip?.replace(/:\d+$/, '')).filter(Boolean));
      res.json({ found: list.map(c => ({ ...c, connected: taken.has(c.ip) })), ffmpeg: ffmpegAvailable() });
    } finally {
      discovering = false;
    }
  }));

  /** Topilgan kamerani ulash: manzil ONVIF'dan yoki markaning odatiy yo'llaridan olinadi, kadr olib tekshiriladi */
  app.post('/api/cameras/connect', asBiz(async (req, res, biz) => {
    const p = ConnectSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const { ip, port, brand, onvif, login, password, name } = p.data;
    if (!env.crmAllowPrivate) return res.status(403).json({ error: "Bu serverda IP kameralar o'chirilgan" });
    if (!ffmpegAvailable()) return res.status(409).json({ error: "Bu kompyuterda ffmpeg yo'q — IP kamera uchun o'rnating (o'rnatish qo'llanmasida bor)" });
    if (cameras.list(biz.id).length >= MAX_CAMERAS) return res.status(409).json({ error: `Ko'pi bilan ${MAX_CAMERAS} ta kamera` });
    // Noto'g'ri parol sanaladi: kamera parolini terib topishga qarshi (manzil topilmagani hisobga kirmaydi)
    const key = `cam:${biz.id}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    let chosen: string | null = null, problem = '';
    const tried: string[] = [];
    if (onvif) {
      try { tried.push(onHost(await onvifStreamUri(onvif, ip, login, password), ip)); } catch (e) { problem = (e as Error).message; }
    }
    tried.push(...candidatePaths(brand).map(path => `rtsp://${ip}:${port}${path}`));
    for (const url of [...new Set(tried)].slice(0, MAX_TRIES)) {
      const full = withCredentials(url, login, password);
      try {
        await snapshot(full, TRY_TIMEOUT_MS);
        chosen = full;
        break;
      } catch (e) {
        problem = (e as Error).message;
        // Parol noto'g'ri — boshqa yo'llarni sinash befoyda (va kamera bloklab qo'yishi mumkin)
        if (/401|unauthori[sz]ed|login yoki parol/i.test(problem)) {
          loginFailed(key);
          return res.status(400).json({ error: "Kamera login yoki parolni qabul qilmadi — kamera qutisidagi yoki o'rnatuvchidagi parolni tekshiring" });
        }
      }
    }
    if (!chosen) return res.status(400).json({ error: `Kameradan kadr olib bo'lmadi (${problem || 'javob yo\'q'}). Manzilni Kameralar sahifasida qo'lda kiriting` });
    loginOk(key);
    const cam = cameras.create(biz.id, name);
    const stream = parseStream(chosen);
    cameras.setStream(biz.id, cam.id, seal(stream.url), stream.host);
    syncEngine();
    res.json({ camera: view(cameras.get(biz.id, cam.id)!) });
  }));

  app.put('/api/cameras/:id/zones', asBiz((req, res, biz) => {
    const cam = found(res, biz, req.params.id);
    if (!cam) return;
    const p = ZonesSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    // Zona idsi faqat shu kameraning o'zidagi zonaniki bo'lsa saqlanadi (bir marta); qolganiga server yangi id beradi
    const used = new Set<string>();
    const zones: CameraZone[] = p.data.zones.map(zn => {
      const keep = zn.id && !used.has(zn.id) && cam.zones.some(o => o.id === zn.id) ? zn.id : newId(8);
      used.add(keep);
      return { id: keep, kind: zn.kind, name: zn.name, x: zn.x, y: zn.y, w: zn.w, h: zn.h, doctorId: zn.doctorId || null };
    });
    // Joyi o'zgarmagan zonaning seansi uzilmaydi (nomini tahrirlash o'tirgan bemorni ikkiga bo'lmasin)
    reset(biz, cam, new Set(cam.zones.filter(o => !zones.some(n => n.id === o.id && sameBox(o, n))).map(o => o.id)));
    cameras.setZones(biz.id, cam.id, zones);
    res.json({ camera: view(cameras.get(biz.id, cam.id)!) });
  }));

  /** IP kamerani ulash (url) yoki uzish (bo'sh). Avval kadr olib ko'riladi: manzil yoki parol xato bo'lsa egasi darhol biladi */
  app.put('/api/cameras/:id/stream', asBiz(async (req, res, biz) => {
    const cam = found(res, biz, req.params.id);
    if (!cam) return;
    const p = z.object({ url: z.string().max(400) }).safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (p.data.url.trim()) {
      // Bir nechta biznesga xizmat qiladigan umumiy serverda ichki tarmoqqa ulanish yopiq (CRM bilan bir xil qoida)
      if (!env.crmAllowPrivate) return res.status(403).json({ error: "Bu serverda IP kameralar o'chirilgan" });
      if (!ffmpegAvailable()) return res.status(409).json({ error: "Bu kompyuterda ffmpeg yo'q — IP kamera uchun o'rnating (o'rnatish qo'llanmasida bor)" });
      let stream: { url: string; host: string };
      try {
        stream = parseStream(p.data.url);
        await snapshot(stream.url);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
      cameras.setStream(biz.id, cam.id, seal(stream.url), stream.host);
    } else {
      cameras.setStream(biz.id, cam.id, null, null);
    }
    // Manba almashdi: eski manbadan ochilgan seanslar yopiladi
    reset(biz, cam);
    shots.delete(cam.id);
    syncEngine();
    res.json({ camera: view(cameras.get(biz.id, cam.id)!) });
  }));

  /** IP kameraning hozirgi kadri (JPEG) — panelda zonalarni uning ustida chizish uchun */
  app.get('/api/cameras/:id/snapshot', asBiz(async (req, res, biz) => {
    const cam = found(res, biz, req.params.id);
    if (!cam) return;
    const sealed = cameras.stream(biz.id, cam.id);
    if (!sealed) return res.status(404).json({ error: 'Bu kameraga IP manzil ulanmagan' });
    try {
      const image = await shot(cam.id, open(sealed));
      res.setHeader('content-type', 'image/jpeg');
      res.setHeader('cache-control', 'no-store');
      res.end(image);
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  }));

  app.delete('/api/cameras/:id', asBiz((req, res, biz) => {
    const cam = found(res, biz, req.params.id);
    if (!cam) return;
    reset(biz, cam);
    cameras.remove(biz.id, cam.id);
    shots.delete(cam.id);
    syncEngine();
    res.json({ ok: true });
  }));

  app.post('/api/cameras/:id/observe', asBiz((req, res, biz) => {
    const cam = found(res, biz, req.params.id);
    if (!cam) return;
    const p = ObserveSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    // IP kamerani serverdagi dvigatel sanaydi: ikki manbadan kelgan kuzatuv seanslarni chalkashtirardi
    if (cam.ip) return res.status(409).json({ error: "Bu kamera IP manzil orqali ulangan — uni server o'zi sanaydi" });
    res.json({ zones: observe(biz, cam, p.data.people) });
  }));

  app.get('/api/cameras/summary', asBiz(async (req, res, biz) => {
    const p = DaySchema.safeParse(req.query.date ?? iso(new Date()));
    if (!p.success) return bad(res, p.error);
    res.json({ summary: await daySummary(biz, p.data) });
  }));
}
