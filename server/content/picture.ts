/**
 * Post rasmi — bitta joydan (Kontent-meyker). Kim chizadi:
 *   Meta AI — egasining meta.ai akkaunti ulangan va bugungi chegara tugamagan bo'lsa (bepul, lekin daqiqalab chizadi, Marketolog
 *             savollari bilan bitta kunlik chegara);
 *   Gemini  — aks holda, kalit bo'lsa (tez, ~5 sent, brend ranglarida);
 *   hech kim — egasi o'z suratini qo'shadi.
 * Ikkalasiga ham brendning vizual qoidalari qo'shiladi (brend-buk bo'lsa) va rasmda yozuv bo'lmaydi (o'zbekcha harflarni model
 * to'g'ri chizmaydi).
 */
import type { BrandBook } from '../../src/types';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { MetaAiError, assertMetaAiReady, imagineMetaAi, metaAiAvailable } from '../marketing/metaAi';
import { brandStore } from './brand';
import { sceneImage } from './media';

export type PictureMaker = 'meta_ai' | 'gemini';

/** Kutilgan xato — sababi egasiga ko'rsatiladi */
export class PictureError extends Error {}

/** Kim chizadi: Meta AI tayyor bo'lsa — u, bo'lmasa Gemini (kalit bor bo'lsa), bo'lmasa — hech kim */
export function pictureMaker(biz: BusinessRow): PictureMaker | null {
  if (metaAiAvailable()) {
    try {
      assertMetaAiReady(biz);
      return 'meta_ai';
    } catch (e) {
      if (!(e instanceof MetaAiError)) throw e;
    }
  }
  return env.geminiKey ? 'gemini' : null;
}

/** Brendning vizual tili (motif, qoidalar, ranglar) — rasm tavsifiga qo'shimcha */
export function brandLook(book: BrandBook | null): string {
  if (!book) return '';
  const rules = [book.motif, ...(book.visualRules ?? [])].filter(Boolean).join('; ');
  const c = book.colors;
  return [rules && `Brand visual language: ${rules}.`, `Colour palette: ${c.bg}, ${c.deep}, accent ${c.accent}.`].filter(Boolean).join(' ');
}

/** Gemini uchun so'rov: Instagram posti (4:5), tavsif, brend uslubi, yozuvsiz */
export function picturePrompt(description: string, book: BrandBook | null): string {
  const avoid = (book?.dont ?? []).filter(Boolean).join('; ');
  return [
    `A 4:5 vertical picture for an Instagram post: ${description.trim()}`,
    brandLook(book),
    'Natural, editorial photo look with soft light; one clear subject; calm background.',
    'No text, letters, numbers, signs, logos or watermarks anywhere. No recognizable faces.',
    avoid && `Avoid: ${avoid}.`,
  ].filter(Boolean).join(' ');
}

export async function drawPicture(biz: BusinessRow, description: string, maker: PictureMaker): Promise<Buffer> {
  const book = brandStore.book(biz.id);
  if (maker === 'meta_ai') {
    const look = brandLook(book);
    return imagineMetaAi(biz, look ? `${description.trim()} (${look})` : description);
  }
  try {
    return await sceneImage(picturePrompt(description, book), '4:5');
  } catch (e) {
    throw new PictureError(`Gemini rasm chizmadi: ${(e as Error).message.slice(0, 160)}`);
  }
}
