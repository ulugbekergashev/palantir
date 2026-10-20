/**
 * Palantir Hub ulanish kodi: hub manzili va klinika kaliti bitta qatorda — «chub.<manzil base64url>.<klinika id>.<maxfiy qism>».
 * Hub admini (o'rnatuvchi) yaratadi, ulash ustasida «kalit» sifatida kiritiladi.
 */
export interface HubCode { url: string; clinicId: string; key: string }

const B64 = /^[A-Za-z0-9_-]+$/;

const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function makeHubCode(url: string, clinicId: string, secret: string): string {
  return `chub.${toB64(url.replace(/\/+$/, ''))}.${clinicId}.${secret}`;
}

/** Kod buzuq bo'lsa — null. key — hubga yuboriladigan «klinika.maxfiy» */
export function parseHubCode(code: string): HubCode | null {
  const [tag, url64, clinicId, secret, extra] = code.trim().split('.');
  if (tag !== 'chub' || extra !== undefined || !url64 || !B64.test(url64) || !/^[a-z0-9]{6,20}$/.test(clinicId ?? '') || !/^[A-Za-z0-9_-]{20,80}$/.test(secret ?? '')) return null;
  let url: string;
  try { url = fromB64(url64); } catch { return null; }
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(url)) return null;
  return { url, clinicId, key: `${clinicId}.${secret}` };
}
