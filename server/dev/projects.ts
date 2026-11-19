/**
 * Dasturchi: egasining loyihalari ro'yxati (.env DEV_PROJECTS). Faqat shu ro'yxatdagi papkalarda ishlanadi — yordamchi nomni tanlaydi,
 * papkani emas. Ro'yxat bo'sh — Dasturchi yo'q (klinika o'rnatmalari).
 */
import { resolve } from 'node:path';
import { env } from '../env';

export interface Project { name: string; dir: string }

/** Ish yoki yig'ish boshlanmadi: matni egasiga (yordamchi orqali) aytiladi */
export class DevError extends Error {}

/** Nomni solishtirish: «X Clinic», «x-clinic», «xclinic» — bitta loyiha */
const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

/** «nom=papka;nom=papka». Nomsiz, papkasiz yoki takror nomli yozuv tashlab ketiladi */
export function parseProjects(raw: string): Project[] {
  const out: Project[] = [];
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim(), dir = part.slice(at + 1).trim().replace(/^"(.*)"$/, '$1');
    if (!keyOf(name) || !dir || out.some(p => keyOf(p.name) === keyOf(name))) continue;
    out.push({ name, dir: resolve(dir) });
  }
  return out;
}

export const projects = (): Project[] => parseProjects(env.devProjects);
export const devEnabled = (): boolean => projects().length > 0;
export const findProject = (name: string, list: Project[] = projects()): Project | null => list.find(p => keyOf(p.name) === keyOf(name)) ?? null;
