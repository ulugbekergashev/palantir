import type { LiveStatus } from '../types';

/** ok — ishlayapti; warn — ulangan, lekin muammo bor (yoki serverda sozlanmagan); off — hali ulanmagan */
export type HealthLevel = 'ok' | 'warn' | 'off';
export interface HealthItem { key: 'bot' | 'ai' | 'crm' | 'telegram' | 'instagram'; label: string; level: HealthLevel; state: string }

const item = (key: HealthItem['key'], label: string, level: HealthLevel, state: string): HealthItem => ({ key, label, level, state });
const linked = (on: boolean, problem = false): [HealthLevel, string] => (problem ? ['warn', 'muammo'] : on ? ['ok', 'ulangan'] : ['off', 'ulanmagan']);

/**
 * Ulanishlar holati bir qarashda (yon panel uchun). Sof funksiya: GET /api/me javobidagi status'dan yig'iladi.
 * clinic — DentaCRM qatori ko'rsatilsinmi (klinika yoki CRM allaqachon ulangan).
 */
export function connectionHealth(status: LiveStatus, clinic: boolean): HealthItem[] {
  const { crm, instagram, telegramUser } = status;
  return [
    status.bot ? item('bot', 'Telegram bot', ...linked(status.ownerLinked)) : item('bot', 'Telegram bot', 'warn', 'sozlanmagan'),
    item('ai', 'AI', status.ai ? 'ok' : 'warn', status.ai ? 'ishlayapti' : "kalit yo'q"),
    ...(clinic || crm.account ? [item('crm', 'DentaCRM', ...linked(!!crm.account, !!crm.account && !!crm.problem))] : []),
    item('telegram', 'Shaxsiy Telegram', ...linked(!!telegramUser.account)),
    item('instagram', 'Instagram', ...linked(!!instagram.account, !!instagram.account && !!instagram.problem)),
  ];
}
