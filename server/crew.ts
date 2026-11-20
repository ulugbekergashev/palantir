/**
 * AI jamoa tarkibi (qoidasi — src/lib/crew.ts): bazada saqlash, «ishi ulangan» belgilarni yig'ish va fonda ishlash ruxsati.
 * Panel har ochilganda (GET /api/me) tarkib yangilanadi: ulangan ishning xodimi o'zi qo'shiladi (egasi olib tashlamagan bo'lsa).
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { businesses, cameras, sql, type BusinessRow } from './db';
import { contentStore } from './content/store';
import { adsStore } from './ads/store';
import { staff } from './requests/store';
import { vacancies } from './hr/store';
import { trainings } from './hr/train';
import type { LiveStatus } from '../src/types';
import { CREW, crewLicensed, crewList, inUse, isCore, parseCrew, setHired, withInUse, TEAM_NAME, type CrewMember, type CrewSignals, type CrewState } from '../src/lib/crew';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const stateOf = (biz: BusinessRow): CrewState | null => parseCrew(biz.crew);
const save = (bizId: string, s: CrewState) => { businesses.update(bizId, { crew: JSON.stringify(s) }); };

/**
 * Shu biznesda allaqachon ulangan ishlar. status (panelning holati) bo'lmasa — faqat bazadagi ma'lumotdan:
 * ulanish holatiga bog'liqlari (Instagram, Telegram biznes, DentaCRM, Meta AI) «yo'q» deb olinadi
 */
function signals(biz: BusinessRow, status?: LiveStatus): CrewSignals {
  // Jadval hali yaratilmagan bo'lsa (modul yuklanmagan) — «yo'q»: tarkibni hisoblash panelni yiqitmasin
  const has = (table: string) => { try { return !!sql.one(`SELECT 1 AS x FROM ${table} WHERE business_id = ? LIMIT 1`, r => r, biz.id); } catch { return false; } };
  const content = contentStore.settings(biz.id);
  return {
    // Klinika xodimiga Qabulxona kirishi berilgan — Qabulxona ishlatilyapti
    customers: !!(status && (status.telegramBusiness.account || status.instagram.account || status.instagramApi.account)) || has('leads') || has('calls')
      || staff.list(biz.id).some(s => s.access === 'reception'),
    crm: !!status?.crm.account,
    cameras: cameras.list(biz.id).length,
    metaAi: !!status?.metaAi.connected,
    marketingPosts: has('marketing_posts') ? 1 : 0,
    content: !!content.channelTitle || contentStore.sources(biz.id).length > 0 || contentStore.drafts(biz.id).length > 0
      // Brend-buk (Miya → Brend) — butun jamoaniki: uni to'ldirish SMM-menejerni o'zi yollamaydi
      || has('content_plan') || has('content_videos'),
    ads: !!adsStore.connection(biz.id) || adsStore.campaigns(biz.id).length > 0,
    vacancies: vacancies.list(biz.id, 'all', 1).length > 0,
    trainings: trainings.list(biz.id, 1).length > 0,
  };
}

/** Tarifda yo'q xodimlar (sotuvchi Hub'da o'chirgan) — «AI xodimlar» sahifasida qulf bilan */
export const lockedCrew = (): CrewMember[] => CREW.filter(m => !crewLicensed(m));

/**
 * Panelga ko'rinadigan jamoa. Pul ketayotgan reklama egasiz qolmasin: Targetolog tarifdan chiqsa ham, ishlab turgan kampaniyasi bo'lsa
 * uning sahifasi qoladi — egasi kampaniyani to'xtata olsin (yangi kampaniya tuzish — tarif bilan)
 */
function visibleCrew(biz: BusinessRow, s: CrewState | null): CrewMember[] {
  const list = crewList(s);
  const keepTarget = !list.includes('target') && !!s?.hired.includes('target') && adsStore.campaigns(biz.id).some(c => c.status === 'active');
  return keepTarget ? CREW.filter(m => m === 'target' || list.includes(m)) : list;
}

/** Ishdagi jamoa; ishi ulangan xodimlar shu yerda qo'shiladi (o'zgarsa — saqlanadi) */
export function syncCrew(biz: BusinessRow, status: LiveStatus): CrewMember[] {
  const before = stateOf(biz);
  const next = withInUse(before, inUse(signals(biz, status)));
  if (next !== before) save(biz.id, next);
  return visibleCrew(biz, next);
}

/**
 * Tarif himoyasi API darajasida: tarifda yo'q xodimning o'zgartiruvchi yo'llari (POST/PUT/PATCH/DELETE) — 403 «tarif». Menyuni yashirish
 * yetmaydi: brauzerdan to'g'ridan-to'g'ri so'rov yuborib ishlatib bo'lmasin. O'qish (GET) ochiq — egasining ma'lumoti yashirilmaydi.
 * Ochiq qoladigan xavfsiz amallar (SAFE): reklamani to'xtatish/o'chirish va limit (pul egasiz qolmasin), kamerani o'chirish, kursni bekor
 * qilish, vakansiyani yopish; brend-buk — butun jamoaniki
 */
