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

/**
 * Mijozning ishlash holati (to'lov nazorati) — Hub har heartbeat javobida beradi, Palantir tekshiradi (server/hubAccess.ts):
 *   active — to'liq ishlaydi; warn — panelda sotuvchining eslatmasi; blocked — panel va AI xodimlar to'xtaydi, qo'ng'iroqlar administratorga.
 * Shu imzo (litsenziya kaliti bilan) bo'lmasa, klinika soxta «Hub» qo'yib bloklashni olib tashlay olardi. Imzolanadi: kompyuter kodi,
 * holat, sotuvchining matni va Hub'dagi vaqt — eski «active» javobini qayta ishlatib bo'lmaydi (oflayn muddat shu vaqtdan sanaladi).
 * Tarif (2-bosqich): f — klinikaga ruxsat berilgan modullar (MODULES). f yo'q — hammasi ruxsat (sotuvchi hali tanlamagan; 0.4.16 gacha
 * Palantir f ni bilmaydi va e'tiborsiz qoldiradi — imzo baribir to'g'ri).
 *   Ko'rinish: base64url(JSON {m, s, t, at, f?}) + '.' + base64url(Ed25519 imzo)
 */
export type AccessState = 'active' | 'warn' | 'blocked';
export const ACCESS_STATES: readonly AccessState[] = ['active', 'warn', 'blocked'];
/**
 * Tarif bilan yoqiladigan modullar: asosiy xodimlardan (AI administrator, Palantir) tashqari AI xodimlar (src/lib/crew.ts CREW) va
 * «telefon» — qo'ng'iroqqa AI javob beradi. Hub alohida joylanadi (src/ ni ko'rmaydi) — ro'yxat shu yerda; CREW bilan bir xilligini
 * scripts/check-hub-access.ts tekshiradi.
 */
export const MODULES = ['direktor', 'kuzatuvchi', 'tahlilchi', 'marketolog', 'kontent', 'target', 'rekruter', 'murabbiy', 'telefon'] as const;
export type Module = typeof MODULES[number];
export const isModule = (v: unknown): v is Module => typeof v === 'string' && (MODULES as readonly string[]).includes(v);
/** modules — ruxsat berilganlari (MODULES tartibida); null — hammasi */
export interface AccessGrant { state: AccessState; message: string; at: string; modules: Module[] | null }
const accessBytes = (body: string) => Buffer.from(`palantir-holat\n${body}`);
const ACCESS_MESSAGE_MAX = 300;

export function issueAccess(machineId: string, state: AccessState, message: string, privateKey: KeyObject, now = Date.now(), modules: readonly Module[] | null = null): string {
  const m = normalizeMachineId(machineId);
  if (!m) throw new Error("Kompyuter kodi noto'g'ri");
  const f = modules ? MODULES.filter(x => modules.includes(x)) : undefined;
  const body = Buffer.from(JSON.stringify({ m, s: state, t: message.slice(0, ACCESS_MESSAGE_MAX), at: new Date(now).toISOString(), ...(f ? { f } : {}) })).toString('base64url');
  return `${body}.${sign(null, accessBytes(body), privateKey).toString('base64url')}`;
}

/** Shu kompyuter uchun sotuvchi imzolagan holat; aks holda (begona, buzilgan, boshqa kompyuterniki) — null */
export function checkAccess(token: string, machineId: string, publicKey = LICENSE_PUBLIC_KEY): AccessGrant | null {
  const [body, sig] = String(token).split('.');
  const m = normalizeMachineId(machineId);
  if (!body || !sig || !m) return null;
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, accessBytes(body), pub, Buffer.from(sig, 'base64url'))) return null;
    const j = JSON.parse(Buffer.from(body, 'base64url').toString()) as { m?: unknown; s?: unknown; t?: unknown; at?: unknown; f?: unknown };
    const state = ACCESS_STATES.find(s => s === j.s);
    if (j.m !== m || !state || typeof j.at !== 'string' || !Number.isFinite(Date.parse(j.at))) return null;
    // f buzuq (massiv emas) — imzolangan bo'lsa ham hammasi yopiq emas, balki «tanlanmagan»: Hub'ning o'zi faqat massiv yozadi
    const modules = Array.isArray(j.f) ? MODULES.filter(x => (j.f as unknown[]).includes(x)) : null;
    return { state, message: typeof j.t === 'string' ? j.t.slice(0, ACCESS_MESSAGE_MAX) : '', at: j.at, modules };
  } catch { return null; }
}
