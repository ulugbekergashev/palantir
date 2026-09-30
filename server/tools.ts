/**
 * Yordamchining qo'llari: Claude chaqiradigan asboblar.
 * Har bir asbob kirishini zod bilan tekshiradi (xato bo'lsa — Claude'ga sababi
 * qaytadi va u tuzatadi) va faqat shu biznesning ma'lumotiga tegadi.
 *
 * Tashqariga chiqadigan narsa (kanalga post, mijozlarga xabar) bu yerda faqat
 * QORALAMA bo'ladi — egasi tugmani bosgandagina yuboriladi.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Artifact, ContentItem, Design, LeadStage, Task, TemplateId } from '../src/types';
import { check, isMedical } from '../src/lib/compliance';
import { upcomingOccasions } from '../src/lib/occasions';
import { iso, stamp } from '../src/lib/week';
import { documents, inbox, leads, newId, notes, outbound, posts, replies, tasks, type BusinessRow } from './db';

export interface ToolCtx {
  biz: BusinessRow;
  /** Javob bilan birga egasiga ko'rsatiladigan narsalar (hujjat, post, xabar qoralamasi…) */
  artifacts: Artifact[];
}

interface ToolDef<S extends z.ZodType> {
  description: string;
  input: S;
  run: (input: z.infer<S>, ctx: ToolCtx) => unknown;
}

/** Xato: Claude'ga is_error bilan qaytadi */
class ToolError extends Error {}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:MM');
const short = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

const taskView = (t: Task) => ({ id: t.id, title: t.title, due_at: t.dueAt, status: t.status, notes: t.notes });
const leadView = (l: ReturnType<typeof leads.list>[number]) => ({
  id: l.id, name: l.name, phone: l.phone, username: l.username, stage: l.stage, note: l.note, source: l.source,
  channel: l.channel, reachable: l.reachable, created: l.createdAt.slice(0, 10),
});

// ─── Post shablonlari: qaysi maydon qancha sig'adi ────────────────────────────

interface Limits { title: number; lines: [min: number, max: number, len: number]; first?: number; badge?: number; cta?: number }
const LIMITS: Record<TemplateId, Limits> = {
  promo: { title: 40, badge: 8, first: 110, lines: [1, 3, 42], cta: 40 },
  tip: { title: 70, lines: [3, 3, 60], cta: 90 },
  team: { title: 40, lines: [1, 3, 140], cta: 40 },
  holiday: { title: 50, lines: [1, 2, 70] },
  list: { title: 22, lines: [2, 5, 44], cta: 36 },
  poll: { title: 70, lines: [2, 2, 20], cta: 50 },
};

function checkDesign(template: TemplateId, d: Design): string[] {
  const lim = LIMITS[template];
  const errors: string[] = [];
  if (d.title.length > lim.title) errors.push(`title ${d.title.length} belgi (ko'pi bilan ${lim.title})`);
  if (d.kicker.length > 22) errors.push(`kicker ${d.kicker.length} belgi (ko'pi bilan 22)`);
  if (d.lines.length < lim.lines[0] || d.lines.length > lim.lines[1]) errors.push(`lines: ${lim.lines[0]}–${lim.lines[1]} ta kerak, ${d.lines.length} ta berildi`);
  d.lines.forEach((l, i) => {
    const max = i === 0 && lim.first ? lim.first : lim.lines[2];
    if (l.length > max) errors.push(`lines[${i}] ${l.length} belgi (ko'pi bilan ${max})`);
  });
  if (template === 'list') {
    d.lines.forEach((l, i) => {
      const [left = '', right = ''] = l.split('|');
      if (!l.includes('|') || !left.trim() || !right.trim()) errors.push(`lines[${i}] "chap|o'ng" ko'rinishida bo'lsin`);
      else if (left.trim().length > 26 || right.trim().length > 14) errors.push(`lines[${i}]: chapi ≤26, o'ngi ≤14 belgi`);
    });
  }
  if (d.badge && lim.badge && d.badge.length > lim.badge) errors.push(`badge ${d.badge.length} belgi (ko'pi bilan ${lim.badge})`);
  if (d.badge && !lim.badge) errors.push(`${template} shablonida badge yo'q`);
  if (d.cta && d.cta.length > (lim.cta ?? 40)) errors.push(`cta ${d.cta.length} belgi (ko'pi bilan ${lim.cta ?? 40})`);
  if (d.footnote && d.footnote.length > 80) errors.push(`footnote ${d.footnote.length} belgi (ko'pi bilan 80)`);
  return errors;
}