const GUARDED: [RegExp, CrewMember][] = [
  [/^\/api\/(content|posts|smm)(\/|$)/, 'kontent'],
  [/^\/api\/ads(\/|$)/, 'target'],
  [/^\/api\/cameras(\/|$)/, 'kuzatuvchi'],
  [/^\/api\/(director|goals)(\/|$)/, 'direktor'],
  [/^\/api\/hr\/(vacancies|candidates)(\/|$)/, 'rekruter'],
  [/^\/api\/hr\/trainings(\/|$)/, 'murabbiy'],
  [/^\/api\/insights(\/|$)/, 'tahlilchi'],
  [/^\/api\/results(\/|$)/, 'marketolog'],
];
const SAFE = /^\/api\/(content\/brand|ads\/campaigns\/[^/]+\/pause$|ads\/limits$|hr\/trainings\/[^/]+\/cancel$|hr\/vacancies\/[^/]+\/close$)/;
const SAFE_DELETE = /^\/api\/(ads\/campaigns\/[^/]+|ads\/connect|cameras\/[^/]+)$/;

/** Shu so'rovni tarif yopadimi: yopsa — xodim, aks holda null */
export function tariffBlocks(method: string, rawPath: string): CrewMember | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const path = rawPath.toLowerCase();
  if (SAFE.test(path) || (method === 'DELETE' && SAFE_DELETE.test(path))) return null;
  const hit = GUARDED.find(([re]) => re.test(path));
  return hit && !crewLicensed(hit[1]) ? hit[1] : null;
}

export function tariffGuard(req: Request, res: Response, next: () => void): unknown {
  const m = tariffBlocks(req.method, req.path);
  if (!m) return next();
  return res.status(403).json({ error: `${TEAM_NAME[m]} tarifingizda yo'q — qo'shish uchun sotuvchiga murojaat qiling`, code: 'tarif' });
}

/** Heartbeat (sotuvchi Hub'da ko'radi): egasi jamoaga olgan xodimlar — tarifdan qat'i nazar, qaysi modulni ishlatayotgani */
export const hiredCrew = (biz: BusinessRow): CrewMember[] => CREW.filter(m => !isCore(m) && !!stateOf(biz)?.hired.includes(m));

/**
 * Egasi yozganda (yordamchi suhbati, topshiriq): bazada ishi paydo bo'lgan xodim jamoaga qo'shiladi — masalan kamera qo'shilgan bo'lsa,
 * panel qayta ochilishini kutmay Kuzatuvchi (aks holda «kameraga qara» — «Kuzatuvchi jamoada yo'q»). Faqat qo'shadi, egasi olib tashlaganini
 * qaytarmaydi. Eski baza (tarkib hali hisoblanmagan) bu yerda o'zgarmaydi: uni panel to'liq holat bilan hisoblaydi (syncCrew)
 */
export function crewFromData(biz: BusinessRow): BusinessRow {
  const before = stateOf(biz);
  if (!before) return biz;
  const next = withInUse(before, inUse(signals(biz)));
  if (next === before) return biz;
  save(biz.id, next);
  return { ...biz, crew: JSON.stringify(next) };
}

const Change = z.object({ member: z.enum(CREW), on: z.boolean() });

export function mountCrew(app: Express, { asOwner, bad }: Deps): void {
  /** Ishga olish yoki olib tashlash. Ma'lumoti (kameralar, postlar, yozishmalar) o'chirilmaydi — qaytib olinsa, joyida */
  app.post('/api/crew', asOwner((req, res, biz) => {
    const p = Change.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    if (p.data.on && !crewLicensed(p.data.member)) return res.status(409).json({ error: `${TEAM_NAME[p.data.member]} tarifingizda yo'q — qo'shish uchun sotuvchiga murojaat qiling`, code: 'tarif' });
    if (isCore(p.data.member) && !p.data.on) return res.status(409).json({ error: "AI administrator va Palantir — asosiy xodimlar, ular jamoadan chiqmaydi. Bemorlarga javob bermasin desangiz — Sozlamalarda javob rejimini «O'chiq» qiling" });
    // Pul ketayotgan reklama egasiz qolmasin: Targetolog chiqsa, kampaniyani paneldan to'xtatadigan joy qolmaydi
    if (p.data.member === 'target' && !p.data.on && adsStore.campaigns(biz.id).some(c => c.status === 'active')) {
      return res.status(409).json({ error: "Ishlab turgan reklama kampaniyasi bor — avval uni Targetolog sahifasida to'xtating" });
    }
    const next = setHired(stateOf(biz), p.data.member, p.data.on);
    save(biz.id, next);
    res.json({ crew: visibleCrew(biz, next), locked: lockedCrew() });
  }));
}
