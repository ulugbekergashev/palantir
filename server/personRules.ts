/**
 * Ikki mijoz kartasi bir odamnikimi — sof qoidalar (bazaga tegmaydi; people.ts va sinovlar ishlatadi).
 *
 * Telefon bir xil bo'lishi yetmaydi: bir telefonda oila a'zolari bo'ladi. Ziddiyat — boshqa-boshqa Telegram yoki Instagram akkaunt,
 * boshqa-boshqa DentaCRM bemori yoki ikkalasi ham to'liq (ism va familiya), lekin umumiy so'zi yo'q ism. Telegram va Instagram'dagi
 * ism ko'pincha laqab («Mijoz», «Dilya») — bitta so'zli ism ziddiyat emas.
 */
import type { LeadRow } from './db';
import { cleanName, resolvePatient, type Patient } from './crm/logic';
import { phoneKey } from '../src/lib/phone';

const words = (s: string | null) => cleanName(s ?? '').toLowerCase().split(' ').filter(w => w.length > 1);

export function namesFit(a: string | null, b: string | null): boolean {
  const [x, y] = [words(a), words(b)];
  if (x.length < 2 || y.length < 2) return true;
  const set = new Set(x);
  return y.some(w => set.has(w));
}

const differ = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a !== b;

export function samePerson(a: Pick<LeadRow, 'tgUserId' | 'igUserId' | 'patientId' | 'name'>, b: Pick<LeadRow, 'tgUserId' | 'igUserId' | 'patientId' | 'name'>): boolean {
  if (differ(a.tgUserId, b.tgUserId) || differ(a.igUserId, b.igUserId) || differ(a.patientId, b.patientId)) return false;
  return namesFit(a.name, b.name);
}

/** Ikki ismdan to'liqrog'i (ko'proq so'zli): «Malika» va «Malika Yusupova» dan ikkinchisi */
export const fullerName = (a: string | null, b: string | null): string | null => (words(b).length > words(a).length ? b : a);

/** Telefon bo'yicha DentaCRM bemori: to'liq ism mos kelgani; to'liq ism yo'q bo'lsa — shu telefondagi yagona bemor */
export function patientFor(list: Patient[], name: string | null, phone: string): Patient | null {
  if (words(name).length >= 2) return resolvePatient(list, name!, phone).patient;
  const key = phoneKey(phone);
  const sharing = key ? list.filter(p => phoneKey(p.phone) === key || phoneKey(p.secondaryPhone) === key) : [];
  return sharing.length === 1 ? sharing[0] : null;
}
