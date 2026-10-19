import type { ZoneKind } from '../types';

/** Kamera zonasi turlari: nomi va chizilgan ramka rangi */
export const ZONE_KIND: Record<ZoneKind, string> = { chair: 'Kreslo', desk: 'Kassa stoli', waiting: 'Kutish joyi', private: 'Maxfiy joy (yopiladi)' };
export const ZONE_BORDER: Record<ZoneKind, string> = { chair: 'border-emerald-400', desk: 'border-amber-400', waiting: 'border-sky-400', private: 'border-rose-400 border-dashed' };

/** 95 → «1 soat 35 daq», 40 → «40 daq» */
export const hoursMin = (min: number): string => (min >= 60 ? `${Math.floor(min / 60)} soat${min % 60 ? ` ${min % 60} daq` : ''}` : `${min} daq`);
