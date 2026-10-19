/** Asboblar uchun umumiy turlar (tools.ts va crm/tools.ts bir-birini import qilmasligi uchun alohida) */
import type { z } from 'zod';
import type { Artifact } from '../src/types';
import type { BusinessRow } from './db';

/** Rasm bilan kelgan gapda tasdiqsiz yozadigan asbob chaqirilganda */
export const PHOTO_REFUSAL = "Bu ish rasm asosida bajarilmaydi — egasi shu so'rovni matn bilan yozsin";

/** Mijozlar yozgan matn o'qilgan javobda doimiy bilimga yozadigan asbob chaqirilganda */
export const UNATTENDED_REFUSAL = "Jadval bo'yicha (egasi kuzatmay turganda) bu ish bajarilmaydi — natijani egasiga yozing, u o'zi aytsin";
export const STRANGER_REFUSAL = "Bu ish mijozlar yozgan matn o'qilgan javobda bajarilmaydi — egasi nimani saqlashni keyingi xabarda o'zi aytsin";

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
  /** Shu javob davomida mijozlar yozgan matn o'qildi (yozishma, mijozlar ro'yxati): u ham begona matn */
  readStrangers?: boolean;
  /** Shu gapda qo'shilgan mijozlar soni (chegara: tools.ts MAX_LEADS_PER_TURN) */
  leadsSaved?: number;
  /** Shu javob davomida kameraga necha marta qaraldi (chegara: camera/tools.ts) */
  cameraLooks?: number;
}

/** Doimiy bilimga (fakt, narx, sahifa) yozishdan oldin: begona matn — rasmdagi yozuv yoki mijozning xabari — shu yo'l bilan bilimga aylanmasin */
export function assertOwnWords(ctx: ToolCtx): void {
  if (ctx.fromPhoto) throw new ToolError(PHOTO_REFUSAL);
  if (ctx.unattended) throw new ToolError(UNATTENDED_REFUSAL);
  if (ctx.readStrangers) throw new ToolError(STRANGER_REFUSAL);
}

export interface ToolDef<S extends z.ZodType> {
  description: string;
  input: S;
  run: (input: z.infer<S>, ctx: ToolCtx) => unknown | Promise<unknown>;
}

/** Xato: Claude'ga is_error bilan qaytadi */
export class ToolError extends Error {}

export const def = <S extends z.ZodType>(d: ToolDef<S>): ToolDef<S> => d;