/** Reklama filtri: topilsa — Claude qayta yozadi */
function complianceErrors(ctx: ToolCtx, texts: string[]): string[] {
  const medical = isMedical(ctx.biz.profile.industry);
  return check(texts.join('\n'), { medical }).map(i => `«${i.phrase}» — ${i.why}; ${i.hint}`);
}

// ─── Asboblar ─────────────────────────────────────────────────────────────────

const def = <S extends z.ZodType>(d: ToolDef<S>) => d;

const DEFS = {
  create_task: def({
    description: 'Create a task or reminder for the owner. When the owner gives a time, set due_at (local time) and Cerebro sends a Telegram reminder at that moment with Done/Snooze buttons. A date without a time means 09:00. Leave due_at out for tasks with no deadline.',
    input: z.object({
      title: short(200).describe('What to do, short and clear, in the owner\'s language'),
      due_at: localTime.nullable().optional().describe('Local time YYYY-MM-DDTHH:MM'),
      notes: opt(1000),
    }),
    run: (i, ctx) => {
      const t = tasks.create(ctx.biz.id, i.title, i.due_at ?? null, clean(i.notes));
      ctx.artifacts.push({ type: 'task', task: t });
      return { created: taskView(t) };
    },
  }),

  list_tasks: def({
    description: 'List the owner\'s tasks with their ids.',
    input: z.object({ status: z.enum(['open', 'done', 'all']).optional().describe('Default: open') }),
    run: (i, ctx) => ({ tasks: tasks.list(ctx.biz.id, i.status ?? 'open', 100).map(taskView) }),
  }),

  update_task: def({
    description: 'Change a task: mark it done or cancelled, reschedule it (a new due_at sends a new reminder), rename it or edit its notes. Get the id from list_tasks or an earlier result.',
    input: z.object({
      task_id: short(20),
      status: z.enum(['open', 'done', 'cancelled']).optional(),
      title: short(200).optional(),
      due_at: localTime.nullable().optional().describe('null removes the deadline'),
      notes: opt(1000),
    }),
    run: (i, ctx) => {
      const t = tasks.update(ctx.biz.id, i.task_id, { status: i.status, title: i.title, dueAt: i.due_at, notes: i.notes === undefined ? undefined : clean(i.notes) });
      if (!t) throw new ToolError(`Vazifa topilmadi: ${i.task_id}`);
      return { updated: taskView(t) };
    },
  }),

  save_lead: def({
    description: 'Save a customer or prospect the owner tells you about (name, phone and/or Telegram username). People who write to the business (bot, the owner\'s Telegram, Instagram) are saved automatically — do not add them again.',
    input: z.object({
      name: opt(80),
      phone: opt(40),
      telegram_username: opt(40).describe('Without @'),
      note: opt(500).describe('What they want, what was agreed'),
      source: opt(80).describe('Where they came from, e.g. "Instagram", "tanish orqali"'),
    }),
    run: (i, ctx) => {
      const name = clean(i.name);
      const phone = clean(i.phone);
      const username = clean(i.telegram_username)?.replace(/^@/, '') ?? null;
      if (!name && !phone && !username) throw new ToolError('Ism, telefon yoki username kerak');
      const l = leads.add(ctx.biz.id, { name, phone, username, note: clean(i.note), source: clean(i.source) ?? "qo'lda" });
      return { saved: leadView(l) };
    },
  }),

  list_leads: def({
    description: 'List customers and prospects with their ids. "channel" is where they talk to the business (bot, telegram = the owner\'s own Telegram, instagram, manual). "reachable": true means Cerebro can message them now.',
    input: z.object({
      stage: z.enum(['all', 'new', 'contacted', 'won', 'lost']).optional().describe('Default: all'),
      days: z.number().int().min(1).max(365).optional().describe('Only those added in the last N days'),
      query: z.string().trim().max(80).optional().describe('Search in name, phone, username, note'),
    }),
    run: (i, ctx) => {
      const since = i.days ? new Date(Date.now() - i.days * 86_400_000).toISOString() : undefined;
      const q = i.query?.toLowerCase();
      const list = leads.list(ctx.biz.id, (i.stage ?? 'all') as LeadStage | 'all', since)
        .filter(l => !q || [l.name, l.phone, l.username, l.note].some(v => v?.toLowerCase().includes(q)));
      return { total: list.length, leads: list.slice(0, 80).map(leadView) };
    },
  }),

  update_lead: def({
    description: 'Update a customer: stage (new → contacted → won/lost), note, phone or name.',
    input: z.object({
      lead_id: short(20),
      stage: z.enum(['new', 'contacted', 'won', 'lost']).optional(),
      note: opt(500),
      phone: opt(40),
      name: opt(80),
    }),
    run: (i, ctx) => {
      const l = leads.update(ctx.biz.id, i.lead_id, {
        stage: i.stage,
        note: i.note === undefined ? undefined : clean(i.note),
        phone: i.phone === undefined ? undefined : clean(i.phone),
        name: i.name === undefined ? undefined : clean(i.name),
      });
      if (!l) throw new ToolError(`Mijoz topilmadi: ${i.lead_id}`);
      return { updated: leadView(l) };
    },
  }),

  draft_followup: def({
    description: 'Prepare a message to one or more customers. Nothing is sent yet: the owner sees the text with a "Send" button and decides. Each customer gets it where they talk to the business (bot, the owner\'s Telegram, Instagram). Only customers with reachable: true can receive it; for the others the result lists phones so the owner can call. Instagram allows answering only within 24 hours of the customer\'s last message. Write the text exactly as the customer will read it, in the customer\'s language, polite and short.',
    input: z.object({
      lead_ids: z.array(short(20)).min(1).max(200),
      text: short(1500),
    }),
    run: (i, ctx) => {
      const ids = [...new Set(i.lead_ids)];
      const found = ids.map(id => leads.get(ctx.biz.id, id));
      const missing = ids.filter((_, k) => !found[k]);
      if (missing.length) throw new ToolError(`Mijoz topilmadi: ${missing.join(', ')}`);
      const issues = complianceErrors(ctx, [i.text]);
      if (issues.length) throw new ToolError(`Matnni qayta yozing:\n${issues.join('\n')}`);
      const list = found.filter(l => !!l);
      const o = outbound.create(ctx.biz.id, i.text, list.map(l => l.id));
      ctx.artifacts.push({ type: 'outbound', outbound: o });
      return {
        draft_id: o.id,
        status: 'waiting for the owner to press Send',
        telegram_recipients: o.reachable,
        call_instead: list.filter(l => !l.reachable).map(l => ({ name: l.name, phone: l.phone })),
      };
    },
  }),

  create_document: def({
    description: 'Write a business document and give it to the owner as a Word (.docx) file: contract, commercial offer, invoice, price list, letter, job description, plan, report, meeting notes and similar. Use Markdown: # headings, - lists, 1. lists, **bold**, tables with | cells |. Fill in everything you know from the business profile; for unknown details (customer\'s passport, exact sums the owner did not give) leave a visible blank like "________" — never invent them.',
    input: z.object({
      title: short(120),
      kind: z.enum(['contract', 'offer', 'invoice', 'price_list', 'letter', 'plan', 'report', 'other']),
      markdown: short(40_000),
    }),
    run: (i, ctx) => {
      const d = documents.create(ctx.biz.id, i.title, i.kind, i.markdown);
      ctx.artifacts.push({ type: 'document', doc: d });
      return { document_id: d.id, status: 'the .docx file is delivered to the owner with your reply' };
    },
  }),

  make_post: def({
    description: `Design a branded image post (or story) for Telegram/Instagram in the business's colors and logo, with a caption. It is a draft: the owner sees the picture with a "Publish to channel" button.
Templates and fields (write every text in the post language, plain text, no emojis):
- promo: an offer, product or service. kicker (short label, e.g. "Aksiya"), title (≤40), badge optional (≤8, e.g. "-20%", "Yangi"), lines: [main sentence ≤110, then 0–2 short benefits ≤42].
- tip: useful advice for customers. title (≤70, a headline or question), lines: exactly 3 points (≤60 each), cta optional (≤90).
- team: introduce a team member (member_id from the profile). title = the person's name, lines: [role, experience like "8 yillik tajriba" or "", a short intro ≤140].
- holiday: greeting for a holiday. title (≤50), lines: 1–2 wishes (≤70). Set solemn for remembrance days.
- list: a menu, price list or schedule, best as a story. title (≤22), lines: 2–5 rows "left|right" (left ≤26, right ≤14), cta (≤36).
- poll: a story question. title (≤70), lines: exactly 2 answer options (≤20), cta (≤50).
Use only facts from the profile or from the owner (prices, discounts, dates): never invent them.`,
    input: z.object({
      template: z.enum(['promo', 'tip', 'team', 'holiday', 'list', 'poll']),
      kind: z.enum(['post', 'story']).optional().describe('post (square, default) or story (vertical)'),
      style: z.number().int().min(0).max(2).optional().describe('0 brand-color background, 1 light, 2 gradient'),
      lang: z.enum(['uz', 'ru']).optional().describe('Post language; default is the business content language'),
      member_id: z.string().max(40).optional(),
      solemn: z.boolean().optional(),
      kicker: short(30),
      title: short(120),
      badge: z.string().trim().max(20).optional(),
      lines: z.array(z.string().trim().max(200)).max(6),
      cta: z.string().trim().max(120).optional(),
      footnote: z.string().trim().max(120).optional(),
      caption: short(1500).describe('Text under the picture: 2–5 short sentences, may end with a call to action'),
    }),
    run: (i, ctx) => {
      const biz = ctx.biz.profile;
      if (i.template === 'team') {
        const m = biz.team.find(t => t.id === i.member_id);
        if (!m) throw new ToolError(biz.team.length ? `member_id kerak: ${biz.team.map(t => `${t.id} (${t.name})`).join(', ')}` : "Profilda jamoa a'zosi yo'q — avval egasi qo'shsin");
      }
      const design: Design = {
        kicker: i.kicker, title: i.title, lines: i.lines.filter(l => l.length > 0 || i.template === 'team'),
        ...(i.badge ? { badge: i.badge } : {}), ...(i.cta ? { cta: i.cta } : {}), ...(i.footnote ? { footnote: i.footnote } : {}),
      };
      const errors = [...checkDesign(i.template, design), ...complianceErrors(ctx, [i.kicker, i.title, i.badge ?? '', ...i.lines, i.cta ?? '', i.footnote ?? '', i.caption])];
      if (errors.length) throw new ToolError(`Post yaratilmadi, tuzating:\n${errors.join('\n')}`);
      const item: ContentItem = {
        id: newId(10),
        kind: i.kind ?? (i.template === 'list' || i.template === 'poll' ? 'story' : 'post'),
        template: i.template,
        style: i.style ?? Math.floor(Math.random() * 3),
        seed: Math.floor(Math.random() * 1e9),
        ...(i.member_id ? { memberId: i.member_id } : {}),
        ...(i.solemn ? { solemn: true } : {}),
        // Post bitta tilda: ikkala kalitga ham shu matn (shablon qaysi tilni so'rasa ham bir xil)
        design: { uz: design, ru: design },
        caption: { uz: i.caption, ru: i.caption },
      };
      const p = posts.create(ctx.biz.id, item);
      ctx.artifacts.push({ type: 'post', post: p });
      return { post_id: p.id, status: 'draft — the picture is shown to the owner with a Publish button' };
    },
  }),

  recent_conversations: def({
    description: 'Customers who wrote recently (bot, the owner\'s Telegram, Instagram) with their last message and whether a reply is waiting for the owner\'s approval. Use for "who wrote today", "any unanswered messages", "what did customers ask".',
    input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    run: (i, ctx) => ({
      conversations: inbox.threads(ctx.biz.id, i.limit ?? 20).map(id => {
        const l = leads.get(ctx.biz.id, id);
        const last = inbox.last(ctx.biz.id, id);
        return l && last ? {
          lead_id: l.id, name: l.name ?? l.username, channel: l.channel, stage: l.stage,
          last: { from: last.direction === 'in' ? 'customer' : last.by, text: last.text.slice(0, 300), at: last.createdAt },
          reply_waiting_for_owner: replies.countPending(ctx.biz.id, id) > 0,
        } : null;
      }).filter(Boolean),
    }),
  }),

  read_conversation: def({
    description: 'The recent messages between the business and one customer (lead_id from list_leads or recent_conversations).',
    input: z.object({ lead_id: short(20) }),
    run: (i, ctx) => {
      const l = leads.get(ctx.biz.id, i.lead_id);
      if (!l) throw new ToolError(`Mijoz topilmadi: ${i.lead_id}`);
      return {
        customer: leadView(l),
        messages: inbox.thread(ctx.biz.id, l.id, 40).map(m => ({ from: m.direction === 'in' ? 'customer' : m.by, text: m.text, at: m.createdAt })),
      };
    },
  }),

  remember: def({
    description: 'Save a lasting fact about the business or the owner\'s preferences (e.g. "Yetkazib berish bepul 200 000 so\'mdan", "Hujjatlarda direktor: A. Karimov"). Use it when the owner says to remember something or states a stable fact worth keeping. Not for one-off tasks.',
    input: z.object({ fact: short(500) }),
    run: (i, ctx) => ({ saved: notes.add(ctx.biz.id, i.fact) }),
  }),

  forget: def({
    description: 'Delete a saved fact by its id (ids are in the notes list).',
    input: z.object({ note_id: short(20) }),
    run: (i, ctx) => {
      if (!notes.remove(ctx.biz.id, i.note_id)) throw new ToolError(`Topilmadi: ${i.note_id}`);
      return { deleted: i.note_id };
    },
  }),

  get_summary: def({
    description: 'Overview of the business right now: overdue and today\'s tasks, new customers, drafts waiting for approval, upcoming holidays. Use it for "what\'s up today", "what did I miss", a daily plan or a report.',
    input: z.object({}),
    run: (_i, ctx) => {
      const now = new Date();
      const nowStamp = stamp(now);
      const today = iso(now);
      const open = tasks.list(ctx.biz.id, 'open', 300);
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const recent = leads.list(ctx.biz.id, 'all', week);
      const all = leads.list(ctx.biz.id, 'all', undefined, 1000);
      const count = (s: LeadStage) => all.filter(l => l.stage === s).length;
      return {
        now: nowStamp,
        tasks: {
          overdue: open.filter(t => t.dueAt && t.dueAt < nowStamp).map(taskView),
          today: open.filter(t => t.dueAt && t.dueAt >= nowStamp && t.dueAt.startsWith(today)).map(taskView),
          upcoming: open.filter(t => t.dueAt && t.dueAt.slice(0, 10) > today).slice(0, 10).map(taskView),
          no_deadline: open.filter(t => !t.dueAt).length,
        },
        customers: {
          new_last_7_days: recent.length,
          latest: recent.slice(0, 10).map(leadView),
          by_stage: { new: count('new'), contacted: count('contacted'), won: count('won'), lost: count('lost') },
        },
        waiting_for_owner: {
          post_drafts: posts.list(ctx.biz.id, 50).filter(p => p.status === 'draft').length,
          followup_drafts: outbound.list(ctx.biz.id, 50).filter(o => o.status === 'draft').length,
        },
        upcoming_holidays: upcomingOccasions(now, 14, isMedical(ctx.biz.profile.industry)).map(o => ({ date: o.date, title: o.title.uz, solemn: o.solemn })),
      };
    },
  }),
};

