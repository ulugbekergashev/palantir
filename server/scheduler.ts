/**
 * Har yarim daqiqada: (1) vaqti kelgan vazifalar uchun eslatma yuboradi,
 * (2) ertalab (MORNING_HOUR dan keyingi 4 soat ichida) kunlik ish rejasini yuboradi (plan.ts) —
 * tasdiq kutayotganlar, mijozlarning bugungi qadamlari, vazifalar, unutilgan mijozlar, klinika, yangi mijozlar, bayramlar.
 * Reja AI'siz tuziladi: arzon, tez va har doim bir xil.
 */
import { remindRequests } from './requests/index';
import type { Task } from '../src/types';
import { upcomingOccasions } from '../src/lib/occasions';
import { addDays, dayLong, fromIso, iso, stamp } from '../src/lib/week';
import type { BotService } from './bot';
import { callState, callsEnabled, placeCall } from './calls';
import { speak, speechEnabled } from './tts';
import { businesses, leads, outbound, publicLead, replies, tasks, type BusinessRow } from './db';
import { notices, settings } from './serviceStore';
import { licenseStatus } from './license';
import { accessBlocked, accessNotice, accessView } from './hubAccess';
import { env } from './env';
import { crmBriefLines, crmConnected, crmWeekLine, recallPatients } from './crm/index';
import { industryOf, isClinic } from '../src/data/industries';
import { planText, type Plan, joinMorning, weeklyDue } from './plan';
import { periodRange } from './crm/report';
import { DAY_OUTCOME, askDay } from './outcome';
import { flushDue } from './inbox/core';
import { eveningCheck, eveningTick } from './evening';
import { workTick } from './inbox/workChats';
import { pollInstagram } from './inbox/instagram';
import { syncTasks } from './brain/mirror';
import { tgCall, tgCallEnabled } from './tgcall';
import { ContentError, factoryDue, runFactory } from './content/factory';
import { watchAll as watchAds } from './ads/campaigns';
import { publishDue as publishSmm } from './smm/publish';
import { directorReport } from './director/telegram';
import { weeklyDemand } from './director/team';
import { analystMorning } from './analyst/weekly';
import { extrasPaused, extrasPausedUntil, laneOpen, withLane } from './subscription/pressure';
import { MAX_ATTEMPTS, deferred } from './subscription/deferred';
import { ask } from './agent';
import { runTool } from './tools';
import type { Artifact } from '../src/types';
import { crewHas, crewWorks } from '../src/lib/crew';
import { crewFromData } from './crew';
import { measure, measureDue } from './marketing/results';
import { giveUpSilent, syncVisits } from './stages';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Reklama sarfi va limitlar tekshiruvi oralig'i */
const ADS_WATCH_MS = 10 * 60_000;
/** DentaCRM'dan qabulga kelgan bemorlar shu oraliqda tekshiriladi (stages.ts: syncVisits) */
const VISITS_EVERY_MS = 30 * 60_000;
const visitsCheckedAt = new Map<string, number>();
/** Limit bosimi haqida egasiga aytilgan oyna (B5) — bir oynada bir marta */
let pressureTold: number | null = null;
let deferredBusy = false;

/**
 * Limit tufayli keyinga qolgan ishlar (subscription/deferred.ts): vaqti kelgan va navbati ochiq bo'lganlari birin-ketin bajariladi.
 * Egasining gapi — yordamchiga qayta; asbob ishi — o'sha asbob modelsiz (bilim va CRM'ga yozmaydigan rejimda: kirish begona matn
 * bo'lishi mumkin). Yana limitga tushsa — navbatda qoladi va egasiga yangi xabar ketmaydi; MAX_ATTEMPTS dan keyin — «bajarib bo'lmadi».
 * Natija — Telegram'ga (egasi ulangan bo'lsa; panel suhbatida ham jurnalda ko'rinadi). Qaytadi: nechta ish tugadi
 */
