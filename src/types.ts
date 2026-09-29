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
  /** Kanalga qaysi tilda chiqadi (bo'lmasa — o'zbekcha) */
  contentLang?: Lang;
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
  /** Matnni AI yozgan (aks holda — tayyor bankdan) */
  ai?: boolean;
}

/** Egasining qo'lda o'zgartirgan matni (AI varianti ustidan) */
export interface ItemEdit {
  title?: string;
  caption?: string;
}

/**
 * AI yozgan matn (bir til uchun). Qaysi maydon ishlatilishi shablonga bog'liq:
 *   promo   — hook (kirish gapi), lines (2 afzallik)
 *   tip     — title, lines (3 band), closer (yakun)
 *   doctor  — closer (tanishtiruv gapi)
 *   holiday — lines (2 tabrik qatori)
 *   poll    — title (savol), lines (2 javob)
 */
export interface AiLangText {
  hook: string;
  title: string;
  lines: string[];
  closer: string;
}
export type AiText = Record<Lang, AiLangText>;

export interface PackState {
  seeds: Record<string, number>;
  status: Record<string, ItemStatus>;
  edits: Record<string, Partial<Record<Lang, ItemEdit>>>;
}

/** Post holati serverda (to'liq versiya) */
export interface ItemMeta {
  publishedAt: string | null;
  error: string | null;
  /** Kanalga chiqqan (egasi endi qaytara olmaydi) */
  inChannel: boolean;
}

/** Bir haftalik paket (server javobi) */
export interface WeekView {
  monday: string;
  /** Egasining tahriri bilan */
  items: ContentItem[];
  /** Tahrirsiz (AI yoki bank varianti) — "AI variantiga qaytarish" uchun */
  base: ContentItem[];
  status: Record<string, ItemStatus>;
  meta: Record<string, ItemMeta>;
  /** AI hali yozyapti — panel birozdan keyin qayta so'raydi */
  aiPending: boolean;
}

/** Klinika sahifasidagi ulanishlar holati */
export interface LiveStatus {
  bot: string | null;
  ai: boolean;
  ownerLinked: boolean;
  linkUrl: string | null;
  channel: { id: string; title: string | null } | null;
  generalLink: string | null;
}

export interface Lead {
  id: string;
  itemId: string | null;
  name: string | null;
  username: string | null;
  phone: string | null;
  stage: 'clicked' | 'contact' | 'called';
  createdAt: string;
  source: string | null;
}
