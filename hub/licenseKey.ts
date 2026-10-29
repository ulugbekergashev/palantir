/**
 * Litsenziya kaliti — bitta ko'rinish: Palantir tekshiradi (server/license.ts), Hub bir bosishda beradi (POST /admin/clinics/<id>/license),
 * sotuvchi qo'lda yasaydi (npm run kalit). Hub alohida joylanadi (faqat hub/ fayllari) — shuning uchun umumiy modul shu yerda.
 *   Kalit: PAL1-<base64url(kompyuter kodi 8 bayt + berilgan kun 4 bayt + Ed25519 imzo 64 bayt)> — 107 belgi, Telegram'da nusxalanadi.
 * Imzo sotuvchining maxfiy kaliti bilan (~/.palantir/litsenziya.pem, Hub'da LICENSE_SIGNING_KEY); dastur faqat ochiq kalit bilan
 * tekshiradi. Kod ochiq (GitHub) — DentaLocal'dagi «dastur ichidagi maxfiy so'z» usuli bu yerda kalit yasashni hammaga ochardi.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

/** Sotuvchining ochiq kaliti (Ed25519, SPKI, base64) */
export const LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAvUlNnjaAfsftHvy3OAqpCbptxKMrbZdhMv+tk97NJj0=';
const PREFIX = 'PAL1-';
const ID_BYTES = 8, DAY_BYTES = 4, SIG_BYTES = 64, DAY_MS = 86_400_000;

/** Kompyuter kodi: 16 ta o'n oltilik belgi, ko'rinishi XXXX-XXXX-XXXX-XXXX (bo'shliq, chiziq va kichik harf bilan yozilsa ham) */
export function normalizeMachineId(text: string): string | null {
  const hex = text.replace(/[\s-]/g, '').toUpperCase();
  return /^[0-9A-F]{16}$/.test(hex) ? hex.match(/.{4}/g)!.join('-') : null;
}

const idBytes = (machineId: string) => Buffer.from(machineId.replace(/-/g, ''), 'hex');
/** Imzolanadigan qator: boshqa imzo (masalan reliz imzosi) bilan adashmasin */
const signed = (id: Buffer, day: Buffer) => Buffer.concat([Buffer.from('palantir-litsenziya\n'), id, day]);

export function issueLicense(machineId: string, privateKey: KeyObject, now = Date.now()): string {
  const norm = normalizeMachineId(machineId);
  if (!norm) throw new Error("Kompyuter kodi noto'g'ri — 16 ta belgi: XXXX-XXXX-XXXX-XXXX");
  const id = idBytes(norm), day = Buffer.alloc(DAY_BYTES);
  day.writeUInt32BE(Math.floor(now / DAY_MS));
  return PREFIX + Buffer.concat([id, day, sign(null, signed(id, day), privateKey)]).toString('base64url');
}

/** Kalit shu kompyuterniki va sotuvchi imzolagan bo'lsa — berilgan kun (YYYY-MM-DD); aks holda null */
export function checkLicense(key: string, machineId: string, publicKey = LICENSE_PUBLIC_KEY): { issuedAt: string } | null {
  const text = key.replace(/\s+/g, '');
  const norm = normalizeMachineId(machineId);
  if (!norm || !text.startsWith(PREFIX)) return null;
  const raw = Buffer.from(text.slice(PREFIX.length), 'base64url');
  if (raw.length !== ID_BYTES + DAY_BYTES + SIG_BYTES) return null;
  const id = raw.subarray(0, ID_BYTES), day = raw.subarray(ID_BYTES, ID_BYTES + DAY_BYTES);
  if (!id.equals(idBytes(norm))) return null;
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, signed(id, day), pub, raw.subarray(ID_BYTES + DAY_BYTES))) return null;
  } catch { return null; }
  return { issuedAt: new Date(day.readUInt32BE() * DAY_MS).toISOString().slice(0, 10) };
}

/** Maxfiy kalit: PEM matni yoki bir qatordagi base64 (PKCS8 DER — Hub muhit faylida qiymat bitta qatorda bo'lishi kerak) */
export function signingKey(text: string): KeyObject {
  const t = text.trim();
  return t.startsWith('-----') ? createPrivateKey(t) : createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' });
}
