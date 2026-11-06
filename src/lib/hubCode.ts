/**
 * Palantir Hub ulanish kodi: hub manzili va klinika kaliti bitta qatorda — «palantir.<manzil base64url>.<klinika id>.<maxfiy qism>».
 * Kompyuter uni Hub'dan o'zi oladi (server/hubJoin.ts); faqat o'zi ulana olmaganda Hub admini beradi va u «Kalitlar» maydoniga qo'yiladi.
 * Eski kodlar «phub.» bilan boshlanardi — ular o'rnatilgan klinikalarda saqlanib turibdi, shuning uchun ham o'qiladi.
 */
export interface HubCode { url: string; clinicId: string; key: string }

export const HUB_CODE_TAG = 'palantir';
const LEGACY_TAG = 'phub';
const TAGS = [HUB_CODE_TAG, LEGACY_TAG];

const B64 = /^[A-Za-z0-9_-]+$/;

const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function makeHubCode(url: string, clinicId: string, secret: string): string {
  return `${HUB_CODE_TAG}.${toB64(url.replace(/\/+$/, ''))}.${clinicId}.${secret}`;
}

/** Qator Hub kodiga o'xshaydimi (to'liq yoki chala) — kalit turini tanish uchun (secrets.ts) */
export const looksLikeHubCode = (line: string): boolean => TAGS.some(t => line.startsWith(`${t}.`));

/** Kod buzuq bo'lsa — null. key — hubga yuboriladigan «klinika.maxfiy» */
export function parseHubCode(code: string): HubCode | null {
  const [tag, url64, clinicId, secret, extra] = code.trim().split('.');
  if (!TAGS.includes(tag) || extra !== undefined || !url64 || !B64.test(url64) || !/^[a-z0-9]{6,20}$/.test(clinicId ?? '') || !/^[A-Za-z0-9_-]{20,80}$/.test(secret ?? '')) return null;
  let url: string;
  try { url = fromB64(url64); } catch { return null; }
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(url)) return null;
  return { url, clinicId, key: `${clinicId}.${secret}` };
}
