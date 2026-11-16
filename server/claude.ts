/** Claude mijozi (yordamchi ham, mijozlarga javob ham shu orqali): har bir so'rov sanaladi va kunlik chegaraga tekshiriladi */
import Anthropic from '@anthropic-ai/sdk';
import { iso } from '../src/lib/week';
import { type BusinessRow } from './db';
import { aiUsage, type AiUsageRow } from './serviceStore';
import { env } from './env';
import { AccessBlockedError, accessBlocked } from './hubAccess';
import { PausedError, SubscriptionError, apiKeyPresent, plainRequest, subscriptionMessage, subscriptionOn, type PlainRequest, type TokenUsage } from './subscription/engine';
import { currentLane, laneClosedUntil, pausedText, type Lane } from './subscription/pressure';
import { GEMINI_USAGE_KIND, fromGemini, geminiMessage, geminiReady } from './gemini/think';

let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 600_000 }));
/** Kalit almashdi (ulash ustasi): keyingi so'rov yangi kalit bilan ochilgan mijozdan ketadi */
export const resetClaude = (): void => { client = null; };

// Model rad etsa yoki band bo'lsa — so'rov server tomonda zaxira modelda bajariladi
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

/** Ish turi: owner — egasining yordamchisi, customer — mijozga javob, photo — rasmni ko'rish, camera — AI ko'zi (kamera kadri), computer — kompyuterda ish */
export type AiKind = 'owner' | 'customer' | 'photo' | 'camera' | 'computer';
const DAILY: Record<AiKind, () => number> = { owner: () => env.aiDailyOwner, customer: () => env.aiDailyCustomer, photo: () => env.aiDailyPhotos, camera: () => env.aiDailyCamera, computer: () => env.aiDailyComputer };

/** Bugungi chegara tugadi: so'rov yuborilmaydi (pul ketmaydi) */
export class AiLimitError extends Error {
  constructor(readonly kind: AiKind, readonly limit: number) { super(`bugungi AI chegarasi tugadi (${kind}: ${limit})`); }
}

type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>;

/**
 * Modelga so'rov. Kunlik chegaradan oshsa — AiLimitError; aks holda so'rov va tokenlari biznes hisobiga yoziladi. betas — qo'shimcha beta sarlavhalar.
 * Obuna rejimida (AI_ENGINE=subscription) asbobsiz ishlarning hammasi (matn, rasm, JSON — mijozga javob, kamera ham) obuna orqali
 * ketadi; asbobli ish (kompyuterda ish) — API kalit bo'lsa API'da, bo'lmasa egasiga tushunarli SubscriptionError
 */
export async function think(bizId: string, kind: AiKind, params: Params, betas: Anthropic.Beta.AnthropicBeta[] = []): Promise<Anthropic.Beta.BetaMessage> {
  if (subscriptionOn()) {
    const req = kind === 'computer' ? null : plainRequest(params);
    if (req) return viaSubscription(bizId, kind, params, req);
    if (!apiKeyPresent()) throw new SubscriptionError('unsupported', `Obunada ishlamaydigan so'rov (${kind}) — API kalit yo'q`);
  }
  return ask(bizId, kind, () => claude().beta.messages.create({ ...params, ...FALLBACK, betas: [...FALLBACK.betas, ...betas] }));
}

/** Ish navbati (subscription/pressure.ts): mijozga javob — har doim bemor navbati; qolgani — chaqiruvchi belgilagan yoki live */
export const laneOf = (kind: AiKind): Lane => (kind === 'customer' ? 'patient' : currentLane() ?? 'live');
/** Limit yopganda Gemini'da davom etadigan oddiy ishlar: bemorlarga javob, qo'ng'iroq tahlili (bemor navbati) va kamera */
export const geminiBackup = (kind: AiKind, lane: Lane): boolean => (lane === 'patient' || kind === 'camera') && geminiReady();

/**
 * Obuna orqali. Navbati yopiq bo'lsa (limitga yaqin): oddiy ish — darrov Gemini'da, qolgani — vaqti aytilgan «keyinroq» xatosi.
 * Obuna limit tufayli rad etsa — oddiy ish Gemini'da qayta so'raladi; Gemini ham yiqilsa — asl limit xatosi (nazorat uni ko'rsatsin)
 */
