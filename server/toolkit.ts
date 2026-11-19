/** Asboblar uchun umumiy turlar (tools.ts va crm/tools.ts bir-birini import qilmasligi uchun alohida) */
import type { z } from 'zod';
import type { CrewMember } from '../src/lib/crew';
import type { Artifact } from '../src/types';
import type { BusinessRow } from './db';
import { unknownNumber } from './inbox/offerGuard';

/** Rasm bilan kelgan gapda tasdiqsiz yozadigan asbob chaqirilganda */
export const PHOTO_REFUSAL = "Bu ish rasm asosida bajarilmaydi — egasi shu so'rovni matn bilan yozsin";

/** Mijozlar yozgan matn o'qilgan javobda doimiy bilimga yozadigan asbob chaqirilganda */
export const UNATTENDED_REFUSAL = "Jadval bo'yicha (egasi kuzatmay turganda) bu ish bajarilmaydi — natijani egasiga yozing, u o'zi aytsin";
export const STRANGER_REFUSAL = "Bu ish mijozlar yozgan matn o'qilgan javobda bajarilmaydi — egasi nimani saqlashni keyingi xabarda o'zi aytsin";
/** Bilimga yoziladigan matnda egasi aytmagan telefon, karta, hisob raqami yoki havola bor */
export const NUMBER_REFUSAL = "Bu matndagi telefon, karta raqami yoki havolani egasi o'zi yozmagan — saqlanmadi. Egasi raqam yoki havolani o'z xabarida yozsin, keyin saqlang";

export interface ToolCtx {
  biz: BusinessRow;
  /** Javob bilan birga egasiga ko'rsatiladigan narsalar (hujjat, post, xabar qoralamasi…) */
  artifacts: Artifact[];
  /** Shu javob davomida DentaCRM'ga yozilgan qabullar soni (bir javobda cheklangan) */
  crmWrites?: number;
  /** Shu javob davomida tayyorlangan pul yozuvi takliflari soni */
  moneyDrafts?: number;
  /** Bu gap rasm bilan kelgan: rasm ichidagi yozuv begona matn — tasdiqsiz yozadigan asboblar (eslab qolish, qabulga yozish) ishlamaydi */
  fromPhoto?: boolean;
  /** Jadvaldagi topshiriq (orders/run.ts): egasi kuzatmayapti — bilimga va CRM'ga yozadigan asboblar ishlamaydi */
  unattended?: boolean;
  /** Kim nomidan ishlayapti: topshiriqni bajarayotgan xodim (orders/run.ts); yo'q — egasi bilan suhbatdagi Yordamchi */
  as?: CrewMember;
  /** Shu javob davomida mijozlar yozgan matn o'qildi (yozishma, mijozlar ro'yxati): u ham begona matn */
  readStrangers?: boolean;
  /** readStrangers qayerdan: asbob nomi yoki «web_search» (computer/tools.ts: faqat ish hisobotlari bo'lsa — topshiriq tasdiqsiz boshlanishi mumkin) */
  strangerSources?: string[];
  /** Egasining shu (joriy) xabari — topshiriq undan olinganini tekshirish uchun (ownerSaid — 6 soatlik suhbat, bu yerda juda keng) */
  ownerNow?: string;
  /** Shu gapda qo'shilgan mijozlar soni (chegara: tools.ts MAX_LEADS_PER_TURN) */
  leadsSaved?: number;
  /** Shu javob davomida kameraga necha marta qaraldi (chegara: camera/tools.ts) */
  cameraLooks?: number;
  /**
   * Egasining shu suhbatdagi o'z gaplari (agent.ts: ownerWords). readStrangers faqat bitta javob davomida turadi, begona matn esa
   * suhbat tarixida qoladi: keyingi «ha, saqla» gapida bilimga yoziladigan raqam va havolalar shu matndan tekshiriladi (assertOwnNumbers)
   */
  ownerSaid?: string;
}

/** Begona matn o'qildi: belgi va manbasi */
export function markStrangers(ctx: ToolCtx, source: string): void {
  ctx.readStrangers = true;
  ctx.strangerSources = [...(ctx.strangerSources ?? []), source];
}

/** Doimiy bilimga (fakt, narx, sahifa) yozishdan oldin: begona matn — rasmdagi yozuv yoki mijozning xabari — shu yo'l bilan bilimga aylanmasin */
export function assertOwnWords(ctx: ToolCtx): void {
  if (ctx.fromPhoto) throw new ToolError(PHOTO_REFUSAL);
  if (ctx.unattended) throw new ToolError(UNATTENDED_REFUSAL);
  if (ctx.readStrangers) throw new ToolError(STRANGER_REFUSAL);
}

/** Havola va akkaunt nomi: https://…, t.me/…, instagram.com/…, @nom */
const LINK = /https?:\/\/[^\s<>"')\]]+|(?:t\.me|wa\.me|instagram\.com|telegram\.me)\/[^\s<>"')\]]+|@[a-z0-9_]{4,}/gi;
const linksIn = (s: string): string[] => [...s.matchAll(LINK)].map(m => m[0].toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[.,;:!?]+$/, ''));

/**
 * Bilimga (fakt, sahifa, narx nomi) yoziladigan matndagi telefon, karta, hisob raqami va havola egasining o'z gapida (ownerSaid) yoki
 * allaqachon bilimda (known: profil, saqlangan faktlar, sahifalar) bo'lishi kerak. Begona (mijoz, sahifa, rasm) aytgan karta raqami
 * egasining «ha, saqla» degan gapi bilan tasdiqlangan bilimga aylanib, keyin mijozlarga javobda «ma'lum raqam» bo'lib ketmasin
 */
export function assertOwnNumbers(ctx: ToolCtx, written: string, known: string): void {
  const trusted = `${ctx.ownerSaid ?? ''}\n${known}`;
  const lower = trusted.toLowerCase();
  if (unknownNumber(written, trusted) || linksIn(written).some(l => !lower.includes(l))) throw new ToolError(NUMBER_REFUSAL);
}

export interface ToolDef<S extends z.ZodType> {
  description: string;
  input: S;
  run: (input: z.infer<S>, ctx: ToolCtx) => unknown | Promise<unknown>;
}

/** Xato: Claude'ga is_error bilan qaytadi */
export class ToolError extends Error {}

export const def = <S extends z.ZodType>(d: ToolDef<S>): ToolDef<S> => d;
