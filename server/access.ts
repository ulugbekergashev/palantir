/**
 * Klinika xodimlarining panelda nima qila olishi (server/teamAccess.ts kirish beradi, http.ts har so'rovda tekshiradi).
 *
 *   reception (qabulxona) — faqat Qabulxona: so'rovlar, yozishmalar, qo'ng'iroqlar, mijozlar. Pul, tahlil, AI xodimlarga
 *                           topshiriq, Yordamchi bilan suhbat, kameralar, Miya va sozlamalar — yo'q.
 *   manager (boshqaruvchi) — hammasi, egasining o'zinikidan tashqari: kirish va parollar, xodimlar, klinika kalitlari, ulash ustasi,
 *                           Telegram/Instagram/Meta AI akkauntlarini ulash, telefon liniyasi, pul yozuvlarini tasdiqlash.
 * Egasining o'ziga (asOwner) tegishli yo'llar xodimga baribir yopiq — bu ro'yxat ularning ustiga qo'shiladi.
 * Yo'l kichik harf bilan keladi (Express harf kattaligiga qaramaydi).
 */
import type { StaffAccess } from '../src/types';

/** Hech bir xodimga: egasining kirishi, kalitlar, akkauntlarni ulash, pul tasdig'i, xodimlarni boshqarish */
const OWNER_ONLY = /^\/api\/(account|handover|keys|setup|anketa|admin|team-access|telegram-user|instagram|meta-ai)(\/|$)|^\/api\/phone\/(line|stations|station\/pair)(\/|$)|^\/api\/crm\/money\/|^\/api\/voice\/key(\/|$)/;
/** Qabulxona xodimi ochadigan bo'limlar (har qanday so'rov turi) */
const RECEPTION = /^\/api\/(me|requests|inbox|replies|leads|calls|attention|team\/day|tasks|notes|followups|crm\/(day|find)|phone\/dial|agents\/qabulxona)(\/|$)/;
/** Qabulxona xodimi faqat o'qiydi: xodimlar ro'yxati (kimga topshirish), bosh ko'rsatkichlar, telefon holati */
const RECEPTION_READ = /^\/api\/(staff|dashboard|phone)$/;

export function staffMay(access: StaffAccess, method: string, path: string): boolean {
  if (OWNER_ONLY.test(path)) return false;
  // Xodimlar ro'yxatini (kim so'rov oladi) faqat egasi o'zgartiradi
  if (/^\/api\/staff(\/|$)/.test(path) && method !== 'GET') return false;
  if (access === 'manager') return true;
  return RECEPTION.test(path) || (method === 'GET' && RECEPTION_READ.test(path));
}
