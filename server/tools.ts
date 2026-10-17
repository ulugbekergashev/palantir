/**
 * Yordamchining qo'llari: Claude chaqiradigan asboblar.
 * Har bir asbob kirishini zod bilan tekshiradi (xato bo'lsa — Claude'ga sababi
 * qaytadi va u tuzatadi) va faqat shu biznesning ma'lumotiga tegadi.
 *
 * Tashqariga chiqadigan narsa (mijozlarga xabar) bu yerda faqat
 * QORALAMA bo'ladi — egasi tugmani bosgandagina yuboriladi. Bitta istisno: klinikaning
 * o'z CRM'iga qabul yozish (crm/tools.ts) — egasining aniq buyrug'i bilan darhol bajariladi.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { LeadStage, Task } from '../src/types';
import { check, isMedical } from '../src/lib/compliance';
import { upcomingOccasions } from '../src/lib/occasions';
import { iso, stamp } from '../src/lib/week';
import { MAX_OFFERINGS, mergeOfferings } from '../src/lib/prices';
import { filterOptions } from './brain/index';
import { LIMITS as BRAIN_LIMITS, PAGE_CHARS, sameQuestion } from './brain/logic';
import { facts as notes, mirrorDocument, refresh as refreshVault, vault as knowledge } from './brain/vault';
import { businesses, documents, inbox, leads, newId, outbound, replies, tasks } from './db';
import { callsEnabled } from './calls';
import { speechEnabled } from './tts';
import { tgCallEnabled } from './tgcall';
import { crmConnected } from './crm/index';
import { normPhone } from './crm/logic';
import { CRM_DEFS } from './crm/tools';
import { ToolError, assertOwnWords, def, type ToolCtx, type ToolDef } from './toolkit';

export type { ToolCtx } from './toolkit';

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:MM');
const short = (max: number) => z.string().trim().min(1).max(max);
/** Yordamchi ocha oladigan sahifalar chegarasi (egasi papkada qo'lda ko'proq ochishi mumkin) */
const MAX_PAGES = 50;
const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

const taskView = (t: Task) => ({ id: t.id, title: t.title, due_at: t.dueAt, status: t.status, notes: t.notes, ...(t.callTo ? { phone_call: true } : t.spoken ? { voice_message: true } : {}) });
const leadView = (l: ReturnType<typeof leads.list>[number]) => ({
  id: l.id, name: l.name, phone: l.phone, username: l.username, stage: l.stage, note: l.note, source: l.source,
  channel: l.channel, reachable: l.reachable, created: l.createdAt.slice(0, 10),
});

/** Reklama filtri (mijozlarga javobdagi bilan bir xil sozlama): topilsa — Claude qayta yozadi */
function complianceErrors(ctx: ToolCtx, texts: string[]): string[] {
  return check(texts.join('\n'), filterOptions(ctx.biz)).map(i => `«${i.phrase}» — ${i.why}; ${i.hint}`);
}

// ─── Asboblar ─────────────────────────────────────────────────────────────────

