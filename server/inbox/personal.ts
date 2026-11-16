/**
 * Egasining shaxsiy Telegram'idagi «bemor emas» suhbatlar (E13). Telegram Business ham, shaxsiy akkaunt ham yozgan odam egasining
 * do'sti yoki qarindoshimi — aytmaydi (Bot API'da kontakt belgisi yo'q). Shuning uchun egasi kartadagi «🙅 Bemor emas» tugmasini
 * bossa: karta va yozishma o'chiriladi, shu odamning keyingi xabarlari Palantir'ga umuman tushmaydi. «↩️ Qaytarish» — bekor qilish.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import type { LeadRow } from '../db';
import { settings } from '../serviceStore';
import { workRow } from './workChats';

/** Egasining shaxsiy Telegram'i orqali kelgan mijozlar (bot va Instagram — har doim mijoz, ularga tugma chiqmaydi) */
export const PERSONAL_SOURCES = ['Telegram (Business)', 'Telegram (shaxsiy)'];
/** Bir biznesda eslab qolinadigan shaxsiy suhbatlar (eng eskisi tushib qoladi) */
const MAX_PERSONAL = 500;
const key = (bizId: string) => `tg:personal:${bizId}`;

function list(bizId: string): string[] {
  try {
    const raw: unknown = JSON.parse(settings.all().find(r => r.name === key(bizId))?.value ?? '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}
const save = (bizId: string, ids: string[]): void => { settings.set(key(bizId), JSON.stringify(ids.slice(-MAX_PERSONAL))); };

export const personalChats = {
  has: (bizId: string, tgUserId: string): boolean => list(bizId).includes(tgUserId),
  add: (bizId: string, tgUserId: string): void => save(bizId, [...list(bizId).filter(id => id !== tgUserId), tgUserId]),
  remove: (bizId: string, tgUserId: string): void => save(bizId, list(bizId).filter(id => id !== tgUserId)),
};

/** Kartada «Bemor emas» tugmasi chiqadimi: shaxsiy Telegram'dan kelgan va DentaCRM bemoriga bog'lanmagan mijoz */
export const canMarkPersonal = (lead: Pick<LeadRow, 'channel' | 'tgUserId' | 'source' | 'patientId'>): boolean =>
  lead.channel === 'telegram' && !!lead.tgUserId && !lead.patientId && PERSONAL_SOURCES.includes(lead.source ?? '');

/** Ikki tanlov: do'st yoki qarindosh (umuman tushmaydi) va ish bo'yicha yozgan (Kotib kuzatadi, workChats.ts) */
export const personalRow = (leadId: string): InlineKeyboardButton[] => [Markup.button.callback("🙅 Do'st, bemor emas", `np|${leadId}`), workRow(leadId)];
export const undoPersonalRow = (tgUserId: string): InlineKeyboardButton[] => [Markup.button.callback('↩️ Qaytarish — bu bemor', `nu|${tgUserId}`)];
