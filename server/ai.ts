/**
 * AI matn (Claude). Bitta so'rovda haftaning hamma posti yoziladi, javob JSON
 * sxema bo'yicha keladi. Har bir matn tekshiriladi:
 *   - uzunlik (rasmga sig'ishi kerak),
 *   - tibbiy reklama filtri (kafolat, 100%, "eng yaxshi"…),
 *   - raqamlar faqat klinika bergan faktlardan (AI chegirma yoki narx o'ylab topmasin).
 * O'tmagan matn o'rniga tayyor bankdagisi ishlatiladi.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AiLangText, AiText, Clinic, Lang, TemplateId } from '../src/types';
import { check } from '../src/lib/compliance';
import { promoText, yearsText, type SlotPlan } from '../src/lib/generator';
import { env } from './env';

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 180_000 }));

// Model rad etsa (xavfsizlik filtri) — so'rov server tomonda boshqa modelda qayta bajariladi
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

const LANG_TEXT = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
    closer: { type: 'string' },
  },
  required: ['hook', 'title', 'lines', 'closer'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, uz: LANG_TEXT, ru: LANG_TEXT },
        required: ['id', 'uz', 'ru'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM = `You write social-media content for a dental clinic in Uzbekistan: Instagram and Telegram posts that the clinic owner approves before anything is published. Write every text twice: "uz" in Uzbek (Latin script) and "ru" in Russian.

Facts
- Use only the facts in the request (clinic, services, prices, doctors, promotion, occasion). Do not invent discounts, prices, percentages, dates, equipment, brands, materials, techniques, awards, education, reviews or statistics.
- General oral-hygiene knowledge is fine in tips (for example: change the toothbrush every 3 months).

Medical advertising rules
- Never promise or guarantee treatment results.
- Never write "100%", "kafolat" / "гарантия", "og'riqsiz" / "безболезненно" (you may write "mahalliy og'riqsizlantirish bilan" / "с местной анестезией"), "abadiy" / "навсегда", or superiority claims such as "eng yaxshi", "лучший", "№1".
- Remembrance days: respectful tone, no promotion.

Language
- Uzbek: Latin alphabet with the plain apostrophe ' in o', g' and for the glottal stop; natural, warm, simple everyday words.
- Russian: natural and polite, address the reader as "вы".
- Plain text only: no emojis, hashtags, quotation marks, markdown or line breaks inside a field.

Fields
Each item has a "task" saying which fields to fill; set the other fields to "" (strings) or [] (lines). Stay within the character limits in the task: the text is printed on an image with limited space. Items marked with a higher "variant" number should differ from the obvious first idea.`;

const TASKS: Partial<Record<TemplateId, string>> = {
  promo: 'Post about the service in "context". hook: one engaging opening sentence about why this matters to the patient (max 120 chars). lines: exactly 2 short benefits that are true for any clinic offering this service (max 55 chars each). title and closer: "".',
  tip: 'Practical oral-health tip for patients. title: headline or question (max 60 chars). lines: exactly 3 short actionable points (max 50 chars each). closer: one friendly sentence inviting questions or a check-up (max 120 chars). hook: "". Pick a topic not in "avoid".',
  doctor: 'Introduce the doctor in "context". closer: one warm sentence inviting patients to book with this doctor (max 110 chars), without inventing any detail about the doctor. hook, title: "", lines: [].',
  holiday: 'Greeting for the occasion in "context". lines: exactly 2 short greeting lines (max 55 chars each). hook, title, closer: "", no promotion.',
  poll: 'Instagram story poll about oral-health habits. title: the question (max 55 chars). lines: exactly 2 short answer options (max 18 chars each). hook, closer: "".',
};

/** Qaysi shablonlar AI matnini oladi (bo'sh vaqtlar storisi — faqat klinika ma'lumoti) */
export const aiTemplates = new Set<TemplateId>(['promo', 'tip', 'doctor', 'holiday', 'poll']);

