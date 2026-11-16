/**
 * Ishlash holati — sotuvchi Hub'dan boshqaradi (to'lov nazorati; hub/server.ts 15-band). Hub har heartbeat javobida shu kompyuter
 * kodiga imzolangan holatni beradi (hub/licenseKey.ts issueAccess); faqat imzolisi qabul qilinadi — soxta «Hub» qo'yib bloklashni
 * olib tashlab bo'lmaydi.
 *   active  — to'liq ishlaydi;
 *   warn    — panelda sotuvchining eslatmasi (masalan to'lov muddati), hammasi ishlaydi;
 *   blocked — panel yopiq (Palantir jamoasining masofadan kirishi bundan mustasno), AI so'rovlari yuborilmaydi (claude.ts metered),
 *             qo'ng'iroqlarni faqat administrator oladi (voice/routes.ts), Telegram bot va eslatmalar ishlaydi — egasi xabarni oladi.
 *
 * Aloqasiz muddat: imzoli YANGI javob (Hub vaqti oldingisidan keyin) 23 kun kelmasa — eslatma, 30 kun — to'xtaydi (OFFLINE_*).
 * Muddat kompyuter soatining farqidan emas, o'tgan vaqtni yig'ib sanaladi (tickAccess, heartbeat har 5 daqiqada): soatni orqaga
 * surish hisobni to'xtatmaydi va qaytadan boshlamaydi; soat oldinda bo'lsa ham yangi javob kelishi bilan hisob nolga tushadi (o'zini
 * bloklab qo'ymaydi). Eski javobni qayta yuborish (soxta Hub) hisobni nolga tushirmaydi — Hub vaqti qat'iy yangi bo'lishi kerak.
 * Hub hech qachon imzoli holat bermagan bo'lsa (Hub yo'q yoki eski Hub) — hech narsa to'xtamaydi. Imzo rad etilsa (kalit mos emas) —
 * jurnalga va Hub'ga (heartbeat: access.rejected) — sotuvchi 30 kun tugashidan oldin ko'radi.
 * Tarif (modullar): imzoli javobdagi ruxsat berilgan modullar (hub/licenseKey.ts MODULES) — tarifda yo'q AI xodim jamoada ko'rinmaydi va
 * fonda ishlamaydi (src/lib/crew.ts setCrewLicense), «telefon» yo'q bo'lsa qo'ng'iroqni administrator oladi (voice/routes.ts, line.ts).
 * Hub modul tanlamagan yoki hech qachon javob bermagan — hammasi ruxsat. Aloqasiz 30 kunda to'xtash tarifga bog'liq emas (yuqorida).
 * Saqlanadi: bazada (settings `hub.access`) — oxirgi imzoli javob va yig'ilgan aloqasiz vaqt; har o'qishda imzo qayta tekshiriladi.
 */
import { checkAccess, type AccessGrant, type AccessState, type Module } from '../hub/licenseKey';
import { setCrewLicense } from '../src/lib/crew';
import { env } from './env';
import { machineId } from './license';
import { settings } from './serviceStore';

const DB_KEY = 'hub.access';
const DAY_MS = 86_400_000;
/** Imzoli javobsiz shuncha kundan keyin — eslatma */
export const OFFLINE_WARN_DAYS = 23;
/** Imzoli javobsiz shuncha kundan keyin — to'xtaydi (Hub serverimizning o'zi bir-ikki kun yotib qolishi mumkin — klinika bundan aziyat chekmasin) */
export const OFFLINE_BLOCK_DAYS = 30;
const TOKEN_MAX = 2_000;

export interface AccessView {
  state: AccessState;
  /** Sotuvchining matni (warn/blocked) */
  message: string;
  /** hub — sotuvchi qo'ygan; offline — uzoq vaqt imzoli javob kelmagan; null — to'liq ishlaydi */
  reason: 'hub' | 'offline' | null;
  /** Oxirgi yangi imzoli javobdan beri kunlar (javob hali kelmagan bo'lsa — null) */
  offlineDays: number | null;
}

/** Bloklangan paytda AI so'rovi yuborilmaydi (claude.ts metered) */
export class AccessBlockedError extends Error {
  constructor() { super("Palantir to'xtatilgan — sotuvchiga murojaat qiling"); }
}

/** token — oxirgi imzoli javob; elapsed — undan beri yig'ilgan vaqt (ms); tick — elapsed oxirgi marta qo'shilgan mahalliy payt */
interface Stored { grant: AccessGrant; token: string; elapsed: number; tick: number }
let cache: Stored | null | undefined;
/** Oxirgi javobning imzosi tekshiruvdan o'tmadi (Hub'ga aytiladi) */
let rejected = false;
const verify = (token: string) => checkAccess(token, machineId(), env.licensePublicKey || undefined);

function stored(): Stored | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    const raw = settings.all().find(r => r.name === DB_KEY)?.value;
    const j = raw ? JSON.parse(raw) as Partial<Stored> : null;
    const grant = j && typeof j.token === 'string' ? verify(j.token) : null;
    if (j && grant) cache = { grant, token: j.token!, elapsed: Math.max(0, Number(j.elapsed) || 0), tick: Number(j.tick) || 0 };
  } catch { /* buzuq yozuv — holat yo'q */ }
  return cache;
}

