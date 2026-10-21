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
  /** Hujjatlar, mijozlarga matnlar va ovoz qaysi tilda (bo'lmasa — o'zbekcha) */
  contentLang?: Lang;
  /** Ertalabki qisqa xulosa (bugungi vazifalar, yangi mijozlar) */
  morningBrief?: boolean;
  /** Mijozlar yozganda (bot, shaxsiy Telegram, Instagram) Palantir qanday javob beradi */
  autoReply?: AutoReply;
  /** Qabulxona xodimlari ulangan bo'lsa ham so'rovlar (qo'ng'iroq qilish va h.k.) nusxasi egasiga keladimi (bo'lmasa — ha) */
  requestsCopy?: boolean;
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
  /** Qaysi mijoz bilan bog'liq (uchrashuv, qo'ng'iroq, taklif) — bajarilganda natijasi so'raladi */
  leadId?: string | null;
  status: TaskStatus;
  remindedAt: string | null;
  createdAt: string;
}

export type LeadStage = 'new' | 'contacted' | 'won' | 'lost';

/** Mijoz qayerda yozishadi: Palantir boti, egasining shaxsiy Telegrami, Instagram yoki qo'lda qo'shilgan */
export type LeadChannel = 'bot' | 'telegram' | 'instagram' | 'manual';

export interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  username: string | null;
  /** Palantir unga yoza oladimi (botga yozgan, shaxsiy Telegramda yoki Instagram Direct'da yozishgan) */
  reachable: boolean;
  channel: LeadChannel;
  lastInboundAt: string | null;
  stage: LeadStage;
  note: string | null;
  /** Qayerdan: post nomi, "Instagram bio", "qo'lda" */
  source: string | null;
  /** Keyingi qadam: nima qilish kerak va qachon (mahalliy vaqt «2026-10-20T10:00»; bo'lmasa — null) */
  nextStep: string | null;
  nextAt: string | null;
  /** DentaCRM'dagi bemor (telefoni va ismi mos kelgani topilgan yoki qabulga yozilganda); bo'lmasa — null */
  patientId?: string | null;
  createdAt: string;
  /** Oxirgi o'zgarish yoki yozishma */
  updatedAt: string;
}

// ─── So'rovlar: mijoz xodimdan nimadir kutyapti ─────────────────────────────

/**
 * callback — qo'ng'iroq qilishni so'radi (yoki raqam qoldirdi); booking — yozilmoqchi, lekin yozishmada yozib bo'lmadi;
 * change — qabulni (buyurtmani) surish yoki bekor qilish; complaint — shikoyat; other — boshqa ish
 */
export type RequestKind = 'callback' | 'booking' | 'change' | 'complaint' | 'other';
export type RequestStatus = 'open' | 'done' | 'cancelled';
/** So'rov qayerdan keldi: yozishma kanali, qo'ng'iroq (o'tkazib yuborilgan), ovozli agent, egasi yoki panel */
export type RequestSource = LeadChannel | 'call' | 'voice' | 'owner' | 'panel';

