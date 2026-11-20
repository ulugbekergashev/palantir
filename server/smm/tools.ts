/**
 * SMM-menejer asboblari: kalendar (sanalar bilan), postlarni tayyorlash (matn + shablon dizayn), kalendarni ko'rish va bitta dizayn.
 * Hech narsa egasining tasdig'isiz chiqmaydi: tayyor post egasiga Telegram'da, tasdiqlangani vaqti kelganda o'zi chiqadi
 */
import { z } from 'zod';
import { addDays, iso } from '../../src/lib/week';
import { brandStore } from '../content/brand';
import { pictureMaker, drawPicture } from '../content/picture';
import { notifyOwnerPhoto } from '../inbox/core';
import { ToolError, assertOwnWords, def } from '../toolkit';
import { DesignError, FORMATS, TEMPLATES, designBrand, renderDesign, type DesignFormat } from './design';
import { DAYS_MAX, DAYS_MIN, PER_WEEK_MAX, PER_WEEK_MIN, makeCalendar } from './plan';
import { postLabel, prepareAhead } from './prepare';
import { SmmError, smmStore } from './store';

const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { throw e instanceof SmmError || e instanceof DesignError ? new ToolError(e.message) : e; }
};

const STATUS: Record<string, string> = {
  idea: "g'oya", drawing: 'tayyorlanmoqda', ready: 'egasi tasdig\'ini kutyapti', approved: 'tasdiqlangan — vaqtida chiqadi', publishing: 'chiqmoqda',
  published: 'chiqdi', failed: 'chiqmadi', handed: "egasiga yuborildi (o'zi joylaydi)",
};

export const SMM_DEFS = {
  smm_calendar: def({
    description: `The SMM-menejer's content calendar: plan posts for the next ${DAYS_MIN}-${DAYS_MAX} days with a date, time, channel (Instagram or the Telegram channel) and format (post, carousel of 3-6 slides, Instagram story), spread over the brand book's pillars and the upcoming holidays. Replaces the not-yet-prepared ideas from tomorrow on; prepared and approved posts stay. If there is no brand book yet, one is written first — say so. After this, call smm_prepare to write and design the posts. Takes up to two minutes.`,
    input: z.object({
      days: z.number().int().min(DAYS_MIN).max(DAYS_MAX).describe('How many days ahead, from tomorrow'),
      per_week: z.number().int().min(PER_WEEK_MIN).max(PER_WEEK_MAX).describe('Posts a week'),
      wish: z.string().max(600).optional().describe("The owner's focus in their words (services to push, events, tone)"),
    }),
    run: async (i, ctx) => guarded(async () => {
      assertOwnWords(ctx);
      const r = await makeCalendar(ctx.biz, { days: i.days, perWeek: i.per_week, wish: i.wish ?? '' });
      return { posts: r.posts.map(p => `${postLabel(p)} — ${p.title}`), madeBrandBook: r.madeBrand, next: 'smm_prepare' };
    }),
  }),

  smm_prepare: def({
    description: "Prepare the calendar's ideas for the next N days: for each post the SMM-menejer writes the text (brand voice, call to action, hashtags for Instagram) and designs the pictures on the brand's templates (a photo or AI background with crisp text on top). Runs in the background, a minute or two per post; each finished post goes to the owner's Telegram with a «Tasdiqlash» button, and at the end one button approves them all. Approved posts go out by themselves at their time. Tell the owner this.",
    input: z.object({ days: z.number().int().min(1).max(DAYS_MAX).describe('Prepare the ideas from tomorrow up to this many days ahead') }),
    run: async (i, ctx) => guarded(async () => {
      assertOwnWords(ctx);
      const from = iso(addDays(new Date(), 1)), to = iso(addDays(new Date(), i.days));
      const r = prepareAhead(ctx.biz, from, to);
      void r.done.catch(e => console.error('[smm] tayyorlash:', (e as Error).message));
      if (!r.queued) throw new ToolError(`${from} – ${to} oralig'ida tayyorlanadigan g'oya yo'q — avval smm_calendar`);
      return { queued: r.queued, from, to, picture: pictureMaker(ctx.biz) ? 'AI fon chizadi' : "fon — brend rangida (rasm chizadigan xizmat ulanmagan)" };
    }),
  }),

  smm_calendar_view: def({
    description: 'Show the content calendar from today: date, time, channel, format, title and status of each post (idea, waiting for the owner, approved, published, failed with the reason).',
    input: z.object({}),
    run: (_i, ctx) => {
      const posts = smmStore.from(ctx.biz.id, iso(new Date()), 60);
      return { posts: posts.map(p => ({ id: p.id, when: postLabel(p), title: p.title, status: STATUS[p.status] ?? p.status, ...(p.error ? { error: p.error } : {}) })) };
    },
  }),

  smm_design: def({
    description: `Design one picture outside the calendar on the brand's templates and send it to the owner's Telegram: ${TEMPLATES.join(', ')} (announce — news/event; promo — an offer the owner stated; doctor — a specialist; tip — advice; holiday — a greeting; review — a real customer quote). Formats: ${Object.entries(FORMATS).map(([k, f]) => `${k} — ${f.label}`).join('; ')}. Text on the picture must be short (headline ≤ 55 characters). picture — what the AI background photo shows (empty for a plain brand background). Never invent prices or discounts.`,
    input: z.object({
      template: z.enum(TEMPLATES), format: z.enum(Object.keys(FORMATS) as [DesignFormat, ...DesignFormat[]]),
      headline: z.string().trim().min(2).max(90), sub: z.string().trim().max(160).optional(), badge: z.string().trim().max(20).optional(),
      bullets: z.array(z.string().trim().min(1).max(70)).max(4).optional(), cta: z.string().trim().max(32).optional(),
      picture: z.string().trim().max(600).optional().describe('Background photo description, no text in it'),
    }),
    run: async (i, ctx) => guarded(async () => {
      const maker = i.picture ? pictureMaker(ctx.biz) : null;
      const photo = maker && i.picture ? await drawPicture(ctx.biz, i.picture, maker).catch(() => null) : null;
      const jpeg = await renderDesign({ ...i, sub: i.sub ?? null, badge: i.badge ?? null, bullets: i.bullets ?? [], cta: i.cta ?? null, photo }, designBrand(ctx.biz, brandStore.book(ctx.biz.id)));
      const sent = await notifyOwnerPhoto(ctx.biz, jpeg, `🎨 <b>SMM-menejer</b>: dizayn tayyor (${FORMATS[i.format].label})`);
      return { sent: sent !== null, background: photo ? 'AI surati' : 'brend rangi', note: sent !== null ? "Rasm egasining Telegram'ida" : "Telegram ulanmagan — rasm yuborilmadi" };
    }),
  }),
};
