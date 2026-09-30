/** Claude mijozi (yordamchi ham, mijozlarga javob ham shu orqali) */
import Anthropic from '@anthropic-ai/sdk';
import type { BusinessRow } from './db';

let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 600_000 }));

// Model rad etsa yoki band bo'lsa — so'rov server tomonda zaxira modelda bajariladi
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

/** Biznes profili — Claude uchun matn (yordamchi va mijozlarga javob bir xil faktlardan foydalanadi) */
export function profileText(b: BusinessRow): string {
  const p = b.profile;
  const lines = [
    `Name: ${p.name}`,
    p.ownerName && `Owner: ${p.ownerName}`,
    `Industry: ${p.industry || 'not set'}`,
    p.description && `About: ${p.description}`,
    p.phone && `Phone: ${p.phone}`,
    p.address && `Address: ${p.address}`,
    p.hours && `Hours: ${p.hours}`,
    p.instagram && `Instagram: ${p.instagram}`,
    p.website && `Website: ${p.website}`,
    `Post language: ${p.contentLang === 'ru' ? 'Russian' : 'Uzbek'}`,
    `Telegram channel for posts: ${b.channelTitle ?? 'not connected'}`,
    p.offerings.length ? `Products and services (price in so'm, 0 = not given):\n${p.offerings.map(o => `- ${o.name}${o.nameRu ? ` / ${o.nameRu}` : ''}: ${o.price || 0}`).join('\n')}` : 'Products and services: not listed yet',
    p.team.length ? `Team:\n${p.team.map(m => `- ${m.name} — ${m.role}${m.years ? `, ${m.years} years` : ''} (member_id: ${m.id})`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