type ToolName = keyof typeof DEFS;

const schemaOf = (s: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool.InputSchema;
};

/** Claude'ga beriladigan asboblar ro'yxati (suhbat davomida o'zgarmaydi) */
export function toolDefinitions(webSearch: boolean): Anthropic.Beta.BetaToolUnion[] {
  const custom: Anthropic.Beta.BetaToolUnion[] = (Object.entries(DEFS) as [ToolName, ToolDef<z.ZodType>][]).map(([name, d]) => ({
    name, description: d.description, input_schema: schemaOf(d.input),
  }));
  return webSearch ? [...custom, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] : custom;
}

export interface ToolOutcome { content: string; isError: boolean }

export function runTool(name: string, input: unknown, ctx: ToolCtx): ToolOutcome {
  const d = (DEFS as Record<string, ToolDef<z.ZodType>>)[name];
  if (!d) return { content: `Noma'lum asbob: ${name}`, isError: true };
  const parsed = d.input.safeParse(input);
  if (!parsed.success) {
    return { content: `Kirish noto'g'ri: ${parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, isError: true };
  }
  try {
    return { content: JSON.stringify(d.run(parsed.data, ctx)), isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { content: e.message, isError: true };
    console.error(`[asbob] ${name}:`, e);
    return { content: 'Ichki xato — egasiga qisqa ayting, qayta urinmang', isError: true };
  }
}
