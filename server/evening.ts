/**
 * Kechki BITTA xabar (B6, egasi qarori): kamera hisoboti, Palantir o'zi javob bergan mijozlar (B7), javob kutayotgan ish xabarlari
 * (Kotib, inbox/workChats.ts) va «Kun qanday o'tdi» savoli.
 * Avval uch alohida xabar edi (19:00 savol, kechki yig'ma, 20:00 kamera) va hammasi bitta «ertalabki xulosa» belgisiga bog'liq edi.
 *
 * Belgilar (profil): eveningReport — kun savoli va yig'ma, cameraReport — kamera qismi. Bo'lmasa — eski morningBrief bo'yicha:
 * ilgari «ertalabki xulosa»ni o'chirgan egasiga kechki xabarlar ham kelmasdi — uning tanlovi saqlanadi.
 * Vaqt: kamera qismi qo'shiladigan klinikada — CAMERA_REPORT_HOUR (kun oxiri, kamera raqamlari to'liq), aks holda EVENING_HOUR.
 * Qism hali tayyor bo'lmasa (kamerada aytadigan narsa yo'q, yig'ma bo'sh) — oraliq ichida keyinroq o'zi keladi; odatda hammasi birga.
 */
import { iso } from '../src/lib/week';
import { crewWorks } from '../src/lib/crew';
import type { BotService } from './bot';
import { businesses, cameras, leads, tasks, type BusinessRow } from './db';
import { env } from './env';
import { DAY_OUTCOME, askDay } from './outcome';
import { autoDigestHtml } from './inbox/core';
import { autoDigest } from './serviceStore';
import { cameraReport, cameraSentToday, markCameraSent } from './camera/report';
import { workEveningHtml } from './inbox/workChats';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EVENING_WINDOW_H = 3, CAMERA_WINDOW_H = 4;
/** Kamera hisobini tuzib bo'lmadi (DentaCRM javob bermadi) — shuncha vaqtdan keyin yana, har tekshiruvda emas */
const CAMERA_RETRY_MS = 5 * 60_000;
/** Telegram xabari chegarasi (4096) — undan uzun bo'lsa qismlar alohida xabar bo'ladi */
const MESSAGE_MAX = 3900;
const NO_NEWS = [[{ text: "Bugun aytadigan narsa yo'q", data: `od|${DAY_OUTCOME}` }]];

const digestDay = new Map<string, string>();
/** Kotib qismi (javob kutayotgan ish xabarlari) bugun yuborilganmi */
const workDay = new Map<string, string>();
const cameraRetryAt = new Map<string, number>();

/** Kechki kun yakuni (savol va yig'ma) yoqilganmi */
export const eveningOn = (biz: BusinessRow): boolean => biz.profile.eveningReport ?? biz.profile.morningBrief !== false;
/** Kechki xabarda kamera hisoboti bo'ladimi: belgi yoqilgan, Kuzatuvchi jamoada va kamera ulangan */
export const cameraPartOn = (biz: BusinessRow): boolean =>
  (biz.profile.cameraReport ?? biz.profile.morningBrief !== false) && crewWorks(biz, 'kuzatuvchi') && cameras.list(biz.id).length > 0;

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

/** Qismlarni bitta xabarga (sig'masa — bir nechtaga); tugma oxirgi xabarda (savol oxirida turadi) */
export function joinEvening(parts: string[], buttons?: typeof NO_NEWS): { html: string; buttons?: typeof NO_NEWS }[] {
  const out: string[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (last && last.length + p.length + 2 <= MESSAGE_MAX) out[out.length - 1] = `${last}\n\n${p}`;
    else out.push(p);
  }
  return out.map((html, i) => ({ html, ...(buttons && i === out.length - 1 ? { buttons } : {}) }));
}

/** Kechki oraliq: kamera qismi bo'lsa — kamera soatidan (4 soat), bo'lmasa — EVENING_HOUR dan (3 soat) */
const windowOf = (withCamera: boolean): [number, number] => {
  const from = withCamera ? env.cameraReportHour : env.eveningHour;
  return [from, from + (withCamera ? CAMERA_WINDOW_H : EVENING_WINDOW_H)];
};

/** Bitta biznesning kechki xabari: hali yuborilmagan va tayyor qismlar birga. Qaytadi: biror narsa yuborildimi */
async function eveningFor(bot: BotService, biz: BusinessRow, now: Date, withCamera: boolean): Promise<boolean> {
  const day = iso(now);
  const on = eveningOn(biz);
  // Savolga javob AI'ga boradi — AI yo'q bo'lsa savol berilmaydi
  const askNow = on && env.aiEnabled && biz.eveningDate !== day;
  const check = askNow ? eveningCheck(biz, now) : null;
  const digest = on && digestDay.get(biz.id) !== day ? autoDigestHtml(biz) : null;
  const work = on && workDay.get(biz.id) !== day ? workEveningHtml(biz.id, now.getTime()) : null;
  let camera: string | null = null;
  if (withCamera && !cameraSentToday(biz.id, day) && (cameraRetryAt.get(biz.id) ?? 0) <= now.getTime()) {
    try {
      camera = await cameraReport(biz, day, now);
    } catch (e) {
      cameraRetryAt.set(biz.id, now.getTime() + CAMERA_RETRY_MS);
      console.error(`[kechki] kamera hisoboti (${biz.profile.name}):`, (e as Error).message);
    }
  }
  const parts = [camera, digest, work, check?.html].filter((p): p is string => !!p);
  for (const m of joinEvening(parts, check ? NO_NEWS : undefined)) await bot.sendText(biz.ownerChatId!, m.html, m.buttons);
  // Yuborilgach belgilanadi: savol kuniga bir marta (aytadigan narsa bo'lmasa ham — avvalgidek), yig'ma va kamera — faqat yuborilganda
  if (check) askDay(biz, check.taskIds, check.leadIds);
  if (askNow) businesses.update(biz.id, { eveningDate: day });
  if (digest) { autoDigest.clear(biz.id); digestDay.set(biz.id, day); }
  if (camera) markCameraSent(biz.id, day);
  if (work) workDay.set(biz.id, day);
  return parts.length > 0;
}

/**
 * Har tekshiruvda (scheduler.ts): kechki oraliqdagi bizneslarga. transient — qayta urinsa o'tadigan xato (internet yo'q):
 * shunda qolgan bizneslar keyingi tekshiruvga qoladi
 */
export async function eveningTick(bot: BotService, transient: (e: unknown) => boolean, now = new Date()): Promise<void> {
  const hour = now.getHours();
  for (const biz of businesses.all()) {
    if (!biz.active || !biz.ownerChatId) continue;
    const withCamera = cameraPartOn(biz);
    const [from, to] = windowOf(withCamera);
    if (hour < from || hour >= to) continue;
    try {
      await eveningFor(bot, biz, now, withCamera);
    } catch (e) {
      console.error(`[kechki] (${biz.profile.name}):`, (e as Error).message);
      if (transient(e)) break;
      // Doimiy xato (Telegram rad etdi): har tekshiruvda qayta urinib navbatni to'smaydi — savol bugunga yopiladi (avvalgidek),
      // yig'ma ertangi xabarga qoladi, kamera besh daqiqadan keyin yana
      businesses.update(biz.id, { eveningDate: iso(now) });
      digestDay.set(biz.id, iso(now));
      workDay.set(biz.id, iso(now));
      cameraRetryAt.set(biz.id, now.getTime() + CAMERA_RETRY_MS);
    }
  }
}
