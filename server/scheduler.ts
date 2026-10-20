/**
 * Har yarim daqiqada: (1) vaqti kelgan vazifalar uchun eslatma yuboradi,
 * (2) ertalab (MORNING_HOUR dan keyingi 4 soat ichida) kunlik ish rejasini yuboradi (plan.ts) —
 * tasdiq kutayotganlar, mijozlarning bugungi qadamlari, vazifalar, unutilgan mijozlar, klinika, yangi mijozlar, bayramlar.
 * Reja AI'siz tuziladi: arzon, tez va har doim bir xil.
 */
import { remindRequests } from './requests/index';
import type { Task } from '../src/types';
import { isMedical } from '../src/lib/compliance';
import { upcomingOccasions } from '../src/lib/occasions';
import { dayLong, fromIso, iso, stamp } from '../src/lib/week';
import type { BotService } from './bot';
import { callState, callsEnabled, placeCall } from './calls';
import { speak, speechEnabled } from './tts';
import { businesses, leads, notices, outbound, publicLead, replies, tasks, type BusinessRow } from './db';
import { env } from './env';
import { crmBriefLines, crmConnected, crmWeekLine, recallPatients } from './crm/index';
import { industryOf } from '../src/data/industries';
import { planText, type Plan } from './plan';
import { periodRange } from './crm/report';
import { DAY_OUTCOME, askDay } from './outcome';
import { flushDue } from './inbox/core';
import { pollInstagram } from './inbox/instagram';
import { syncTasks } from './brain/mirror';
import { tgCall, tgCallEnabled } from './tgcall';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Ertalabki ish rejasi (plan.ts): vazifalar, mijozlarning keyingi qadamlari, unutilgan mijozlar, tasdiq kutayotganlar,
 * klinika — bugungi qabullar va ogohlantirishlar; dushanba — o'tgan hafta yakuni va qaytarish kerak bo'lgan bemorlar.
 * Aytadigan narsa bo'lmasa — null
 */
/**
 * Ertalabki rejani egasiga yuboradi; yordamchi bugungi va unutilgan mijozlarga xabarni fonda tayyorlaydi.
 * Qaytadi: yuborildimi (aytadigan narsa bo'lmasa — false). Telegram xatosi yuqoriga chiqadi (jadval qayta urinadi)
 */
export async function sendMorning(bot: BotService, biz: BusinessRow, now = new Date(), opts: { weekly?: boolean } = {}): Promise<boolean> {
  if (!biz.ownerChatId) return false;
  const plan = await morningPlan(biz, now, opts).catch(e => { console.error(`[jadval] reja (${biz.profile.name}):`, e); return null; });
  if (!plan) return false;
  await bot.sendText(biz.ownerChatId, plan.html, plan.buttons);
  // Fonda: jadval kutib qolmaydi, xato bo'lsa reja baribir yuborilgan
  if (plan.prep.length) void bot.prepareDay(biz, prepPrompt(plan.prep), '☀️ Bugungi xabarlarni tayyorla').catch(e => console.error(`[jadval] tayyorgarlik (${biz.profile.name}):`, (e as Error).message));
  return true;
}

/** Kechki «kun qanday o'tdi» savoli; egasining keyingi gapi kun yakuni bo'lib yordamchiga boradi. Aytadigan narsa bo'lmasa — false */
export async function sendEvening(bot: BotService, biz: BusinessRow, now = new Date()): Promise<boolean> {
  if (!biz.ownerChatId) return false;
  const check = eveningCheck(biz, now);
  if (!check) return false;
  await bot.sendText(biz.ownerChatId, check.html, [[{ text: "Bugun aytadigan narsa yo'q", data: `od|${DAY_OUTCOME}` }]]);
  askDay(biz, check.taskIds, check.leadIds);
  return true;
}

/** Ertalabki tayyorgarlik topshirig'i: faqat mijoz id'lari (ism va izohlar — begona matn — yordamchi asbob orqali o'qiydi) */
export const prepPrompt = (ids: string[]): string =>
  `Morning preparation, without asking me anything. For each customer below, look them up with list_leads (lead_id). If Palantir can message them (reachable: true), prepare one short, warm follow-up that moves things forward with draft_followup — one call per customer, written for that customer and their next step. If they are not reachable, write in one line what I should say when I phone them. Set a next step with next_at for anyone who has none, and move an overdue next step to a sensible time after today's message — do it yourself, do not ask me. Then reply with a very short list: who, and what is ready. Customers: ${ids.join(', ')}.`;

