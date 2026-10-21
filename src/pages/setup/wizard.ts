/**
 * Ulash ustasi: qadamlar ro'yxati va har qadamning holati (sof funksiya — yon panel belgilari shundan chiziladi).
 * Holat serverdan keladi (LiveStatus, o'rnatish holati, kalitlar), shuning uchun sahifa yangilansa ham to'g'ri ko'rinadi.
 */
import type { KeyView, LiveStatus, SetupView } from '../../types';

export type StepKey = 'clinic' | 'keys' | 'owner' | 'crm' | 'cams' | 'tg' | 'ig' | 'gaps' | 'done';
/** ok — tayyor; warn — chala (keyin qaytsa ham bo'ladi); skip — bu klinikaga kerak emas; '' — hali qilinmagan */
export type StepState = 'ok' | 'warn' | 'skip' | '';

export interface StepInfo { key: StepKey; title: string; lead: string }
export const STEPS: StepInfo[] = [
  { key: 'clinic', title: 'Klinika', lead: "Qaysi klinikani ulayapmiz. Egasi anketani oldindan to'ldirgan bo'lsa — kodini kiriting: manzil, narxlar va javoblar shu kompyuterga tushadi." },
  { key: 'keys', title: 'Kalitlar', lead: "Bot tokeni, AI kalitlari, kamera manzili, DentaCRM havolasi — hammasini bitta maydonga qo'ying. Palantir har birining turini o'zi taniydi va darhol tekshiradi." },
  { key: 'owner', title: "Egasining Telegram'i", lead: "Egasi yordamchi bilan shu botda gaplashadi: eslatmalar, ertalabki xulosa, mijozlarga javob takliflari unga keladi." },
  { key: 'crm', title: 'DentaCRM', lead: "Qabullar, kelgan-kelmaganlar va tushum Palantir'ga shu yerdan keladi." },
  { key: 'cams', title: 'Kameralar', lead: "Palantir klinika tarmog'idagi kameralarni o'zi topadi. Siz login-parolni kiritasiz va kamera qayerda turganini yozasiz." },
  { key: 'tg', title: 'Shaxsiy Telegram', lead: "Klinika raqamidagi Telegram: mijozlar shu yerga yozadi. Palantir javob taklif qiladi, egasi tasdiqlamaguncha hech narsa yuborilmaydi." },
  { key: 'ig', title: 'Instagram', lead: "Instagram Direct'dagi yozishmalar ham shu navbatga tushadi." },
  { key: 'gaps', title: "Bo'shliqlar", lead: "Palantir hamma ma'lumotni tekshirib, yetishmagan va bir-biriga zid joylarni topdi. Egasiga Telegram'da bittalab so'raydi — egasi tugmani bosib javob beradi." },
  { key: 'done', title: 'Tayyor', lead: "Klinikadan ketishdan oldin oxirgi ko'rinish." },
];

/** Shu serverdagi qadamlar: shaxsiy Telegram keyinga qoldirilgan bo'lsa (TG_PERSONAL) uning qadami ko'rinmaydi */
export const visibleSteps = (s: LiveStatus | null): StepInfo[] => STEPS.filter(x => x.key !== 'tg' || !!s?.telegramUser.enabled);

export interface WizardFacts {
  hasBiz: boolean;
  status: LiveStatus | null;
  setup: SetupView | null;
  keys: KeyView[] | null;
  /** Shu biznesning IP kameralari soni */
  cameras: number;
}

export function stepState(key: StepKey, f: WizardFacts): StepState {
  const s = f.status, setup = f.setup;
  switch (key) {
    case 'clinic': return f.hasBiz ? 'ok' : '';
    case 'keys': {
      if (!f.keys) return '';
      const required = f.keys.filter(k => k.required);
      if (required.every(k => k.source)) return 'ok';
      return f.keys.some(k => k.source) ? 'warn' : '';
    }
    case 'owner': return s?.ownerLinked ? 'ok' : '';
    case 'crm':
      if (s?.crm.account) return s.crm.problem ? 'warn' : 'ok';
      return setup?.has.crm === 'none' || setup?.has.crm === 'other' ? 'skip' : '';
    case 'cams': return f.cameras > 0 ? 'ok' : setup && setup.has.cameras === 0 && setup.anketa ? 'skip' : '';
    case 'tg': return s?.telegramUser.account ? 'ok' : s && !s.telegramUser.available ? 'warn' : '';
    case 'ig': {
      // Rasmiy ulanish asosiy; brauzer orqali — zaxira (yoqilgan bo'lsa)
      const account = s?.instagramApi.account || s?.instagram.account;
      const problem = s?.instagramApi.account ? s.instagramApi.problem : s?.instagram.problem;
      return account ? (problem ? 'warn' : 'ok') : '';
    }
    case 'gaps': {
      if (!setup) return '';
      return !setup.gaps.length && setup.pack.answered === setup.pack.total ? 'ok' : 'warn';
    }
    default: return '';
  }
}

/** Login nomzodi: klinika nomidan lotin harflari («Shifo Dent» → shifodent) */
export const loginFrom = (name: string): string => name.toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 24);

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Egasiga beriladigan parol: o'qish oson (o'xshash harflarsiz), 12 belgi */
export function newPassword(len = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

/** O'tgan vaqt «07:42» (soatdan oshsa «1:07:42») */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}
