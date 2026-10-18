/**
 * Anketa: biznes egasi o'rnatuvchi kelishidan oldin to'ldiradi, klinika kompyuterida esa kod (yoki fayl) bilan yuklanadi.
 * Bu yerda — tekshirish (hajm, maxfiy kalit yo'qligi), saqlash (o'rnatuvchining «uy» serverida) va biznesga yozish
 * (profil, «Biznes haqida» sahifasi, narxlar, tayyor savollarga javoblar). Narx ziddiyatlari va yozilmagan kunlar jadvalga
 * taxmin qilib yozilmaydi — egasidan so'raladi (gaps.ts).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ALL_PACKS, packFor } from '../../src/data/industries';
import { CODE_ALPHABET, emptyAnketa, hoursText, type AnketaData, type AnketaStatus } from '../../src/lib/anketa';
import type { AnketaImport, AnketaView } from '../../src/types';
import { parsePrices, priceKey, splitConflicts, type PriceConflict } from '../../src/lib/prices';
import { containsSecret, instagramHandle } from '../../src/lib/secrets';
import { resetConversation } from '../agent';
import { importPrices, saveAnswer } from '../brain/index';
import { normalizeBaseUrl } from '../crm/logic';
import { anketas, businesses, type AnketaRow, type BusinessRow } from '../db';
import { env } from '../env';
import { readCapped } from '../readCapped';
import { aboutBody, setAboutLine, writeAbout } from './about';
import { setupOf, updateSetup } from './state';

const t = (max: number) => z.string().trim().max(max);
const day = t(40);
export const AnketaSchema = z.object({
  name: t(60), industry: t(80), ownerName: t(60), phone: t(40), address: t(160), landmark: t(160),
  hours: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
  about: t(1500), team: t(1500), prices: t(20_000),
  answers: z.record(z.string().max(40), t(800)).refine(r => Object.keys(r).length <= 40, 'Javoblar juda ko\'p'),
  instagram: t(80), telegramPhone: t(40), crm: z.enum(['dentacrm', 'other', 'none', '']), cameras: z.number().int().min(0).max(64), cameraBrand: t(60), notes: t(1500),
}) satisfies z.ZodType<AnketaData>;

const SECRET_IN_ANKETA = "Anketaga parol, token yoki kalit yozmang — ular o'rnatish kuni klinika kompyuterida kiritiladi. O'sha qatorni o'chirib, qayta saqlang.";
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

/** Kelgan anketani tekshiradi: shakl, hajm va ichida maxfiy kalit yo'qligi */
export function parseAnketa(input: unknown): { ok: true; data: AnketaData } | { ok: false; error: string } {
  const p = AnketaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: `Anketa noto'g'ri: ${p.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  if (strings(p.data).some(containsSecret)) return { ok: false, error: SECRET_IN_ANKETA };
  return { ok: true, data: p.data };
}

// ─── Saqlash (o'rnatuvchining serverida) ─────────────────────────────────────

const CODE_HALF = 4;
/** Anketa shuncha kun saqlanadi (ichida manzil, telefon va narxlar bor) */
export const ANKETA_DAYS = 60;

const randomCode = (): string => {
  const chars = [...randomBytes(CODE_HALF * 2)].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, CODE_HALF)}-${chars.slice(CODE_HALF)}`;
};

export function createAnketa(label: string, industry: string): AnketaRow {
  anketas.expire();
  let code = randomCode();
  while (anketas.get(code)) code = randomCode();
  return anketas.create(code, label, industry, new Date(Date.now() + ANKETA_DAYS * 86_400_000).toISOString());
}

/** Bazadagi anketa matni; bo'sh yoki buzilgan bo'lsa — yangi forma (nomi va sohasi o'rnatuvchi yozgandan) */
export function anketaData(row: AnketaRow): AnketaData {
  if (row.data) {
    try {
      const p = AnketaSchema.safeParse(JSON.parse(row.data));
      if (p.success) return p.data;
    } catch { /* pastda — bo'sh forma */ }
  }
  return { ...emptyAnketa(row.industry), name: row.label };
}

export const anketaView = (r: AnketaRow): AnketaView => ({ code: r.code, label: r.label, industry: r.industry, status: r.status as AnketaStatus, updatedAt: r.updatedAt, expiresAt: r.expiresAt });

/** Muddati o'tmagan anketa (bo'lmasa — undefined) */
export function liveAnketa(code: string): AnketaRow | undefined {
  const row = anketas.get(code);
  if (!row) return undefined;
  if (row.expiresAt < new Date().toISOString()) { anketas.remove(code); return undefined; }
  return row;
}

// ─── Boshqa serverdan olib kelish (klinika kompyuterida) ─────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_BYTES = 512 * 1024;

/** O'rnatuvchining serveridagi anketani kod bilan olib keladi. Faqat http(s), yo'naltirishsiz, hajmi cheklangan */
export async function fetchAnketa(source: string, code: string): Promise<AnketaData> {
  // DentaCRM manziliga qo'llanadigan qoida: xavfli manzillar yopiq, umumiy serverda (CRM_ALLOW_PRIVATE=0) ichki tarmoq ham
  let base: string;
  try { base = normalizeBaseUrl(source, env.crmAllowPrivate); } catch (e) {
    throw new Error(/DentaCRM/.test((e as Error).message) ? "Anketa serveri manzili noto'g'ri. Namuna: https://cerebro.example.uz" : (e as Error).message);
  }
  const unreachable = new Error("Anketa serveriga ulanib bo'lmadi — manzil va internetni tekshiring");
  const r = await fetch(`${base}/api/anketa/${encodeURIComponent(code)}`, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => { throw unreachable; });
  if (r.status === 404) throw new Error("Bunday kodli anketa yo'q yoki muddati o'tgan — kodni tekshiring");
  if (r.status === 429) throw new Error("Ko'p urinish — 15 daqiqadan keyin qayta urining");
  if (!r.ok) throw unreachable;
  const text = await readCapped(r, MAX_REMOTE_BYTES).catch(() => { throw new Error('Anketa juda katta yoki uzilib keldi'); });
  let body: { anketa?: { status?: string; data?: unknown } };
  try { body = JSON.parse(text); } catch { throw new Error("Bu manzil Cerebro anketa serveri emas"); }
  if (body.anketa?.status === 'new') throw new Error("Egasi anketani hali to'ldirmagan");
  const p = parseAnketa(body.anketa?.data);
  if (!p.ok) throw new Error(p.error);
  return p.data;
}

