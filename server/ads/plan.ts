/**
 * Targetolog: kampaniya rejasi (egasining topshirig'idan AI tuzadi, egasi tasdiqlaydi), limitlar tekshiruvi va Meta Marketing API
 * so'rovlari (v26.0). Hammasi sof funksiyalar — tarmoqsiz sinaladi (scripts/check-ads.ts).
 *
 * Pul qoidalari:
 *   - byudjetni faqat egasi aytadi (topshiriqda); aytilmasa — reja ishga tushmaydi;
 *   - har kampaniya — umumiy (lifetime) byudjet, kampaniya darajasida (CBO): Meta shu summadan ortiq sarflamaydi;
 *   - sozlamadagi qat'iy limitlar: bir kampaniya, kunlik (o'rtacha), oylik (sarflangan + band qilingan + yangi) — oshsa, ishga tushmaydi;
 *   - API'da summa — valyutaning eng kichik birligida (USD — sent): toMinor.
 */
import { z } from 'zod';

export const DESTINATIONS = ['instagram', 'whatsapp', 'messenger', 'website'] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const AdSchema = z.object({
  /** Asosiy matn (reklama ostidagi) */
  text: z.string().trim().min(10).max(2000),
  /** Sarlavha (ixtiyoriy, 25 belgigacha tavsiya) */
  headline: z.string().trim().max(80).nullable().optional(),
  /** Rasm: «post:<id>» (Marketolog posti) yoki «file:<nom>» (panelda yuklangan); bo'sh — hali tanlanmagan */
  image: z.string().trim().max(60).default(''),
});

export const PlanSchema = z.object({
  name: z.string().trim().min(3).max(80),
  destination: z.enum(DESTINATIONS),
  /** website uchun sahifa manzili */
  link: z.string().trim().url().max(1000).nullable().optional(),
  /** Umumiy byudjet, akkaunt valyutasida (masalan 50 = $50). null — egasi aytmagan */
  budget: z.number().positive().max(1_000_000).nullable(),
  days: z.number().int().min(1).max(30),
  countries: z.array(z.string().trim().length(2).toUpperCase()).min(1).max(5),
  /** Shaharlar: key — Meta'dagi joy kodi (server qidiradi); radius — km (17–80) */
  cities: z.array(z.object({ name: z.string().trim().min(2).max(80), key: z.string().max(40).nullable().optional(), radiusKm: z.number().int().min(17).max(80).optional() })).max(10).default([]),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  /** 1 — erkaklar, 2 — ayollar; bo'sh — hammasi */
  genders: z.array(z.union([z.literal(1), z.literal(2)])).max(2).default([]),
  /** Meta auditoriyani o'zi kengaytirsinmi (Advantage+ audience) */
  autoAudience: z.boolean().default(false),
  /** Yozishma ochilganda mijozga birinchi xabar (Direct/Messenger) */
  welcome: z.string().trim().max(300).nullable().optional(),
  ads: z.array(AdSchema).min(1).max(3),
  /** Egasiga savollar va taxminlar (kartada ko'rinadi) */
  notes: z.array(z.string().max(300)).max(6).default([]),
});
export type Plan = z.infer<typeof PlanSchema>;

/** Egasining qat'iy limitlari (akkaunt valyutasida); 0 — o'rnatilmagan: hech narsa ishga tushmaydi */
export interface AdsLimits { perCampaign: number; daily: number; monthly: number }
export interface AdsAccount { adAccountId: string; pageId: string; igActorId: string | null; currency: string }

/** Meta'da tiyinsiz valyutalar (summa butun birlikda) */
const ZERO_DECIMAL = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);
/**
 * Kabinet valyutasi faqat shu ro'yxatdan: ularning eng kichik birligi aniq — yuzdan bir (Meta hujjati: «cents for USD»). Boshqa valyutada
 * birlik xatosi summani o'n-yuz baravar o'zgartirishi mumkin — shuning uchun ulanmaydi (kerak bo'lsa ro'yxat tekshirib kengaytiriladi)
 */
export const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'RUB', 'KZT', 'TRY', 'AED']);
export const toMinor = (amount: number, currency: string): number => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100));
export const fromMinor = (minor: number, currency: string): number => (ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100);
export const money = (amount: number, currency: string): string => `${Number.isInteger(amount) ? amount : amount.toFixed(2)} ${currency}`;

