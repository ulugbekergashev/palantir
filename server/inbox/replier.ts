/**
 * Mijozga javob: bitta Claude chaqiruvi, javob qat'iy JSON.
 *   reply     — faktlardan to'liq javob berib bo'ladi (salom, narx, manzil, ish vaqti…)
 *   ask_owner — egasining qarori kerak (narx yo'q, chegirma, buyurtma, shikoyat): javob loyihasi + egasiga izoh
 *   ignore    — javob shart emas ("ok", spam, biznesga aloqasiz shaxsiy gap)
 * Yordamchining egasi bilan suhbatidan alohida: bu yerda Cerebro biznes nomidan mijoz bilan gaplashadi.
 */
import type { InboxMessage, LeadChannel } from '../../src/types';
import { DAYS, stamp, weekday } from '../../src/lib/week';
import { FALLBACK, claude, profileText } from '../claude';
import { notes, type BusinessRow, type LeadRow } from '../db';
import { env } from '../env';

export interface Decision {
  action: 'reply' | 'ask_owner' | 'ignore';
  reply: string;
  noteForOwner: string;
  leadNote: string;
  customerName: string;
  customerPhone: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['reply', 'ask_owner', 'ignore'] },
    reply: { type: 'string' },
    note_for_owner: { type: 'string' },
    lead_note: { type: 'string' },
    customer_name: { type: 'string' },
    customer_phone: { type: 'string' },
  },
  required: ['action', 'reply', 'note_for_owner', 'lead_note', 'customer_name', 'customer_phone'],
  additionalProperties: false,
};

export const REPLIER_SYSTEM = `You answer customer messages on behalf of a business in Uzbekistan, as one of its staff ("biz" / "мы"). You get the business profile, the facts the owner saved, and the recent conversation with one customer. Decide what to do with the customer's latest message(s) and return JSON.

action
- "reply": you can answer completely and correctly from the given facts (greeting, prices and products listed in the profile, hours, address, delivery terms from the saved facts), or the message only needs a short polite answer.
- "ask_owner": the answer needs information or a decision you do not have: a price that is not listed, stock or availability, a custom order, a discount, booking or order confirmation, a complaint, anything about money or commitments. Still write a short helpful draft in "reply" that the owner can send as is (for example a clarifying question, or that you will check and answer soon), and explain in "note_for_owner" in one Uzbek sentence what the owner needs to decide.
- "ignore": no answer is needed: the conversation is finished (the customer only said "ok", "rahmat", a sticker, after we already answered), spam, or a clearly personal message that is not about the business.

Rules
- Never invent prices, discounts, stock, delivery times, promises or any fact that is not given. If unsure, use "ask_owner".
- Write like a polite, friendly employee: 1–3 short sentences, plain text, no markdown, at most one emoji. Address the customer with "siz" / "вы".
- Answer in the customer's language and script (Uzbek Latin, Uzbek Cyrillic or Russian).
- Do not claim to be a person. Only if the customer asks whether they are talking to a bot or a human, say honestly that you are the business's AI assistant and that the owner also sees the conversation.
- "customer_name" and "customer_phone": fill only if the customer stated them in the conversation, else "".
- "lead_note": a short Uzbek summary (max 100 characters) of what the customer wants, for the customer list; "" if nothing new.
- "note_for_owner": "" unless action is "ask_owner".`;

const CHANNEL_NAME: Record<LeadChannel, string> = { bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: 'Telegram' };

function transcript(thread: InboxMessage[]): string {
  return thread.map(m => {
    const who = m.direction === 'in' ? 'Customer' : m.by === 'owner' ? 'Business (owner)' : 'Business (assistant)';
    return `[${stamp(new Date(m.createdAt)).replace('T', ' ').slice(5)}] ${who}: ${m.text}`;
  }).join('\n');
}

export async function decide(biz: BusinessRow, lead: LeadRow, thread: InboxMessage[]): Promise<Decision> {
  const now = new Date();
  const saved = notes.list(biz.id);
  const who = [lead.name, lead.username && `@${lead.username}`, lead.phone].filter(Boolean).join(', ') || 'unknown';
  const user = [
    `<business_profile>\n${profileText(biz)}\n</business_profile>`,
    `<saved_facts>\n${saved.length ? saved.map(n => `- ${n.text}`).join('\n') : '(none)'}\n</saved_facts>`,
    `Now: ${stamp(now).replace('T', ' ')} (${DAYS.uz[weekday(now)]}). Channel: ${CHANNEL_NAME[lead.channel]}. Customer: ${who}.`,
    `<conversation>\n${transcript(thread)}\n</conversation>`,
    "Decide how to answer the customer's latest message(s).",
  ].join('\n\n');

  const res = await claude().beta.messages.create({
    model: env.aiModel,
    max_tokens: 2000,
    system: REPLIER_SYSTEM,
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'adaptive', display: 'omitted' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    ...FALLBACK,
  });
  if (res.stop_reason === 'refusal') {
    return { action: 'ask_owner', reply: '', noteForOwner: "Cerebro bu xabarga javob yozmadi — o'zingiz javob bering", leadNote: '', customerName: '', customerPhone: '' };
  }
  const text = res.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map(b => b.text).join('');
  const j = JSON.parse(text) as Record<string, string>;
  const action = (['reply', 'ask_owner', 'ignore'] as const).find(a => a === j.action) ?? 'ask_owner';
  return {
    action,
    reply: String(j.reply ?? '').trim(),
    noteForOwner: String(j.note_for_owner ?? '').trim(),
    leadNote: String(j.lead_note ?? '').trim().slice(0, 200),
    customerName: String(j.customer_name ?? '').trim().slice(0, 80),
    customerPhone: String(j.customer_phone ?? '').trim().slice(0, 40),
  };
}