function save(s: Stored): void {
  cache = s;
  try {
    settings.set(DB_KEY, JSON.stringify({ token: s.token, elapsed: s.elapsed, tick: s.tick }));
  } catch (e) {
    // Xotirada qoladi: keyingi heartbeat yana yozishga urinadi
    console.error('[hub] ishlash holati bazaga saqlanmadi:', (e as Error).message);
  }
}

/** Kompyuter soati orqaga ketsa — qo'shilmaydi (lekin hisob ham qaytmaydi) */
const grown = (s: Stored, now: number) => s.elapsed + Math.max(0, now - s.tick);

/**
 * Hub javobidagi holat: imzosi to'g'ri va Hub vaqti saqlanganidan qat'iy keyin bo'lsa — saqlanadi, aloqasiz hisob nolga tushadi.
 * true — holat yangilandi
 */
export function noteAccess(token: unknown, now = Date.now()): boolean {
  if (token === undefined || token === null) return false;
  if (typeof token !== 'string' || !token || token.length > TOKEN_MAX) return reject('buzuq javob');
  const grant = verify(token);
  if (!grant) return reject("imzo yoki kompyuter kodi mos emas");
  rejected = false;
  const prev = stored();
  if (prev && Date.parse(grant.at) <= Date.parse(prev.grant.at)) return false;
  save({ grant, token, elapsed: 0, tick: now });
  return true;
}

function reject(why: string): false {
  if (!rejected) console.error(`[hub] ishlash holati qabul qilinmadi: ${why}`);
  rejected = true;
  return false;
}

/** O'tgan vaqtni yig'ib qo'yadi (heartbeat har safar, javobdan oldin) — soat orqaga surilsa ham hisob yo'qolmasin */
export function tickAccess(now = Date.now()): void {
  const s = stored();
  if (s) save({ ...s, elapsed: grown(s, now), tick: now });
}

/** Hozirgi holat (sof hisob — now berilsa sinovlar vaqtni boshqaradi) */
export function accessView(now = Date.now()): AccessView {
  const s = stored();
  if (!s) return { state: 'active', message: '', reason: null, offlineDays: null };
  const g = s.grant, days = Math.floor(grown(s, now) / DAY_MS);
  if (g.state === 'blocked') return { state: 'blocked', message: g.message, reason: 'hub', offlineDays: days };
  if (days >= OFFLINE_BLOCK_DAYS) return { state: 'blocked', message: '', reason: 'offline', offlineDays: days };
  if (g.state === 'warn') return { state: 'warn', message: g.message, reason: 'hub', offlineDays: days };
  if (days >= OFFLINE_WARN_DAYS) return { state: 'warn', message: '', reason: 'offline', offlineDays: days };
  return { state: 'active', message: '', reason: null, offlineDays: days };
}

export const accessBlocked = (now = Date.now()): boolean => accessView(now).state === 'blocked';
/** Hub'ga: oxirgi javob imzosi rad etildimi */
export const accessRejected = (): boolean => rejected;

/** Egasiga Telegram'da (HTML) — holat o'zgarganda bir marta (scheduler.ts warnAccess) */
export function accessNotice(v: AccessView, esc: (s: string) => string): string {
  const said = v.message ? `\n«${esc(v.message)}»` : '';
  if (v.state === 'blocked' && v.reason === 'offline') {
    return `🔒 <b>Palantir to'xtadi</b> — ${v.offlineDays} kundan beri Palantir serveri bilan aloqa yo'q. Internetni tekshiring yoki sotuvchiga qo'ng'iroq qiling.\n`
      + "Panel va AI xodimlar to'xtadi, qo'ng'iroqlarni administrator oladi. Aloqa tiklanishi bilan o'zi ochiladi.";
  }
  if (v.state === 'blocked') {
    return `🔒 <b>Palantir to'xtatildi</b> — sotuvchi qarori.${said}\nPanel va AI xodimlar to'xtadi, qo'ng'iroqlarni administrator oladi. Sotuvchiga murojaat qiling.`;
  }
  if (v.state === 'warn' && v.reason === 'offline') {
    return `⚠️ <b>Palantir serveri bilan ${v.offlineDays} kundan beri aloqa yo'q.</b> Internetni tekshiring: ${OFFLINE_BLOCK_DAYS} kun aloqa bo'lmasa, Palantir to'xtaydi.`;
  }
  if (v.state === 'warn') return `⚠️ <b>Sotuvchidan eslatma</b>${said || ' — sotuvchiga murojaat qiling.'}`;
  return '✅ <b>Palantir yana to\'liq ishlayapti.</b>';
}

/** Sinovlar uchun: saqlangan holatni qayta o'qish */
export function resetAccessCache(): void {
  cache = undefined;
  rejected = false;
}

/** Sotuvchi ruxsat bergan modullar; null — tanlanmagan (hammasi ruxsat) */
export const licensedModules = (): Module[] | null => stored()?.grant.modules ?? null;
/** Shu modul tarifdami */
export function moduleAllowed(m: Module): boolean {
  const list = licensedModules();
  return !list || list.includes(m);
}

// AI jamoa (src/lib/crew.ts) tarifni shu yerdan biladi: asosiy bo'lmagan xodimning nomi — modul nomi bilan bir xil (MODULES)
setCrewLicense(m => moduleAllowed(m as Module));
