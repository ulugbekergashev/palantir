/**
 * Cerebro'ning "miyasi": egasining gapi → Claude → asboblar → javob.
 *
 * Suhbat biznesga bitta (Telegram ham, panel ham shu suhbatni davom ettiradi)
 * va faqat oxiriga qo'shiladi: tizim ko'rsatmasi va asboblar sessiya davomida
 * o'zgarmaydi, joriy vaqt har bir xabarning boshida beriladi. Uzoq tanaffusdan
 * keyin yoki suhbat kattalashganda yangi sessiya boshlanadi — oldingi
 * sessiyaning oxirgi gaplari yangi ko'rsatmaga qisqa qilib qo'shiladi.
 *
 * Bir biznesning xabarlari navbat bilan ishlanadi (ikkita xabar bir vaqtda
 * suhbatni buzmasin). Xato bo'lsa, suhbatga faqat to'liq qismi yoziladi.
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Artifact, ChatEntry } from '../src/types';
import { isMedical } from '../src/lib/compliance';
import { upcomingOccasions } from '../src/lib/occasions';
import { DAYS, iso, stamp, weekday } from '../src/lib/week';
import { businesses, chatLog, conversations, notes, type BusinessRow } from './db';
import { env } from './env';
import { runTool, toolDefinitions, type ToolCtx } from './tools';

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 600_000 }));

// Model rad etsa yoki band bo'lsa — so'rov server tomonda zaxira modelda bajariladi
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

const MAX_STEPS = 10;
const IDLE_MS = 6 * 3600_000;
const MAX_MESSAGES = 120;
const MAX_CHARS = 400_000;

const TOOLS = toolDefinitions(env.webSearch);
const TOOLS_KEY = createHash('sha256').update(env.aiModel).update(JSON.stringify(TOOLS)).digest('hex').slice(0, 16);

// ─── Tizim ko'rsatmasi ────────────────────────────────────────────────────────

const RULES = `You are Cerebro, a personal AI assistant for the owner of a business in Uzbekistan: a sharp, reliable chief of staff who is always on call in Telegram and in the web panel. The owner writes or sends voice messages. Voice arrives already transcribed and may contain recognition errors: infer the intended words from context (especially names and numbers) and ask only when a wrong guess would matter.

How you work
- Turn what the owner says into action with your tools: tasks and reminders, customers and follow-ups, documents, branded posts, remembering facts. When the request is clear, act first, then report in one or two sentences. Several requests in one message: do all of them.
- Ask one short clarifying question only when you cannot act sensibly without the answer.
- For questions that need current outside information (prices, exchange rates, laws, news, suppliers, competitors), use web search and name the source briefly.
- Posts and customer messages are always drafts: the owner gets a Publish or Send button. Never say something was sent or published; say it is ready for their tap.
- Times are local (Asia/Tashkent). Each owner message starts with the current date and time in brackets; resolve "ertaga", "juma kuni", "2 soatdan keyin" against it.
- Tools return ids. Keep them to yourself: the owner never needs to see an id.

Facts and honesty
- Use only facts from the business profile, the saved notes, tool results and what the owner tells you. Never invent prices, discounts, sums, dates, names, phone numbers, reviews or statistics. If something is unknown, say so, or leave a visible blank in documents.
- In advertising texts avoid unprovable superlatives ("eng yaxshi", "№1", "лучший") and absolute promises ("100%", "abadiy"). For medical businesses also never promise results or painlessness.

Replies
- Reply in the owner's language: Uzbek in Latin script (plain apostrophe in o', g') or Russian — match their message.
- Be brief: this is a phone chat. No preamble and no restating the request. Short "-" lists when listing several items, **bold** sparingly, no tables and no headings in chat.
- Warm and respectful, like a trusted colleague. Use the owner's name now and then, not in every message.`;

function profileText(b: BusinessRow): string {
  const p = b.profile;
  const lines = [
    `Name: ${p.name}`,
    p.ownerName && `Owner: ${p.ownerName}`,
    `Industry: ${p.industry || 'not set'}`,
    p.description && `About: ${p.description}`,
    p.phone && `Phone: ${p.phone}`,
    p.address && `Address: ${p.address}`,
    p.hours && `Hours: ${p.hours}`,
    p.instagram && `Instagram: ${p.instagram}`,
    p.website && `Website: ${p.website}`,
    `Post language: ${p.contentLang === 'ru' ? 'Russian' : 'Uzbek'}`,
    `Telegram channel for posts: ${b.channelTitle ?? 'not connected'}`,
    p.offerings.length ? `Products and services (price in so'm, 0 = not given):\n${p.offerings.map(o => `- ${o.name}${o.nameRu ? ` / ${o.nameRu}` : ''}: ${o.price || 0}`).join('\n')}` : 'Products and services: not listed yet',
    p.team.length ? `Team:\n${p.team.map(m => `- ${m.name} — ${m.role}${m.years ? `, ${m.years} years` : ''} (member_id: ${m.id})`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function buildSystem(b: BusinessRow): string {
  const now = new Date();
  const saved = notes.list(b.id);
  const holidays = upcomingOccasions(now, 21, isMedical(b.profile.industry));
  const recent = chatLog.recent(b.id, 10);
  const parts = [
    RULES,
    `<business_profile>\n${profileText(b)}\n</business_profile>`,
    `<saved_notes>\n${saved.length ? saved.map(n => `- [${n.id}] ${n.text}`).join('\n') : '(none yet)'}\n</saved_notes>`,
    holidays.length ? `<upcoming_holidays>\n${holidays.map(h => `- ${h.date}: ${h.title.uz}${h.solemn ? ' (remembrance day)' : ''}`).join('\n')}\n</upcoming_holidays>` : '',
    recent.length
      ? `<previous_session>\nThe last messages before this conversation started (for continuity; the tools have the current data):\n${recent.map(e => `${e.role === 'owner' ? 'Owner' : 'Cerebro'}: ${e.text.slice(0, 300)}`).join('\n')}\n</previous_session>`
      : '',
    `Session started: ${iso(now)}.`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

const nowLabel = (channel: ChatEntry['channel']) => {
  const d = new Date();
  return `[${stamp(d).replace('T', ' ')}, ${DAYS.uz[weekday(d)]} · ${channel === 'telegram' ? 'Telegram' : 'panel'}]`;
};

// ─── Navbat ───────────────────────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

// ─── Suhbat ───────────────────────────────────────────────────────────────────

export interface Reply {
  text: string;
  artifacts: Artifact[];
  entries: ChatEntry[];
}

/** Egasining yangi gapi: oxirgi xabar egasiniki bo'lsa (xatodan keyin), unga qo'shiladi */
function withOwnerText(messages: Msg[], text: string): Msg[] {
  const last = messages.at(-1);
  if (last?.role === 'user' && Array.isArray(last.content)) {
    return [...messages.slice(0, -1), { role: 'user', content: [...last.content, { type: 'text', text }] }];
  }
  return [...messages, { role: 'user', content: text }];
}