export async function runDeferred(bot: BotService, now = Date.now()): Promise<number> {
  let finished = 0;
  for (const d of deferred.due(now)) {
    if (!laneOpen(d.lane, now)) continue;
    const biz = businesses.byId(d.businessId);
    if (!biz?.active) continue;
    if (d.attempts >= MAX_ATTEMPTS) {
      deferred.done(d.id);
      await tellOwner(bot, biz, `⏰ **Kechiktirilgan ish bajarilmadi:** ${d.display.slice(0, 300)} — Claude limiti bir necha marta yana tugadi. Iltimos, keyinroq o'zingiz qayta so'rang.`, []);
      continue;
    }
    if (!deferred.claim(d.id, now)) continue;
    let text: string, artifacts: Artifact[] = [];
    try {
      if (d.tool) {
        const ctx = { biz, artifacts: [] as Artifact[], fromPhoto: true };
        const out = await withLane(d.lane, () => runTool(d.tool!, JSON.parse(d.input ?? '{}'), ctx));
        // Ruxsatlar jadvalida «So'rasin» (navbatda turganida egasi o'zgartirgan): bajarilmadi — tasdiq so'rovi alohida xabar bo'lib ketdi
        text = out.isError ? `bajarilmadi — ${out.content}` : out.content.includes('waiting_for_owner') ? "bajarishdan oldin ruxsatingiz so'raldi (Ruxsatlar jadvali)." : 'tayyor.';
        artifacts = ctx.artifacts;
      } else {
        const reply = await ask(biz.id, d.channel, d.text, { display: d.display });
        text = reply.text;
        artifacts = reply.artifacts;
      }
    } catch (e) {
      console.error('[obuna] kechiktirilgan ish:', (e as Error).message);
      text = "bajarilmadi — ichki xato. Iltimos, qayta so'rang.";
    }
    // Yana limitga tushib, navbatga qaytgan (add() olinganlikni bekor qiladi) — egasiga hozir hech narsa yuborilmaydi
    const back = deferred.byText(biz.id, d.text);
    if (back && !back.claimed) continue;
    deferred.done(d.id);
    finished++;
    await tellOwner(bot, biz, `⏰ **Limit tufayli kechiktirilgan ish:** ${d.display.slice(0, 300)}\n\n${text}`, artifacts);
  }
  return finished;
}

/** Egasiga Telegram'da (ulangan bo'lsa). deliverReply matnni o'zi Telegram HTML'iga aylantiradi (tgHtml) — bu yerda oddiy matn */
async function tellOwner(bot: BotService, biz: BusinessRow, text: string, artifacts: Artifact[]): Promise<void> {
  if (!bot.enabled || !biz.ownerChatId) return;
  await bot.deliverReply(biz, text, artifacts).catch(e => console.error('[obuna] kechiktirilgan ish Telegram:', (e as Error).message));
}

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

/**
 * Ertalabki BITTA xabar: Yordamchining kun rejasi va Direktorning hisoboti (raqamlar, muammo, takliflar — tugmalari bilan).
 * Direktor tahlili (AI) avval tugaydi, keyin xabar ketadi; Direktor yiqilsa yoki aytadigan narsasi bo'lmasa — reja o'zi.
 * Juda uzun bo'lsa — ikki xabar. Qaytadi: biror narsa yuborildimi
 */
