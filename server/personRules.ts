/**
 * Ikki mijoz kartasi bir odamnikimi — sof qoidalar (bazaga tegmaydi; people.ts va sinovlar ishlatadi).
 *
 * Telefon bir xil bo'lishi yetmaydi: bir telefonda oila a'zolari bo'ladi. Ziddiyat — boshqa-boshqa Telegram yoki Instagram akkaunt,
 * boshqa-boshqa DentaCRM bemori yoki umumiy so'zi yo'q ismlar. Telegram va Instagram'dagi ism ko'pincha laqab («Mijoz», «Dilya»):
 * bitta so'zli ism umumiy so'z yoki bir xil boshlansa («Dilya» — «Dilnoza») mos, aks holda — boshqa odam (E6: oila telefonidagi
 * «Zarina» va «Vali Valiyev» bir kartaga qo'shilardi — qo'shish qaytarilmaydi, takror karta esa zararsiz).
 * Solishtirish yozilishiga qaramaydi: Valiyev / Valiev / Валиев (crm/logic nameKey).
 */
import type { LeadRow } from './db';
import { cleanName, nameKey, resolvePatient, type Patient } from './crm/logic';
import { phoneKey } from '../src/lib/phone';

const words = (s: string | null) => cleanName(s ?? '').toLowerCase().split(' ').filter(w => w.length > 1);

/** Ism o'rnida turadigan umumiy so'zlar (laqab ham emas): bunday karta istalgan ism bilan mos */
const GENERIC = new Set(['mijoz', 'bemor', 'klient', 'client', 'kliyent', 'pasient', 'patient', 'user', 'foydalanuvchi', 'mexmon', 'guest', 'anonim', 'nomalum', 'admin']);
/** Laqab: shuncha birinchi harfi bir xil («Dilya» — «Dilnoza», «Ali» — «Alisher») */
const NICK_PREFIX = 3;
const keys = (s: string | null) => words(s).map(nameKey).filter(Boolean);

export function namesFit(a: string | null, b: string | null): boolean {
  const [x, y] = [keys(a), keys(b)];
  if (!x.length || !y.length) return true;
  if (x.length >= 2 && y.length >= 2) return y.some(w => x.includes(w));
  if (x.some(w => GENERIC.has(w)) || y.some(w => GENERIC.has(w))) return true;
  const nick = (w: string, v: string) => w.length >= NICK_PREFIX && v.length >= NICK_PREFIX && w.slice(0, NICK_PREFIX) === v.slice(0, NICK_PREFIX);
  return x.some(w => y.some(v => w === v || nick(w, v)));
}

const differ = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a !== b;

export function samePerson(a: Pick<LeadRow, 'tgUserId' | 'igUserId' | 'patientId' | 'name'>, b: Pick<LeadRow, 'tgUserId' | 'igUserId' | 'patientId' | 'name'>): boolean {
  if (differ(a.tgUserId, b.tgUserId) || differ(a.igUserId, b.igUserId) || differ(a.patientId, b.patientId)) return false;
  return namesFit(a.name, b.name);
}

/**
 * Raqam qayerdan: verified — Telegram tugmasi bilan yuborilgan kontakt, egasi yoki xodim kiritgan, qo'ng'iroq qilgan raqam; chat — yozishmada
 * aytilgan (model ajratgan, tasdiqlanmagan: xato yozilgan yoki birovniki bo'lishi mumkin)
 */
export type PhoneTrust = 'verified' | 'chat';

/**
 * Yozishmada aytilgan raqam bilan qaysi karta yig'iladi (E6): faqat o'z messenjer akkaunti va DentaCRM bemori yo'q karta (qo'ng'iroq yoki
 * qo'lda qo'shilgan). Boshqa Telegram/Instagram odamining kartasi bunday raqam bilan qo'shilmaydi — qo'shish qaytarib bo'lmaydi, javob esa
 * oxirgi yozgan kanalga, ya'ni boshqa odamga ketib qolardi
 */
export const chatMergeable = (l: Pick<LeadRow, 'tgUserId' | 'igUserId' | 'patientId'>): boolean => !l.tgUserId && !l.igUserId && !l.patientId;

/** Ikki ismda umumiy so'z bormi («Dilnoza» va «Dilnoza Karimova» — ha; «Zarina» va «Vali Valiyev» — yo'q) */
export const shareWord = (a: string | null, b: string | null): boolean => {
  const set = new Set(words(a));
  return words(b).some(w => set.has(w));
};

/** Ikki ismdan to'liqrog'i (ko'proq so'zli): «Malika» va «Malika Yusupova» dan ikkinchisi */
export const fullerName = (a: string | null, b: string | null): string | null => (words(b).length > words(a).length ? b : a);

/** Telefon bo'yicha DentaCRM bemori: to'liq ism mos kelgani; to'liq ism yo'q bo'lsa — shu telefondagi yagona bemor */
export function patientFor(list: Patient[], name: string | null, phone: string): Patient | null {
  if (words(name).length >= 2) return resolvePatient(list, name!, phone).patient;
  const key = phoneKey(phone);
  const sharing = key ? list.filter(p => phoneKey(p.phone) === key || phoneKey(p.secondaryPhone) === key) : [];
  return sharing.length === 1 ? sharing[0] : null;
}

/** Botda «Raqamni yuborish» tugmasi bilan yuborilgan o'z raqami: Telegram akkaunti va raqam birga — boshqa akkauntga yoki raqamga o'tmaydi */
export const proofFor = (tgUserId: string, phone: string): string => `${tgUserId}:${phoneKey(phone)}`;

/** Karta telefoni Telegram tasdiqlagan raqammi (yozishmada aytilgan raqam — tasdiq emas) */
export function phoneVerified(l: Pick<LeadRow, 'tgUserId' | 'phone' | 'phoneProof'>): boolean {
  return !!l.tgUserId && !!l.phone && l.phoneProof === proofFor(l.tgUserId, l.phone);
}

/** Tasdiqlangan raqam bemorning o'zinikimi (DentaCRM kartasidagi asosiy yoki qo'shimcha raqam) */
export const patientHasPhone = (p: Pick<Patient, 'phone' | 'secondaryPhone'>, phone: string): boolean =>
  !!phoneKey(phone) && (phoneKey(p.phone) === phoneKey(phone) || phoneKey(p.secondaryPhone) === phoneKey(phone));