export interface LeadRequest {
  id: string;
  leadId: string | null;
  kind: RequestKind;
  status: RequestStatus;
  /** Qaysi raqamga qo'ng'iroq qilish (mijoz yozishmada boshqa raqam aytgan bo'lishi mumkin) */
  phone: string | null;
  name: string | null;
  /** Xodim uchun: nima qilish kerak */
  summary: string;
  /** Mijoz aytgan qulay vaqt, o'z so'zi bilan («bugun 18:00 dan keyin») */
  whenText: string | null;
  /** Mahalliy vaqt «YYYY-MM-DDTHH:MM»: shundan oldin qo'ng'iroq qilinmaydi (eslatma shu paytda) */
  dueAt: string | null;
  /** Mijozning o'z gapi */
  quote: string | null;
  source: RequestSource;
  /** «Ko'tarmadi» necha marta bosildi */
  attempts: number;
  /** Kim nima qildi: «Qabulga yozildi, ertaga 15:00» */
  result: string | null;
  /** Kim yopdi yoki oxirgi marta urindi (xodim yoki egasi ismi) */
  doneBy: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** Mijoz kartasi: kanallari, yozishma va qo'ng'iroqlar soni, so'rovlari, qo'ng'iroqlari, DentaCRM bemori */
export interface ClientCardView {
  lead: Lead;
  /** Qaysi kanalda tanish: Instagram (@username), Telegram (bot yoki shaxsiy), telefon */
  channels: { instagram: string | null; telegram: string | null; phone: string | null };
  messages: { instagram: number; telegram: number; total: number };
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  requests: LeadRequest[];
  calls: Call[];
  /** DentaCRM bemori (bog'langan bo'lsa); problem — CRM javob bermadi yoki bemor topilmadi */
  patient: {
    id: string; name: string; phone: string | null; lastVisit: string | null; balance: number;
    upcoming: { id: string; date: string; time: string; doctorName: string; status: string }[];
    problem: string | null;
  } | null;
}

/** Klinika xodimi (qabulxona): so'rovlarni Telegram'da oladi va yopadi */
export interface StaffMember { id: string; name: string; role: 'reception'; linked: boolean; createdAt: string }

export interface Doc {
  id: string;
  title: string;
  kind: string;
  markdown: string;
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
  /** Kim yozgan: mijoz, egasining o'zi yoki Palantir */
  by: 'customer' | 'owner' | 'palantir';
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
  /** Bor bo'lsa: javobdan oldin bemorning mavjud qabuli ko'chiriladi yoki bekor qilinadi */
  change?: VisitChange | null;
  changedAt?: string | null;
}

/** Bemorning qabulini ko'chirish (yangi kun va vaqt, shifokor o'sha) yoki bekor qilish */
export interface VisitChange {
  kind: 'move' | 'cancel';
  appointmentId: string;
  /** Hozirgi vaqti: «2026-10-20 15:00» */
  from: string;
  doctorName: string;
  /** move bo'lsa: yangi kun va vaqt */
  date?: string;
  time?: string;
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

/**
 * Egasi so'ragan kamera kadri (yordamchi kameraga qaradi). Rasm Kuzatuvchi jurnalida saqlanadi (eventId; kadr olinmagan bo'lsa null);
 * people — odam topuvchi sanog'i (bilinmasa null), answer — savolga AI javobi, problem — nima bo'lmadi
 */
export interface CameraShot { eventId: string | null; cameraId: string; cameraName: string; people: number | null; answer: string | null; problem: string | null; at: string }

/** Yordamchi javobi bilan birga yaratilgan narsa (panel va Telegramda ko'rsatiladi) */
export type Artifact =
  | { type: 'document'; doc: Doc }
  | { type: 'outbound'; outbound: Outbound }
  | { type: 'money'; entry: MoneyEntry }
  | { type: 'task'; task: Task }
  | { type: 'camera'; shot: CameraShot };

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
  /** Instagram bio va reklama uchun: bosgan odam botga tushadi, raqamini qoldiradi */
  generalLink: string | null;
  /**
   * Egasining shaxsiy Telegrami: enabled — serverda yoqilgan (TG_PERSONAL=1; o'chiq bo'lsa panelda ko'rinmaydi);
   * available — TG_API_ID ham bor; account — ulangan akkaunt
   */
  telegramUser: { enabled: boolean; available: boolean; account: string | null };
  /** Telegram Business: egasi botni o'z akkauntiga chat-bot qilib qo'shgan (account), «javob berish» ruxsati bor-yo'qligi */
  telegramBusiness: { account: string | null; canReply: boolean };
  /** Masofadan kirish (Palantir Hub orqali): url — panelning hub manzili; miniApp — botdagi «Panel» tugmasi ishlaydi (HTTPS hub va bot bor) */
  remote: { url: string | null; miniApp: boolean };
  /**
   * Egasining Instagrami (shu kompyuterdagi brauzer orqali, zaxira yo'l): enabled — serverda yoqilgan (IG_VIA_BROWSER=1); available — Chrome/Edge topildi;
   * waiting — ochilgan oynada egasi kirishini kutyapti; problem — nega ishlamayapti; relogin — qayta kirish yordam beradi
   */
  instagram: { enabled: boolean; available: boolean; account: string | null; waiting: boolean; problem: string | null; relogin: boolean };
  /** Rasmiy Instagram (Meta ilovasi, Palantir Hub orqali): hub — hub kodi kiritilgan; account — «@username»; humanAgent — 7 kungacha javob ruxsati */
  instagramApi: { hub: boolean; account: string | null; problem: string | null; expiresAt: string | null; humanAgent: boolean };
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
/**
 * chair — kreslo, desk — kassa stoli, waiting — kutish joyi (har odamning kutishi alohida sanaladi),
 * private — maxfiy joy: kameradan chiqadigan har rasmda (AI, Telegram, jurnal, panel) qora bilan yopiladi,
 * staff — xodim joyi (administrator stoli ortida): qachon keldi, ketdi, qancha joyida bo'ldi
 */
export type ZoneKind = 'chair' | 'desk' | 'waiting' | 'private' | 'staff';
export interface CameraZone { id: string; kind: ZoneKind; name: string; x: number; y: number; w: number; h: number; /** Kreslo qaysi shifokorniki (DentaCRM'dagi id) */ doctorId: string | null }
/** IP kameradan kadr olish holati: connecting — ulanmoqda, ok — kadrlar kelyapti, error — ulanib bo'lmadi (message — sababi) */
export interface CameraFeed { state: 'connecting' | 'ok' | 'error'; message: string | null }
export interface Camera {
  id: string; name: string; zones: CameraZone[]; createdAt: string;
  /** Oxirgi kadr kelgan payt (yo'q bo'lsa — hali ulanmagan) */ lastSeenAt: string | null;
  /** Kadrlar uzluksiz kela boshlagan payt */ seenFrom: string | null;
  /** IP kamera ulangan bo'lsa — uning manzili (parolsiz, faqat ko'rsatish uchun); null — shu kompyuter kamerasi (brauzerda sanaladi) */ ip: string | null;
  /** IP kamera holati; brauzer kamerasida null */ feed: CameraFeed | null;
  /** Egasining tavsifi: kamera nimaga qaraydi, odatda kim turadi, ish vaqti — har topshiriq va savolda AI shuni o'qiydi */ profile?: string | null;
}
/** Zonada odam bo'lgan oraliq; endedAt null — hozir ham shu yerda. Kutish joyida — bitta odamning kutishi */
export interface CameraSession { id: string; cameraId: string; zoneId: string; kind: ZoneKind; zoneName: string; startedAt: string; endedAt: string | null }
export interface CameraFinding { level: 'ok' | 'warn' | 'crit'; text: string }
/**
 * Bir kunning kamera hisobi. seated — kresloda yetarlicha uzoq o'tirganlar; deskVisits — kassa oldida turganlar;
 * crm — DentaCRM'dagi «keldi» qabullar va to'langan to'lovlar soni (ulanmagan yoki javob bermagan bo'lsa null)
 */
export interface CameraSummary {
  date: string; seated: number; deskVisits: number; crm: { visits: number; payments: number } | null; findings: CameraFinding[]; sessions: CameraSession[];
  /** Har kreslo qancha band bo'ldi (kamera shu kuni kuzatgan vaqtga nisbatan) */
  chairUse?: ChairUse[];
  /** Kutish joyi bo'lsa — kutishlar hisobi; bo'lmasa null */
  waiting?: WaitStats | null;
  /** Xodim joylari: kim qachon keldi va ketdi */
  attendance?: Attendance[];
}
/**
 * Xodim joyi bo'yicha kun: birinchi kelgan va oxirgi ketgan payt (here — hozir joyida), joyida bo'lgan daqiqalar,
 * eng uzoq yo'qligi (ikki o'tirish orasi). Kamera kimligini bilmaydi — zona nomi (masalan, «Administrator») bo'yicha
 */
export interface Attendance { zoneId: string; name: string; cameraName: string; firstAt: string | null; lastAt: string | null; here: boolean; presentMin: number; longestAway: { from: string; to: string; min: number } | null }
/** Kreslo bandligi (ish vaqtida): busyMin — kimdir o'tirgan, watchedMin — kamera kuzatgan daqiqalar; pct — kuzatilgani 10 daqiqadan kam bo'lsa null */
export interface ChairUse { zoneId: string; name: string; cameraName: string; busyMin: number; watchedMin: number; pct: number | null }
/**
 * Kutish joyi: bugun necha kishi kutdi (count), o'rtacha va eng uzoq kutish, alertMin dan uzoq kutganlar soni;
 * hozir kutayotganlar va ularning eng uzog'i
 */
export interface WaitStats { count: number; avgMin: number; maxMin: number; longCount: number; alertMin: number; nowWaiting: number; nowLongestMin: number }

// ─── AI xodimlarga topshiriqlar va ularning jurnali ──────────────────────────
export type OrderMember = 'qabulxona' | 'yordamchi' | 'kuzatuvchi' | 'tahlilchi';
/**
 * Kamera qoidasi sharti (odam topuvchi sanagan odamlar bo'yicha): crowd — kamida `people` kishi; linger — kimdir turibdi
 * (uzoq turish); empty — hech kim yo'q; presence — odam ko'rindi (masalan, ish vaqtidan tashqari)
 */
export type WatchCondition = 'crowd' | 'linger' | 'empty' | 'presence';
/**
 * Topshiriq turi. standing — doimiy ko'rsatma (xodim har doim amal qiladi); schedule — belgilangan vaqtda bajaradi
 * (days: 1 — dushanba … 7 — yakshanba, bo'sh — har kuni); watch — kamera qoidasi (odam topuvchi, bepul, darhol);
 * look — AI ko'zi: kadrga qarab savolni tekshiradi (kadr AI'ga yuboriladi) — at bo'lsa o'sha vaqtda, bo'lmasa har everyMin daqiqada.
 * Vaqtlar «HH:MM»; from/to — faqat shu oraliqda (kechasi ham bo'ladi: 21:00–07:00). cameraId null — hamma kamera
 */
export type OrderSpec =
  | { kind: 'standing' }
  | { kind: 'schedule'; at: string; days: number[] }
  | { kind: 'watch'; cameraId: string | null; zoneId: string | null; condition: WatchCondition; people: number; minutes: number; from: string | null; to: string | null }
  | { kind: 'look'; cameraId: string | null; at: string | null; days: number[]; everyMin: number; from: string | null; to: string | null; question: string };
export interface AgentOrder {
  id: string; member: OrderMember;
  /** Egasining o'z so'zi */ text: string;
  spec: OrderSpec;
  /** AI qanday tushungani — bir gap («Har kuni 20:00 da …») */ summary: string;
  active: boolean; createdAt: string; lastRunAt: string | null; lastResult: string | null;
  /** Necha marta ishlagan (qoida bo'lsa — necha marta xabar bergan) */ hits: number;
}
/** Xodim jurnalidagi yozuv: nima ko'rdi yoki nima qildi. hasImage — kadr saqlangan (kamera hodisasi) */
export interface AgentEvent {
  id: string; member: OrderMember; orderId: string | null; level: 'info' | 'warn' | 'crit'; title: string; body: string;
  cameraId: string | null; hasImage: boolean; at: string;
}

export interface CallLine { who: 'ai' | 'caller'; text: string }
/**
 * Qo'ng'iroq: ovozli agent qabul qilgani (source 'voice') yoki MicroSIP orqali bo'lgan haqiqiy qo'ng'iroq (source 'microsip').
 * booked — qabulga yozilgan bo'lsa "sana vaqt, shifokor"
 */
export interface Call {
  id: string; phone: string; name: string | null; startedAt: string; durationSec: number; outcome: string; transcript: CallLine[]; booked: string | null;
  source?: 'voice' | 'microsip';
  direction?: 'in' | 'out' | null;
  /** ringing, dialing, talking — hali davom etyapti; ended — gaplashildi; missed — ko'tarilmadi (kiruvchi); no_answer — ko'tarmadi (chiquvchi) */
  status?: 'ringing' | 'dialing' | 'talking' | 'ended' | 'missed' | 'no_answer' | null;
  leadId?: string | null;
  /** Suhbat yozib olingan (panelda tinglash mumkin) */
  hasRecording?: boolean;
  /** pending — matn va tahlil tayyorlanmoqda */
  review?: 'none' | 'pending' | 'done' | 'failed';
  analysis?: CallAnalysis | null;
}

/** Yozib olingan qo'ng'iroqning tahlili (matn — avtomatik, gapiruvchilar «1-ovoz», «2-ovoz») */
export interface CallAnalysis {
  transcript: string;
  speakers: boolean;
  /** Bir-ikki gap: kim, nima uchun, nima bilan tugadi */
  summary: string;
  customerName: string;
  /** Mijoz nima xohladi */
  wants: string;
  /** booked — qabulga yozildi / kelishildi; callback — qayta qo'ng'iroq kerak; info — faqat ma'lumot oldi; lost — qiziqmadi; complaint; other */
  outcome: 'booked' | 'callback' | 'info' | 'lost' | 'complaint' | 'other';
  /** Nima kelishildi (sana, vaqt, narx) */
  agreed: string;
  nextStep: string;
  /** Xodim qanday gaplashdi: 1–10 va bir gap */
  score: number;
  staffNote: string;
}

/** Sanash qoidasi: zonada shuncha soniya tursa — seans; shuncha ko'rinmasa — tugaydi; bundan qisqa o'tirish bemor deb sanalmaydi */
export interface CameraTiming { enterSec: number; leaveSec: number; minSessionSec: number }
export type ZoneNow = 'empty' | 'entering' | 'open';

// ─── Ikkinchi miya ───────────────────────────────────────────────────────────

/** qa — savol-javob; fix — egasi tuzatgan javob; sample — hujjat namunasi; page — egasi papkada o'zi yozgan sahifa */
export type KnowledgeKind = 'qa' | 'fix' | 'sample' | 'page';

export interface Knowledge {
  id: string;
  kind: KnowledgeKind;
  /** qa — mijoz savoli; fix — Palantir yozgan javob; sample — hujjat nomi */
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

/** «Ikkinchi miya» sahifasi: Palantir biznes haqida bilgan hamma narsa */
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

// ─── Ulash ustasi ─────────────────────────────────────────────────────────────

/** Server kaliti (panelda ko'rinishi): qiymatning o'zi emas, yashirilgan boshi-oxiri */
export interface KeyView {
  name: import('./lib/secrets').KeyName;
  label: string;
  where: string;
  required: boolean;
  /** panel — ulash ustasida kiritilgan; env — .env faylidan; null — berilmagan */
  source: 'panel' | 'env' | null;
  masked: string | null;
  updatedAt: string | null;
}
export type KeyCheck = { ok: true; info: string; warn?: string } | { ok: false; error: string; canForce: boolean };

/** Bo'shliq: Palantir'ga yetishmagan yoki zid narsa — egasidan so'raladi */
export interface Gap {
  /** gap:… — suhbatdagi savol id'si shu bilan boshlanadi */
  id: string;
  question: string;
  hint: string;
  /** Tayyor javoblar (Telegram'da tugma bo'lib chiqadi); egasi o'zi yozsa ham bo'ladi */
  options?: string[];
}

/** Tarmoqda topilgan kamera */
export interface FoundCamera {
  ip: string;
  /** Hikvision, Dahua… — bilinmasa bo'sh */
  brand: string;
  model: string;
  /** ONVIF boshqaruv manzili (bo'lmasa — faqat 554-port topilgan) */
  onvif: string | null;
  rtspPort: number;
  /** Shu biznesga allaqachon ulangan */
  connected?: boolean;
}

export interface AnketaView { code: string; label: string; industry: string; status: import('./lib/anketa').AnketaStatus; updatedAt: string; expiresAt: string }
export interface AnketaImport {
  prices: { added: number; updated: number; conflicts: number; unclear: number };
  answers: number;
  about: boolean;
}

/** O'rnatish holati (GET /api/setup) */
export interface SetupView {
  has: { instagram: string; telegramPhone: string; crm: import('./lib/anketa').CrmKind; cameras: number; cameraBrand: string };
  anketa: { code: string | null; importedAt: string } | null;
  gaps: Gap[];
  pack: { answered: number; total: number };
  prices: number;
  status: LiveStatus;
}