export async function morningMessage(bot: BotService, biz: BusinessRow, now = new Date()): Promise<boolean> {
  if (!biz.ownerChatId) return false;
  const plan = await morningPlan(biz, now).catch(e => { console.error(`[jadval] reja (${biz.profile.name}):`, e); return null; });
  // Tahlilchining o'z ishi (B4): haftasiga bir marta — talab tahlili (AI; limitga yaqin bo'lsa o'tkaziladi) va «qaysi kanal va xizmat
  // pul keltirdi» (kodda). Direktordan OLDIN: u shu xulosani o'qiydi
  if (!extrasPaused()) await withLane('background', () => weeklyDemand(biz, now)).catch(e => console.error(`[tahlilchi] haftalik talab (${biz.profile.name}):`, (e as Error).message));
  const analyst = await analystMorning(biz, now).catch(e => { console.error(`[tahlilchi] haftalik hisobot (${biz.profile.name}):`, (e as Error).message); return null; });
  // Obuna limitiga yaqin — Direktor tahlili (AI) o'tkazib yuboriladi: bemorlarga javob uchun joy qoladi (B5, «bemorlar birinchi»)
  const dir = extrasPaused() ? null : await withLane('background', () => directorReport(biz, now)).catch(e => { console.error(`[direktor] (${biz.profile.name}):`, (e as Error).message); return null; });
  const messages = joinMorning(plan, dir, analyst ? { html: analyst, buttons: [] } : null);
  if (!messages.length) return false;
  for (const m of messages) await bot.sendText(biz.ownerChatId, m.html, m.buttons);
  if (plan?.prep.length) void bot.prepareDay(biz, prepPrompt(plan.prep), '☀️ Bugungi xabarlarni tayyorla').catch(e => console.error(`[jadval] tayyorgarlik (${biz.profile.name}):`, (e as Error).message));
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

export async function morningPlan(biz: BusinessRow, now = new Date(), opts: { weekly?: boolean } = {}): Promise<Plan | null> {
  const today = iso(now);
  const clinic = crmConnected(biz.id);
  const profile = industryOf(biz.profile.industry, clinic);
  // Javobsiz mijozlar rejadan oldin «Yo'qotildi»ga: ularga har kuni qayta xabar tayyorlanmasin (G3)
  const gaveUp = giveUpSilent(biz, now, profile.followDays).length;
  // O'tgan hafta: o'tgan dushanba 00:00 dan bu dushanba 00:00 gacha (DentaCRM yakuni bilan bir xil oraliq)
  const lastWeek = periodRange('last_week', today);
  const thisMonday = iso(addDays(fromIso(lastWeek.to), 1));
  // Haftalik yakun — shu haftaning BIRINCHI yuborilgan rejasida: dushanba ertalab kompyuter o'chiq bo'lsa, seshanba (yoki
  // keyingi yoqilgan kun) keladi — yo'qolmaydi (G10). Avval faqat dushanba 08–12 da edi
  const monday = opts.weekly ?? weeklyDue(biz.briefSentDate, thisMonday);
  const weekFrom = new Date(`${lastWeek.from}T00:00:00`).toISOString(), weekTo = new Date(`${thisMonday}T00:00:00`).toISOString();
  const [crmLines, weekLine, recall] = await Promise.all([
    crmBriefLines(biz.id, today),
    monday ? crmWeekLine(biz.id, today) : Promise.resolve(null),
    monday && clinic ? recallPatients(biz.id, today) : Promise.resolve([]),
  ]);
  const holidays = upcomingOccasions(now, 3, isClinic(biz.profile.industry)).map(h =>
    `🎉 ${dayLong('uz', fromIso(h.date))} — ${esc(h.title.uz)}. Mijozlarga tabrik yuborish kerak bo'lsa, «bayram tabrigini tayyorla» deb yozing.`);
  return planText({
    now, ownerName: biz.profile.ownerName, profile,
    tasks: tasks.list(biz.id, 'open', 300),
    leads: leads.active(biz.id).map(publicLead),
    repliesPending: replies.pendingTotal(biz.id),
    outboundDrafts: outbound.list(biz.id, 50).filter(o => o.status === 'draft').length,
    // Mijozga yozish — Qabulxonaning ishi (bazada mijozlar bor bo'lsa — u jamoaga o'zi qo'shiladi: crewFromData)
    crmLines, holidays, recall: recall.length, autoPrep: env.aiEnabled, writer: crewHas(crewFromData(biz), 'qabulxona'), gaveUp,
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
/** Egasi Telegram'ni ulamagan paytda vaqti kelgan eslatma shuncha kutadi (ulangach keladi); eskisi — o'tkaziladi */
const LINK_WAIT_MS = 24 * 3_600_000;

/** Qo'ng'iroqqa berilgan eslatmalar (shu ishga tushish davomida): Telegram uzilib qayta urinilganda qo'ng'iroq takrorlanmasin */
const called = new Set<string>();

/**
 * Eslatma vaqti keldi va egasi qo'ng'iroq so'ragan: SpeechLab agenti telefon qiladi. Natija bir necha daqiqadan keyin tekshiriladi —
 * ko'tarmagan yoki qo'ng'iroq bo'lmagan bo'lsa, Telegram'da aytiladi (eslatma u yerda baribir bor)
 */
/**
 * Telegram'ga o'zbekcha ovozli eslatma (telefon liniyasi yo'q yoki qo'ng'iroq bo'lmagan payt). why — qo'ng'iroq bo'lmadi: sababi shu
 * xabarning izohida (B8: avval alohida matn + ovoz edi). Ovoz bo'lmasa (TTS yo'q yoki xato) — sabab matn bo'lib boradi
 */
async function voiceMessage(bot: BotService, biz: BusinessRow, t: Task, why?: string): Promise<void> {
  if (!biz.ownerChatId) return;
  const chat = biz.ownerChatId, name = biz.profile.ownerName;
  const caption = why ? `${why} — eslatma: <b>${esc(t.title)}</b>` : `🔊 <b>${esc(t.title)}</b>`;
  const text = () => (why ? bot.sendText(chat, caption).catch(e => console.error("[qo'ng'iroq] xabar:", (e as Error).message)) : Promise.resolve());
  if (!t.spoken || !speechEnabled()) return text();
  try {
    await bot.sendVoice(chat, await speak(`${name ? `${name}, ` : ''}eslatma: ${t.title}`), caption);
  } catch (e) {
    console.error('[ovozli eslatma]', (e as Error).message);
    await text();
  }
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
      await voiceMessage(bot, biz, t, result === 'missed' ? "📞 Qo'ng'iroqni ko'tarmadingiz" : "📞 Qo'ng'iroq qilib bo'lmadi");
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
  void (async () => {
    let id: number;
    try {
      id = (await placeCall({
        to: t.callTo!, name: biz.profile.ownerName || biz.profile.name,
        vars: { eslatma: t.title, vaqt: (t.dueAt ?? '').slice(11, 16) },
        externalId: `palantir-${t.id}-${(t.dueAt ?? '').replace(/\D/g, '')}`,
      })).id;
    } catch (e) {
      console.error('[qo\'ng\'iroq]', (e as Error).message);
      // Qo'ng'iroq bo'lmadi — eslatma baribir ovoz bilan eshitilsin; sababi o'sha xabarda (alohida matn emas)
      await voiceMessage(bot, biz, t, `📞 Qo'ng'iroq qilib bo'lmadi (${esc((e as Error).message)})`);
      return;
    }
    // Ikki marta tekshiriladi: terish va gaplashish bir necha daqiqa davom etishi mumkin
    for (const wait of [env.callCheckMs, env.callCheckMs]) {
      await new Promise(r => setTimeout(r, wait));
      const s = await callState(id).catch(() => null);
      if (!s?.finished) continue;
      if (s.status === 'no_answer' || s.status === 'failed') {
        await voiceMessage(bot, biz, t, "📞 Qo'ng'iroqni ko'tarmadingiz");
      }
      return;
    }
  })();
}

const LICENSE_WARNED = 'license.warned';
const LICENSE_STEPS = [0, 1, 3, 7];
/** Kalitsiz muddat tugayapti yoki tugadi — egasiga kompyuter kodi bilan (sotuvchiga yuborsin) */
async function warnLicense(bot: BotService): Promise<void> {
  const lic = licenseStatus();
  const step = lic.activated ? undefined : LICENSE_STEPS.find(d => lic.daysLeft <= d);
  if (step === undefined || settings.all().find(r => r.name === LICENSE_WARNED)?.value === String(step)) return;
  const code = `Kompyuter kodi: <code>${lic.machineId}</code> — sotuvchiga yuboring, u kalit beradi (panelda «Aktivlashtirish»ga qo'yasiz).`;
  const html = step === 0
    ? `🔒 <b>Palantir paneli yopildi</b> — aktivlashtirilmagan. Bot, qo'ng'iroqlar va eslatmalar ishlashda davom etadi.\n${code}`
    : `⏳ <b>Palantir hali aktivlashtirilmagan</b>: panel ${lic.daysLeft} kundan keyin yopiladi (bot, qo'ng'iroqlar va eslatmalar ishlayveradi).\n${code}`;
  for (const b of businesses.all()) {
    if (!b.active || !b.ownerChatId) continue;
    try {
      await bot.sendText(b.ownerChatId, html);
    } catch (e) {
      console.error('[jadval] litsenziya eslatmasi:', (e as Error).message);
      if (transient(e)) return;
    }
  }
  settings.set(LICENSE_WARNED, String(step));
}

const ACCESS_TOLD = 'hub.access.told';
/**
 * Sotuvchi qo'ygan ishlash holati (hubAccess.ts) o'zgardi — egasiga bir marta: eslatma, to'xtatildi yoki yana ochildi. Birinchi marta
 * (hali hech narsa aytilmagan) «to'liq ishlaydi» aytilmaydi. Belgi — holat, sabab va matn: sotuvchi matnni almashtirsa, yana aytiladi
 */
export async function warnAccess(bot: BotService, now = Date.now()): Promise<void> {
  const v = accessView(now);
  const mark = v.state === 'active' ? 'active' : `${v.state}|${v.reason}|${v.message}`;
  const told = settings.all().find(r => r.name === ACCESS_TOLD)?.value;
  if (told === mark || (!told && mark === 'active')) return;
  const html = accessNotice(v, esc);
  for (const b of businesses.all()) {
    if (!b.active || !b.ownerChatId) continue;
    try {
      await bot.sendText(b.ownerChatId, html);
    } catch (e) {
      console.error('[jadval] ishlash holati xabari:', (e as Error).message);
      if (transient(e)) return;
    }
  }
  settings.set(ACCESS_TOLD, mark);
}

export function startScheduler(bot: BotService): () => void {
  const stopInbox = startInbox();
  let running = false;
  let briefRetryAt = 0;
  /** Ertalabki xabar tayyorlanayotgan bizneslar (Direktor tahlili fonda) */
  const morningBusy = new Set<string>();
  /** Kontent-zavod xatosi egasiga qaysi kuni aytilgan (kuniga bir marta) */
  const contentWarned = new Map<string, string>();
  // Internet yo'q paytda har tekshiruvda emas, siyrakroq uriniladi (jurnal bir xil xato bilan to'lmasin)
  let remindRetryAt = 0;
  const remindRetryMs = Math.min(60_000, env.tickMs * 2);
  const tick = async () => {
    // Limit tufayli keyinga qolgan egasining ishlari: navbati ochilgani — o'zi bajariladi (fonda, jadval kutmaydi). Botsiz ham:
    // paneldan so'ralgan ish natijasi panel suhbatiga yoziladi
    // Sotuvchi to'xtatgan (hubAccess.ts): navbatdagi AI ishlari kutib turadi — ochilganda o'zi bajariladi
    if (!deferredBusy && !accessBlocked()) {
      deferredBusy = true;
      void runDeferred(bot).catch(e => console.error('[obuna] kechiktirilgan ishlar:', (e as Error).message)).finally(() => { deferredBusy = false; });
    }
    // Bot hali ulanmagan (token ulash ustasida keyin kiritiladi) — jadval kutib turadi, token kelgach o'zi ishlay boshlaydi
    if (running || !bot.enabled) return;
    running = true;
    try {
      const now = new Date();
      // Sotuvchi to'xtatgan: AI ishlari (kontent-zavod, ertalabki Direktor tahlili) boshlanmaydi; eslatmalar va xabarlar ishlayveradi
      const stopped = accessBlocked();
      // 0) Obsidian'dagi Vazifalar.md: egasi belgilagan, surgan yoki qo'shgani — eslatmalardan oldin bazaga
      for (const b of businesses.all()) if (b.active) syncTasks(b.id);
      // 1) Eslatmalar
      for (const t of Date.now() >= remindRetryAt ? tasks.due(stamp(now)) : []) {
        const biz = businesses.byId(t.businessId);
        // Qo'ng'iroq Telegram'ga bog'liq emas: internet bor-yo'qligidan qat'i nazar o'z vaqtida (qayta qo'ng'iroq qilinmaydi — called)
        if (biz) phoneReminder(bot, biz, t);
        // Egasi Telegram'ni hali ulamagan (vazifani panelda qo'shgan): eslatma yo'qolmasin — ulangach keladi; bir sutkadan eskisi o'tkaziladi
        if (biz && !biz.ownerChatId && now.getTime() - new Date(t.dueAt!).getTime() < LINK_WAIT_MS) continue;
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
      // 4) Kontent-zavod (avtomatik rejim): har kuni ertalab qoralamalar — fonda (AI yozishi bir necha o'n soniya, jadval kutmaydi).
      // Egasi Telegram'dagi kartani tasdiqlamaguncha kanalga hech narsa chiqmaydi
      const contentHour = now.getHours(), contentDay = iso(now);
      if (env.aiEnabled && !stopped && Date.now() >= remindRetryAt && contentHour >= env.morningHour + 1 && contentHour < env.morningHour + 8) {
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || !crewWorks(biz, 'kontent') || !factoryDue(biz.id, now) || extrasPaused()) continue;
          void withLane('background', () => runFactory(biz)).catch(async e => {
            const why = e instanceof ContentError ? e.message : 'ichki xato';
            console.error(`[jadval] kontent-zavod (${biz.profile.name}):`, (e as Error).message);
            // Bir soatdan keyin yana urinadi; egasiga kuniga bir marta aytiladi
            if (contentWarned.get(biz.id) === contentDay) return;
            contentWarned.set(biz.id, contentDay);
            await bot.sendText(biz.ownerChatId!, `⚠️ <b>SMM-menejer</b>: bugungi qoralamalar tayyorlanmadi — ${esc(why)}. Bir soatdan keyin yana urinaman.`).catch(() => {});
          });
        }
      }
      // 4a) SMM-menejer: egasi tasdiqlagan postlar vaqti kelganda o'zi chiqadi (AI'siz; ikki marta chiqmaydi — publish.ts)
      void publishSmm(b => crewWorks(b, 'kontent'), now).catch(e => console.error('[jadval] smm:', (e as Error).message));
      // 4b) Marketolog natijani o'lchaydi (AI'siz): ertalab, kuniga bir marta — kanal ko'rishlari, Instagram layklari
      if (contentHour >= env.morningHour && contentHour < env.morningHour + 12) {
        for (const biz of businesses.all()) {
          if (!biz.active || !crewWorks(biz, 'marketolog') || !measureDue(biz.id, now)) continue;
          void measure(biz).catch(e => console.error(`[jadval] natijalar (${biz.profile.name}):`, (e as Error).message));
        }
      }
      // 3) Kechki BITTA xabar (B6): kamera hisoboti, «o'zi javob bersin» yig'masi (B7) va «Kun qanday o'tdi» — server/evening.ts
      await eveningTick(bot, transient, now);
      // 3c) Obuna limitiga yaqin (B5): egasiga bir marta — qo'shimchalar to'xtadi, bemorlarga javob ishlayveradi
      const pausedUntil = extrasPausedUntil();
      if (pausedUntil && pressureTold !== pausedUntil) {
        pressureTold = pausedUntil;
        const back = new Date(pausedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId) continue;
          await bot.sendText(biz.ownerChatId, `⏸ <b>Claude obunasi limitini tejayapman</b> — bemorlarga javob uchun joy qoldirib, Direktor tahlili va avtomatik kontent ${back} gacha to'xtatildi. Bemorlarga javob ishlayveradi; o'zingiz so'ragan ishlar ham (limit juda yaqinlashsa — katta ishlar keyinroqqa qoladi, men vaqtini aytaman).`).catch(() => {});
        }
      }
      // 2) Ertalabki xulosa
      // Server ertalab o'chiq bo'lgan bo'lsa, kechqurun "xayrli tong" yubormaydi
      const hour = now.getHours();
      if (!stopped && hour >= env.morningHour && hour < env.morningHour + 4 && Date.now() >= briefRetryAt) {
        const today = iso(now);
        for (const biz of businesses.all()) {
          if (!biz.active || !biz.ownerChatId || biz.briefDate === today || biz.profile.morningBrief === false || morningBusy.has(biz.id)) continue;
          // Fonda: Direktor tahlili (AI) bir daqiqagacha ketadi — eslatmalar va boshqa ishlar kutib qolmasin. Xabar bitta: reja + Direktor
          morningBusy.add(biz.id);
          void morningMessage(bot, biz, now).then(sent => {
            businesses.update(biz.id, { briefDate: today, ...(sent ? { briefSentDate: today } : {}) });
          }, e => {
            console.error(`[jadval] xulosa (${biz.profile.name}):`, (e as Error).message);
            // Internet yo'q — «yuborildi» deb belgilanmaydi: besh daqiqadan keyin yana uriniladi (ertalabki oraliq ichida)
            if (transient(e)) briefRetryAt = Date.now() + BRIEF_RETRY_MS;
            else businesses.update(biz.id, { briefDate: today });
          }).finally(() => morningBusy.delete(biz.id));
        }
      }
      // 5) DentaCRM: qabulga kelgan yoki to'lagan bemor — «Mijoz bo'ldi» (G3); fonda, yarim soatda bir marta (CRM sekin bo'lsa jadval kutmaydi)
      for (const biz of businesses.all()) {
        if (!biz.active || !crmConnected(biz.id) || Date.now() - (visitsCheckedAt.get(biz.id) ?? 0) < VISITS_EVERY_MS) continue;
        visitsCheckedAt.set(biz.id, Date.now());
        void syncVisits(biz, now).catch(e => console.warn(`[jadval] kelgan bemorlar (${biz.profile.name}): ${(e as Error).message}`));
      }
      // 4) Litsenziya: panel yopilishiga 7, 3, 1 kun qolganda va yopilganda — egasiga Telegram'da (kunduzi — REQUEST_HOURS, har bosqichda bir marta)
      if (hour >= env.requestHours.from && hour < env.requestHours.to) await warnLicense(bot);
      // 4a) Sotuvchi qo'ygan ishlash holati o'zgardi (to'xtatildi, eslatma, ochildi) — egasiga bir marta, kunduzi
      if (hour >= env.requestHours.from && hour < env.requestHours.to) await warnAccess(bot);
      // 6) Kotib: ish bo'yicha yozgan (yetkazib beruvchi, hamkor) javob kutyapti — kunduzi bitta eslatma, AI'siz (inbox/workChats.ts)
      if (hour >= env.requestHours.from && hour < env.requestHours.to && Date.now() >= remindRetryAt) await workTick((c, h, b) => bot.sendText(c, h, b), businesses.all(), transient);
    } catch (e) {
      console.error('[jadval]', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, env.tickMs);
  void tick();
  // Targetolog: reklama sarfi va limitlar — alohida taymer, botdan va umumiy jadvaldan mustaqil (pul nazorati to'xtamasin)
  let adsBusy = false;
  const adsTick = async () => {
    if (adsBusy) return;
    adsBusy = true;
    try { await watchAds(id => businesses.byId(id)); } catch (e) { console.error("[jadval] targetolog:", (e as Error).message); } finally { adsBusy = false; }
  };
  const adsTimer = setInterval(() => { void adsTick(); }, ADS_WATCH_MS);
  void adsTick();
  return () => { clearInterval(timer); clearInterval(adsTimer); stopInbox(); };
}
