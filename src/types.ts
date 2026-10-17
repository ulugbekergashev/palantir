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
  /** Eski maydon: yozish uslubi endi ikkinchi miya papkasidagi Uslub.md da turadi (bu yerdan faqat bir marta ko'chiriladi) */
  replyStyle?: string;
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
  /** Eslatma vaqtida shu raqamga telefon qilinadi (SpeechLab agenti); null — telefon qilinmaydi */
  callTo: string | null;
  /** Egasi eslatmani ovoz bilan so'ragan: telefon sozlanmagan bo'lsa — Telegram'ga o'zbekcha ovozli xabar */
  spoken: boolean;
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
  /** Cerebro unga yoza oladimi (botga yozgan, shaxsiy Telegramda yoki Instagram Direct'da yozishgan) */
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

/** Javob bilan birga CRM'ga yoziladigan qabul (klinika): bemor yozishmada tanlagan shifokor va vaqt */
export interface ReplyBooking { doctorId: string; doctorName: string; date: string; time: string; name: string; phone: string }

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
  /** Bor bo'lsa: javob yuborilishidan oldin shu qabul CRM'ga yoziladi */
  booking: ReplyBooking | null;
  /** Qabul CRM'ga yozilgan vaqt */
  bookedAt: string | null;
}

export interface InboxThread {
  lead: Lead;
  last: InboxMessage | null;
  pending: number;
}

export type MoneyKind = 'payment' | 'expense' | 'payout';
export type MoneyStatus = 'draft' | 'running' | 'done' | 'cancelled' | 'failed' | 'unknown' | 'undone';
/** DentaCRM'ga pul yozuvi (bemor to'lovi, xarajat, shifokorga to'lov): egasi tasdiqlagandagina yoziladi */
export interface MoneyEntry {
  id: string;
  kind: MoneyKind;
  status: MoneyStatus;
  /** "To'lov qabul qilish: 350 000 so'm" */
  title: string;
  /** Tekshirilgan tafsilotlar: bemor, xizmat, shifokor, usul, sana */
  details: string[];
  /** Yozilmagan yoki natijasi noma'lum bo'lsa — sababi */
  note: string | null;
  createdAt: string;
  /** Yozilgan kuni ortga qaytarish (CRM'dan o'chirish) mumkin */
  canUndo: boolean;
}

/** Yordamchi javobi bilan birga yaratilgan narsa (panel va Telegramda ko'rsatiladi) */
export type Artifact =
  | { type: 'document'; doc: Doc }
  | { type: 'post'; post: Post }
  | { type: 'outbound'; outbound: Outbound }
  | { type: 'money'; entry: MoneyEntry }
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
  /**
   * Egasining Instagrami (shu kompyuterdagi brauzer orqali): available — Chrome/Edge topildi;
   * waiting — ochilgan oynada egasi kirishini kutyapti; problem — nega ishlamayapti; relogin — qayta kirish yordam beradi
   */
  instagram: { available: boolean; account: string | null; waiting: boolean; problem: string | null; relogin: boolean };
  /** Klinikaning DentaCRM'i: account — "Klinika nomi · manzil"; problem — nega ishlamayapti */
  crm: { account: string | null; problem: string | null };
}

/** DentaCRM'dagi qabul holatlari (boshqa qiymat kelsa — o'zi ko'rsatiladi) */
export type AppointmentStatus = 'Pending' | 'Confirmed' | 'Checked-In' | 'Completed' | 'No-Show' | 'Cancelled';
/** time — "HH:MM"; duration — daqiqa */
export interface ClinicAppointment { time: string; patient: string; type: string; status: string; duration: number }
/** more — ro'yxatga sig'may qolgan qabullar soni */
export interface ClinicDoctorDay { doctor_id: string; doctor: string; count: number; appointments: ClinicAppointment[]; more?: number }
/**
 * Klinikaning bir kuni (GET /api/crm/day): qabullar shifokorlar bo'yicha, kelgan/kelmagan va tushum.
 * expected — hali kelishi kutilayotganlar; revenue.total — yangi kelgan pul (balansdan to'lov kirmaydi); by_method — Cash, Card, Click, Transfer…
 */
export interface ClinicDay {
  date: string;
  total: number;
  by_status: Record<string, number>;
  came: number;
  no_show: number;
  cancelled: number;
  expected: number;
  doctors: ClinicDoctorDay[];
  revenue: { total: number; by_method: Record<string, number>; advance: number; from_balance: number };
  unpaid: { total: number; count: number };
}