export interface Spend {
  today: number; month: number;
  /** Ishlayotgan (va ishga tushirilayotgan) kampaniyalarning hali sarflanmagan byudjeti */
  committed: number;
  /** Ishlayotganlarning kunlik tezligi yig'indisi: qolgan byudjet / qolgan kunlar */
  dailyRate: number;
}

/** Ishga tushirishga to'sqinlik qiladigan narsalar (egasiga tushunarli); bo'sh — tayyor */
export function planProblems(p: Plan, limits: AdsLimits, spend: Spend, account: AdsAccount | null, currency: string): string[] {
  const out: string[] = [];
  if (!account) out.push('Meta reklama kabineti ulanmagan (Targetolog → Ulash)');
  if (!(limits.perCampaign > 0 && limits.daily > 0 && limits.monthly > 0)) out.push("Limitlar o'rnatilmagan (Targetolog → Ulash → Limitlar)");
  if (p.budget === null) out.push('Byudjet aytilmagan — qancha sarflashni yozing');
  if (p.ageMin > p.ageMax) out.push("Yosh oralig'i noto'g'ri");
  if (p.destination === 'website' && !p.link) out.push('Sayt manzili kerak');
  if (p.destination === 'instagram' && account && !account.igActorId) out.push("Instagram akkaunti ulanmagan (Ulash → Instagram akkaunt ID)");
  const lost = p.cities.filter(c => !c.key).map(c => c.name);
  if (lost.length) out.push(`Shahar Meta'da topilmadi: ${lost.join(', ')}`);
  const noImage = p.ads.filter(a => !a.image).length;
  if (noImage) out.push(`${noImage} ta reklamaga rasm tanlanmagan`);
  if (p.budget !== null && limits.perCampaign > 0) {
    if (p.budget > limits.perCampaign) out.push(`Byudjet ${money(p.budget, currency)} — bir kampaniya limitidan (${money(limits.perCampaign, currency)}) ko'p`);
    const perDay = p.budget / p.days;
    // Boshqa ishlayotgan kampaniyalarning kunlik tezligi ham qo'shiladi (bir kunda hammasi birga sarflaydi)
    const together = perDay + (spend.dailyRate || 0);
    if (limits.daily > 0 && together > limits.daily) {
      out.push(`Kuniga o'rtacha ${money(Math.round(perDay * 100) / 100, currency)}${spend.dailyRate ? ` (+ ishlayotganlar ${money(Math.round(spend.dailyRate * 100) / 100, currency)})` : ''} — kunlik limitdan (${money(limits.daily, currency)}) ko'p: kunlarni ko'paytiring yoki byudjetni kamaytiring`);
    }
    if (limits.monthly > 0 && spend.month + spend.committed + p.budget > limits.monthly) {
      out.push(`Oylik limit (${money(limits.monthly, currency)}) yetmaydi: bu oy sarflangan ${money(spend.month, currency)}, ishlayotganlarga band ${money(spend.committed, currency)}`);
    }
    if (perDay < 1 && !ZERO_DECIMAL.has(currency)) out.push(`Kuniga ${money(Math.round(perDay * 100) / 100, currency)} — Meta uchun juda kam (kamida ~1 ${currency})`);
  }
  return out;
}

// ─── Meta so'rovlari ──────────────────────────────────────────────────────────

