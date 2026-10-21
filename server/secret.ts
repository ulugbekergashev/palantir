/**
 * Bazadagi maxfiy qiymatlar (Telegram sessiyasi) AES-256-GCM bilan shifrlanadi.
 * Telegram sessiyasi — akkauntga to'liq kirish: baza fayli qo'lga tushsa ham,
 * kalitsiz (SESSION_SECRET yoki data/session.secret) ochib bo'lmasin.
 * «v2.» — joriy kalit. «v1.» — dastur Cerebro deb atalgan paytdagi kalit (eski nom): o'sha yozuvlar faqat o'qiladi,
 * qiymat qayta saqlanganda «v2.» bo'ladi.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env';

const keyFor = (label: string) => createHash('sha256').update(`${label}:vault:${env.sessionSecret}`).digest();
const KEYS: Record<string, Buffer> = { 'v2.': keyFor('palantir'), 'v1.': keyFor('cerebro') }; // eski nom

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEYS['v2.'], iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v2.${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')}`;
}

export function open(sealed: string): string {
  const key = KEYS[sealed.slice(0, 3)];
  if (!key) throw new Error("Noma'lum shifr");
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
