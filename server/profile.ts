/**
 * Bitta kompyuter — bitta ish (env.oneProfile, o'rnatgich yoqadi). Litsenziya kompyuterga bog'langan: shu kompyuterda ikkinchi
 * klinika yoki boshqa ish ochilsa, bir marta sotilgan dastur ikki joyga ishlab ketadi. Shuning uchun:
 *
 *   1. Profil o'rnatishda o'zi yaratiladi (bazada biznes yo'q bo'lsa) — admin sahifasida ikkinchisini ochib bo'lmaydi.
 *   2. Sozlash bosqichi: egasiga topshirilguncha Palantir xodimi (o'rnatuvchi) profilga parolsiz kiradi — shu kompyuterning o'zidan
 *      yoki Hub'dagi «Panelni ochish» bilan masofadan (egasi hali yo'q, so'raladigan odam yo'q). Klinika tarmog'idagi boshqa
 *      kompyuterdan va Hub'ning oddiy /c/ havolasidan — yo'q.
 *   3. «Egasiga topshirish»: login va yangi parol bir marta ko'rsatiladi, avvalgi hamma kirishlar bekor. Shundan keyin jamoa —
 *      faqat egasining Telegram'dagi ruxsati bilan (http.ts, /api/login/support).
 *
 * Bu qoidadan oldin o'rnatilgan kompyuter (profilni admin ochgan) — allaqachon topshirilgan hisoblanadi: unda egasi bor.
 */
import { randomInt } from 'node:crypto';
import { env } from './env';
import { businesses, type BusinessRow } from './db';
import { settings } from './serviceStore';
import { hashPassword } from './auth';
import { staff } from './requests/store';
import { emptyBusiness } from './validate';

/** Profilni o'rnatish o'zi yaratgan (shu belgi bo'lmasa — eski o'rnatish, egasi bor) */
const AUTO = 'profile.auto';
/** Egasiga topshirilgan payt (ISO) */
const HANDED = 'profile.handover';
export const DEFAULT_NAME = 'Yangi biznes';
const DEFAULT_LOGIN = 'klinika';

const has = (name: string) => settings.all().some(r => r.name === name);

/** Hub kodi qo'lda (sotuvchidan olingan) kiritilgan — o'zi ulangan (hubJoin.ts, tasdiqlanmagan) emas */
const HUB_CODE = 'hub.code';
export const markHubCode = (): void => { settings.set(HUB_CODE, new Date().toISOString()); };
/** Hub bilan aloqa: code — sotuvchi bergan kod bilan (yozuv tasdiqlangan); self — o'zi ro'yxatdan o'tgan (sotuvchi tasdiqlashi kerak) */
export function hubVia(): 'code' | 'self' | null {
  if (!env.hub) return null;
  return !has(HUB_CODE) && has('hub.joined') ? 'self' : 'code';
}

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Egasiga beriladigan parol: o'qish oson (o'xshash harflarsiz), 12 belgi */
export const newOwnerPassword = (len = 12): string => Array.from({ length: len }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');

/** Bitta-profil rejimida: bazada biznes yo'q bo'lsa — yaratadi (parolni hech kim bilmaydi: topshirishda beriladi) */
export function ensureProfile(): BusinessRow | null {
  if (!env.oneProfile) return null;
  const existing = businesses.all();
  if (existing.length) return existing[existing.length - 1];
  const b = businesses.create(DEFAULT_LOGIN, hashPassword(newOwnerPassword(24)), emptyBusiness(DEFAULT_NAME, ''));
  settings.set(AUTO, new Date().toISOString());
  console.log("[profil] bu kompyuterning profili yaratildi — egasiga topshirilguncha sozlash bosqichi");
  return b;
}

/** Egasiga hali topshirilmagan: o'rnatuvchi parolsiz sozlaydi */
export const inSetup = (): boolean => env.oneProfile && has(AUTO) && !has(HANDED);

/** Yangi profil ochish mumkinmi (admin sahifasi). Mumkin bo'lmasa — sabab */
export function createBlocked(): string | null {
  if (!env.oneProfile || !businesses.all().length) return null;
  return "Bu kompyuterda profil bor — bitta kompyuter, bitta ish. Boshqa klinikaga alohida kompyuter va litsenziya kerak";
}

/** Shu kompyuterning profili (bitta-profil rejimida) */
export function theProfile(): BusinessRow | undefined {
  const all = businesses.all().filter(b => b.active);
  return all[all.length - 1];
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

/** Egasiga topshirish: login (bo'sh bo'lsa — eskisi) va yangi parol; hamma kirishlar bekor. Qaytadi — egasiga beriladigan ma'lumot */
export function handOver(biz: BusinessRow, wantedLogin: string | undefined): { login: string; password: string } {
  if (!inSetup()) throw new Error('Profil allaqachon egasiga topshirilgan');
  const login = (wantedLogin ?? '').trim().toLowerCase() || biz.login;
  if (!LOGIN_RE.test(login)) throw new Error("Login: 3–32 ta lotin harfi, raqam, nuqta yoki chiziqcha");
  const taken = businesses.byLogin(login);
  if ((taken && taken.id !== biz.id) || staff.byLogin(login)) throw new Error('Bu login band');
  const password = newOwnerPassword();
  businesses.update(biz.id, { login, passwordHash: hashPassword(password) });
  businesses.revokeSessions(biz.id);
  // Sozlash paytida ochilgan jamoa kirishi ham bekor: endi — egasining ruxsati bilan
  businesses.closeSupport(biz.id);
  settings.set(HANDED, new Date().toISOString());
  return { login, password };
}
