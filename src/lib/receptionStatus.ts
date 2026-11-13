/**
 * Qabulxona (AI administrator) kartasidagi holat — bosh ekran va AI jamoa (components/team.tsx): qaysi kanal ulangan (yozishma: bot,
 * Telegram Business, Instagram; telefon: shahar raqami) va javob rejimi. «Navbatchilikda» faqat haqiqatan o'zi javob beradigan
 * bo'lsa: «tasdiqlayman» rejimida bemor tunda faqat «yetkazildi» oladi — buni egasi kartada ko'rishi kerak
 */
import { hrefOf } from './nav';

export type ReplyMode = 'off' | 'draft' | 'auto';
export interface ReceptionInput {
  /** Hozir qo'ng'iroq bo'lyapti */
  talking: boolean;
  /** Yozishma kanali ulangan: bot, Telegram Business yoki Instagram */
  text: boolean;
  /** Telefon liniyasi (shahar raqami) ulangan — telefondagi AI javob beradi */
  phone: boolean;
  mode: ReplyMode;
}
export interface ReceptionState { on: boolean; status: string; next: { label: string; href: string } | null }

export function receptionStatus(i: ReceptionInput): ReceptionState {
  if (i.talking) return { on: true, status: 'Hozir qo‘ng‘iroqda', next: null };
  if (!i.text && !i.phone) return { on: false, status: 'Kanal ulanmagan', next: { label: 'Telegram, Instagram yoki telefonni ulash', href: hrefOf('sozlamalar', 'telegram') } };
  if (i.mode === 'auto') return { on: true, status: 'Navbatchilikda', next: null };
  const mode = { label: '«O‘zi javob bersin» rejimini yoqish', href: hrefOf('sozlamalar', 'asosiy') };
  const writing = i.mode === 'off' ? 'yozishmalarga javob o‘chiq' : 'yozishmadagi javoblarni siz tasdiqlaysiz';
  if (i.phone) return { on: true, status: `Telefonda navbatchi · ${writing}`, next: i.text ? mode : null };
  return { on: i.mode !== 'off', status: i.mode === 'off' ? 'Javob berish o‘chiq' : 'Javoblarni siz tasdiqlaysiz', next: mode };
}