const GOAL: Record<Destination, { objective: string; destination_type: string; optimization_goal: string }> = {
  instagram: { objective: 'OUTCOME_ENGAGEMENT', destination_type: 'INSTAGRAM_DIRECT', optimization_goal: 'CONVERSATIONS' },
  whatsapp: { objective: 'OUTCOME_ENGAGEMENT', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
  messenger: { objective: 'OUTCOME_ENGAGEMENT', destination_type: 'MESSENGER', optimization_goal: 'CONVERSATIONS' },
  website: { objective: 'OUTCOME_TRAFFIC', destination_type: 'WEBSITE', optimization_goal: 'LINK_CLICKS' },
};

/** Kampaniya: umumiy byudjet (CBO), pauzada yaratiladi — hamma qismi tayyor bo'lgach yoqiladi */
export function campaignParams(p: Plan, currency: string): Record<string, unknown> {
  return {
    name: `Palantir · ${p.name}`.slice(0, 100),
    objective: GOAL[p.destination].objective,
    status: 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
    lifetime_budget: toMinor(p.budget ?? 0, currency),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  };
}

export function targeting(p: Plan): Record<string, unknown> {
  const geo = p.cities.length
    ? { cities: p.cities.map(c => ({ key: c.key, radius: c.radiusKm ?? 25, distance_unit: 'kilometer' })) }
    : { countries: p.countries };
  return {
    geo_locations: geo,
    age_min: p.ageMin,
    age_max: p.ageMax,
    ...(p.genders.length === 1 ? { genders: p.genders } : {}),
    targeting_automation: { advantage_audience: p.autoAudience ? 1 : 0 },
  };
}

/** Guruh: byudjet kampaniyada; umumiy byudjet bilan tugash vaqti majburiy (UNIX soniya) */
export function adsetParams(p: Plan, a: AdsAccount, campaignId: string, start: Date): Record<string, unknown> {
  const g = GOAL[p.destination];
  const begin = Math.floor(start.getTime() / 1000);
  return {
    name: `${p.name} — auditoriya`.slice(0, 100),
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: g.optimization_goal,
    destination_type: g.destination_type,
    ...(p.destination === 'website' ? {} : { promoted_object: { page_id: a.pageId } }),
    targeting: targeting(p),
    start_time: begin,
    end_time: begin + p.days * 86_400,
    status: 'ACTIVE',
  };
}

const CTA: Record<Destination, (p: Plan) => Record<string, unknown>> = {
  instagram: () => ({ type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } }),
  whatsapp: () => ({ type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } }),
  messenger: () => ({ type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } }),
  website: p => ({ type: 'LEARN_MORE', value: { link: p.link } }),
};

export function creativeParams(p: Plan, a: AdsAccount, index: number, imageHash: string): Record<string, unknown> {
  const ad = p.ads[index];
  const link = p.destination === 'website' ? p.link : p.destination === 'whatsapp' ? 'https://api.whatsapp.com/send' : undefined;
  return {
    name: `${p.name} — ${index + 1}`.slice(0, 100),
    object_story_spec: {
      page_id: a.pageId,
      ...(a.igActorId ? { instagram_actor_id: a.igActorId } : {}),
      link_data: {
        message: ad.text,
        ...(ad.headline ? { name: ad.headline } : {}),
        image_hash: imageHash,
        ...(link ? { link } : {}),
        ...(p.welcome && p.destination !== 'website' ? { page_welcome_message: p.welcome } : {}),
        call_to_action: CTA[p.destination](p),
      },
    },
  };
}

export const adParams = (p: Plan, index: number, adsetId: string, creativeId: string): Record<string, unknown> => ({
  name: `${p.name} — ${index + 1}`.slice(0, 100), adset_id: adsetId, creative: { creative_id: creativeId }, status: 'ACTIVE',
});

/** Egasiga reja — kartada va panelda bir xil */
export function planSummary(p: Plan, currency: string): string[] {
  const where = { instagram: 'Instagram Direct yozishmasi', whatsapp: 'WhatsApp yozishmasi', messenger: 'Messenger yozishmasi', website: `saytga o'tish (${p.link ?? '—'})` }[p.destination];
  const geo = p.cities.length ? p.cities.map(c => `${c.name} +${c.radiusKm ?? 25} km`).join(', ') : p.countries.join(', ');
  const who = p.genders.length === 1 ? (p.genders[0] === 1 ? 'erkaklar' : 'ayollar') : 'hammasi';
  return [
    `Maqsad: ${where}`,
    `Byudjet: ${p.budget === null ? 'AYTILMAGAN' : `${money(p.budget, currency)} jami, ${p.days} kun (~${money(Math.round((p.budget / p.days) * 100) / 100, currency)}/kun)`}`,
    `Auditoriya: ${geo}; ${p.ageMin}–${p.ageMax} yosh; ${who}${p.autoAudience ? '; Meta kengaytiradi' : ''}`,
    `Reklamalar: ${p.ads.length} ta variant`,
  ];
}
