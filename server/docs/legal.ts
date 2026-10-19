/** Korxona rekvizitlari matnda: yordamchi ko'rsatmasi (claude.ts), hujjat yozuvchi va tekshiruv (writer.ts) uchun bir xil */
import type { Business } from '../../src/types';

export interface LegalField { key: string; label: string; value: string }

/** To'ldirilgan rekvizitlar, hujjatdagi tartibda (manzil berilmagan bo'lsa — biznes manzili) */
export function legalFields(p: Business): LegalField[] {
  const l = p.legal ?? {};
  const rows: [string, string, string | undefined][] = [
    ['name', 'Yuridik nomi', l.name],
    ['address', 'Yuridik manzil', l.address || p.address],
    ['stir', 'STIR', l.stir],
    ['oked', 'OKED', l.oked],
    ['bank', 'Bank', l.bank],
    ['account', 'Hisob raqami (h/r)', l.account],
    ['mfo', 'MFO', l.mfo],
    ['director', 'Rahbar', l.director],
    ['basis', 'Rahbar ish yuritadi', l.basis],
    ['phone', 'Telefon', p.phone],
    ['email', 'E-mail', l.email],
  ];
  return rows.filter(([, , v]) => v?.trim()).map(([key, label, v]) => ({ key, label, value: v!.trim() }));
}

/** QQS holati so'z bilan: stavka, «to'lovchi emas» yoki noma'lum */
export function vatText(p: Business): string {
  const r = p.legal?.vatRate;
  return r === undefined ? "QQS holati: noma'lum" : r === 0 ? "QQS to'lovchisi emas (QQSsiz)" : `QQS to'lovchisi, stavka ${r}%`;
}

/** Model uchun blok: «Legal details» — bo'sh bo'lsa, buni ochiq aytadi (hujjatda to'qib qo'ymasin) */
export function legalText(p: Business): string {
  const fields = legalFields(p).filter(f => f.key !== 'phone');
  if (!p.legal || !fields.some(f => !['address'].includes(f.key))) return "Legal details: not filled in yet (Sozlamalar → Rekvizitlar) — never invent them.";
  return `Legal details (for contracts, invoices, acts):\n${fields.map(f => `- ${f.label}: ${f.value}`).join('\n')}\n- ${vatText(p)}`;
}
