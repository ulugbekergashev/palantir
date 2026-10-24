import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

// .env — mahalliy ishga tushirish uchun (hostingda o'zgaruvchilar panelda beriladi).
// DOTENV=0 — o'qilmaydi: sinov serverlari haqiqiy kalitlarni olmasin (Windows'da bo'sh qiymatli o'zgaruvchi umuman yo'q hisoblanadi —
// «VOICELAB_API_KEY: ''» berilsa ham .env dagisi o'qilib qolardi)
if (process.env.DOTENV !== '0' && existsSync('.env')) process.loadEnvFile('.env');
/** Sinov serveri (.env o'qilmadi; .env dagi DOTENV=0 bunga ta'sir qilmaydi — u yuqorida o'qiladi): litsenziyaning sinov sozlamalari faqat shunda */
const testRun = process.env.DOTENV === '0';

const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
/**
 * Baza fayli. Dastur avval Cerebro deb atalgan (eski nom): o'sha nom bilan yaratilgan baza bo'lsa — o'sha ishlatiladi. Fayl qayta
 * nomlanmaydi: eski nashr (shu baza bilan ishlagan branch yoki qaytarilgan nashr) uni topa olmay, bo'sh baza yaratib qo'ymasin
 */
const LEGACY_DB = join(dataDir, 'cerebro.db'); // eski nom
const dbFile = existsSync(join(dataDir, 'palantir.db')) || !existsSync(LEGACY_DB) ? join(dataDir, 'palantir.db') : LEGACY_DB;

const SECRET_HEX = 64;
/** Sessiya imzosi kaliti: berilmagan bo'lsa bir marta yaratiladi va data papkasida saqlanadi */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = join(dataDir, 'session.secret');
  const saved = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  // Bo'sh yoki chala fayl (yozilayotganda tok o'chgan) kalit emas: bo'sh kalit bilan imzolangan tokenni har kim yasay olardi
  if (saved.length >= SECRET_HEX) return saved;
  const fresh = randomBytes(SECRET_HEX / 2).toString('hex');
  writeFileSync(`${file}.tmp`, fresh, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return fresh;
}