const fresh = (conv: ReturnType<typeof conversations.get>) =>
  !!conv && conv.toolsKey === TOOLS_KEY && Date.now() - Date.parse(conv.updatedAt) < IDLE_MS
  && conv.messages.length < MAX_MESSAGES && JSON.stringify(conv.messages).length < MAX_CHARS;

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('').trim();

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    if (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500) return 'AI hozir band. Bir daqiqadan keyin qayta yozing.';
    if (e.status === 401 || e.status === 403) return "AI kaliti ishlamayapti — administratorga ayting.";
  }
  if (e instanceof Anthropic.APIConnectionError) return "AI bilan aloqa yo'q. Birozdan keyin qayta yozing.";
  return "Kutilmagan xato. Qayta urinib ko'ring.";
}

/** Egasining gapiga javob. Hech qachon tashlamaydi: xato bo'lsa — tushunarli matn */
export function ask(bizId: string, channel: ChatEntry['channel'], text: string, opts: { voice?: boolean } = {}): Promise<Reply> {
  return serial(bizId, async () => {
    const biz = businesses.byId(bizId);
    if (!biz) throw new Error('Biznes topilmadi');
    // Jurnalga javob bilan birga yoziladi (yangi sessiyaning "oldingi gaplar"iga joriy gap tushmasin)
    const finish = (reply: string, artifacts: Artifact[]): Reply => ({
      text: reply,
      artifacts,
      entries: [chatLog.add(biz.id, channel, 'owner', opts.voice ? `🎙 ${text}` : text), chatLog.add(biz.id, channel, 'assistant', reply, artifacts)],
    });
    if (!env.aiEnabled) return finish("AI ulanmagan: serverda ANTHROPIC_API_KEY yo'q. Vazifa va mijozlarni panelda qo'lda qo'shish mumkin.", []);

    const userText = `${nowLabel(channel)}${opts.voice ? ' (voice message, transcribed)' : ''}\n${text}`;
    const attempt = async (restart: boolean) => {
      const prev = conversations.get(biz.id);
      const keep = !restart && fresh(prev);
      const session = keep && prev
        ? { system: prev.system, startedAt: prev.startedAt, messages: prev.messages as Msg[] }
        : { system: buildSystem(biz), startedAt: new Date().toISOString(), messages: [] as Msg[] };
      return run(biz, session, userText, keep);
    };
    try {
      const r = await attempt(false).catch(e => {
        // Eski suhbat API'ga to'g'ri kelmay qolgan bo'lsa (400) — yangi sessiya bilan bir marta qayta
        if (e instanceof RestartableError) return attempt(true);
        throw e;
      });
      return finish(r.text, r.artifacts);
    } catch (e) {
      const partial = e instanceof PartialError ? e : null;
      console.error('[ai]', partial ? partial.cause : e);
      const reason = friendlyError(partial ? partial.cause : e);
      return finish(partial?.artifacts.length ? `Ish qisman bajarildi. ${reason}` : reason, partial?.artifacts ?? []);
    }
  });
}