const DEFS = {
  create_task: def({
    description: 'Create a task or reminder for the owner. When the owner gives a time, set due_at (local time) and Cerebro sends a Telegram reminder at that moment with Done/Snooze buttons. A date without a time means 09:00. Leave due_at out for tasks with no deadline. If the owner asks to be phoned ("qo\'ng\'iroq qilib eslat", "telefon qil", "позвони"), set call: true — at due_at an AI voice agent calls the owner and says the reminder in Uzbek, and the Telegram reminder comes as well. For "call me 30 minutes before the meeting", due_at is the meeting time minus 30 minutes.',
    input: z.object({
      title: short(200).describe('What to do, short and clear, in the owner\'s language. With call: true this is what the voice agent says, so write it as a full phrase'),
      due_at: localTime.nullable().optional().describe('Local time YYYY-MM-DDTHH:MM'),
      notes: opt(1000),
      call: z.boolean().optional().describe('true only when the owner explicitly asked to be phoned for this reminder or to hear it by voice'),
      phone: short(30).optional().describe("The owner's own phone number for the call, only if the owner said it in this conversation"),
    }),
    run: (i, ctx) => {
      if (i.call && !i.due_at) throw new ToolError("Qo'ng'iroq uchun vaqt kerak — egasidan qachon qo'ng'iroq qilishni so'ra");
      let callTo: string | null = null, callNote: string | undefined;
      if (i.call && !callsEnabled() && tgCallEnabled()) {
        callNote = "At due_at Cerebro calls the owner through Telegram (an AI voice in Uzbek): it says the reminder and can mark it done or move it. The Telegram reminder comes as well. No phone number is needed.";
      } else if (i.call && !callsEnabled()) {
        callNote = speechEnabled()
          ? "Phone calls are not set up yet (no phone line). Instead, at due_at Cerebro sends the owner a spoken voice message in Uzbek in Telegram. Tell the owner exactly that — do not promise a phone call."
          : "Phone calls are not set up on this server. The reminder will come only as a Telegram message — tell the owner this plainly, do not promise a call.";
      } else if (i.call) {
        const said = i.phone ? normPhone(i.phone) : '';
        if (i.phone && !said) throw new ToolError("Telefon raqami noto'g'ri — egasidan to'liq raqamni so'ra (+998 90 123 45 67)");
        callTo = said || ctx.biz.ownerPhone;
        if (!callTo) throw new ToolError("Egasining telefon raqami hali ma'lum emas — qaysi raqamga qo'ng'iroq qilishni so'ra, keyin call: true va phone bilan qayta chaqir");
        // Egasi aytgan raqam eslab qolinadi: keyingi safar qayta so'ralmaydi
        if (said && said !== ctx.biz.ownerPhone) businesses.update(ctx.biz.id, { ownerPhone: said });
      }
      const t = tasks.create(ctx.biz.id, i.title, i.due_at ?? null, clean(i.notes), { callTo, spoken: !!i.call && (!!callTo || speechEnabled() || tgCallEnabled()) });
      ctx.artifacts.push({ type: 'task', task: t });
      return { created: taskView(t), ...(callTo ? { phone_call_to: callTo } : {}), ...(callNote ? { note: callNote } : {}) };
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
      ctx.readStrangers = true;
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
      // Nusxasi ikkinchi miya papkasiga ham tushadi (Hujjatlar/) — egasi Obsidian'da topadi
      mirrorDocument(ctx.biz.id, d);
      ctx.artifacts.push({ type: 'document', doc: d });
      return { document_id: d.id, status: 'the .docx file is delivered to the owner with your reply' };
    },
  }),

  recent_conversations: def({
    description: 'Customers who wrote recently (bot, the owner\'s Telegram, Instagram) with their last message and whether a reply is waiting for the owner\'s approval. Use for "who wrote today", "any unanswered messages", "what did customers ask".',
    input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    run: (i, ctx) => {
      ctx.readStrangers = true;
      return { conversations: inbox.threads(ctx.biz.id, i.limit ?? 20).map(id => {
        const l = leads.get(ctx.biz.id, id);
        const last = inbox.last(ctx.biz.id, id);
        return l && last ? {
          lead_id: l.id, name: l.name ?? l.username, channel: l.channel, stage: l.stage,
          last: { from: last.direction === 'in' ? 'customer' : last.by, text: last.text.slice(0, 300), at: last.createdAt },
          reply_waiting_for_owner: replies.countPending(ctx.biz.id, id) > 0,
        } : null;
      }).filter(Boolean) };
    },
  }),

  read_conversation: def({
    description: 'The recent messages between the business and one customer (lead_id from list_leads or recent_conversations).',
    input: z.object({ lead_id: short(20) }),
    run: (i, ctx) => {
      const l = leads.get(ctx.biz.id, i.lead_id);
      if (!l) throw new ToolError(`Mijoz topilmadi: ${i.lead_id}`);
      ctx.readStrangers = true;
      return {
        customer: leadView(l),
        messages: inbox.thread(ctx.biz.id, l.id, 40).map(m => ({ from: m.direction === 'in' ? 'customer' : m.by, text: m.text, at: m.createdAt })),
      };
    },
  }),

  remember: def({
    description: 'Save a lasting fact about the business or the owner\'s preferences (e.g. "Yetkazib berish bepul 200 000 so\'mdan", "Hujjatlarda direktor: A. Karimov"). Use it when the owner says to remember something or states a stable fact worth keeping. Not for one-off tasks.',
    input: z.object({ fact: short(500) }),
    run: (i, ctx) => {
      // Saqlangan fakt har bir keyingi suhbatga kiradi — begona matn (rasmdagi yozuv, mijozning xabari) shu yo'l bilan doimiy ko'rsatmaga aylanmasin
      assertOwnWords(ctx);
      return { saved: notes.add(ctx.biz.id, i.fact) };
    },
  }),

  forget: def({
    description: 'Delete a saved fact by its id (ids are in the notes list).',
    input: z.object({ note_id: short(20) }),
    run: (i, ctx) => {
      if (!notes.remove(ctx.biz.id, i.note_id)) throw new ToolError(`Topilmadi: ${i.note_id}`);
      return { deleted: i.note_id };
    },
  }),

  save_prices: def({
    description: 'Save or update prices in the business profile, many at once: when the owner dictates prices or pastes a price list. Each item is the product or service name as the owner gave it and its price in so\'m (a whole number). A name that already exists gets the new price, others are added, nothing is deleted. Only prices the owner stated — never estimate. A free service is not a price: save it with remember. Unavailable in a turn that came with a photo: show the owner the list you read from the photo and save it after they confirm in a text message.',
    input: z.object({ items: z.array(z.object({ name: short(80), price: z.number().int().min(1).max(100_000_000_000) })).min(1).max(MAX_OFFERINGS) }),
    run: (i, ctx) => {
      // Narxlar modelning tizim ko'rsatmasida turadi — begona matn shu yo'l bilan narxga aylanmasin
      assertOwnWords(ctx);
      // ctx.biz — suhbat boshidagi nusxa: profil shu orada panelda o'zgargan bo'lishi mumkin
      const fresh = businesses.byId(ctx.biz.id) ?? ctx.biz;
      const merged = mergeOfferings(fresh.profile.offerings, i.items, () => newId(8));
      businesses.update(fresh.id, { profile: { ...fresh.profile, offerings: merged.offerings } });
      refreshVault(fresh.id);
      return { added: merged.added, updated: merged.updated, total: merged.offerings.length, limit: MAX_OFFERINGS };
    },
  }),

  read_sample: def({
    description: 'Read a document sample the owner saved (ids and titles are in <document_samples>). Before create_document for a document of the same kind, read the fitting sample and follow its structure and wording, filling in the current details.',
    input: z.object({ sample_id: short(20) }),
    run: (i, ctx) => {
      const s = knowledge.get(ctx.biz.id, i.sample_id);
      if (!s || s.kind !== 'sample') throw new ToolError(`Topilmadi: ${i.sample_id}`);
      // Namuna — hujjat matni (fayldan kelgan bo'lishi mumkin): uni o'qigan navbatda bilimga yozish asboblari ishlamaydi
      ctx.readStrangers = true;
      return { title: s.question, text: s.answer };
    },
  }),

  read_page: def({
    description: 'Read one page of the second brain in full (ids and titles are in <business_pages>). Always read a page before changing it.',
    input: z.object({ page_id: short(40) }),
    run: (i, ctx) => {
      const p = knowledge.get(ctx.biz.id, i.page_id);
      // Tasdiq kutayotgan sahifa (fayldan kelgan taklif) hali bilim emas — o'qib berilmaydi
      if (!p || p.kind !== 'page' || p.status !== 'active') throw new ToolError(`Topilmadi: ${i.page_id}`);
      return { title: p.question, text: p.answer };
    },
  }),

  write_page: def({
    description: `Create a page in the second brain, or replace the text of an existing one (give page_id). For lasting knowledge that is longer than one fact: how the business works, a service in detail, staff rules, the address and hours ("Biznes haqida"). Write in the owner's language, plain Markdown, only what the owner told you or approved — customers are answered from these pages. At most ${PAGE_CHARS} characters per page: split longer material into several pages. To change a page: read_page, then send the complete new text with its page_id (a second page with the same title is refused).`,
    input: z.object({ page_id: short(40).optional(), title: short(BRAIN_LIMITS.title), text: z.string().trim().min(1).max(PAGE_CHARS) }),
    run: (i, ctx) => {
      // Sahifa mijozlarga javobda ishlatiladi — begona matn shu yo'l bilan tasdiqlangan bilimga aylanmasin
      assertOwnWords(ctx);
      const pages = knowledge.list(ctx.biz.id, 'page').filter(p => p.status === 'active');
      const old = i.page_id ? pages.find(p => p.id === i.page_id) : null;
      if (i.page_id && !old) throw new ToolError(`Topilmadi: ${i.page_id}`);
      // Bir xil nomli ikkinchi sahifa (masalan, ikkita «Biznes haqida») mijozlarga ikki xil manzil aytilishiga olib keladi
      const twin = pages.find(p => p.id !== old?.id && sameQuestion(p.question, i.title));
      if (twin) throw new ToolError(`«${twin.question}» sahifasi bor — yangisini ochmasdan o'shani o'zgartiring: page_id ${twin.id}`);
      if (!old && pages.length >= MAX_PAGES) throw new ToolError(`Sahifalar ${MAX_PAGES} tadan oshmaydi — mavjudini to'ldiring yoki keraksizini egasi papkadan o'chirsin`);
      const saved = old
        ? knowledge.update(ctx.biz.id, old.id, { question: i.title, answer: i.text })
        : knowledge.add(ctx.biz.id, { kind: 'page', question: i.title, answer: i.text, status: 'active', source: 'owner' });
      return { saved: { page_id: saved?.id, title: saved?.question } };
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
          followup_drafts: outbound.list(ctx.biz.id, 50).filter(o => o.status === 'draft').length,
        },
        upcoming_holidays: upcomingOccasions(now, 14, isMedical(ctx.biz.profile.industry)).map(o => ({ date: o.date, title: o.title.uz, solemn: o.solemn })),
      };
    },
  }),
};


