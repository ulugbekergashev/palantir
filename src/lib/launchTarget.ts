/**
 * Hub'dan tayyor kirish bilan ochilgan panel qaysi sahifaga o'tadi (telegramLaunch.ts): «&ulash» — ulash ustasi,
 * «&sahifa=sozlamalar/telefon» — Hub'dagi «Klinika sozlamalari» tugmasi aytgan sahifa, boshqa holda — bosh sahifa.
 * Brauzersiz tekshiriladi (scripts/check-hub-clients.ts).
 */

/** Faqat «bo'lim» yoki «bo'lim/varaq» (kichik harf, raqam, chiziqcha) — tashqi havola, «..» va boshqa narsa bosh sahifaga */
const PAGE_RE = /^[a-z]+(?:\/[a-z0-9-]+)?$/;

export function launchTarget(params: URLSearchParams): string {
  if (params.has('ulash')) return '#/ulash';
  const page = params.get('sahifa') ?? '';
  return PAGE_RE.test(page) ? `#/${page}` : '#/';
}