interface Limits { hook?: [number, number]; title?: [number, number]; lines?: [number, number, number]; closer?: [number, number] }
const LIMITS: Partial<Record<TemplateId, Limits>> = {
  promo: { hook: [10, 150], lines: [2, 3, 60] },
  tip: { title: [5, 70], lines: [3, 3, 58], closer: [10, 150] },
  doctor: { closer: [10, 130] },
  holiday: { lines: [2, 3, 62] },
  poll: { title: [5, 62], lines: [2, 1, 22] },
};

const clean = (s: unknown): string => String(s ?? '')
  .replace(/[‘’ʻʼ`]/g, "'")
  .replace(/\s+/g, ' ')
  .replace(/^["«»“”]+|["«»“”]+$/g, '')
  .trim();

function contextOf(clinic: Clinic, p: SlotPlan): Record<string, unknown> {
  switch (p.template) {
    case 'promo':
      return {
        service: { uz: p.service?.name, ru: p.service?.nameRu || p.service?.name, price: p.service?.price || undefined },
        promotion: clinic.goal.promo ? { uz: promoText('uz', clinic), ru: promoText('ru', clinic), until: clinic.goal.promoUntil } : undefined,
      };
    case 'doctor':
      return p.doctor ? {
        name: p.doctor.name,
        specialty: { uz: p.doctor.specialty, ru: p.doctor.specialtyRu || p.doctor.specialty },
        experience: p.doctor.years ? { uz: yearsText('uz', p.doctor.years), ru: yearsText('ru', p.doctor.years) } : undefined,
      } : {};
    case 'holiday':
      return p.occasion ? { title: p.occasion.title, date: p.occasion.date, remembrance: p.occasion.solemn, dental: p.occasion.dental } : {};
    default:
      return {};
  }
}

/** Matnni tekshiradi; o'tmasa — sababi */
function validate(template: TemplateId, t: AiLangText, allowedNumbers: Set<string>, percentAllowed: boolean): string | null {
  const lim = LIMITS[template] ?? {};
  const inRange = (s: string, [lo, hi]: [number, number]) => s.length >= lo && s.length <= hi;
  if (lim.hook && !inRange(t.hook, lim.hook)) return `hook uzunligi ${t.hook.length}`;
  if (lim.title && !inRange(t.title, lim.title)) return `title uzunligi ${t.title.length}`;
  if (lim.closer && !inRange(t.closer, lim.closer)) return `closer uzunligi ${t.closer.length}`;
  if (lim.lines) {
    const [count, lo, hi] = lim.lines;
    if (t.lines.length < count) return `lines soni ${t.lines.length}`;
    const bad = t.lines.slice(0, count).find(l => !inRange(l, [lo, hi]));
    if (bad !== undefined) return `lines uzunligi ${bad.length}`;
  }
  const all = [t.hook, t.title, ...t.lines, t.closer].join('\n');
  const issues = check(all);
  if (issues.length) return `qoida: ${issues.map(i => i.phrase).join(', ')}`;
  // Maslahatda umumiy raqamlar (3 oy, 2 daqiqa) mumkin; boshqa postlarda — faqat faktlardagi raqamlar
  if (template !== 'tip') {
    const foreign = (all.match(/\d+/g) ?? []).filter(n => !allowedNumbers.has(n));
    if (foreign.length) return `faktda yo'q raqam: ${foreign.join(', ')}`;
    if (!percentAllowed && all.includes('%')) return 'faktda yo\'q foiz';
  }
  return null;
}

export interface AiResult {
  /** API ishladimi (false — tarmoq/xato: keyinroq qayta urinish mumkin) */
  ok: boolean;
  /** id → matn; null — qoidadan o'tmadi (bank ishlatiladi) */
  texts: Record<string, AiText | null>;
}

/**
 * Rejadagi postlar uchun matn yozadi.
 * avoid — oldingi haftalardagi maslahat sarlavhalari (takrorlanmasin).
 */
