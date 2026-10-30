/**
 * Marketolog asboblari: Meta AI'dan so'rash (egasining meta.ai akkaunti — metaAi.ts). Meta AI Instagram va Facebook'ni ichidan
 * ko'radi: raqobatchilar, egasining o'z akkaunti, Reels/video nimani aytadi, kontent g'oyalari.
 *
 * Savol fonda ketadi (javob daqiqalab keladi — yordamchining navbatini, jonli qo'ng'iroqni ushlab turmasin): asbob darhol «boshladim»
 * deydi, javob tayyor bo'lgach — Marketolog jurnaliga (panel → Marketolog → Hisobotlar) to'liq va egasining Telegram'iga.
 * Javob begona matn: suhbatga (Claude'ga) qaytmaydi, bilimga yozilmaydi. Ichidagi @akkauntlar egasining Instagram'i orqali
 * tekshiriladi (brauzer orqali ulangan bo'lsa), sekin va oz-ozdan — akkaunt shubha uyg'otmasin.
 */
import { z } from 'zod';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';
import { instagramUserExists } from '../inbox/instagram';
import { events } from '../orders/store';
import { ToolError, def } from '../toolkit';
import { MetaAiError, askMetaAi, assertMetaAiReady, metaAiAvailable } from './metaAi';

/** Bir javobdan tekshiriladigan akkauntlar soni */
const MAX_HANDLES = 8;
/** Bir biznesda navbatda turgan savollar (har biri daqiqalab ketadi) */
const MAX_QUEUED = 3;
/** Telegram xabariga javobning shuncha qismi (to'lig'i — panelda) */
const TELEGRAM_CHARS = 3000;

const TOPICS = { raqobatchilar: 'Raqobatchilar', akkaunt: 'Akkaunt tahlili', video: 'Video tahlili', kontent: 'Kontent', boshqa: 'Savol' } as const;
type Topic = keyof typeof TOPICS;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Javobdagi @akkauntlar (email manzillari emas), takrorsiz */
export function handlesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w.@])@([A-Za-z0-9._]{2,30})(?![\w@])/g)) {
    const u = m[1].replace(/\.+$/, '');
    if (u.length >= 2) out.add(u.toLowerCase());
    if (out.size >= MAX_HANDLES) break;
  }
  return [...out];
}

/** Akkauntlar Instagram'da bormi: odamdek oraliq bilan; birinchi noaniq javobda to'xtaydi (cheklov yoki ulanmagan) — qolgani «tekshirilmadi» */
async function checkHandles(bizId: string, list: string[]): Promise<{ username: string; exists: boolean | null }[]> {
  const out: { username: string; exists: boolean | null }[] = [];
  let stopped = false;
  for (const [i, username] of list.entries()) {
    if (i && !env.igFakeUrl) await sleep(1000 + Math.random() * 2000);
    const exists = stopped ? null : await instagramUserExists(bizId, username);
    if (exists === null) stopped = true;
    out.push({ username, exists });
  }
  return out;
}

const queued = new Map<string, number>();

