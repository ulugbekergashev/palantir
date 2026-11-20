/**
 * Tasdiqlangan postlar vaqti kelganda o'zi chiqadi (jadval har 30 soniyada chaqiradi):
 *   Telegram — egasining kanaliga (bot admin), rasm yoki albom izoh bilan;
 *   Instagram posti — brauzer orqali ulangan bo'lsa (inbox/instagram.ts), bitta rasm;
 *   karusel va storis Instagram'ga — hozircha avtomatik emas: rasmlar va matn egasining Telegram'iga «joylang» deb yuboriladi (handed).
 * Joylab bo'lmasa — sababi yoziladi va egasiga aytiladi; ikki marta joylanmaydi (holat approved → publishing faqat bir marta).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iso } from '../../src/lib/week';
import { businesses, type BusinessRow } from '../db';
import { channelOutlet } from '../content/factory';
import { contentStore } from '../content/store';
import { IgUnsure, publishInstagramPhoto } from '../inbox/instagram';
import { notifyOwner, notifyOwnerFile } from '../inbox/core';
import { FORMATS } from './design';
import { postLabel } from './prepare';
import { STALE_MS, designFormat, postTime, smmDir, smmStore, type SmmPost } from './store';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Telegram rasm izohi chegarasi: undan uzun matn rasmdan keyin alohida xabar */
const PHOTO_CAPTION = 1024;

/** Joylovchi: sinovlarda almashtiriladi */
export interface PublishDeps {
  instagramPhoto: (bizId: string, jpeg: Buffer, w: number, h: number, caption: string) => Promise<{ url: string }>;
}
const LIVE: PublishDeps = { instagramPhoto: publishInstagramPhoto };

const files = (biz: BusinessRow, p: SmmPost) => p.images.map(n => join(smmDir(biz.id), n));

/** Kanalga: rasm(lar), uzun matn — keyin alohida. Rasm chiqib, matn chiqmasa — post chiqqan hisoblanadi (qayta joylansa ikki marta bo'lardi) */
async function toTelegram(biz: BusinessRow, p: SmmPost): Promise<{ url: string | null; warning: string | null }> {
  const out = channelOutlet();
  const s = contentStore.settings(biz.id);
  if (!out) throw new Error('Telegram bot ishlamayapti');
  if (!s.channelId) throw new Error("Telegram kanal ulanmagan (Marketing → SMM → Kanal)");
  const long = p.caption.length > PHOTO_CAPTION;
  await out.postPhotos(s.channelId, files(biz, p), long ? '' : p.caption);
  const url = s.channelTitle ? `Telegram: ${s.channelTitle}` : null;
  if (!long) return { url, warning: null };
  // Kanal xabari oddiy matn (parse_mode yo'q) — qochirilmaydi
  try { await out.post(s.channelId, p.caption); return { url, warning: null }; } catch (e) { return { url, warning: `Rasm chiqdi, matn chiqmadi: ${(e as Error).message.slice(0, 160)}` }; }
}

/** Instagram'ga avtomatik joylab bo'lmaydigan post — egasiga: rasmlar va matn, o'zi joylaydi */
async function handOver(biz: BusinessRow, p: SmmPost, why: string): Promise<void> {
  for (const f of files(biz, p)) await notifyOwnerFile(biz, f, '');
  await notifyOwner(biz, `📲 <b>SMM-menejer</b>: «${esc(p.title)}» (${esc(postLabel(p))}) vaqti keldi — ${esc(why)}. Rasmlar yuqorida, matn:\n\n${esc(p.caption)}`);
}