function viaSubscription(bizId: string, kind: AiKind, params: Params, req: PlainRequest): Promise<Anthropic.Beta.BetaMessage> {
  const lane = laneOf(kind), backup = geminiBackup(kind, lane), closed = laneClosedUntil(lane);
  if (closed !== null) {
    // Gemini ham yiqilsa — «limit tugadi» (nazorat va xodimga xabar shuni ko'rsatsin), xom Gemini xatosi emas
    if (backup) return ask(bizId, kind, () => geminiMessage(params).catch(g => {
      console.error('[ai] Gemini zaxirasi ishlamadi:', (g as Error).message);
      throw new SubscriptionError('limit', `Claude obunasi limitida, Gemini zaxirasi ham ishlamadi: ${(g as Error).message}`);
    }));
    // Bemor navbati faqat limit tugaganda yopiladi: xodimga «limit tugadi — o'zingiz javob bering» (inbox/core.ts whyNoReply)
    if (lane === 'patient') {
      const e = new SubscriptionError('limit', "Claude obunasining limiti tugadi, Gemini kaliti yo'q");
      noteTrouble(bizId, e);
      throw e;
    }
    throw new PausedError(pausedText(lane, closed), lane, closed);
  }
  return ask(bizId, kind, async () => {
    try {
      return await subscriptionMessage(req);
    } catch (e) {
      if (!backup || !(e instanceof SubscriptionError) || e.reason !== 'limit') throw e;
      console.warn(`[ai] obuna limiti — ${kind} Gemini zaxirasida`);
      return geminiMessage(params).catch(g => {
        console.error('[ai] Gemini zaxirasi ham ishlamadi:', (g as Error).message);
        throw e;
      });
    }
  });
}

/**
 * O'sha so'rov oqim bilan (striming): javob o'nlab daqiqa yozilsa ham ulanish uzilmaydi — Python'da uzoq tahlil (insights/deep.ts) uchun.
 * Hisob va chegara — think bilan bir xil
 */
export async function thinkStream(bizId: string, kind: AiKind, params: Params): Promise<Anthropic.Beta.BetaMessage> {
  if (subscriptionOn() && !apiKeyPresent()) throw new SubscriptionError('unsupported', `Chuqur tahlil obunada ishlamaydi (${kind}) — API kalit yo'q`);
  return ask(bizId, kind, () => claude().beta.messages.stream({ ...params, ...FALLBACK }).finalMessage());
}

/** Gemini zaxirasining tokenlari alohida qatorda (Gemini narxida sanaladi — pul aynan shu yerda ketadi, obuna esa oylik) */
const ask = (bizId: string, kind: AiKind, send: () => Promise<Anthropic.Beta.BetaMessage>): Promise<Anthropic.Beta.BetaMessage> =>
  metered(bizId, kind, send, ({ usage: u }) => ({ input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }), res => (fromGemini(res) ? GEMINI_USAGE_KIND : kind));

/**
 * AI ishlamay qolgani (kanallar nazorati — monitor.ts): obunadan chiqib ketish, limit, rad etilgan kalit, tugagan mablag', bemorlarga
 * javobning kunlik chegarasi. Har AI so'rovida yangilanadi: muvaffaqiyatli javob — tiklandi. kind — faqat shu ish turi
 * muvaffaqiyatli bo'lganda tiklanadi (kunlik chegara ish turi bo'yicha); null — istalgan muvaffaqiyatli javob
 */
const aiTrouble = new Map<string, { problem: string; kind: AiKind | null }>();
export const aiProblem = (bizId: string): string | null => aiTrouble.get(bizId)?.problem ?? null;
const SETTINGS_HINT = 'Panel → Sozlamalar → Claude va kalitlar';
function troubleOf(e: unknown): string | null {
  if (e instanceof SubscriptionError && e.reason === 'auth') return `Claude obunasiga kirilmagan yoki kirish eskirgan — bemorlarga javob to'xtadi. ${SETTINGS_HINT}`;
  if (e instanceof SubscriptionError && e.reason === 'limit') return "Claude obunasining limiti tugadi — limit yangilanguncha bemorlarga javob yo'q";
  if (e instanceof Anthropic.APIError && (e.status === 401 || e.status === 403)) return `Claude kaliti rad etildi — bemorlarga javob to'xtadi. ${SETTINGS_HINT}`;
  if (e instanceof Anthropic.APIError && /credit balance/i.test(e.message)) return "Claude hisobida mablag' tugadi — bemorlarga javob to'xtadi";
  return null;
}