async function job(biz: BusinessRow, question: string, topic: Topic): Promise<void> {
  const title = `${TOPICS[topic]}: ${question.replace(/\s+/g, ' ').slice(0, 110)}`;
  try {
    const answer = await askMetaAi(biz, question);
    const accounts = await checkHandles(biz.id, handlesIn(answer));
    const missing = accounts.filter(a => a.exists === false).map(a => `@${a.username}`);
    const unchecked = accounts.filter(a => a.exists === null).length;
    // Tekshiruv xulosasi boshida: uzun javob kesilsa ham ko'rinsin
    const real = accounts.length - missing.length - unchecked;
    const check = !accounts.length ? '' : `Akkauntlar: ${[
      real && `${real} tasi Instagram'da bor`,
      missing.length && `Instagram'da yo'q (Meta AI xato aytgan): ${missing.join(', ')}`,
      unchecked && `${unchecked} tasi tekshirilmadi (Instagram brauzer orqali ulanmagan yoki javob bermadi)`,
    ].filter(Boolean).join('; ')}.`;
    events.add(biz.id, { member: 'marketolog', orderId: null, level: missing.length ? 'warn' : 'info', title, body: check ? `${check}\n\n${answer}` : answer, cameraId: null });
    const cut = answer.length > TELEGRAM_CHARS ? `${answer.slice(0, TELEGRAM_CHARS)}…\n\n(to'liq — panel → Marketolog → Hisobotlar)` : answer;
    await notifyOwner(biz, `📣 <b>Marketolog · ${esc(title)}</b>\n<i>Meta AI javobi — xato bo'lishi mumkin</i>\n\n${esc(cut)}${check ? `\n\n${esc(check)}` : ''}`).catch(() => {});
  } catch (e) {
    const why = e instanceof MetaAiError ? e.message : 'ichki xato';
    if (!(e instanceof MetaAiError)) console.error('[marketolog]', e);
    events.add(biz.id, { member: 'marketolog', orderId: null, level: 'warn', title: `Bajarilmadi — ${title}`, body: why, cameraId: null });
    await notifyOwner(biz, `⚠️ <b>Marketolog</b>: «${esc(question.slice(0, 120))}» — bajarilmadi: ${esc(why)}`).catch(() => {});
  }
}

export const MARKETING_DEFS = {
  meta_ai: def({
    description: "Ask Meta AI through the owner's own meta.ai account (connected in panel → Marketolog → Ulash) — the Marketolog's main tool for marketing work: who the competitors are on Instagram and Facebook and what they post, a review of the business's own Instagram account, what a Reel or video says and why it works (put its link in the question), content plan, post and Reels ideas, captions, hashtags, trends in this field. Meta AI sees Instagram and Facebook from the inside, which other models cannot. Write the question fully and concretely in Russian or Uzbek with the business context: field, city, the business's Instagram username if known, what result is needed and in what form (a list, a table, a plan for 7 days). The answer takes a few minutes, so it runs in the background: the tool returns at once, and the answer goes to the owner's Telegram and to Marketolog → Hisobotlar, with the @accounts it names checked on Instagram. Tell the owner you asked and where the answer will come — do not invent the answer yourself. One complete question is better than several small ones (the account has a daily limit).",
    input: z.object({
      question: z.string().trim().min(10).max(4000).describe('The full question for Meta AI, with the business context'),
      topic: z.enum(['raqobatchilar', 'akkaunt', 'video', 'kontent', 'boshqa']).describe('What it is about — for the Marketolog journal'),
    }),
    run: (i, ctx) => {
      if (!metaAiAvailable()) throw new ToolError("Bu kompyuterda Chrome yoki Edge yo'q — Meta AI ishlamaydi");
      try {
        assertMetaAiReady(ctx.biz);
      } catch (e) {
        if (e instanceof MetaAiError) throw new ToolError(e.message);
        throw e;
      }
      const bizId = ctx.biz.id, waiting = queued.get(bizId) ?? 0;
      if (waiting >= MAX_QUEUED) throw new ToolError(`Meta AI'ga ${waiting} ta savol navbatda — javoblari kelguncha yangi savol berilmaydi`);
      queued.set(bizId, waiting + 1);
      void job(ctx.biz, i.question, i.topic).finally(() => {
        const n = (queued.get(bizId) ?? 1) - 1;
        if (n > 0) queued.set(bizId, n); else queued.delete(bizId);
      });
      return {
        started: true, queued_before: waiting,
        note: "Asked Meta AI in the background. The answer will come to the owner's Telegram and to panel → Marketolog → Hisobotlar in a few minutes.",
      };
    },
  }),
};

/** Asboblar ro'yxatiga qo'shiladimi: brauzer bor (ulanmagan bo'lsa asbob o'zi «Ulash»ga yo'naltiradi) */
export const marketingEnabled = (): boolean => metaAiAvailable();
