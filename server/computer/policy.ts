/**
 * Kompyuterda ishlash qoidalari (sof funksiyalar — sinovda bevosita tekshiriladi):
 *   qaysi manzilga kirish mumkin — faqat http/https; shu kompyuter va ichki tarmoq yopiq (panel, CRM, kameralar shu yerda),
 *   egasi ruxsat bergan host:port bundan mustasno; saytlar ro'yxati berilgan bo'lsa — faqat o'shalar;
 *   qaysi amal «xavfli» — yuborish, to'lash, o'chirish, tasdiqlash, sotib olish: bajarishdan oldin egasidan Telegram'da so'raladi.
 */
import { isIP } from 'node:net';

export class PolicyError extends Error {}

/** Shu kompyuter, ichki tarmoq, bulut «metadata» manzillari — AI bu yerlarga kirmaydi */
export function privateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === 'metadata.google.internal') return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  // Nuqtasiz nom — ichki tarmoqdagi kompyuter (masalan, «server»)
  return !h.includes('.');
}

export interface SitePolicy { allowedSites: string[]; allowHosts: string[] }

const siteMatch = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/**
 * Brauzer ochadigan manzil. Qaytaradi: to'liq manzil (sxemasiz yozilgan bo'lsa https:// qo'shiladi). Yo'l qo'yilmasa — PolicyError.
 * DNS bu yerda tekshirilmaydi: brauzer har so'rovni (yo'naltirishdan keyin ham) allowedRequest bilan tekshiradi
 */
export function checkUrl(raw: string, p: SitePolicy): string {
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[\w.-]+:\d+(\/|$)/.test(text) ? text : `https://${text}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { throw new PolicyError(`Manzil noto'g'ri: ${text.slice(0, 100)}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new PolicyError(`Faqat http va https manzillar ochiladi (${u.protocol.replace(':', '')} — yo'q)`);
  if (!allowedRequest(u.href, p)) throw new PolicyError(blockedWhy(u, p));
  return u.href;
}

/** Brauzerdagi har bir so'rov (sahifa, rasm, skript, yo'naltirish): ichki tarmoqqa va ro'yxatdan tashqari saytlarga ketmaydi */
export function allowedRequest(href: string, p: SitePolicy): boolean {
  let u: URL;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase(), hostPort = u.port ? `${host}:${u.port}` : host;
  if (p.allowHosts.includes(hostPort) || p.allowHosts.includes(host)) return true;
  if (privateHost(host)) return false;
  return !p.allowedSites.length || p.allowedSites.some(s => siteMatch(host, s));
}

function blockedWhy(u: URL, p: SitePolicy): string {
  if (privateHost(u.hostname)) return `${u.host} — shu kompyuter yoki ichki tarmoq: bu yerga kirilmaydi`;
  return `${u.host} ruxsat berilgan saytlar ro'yxatida yo'q (${p.allowedSites.join(', ')})`;
}

/**
 * Bosilganda tashqariga ta'sir qiladigan tugma: nomi yoki turi (submit). Bunday amaldan oldin egasidan so'raladi.
 * Faqat nomga qaraladi: «Qidirish», «Keyingi», «Yopish» kabi tugmalar so'ralmaydi
 */
const RISKY = new RegExp([
  // o'zbekcha
  "yubor", "jo'nat", "jonat", "to'la", "tola(sh|ng|moq)", "to'?lov", "o'chir", "ochir(ish|ing|moq)", "tasdiq", "sotib ol", "xarid", "buyurtma ber", "obuna", "imzola", "rozi(man|lik)", "saqla",
  "o'tkaz", "pul o'tkaz", "chiqarib yubor", "bekor qil",
  // ruscha
  "отправ", "оплат", "плат[её]ж", "удал", "подтвер", "купить", "заказ", "оформ", "подпис", "соглас", "перевест", "сохран",
  // inglizcha
  "send", "submit", "pay", "purchase", "buy", "order", "checkout", "delete", "remove", "confirm", "sign", "agree", "accept", "transfer", "publish", "post", "save",
].join('|'), 'i');

export interface ElementInfo { tag: string; type?: string | null; role?: string | null; name: string; inForm?: boolean }

/** Xavfli bosish: qaytaradi — egasiga ko'rsatiladigan qisqa tavsif; xavfsiz bo'lsa — null */
export function riskyClick(el: ElementInfo | null): string | null {
  if (!el) return null;
  // O‘zbekcha tutuq belgisining har xil yozilishi (‘ ’ ʻ ʼ `) — bitta
  const name = el.name.replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 80);
  const submit = (el.tag === 'button' || el.tag === 'input') && (el.type === 'submit' || (el.tag === 'button' && !el.type && !!el.inForm));
  if (RISKY.test(name)) return `«${name}» tugmasini bosish`;
  if (submit) return name ? `«${name}» — formani yuborish` : 'Formani yuborish';
  return null;
}

/** Klaviaturadagi Enter forma ichida — forma yuboriladi */
export function riskyKey(keys: string, el: ElementInfo | null): string | null {
  if (!el?.inForm || !/(^|[\s+])(enter|return)($|[\s+])/i.test(keys)) return null;
  if (el.tag === 'textarea') return null;
  return `Formani Enter bilan yuborish${el.name ? ` («${el.name.slice(0, 60)}» maydonida)` : ''}`;
}
