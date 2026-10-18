/**
 * Ertalabki ish rejasi: egasi kunni nimadan boshlashi kerak — muhimi tepada. AI'siz tuziladi (arzon, tez, har doim bir xil);
 * tugmalar bosilgandagina yordamchi ishlaydi (masalan, unutilgan mijozga xabar tayyorlaydi).
 * Tartib: javob kutayotgan mijozlar → bugungi va kechikkan qadamlar (mijozlar) → vazifalar → unutilgan mijozlar → klinika → yangi mijozlar → bayram.
 * Dushanba — o'tgan haftaning qisqa yakuni ham. Sof funksiya: ma'lumotni jadval (scheduler.ts) yig'adi.
 */
import type { IndustryProfile } from '../src/data/industries';
import type { Lead, Task } from '../src/types';
import { dueLabel } from '../src/lib/week';

export interface PlanInput {
  now: Date;
  ownerName: string;
  profile: Pick<IndustryProfile, 'kind' | 'customer' | 'followDays'>;
  tasks: Task[];
  /** Faol mijozlar (yangi va gaplashilgan) */
  leads: Lead[];
  /** Mijozlarga javob — egasining tasdig'ini kutayotganlari */
  repliesPending: number;
  /** Egasi tayyorlatgan, hali yuborilmagan xabarlar */
  outboundDrafts: number;
  /** Klinika: bugungi qabullar va ogohlantirishlar (tayyor qatorlar) */
  crmLines: string[];
  holidays: string[];
  /** Dushanba: o'tgan hafta (dushanbadan yakshanbagacha) */
  week: { leadsAdded: number; tasksDone: number; crmLine: string | null } | null;
  /** Klinika, dushanba: 6–12 oy oldin kelgan bemorlar soni */
  recall: number;
  /** Yordamchi (AI) ishlaydi: bugungi va unutilgan mijozlarga xabarni o'zi tayyorlaydi — tugma o'rniga */
  autoPrep: boolean;
}

