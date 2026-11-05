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
import type { LiveStatus } from '../src/types';
import { CREW, crewList, inUse, isCore, parseCrew, setHired, withInUse, type CrewMember, type CrewSignals, type CrewState } from '../src/lib/crew';

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
      || has('content_brand') || has('content_plan') || has('content_videos'),
    ads: !!adsStore.connection(biz.id) || adsStore.campaigns(biz.id).length > 0,
  };
}

/** Ishdagi jamoa; ishi ulangan xodimlar shu yerda qo'shiladi (o'zgarsa — saqlanadi) */
export function syncCrew(biz: BusinessRow, status: LiveStatus): CrewMember[] {
  const before = stateOf(biz);
  const next = withInUse(before, inUse(signals(biz, status)));
  if (next !== before) save(biz.id, next);
  return crewList(next);
}

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
    if (isCore(p.data.member) && !p.data.on) return res.status(409).json({ error: 'Direktor va Yordamchi — asosiy xodimlar, ular jamoadan chiqmaydi' });
    // Pul ketayotgan reklama egasiz qolmasin: Targetolog chiqsa, kampaniyani paneldan to'xtatadigan joy qolmaydi
    if (p.data.member === 'target' && !p.data.on && adsStore.campaigns(biz.id).some(c => c.status === 'active')) {
      return res.status(409).json({ error: "Ishlab turgan reklama kampaniyasi bor — avval uni Targetolog sahifasida to'xtating" });
    }
    const next = setHired(stateOf(biz), p.data.member, p.data.on);
    save(biz.id, next);
    res.json({ crew: crewList(next) });
  }));
}
