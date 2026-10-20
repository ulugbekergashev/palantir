/**
 * Ovozli agent kaliti: «<biznes id>.<sir>». Bazada faqat sirning xeshi turadi; biznesga bitta kalit — yangisi yaratilsa eskisi
 * shu zahoti yaroqsiz. Panel yo'li (routes.ts) ham, ovoz xizmatining fayli (serviceEnv.ts) ham shu yerdan foydalanadi.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { voiceKeys } from '../db';

const digest = (secret: string) => createHash('sha256').update(secret).digest();

/** Yangi kalit: eski kalit shu zahoti ishlamay qoladi. Kalitning o'zi bir marta ko'rsatiladi */
export function newVoiceKey(bizId: string): string {
  const secret = randomBytes(32).toString('base64url');
  voiceKeys.set(bizId, digest(secret).toString('hex'));
  return `${bizId}.${secret}`;
}

/** Kalit bazadagi xeshga mos bo'lsa — uning biznesi id'si, aks holda null */
export function voiceKeyOwner(key: string): string | null {
  const [bizId, secret] = key.split('.');
  const stored = bizId && secret ? voiceKeys.hash(bizId) : null;
  if (!stored) return null;
  const expected = Buffer.from(stored, 'hex'), given = digest(secret);
  return expected.length === given.length && timingSafeEqual(expected, given) ? bizId : null;
}
