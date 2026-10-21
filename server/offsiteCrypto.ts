/**
 * Tashqi zaxira shifri: sotuvchining OCHIQ kaliti bilan (X25519 + HKDF-SHA256 + AES-256-GCM). Klinika ham, hub ham ochib bo'lmaydi —
 * faqat sotuvchidagi maxfiy kalit bilan (scripts/restore-backup.ts). Har faylga yangi vaqtinchalik kalit.
 * Fayl: «PALANTIR-ZAXIRA-1\n» | vaqtinchalik ochiq kalit (SPKI DER, 44 bayt) | IV (12) | GCM teg (16) | shifrlangan matn.
 * Belgi va vaqtinchalik kalit AAD sifatida shifrga bog'langan — ularni almashtirib bo'lmaydi. Modul env'ga bog'liq emas.
 */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

export const MAGIC = Buffer.from('PALANTIR-ZAXIRA-1\n');
const EPH = 44, IV = 12, TAG = 16;
const INFO = Buffer.from('palantir-tashqi-zaxira-v1');

const keyOf = (shared: Buffer, eph: Buffer) => Buffer.from(hkdfSync('sha256', shared, eph, INFO, 32));

export function seal(publicKeyPem: string, data: Buffer): Buffer {
  const pair = generateKeyPairSync('x25519');
  const eph = pair.publicKey.export({ type: 'spki', format: 'der' });
  const key = keyOf(diffieHellman({ privateKey: pair.privateKey, publicKey: createPublicKey(publicKeyPem) }), eph);
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.concat([MAGIC, eph]));
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, eph, iv, c.getAuthTag(), body]);
}

export function unseal(privateKeyPem: string, blob: Buffer): Buffer {
  if (blob.length < MAGIC.length + EPH + IV + TAG || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('bu Palantir tashqi zaxirasi emas');
  let at = MAGIC.length;
  const eph = blob.subarray(at, at += EPH), iv = blob.subarray(at, at += IV), tag = blob.subarray(at, at += TAG);
  const shared = diffieHellman({ privateKey: createPrivateKey(privateKeyPem), publicKey: createPublicKey({ key: eph, format: 'der', type: 'spki' }) });
  const d = createDecipheriv('aes-256-gcm', keyOf(shared, eph), iv);
  d.setAAD(Buffer.concat([MAGIC, eph]));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(at)), d.final()]);
}
