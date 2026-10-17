import type { Page } from '../components/Sidebar';

/**
 * Suhbatda aytilgan qisqa "falon bo'limni och" buyrug'i → bo'lim. Bunday gap yordamchiga yuborilmaydi: bo'lim darhol ochiladi.
 * Faqat qisqa buyruq (ko'pi bilan 4 so'z) olinadi: «Aliyevga hujjat tayyorlab ko'rsat» kabi topshiriq yordamchiga ketishi kerak.
 */
const MAX_WORDS = 4;
const SHOW = /(^|[\s,.])(och|ochib|oching|ochgin|ko'rsat|ko‘rsat|korsat|kirgin|o'tgin|открой|откройте|покажи|зайди|перейди)([\s,.!?]|$)/i;
const PLACES: [RegExp, Page][] = [
  [/kamera|камер/i, 'cameras'],
  [/qo'ng'iroq|qo‘ng‘iroq|qongiroq|звон/i, 'calls'],
  [/jurnal|vazifa|eslatma|журнал|задач|напомин/i, 'journal'],
  [/miya|bilim|hujjat|мозг|знани|документ/i, 'brain'],
  [/mijoz|suhbat|yozishma|xabar|instagram|клиент|переписк|сообщен/i, 'inbox'],
  [/ulanish|sozlama|подключ|настрой/i, 'telegram'],
];

export function sectionFor(text: string): Page | null {
  const said = text.trim();
  if (!said || said.split(/\s+/).length > MAX_WORDS || !SHOW.test(said)) return null;
  return PLACES.find(([place]) => place.test(said))?.[1] ?? null;
}
