/** Kontent tili: postlar o'zbek va rus tilida tayyorlanadi */
export type Lang = 'uz' | 'ru';

export interface Service {
  id: string;
  name: string;
  nameRu?: string;
  /** Narx, so'm (0 — ko'rsatilmaydi) */
  price: number;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  specialtyRu?: string;
  /** Tajriba, yil */
  years?: number;
  /** Surat (data URL, kichraytirilgan) */
  photo?: string;
}

export interface Brand {
  primary: string;
  accent: string;
  /** Logo (data URL). Bo'lmasa — klinika nomining bosh harflari */
  logo?: string;
}

/** Bo'sh vaqt: hafta kuni (0 — dushanba) va soat */
export interface FreeSlot {
  day: number;
  time: string;
}

/** Egasi har hafta (yoki bir marta) belgilaydigan maqsad */
export interface WeeklyGoal {
  /** Qaysi xizmatni ko'proq sotmoqchi */
  focusServiceId?: string;
  /** Amaldagi aksiya matni. AI o'zidan chegirma o'ylab topmaydi — faqat shu yerdagisini ishlatadi */
  promo?: string;
  promoRu?: string;
  /** Aksiya tugash sanasi (YYYY-MM-DD) */
  promoUntil?: string;
  freeSlots: FreeSlot[];
}

export interface Clinic {
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  addressRu?: string;
  instagram?: string;
  telegramBot?: string;
  telegramChannel?: string;
  /** Instagram va Telegram kanaldagi obunachilar (natijani taxmin qilish uchun) */
  followers: number;
  brand: Brand;
  services: Service[];
  doctors: Doctor[];
  goal: WeeklyGoal;
}

export type TemplateId = 'promo' | 'tip' | 'doctor' | 'holiday' | 'slots' | 'poll';
export type ItemKind = 'post' | 'story';
export type ItemStatus = 'pending' | 'published' | 'rejected';

/** Rasmga tushadigan matnlar */
export interface Design {
  /** Yuqoridagi kichik yorliq: "Aksiya", "Foydali maslahat" */
  kicker: string;
  title: string;
  /** Katta belgi: "-20%", "Bepul" */
  badge?: string;
  lines: string[];
  /** Pastdagi chaqiruv: "Yozilish: @bot" */
  cta?: string;
  footnote?: string;
}

export interface ContentItem {
  /** `${hafta dushanbasi}-${o'rin}` — hafta ichida o'zgarmas */
  id: string;
  slot: number;
  kind: ItemKind;
  template: TemplateId;
  /** "Aksiya", "Maslahat", "Bayram" — kartochkadagi yorliq */
  topic: Record<Lang, string>;
  /** Joylash sanasi (YYYY-MM-DD) va soati */
  date: string;
  time: string;
  /** Variant raqami ("Boshqa variant" bosilganda o'zgaradi) */
  seed: number;
  /** Dizayn uslubi: 0 — rangli fon, 1 — oq fon, 2 — gradient */
  style: number;
  doctorId?: string;
  /** Xotira kuni kabi sana — bezaksiz, sokin uslub */
  solemn?: boolean;
  design: Record<Lang, Design>;
  caption: Record<Lang, string>;
}

/** Egasining qo'lda o'zgartirgan matni (AI varianti ustidan) */
export interface ItemEdit {
  title?: string;
  caption?: string;
}

export interface PackState {
  seeds: Record<string, number>;
  status: Record<string, ItemStatus>;
  edits: Record<string, Partial<Record<Lang, ItemEdit>>>;
}