/** Kamera zonasi: kadrning ulushlarida berilgan to'rtburchak (0..1). chair — kreslo, desk — kassa stoli */
export type ZoneKind = 'chair' | 'desk';
export interface CameraZone { id: string; kind: ZoneKind; name: string; x: number; y: number; w: number; h: number; /** Kreslo qaysi shifokorniki (DentaCRM'dagi id) */ doctorId: string | null }
/** IP kameradan kadr olish holati: connecting — ulanmoqda, ok — kadrlar kelyapti, error — ulanib bo'lmadi (message — sababi) */
export interface CameraFeed { state: 'connecting' | 'ok' | 'error'; message: string | null }
export interface Camera {
  id: string; name: string; zones: CameraZone[]; createdAt: string;
  /** Oxirgi kadr kelgan payt (yo'q bo'lsa — hali ulanmagan) */ lastSeenAt: string | null;
  /** Kadrlar uzluksiz kela boshlagan payt */ seenFrom: string | null;
  /** IP kamera ulangan bo'lsa — uning manzili (parolsiz, faqat ko'rsatish uchun); null — shu kompyuter kamerasi (brauzerda sanaladi) */ ip: string | null;
  /** IP kamera holati; brauzer kamerasida null */ feed: CameraFeed | null;
}
/** Zonada odam bo'lgan oraliq; endedAt null — hozir ham shu yerda */
export interface CameraSession { id: string; cameraId: string; zoneId: string; kind: ZoneKind; zoneName: string; startedAt: string; endedAt: string | null }
export interface CameraFinding { level: 'ok' | 'warn' | 'crit'; text: string }
/**
 * Bir kunning kamera hisobi. seated — kresloda yetarlicha uzoq o'tirganlar; deskVisits — kassa oldida turganlar;
 * crm — DentaCRM'dagi «keldi» qabullar va to'langan to'lovlar soni (ulanmagan yoki javob bermagan bo'lsa null)
 */
export interface CameraSummary { date: string; seated: number; deskVisits: number; crm: { visits: number; payments: number } | null; findings: CameraFinding[]; sessions: CameraSession[] }

export interface CallLine { who: 'ai' | 'caller'; text: string }
/** Ovozli agent qabul qilgan qo'ng'iroq. booked — qabulga yozilgan bo'lsa "sana vaqt, shifokor" */
export interface Call { id: string; phone: string; name: string | null; startedAt: string; durationSec: number; outcome: string; transcript: CallLine[]; booked: string | null }

/** Sanash qoidasi: zonada shuncha soniya tursa — seans; shuncha ko'rinmasa — tugaydi; bundan qisqa o'tirish bemor deb sanalmaydi */
export interface CameraTiming { enterSec: number; leaveSec: number; minSessionSec: number }
export type ZoneNow = 'empty' | 'entering' | 'open';

// ─── Ikkinchi miya ───────────────────────────────────────────────────────────

/** qa — savol-javob; fix — egasi tuzatgan javob; sample — hujjat namunasi; page — egasi papkada o'zi yozgan sahifa */
export type KnowledgeKind = 'qa' | 'fix' | 'sample' | 'page';

export interface Knowledge {
  id: string;
  kind: KnowledgeKind;
  /** qa — mijoz savoli; fix — Cerebro yozgan javob; sample — hujjat nomi */
  question: string;
  /** qa — javob; fix — egasi yuborgan matn; sample — hujjat matni */
  answer: string;
  /** suggested — egasi «eslab qol» deyishini kutyapti: mijozlarga javobda ishlatilmaydi */
  status: 'active' | 'suggested';
  /** owner — egasi o'zi yozgan; relay — mijozga bergan javobidan; edit — tuzatishidan; pack:<id> — tayyor savolga javob */
  source: string;
  createdAt: string;
  /** Faqat ko'rsatish uchun: javobda reklama filtri ushlaydigan so'z bor — u o'zi yuborilmaydi, har safar egasiga tasdiqqa keladi */
  warning?: string;
  /** Faqat ko'rsatish uchun: fayldan kelgan taklif matnida topilgan narxlar soni */
  prices?: number;
}

/** «Ikkinchi miya» sahifasi: Cerebro biznes haqida bilgan hamma narsa */
export interface BrainView {
  facts: Note[];
  qa: Knowledge[];
  suggested: Knowledge[];
  fixes: Knowledge[];
  samples: Knowledge[];
  /** Egasi papkada (Obsidian'da) o'zi yozgan sahifalar */
  pages: Knowledge[];
  /** Shulardan nechtasi hajmga sig'may, mijozlarga javobda ishlatilmayapti */
  pagesLeftOut: number;
  /** Bilim turgan papka, DATA_DIR ga nisbatan: Obsidian shu papkani ochadi */
  vault: string;
  /** Mijozlarga qanday yozish kerakligi haqida egasining ko'rsatmasi */
  style: string;
  /** Tayyor savollar va (bo'lsa) javobi */
  pack: { id: string; question: string; hint: string; answer: Knowledge | null }[];
  /** Xizmatlar va narxlar (aniq jadval; sahifa emas) */
  prices: Pick<Offering, 'id' | 'name' | 'price'>[];
  /** Narxi yozilgan xizmatlar soni */
  priced: number;
  offerings: number;
}
