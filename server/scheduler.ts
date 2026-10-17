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
import { callState, callsEnabled, placeCall } from './calls';
import { speak, speechEnabled } from './tts';
import { businesses, leads, notices, outbound, tasks, type BusinessRow } from './db';
import { env } from './env';
import { crmBriefLines } from './crm/index';
import { flushDue } from './inbox/core';
import { pollInstagram } from './inbox/instagram';
import { syncTasks } from './brain/mirror';
import { tgCall, tgCallEnabled } from './tgcall';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ertalabki xulosa matni; aytadigan narsa bo'lmasa — null. extra — tayyor qatorlar (klinika: bugungi qabullar) */
export function morningBrief(biz: BusinessRow, now = new Date(), extra: string[] = []): string | null {
  const today = iso(now);
  const open = tasks.list(biz.id, 'open', 300);
  const overdue = open.filter(t => t.dueAt && t.dueAt < `${today}T00:00`);
  const todays = open.filter(t => t.dueAt?.startsWith(today));
  const fresh = leads.list(biz.id, 'all', new Date(now.getTime() - 86_400_000).toISOString());
  const waitingMsgs = outbound.list(biz.id, 50).filter(o => o.status === 'draft').length;
  const holidays = upcomingOccasions(now, 3, isMedical(biz.profile.industry));
  if (!overdue.length && !todays.length && !fresh.length && !holidays.length && !extra.length) return null;

  const line = (t: Task) => `• ${esc(t.title)}${t.dueAt ? ` — <i>${dueLabel('uz', t.dueAt, now)}</i>` : ''}`;
  const out = [`☀️ <b>Xayrli tong${biz.profile.ownerName ? `, ${esc(biz.profile.ownerName)}` : ''}!</b>`];
  if (extra.length) out.push('', ...extra);
  if (todays.length) out.push('', `<b>Bugun (${todays.length})</b>`, ...todays.slice(0, 10).map(line));
  if (overdue.length) out.push('', `<b>🔴 Kechikkan (${overdue.length})</b>`, ...overdue.slice(0, 7).map(line));
  if (fresh.length) {
    out.push('', `<b>Yangi mijozlar (${fresh.length})</b>`,
      ...fresh.slice(0, 7).map(l => `• ${esc(l.name ?? (l.username ? `@${l.username}` : "Ismi yo'q"))}${l.phone ? ` — ${esc(l.phone)}` : ''}`));
  }
  if (waitingMsgs) out.push('', `⏳ Tasdiq kutmoqda: mijozlarga ${waitingMsgs} ta xabar`);
  if (holidays.length) {
    out.push('', ...holidays.map(h => `🎉 ${dayLong('uz', fromIso(h.date))} — ${esc(h.title.uz)}. Mijozlarga tabrik yuborish kerak bo'lsa, «bayram tabrigini tayyorla» deb yozing.`));
  }
  out.push('', 'Nima qilamiz? Yozing yoki ovozli xabar yuboring.');
  return out.join('\n');
}

/** Mijozlarga javob: vaqti kelgan "o'zi javob bersin" javoblari va Instagram tekshiruvi */
function startInbox(): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    // Xato keyingi tekshiruvni to'xtatmaydi: navbatdagi javoblar birozdan keyin yana ko'riladi
    try { await flushDue(); } catch (e) { console.error('[mijozlar] navbat:', (e as Error).message); } finally { busy = false; }
  };
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try { await pollInstagram(); } catch (e) { console.error('[instagram]', (e as Error).message); } finally { polling = false; }
  };
  const t1 = setInterval(() => { void tick(); }, Math.min(env.tickMs, 5_000));
  // Har bir akkaunt o'z vaqtida (tasodifiy oraliq bilan) tekshiriladi — bu faqat navbatni ko'radi
  const t2 = setInterval(() => { void poll(); }, Math.min(env.igPollMs, 5_000));
  return () => { clearInterval(t1); clearInterval(t2); };
}

/**
 * Keyinroq qayta urinsa o'tadigan xato: tarmoq (internet uzilgan, javob kelmadi) yoki Telegram vaqtincha band (429, 5xx).
 * Qolgan hammasi (Telegram rad etdi, xabar matnini tuzishdagi xato) — doimiy: qayta urinish navbatni abadiy to'sib qo'yardi
 */