export interface PlanButton { text: string; data: string }
/** prep — yordamchi ertalab o'zi xabar tayyorlaydigan mijozlar (id), birinchi navbatdagilari */
export interface Plan { html: string; buttons: PlanButton[][]; prep: string[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DAY_MS = 86_400_000;
const MAX_LINES = 7, MAX_FOLLOW_BUTTONS = 3;
/** Ertalab yordamchi shuncha mijozga xabar tayyorlaydi (qolgani — ertaga yoki egasi so'rasa) */
export const MAX_PREP = 5;
const two = (n: number) => String(n).padStart(2, '0');
const localStamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
const nameOf = (l: Lead) => l.name ?? (l.username ? `@${l.username}` : l.phone ?? "ismi yo'q");
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Mijoz qachondan beri e'tiborsiz (kun): oxirgi o'zgarish yoki uning oxirgi xabari */
export const idleDays = (l: Lead, now: Date): number => {
  const last = Math.max(Date.parse(l.updatedAt), l.lastInboundAt ? Date.parse(l.lastInboundAt) : 0);
  return Math.floor((now.getTime() - last) / DAY_MS);
};

/** Keyingi qadami bugun yoki undan oldin bo'lgan mijozlar (eng kechikkani birinchi) */
export function dueLeads(leads: Lead[], now: Date): Lead[] {
  const end = `${localStamp(now).slice(0, 10)}T23:59`;
  return leads.filter(l => l.nextAt && l.nextAt <= end).sort((a, b) => a.nextAt!.localeCompare(b.nextAt!));
}

/** Keyingi qadami yo'q va shuncha kundan beri hech narsa bo'lmagan mijozlar (eng uzoq unutilgani birinchi) */
export function forgottenLeads(leads: Lead[], now: Date, followDays: number): Lead[] {
  return leads.filter(l => !l.nextAt && idleDays(l, now) >= followDays).sort((a, b) => idleDays(b, now) - idleDays(a, now));
}

export function planText(p: PlanInput): Plan | null {
  const today = localStamp(p.now).slice(0, 10);
  const open = p.tasks.filter(t => t.status === 'open');
  const overdue = open.filter(t => t.dueAt && t.dueAt < `${today}T00:00`);
  const todays = open.filter(t => t.dueAt?.startsWith(today));
  const due = dueLeads(p.leads, p.now);
  const forgotten = forgottenLeads(p.leads, p.now, p.profile.followDays);
  // Yangi mijoz — rejaning boshqa joyida (bugungi qadam, unutilgan) allaqachon bo'lmasa
  const listed = new Set([...due, ...forgotten].map(l => l.id));
  const fresh = p.leads.filter(l => p.now.getTime() - Date.parse(l.createdAt) < DAY_MS && !listed.has(l.id));
  const waiting = p.repliesPending + p.outboundDrafts;
  // Hafta yakuni faqat aytadigan narsa bo'lsa (hammasi nol — shovqin)
  const week = p.week && (p.week.leadsAdded || p.week.tasksDone || p.week.crmLine) ? p.week : null;
  const somethingToSay = overdue.length || todays.length || due.length || forgotten.length || fresh.length || waiting || p.crmLines.length || p.holidays.length || week || p.recall;
  if (!somethingToSay) return null;

  const { many } = p.profile.customer;
  const out = [`☀️ <b>Xayrli tong${p.ownerName ? `, ${esc(p.ownerName)}` : ''}!</b>`];
  const buttons: PlanButton[][] = [];
  const section = (title: string, lines: string[]) => { if (lines.length) out.push('', `<b>${title}</b>`, ...lines); };

  if (waiting) {
    const parts = [p.repliesPending && `${p.repliesPending} ta javob`, p.outboundDrafts && `${p.outboundDrafts} ta xabar`].filter(Boolean).join(', ');
    out.push('', `⏳ <b>Tasdig'ingizni kutyapti:</b> ${parts} — Telegram'dagi kartalarda «Yuborish»ni bosing.`);
  }
  if (p.crmLines.length) out.push('', ...p.crmLines);
  section(`📌 Bugungi qadamlar (${due.length})`, due.slice(0, MAX_LINES).map(l =>
    `• ${esc(nameOf(l))} — ${esc(cut(l.nextStep ?? "bog'lanish", 80))}${l.nextAt! < `${today}T00:00` ? ` — <i>${dueLabel('uz', l.nextAt!, p.now)}</i>` : ''}`));
  const taskLine = (t: Task) => `• ${esc(t.title)}${t.dueAt ? ` — <i>${dueLabel('uz', t.dueAt, p.now)}</i>` : ''}`;
  section(`Bugun (${todays.length})`, todays.slice(0, 10).map(taskLine));
  section(`🔴 Kechikkan (${overdue.length})`, overdue.slice(0, MAX_LINES).map(taskLine));
  const prep = p.autoPrep ? [...due, ...forgotten].slice(0, MAX_PREP).map(l => l.id) : [];
  if (forgotten.length) {
    section(`💤 Unutilgan ${many} (${forgotten.length})`, forgotten.slice(0, MAX_LINES).map(l => `• ${esc(nameOf(l))} — ${idleDays(l, p.now)} kundan beri${l.note ? ` · <i>${esc(cut(l.note, 60))}</i>` : ''}`));
    if (!p.autoPrep) {
      out.push('Keyingi qadam qo\'yilmagan. Tugmani bossangiz — qayta yozish uchun xabar tayyorlayman.');
      for (const l of forgotten.slice(0, MAX_FOLLOW_BUTTONS)) buttons.push([{ text: `✍️ ${cut(nameOf(l), 28)}`, data: `fu|${l.id}` }]);
    }
  }
  // Sondan keyin birlik: «4 ta bemorga» (o'zbekchada «4 ta bemorlarga» emas)
  if (prep.length) out.push('', `✍️ <b>${prep.length} ta ${p.profile.customer.one}ga xabar tayyorlayapman</b> — bir daqiqada shu yerga «Yuborish» tugmasi bilan keladi.`);
  if (p.recall) {
    out.push('', `🔁 <b>Qaytarish kerak:</b> ${p.recall} ta bemor 6–12 oy oldin kelgan va boshqa kelmagan. Qabulxona qo'ng'iroq qilib, ko'rikka chaqirsa — eng arzon yangi bemor shu.`);
    buttons.push([{ text: "📋 Bemorlar ro'yxati", data: 'rc|list' }]);
  }
  section(`Yangi ${many} (${fresh.length})`, fresh.slice(0, MAX_LINES).map(l => `• ${esc(nameOf(l))}${l.phone ? ` — ${esc(l.phone)}` : ''}`));
  if (week) {
    section("📊 O'tgan hafta", [`• Yangi ${many}: ${week.leadsAdded}`, `• Bajarilgan vazifalar: ${week.tasksDone}`, ...(week.crmLine ? [`• ${week.crmLine}`] : [])]);
  }
  if (p.holidays.length) out.push('', ...p.holidays);
  out.push('', 'Nima qilamiz? Yozing yoki ovozli xabar yuboring.');
  return { html: out.join('\n'), buttons, prep };
}