/** So'rov yuborilmay turib aniqlangan muammo (masalan, limit tugagan va Gemini kaliti yo'q) — nazoratga */
function noteTrouble(bizId: string, e: unknown): void {
  const problem = troubleOf(e);
  if (problem) aiTrouble.set(bizId, { problem, kind: null });
}

/** Kunlik chegara va hisob: chegaradan oshsa — AiLimitError (so'rov yuborilmaydi); javobdan keyin tokenlar biznes hisobiga yoziladi */
export async function metered<T>(bizId: string, kind: AiKind, send: () => Promise<T>, usageOf: (res: T) => TokenUsage, rowKind: (res: T) => string = () => kind): Promise<T> {
  // Sotuvchi to'xtatgan (hubAccess.ts): hech qanday AI so'rovi ketmaydi — bemor xabarlari xodimga «o'zingiz javob bering» bo'lib boradi
  if (accessBlocked()) throw new AccessBlockedError();
  const day = iso(new Date()), limit = DAILY[kind]();
  if (aiUsage.calls(bizId, day, kind) >= limit) {
    if (kind === 'customer') aiTrouble.set(bizId, { problem: `Bemorlarga javobning bugungi chegarasi (${limit}) tugadi — ertagacha o'zingiz javob bering`, kind });
    throw new AiLimitError(kind, limit);
  }
  aiUsage.hit(bizId, day, kind);
  let res: T;
  try {
    res = await send();
  } catch (e) {
    const problem = troubleOf(e);
    if (problem) aiTrouble.set(bizId, { problem, kind: null });
    throw e;
  }
  const was = aiTrouble.get(bizId);
  if (was && (was.kind === null || was.kind === kind)) aiTrouble.delete(bizId);
  // Hisob yozilmasa ham (disk to'lgan) pulli javob yo'qolmasin
  try {
    const row = rowKind(res);
    // Alohida qator (masalan, Gemini) hali yo'q bo'lsa — yaratiladi: tokens() faqat bor qatorni yangilaydi
    if (row !== kind) aiUsage.ensure(bizId, day, row);
    aiUsage.tokens(bizId, day, row, usageOf(res));
  } catch (e) {
    console.error('[ai] xarajat hisobi yozilmadi:', (e as Error).message);
  }
  return res;
}

/**
 * Narxlar: million token uchun AQSh dollari — kirish, chiqish, keshdan o'qish (Opus 5.5 va Sonnet 5.5 da $0.20; Haiku 5.5 niki
 * e'lon qilinmagan — kirishning 1/10 deb olingan).
 * Keshga yozish (5 daqiqalik) — kirishning 1.25 baravari
 */
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.01],
};
const CACHE_WRITE = 1.25;
/** Taxminiy xarajat (dollar): hisob-kitob Anthropic hisobidagidan biroz farq qilishi mumkin (zaxira model, internet qidiruvi alohida) */
export function costUsd(u: Pick<AiUsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>, model = env.aiModel): number {
  const [inPrice, outPrice, readPrice] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  return (u.input * inPrice + u.cacheRead * readPrice + u.cacheWrite * inPrice * CACHE_WRITE + u.output * outPrice) / 1_000_000;
}

/**
 * Biznes sozlamalari va narxlar — Claude uchun matn (yordamchi va mijozlarga javob bir xil faktlardan foydalanadi).
 * Manzil, ish vaqti, telefon va biznes tavsifi bu yerda emas: ular ikkinchi miya papkasidagi «Biznes haqida» sahifasida.
 */
export function profileText(b: BusinessRow): string {
  const p = b.profile;
  const lines = [
    `Name: ${p.name}`,
    p.ownerName && `Owner: ${p.ownerName}`,
    `Industry: ${p.industry || 'not set'}`,
    `Content language (documents, texts for customers): ${p.contentLang === 'ru' ? 'Russian' : 'Uzbek'}`,
    p.offerings.length ? `Products and services (price in so'm, 0 = not given):\n${p.offerings.map(o => `- ${o.name}${o.nameRu ? ` / ${o.nameRu}` : ''}: ${o.price || 0}`).join('\n')}` : 'Products and services: not listed yet',
    p.team.length ? `Team:\n${p.team.map(m => `- ${m.name} — ${m.role}${m.years ? `, ${m.years} years` : ''} (member_id: ${m.id})`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
