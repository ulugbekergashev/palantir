/**
 * Qo'yilgan qatorning turini aniqlaydi: bot tokeni, AI kalitlari, kamera manzili, DentaCRM havolasi, sahifa, telefon.
 * Faqat qolip bo'yicha — model ishtirok etmaydi, shuning uchun kalit hech qayerga yuborilmasdan tanib olinadi.
 * Ulash ustasi (panel) va server bitta qoidadan foydalanadi; bot va panel suhbati esa shu yerdan «bu maxfiy kalit» deb biladi.
 */

/** Server bo'yicha kalitlar: bitta kompyuterdagi hamma bizneslarga umumiy (avval faqat .env da turardi) */
export type KeyName = 'BOT_TOKEN' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY' | 'VOICELAB_API_KEY' | 'SPEECHLAB_API_KEY' | 'TG_API_ID' | 'TG_API_HASH' | 'CEREBRO_HUB';
import { parseHubCode } from './hubCode';

export type LineKind = 'key' | 'rtsp' | 'crm' | 'instagram' | 'phone' | 'unknown';

export interface KeyInfo { name: KeyName; label: string; where: string; required?: boolean }
export const KEYS: KeyInfo[] = [
  { name: 'BOT_TOKEN', label: 'Telegram bot tokeni', where: "@BotFather → /newbot (har klinikaga alohida bot)", required: true },
  { name: 'ANTHROPIC_API_KEY', label: 'Claude kaliti', where: 'platform.claude.com → API keys', required: true },
  { name: 'GEMINI_API_KEY', label: 'Gemini kaliti', where: 'aistudio.google.com → Get API key (ovozli xabarlar)' },
  { name: 'GROQ_API_KEY', label: 'Groq kaliti', where: 'console.groq.com → API keys (zaxira ovoz)' },
  { name: 'VOICELAB_API_KEY', label: 'VoiceLab kaliti', where: "voicelab.uz → Dasturchi → API kalit (o'zbek ovozi)" },
  { name: 'SPEECHLAB_API_KEY', label: 'SpeechLab kaliti', where: "speechlab.uz → Integratsiyalar → API (qo'ng'iroq qilib eslatish)" },
  { name: 'TG_API_ID', label: 'Telegram API ID', where: 'my.telegram.org → API development tools (shaxsiy Telegram)' },
  { name: 'TG_API_HASH', label: 'Telegram API hash', where: 'my.telegram.org → API development tools (shaxsiy Telegram)' },
  { name: 'CEREBRO_HUB', label: 'Cerebro Hub kodi', where: "Cerebro Hub admini beradi (rasmiy Instagram: Meta xabarlarini klinikaga yetkazadi) — «chub.» bilan boshlanadi" },
];
export const keyInfo = (name: KeyName): KeyInfo => KEYS.find(k => k.name === name)!;
export const isKeyName = (v: unknown): v is KeyName => KEYS.some(k => k.name === v);

export interface Classified {
  line: string;
  kind: LineKind;
  /** kind === 'key' bo'lsa — qaysi kalit */
  key?: KeyName;
  label: string;
  /** Turi tanildi, lekin ko'rinishi buzuq (chala nusxalangan): nima noto'g'ri va qanday tuzatish */
  error?: string;
}

const BOT_TOKEN = /^(\d{6,12}):([A-Za-z0-9_-]+)$/;
const BOT_SECRET_LEN = 35;
const GEMINI_LEN = 39;
const MIN_LONG_KEY = 40;
const TG_HASH = /^[0-9a-f]{32}$/i;
const PHONE = /^\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/;

const key = (line: string, name: KeyName, error?: string): Classified => ({ line, kind: 'key', key: name, label: keyInfo(name).label, ...(error ? { error } : {}) });

