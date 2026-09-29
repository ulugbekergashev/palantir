import type { ContentItem, TemplateId } from '../types';
import { hash, rng } from './rng';

/**
 * Demo uchun namuna natijalar. Haqiqiy versiyada ko'rishlar Instagram va
 * Telegram statistikasidan, lidlar — botdagi havoladan (qaysi postdan kelgani) olinadi.
 */

export interface ItemStats {
  views: number;
  reactions: number;
  leads: number;
}

/** Obunachilarning qancha qismi ko'radi */
const REACH: Record<TemplateId, number> = { promo: 0.26, tip: 0.22, doctor: 0.2, holiday: 0.3, slots: 0.16, poll: 0.18 };
/** Ko'rganlarning qanchasi botga yozadi */
const CONVERSION: Record<TemplateId, number> = { promo: 0.012, tip: 0.003, doctor: 0.006, holiday: 0.003, slots: 0.022, poll: 0.002 };

export function statsFor(item: ContentItem, followers: number): ItemStats {
  const r = rng(hash(`${item.id}:${item.seed}`));
  const views = Math.round(followers * REACH[item.template] * (item.kind === 'story' ? 0.7 : 1) * (0.8 + r() * 0.45));
  return {
    views,
    reactions: Math.round(views * (0.04 + r() * 0.05)),
    leads: Math.round(views * CONVERSION[item.template] * (0.7 + r() * 0.6)),
  };
}
