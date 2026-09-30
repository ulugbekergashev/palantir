/**
 * Bazadagi maxfiy qiymatlar (Telegram sessiyasi, Instagram tokeni) AES-256-GCM bilan
 * shifrlanadi. Telegram sessiyasi — akkauntga to'liq kirish: baza fayli qo'lga tushsa
 * ham, kalitsiz (SESSION_SECRET yoki data/session.secret) ochib bo'lmasin.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const key = createHash('sha256').update(`cerebro:vault:${env.sessionSecret}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')}`;
}

export function open(sealed: string): string {
  if (!sealed.startsWith('v1.')) throw new Error("Noma'lum shifr");
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** Tashqi xizmatga yuboriladigan qisqa imzolangan qiymat (Instagram OAuth "state") */
export function signState(payload: string, ttlMs = 15 * 60_000): string {
  const body = `${payload}.${Date.now() + ttlMs}`;
  const mac = createHmac('sha256', key).update(body).digest('base64url').slice(0, 32);
  return `${Buffer.from(body).toString('base64url')}.${mac}`;
}

export function readState(state: string): string | null {
  const [b64, mac] = state.split('.');
  if (!b64 || !mac) return null;
  const body = Buffer.from(b64, 'base64url').toString();
  const expected = createHmac('sha256', key).update(body).digest('base64url').slice(0, 32);
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  const dot = body.lastIndexOf('.');
  return Number(body.slice(dot + 1)) > Date.now() ? body.slice(0, dot) : null;
}
