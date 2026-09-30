import { z } from 'zod';
import type { Business } from '../src/types';

/** Rasm (data URL) — hajmi cheklangan, faqat oddiy formatlar */
const image = (maxChars: number) => z.string().max(maxChars).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().trim().max(max);

export const BusinessSchema = z.object({
  name: text(60).min(1),
  ownerName: text(60),
  industry: text(80),
  description: text(1500).optional(),
  phone: text(40),
  address: text(160),
  addressRu: text(160).optional(),
  hours: text(120).optional(),
  instagram: text(60).optional(),
  website: text(120).optional(),
  contentLang: z.enum(['uz', 'ru']).optional(),
  morningBrief: z.boolean().optional(),
  brand: z.object({ primary: hex, accent: hex, logo: image(600_000).optional() }),
  offerings: z.array(z.object({
    id: text(40).min(1),
    name: text(80).min(1),
    nameRu: text(80).optional(),
    price: z.number().min(0).max(100_000_000_000),
  })).max(100),
  team: z.array(z.object({
    id: text(40).min(1),
    name: text(80).min(1),
    role: text(80),
    roleRu: text(80).optional(),
    years: z.number().int().min(0).max(70).optional(),
    photo: image(900_000).optional(),
  })).max(30),
}) satisfies z.ZodType<Business>;

/** Yangi biznes: bo'sh profil (egasi panelda to'ldiradi) */
export const emptyBusiness = (name: string, industry = ''): Business => ({
  name,
  ownerName: '',
  industry,
  phone: '',
  address: '',
  contentLang: 'uz',
  morningBrief: true,
  brand: { primary: '#4F46E5', accent: '#F59E0B' },
  offerings: [],
  team: [],
});