const LICENSE_GRACE_DAYS = 14;
/** Kalitsiz ishlash muddati (kun, license.ts): .env faqat qisqartira oladi (sinovda 0); noto'g'ri yoki bo'sh — 14 */
function graceDays(v: string | undefined): number {
  const n = Number(v);
  return v?.trim() && Number.isFinite(n) && n >= 0 ? Math.min(n, LICENSE_GRACE_DAYS) : LICENSE_GRACE_DAYS;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Noto'g'ri yoki bo'sh qiymat — odatdagisi */
const effort = (v: string | undefined, fallback: Effort): Effort => EFFORTS.find(e => e === v?.trim()) ?? fallback;

/** «8-21» → { from: 8, to: 21 }; noto'g'ri yoki bo'sh — 8–21 */
function dayHours(v: string | undefined): { from: number; to: number } {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(v?.trim() ?? '');
  const [from, to] = m ? [Number(m[1]), Number(m[2])] : [8, 21];
  return from < to && to <= 24 ? { from, to } : { from: 8, to: 21 };
}

export const env = {
  port: Number(process.env.PORT) || 3200,
  /**
   * Server tinglaydigan manzil. Berilmasa — 127.0.0.1: faqat shu kompyuterdan ochiladi (panel shifrsiz, tarmoqqa o'zi ochilib qolmasin).
   * Hamma tarmoq interfeyslari uchun ochiq aytiladi: LISTEN_HOST=0.0.0.0 (yoki bo'sh qiymat) — hostingda, proksi ortida
   */
  listenHost: process.env.LISTEN_HOST ?? '127.0.0.1',
  /** Server oldida proksi (nginx, hosting) turibdimi. Faqat shunda X-Forwarded-For'ga ishoniladi; to'g'ridan-to'g'ri ochiq serverda 1 qilinsa, kirish urinishlari chegarasini aylanib o'tish mumkin bo'ladi */
  trustProxy: process.env.TRUST_PROXY === '1',
  dataDir,
  dbFile: process.env.DB_FILE || dbFile,
  /** Kunlik zaxira nusxalar papkasi (boshqa diskka qo'ygan ma'qul) va nechta kun saqlanishi. BACKUP_KEEP=0 — zaxira olinmaydi */
  backupDir: resolve(process.env.BACKUP_DIR || join(dataDir, 'backups')),
  backupKeep: process.env.BACKUP_KEEP && Number.isFinite(Number(process.env.BACKUP_KEEP)) ? Number(process.env.BACKUP_KEEP) : 14,
  /** Qo'ng'iroq yozuvlari (audio) necha kun saqlanadi — matni va tahlili qoladi. 0 — o'chirilmaydi */
  recordingsKeepDays: process.env.RECORDINGS_KEEP_DAYS && Number.isFinite(Number(process.env.RECORDINGS_KEEP_DAYS)) ? Number(process.env.RECORDINGS_KEEP_DAYS) : 90,
  /** Ma'lumotlar diskida shundan kam bo'sh joy qolsa (MB) — egasiga aytiladi */
  diskMinFreeMb: Number(process.env.DISK_MIN_FREE_MB) || 2048,
  /**
   * Yangilashdan oldingi sinov (scripts/update.mjs): baza nusxasida faqat panel va baza ko'tariladi — bot, kanallar, jadval,
   * kameralar va tashqi xizmatlar yoqilmaydi
   */
  dryRun: process.env.PALANTIR_DRY_RUN === '1',
  /** Palantir Hub'ga holat yuborish oralig'i (hub kodi bo'lsa) */
  heartbeatMs: Number(process.env.HEARTBEAT_MS) || 5 * 60_000,
  /** @BotFather tokeni. Bo'lmasa — panel ishlaydi, Telegram o'chiq */
  botToken: process.env.BOT_TOKEN || '',
  /** Faqat sinov uchun: soxta Telegram API manzili */
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || undefined,
  /** Claude kaliti — yordamchining "miyasi" */
  aiEnabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.AI_DISABLED !== '1',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  /** Qanchalik chuqur o'ylaydi: egasining yordamchisi va mijozga javob. O'zgartirishdan oldin baholang: npm run eval:ai */
  aiEffortOwner: effort(process.env.AI_EFFORT_OWNER, 'medium'),
  aiEffortCustomer: effort(process.env.AI_EFFORT_CUSTOMER, 'low'),
  /** Internetdan qidirish (Claude web search). 0 — o'chiq */
  webSearch: process.env.WEB_SEARCH !== '0',
  /** Ovozli xabar → matn: Gemini (o'zbekchani yaxshi taniydi), zaxira — Groq Whisper */
  /** VoiceLab (Aisha, voicelab.uz → Dasturchi → API kalit) — o'zbek nutqiga ixtisoslashgan, zanjirda birinchi */
  voicelabKey: process.env.VOICELAB_API_KEY || '',
  /** Faqat sinov uchun: soxta VoiceLab manzili */
  voicelabUrl: (process.env.VOICELAB_URL || 'https://api.voicelab.uz').replace(/\/$/, ''),
  /** Ovozli eslatma uchun VoiceLab ovozi (id). Berilmasa — o'zbek ovozlari ichidan «Lola» */
  voicelabVoice: process.env.VOICELAB_TTS_VOICE || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  groqKey: process.env.GROQ_API_KEY || '',
  /** Kalitni tekshirish manzillari (ulash ustasi). Faqat sinov uchun almashtiriladi */
  anthropicRoot: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
  geminiApiRoot: (process.env.GEMINI_API_ROOT || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  groqApiRoot: (process.env.GROQ_API_ROOT || 'https://api.groq.com').replace(/\/$/, ''),
  /** Faqat sinov uchun: soxta ovoz xizmati manzillari */
  geminiSttUrl: process.env.GEMINI_STT_URL || 'https://generativelanguage.googleapis.com/v1beta/interactions',
  groqSttUrl: process.env.GROQ_STT_URL || 'https://api.groq.com/openai/v1/audio/transcriptions',
  /** Admin panel paroli (bizneslarni qo'shish). Bo'sh — admin kirishi yopiq */
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: sessionSecret(),
  /** Jadval tekshiruvi oralig'i (eslatmalar, ertalabki xulosa) */
  tickMs: Number(process.env.TICK_MS) || 30_000,
  /** Ertalabki xulosa soati (Toshkent vaqti) */
  morningHour: process.env.MORNING_HOUR ? Number(process.env.MORNING_HOUR) : 8,
  /** Kechki «kun qanday o'tdi» savoli soati (Toshkent vaqti) */
  eveningHour: process.env.EVENING_HOUR ? Number(process.env.EVENING_HOUR) : 19,
  /** So'rov eslatmalari shu soatlarda («8-21»): tungi so'rov ertalab eslatiladi, tunda karta ovozsiz keladi */
  requestHours: dayHours(process.env.REQUEST_HOURS),

  /** Masofadan kirish: panel Palantir Hub orqali (telefondan, Telegram Mini App). Hub kodi bo'lsa yoqiq; 0 — o'chiq (remote.ts) */
  remotePanel: process.env.REMOTE_PANEL !== '0',
  /**
   * Litsenziya (license.ts): kalitsiz ishlash muddati (kun) — faqat qisqartiriladi; sinov uchun kompyuter kodi va sotuvchining ochiq
   * kaliti — faqat sinov serverida. Kod ochiq: .env ga bir qator yozib (o'z ochiq kaliti, boshqa kompyuter kodi) litsenziyani chetlab
   * o'tib bo'lmasin — bunday o'zgarish kechasi yangilanishdan keyin ham qolardi
   */
  licenseGraceDays: graceDays(process.env.LICENSE_GRACE_DAYS),
  licenseMachineId: testRun ? process.env.LICENSE_MACHINE_ID || '' : '',
  licensePublicKey: testRun ? process.env.LICENSE_PUBLIC_KEY || '' : '',
  /** Palantir Hub (rasmiy Instagram uchun): manzili va klinika kaliti — PALANTIR_HUB kodidan (keys.ts o'rnatadi) */
  hub: null as { url: string; clinicId: string; key: string } | null,
  /** Faqat sinov uchun: soxta Instagram Graph API */
  igGraphUrl: (process.env.IG_GRAPH_URL || 'https://graph.instagram.com').replace(/\/$/, ''),
  /** Instagram'da 24 soatdan keyin (7 kungacha) xodim javobi — Meta «Human Agent» ruxsatini bergan bo'lsa: IG_HUMAN_AGENT=1 */
  igHumanAgent: process.env.IG_HUMAN_AGENT === '1',

  /** Egasining shaxsiy Telegramiga kirish (my.telegram.org → API development tools). Bo'lmasa — o'chiq */
  tgApiId: Number(process.env.TG_API_ID) || 0,
  tgApiHash: process.env.TG_API_HASH || '',
  /** Shaxsiy Telegram keyinga qoldirilgan (docs/PLAN.md): TG_PERSONAL=1 bo'lmasa kalitlar bo'lsa ham o'chiq va panelda ko'rinmaydi */
  tgPersonal: process.env.TG_PERSONAL === '1',
  /** Faqat sinov uchun: shaxsiy Telegram o'rniga soxta xizmat */
  tgUserFakeUrl: process.env.TG_USER_FAKE_URL || '',

  /**
   * Instagram Direct — egasining akkaunti, shu kompyuterdagi Chrome yoki Edge orqali (Meta ilovasiz).
   * IG_BROWSER — brauzer yo'li (berilmasa o'zi topadi); IG_SHOW_BROWSER=1 — oynani ko'rsatib ishlaydi (tekshirish uchun)
   */
  igBrowser: process.env.IG_BROWSER || '',
  igShowBrowser: process.env.IG_SHOW_BROWSER === '1',
  /** Brauzer orqali Instagram — zaxira yo'l, standart o'chiq (asosiysi rasmiy, Palantir Hub orqali): IG_VIA_BROWSER=1 bo'lsa yoqiladi */
  igViaBrowser: process.env.IG_VIA_BROWSER === '1',
  /** Direct'ni tekshirish oralig'i (har safar ±30% tasodifiy) */
  igPollMs: Number(process.env.IG_POLL_MS) || 90_000,
  /** Akkaunt xavfsizligi: bir kunda Instagram'da yuboriladigan xabarlar chegarasi */
  igDailyLimit: Number(process.env.IG_DAILY_LIMIT) || 120,
  /** Faqat sinov uchun: brauzer o'rniga soxta Instagram */
  igFakeUrl: process.env.IG_FAKE_URL || '',

  /** Mijoz ketma-ket bir nechta xabar yozishi mumkin — oxirgisidan keyin shuncha kutib javob tayyorlanadi */
  inboxDebounceMs: Number(process.env.INBOX_DEBOUNCE_MS) || 8_000,
  /** "O'zi javob bersin" rejimidagi kutish daqiqasining uzunligi (sinovda qisqartiriladi) */
  minuteMs: Number(process.env.MINUTE_MS) || 60_000,

  /**
   * DentaCRM manzili ichki tarmoqda bo'lishi mumkinmi (klinikadagi kompyuter — odatiy holat).
   * Bir nechta biznesga xizmat qiladigan umumiy serverda CRM_ALLOW_PRIVATE=0 qiling: faqat internetdagi https manzillar qoladi
   */
  crmAllowPrivate: process.env.CRM_ALLOW_PRIVATE !== '0',
  /** Yordamchi bir kunda DentaCRM'ga yoza oladigan qabullar soni (adashib yoki aldanib ko'p yozib yubormasin) */
  crmDailyBookings: Number(process.env.CRM_DAILY_BOOKINGS) || 40,
  /** Resepshn bir kunda egasining tasdig'isiz yoza oladigan qabullar (undan keyin — faqat tasdiq bilan) */
  /** Bir kunda Palantir orqali (egasi tasdiqlab) CRM'ga kiritiladigan pul yozuvlari soni */
  /**
   * Bir kunda bitta biznes uchun model so'rovlari chegarasi (API hisobi kutilmaganda bo'shab qolmasin: spam, aylanib qolgan suhbat).
   * owner — egasining yordamchisi (bitta gap bir necha so'rov bo'lishi mumkin), customer — mijozlarga javob
   */
  aiDailyOwner: Number(process.env.AI_DAILY_OWNER) || 600,
  aiDailyCustomer: Number(process.env.AI_DAILY_CUSTOMER) || 400,
  /** Bir kunda egasi yuborgan nechta rasm ko'rib chiqiladi */
  aiDailyPhotos: Number(process.env.AI_DAILY_PHOTOS) || 50,
  /** Bir kunda «AI ko'zi» (kamera kadrini tekshirish va kameraga savol) — egasining rasmlari chegarasiga tegmaydi */
  aiDailyCamera: Number(process.env.AI_DAILY_CAMERA) || 150,
  crmDailyMoney: Number(process.env.CRM_DAILY_MONEY) || 30,
  /** Bitta pul yozuvining eng katta summasi va bir kunda yoziladigan jami summa (so'm) */
  crmMaxAmount: Number(process.env.CRM_MAX_AMOUNT) || 100_000_000,
  crmDailySum: Number(process.env.CRM_DAILY_SUM) || 500_000_000,
  crmPublicDailyBookings: Number(process.env.CRM_PUBLIC_DAILY_BOOKINGS) || 15,
  /** Kamera: odam zonada shuncha soniya tursa — seans boshlanadi; shuncha ko'rinmasa — tugaydi; bundan qisqa o'tirish bemor deb sanalmaydi */
  cameraEnterSec: Number(process.env.CAMERA_ENTER_SEC) || 20,
  cameraLeaveSec: Number(process.env.CAMERA_LEAVE_SEC) || 60,
  cameraMinSessionSec: Number(process.env.CAMERA_MIN_SESSION_SEC) || 180,
  /** Bemor kreslodan turganidan shuncha daqiqa o'tib ham to'lov yozilmagan bo'lsa — kamera hisobida «to'lov yozilmagan» */
  /** Kutish joyida kimdir shuncha daqiqadan ko'p kutsa — egasiga xabar (kasr ham bo'ladi: sinovda 0.1) */
  cameraWaitAlertMin: Number(process.env.CAMERA_WAIT_ALERT_MIN) > 0 ? Number(process.env.CAMERA_WAIT_ALERT_MIN) : 20,
  /** Kamera yopildi/burildi: odatiy ko'rinishni o'rganish (yoqilgandan keyin) va muammo shuncha soniya davom etsa — xabar */
  cameraTamperWarmupSec: Number(process.env.CAMERA_TAMPER_WARMUP_SEC) || 600,
  cameraTamperHoldSec: Number(process.env.CAMERA_TAMPER_HOLD_SEC) || 120,
  /** Kechki kamera hisoboti shu soatdan (to'rt soat ichida, kuniga bir marta); 99 — yuborilmaydi */
  cameraReportHour: process.env.CAMERA_REPORT_HOUR ? Number(process.env.CAMERA_REPORT_HOUR) : 20,
  cameraPayGraceMin: process.env.CAMERA_PAY_GRACE_MIN ? Math.max(0, Number(process.env.CAMERA_PAY_GRACE_MIN) || 0) : 30,
  /** IP kameralardan kadr oladigan dastur (ffmpeg). Yo'li berilmasa PATH'dan qidiriladi; topilmasa IP kameralar o'chiq (veb-kamera ishlayveradi) */
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  /** Faqat sinov uchun: IP kamera o'rniga ffmpeg'ga beriladigan kirish (JSON ro'yxat, masalan ["-f","lavfi","-i","testsrc"]) */
  cameraTestInput: process.env.CAMERA_TEST_INPUT || '',
  /** Faqat sinov uchun: kamera qidiruvi tarmoq o'rniga shu manzillarga (host:port, vergul bilan) — ONVIF so'rovi va 554-port */
  cameraProbeTargets: process.env.CAMERA_PROBE_TARGETS || '',
  cameraScanHosts: process.env.CAMERA_SCAN_HOSTS || '',
  /**
   * Telefon qilib eslatish — SpeechLab AI agenti (speechlab.uz → Integratsiyalar → API, «AI agent qo'ng'iroqlari» ruxsati bilan).
   * Agent raqami berilmasa — SpeechLab'da chiquvchi qo'ng'iroqlar uchun tanlangan agent gaplashadi
   */
  speechlabKey: process.env.SPEECHLAB_API_KEY || '',
  speechlabAgentId: Number(process.env.SPEECHLAB_AGENT_ID) || 0,
  /** Faqat sinov uchun: soxta SpeechLab manzili */
  speechlabUrl: (process.env.SPEECHLAB_URL || 'https://speechlab.uz/api/v1').replace(/\/$/, ''),
  /** Qo'ng'iroqdan keyin natija shuncha vaqtdan so'ng tekshiriladi (ko'tarmagan bo'lsa — Telegram'da aytiladi) */
  callCheckMs: Number(process.env.CALL_CHECK_MS) || 180_000,
  /**
   * Telefon liniyasisiz qo'ng'iroq: Telegram orqali AI (tgvoice/call_live.py — Gemini Live). TG_CALL_PYTHON — Python (venv),
   * TG_CALL_SCRIPT — call_live.py. Ikkalasi bo'lsa — eslatma vaqtida egasiga Telegram'da qo'ng'iroq qilinadi
   */
  tgCallPython: process.env.TG_CALL_PYTHON || '',
  tgCallScript: process.env.TG_CALL_SCRIPT || '',
  /** Keyinga qoldirilgan (alohida Telegram akkauntga kod bilan kiradi): TG_CALL=1 bo'lmasa Python yo'llari bo'lsa ham o'chiq */
  tgCall: process.env.TG_CALL === '1',
  /** Bitta Telegram qo'ng'irog'iga eng ko'p vaqt (osilib qolsa — to'xtatiladi) */
  tgCallLimitMs: Number(process.env.TG_CALL_LIMIT_MS) || 8 * 60_000,
  /** Ovozli agent bir kunda yoza oladigan qabullar */
  voiceDailyBookings: Number(process.env.VOICE_DAILY_BOOKINGS) || 30,
};

export const voiceEnabled = () => !!(env.voicelabKey || env.geminiKey || env.groqKey);
