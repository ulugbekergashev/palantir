/** Claude mijozi (yordamchi ham, mijozlarga javob ham shu orqali): har bir so'rov sanaladi va kunlik chegaraga tekshiriladi */
import Anthropic from '@anthropic-ai/sdk';
import { iso } from '../src/lib/week';
import { aiUsage, type AiUsageRow, type BusinessRow } from './db';
import { env } from './env';

let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 600_000 }));
/** Kalit almashdi (ulash ustasi): keyingi so'rov yangi kalit bilan ochilgan mijozdan ketadi */
export const resetClaude = (): void => { client = null; };

// Model rad etsa yoki band bo'lsa — so'rov server tomonda zaxira modelda bajariladi
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

/** Ish turi: owner — egasining yordamchisi, customer — mijozga javob, photo — rasmni ko'rish, camera — AI ko'zi (kamera kadri) */
export type AiKind = 'owner' | 'customer' | 'photo' | 'camera';
const DAILY: Record<AiKind, () => number> = { owner: () => env.aiDailyOwner, customer: () => env.aiDailyCustomer, photo: () => env.aiDailyPhotos, camera: () => env.aiDailyCamera };

/** Bugungi chegara tugadi: so'rov yuborilmaydi (pul ketmaydi) */
export class AiLimitError extends Error {
  constructor(readonly kind: AiKind, readonly limit: number) { super(`bugungi AI chegarasi tugadi (${kind}: ${limit})`); }
}

type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>;

/** Modelga so'rov. Kunlik chegaradan oshsa — AiLimitError; aks holda so'rov va tokenlari biznes hisobiga yoziladi */
export async function think(bizId: string, kind: AiKind, params: Params): Promise<Anthropic.Beta.BetaMessage> {
  return ask(bizId, kind, () => claude().beta.messages.create({ ...params, ...FALLBACK }));
}

/**
 * O'sha so'rov oqim bilan (striming): javob o'nlab daqiqa yozilsa ham ulanish uzilmaydi — Python'da uzoq tahlil (insights/deep.ts) uchun.
 * Hisob va chegara — think bilan bir xil
 */
export async function thinkStream(bizId: string, kind: AiKind, params: Params): Promise<Anthropic.Beta.BetaMessage> {
  return ask(bizId, kind, () => claude().beta.messages.stream({ ...params, ...FALLBACK }).finalMessage());
}

async function ask(bizId: string, kind: AiKind, send: () => Promise<Anthropic.Beta.BetaMessage>): Promise<Anthropic.Beta.BetaMessage> {
  const day = iso(new Date()), limit = DAILY[kind]();
  if (aiUsage.calls(bizId, day, kind) >= limit) throw new AiLimitError(kind, limit);
  aiUsage.hit(bizId, day, kind);
  const res = await send();
  const u = res.usage;
  // Hisob yozilmasa ham (disk to'lgan) pulli javob yo'qolmasin
  try {
    aiUsage.tokens(bizId, day, kind, { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
  } catch (e) {
    console.error('[ai] xarajat hisobi yozilmadi:', (e as Error).message);
  }
  return res;
}

/** Narxlar: million token uchun AQSh dollari (kirish, chiqish). Keshdan o'qish — kirishning 1/20, keshga yozish — 1.25 baravari */
const PRICES: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const CACHE_READ = 0.05, CACHE_WRITE = 1.25;
/** Taxminiy xarajat (dollar): hisob-kitob Anthropic hisobidagidan biroz farq qilishi mumkin (zaxira model, internet qidiruvi alohida) */
export function costUsd(u: Pick<AiUsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>): number {
  const [inPrice, outPrice] = PRICES[env.aiModel] ?? PRICES['claude-opus-5-5'];
  return (u.input * inPrice + u.cacheRead * inPrice * CACHE_READ + u.cacheWrite * inPrice * CACHE_WRITE + u.output * outPrice) / 1_000_000;
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
