/** Kontent tili */
export type Lang = 'uz' | 'ru';

// ─── Biznes profili ──────────────────────────────────────────────────────────

/** Mahsulot yoki xizmat */
export interface Offering {
  id: string;
  name: string;
  nameRu?: string;
  /** Narx, so'm (0 — ko'rsatilmaydi) */
  price: number;
}

/** Jamoa a'zosi (post rasmida ham ishlatiladi) */
export interface Member {
  id: string;
  name: string;
  role: string;
  roleRu?: string;
  /** Tajriba, yil */
  years?: number;
  /** Surat (data URL, kichraytirilgan) */
  photo?: string;
}

export interface Brand {
  primary: string;
  accent: string;
  /** Logo (data URL). Bo'lmasa — nomning bosh harflari */
  logo?: string;
}

export interface Business {
  name: string;
  ownerName: string;
  /** Soha: "stomatologiya", "restoran", "o'quv markazi"… */
  industry: string;
  /** Biznes haqida qisqacha (yordamchi shu orqali tushunadi) */
  description?: string;
  phone: string;
  address: string;
  addressRu?: string;
  /** Ish vaqti, erkin matn: "Du–Sh 9:00–20:00" */
  hours?: string;
  instagram?: string;
  website?: string;
  /** Postlar va hujjatlar qaysi tilda (bo'lmasa — o'zbekcha) */
  contentLang?: Lang;
  /** Ertalabki qisqa xulosa (bugungi vazifalar, yangi mijozlar) */
  morningBrief?: boolean;
  /** Mijozlar yozganda (bot, shaxsiy Telegram, Instagram) Cerebro qanday javob beradi */
  autoReply?: AutoReply;
  brand: Brand;
  offerings: Offering[];
  team: Member[];
}

/**
 * off — javob tayyorlamaydi; draft — javobni tayyorlab egasiga ko'rsatadi, egasi «Yuborish»ni bosadi;
 * auto — o'zi javob beradi (egasi delayMin daqiqa ichida o'zi yozmasa). Bilmagan narsasini baribir egasidan so'raydi.
 */
export type ReplyMode = 'off' | 'draft' | 'auto';

export interface AutoReply {
  mode: ReplyMode;
  /** Shaxsiy Telegram: kontaktlardagi odamlarga ham javob bersinmi (odatda — yo'q, ular tanishlar) */
  contacts: boolean;
  delayMin: number;
}

// ─── Post rasmi (shablon) ────────────────────────────────────────────────────

export type TemplateId = 'promo' | 'tip' | 'team' | 'holiday' | 'list' | 'poll';
export type ItemKind = 'post' | 'story';

/** Rasmga tushadigan matnlar */
export interface Design {
  /** Yuqoridagi kichik yorliq: "Aksiya", "Foydali maslahat" */
  kicker: string;
  title: string;
  /** Katta belgi: "-20%", "Bepul" */
  badge?: string;
  /** list shablonida har qator "chap|o'ng" */
  lines: string[];
  /** Pastdagi chaqiruv: "Buyurtma: @bot" */
  cta?: string;
  footnote?: string;
}

/** Shablon chizadigan narsa (post, storis) */
export interface ContentItem {
  id: string;
  kind: ItemKind;
  template: TemplateId;
  /** Dizayn uslubi: 0 — rangli fon, 1 — oq fon, 2 — gradient */
  style: number;
  seed: number;
  memberId?: string;
  /** Xotira kuni kabi — bezaksiz, sokin uslub */
  solemn?: boolean;
  design: Record<Lang, Design>;
  caption: Record<Lang, string>;
}

// ─── Yordamchi ishlari ───────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'done' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  /** Mahalliy vaqt "YYYY-MM-DDTHH:MM" yoki null (muddatsiz) */
  dueAt: string | null;
  status: TaskStatus;
  remindedAt: string | null;
  createdAt: string;
}

export type LeadStage = 'new' | 'contacted' | 'won' | 'lost';

/** Mijoz qayerda yozishadi: Cerebro boti, egasining shaxsiy Telegrami, Instagram yoki qo'lda qo'shilgan */
export type LeadChannel = 'bot' | 'telegram' | 'instagram' | 'manual';

export interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  username: string | null;
  /** Cerebro unga yoza oladimi (botga yozgan, shaxsiy Telegramda yozishgan yoki Instagram'da 24 soat ichida yozgan) */
  reachable: boolean;
  channel: LeadChannel;
  lastInboundAt: string | null;
  stage: LeadStage;
  note: string | null;
  /** Qayerdan: post nomi, "Instagram bio", "qo'lda" */
  source: string | null;
  createdAt: string;
}

export interface Doc {
  id: string;
  title: string;
  kind: string;
  markdown: string;
  createdAt: string;
}

export type PostStatus = 'draft' | 'published' | 'deleted';

export interface Post {
  id: string;
  item: ContentItem;
  status: PostStatus;
  inChannel: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export type OutboundStatus = 'draft' | 'sent' | 'cancelled';

/** Mijozlarga xabar (follow-up): egasi tasdiqlagach yuboriladi */
export interface Outbound {
  id: string;
  text: string;
  leadIds: string[];
  /** Telegram orqali yetkaziladiganlar soni */
  reachable: number;
  status: OutboundStatus;
  sentCount: number;
  createdAt: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

/** Mijoz bilan yozishma (bot, shaxsiy Telegram, Instagram) */
export interface InboxMessage {
  id: string;
  leadId: string;
  channel: LeadChannel;
  direction: 'in' | 'out';
  /** Kim yozgan: mijoz, egasining o'zi yoki Cerebro */
  by: 'customer' | 'owner' | 'cerebro';
  text: string;
  createdAt: string;
}

export type ReplyStatus = 'pending' | 'scheduled' | 'sent' | 'dismissed' | 'obsolete';

/** Mijozga javob: egasi tasdiqlashini kutadi (pending) yoki vaqti kelsa o'zi ketadi (scheduled) */
export interface ReplyDraft {
  id: string;
  leadId: string;
  channel: LeadChannel;
  text: string;
  status: ReplyStatus;
  /** Egasiga izoh: nega o'zi javob bermadi ("narxi profilda yo'q") */
  note: string | null;
  dueAt: string | null;
  createdAt: string;
}

export interface InboxThread {
  lead: Lead;
  last: InboxMessage | null;
  pending: number;
}

/** Yordamchi javobi bilan birga yaratilgan narsa (panel va Telegramda ko'rsatiladi) */
export type Artifact =
  | { type: 'document'; doc: Doc }
  | { type: 'post'; post: Post }
  | { type: 'outbound'; outbound: Outbound }
  | { type: 'task'; task: Task };

/** Suhbat jurnali (panelda ko'rinadi) */
export interface ChatEntry {
  id: string;
  role: 'owner' | 'assistant';
  channel: 'telegram' | 'web';
  text: string;
  artifacts: Artifact[];
  createdAt: string;
}

/** Kabinetdagi ulanishlar holati */
export interface LiveStatus {
  bot: string | null;
  ai: boolean;
  voice: boolean;
  ownerLinked: boolean;
  linkUrl: string | null;
  channel: { id: string; title: string | null } | null;
  /** Instagram bio va reklama uchun: bosgan odam botga tushadi, raqamini qoldiradi */
  generalLink: string | null;
  /** Egasining shaxsiy Telegrami: available — serverda TG_API_ID bor; account — ulangan akkaunt */
  telegramUser: { available: boolean; account: string | null };
  instagram: { available: boolean; account: string | null };
}
