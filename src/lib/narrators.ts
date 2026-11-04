/**
 * Video diktori — Gemini TTS ovozlari. Ro'yxat 2026-11-04 da o'zbekcha matn bilan sinab tanlangan (hammasi o'zbekchani toza
 * talaffuz qildi; jinsi — eshitib aniqlangan, nomiga qarab emas). Brend-buk o'z diktorini shulardan tanlaydi, egasi almashtira oladi.
 */
export interface Narrator { id: string; who: 'erkak' | 'ayol'; about: string }

export const NARRATORS: readonly Narrator[] = [
  { id: 'Charon', who: 'erkak', about: 'vazmin, ishonchli' },
  { id: 'Orus', who: 'erkak', about: "qat'iy, aniq" },
  { id: 'Achird', who: 'erkak', about: "do'stona" },
  { id: 'Algieba', who: 'erkak', about: 'jiddiy, silliq' },
  { id: 'Sulafat', who: 'ayol', about: 'iliq' },
  { id: 'Aoede', who: 'ayol', about: 'yengil, ravon' },
  { id: 'Leda', who: 'ayol', about: 'yosh, tiniq' },
  { id: 'Despina', who: 'ayol', about: 'dadil' },
];

export const DEFAULT_NARRATOR = 'Charon';
export const isNarrator = (id: unknown): id is string => typeof id === 'string' && NARRATORS.some(n => n.id === id);
