/**
 * Kod qayerdan ishlayapti: klinikadagi nashr — yig'ilgan app/*.mjs (scripts/bundle.ts: siqilgan, izohsiz, manbasiz),
 * dasturchi nusxasi — manba kod (.ts, tsx orqali). Alohida jarayon yoki worker ochadigan joylar shunga qarab yo'l tanlaydi.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Yig'ilgan nashrda import.meta.url — app/<nom>.mjs */
export const COMPILED = import.meta.url.endsWith('.mjs');

/** Alohida jarayon uchun node argumentlari: yig'ilganda — app/<name>.mjs, manbada — tsx bilan source */
export const entryArgs = (name: string, source: string): string[] =>
  COMPILED ? ['--no-warnings', resolve('app', `${name}.mjs`)] : ['--no-warnings', '--import', 'tsx', source];

/** Worker fayli: yig'ilganda — app/<name>.mjs, manbada — source (.ts) */
export const workerUrl = (name: string, source: string): URL => pathToFileURL(resolve(COMPILED ? `app/${name}.mjs` : source));

/** Kod yonidagi yordamchi fayllar (C# ilgaklar va h.k.) — har doim loyiha ildizidan: yig'ilgan nashrda ham shu joyda turadi */
export const assetPath = (...parts: string[]): string => resolve(...parts);
