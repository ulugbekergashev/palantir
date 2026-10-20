/**
 * Bosh sahifada yozilgan savol suhbat sahifasiga shu yerdan o'tadi: suhbat ochilganda matnni olib, o'zi yuboradi.
 * Suhbat mantig'i bitta joyda (ChatPage) qoladi — bosh sahifa faqat matnni topshiradi.
 */
let waiting: string | null = null;

export function askPalantir(text: string): void {
  waiting = text.trim() || null;
  window.location.hash = '#/chat';
}

/** Kutayotgan savolni oladi va bo'shatadi (ikkinchi marta yuborilmasin) */
export function takeAsk(): string | null {
  const text = waiting;
  waiting = null;
  return text;
}