/** Bitta qatorning turi. Bo'sh qator — null */
export function classifyLine(raw: string): Classified | null {
  const line = raw.trim();
  if (!line) return null;
  const bot = BOT_TOKEN.exec(line);
  if (bot) {
    const n = bot[2].length;
    return key(line, 'BOT_TOKEN', n === BOT_SECRET_LEN ? undefined : `Token chala: ikki nuqtadan keyin ${BOT_SECRET_LEN} belgi bo'lishi kerak, bunda ${n} ta. @BotFather'dan qayta nusxalang.`);
  }
  if (line.startsWith('sk-ant-')) return key(line, 'ANTHROPIC_API_KEY', line.length >= MIN_LONG_KEY ? undefined : "Kalit chala: oxiri kesilib qolgan. platform.claude.com'dan butunlay nusxalang.");
  if (/^AIza[0-9A-Za-z_-]+$/.test(line)) return key(line, 'GEMINI_API_KEY', line.length === GEMINI_LEN ? undefined : `Gemini kaliti ${GEMINI_LEN} belgi bo'ladi, bunda ${line.length} ta.`);
  if (/^gsk_[A-Za-z0-9]+$/.test(line)) return key(line, 'GROQ_API_KEY', line.length >= MIN_LONG_KEY ? undefined : 'Groq kaliti chala: oxiri kesilib qolgan.');
  if (/^sl_(live|test)_\S+$/.test(line)) return key(line, 'SPEECHLAB_API_KEY');
  if (line.startsWith('chub.')) return key(line, 'CEREBRO_HUB', parseHubCode(line) ? undefined : 'Hub kodi chala yoki buzuq — hub adminidan butunlay nusxalab oling.');
  if (TG_HASH.test(line)) return key(line, 'TG_API_HASH');
  if (/^rtsps?:\/\//i.test(line)) {
    try {
      const u = new URL(line);
      return { line, kind: 'rtsp', label: 'Kamera manzili', ...(u.hostname ? {} : { error: "Manzilda kamera IP'si yo'q." }) };
    } catch {
      return { line, kind: 'rtsp', label: 'Kamera manzili', error: 'Manzil buzuq. Namuna: rtsp://admin:parol@192.168.1.64:554/Streaming/Channels/102' };
    }
  }
  if (/^(https?:\/\/)?(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?(\?\S*)?$/i.test(line)) return { line, kind: 'instagram', label: 'Instagram sahifasi' };
  if (/^https?:\/\/\S*dentacrm\.uz\S*$/i.test(line)) return { line, kind: 'crm', label: 'DentaCRM manzili' };
  // Klinikadagi oflayn DentaCRM ichki tarmoq manzilida turadi (http://192.168.1.10:3001): boshqa havola bu maydonga deyarli qo'yilmaydi
  if (/^https?:\/\/\S+$/i.test(line)) return { line, kind: 'crm', label: 'Havola — DentaCRM manzili deb olindi' };
  if (PHONE.test(line)) return { line, kind: 'phone', label: 'Telefon raqami' };
  return { line, kind: 'unknown', label: 'Tanimadim' };
}

/** Bir nechta qator (takrorlar bir marta) */
export function classifyText(text: string): Classified[] {
  const seen = new Set<string>();
  const out: Classified[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const c = classifyLine(raw);
    if (c && !seen.has(c.line)) { seen.add(c.line); out.push(c); }
  }
  return out;
}

/** Instagram sahifasining nomi (havoladan) */
export const instagramHandle = (line: string): string | null => /instagram\.com\/([A-Za-z0-9_.]+)/i.exec(line)?.[1] ?? null;

/** Ekranda ko'rsatish uchun: boshi va oxiri, o'rtasi yashirin. Kamera manzilida — faqat parol yashiriladi */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (/^rtsps?:\/\//i.test(v)) return v.replace(/(\/\/[^:/@]+:)[^@]*@/, '$1••••@');
  // Bot tokenining boshi — botning ochiq raqami (maxfiy emas): qaysi bot ekani ko'rinsin
  const bot = BOT_TOKEN.exec(v);
  if (bot) return `${bot[1]}:••••${v.slice(-4)}`;
  if (v.length <= 8) return '••••';
  return `••••${v.slice(-4)}`;
}

// Matn ichida (suhbatda) kalit qidirish: qator boshida bo'lishi shart emas
const IN_TEXT: RegExp[] = [
  // «bot123456789:AAH…» va api.telegram.org/bot<token>/… ko'rinishida ham (oldida harf bo'lsa ham)
  /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgsk_[A-Za-z0-9]{20,}/,
  /\bsl_(live|test)_[A-Za-z0-9_-]{8,}/,
  /rtsps?:\/\/[^\s:/@]+:[^\s@]+@/i,
];

/**
 * Suhbatga yozilgan gapda maxfiy kalit bormi. Bor bo'lsa, gap modelga, jurnalga va bilimga tushmasligi kerak:
 * egasi tokenni botga yoki panel suhbatiga yozib yuborsa, u o'chiriladi va «Ulash» sahifasiga yo'naltiriladi
 */
export const containsSecret = (text: string): boolean => IN_TEXT.some(re => re.test(text));
