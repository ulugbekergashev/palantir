/**
 * Har yarim daqiqada: (1) vaqti kelgan vazifalar uchun eslatma yuboradi,
 * (2) ertalab (MORNING_HOUR dan keyingi 4 soat ichida) kunlik qisqa xulosa yuboradi —
 * bugungi va kechikkan vazifalar, yangi mijozlar, tasdiq kutayotganlar, yaqin bayramlar.
 * Xulosa AI'siz tuziladi: arzon, tez va har doim bir xil.
 */
import type { Task } from '../src/types';
import { isMedical } from '../src/lib/compliance';
import { upcomingOccasions } from '../src/lib/occasions';
import { dayLong, dueLabel, fromIso, iso, stamp } from '../src/lib/week';
import type { BotService } from './bot';
import { businesses, leads, outbound, posts, tasks, type BusinessRow } from './db';
import { env } from './env';
import { flushDue } from './inbox/core';
import { pollInstagram, refreshInstagramTokens } from './inbox/instagram';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ertalabki xulosa matni; aytadigan narsa bo'lmasa — null */
export function morningBrief(biz: BusinessRow, now = new Date()): string | null {
  const today = iso(now);
  const open = tasks.list(biz.id, 'open', 300);
  const overdue = open.filter(t => t.dueAt && t.dueAt < `${today}T00:00`);
  const todays = open.filter(t => t.dueAt?.startsWith(today));
  const fresh = leads.list(biz.id, 'all', new Date(now.getTime() - 86_400_000).toISOString());
  const waitingPosts = posts.list(biz.id, 50).filter(p => p.status === 'draft').length;
  const waitingMsgs = outbound.list(biz.id, 50).filter(o => o.status === 'draft').length;
  const holidays = upcomingOccasions(now, 3, isMedical(biz.profile.industry));
  if (!overdue.length && !todays.length && !fresh.length && !holidays.length) return null;

  const line = (t: Task) => `• ${esc(t.title)}${t.dueAt ? ` — <i>${dueLabel('uz', t.dueAt, now)}</i>` : ''}`;
  const out = [`☀️ <b>Xayrli tong${biz.profile.ownerName ? `, ${esc(biz.profile.ownerName)}` : ''}!</b>`];
  if (todays.length) out.push('', `<b>Bugun (${todays.length})</b>`, ...todays.slice(0, 10).map(line));
  if (overdue.length) out.push('', `<b>🔴 Kechikkan (${overdue.length})</b>`, ...overdue.slice(0, 7).map(line));
  if (fresh.length) {
    out.push('', `<b>Yangi mijozlar (${fresh.length})</b>`,
      ...fresh.slice(0, 7).map(l => `• ${esc(l.name ?? (l.username ? `@${l.username}` : "Ismi yo'q"))}${l.phone ? ` — ${esc(l.phone)}` : ''}`));
  }
  if (waitingPosts || waitingMsgs) {
    out.push('', `⏳ Tasdiq kutmoqda: ${[waitingPosts && `${waitingPosts} ta post`, waitingMsgs && `${waitingMsgs} ta xabar`].filter(Boolean).join(', ')}`);
  }
  if (holidays.length) {
    out.push('', ...holidays.map(h => `🎉 ${dayLong('uz', fromIso(h.date))} — ${esc(h.title.uz)}. Tabrik posti kerak bo'lsa, «bayram posti qil» deb yozing.`));
  }
  out.push('', 'Nima qilamiz? Yozing yoki ovozli xabar yuboring.');
  return out.join('\n');
}

/** Mijozlarga javob: vaqti kelgan "o'zi javob bersin" javoblari, Instagram tekshiruvi, token yangilash */
function startInbox(): () => void {
  let busy = false;
  let lastRefresh = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await flushDue();
      if (Date.now() - lastRefresh > 3600_000) {
        lastRefresh = Date.now();
        await refreshInstagramTokens();
      }
    } finally {
      busy = false;
    }
  };
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try { await pollInstagram(); } finally { polling = false; }
  };
  const t1 = setInterval(() => { void tick(); }, Math.min(env.tickMs, 5_000));
  const t2 = setInterval(() => { void poll(); }, env.igPollMs);
  return () => { clearInterval(t1); clearInterval(t2); };
}

export function startScheduler(bot: BotService): () => void {
  const stopInbox = startInbox();
  if (!bot.enabled) return stopInbox;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      // 1) Eslatmalar
      for (const t of tasks.due(stamp(now))) {
        const biz = businesses.byId(t.businessId);
        // Avval belgilanadi: yuborishda xato bo'lsa ham qayta-qayta urinib egasini bezovta qilmaydi
        tasks.markReminded(t.id);
        if (!biz?.ownerChatId) continue;
        await bot.remindTask(biz, t).catch(e => console.error(`[jadval] eslatma (${biz.profile.name}):`, (e as Error).message));
      }
      // 2) Ertalabki xulosa
      // Server ertalab o'chiq bo'lgan bo'lsa, kechqurun "xayrli tong" yubormaydi
      const hour = now.getHours();
      if (hour >= env.morningHour && hour < env.morningHour + 4) {
        const today = iso(now);
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || biz.briefDate === today || biz.profile.morningBrief === false) continue;
          businesses.update(biz.id, { briefDate: today });
          const text = morningBrief(biz, now);
          if (text) await bot.sendText(biz.ownerChatId, text).catch(e => console.error(`[jadval] xulosa (${biz.profile.name}):`, (e as Error).message));
        }
      }
    } catch (e) {
      console.error('[jadval]', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, env.tickMs);
  void tick();
  return () => { clearInterval(timer); stopInbox(); };
}