/** Kechki savol: bugungi vazifalar (bajarilgan va ochiq) va bugun qadami bo'lgan mijozlar; aytadigan narsa bo'lmasa — null */
export function eveningCheck(biz: BusinessRow, now = new Date()): { html: string; taskIds: string[]; leadIds: string[] } | null {
  const today = iso(now);
  const dayTasks = tasks.list(biz.id, 'all', 300).filter(t => t.dueAt?.startsWith(today) && t.status !== 'cancelled');
  const dayLeads = leads.active(biz.id).filter(l => l.nextAt?.startsWith(today));
  if (!dayTasks.length && !dayLeads.length) return null;
  const name = (l: { name: string | null; username: string | null; phone: string | null }) => l.name ?? (l.username ? `@${l.username}` : l.phone ?? "ismi yo'q");
  const lines = [
    ...dayTasks.slice(0, 8).map(t => `• ${t.status === 'done' ? '✅ ' : ''}${esc(t.title)}`),
    ...dayLeads.slice(0, 8).map(l => `• ${esc(name(l))} — ${esc(l.nextStep ?? "bog'lanish")}`),
  ];
  const html = [`🌙 <b>Kun qanday o'tdi${biz.profile.ownerName ? `, ${esc(biz.profile.ownerName)}` : ''}?</b>`, '', 'Bugungi ishlar:', ...lines, '',
    "Kim bilan gaplashdingiz, nima kelishildi? Yozing yoki ovozli ayting — mijozlar va vazifalarni o'zim yangilayman, ertangi qadamlarni qo'yaman."].join('\n');
  return { html, taskIds: dayTasks.map(t => t.id), leadIds: dayLeads.map(l => l.id) };
}

export async function morningPlan(biz: BusinessRow, now = new Date(), opts: { weekly?: boolean } = {}): Promise<Plan | null> {
  const today = iso(now);
  const clinic = crmConnected(biz.id);
  const profile = industryOf(biz.profile.industry, clinic);
  const monday = opts.weekly ?? now.getDay() === 1;
  // O'tgan hafta: o'tgan dushanba 00:00 dan bu dushanba 00:00 gacha (DentaCRM yakuni bilan bir xil oraliq)
  const lastWeek = periodRange('last_week', today);
  const weekFrom = new Date(`${lastWeek.from}T00:00:00`).toISOString(), weekTo = new Date(`${today}T00:00:00`).toISOString();
  const [crmLines, weekLine, recall] = await Promise.all([
    crmBriefLines(biz.id, today),
    monday ? crmWeekLine(biz.id, today) : Promise.resolve(null),
    monday && clinic ? recallPatients(biz.id, today) : Promise.resolve([]),
  ]);
  const holidays = upcomingOccasions(now, 3, isMedical(biz.profile.industry)).map(h =>
    `🎉 ${dayLong('uz', fromIso(h.date))} — ${esc(h.title.uz)}. Mijozlarga tabrik yuborish kerak bo'lsa, «bayram tabrigini tayyorla» deb yozing.`);
  return planText({
    now, ownerName: biz.profile.ownerName, profile,
    tasks: tasks.list(biz.id, 'open', 300),
    leads: leads.active(biz.id).map(publicLead),
    repliesPending: replies.pendingTotal(biz.id),
    outboundDrafts: outbound.list(biz.id, 50).filter(o => o.status === 'draft').length,
    crmLines, holidays, recall: recall.length, autoPrep: env.aiEnabled,
    week: monday ? { leadsAdded: leads.addedBetween(biz.id, weekFrom, weekTo), tasksDone: tasks.doneBetween(biz.id, weekFrom, weekTo), crmLine: weekLine } : null,
  });
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
  let running = false;
  let briefRetryAt = 0;
  // Internet yo'q paytda har tekshiruvda emas, siyrakroq uriniladi (jurnal bir xil xato bilan to'lmasin)
  let remindRetryAt = 0;
  const remindRetryMs = Math.min(60_000, env.tickMs * 2);
  const tick = async () => {
    // Bot hali ulanmagan (token ulash ustasida keyin kiritiladi) — jadval kutib turadi, token kelgach o'zi ishlay boshlaydi
    if (running || !bot.enabled) return;
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
      // 1b) So'rovlar: javobsiz qolgan «qo'ng'iroq qiling» va boshqalar — qabulxonaga eslatma
      if (Date.now() >= remindRetryAt) await remindRequests(now).catch(e => console.error("[jadval] so'rov eslatmasi:", (e as Error).message));
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
      // 3) Kechki savol: kun qanday o'tdi — egasining javobidan yordamchi mijoz va vazifalarni yangilaydi
      const eveningHour = now.getHours(), day = iso(now);
      if (env.aiEnabled && eveningHour >= env.eveningHour && eveningHour < env.eveningHour + 3) {
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || biz.eveningDate === day || biz.profile.morningBrief === false) continue;
          try {
            await sendEvening(bot, biz, now);
          } catch (e) {
            console.error(`[jadval] kechki savol (${biz.profile.name}):`, (e as Error).message);
            if (transient(e)) break;
          }
          businesses.update(biz.id, { eveningDate: day });
        }
      }
      // 2) Ertalabki xulosa
      // Server ertalab o'chiq bo'lgan bo'lsa, kechqurun "xayrli tong" yubormaydi
      const hour = now.getHours();
      if (hour >= env.morningHour && hour < env.morningHour + 4 && Date.now() >= briefRetryAt) {
        const today = iso(now);
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || biz.briefDate === today || biz.profile.morningBrief === false) continue;
          try {
            if (await sendMorning(bot, biz, now)) businesses.update(biz.id, { briefSentDate: today });
          } catch (e) {
            console.error(`[jadval] xulosa (${biz.profile.name}):`, (e as Error).message);
            // Internet yo'q — «yuborildi» deb belgilanmaydi: besh daqiqadan keyin yana uriniladi (ertalabki oraliq ichida)
            if (transient(e)) { briefRetryAt = Date.now() + BRIEF_RETRY_MS; break; }
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
