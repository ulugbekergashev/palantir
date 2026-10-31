/** Jonli tekshiruv kanallari (server/live/check.ts): npm run live -- <kanal> va panel bir xil ro'yxatdan foydalanadi */
export const LIVE_CHANNELS = ['disk', 'telegram', 'ai', 'instagram', 'meta_ai', 'post', 'crm', 'microsip', 'line', 'camera', 'hub'] as const;
export type LiveChannel = typeof LIVE_CHANNELS[number];
