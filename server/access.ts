/**
 * Klinika xodimlarining panelda nima qila olishi (server/teamAccess.ts kirish beradi, http.ts har so'rovda tekshiradi).
 *
 *   reception (qabulxona) — faqat Qabulxona: so'rovlar, yozishmalar, qo'ng'iroqlar, mijozlar. Pul (kunlik tushum ham), tahlil, AI
 *                           xodimlarga topshiriq, Direktor takliflari, Yordamchi bilan suhbat va uning xotirasi, kameralar, Miya va
 *                           sozlamalar — yo'q. Mijoz kartasini butunlay o'chirish (qaytarib bo'lmaydi) ham — yo'q.
 *   manager (boshqaruvchi) — hammasi, egasining o'zinikidan tashqari: kirish va parollar, xodimlar, klinika kalitlari, ulash ustasi,
 *                           Telegram/Instagram/Meta AI akkauntlarini ulash, telefon liniyasi, pul yozuvlarini tasdiqlash.
 * Egasining o'ziga (asOwner) tegishli yo'llar xodimga baribir yopiq — bu ro'yxat ularning ustiga qo'shiladi.
 * Yo'l kichik harf bilan keladi (Express harf kattaligiga qaramaydi).
 */
import type { StaffAccess } from '../src/types';

/** Hech bir xodimga: egasining kirishi, kalitlar, akkauntlarni ulash, pul tasdig'i, xodimlarni boshqarish */
const OWNER_ONLY = /^\/api\/(account|handover|keys|setup|anketa|admin|team-access|telegram-user|instagram|meta-ai)(\/|$)|^\/api\/phone\/(line|stations|station\/pair)(\/|$)|^\/api\/crm\/money\/|^\/api\/voice\/key(\/|$)/;
/**
 * Qabulxona xodimi ochadigan bo'limlar (har qanday so'rov turi). Yo'q: crm/day — kunlik tushum va qarzlar; attention — Direktor
 * takliflari va kamera hodisalari; notes — Yordamchining xotirasi (xodim yozgani egasining so'zi bo'lib mijozlarga javobga tushardi)
 */
const RECEPTION = /^\/api\/(me|requests|inbox|replies|leads|calls|team\/day|tasks|followups|crm\/find|phone\/dial|agents\/qabulxona)(\/|$)/;
/** Qabulxona xodimi faqat o'qiydi: xodimlar ro'yxati (kimga topshirish), bosh ko'rsatkichlar, telefon holati */
const RECEPTION_READ = /^\/api\/(staff|dashboard|phone)$/;

export function staffMay(access: StaffAccess, method: string, path: string): boolean {
  if (OWNER_ONLY.test(path)) return false;
  // Xodimlar ro'yxatini (kim so'rov oladi) faqat egasi o'zgartiradi
  if (/^\/api\/staff(\/|$)/.test(path) && method !== 'GET') return false;
  if (access === 'manager') return true;
  // Mijoz kartasi va unga bog'liq hamma narsa butunlay o'chadi (forget.ts) — qaytarib bo'lmaydigan ish egasi yoki boshqaruvchiniki
  if (method === 'DELETE' && /^\/api\/leads(\/|$)/.test(path)) return false;
  return RECEPTION.test(path) || (method === 'GET' && RECEPTION_READ.test(path));
}
