import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(password, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Admin paroli: uzunligi va mazmuni vaqt bo'yicha bilinmasin */
export function samePassword(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHmac('sha256', env.sessionSecret).update(given).digest();
  const b = createHmac('sha256', env.sessionSecret).update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface Session {
  /** Biznes id'si (admin uchun — "admin") */
  sub: string;
  role: 'business' | 'admin';
  /** Tugash vaqti (ms) */
  exp: number;
  /** Biznes kirishlari avlodi (businesses.token_ver): mos kelmasa — kirish bekor qilingan. Eski kalitlarda yo'q — 0 */
  v?: number;
}

const sign = (body: string) => createHmac('sha256', env.sessionSecret).update(body).digest('base64url');

export function issueToken(sub: string, role: Session['role'], days = 30, v = 0): string {
  const body = Buffer.from(JSON.stringify({ sub, role, exp: Date.now() + days * 86_400_000, v } satisfies Session)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Parolni taxmin qilishdan himoya: 15 daqiqada 8 ta xato urinish.
 * Shu kompyuterdan (127.0.0.1) — 40 ta: klinikada hamma shu manzildan kiradi, bitta odamning adashishi egasini kirishdan to'sib qo'ymasin
 */
const WINDOW_MS = 15 * 60_000, MAX_FAILURES = 8, MAX_LOCAL_FAILURES = 40, MAX_KEYS = 2000;
const limitOf = (key: string): number => (/(^|:)(127\.0\.0\.1|::1)$/.test(key) ? MAX_LOCAL_FAILURES : MAX_FAILURES);
const failures = new Map<string, { count: number; until: number }>();
export const loginBlocked = (key: string): boolean => {
  const f = failures.get(key);
  return !!f && f.count >= limitOf(key) && f.until > Date.now();
};
export const loginFailed = (key: string): void => {
  const now = Date.now();
  // Eskirgan yozuvlar tozalanadi: har xil manzildan urinib xotirani to'ldirib bo'lmasin
  if (failures.size >= MAX_KEYS) for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  const f = failures.get(key);
  const fresh = !f || f.until < now;
  failures.set(key, { count: fresh ? 1 : f.count + 1, until: now + WINDOW_MS });
};
export const loginOk = (key: string): void => { failures.delete(key); };

/**
 * Telegram Mini App kirishi (bot ichidagi «Panel»): Telegram ishga tushirish ma'lumotini (initData) bot tokeni bilan imzolaydi.
 * Tekshiruv — Telegram hujjatidagidek: hash'dan boshqa maydonlar alifbo tartibida «kalit=qiymat» qatorlari, kalit —
 * HMAC-SHA256("WebAppData", bot tokeni). Eskirgan (maxAgeSec) yoki o'zgartirilgan ma'lumot — null
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 86_400, now = Date.now()): { userId: string } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', key).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec || authDate - now / 1000 > 300) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as { id?: number } | null;
    return user?.id ? { userId: String(user.id) } : null;
  } catch {
    return null;
  }
}