class RestartableError extends Error {}
class PartialError extends Error {
  constructor(readonly cause: unknown, readonly artifacts: Artifact[]) { super('partial'); }
}

async function run(biz: BusinessRow, session: { system: string; startedAt: string; messages: Msg[] }, userText: string, continuing: boolean) {
  const ctx: ToolCtx = { biz, artifacts: [] };
  const messages = withOwnerText(session.messages, userText);
  const save = (upTo: number) => conversations.save(biz.id, { system: session.system, toolsKey: TOOLS_KEY, startedAt: session.startedAt, messages: messages.slice(0, upTo) });
  /** Oxirgi to'liq holat (egasining xabari yoki asbob natijalari bilan tugaydi) */
  let safe = 0;
  let spoken = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await api().beta.messages.create({
        model: env.aiModel,
        max_tokens: 16_000,
        system: session.system,
        tools: TOOLS,
        messages,
        thinking: { type: 'adaptive', display: 'omitted' },
        output_config: { effort: 'medium' },
        ...FALLBACK,
      });
    } catch (e) {
      if (step === 0 && continuing && e instanceof Anthropic.BadRequestError) throw new RestartableError(e.message);
      if (safe) save(safe);
      throw safe ? new PartialError(e, ctx.artifacts) : e;
    }

    if (res.stop_reason === 'refusal') {
      if (safe) save(safe);
      return { text: "Bu so'rovni bajara olmayman.", artifacts: ctx.artifacts };
    }
    messages.push({ role: 'assistant', content: res.content as Block[] });
    const said = textOf(res.content);
    if (said) spoken = said;

    if (res.stop_reason === 'pause_turn') continue;

    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'tool_use' || calls.length) {
      const cut = res.stop_reason === 'max_tokens';
      const results: Block[] = calls.map(c => {
        const out = cut
          ? { content: 'Javob uzilib qoldi — qisqaroq qilib qayta chaqiring', isError: true }
          : runTool(c.name, c.input, ctx);
        return { type: 'tool_result', tool_use_id: c.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
      });
      messages.push({ role: 'user', content: results });
      safe = messages.length;
      if (step === MAX_STEPS - 1) {
        save(safe);
        return { text: `${spoken || 'Bajarildi'}\n\n(Ish ko'p qadamli chiqdi — davomini yozing, men davom ettiraman.)`, artifacts: ctx.artifacts };
      }
      continue;
    }

    save(messages.length);
    const text = said || spoken || (ctx.artifacts.length ? 'Tayyor.' : '…');
    return { text: res.stop_reason === 'max_tokens' ? `${text}…` : text, artifacts: ctx.artifacts };
  }
  // Faqat pause_turn bilan tugagan bo'lsa shu yerga keladi: to'liq qismi saqlanadi
  if (safe) save(safe);
  return { text: spoken || 'Tayyor.', artifacts: ctx.artifacts };
}

/** Yangi suhbat (egasi "/yangi" desa yoki profil o'zgarsa) */
export const resetConversation = (bizId: string) => { conversations.reset(bizId); };
