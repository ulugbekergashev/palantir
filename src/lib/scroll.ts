/**
 * Suhbat oxiriga surish — faqat suhbatning o'z qutisi ichida. scrollIntoView butun sahifani ham surardi: Qabulxona ochilganda
 * sahifa yozishma o'rtasiga «sakrab», sarlavha va varaqlar ekrandan chiqib qolardi.
 * page — o'z qutisi yo'q bo'lsa (telefonda suhbat sahifaning o'zi bo'lib cho'zilganda) sahifani suradi (faqat suhbat sahifasining o'zida).
 */
export function scrollToEnd(el: HTMLElement | null, { smooth = false, page = false } = {}): void {
  let box = el?.parentElement ?? null;
  while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  if (box && box !== document.body) box.scrollTo({ top: box.scrollHeight, behavior });
  else if (page) window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}