async function publishOne(biz: BusinessRow, p: SmmPost, deps: PublishDeps): Promise<void> {
  if (!smmStore.move(biz.id, p.id, ['approved'], 'publishing')) return;
  try {
    if (p.channel === 'telegram') {
      const r = await toTelegram(biz, p);
      smmStore.move(biz.id, p.id, ['publishing'], 'published', { url: r.url, error: r.warning });
      if (r.warning) await notifyOwner(biz, `⚠️ <b>SMM-menejer</b>: «${esc(p.title)}» — ${esc(r.warning)}. Matnni kanalga o'zingiz qo'shing:\n\n${esc(p.caption)}`).catch(() => {});
      return;
    }
    if (p.format !== 'post' || p.images.length !== 1) {
      await handOver(biz, p, p.format === 'story' ? "storisni Instagram'ga o'zingiz joylang (avtomatik storis hali yo'q)" : "karuselni Instagram'ga o'zingiz joylang (avtomatik karusel hali yo'q)");
      smmStore.move(biz.id, p.id, ['publishing'], 'handed');
      return;
    }
    const { w, h } = FORMATS[designFormat(p)];
    try {
      const r = await deps.instagramPhoto(biz.id, readFileSync(files(biz, p)[0]), w, h, p.caption);
      smmStore.move(biz.id, p.id, ['publishing'], 'published', { url: r.url });
    } catch (e) {
      // Instagram javob bermadi — post chiqqan bo'lishi mumkin: «o'zingiz joylang» deyilmaydi (ikki marta chiqardi), tekshirish so'raladi
      if (e instanceof IgUnsure) {
        smmStore.move(biz.id, p.id, ['publishing'], 'failed', { error: "Instagram javob bermadi — chiqqan-chiqmaganini Instagram'da tekshiring" });
        await notifyOwner(biz, `⚠️ <b>SMM-menejer</b>: «${esc(p.title)}» Instagram'ga yuborildi, lekin javob kelmadi — chiqqan-chiqmaganini Instagram'da tekshiring. Chiqmagan bo'lsa — panelda «Qayta tasdiqlashga».`).catch(() => {});
        return;
      }
      await handOver(biz, p, `Instagram'ga avtomatik joylanmadi (${(e as Error).message.slice(0, 160)}) — o'zingiz joylang`);
      smmStore.move(biz.id, p.id, ['publishing'], 'handed', { error: (e as Error).message.slice(0, 300) });
    }
  } catch (e) {
    const why = (e as Error).message.slice(0, 300);
    smmStore.move(biz.id, p.id, ['publishing'], 'failed', { error: why });
    await notifyOwner(biz, `⚠️ <b>SMM-menejer</b>: «${esc(p.title)}» chiqmadi — ${esc(why)}. Panelda «Qayta tasdiqlashga» — AI qayta yozmaydi.`).catch(() => {});
  }
}

let running = false;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Vaqti kelgan tasdiqlangan postlar. works — biznesda SMM-menejer ishlayaptimi (jamoa, tarif, to'lov) */
export async function publishDue(works: (biz: BusinessRow) => boolean, now = new Date(), deps: PublishDeps = LIVE): Promise<number> {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (const d of smmStore.due(iso(now), hhmm(now))) {
      const biz = businesses.byId(d.bizId);
      const p = smmStore.get(d.bizId, d.id);
      if (!biz || !p) continue;
      if (!biz.active || !works(biz)) continue;
      // Juda eski tasdiqlangan post (server uzoq o'chiq turgan) — chiqarilmaydi, egasiga aytiladi
      if (now.getTime() - postTime(p) > STALE_MS) {
        smmStore.move(biz.id, p.id, ['approved'], 'failed', { error: "Vaqti o'tib ketdi (Palantir o'chiq edi) — panelda yangi vaqt qo'yib, «Qayta tasdiqlashga»" });
        await notifyOwner(biz, `⚠️ <b>SMM-menejer</b>: «${esc(p.title)}» ${esc(p.day)} ${esc(p.time)} da chiqishi kerak edi, lekin Palantir o'chiq edi. Panelda yangi vaqt qo'ying.`).catch(() => {});
        continue;
      }
      await publishOne(biz, p, deps);
      n++;
    }
  } finally {
    running = false;
  }
  return n;
}
