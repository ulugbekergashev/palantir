import { z } from 'zod';
import type { Clinic } from '../src/types';

/** Rasm (data URL) — hajmi cheklangan, faqat oddiy formatlar */
const image = (maxChars: number) => z.string().max(maxChars).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().trim().max(max);

export const ClinicSchema = z.object({
  name: text(60).min(1),
  ownerName: text(60),
  phone: text(40),
  address: text(160),
  addressRu: text(160).optional(),
  instagram: text(60).optional(),
  telegramBot: text(60).optional(),
  telegramChannel: text(60).optional(),
  followers: z.number().int().min(0).max(10_000_000),
  contentLang: z.enum(['uz', 'ru']).optional(),
  brand: z.object({ primary: hex, accent: hex, logo: image(600_000).optional() }),
  services: z.array(z.object({
    id: text(40).min(1),
    name: text(80),
    nameRu: text(80).optional(),
    price: z.number().min(0).max(10_000_000_000),
  })).max(60),
  doctors: z.array(z.object({
    id: text(40).min(1),
    name: text(80),
    specialty: text(80),
    specialtyRu: text(80).optional(),
    years: z.number().int().min(0).max(70).optional(),
    photo: image(900_000).optional(),
  })).max(30),
  goal: z.object({
    focusServiceId: text(40).optional(),
    promo: text(140).optional(),
    promoRu: text(140).optional(),
    promoUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    freeSlots: z.array(z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/) })).max(5),
  }),
}) satisfies z.ZodType<Clinic>;

/** Yangi klinika: odatiy xizmatlar ro'yxati (narxini egasi to'ldiradi) */
export const emptyClinic = (name: string): Clinic => ({
  name,
  ownerName: '',
  phone: '',
  address: '',
  followers: 0,
  contentLang: 'uz',
  brand: { primary: '#0F766E', accent: '#F59E0B' },
  services: [
    { id: 's-consult', name: "Ko'rik va konsultatsiya", nameRu: 'Осмотр и консультация', price: 0 },
    { id: 's-clean', name: 'Professional tozalash', nameRu: 'Профессиональная чистка', price: 0 },
    { id: 's-fill', name: 'Plomba', nameRu: 'Пломба', price: 0 },
    { id: 's-canal', name: 'Kanal davolash', nameRu: 'Лечение каналов', price: 0 },
    { id: 's-implant', name: 'Implant', nameRu: 'Имплантация', price: 0 },
    { id: 's-braces', name: 'Breket tizimi', nameRu: 'Брекет-система', price: 0 },
    { id: 's-white', name: 'Tish oqartirish', nameRu: 'Отбеливание зубов', price: 0 },
    { id: 's-kids', name: 'Bolalar stomatologiyasi', nameRu: 'Детская стоматология', price: 0 },
  ],
  doctors: [],
  goal: { freeSlots: [] },
});
