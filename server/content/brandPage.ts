/**
 * Brend-buk Miya papkasida — «Brend.md» (Obsidian'da ham ko'rinadi, «Narxlar.md» kabi). Asli bazada (ranglar va diktor video uchun kerak),
 * bu — o'qish uchun nusxa: Palantir yozadi, qo'lda o'zgartirilgani saqlanmaydi (o'zgartirish — panel → Miya → Brend).
 * Papka ildizida, «Bilim/» ichida emas: Bilim sahifalari mijozlarga javobga beriladi, auditoriyaning «og'riqlari» esa ichki narsa.
 */
import type { BrandBook } from '../../src/types';
import { put, refresh, vaultDir } from '../brain/vault';

export const BRAND_FILE = 'Brend.md';

const list = (title: string, items: string[]) => (items.length ? [`## ${title}`, ...items.map(v => `- ${v}`), ''] : []);

/** Sof funksiya: brend-buk → Markdown */
export function brandMarkdown(b: BrandBook): string {
  return [
    `# Brend — ${b.name}`, '',
    "> Bu sahifani Palantir brend-bukdan yozadi. O'zgartirish — panel → Miya → Brend. Hamma xodim shu ovozda yozadi: Kontent-meyker, Marketolog, Targetolog, Qabulxona.", '',
    ...(b.essence ? [`**Mohiyat:** ${b.essence}`, ''] : []),
    `**Pozitsiya:** ${b.positioning}`, '',
    ...(b.promise ? [`**Va'da:** ${b.promise}`, ''] : []),
    ...(b.tagline ? [`**Shior:** ${b.tagline}`, ''] : []),
    ...list('Auditoriya', b.personas.map(p => `**${p.name}** — ${p.who}${p.pains.length ? ` (og'riqlari: ${p.pains.join('; ')})` : ''}`)),
    ...list('Qadriyatlar', b.values),
    ...list('Ovoz xususiyatlari', b.traits.map(t => `${t.trait}${t.isNot ? ` — lekin ${t.isNot} emas` : ''}`)),
    ...list('Ovoz qoidalari', b.voice),
    ...list('Bunday emas → bunday', b.examples.map(e => `«${e.bad}» → «${e.good}»`)),
    ...list("Ishlatadigan so'zlar", b.words),
    ...list("Ishlatilmaydigan so'zlar", b.banned),
    ...list('Kontent ustunlari', b.pillars.map(p => `${p.name} — ${p.share}%`)),
    ...list('Ilgaklar', b.hooks),
    ...list('Chaqiriqlar', b.ctas),
    ...list('Qilinmaydi', b.dont),
    ...(b.bio ? ['## Bio', b.bio, ''] : []),
    '## Ranglar', ...Object.entries(b.colors).map(([k, v]) => `- ${k}: ${v}`), '',
  ].join('\n');
}

/** Papkadagi nusxani yangilaydi (o'zgarmagan bo'lsa yozilmaydi). Xato asosiy ishni to'xtatmaydi: nusxa — hosila */
export function mirrorBrand(bizId: string, book: BrandBook | null): void {
  if (!book) return;
  try {
    put(vaultDir(bizId), BRAND_FILE, brandMarkdown(book));
    refresh(bizId);
  } catch (e) {
    console.error('[brend] Miya nusxasi yozilmadi:', (e as Error).message);
  }
}