const transient = (e: unknown): boolean => {
  const err = e as { response?: { error_code?: number }; name?: string; code?: unknown };
  const status = err.response?.error_code;
  if (status !== undefined) return status === 429 || status >= 500;
  return err.name === 'FetchError' || err.name === 'AbortError' || err.name === 'TimeoutError' || (typeof err.code === 'string' && /^E[A-Z_]+$/.test(err.code));
};
/** Xulosa yuborilmasa (internet yo'q) qayta urinish oralig'i: har tekshiruvda CRM'ni bezovta qilmaslik uchun */
const BRIEF_RETRY_MS = 5 * 60_000;
/** Egasi botga ulanmagan bo'lsa navbatdagi xabar shuncha saqlanadi */
const NOTICE_KEEP_MS = 7 * 86_400_000;

/** Qo'ng'iroqqa berilgan eslatmalar (shu ishga tushish davomida): Telegram uzilib qayta urinilganda qo'ng'iroq takrorlanmasin */
const called = new Set<string>();

/**
 * Eslatma vaqti keldi va egasi qo'ng'iroq so'ragan: SpeechLab agenti telefon qiladi. Natija bir necha daqiqadan keyin tekshiriladi —
 * ko'tarmagan yoki qo'ng'iroq bo'lmagan bo'lsa, Telegram'da aytiladi (eslatma u yerda baribir bor)
 */
/** Telegram'ga o'zbekcha ovozli eslatma (telefon liniyasi yo'q yoki qo'ng'iroq bo'lmagan payt) */
function voiceMessage(bot: BotService, biz: BusinessRow, t: Task): Promise<void> {
  if (!t.spoken || !speechEnabled() || !biz.ownerChatId) return Promise.resolve();
  const chat = biz.ownerChatId, name = biz.profile.ownerName;
  return speak(`${name ? `${name}, ` : ''}eslatma: ${t.title}`)
    .then(audio => bot.sendVoice(chat, audio, `🔊 <b>${esc(t.title)}</b>`))
    .catch(e => console.error('[ovozli eslatma]', (e as Error).message));
}

function phoneReminder(bot: BotService, biz: BusinessRow, t: Task): void {
  const key = `${t.id}|${t.dueAt}`;
  if (called.has(key)) return;
  // Telefon liniyasisiz: Telegram orqali AI qo'ng'iroq qiladi (eslatadi, «bajarildi»/«sur» desa — bajaradi)
  if (tgCallEnabled() && (t.spoken || t.callTo) && biz.ownerChatId) {
    called.add(key);
    const chat = biz.ownerChatId;
    void tgCall(biz.id, chat, t.id).then(async result => {
      if (result === 'answered') return;
      const why = result === 'missed' ? "📞 Qo'ng'iroqni ko'tarmadingiz" : "📞 Qo'ng'iroq qilib bo'lmadi";
      await bot.sendText(chat, `${why} — eslatma: <b>${esc(t.title)}</b>`).catch(e => console.error("[qo'ng'iroq] xabar:", (e as Error).message));
      await voiceMessage(bot, biz, t);
    });
    return;
  }
  // Telefon liniyasi yo'q (yoki raqam yo'q): o'rniga Telegram'ga o'zbekcha ovozli xabar
  if (!t.callTo || !callsEnabled()) {
    if (!t.spoken) return;
    called.add(key);
    void voiceMessage(bot, biz, t);
    return;
  }
  called.add(key);
  const tell = (text: string) => (biz.ownerChatId ? bot.sendText(biz.ownerChatId, text).catch(e => console.error('[qo\'ng\'iroq] xabar:', (e as Error).message)) : Promise.resolve());
  void (async () => {
    let id: number;
    try {
      id = (await placeCall({
        to: t.callTo!, name: biz.profile.ownerName || biz.profile.name,
        vars: { eslatma: t.title, vaqt: (t.dueAt ?? '').slice(11, 16) },
        externalId: `cerebro-${t.id}-${(t.dueAt ?? '').replace(/\D/g, '')}`,
      })).id;
    } catch (e) {
      console.error('[qo\'ng\'iroq]', (e as Error).message);
      await tell(`📞 Qo'ng'iroq qilib bo'lmadi: ${esc((e as Error).message)}. Eslatma shu yerda: <b>${esc(t.title)}</b>`);
      // Qo'ng'iroq bo'lmadi — eslatma baribir ovoz bilan eshitilsin
      await voiceMessage(bot, biz, t);
      return;
    }
    // Ikki marta tekshiriladi: terish va gaplashish bir necha daqiqa davom etishi mumkin
    for (const wait of [env.callCheckMs, env.callCheckMs]) {
      await new Promise(r => setTimeout(r, wait));
      const s = await callState(id).catch(() => null);
      if (!s?.finished) continue;
      if (s.status === 'no_answer' || s.status === 'failed') {
        await tell(`📞 Qo'ng'iroqni ko'tarmadingiz — eslatma: <b>${esc(t.title)}</b>`);
        await voiceMessage(bot, biz, t);
      }
      return;
    }
  })();
}

