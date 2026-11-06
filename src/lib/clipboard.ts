/**
 * Matnni nusxalash. navigator.clipboard faqat himoyalangan sahifada (https yoki shu kompyuterning o'zi) bor: qabulxonadagi boshqa
 * kompyuter panelni http://192.168.1.10:3200 bilan ochganda u yo'q (server/lan.ts) — o'shanda eski usul: yashirin matn maydoni
 * belgilanib, «copy» buyrug'i beriladi. Ikkalasi ham bo'lmasa — xato (chaqiruvchi matnning o'zini ko'rsatadi).
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* quyida eski usul */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const focused = document.activeElement as HTMLElement | null;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error("Nusxalab bo'lmadi");
  } finally {
    area.remove();
    focused?.focus?.();
  }
}
