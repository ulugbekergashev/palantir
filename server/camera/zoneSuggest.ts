/**
 * AI zonalarni taklif qiladi — sof qism: modelga beriladigan javob shakli va model javobini tekshirish.
 * Taklif saqlanmaydi: panel uni muharrirga qo'yadi, egasi joyini tuzatib saqlaydi. Maxfiy joyni AI taklif qilmaydi (uni egasi biladi).
 */
export type SuggestKind = 'chair' | 'desk' | 'waiting' | 'staff';
export interface ZoneSuggestion { kind: SuggestKind; name: string; x: number; y: number; w: number; h: number }

const KINDS: readonly SuggestKind[] = ['chair', 'desk', 'waiting', 'staff'];
export const MAX_SUGGESTED = 6;
/** Bundan kichik to'rtburchak — xato (bir nuqta) */
const MIN_SIDE = 0.04;
const DEFAULT_NAME: Record<SuggestKind, string> = { chair: 'Kreslo', desk: 'Kassa', waiting: 'Kutish joyi', staff: 'Administrator' };

export const ZONES_SCHEMA = {
  type: 'object',
  properties: {
    zones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: [...KINDS] }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
        required: ['kind', 'name', 'x', 'y', 'w', 'h'],
        additionalProperties: false,
      },
    },
  },
  required: ['zones'],
  additionalProperties: false,
};

export const ZONES_REQUEST = `<zones_request>
Propose zones on this frame for the owner to confirm (they will adjust them). Kinds:
- "chair": a dental or treatment chair — the seat where a patient sits or lies;
- "desk": the cash desk or reception counter, the customer side where people stand to pay;
- "waiting": waiting-area seats or a sofa;
- "staff": the staff seat behind the reception counter.
Only what is clearly visible; at most ${MAX_SUGGESTED}; skip anything you are unsure of; an empty list is a fine answer.
Boxes are fractions of the frame: x, y — top-left corner, w, h — width and height, all between 0 and 1. Cover the place where a person would be (the seat), not the whole room.
Names in Uzbek: "Kreslo 1", "Kreslo 2", "Kassa", "Kutish joyi", "Administrator".
</zones_request>`;

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Model javobini tekshiradi: turi ma'lum, kadr ichida, juda kichik emas; nomi bo'lmasa — turidan (kreslolar raqamlanadi) */
export function cleanSuggestions(raw: unknown): ZoneSuggestion[] {
  const list = Array.isArray((raw as { zones?: unknown })?.zones) ? (raw as { zones: unknown[] }).zones : [];
  const out: ZoneSuggestion[] = [];
  for (const item of list) {
    const z = item as Record<string, unknown>;
    if (!KINDS.includes(z.kind as SuggestKind)) continue;
    const x = unit(z.x), y = unit(z.y);
    const w = Math.min(1 - x, unit(z.w)), h = Math.min(1 - y, unit(z.h));
    if (![x, y, w, h].every(Number.isFinite) || w < MIN_SIDE || h < MIN_SIDE) continue;
    const kind = z.kind as SuggestKind;
    const chairs = out.filter(o => o.kind === 'chair').length;
    const name = String(z.name ?? '').replace(/[<>]/g, '').trim().slice(0, 40) || (kind === 'chair' ? `Kreslo ${chairs + 1}` : DEFAULT_NAME[kind]);
    out.push({ kind, name, x: round(x), y: round(y), w: round(w), h: round(h) });
    if (out.length >= MAX_SUGGESTED) break;
  }
  return out;
}
