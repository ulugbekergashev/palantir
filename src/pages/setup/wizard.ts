/**
 * Ulash ustasi: qadamlar ro'yxati va har qadamning holati (sof funksiya — yon panel belgilari shundan chiziladi).
 * Holat serverdan keladi (LiveStatus, o'rnatish holati, kalitlar), shuning uchun sahifa yangilansa ham to'g'ri ko'rinadi.
 */
import type { PhoneLine } from '../../data/api';
import type { KeyView, LiveStatus, SetupView } from '../../types';

export type StepKey = 'clinic' | 'keys' | 'owner' | 'patients' | 'crm' | 'cams' | 'tg' | 'ig' | 'phone' | 'gaps' | 'done';
/** ok — tayyor; warn — chala (keyin qaytsa ham bo'ladi); skip — bu klinikaga kerak emas; '' — hali qilinmagan */
export type StepState = 'ok' | 'warn' | 'skip' | '';

/** optional — qo'shimcha (asosiy yo'l emas): qilinmagani «chala» sanalmaydi, usta oxiriga qo'yiladi (C3) */
export interface StepInfo { key: StepKey; title: string; lead: string; optional?: boolean }
export const STEPS: StepInfo[] = [
  { key: 'clinic', title: 'Klinika', lead: "Qaysi klinikani ulayapmiz. Manzil, ish vaqti va narxlarni keyin egasi Telegram'da aytadi — bot o'zi so'raydi." },
  { key: 'keys', title: 'Kalitlar', lead: "Bot tokeni, AI kalitlari, kamera manzili, DentaCRM havolasi — hammasini bitta maydonga qo'ying. Palantir har birining turini o'zi taniydi va darhol tekshiradi." },
  { key: 'owner', title: "Egasining Telegram'i", lead: "Egasi Palantir bilan shu botda gaplashadi: eslatmalar, ertalabki xulosa, mijozlarga javob takliflari unga keladi." },
  { key: 'patients', title: "Bemorlar Telegram'i", lead: "Bemorlar botga havola orqali yozadi (Instagram bio, vizitka, reklama); egasining shaxsiy Telegram'iga yozganlar — Telegram Business orqali. Palantir ikkalasiga ham javob beradi." },
  { key: 'crm', title: 'DentaCRM', lead: "Qabullar, kelgan-kelmaganlar va tushum Palantir'ga shu yerdan keladi." },
  { key: 'tg', title: 'Shaxsiy Telegram', lead: "Klinika raqamidagi Telegram: mijozlar shu yerga yozadi. Palantir javob taklif qiladi, egasi tasdiqlamaguncha hech narsa yuborilmaydi." },
  { key: 'ig', title: 'Instagram', lead: "Instagram Direct'dagi yozishmalar ham shu navbatga tushadi." },
  { key: 'phone', title: 'Telefon', lead: "Klinika raqamiga kelgan qo'ng'iroqlarga AI javob beradi. Zadarma kabinetidan Key va Secret'ni qo'ying — raqam, liniya va yo'naltirishni Palantir o'zi sozlaydi." },
  { key: 'gaps', title: "Bo'shliqlar", lead: "Palantir hamma ma'lumotni tekshirib, yetishmagan va bir-biriga zid joylarni topdi. Egasiga Telegram'da bittalab so'raydi — egasi tugmani bosib javob beradi." },
  { key: 'cams', title: 'Kameralar', optional: true, lead: "Ixtiyoriy — Kuzatuvchi uchun. Palantir klinika tarmog'idagi kameralarni o'zi topadi. Siz login-parolni kiritasiz va kamera qayerda turganini yozasiz." },
  { key: 'done', title: 'Tayyor', lead: "Klinikadan ketishdan oldin oxirgi ko'rinish." },
];

/** Qadam havolasi: panel ustani kerakli qadamda ochadi (Sozlamalar → «Claude va kalitlar» → #/ulash/keys); joriy qadam ham shu yerda turadi */
export const stepHref = (key: StepKey): string => `#/ulash/${key}`;

/**
 * Qadamdan chiqishdan oldin (Davom etish, Orqaga, chapdagi qadam): ochiq qadam saqlanmagan o'zgarishini saqlab oladi.
 * false — saqlanmadi (xato egasiga aytilgan), qadam almashmaydi. «Saqlash»ni bosmay o'tib ketilsa ma'lumot jim yo'qolardi (I7)
 */
export const leaveGuard: { current: (() => Promise<boolean>) | null } = { current: null };
/** «#/ulash/keys» → 'keys'; qadamsiz yoki noma'lum bo'lsa — null (usta birinchi qadamdan ochiladi) */
export function stepFromHash(hash: string): StepKey | null {
  const key = /^#\/ulash\/([a-z]+)\/?$/.exec(hash)?.[1];
  return STEPS.find(s => s.key === key)?.key ?? null;
}

/** Shu serverdagi qadamlar: shaxsiy Telegram keyinga qoldirilgan bo'lsa (TG_PERSONAL) uning qadami ko'rinmaydi */
export const visibleSteps = (s: LiveStatus | null): StepInfo[] => STEPS.filter(x => x.key !== 'tg' || !!s?.telegramUser.enabled);

export interface WizardFacts {
  hasBiz: boolean;
  status: LiveStatus | null;
  setup: SetupView | null;
  keys: KeyView[] | null;
  /** Shu biznesning IP kameralari soni */
  cameras: number;
  /** Telefon liniyasi (null — hali olinmagan) */
  phone: PhoneLine | null;
  /** Bitta kompyuter — bitta profil (server/profile.ts): klinika tanlanmaydi, kalitlar — profilniki */
  profile?: boolean;
}

export function stepState(key: StepKey, f: WizardFacts): StepState {
  const s = f.status, setup = f.setup;
  switch (key) {
    case 'clinic': return f.hasBiz ? 'ok' : '';
    case 'keys': {
      if (!f.keys) return '';
      const required = f.keys.filter(k => k.required);
      // Claude kaliti obuna yo'li bor joyda majburiy emas — AI'ning o'zi ishlashi kerak (obunaga kirilgan yoki kalit berilgan)
      if (required.every(k => k.source) && s?.ai !== false) return 'ok';
      return f.keys.some(k => k.source) ? 'warn' : '';
    }
    case 'owner': return s?.ownerLinked ? 'ok' : '';
    // Bot havolasi bor — bemorlar yoza oladi; Telegram Business — qo'shimcha (C2)
    case 'patients': return s?.telegramBusiness.account || (s?.bot && s.generalLink) ? 'ok' : '';
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
    case 'phone': {
      const p = f.phone;
      if (!p?.trunk) return '';
      return p.status.trunk === 'registered' && p.status.ai !== false ? 'ok' : 'warn';
    }
    case 'gaps': {
      // Savollar egasining Telegram'iga boradi: u ulanmaguncha bu qadam hali boshlanmagan — birinchi soniyadan «!» emas (I7)
      if (!setup || !f.status?.ownerLinked) return '';
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