export function startScheduler(bot: BotService): () => void {
  const stopInbox = startInbox();
  if (!bot.enabled) return stopInbox;
  let running = false;
  let briefRetryAt = 0;
  // Internet yo'q paytda har tekshiruvda emas, siyrakroq uriniladi (jurnal bir xil xato bilan to'lmasin)
  let remindRetryAt = 0;
  const remindRetryMs = Math.min(60_000, env.tickMs * 2);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      // 0) Obsidian'dagi Vazifalar.md: egasi belgilagan, surgan yoki qo'shgani — eslatmalardan oldin bazaga
      for (const b of businesses.all()) if (b.active) syncTasks(b.id);
      // 1) Eslatmalar
      for (const t of Date.now() >= remindRetryAt ? tasks.due(stamp(now)) : []) {
        const biz = businesses.byId(t.businessId);
        // Qo'ng'iroq Telegram'ga bog'liq emas: internet bor-yo'qligidan qat'i nazar o'z vaqtida
        if (biz) phoneReminder(bot, biz, t);
        if (biz?.ownerChatId) {
          try {
            await bot.remindTask(biz, t);
          } catch (e) {
            console.error(`[jadval] eslatma (${biz.profile.name}):`, (e as Error).message);
            // Internet yo'q — belgilanmaydi, keyingi tekshiruvda yana uriniladi (eslatma yo'qolmasin); qolganlari ham hozir o'tmaydi.
            // Telegram rad etgan bo'lsa (egasi botni to'xtatgan) — belgilanadi: qayta-qayta urinish foydasiz
            if (transient(e)) { remindRetryAt = Date.now() + remindRetryMs; break; }
          }
        }
        tasks.markReminded(t.id);
      }
      // 1a) Egasiga navbatdagi xabarlar (to'xtab qolgan yozuvlar, yetkazilmagan mijoz xabarlari)
      for (const n of Date.now() >= remindRetryAt ? notices.list() : []) {
        const chat = businesses.byId(n.businessId)?.ownerChatId;
        if (chat) {
          try {
            await bot.sendText(chat, n.html);
          } catch (e) {
            console.error('[jadval] navbatdagi xabar:', (e as Error).message);
            if (transient(e)) { remindRetryAt = Date.now() + remindRetryMs; break; }
          }
        } else if (Date.now() - Date.parse(n.createdAt) < NOTICE_KEEP_MS) {
          // Egasi hali botga ulanmagan: bir necha kun kutiladi
          continue;
        }
        notices.remove(n.id);
      }
      // 2) Ertalabki xulosa
      // Server ertalab o'chiq bo'lgan bo'lsa, kechqurun "xayrli tong" yubormaydi
      const hour = now.getHours();
      if (hour >= env.morningHour && hour < env.morningHour + 4 && Date.now() >= briefRetryAt) {
        const today = iso(now);
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || biz.briefDate === today || biz.profile.morningBrief === false) continue;
          const text = morningBrief(biz, now, await crmBriefLines(biz.id, today));
          if (text) {
            try {
              await bot.sendText(biz.ownerChatId, text);
            } catch (e) {
              console.error(`[jadval] xulosa (${biz.profile.name}):`, (e as Error).message);
              // Internet yo'q — «yuborildi» deb belgilanmaydi: besh daqiqadan keyin yana uriniladi (ertalabki oraliq ichida)
              if (transient(e)) { briefRetryAt = Date.now() + BRIEF_RETRY_MS; break; }
            }
          }
          businesses.update(biz.id, { briefDate: today });
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