// ─── Biznesga yozish ─────────────────────────────────────────────────────────

const MIN_ANSWER = 2;

/** Ikki ziddiyat ro'yxatini qo'shadi: shu xizmat bo'yicha yangi anketadagi ziddiyat eskisining o'rnini oladi */
const mergeConflicts = (old: PriceConflict[], fresh: PriceConflict[]): PriceConflict[] =>
  [...old.filter(o => !fresh.some(f => priceKey(f.name) === priceKey(o.name))), ...fresh];

/** Manzil mo'ljal bilan: «Chilonzor 9-kvartal (mo'ljal: Chilonzor metrosi)» — mijozga shunday aytiladi */
const withLandmark = (d: AnketaData): string => (d.address ? `${d.address}${d.landmark ? ` (mo'ljal: ${d.landmark})` : ''}` : '');

/** «Biznes haqida» sahifasining yangi matni: egasining eski matni saqlanadi, aloqa qatorlari yangilanadi */
function aboutFrom(bizId: string, d: AnketaData): string {
  let body = aboutBody(bizId);
  if (d.about && !body.includes(d.about)) body = body ? `${d.about}\n\n${body}` : d.about;
  const handle = instagramHandle(d.instagram) ?? d.instagram.replace(/^@/, '');
  const lines: [string, string][] = [['Telefon', d.phone], ['Manzil', withLandmark(d)], ['Ish vaqti', hoursText(d.hours)], ['Instagram', handle ? `@${handle}` : '']];
  for (const [label, value] of lines) if (value.trim()) body = setAboutLine(body, label, value);
  const team = d.team.split(/\r?\n/).map(l => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  if (team.length && !/^## Jamoa/m.test(body)) body = `${body}\n\n## Jamoa\n${team.map(l => `- ${l}`).join('\n')}`;
  return body;
}

/** Anketani biznesga yozadi. code — qaysi anketadan (fayldan yuklansa — null) */
export function applyAnketa(biz: BusinessRow, given: AnketaData, code: string | null): AnketaImport {
  const fresh = businesses.byId(biz.id) ?? biz;
  const p = fresh.profile;
  // Qayta yuklansa: anketada bo'sh qolgan kun uchun egasi avval aytgan vaqt saqlanadi (bo'shliq qayta so'ralmasin)
  const before = setupOf(fresh).hours;
  const d: AnketaData = before ? { ...given, hours: Object.fromEntries(Object.entries(given.hours).map(([k, v]) => [k, v.trim() || before[k as keyof typeof before] || ''])) as AnketaData['hours'] } : given;
  const handle = instagramHandle(d.instagram) ?? (d.instagram.replace(/^@/, '') || undefined);
  businesses.update(biz.id, {
    profile: {
      ...p,
      name: d.name || p.name,
      ownerName: d.ownerName || p.ownerName,
      industry: d.industry || p.industry,
      phone: d.phone || p.phone,
      address: (withLandmark(d) || p.address).slice(0, 160),
      hours: (hoursText(d.hours) || p.hours || '').slice(0, 120),
      instagram: handle ?? p.instagram,
      description: d.about || p.description,
    },
  });
  const body = aboutFrom(biz.id, d);
  if (body) writeAbout(biz.id, body);

  const parsed = parsePrices(d.prices);
  const { clean, conflicts } = splitConflicts(parsed.items);
  const imported = clean.length ? importPrices(businesses.byId(biz.id)!, clean) : { added: 0, updated: 0 };

  let answers = 0;
  const withAnswers = businesses.byId(biz.id)!;
  for (const [id, text] of Object.entries(d.answers)) {
    // Savol matni — shu biznes sohasining ro'yxatidan (bir xil id turli sohada boshqacha so'raladi)
    const q = packFor(d.industry || p.industry, d.crm === 'dentacrm').find(x => x.id === id) ?? ALL_PACKS.find(x => x.id === id);
    if (!q || text.trim().length < MIN_ANSWER) continue;
    try {
      saveAnswer(withAnswers, q.question, text, `pack:${id}`);
      answers++;
    } catch (e) {
      console.error('[anketa] javob yozilmadi:', (e as Error).message);
      break;
    }
  }

  updateSetup(biz.id, s => ({
    ...s,
    conflicts: mergeConflicts(s.conflicts, conflicts),
    hours: d.hours,
    has: { instagram: handle ?? '', telegramPhone: d.telegramPhone, crm: d.crm, cameras: d.cameras, cameraBrand: d.cameraBrand },
    anketa: { code, importedAt: new Date().toISOString() },
  }));
  resetConversation(biz.id);
  return { prices: { added: imported.added, updated: imported.updated, conflicts: conflicts.length, unclear: parsed.unclear.length }, answers, about: !!body };
}