export async function writeTexts(clinic: Clinic, plans: SlotPlan[], avoid: string[] = []): Promise<AiResult> {
  const targets = plans.filter(p => aiTemplates.has(p.template));
  if (!env.aiEnabled || !targets.length) return { ok: env.aiEnabled, texts: {} };

  const request = {
    clinic: {
      name: clinic.name,
      city_address: clinic.address,
      services: clinic.services.map(s => ({ uz: s.name, ru: s.nameRu || s.name, price: s.price || undefined })),
      doctors: clinic.doctors.map(d => ({ name: d.name, specialty: d.specialty, years: d.years })),
    },
    items: targets.map(p => ({
      id: p.id,
      template: p.template,
      variant: p.seed,
      task: TASKS[p.template],
      context: contextOf(clinic, p),
      ...(p.template === 'tip' ? { avoid: avoid.slice(0, 20) } : {}),
    })),
  };

  let parsed: { items: { id: string; uz: AiLangText; ru: AiLangText }[] };
  try {
    const res = await api().beta.messages.create({
      model: env.aiModel,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(request) }],
    });
    if (res.stop_reason === 'refusal') {
      console.warn('[AI] rad etildi:', res.stop_details?.category ?? '');
      return { ok: true, texts: Object.fromEntries(targets.map(p => [p.id, null])) };
    }
    const block = res.content.find(b => b.type === 'text');
    parsed = JSON.parse(block && block.type === 'text' ? block.text : '{}');
    console.log(`[AI] ${targets.length} ta matn · ${res.usage.input_tokens} kirish / ${res.usage.output_tokens} chiqish token`);
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error(`[AI] API xatosi ${e.status}: ${e.message}`);
    else console.error('[AI] xato:', (e as Error).message);
    return { ok: false, texts: {} };
  }

  const texts: Record<string, AiText | null> = {};
  for (const p of targets) {
    const got = parsed.items?.find(i => i.id === p.id);
    if (!got) { texts[p.id] = null; continue; }
    const norm = (t: AiLangText): AiLangText => ({
      hook: clean(t?.hook), title: clean(t?.title), closer: clean(t?.closer),
      lines: (Array.isArray(t?.lines) ? t.lines : []).map(clean).filter(Boolean),
    });
    const text: AiText = { uz: norm(got.uz), ru: norm(got.ru) };
    const facts = `${JSON.stringify(contextOf(clinic, p))} ${promoText('uz', clinic)} ${promoText('ru', clinic)}`;
    const allowed = new Set(facts.match(/\d+/g) ?? []);
    const reasons = (['uz', 'ru'] as Lang[]).map(l => validate(p.template, text[l], allowed, facts.includes('%'))).filter(Boolean);
    if (reasons.length) {
      console.warn(`[AI] ${p.id} (${p.template}) rad etildi: ${reasons.join('; ')}`);
      texts[p.id] = null;
    } else texts[p.id] = text;
  }
  return { ok: true, texts };
}

const QA_SYSTEM = `You are Cerebro, a Telegram assistant for the owner of a dental clinic. You prepare the clinic's weekly posts and track who contacts the clinic through the booking link in posts.
Answer the owner's question in Uzbek (Latin script, plain apostrophe ') in at most 4 short sentences, using only the data provided. If the data does not contain the answer, say so and mention what you can report: this week's posts and their status, clicks on the booking link, and people who left a phone number. Plain text, no markdown.`;

/** Egasining savoliga javob (natijalar ma'lumoti asosida). Xato bo'lsa — null */
export async function answerOwner(question: string, data: unknown): Promise<string | null> {
  if (!env.aiEnabled) return null;
  try {
    const res = await api().beta.messages.create({
      model: env.aiModel,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: 'low' },
      system: QA_SYSTEM,
      messages: [{ role: 'user', content: `Data:\n${JSON.stringify(data)}\n\nQuestion: ${question}` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const block = res.content.find(b => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    return text || null;
  } catch (e) {
    console.error('[AI] savolga javob xatosi:', (e as Error).message);
    return null;
  }
}
