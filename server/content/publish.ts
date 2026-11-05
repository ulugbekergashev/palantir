/**
 * Tayyor video tashqariga — egasining tugmasi bilan:
 *   Telegram kanali — mp4 izoh bilan (bot kanalda admin); bir video bir marta chiqadi;
 *   reklama — Targetolog rejasida «video:<id>» (ads/campaigns.ts): faqat yangi (eskirmagan) yig'ilgan video taklif qilinadi.
 * Instagram Reels — hozircha yo'q: Instagram brauzer orqali ulangan, Reels uchun rasmiy yo'l yo'q (akkaunt xavfi).
 */
import { statSync } from 'node:fs';
import type { ContentVideo } from '../../src/types';
import type { BusinessRow } from '../db';
import { events } from '../orders/store';
import { channelOutlet } from './factory';
import { renderState, videoMp4 } from './render';
import { ContentError, contentStore } from './store';
import { videoStore } from './video';

/** Telegram bot video chegarasi (Bot API: 50 MB) va izoh uzunligi */
const MAX_BYTES = 50 * 1_048_576;
export const MAX_VIDEO_CAPTION = 1024;

const sending = new Set<string>();

/** Yangi (ssenariy, ovoz va brend bilan mos) yig'ilgan videolar — reklama va kanal uchun */
export function readyVideos(bizId: string): ContentVideo[] {
  return videoStore.list(bizId).filter(v => v.status === 'voiced' && renderState(bizId, v).phase === 'done');
}

export async function videoToChannel(biz: BusinessRow, id: string, caption: string): Promise<ContentVideo> {
  const v = videoStore.get(biz.id, id);
  if (!v) throw new ContentError('Video topilmadi');
  if (v.channelAt) throw new ContentError('Bu video kanalga allaqachon joylangan');
  const phase = renderState(biz.id, v).phase;
  if (phase !== 'done') throw new ContentError(phase === 'stale' ? "Video eskirgan (ssenariy, ovoz yoki brend o'zgargan) — avval «Videoni yangilash»" : "Video hali yig'ilmagan");
  const file = videoMp4(biz.id, id)!;
  if (statSync(file).size > MAX_BYTES) throw new ContentError("Video 50 MB dan katta — Telegram bot bunchasini yubora olmaydi");
  const text = caption.replace(/\r\n/g, '\n').trim();
  if (text.length > MAX_VIDEO_CAPTION) throw new ContentError(`Izoh ${MAX_VIDEO_CAPTION} belgidan uzun (Telegram chegarasi)`);
  const s = contentStore.settings(biz.id);
  if (!s.channelId) throw new ContentError('Kanal ulanmagan: Kontent-meyker → Kanallar');
  const outlet = channelOutlet();
  if (!outlet) throw new ContentError('Telegram bot ulanmagan');
  if (sending.has(id)) throw new ContentError('Joylanyapti…');
  sending.add(id);
  try {
    let messageId: number;
    try {
      messageId = await outlet.postVideo(s.channelId, file, text);
    } catch (e) {
      // Javob kelmay uzilgan bo'lsa ham Telegram videoni qabul qilgan bo'lishi mumkin
      throw new ContentError(`Kanalga joylanmadi: ${(e as Error).message.slice(0, 200)}. Kanalda chiqmaganini tekshiring`);
    }
    videoStore.toChannel(biz.id, id, messageId);
    try {
      events.add(biz.id, { member: 'kontent', orderId: null, level: 'info', title: `Kanalga video joylandi: ${v.topic.split('\n')[0].slice(0, 100)}`, body: text, cameraId: null });
    } catch (e) { console.error('[kontent] jurnal:', (e as Error).message); }
    return videoStore.get(biz.id, id)!;
  } finally {
    sending.delete(id);
  }
}