const schemaOf = (s: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool.InputSchema;
};

const isCrmTool = (name: string) => Object.hasOwn(CRM_DEFS, name);

/** Claude'ga beriladigan asboblar ro'yxati (suhbat davomida o'zgarmaydi). crm — DentaCRM ulangan biznes uchun klinika asboblari bilan */
export function toolDefinitions(webSearch: boolean, crm = false): Anthropic.Beta.BetaToolUnion[] {
  const defs = Object.entries(crm ? { ...DEFS, ...CRM_DEFS } : DEFS) as [string, ToolDef<z.ZodType>][];
  const custom: Anthropic.Beta.BetaToolUnion[] = defs.map(([name, d]) => ({
    name, description: d.description, input_schema: schemaOf(d.input),
  }));
  return webSearch ? [...custom, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] : custom;
}

export interface ToolOutcome { content: string; isError: boolean }

export async function runTool(name: string, input: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  // Klinika asboblari faqat DentaCRM ulangan biznesda ishlaydi (ro'yxatda bo'lmasa ham chaqirilishi mumkin)
  if (isCrmTool(name) && !crmConnected(ctx.biz.id)) return { content: "DentaCRM ulanmagan — egasi panel → Ulanishlar'da ulashi kerak", isError: true };
  const all: Record<string, ToolDef<z.ZodType>> = { ...DEFS, ...CRM_DEFS };
  const d = Object.hasOwn(all, name) ? all[name] : undefined;
  if (!d) return { content: `Noma'lum asbob: ${name}`, isError: true };
  const parsed = d.input.safeParse(input);
  if (!parsed.success) {
    return { content: `Kirish noto'g'ri: ${parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, isError: true };
  }
  try {
    return { content: JSON.stringify(await d.run(parsed.data, ctx)), isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { content: e.message, isError: true };
    console.error(`[asbob] ${name}:`, e);
    return { content: 'Ichki xato — egasiga qisqa ayting, qayta urinmang', isError: true };
  }
}
