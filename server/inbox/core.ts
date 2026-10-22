/**
 * Mijozlar bilan yozishma — bot, egasining shaxsiy Telegrami va Instagram bitta oqimda:
 *
 *   mijoz yozdi → mijozlar ro'yxatiga (bir odam — bitta yozuv) → bir necha soniya kutiladi
 *   (odatda ketma-ket yozishadi) → Claude javob tayyorlaydi → rejimga qarab:
 *     draft — egasiga Telegramda karta: mijoz gapi, javob taklifi, «Yuborish / Kerak emas»;
 *     auto  — egasi belgilangan daqiqa ichida o'zi yozmasa, Palantir yuboradi va egasiga aytadi.
 *             Bilmagan narsasini (narx yo'q, chegirma, buyurtma) baribir egasidan so'raydi.
 *   Egasi o'zi javob yozsa — Palantir tayyorlagan taklif bekor bo'ladi.
 *
 * Kanallar (bot, shaxsiy Telegram, Instagram) bu yerga faqat "xabar keldi" va "yubor" orqali ulanadi.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { AutoReply, InboxMessage, LeadChannel, ReplyBooking } from '../../src/types';
import { check } from '../../src/lib/compliance';
import { iso } from '../../src/lib/week';
import { businesses, inbox, leads, notices, relays, replies, type BusinessRow, type ChannelPerson, type LeadRow, type ReplyRow } from '../db';
import { cleanName, normPhone } from '../crm/logic';
import { filterOptions, recordFix } from '../brain/index';
import { ownerAnswered } from '../brain/learn';
import { AiLimitError } from '../claude';
import { bookForCustomer, bookingLine, changeLine, changeVisit, checkBooking, checkChange } from '../crm/reception';
import { env } from '../env';
import { decide, type Decision } from './replier';
import { phoneChanged } from '../people';
import { deliverToTeam, editTeamCards, openRequest } from '../requests/index';
import { replyCards } from '../requests/store';

export interface Sender {
  /** Shu mijozga shu kanal orqali yozish mumkinmi */
  can(biz: BusinessRow, lead: LeadRow): boolean;
  /** Yuboradi; qaytaradi — kanal bergan xabar id'si (qayta kelsa tanib olish uchun) */
  send(biz: BusinessRow, lead: LeadRow, text: string): Promise<string | null>;
}

/** Egasiga Telegram orqali xabar (bot) */
export interface OwnerOutlet {
  notify(biz: BusinessRow, html: string, keyboard?: InlineKeyboardMarkup): Promise<number | null>;
  /** keyboard berilmasa — tugmalar olib tashlanadi */
  edit(biz: BusinessRow, messageId: number, html: string, keyboard?: InlineKeyboardMarkup): Promise<void>;
  /** Kompyuterdagi fayl (hujjat sifatida) */
  sendFile(biz: BusinessRow, path: string, caption: string): Promise<void>;
}

/** Yuborish yo'llari: nomi bo'yicha (bir kanalda bir nechta bo'lishi mumkin — Instagram'da brauzer va rasmiy API) */
const senders = new Map<string, { channel: LeadChannel; sender: Sender }>();
const sendersOf = (ch: LeadChannel) => [...senders.values()].filter(x => x.channel === ch).map(x => x.sender);
let owner: OwnerOutlet | null = null;
export const registerSender = (channel: LeadChannel, s: Sender, name: string = channel) => { senders.set(name, { channel, sender: s }); };
export const setOwnerOutlet = (o: OwnerOutlet) => { owner = o; };
/** Bot tokeni olib tashlandi (ulash ustasi): eski bot orqali mijozga ham, egasiga ham yuborilmaydi */
export const clearBotOutlets = (): void => { senders.delete('bot'); owner = null; };
export const notifyOwner = (biz: BusinessRow, html: string, keyboard?: InlineKeyboardMarkup) => owner?.notify(biz, html, keyboard) ?? Promise.resolve(null);
export const editOwner = (biz: BusinessRow, messageId: number, html: string, keyboard?: InlineKeyboardMarkup) => owner?.edit(biz, messageId, html, keyboard) ?? Promise.resolve();
export const notifyOwnerFile = (biz: BusinessRow, path: string, caption: string) => owner?.sendFile(biz, path, caption) ?? Promise.resolve();

export const DEFAULT_REPLY: AutoReply = { mode: 'draft', contacts: false, delayMin: 2 };
export const replySettings = (biz: BusinessRow): AutoReply => ({ ...DEFAULT_REPLY, ...biz.profile.autoReply });

const CHANNEL_LABEL: Record<LeadChannel, string> = { bot: 'Telegram bot', telegram: 'Telegram', instagram: 'Instagram', manual: "qo'lda" };
/** Qaysi kanal orqali yozish: mijoz qayerda yozishgan bo'lsa — o'sha yerda */
const ROUTES: Record<LeadChannel, LeadChannel[]> = { bot: ['bot', 'telegram'], telegram: ['telegram', 'bot'], instagram: ['instagram'], manual: ['telegram', 'bot'] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const who = (l: LeadRow) => {
  const name = l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';
  return `${esc(name)}${l.username && l.name ? ` (@${esc(l.username)})` : ''}`;
};

// ─── Yuborish ─────────────────────────────────────────────────────────────────

/** O'zimiz yuborgan xabar kanaldan qaytib kelsa (Instagram echo, Telegram "chiquvchi xabar") — egasiniki deb o'ylamaslik uchun */
const ours = new Map<string, number>();
const ourKey = (bizId: string, channel: LeadChannel, text: string) => `${bizId}|${channel}|${text.trim()}`;
export const isOurEcho = (bizId: string, channel: LeadChannel, text: string) => {
  const t = ours.get(ourKey(bizId, channel, text));
  return !!t && Date.now() - t < 120_000;
};

export function canReach(biz: BusinessRow, lead: LeadRow): boolean {
  return ROUTES[lead.channel].some(ch => sendersOf(ch).some(s => s.can(biz, lead)));
}

/** Mijozga yozadi (u yozishgan kanal orqali) va yozishmaga qo'shadi */
export async function sendToLead(biz: BusinessRow, lead: LeadRow, text: string, by: 'owner' | 'palantir'): Promise<LeadChannel> {
  let last: Error | null = null;
  for (const ch of ROUTES[lead.channel]) {
    const s = sendersOf(ch).find(x => x.can(biz, lead));
    if (!s) continue;
    try {
      ours.set(ourKey(biz.id, ch, text), Date.now());
      const extId = await s.send(biz, lead, text);
      inbox.add(biz.id, { leadId: lead.id, channel: ch, direction: 'out', by, text, extId });
      if (lead.stage === 'new') leads.update(biz.id, lead.id, { stage: 'contacted' });
      return ch;
    } catch (e) {
      last = e as Error;
    }
  }
  throw last ?? new Error(lead.channel === 'instagram'
    ? 'Instagram ulanmagan — panel → Ulanishlar'
    : "Bu mijozga Palantir yoza olmaydi: u botga yozmagan, shaxsiy Telegram esa ulanmagan");
}

// ─── Kiruvchi xabar ───────────────────────────────────────────────────────────

export interface Incoming {
  channel: 'bot' | 'telegram' | 'instagram';
  person: ChannelPerson;
  text: string;
  /** Kanaldagi xabar id'si — bir xabar ikki marta kelsa (qayta tekshiruvda) bir marta ishlanadi */
  extId: string;
  source: string;
}

const timers = new Map<string, NodeJS.Timeout>();

/** Bitta suhbat uchun bir kunda tayyorlanadigan javoblar soni */
const MAX_AI_PER_LEAD_DAY = 40;
const leadAi = new Map<string, { day: string; count: number }>();
function leadAiAllowed(leadId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  // Kun almashganda eski hisoblar tashlanadi (xarita o'smaydi)
  if (leadAi.size > 5000) for (const [k, v] of leadAi) if (v.day !== today) leadAi.delete(k);
  const used = leadAi.get(leadId)?.day === today ? leadAi.get(leadId)!.count : 0;
  if (used >= MAX_AI_PER_LEAD_DAY) return false;
  leadAi.set(leadId, { day: today, count: used + 1 });
  return true;
}

export function onIncoming(biz: BusinessRow, m: Incoming): LeadRow {
  const { lead } = leads.fromChannel(biz.id, m.channel, m.person, m.source);
  const saved = inbox.add(biz.id, { leadId: lead.id, channel: m.channel, direction: 'in', by: 'customer', text: m.text, extId: m.extId });
  if (saved) schedule(biz.id, lead.id);
  return lead;
}

/** Egasi o'zi yozdi (telefonidagi Telegram yoki Instagram'dan) */
export function onOwnerOutgoing(biz: BusinessRow, channel: 'telegram' | 'instagram', peer: { tgUserId?: string; igUserId?: string }, text: string, extId: string | null): void {
  const lead = peer.igUserId ? leads.byInstagram(biz.id, peer.igUserId) : peer.tgUserId ? leads.byTelegram(biz.id, peer.tgUserId) : undefined;
  // Mijoz bo'lmagan odam bilan yozishma (shaxsiy suhbat) — yozib olinmaydi
  if (!lead) return;
  if ((extId && inbox.has(biz.id, channel, extId)) || isOurEcho(biz.id, channel, text)) return;
  inbox.add(biz.id, { leadId: lead.id, channel, direction: 'out', by: 'owner', text, extId });
  ownerAnswered(biz, lead, text, (html, keyboard) => notifyOwner(biz, html, keyboard));
  void supersede(biz, lead, "O'zingiz javob berdingiz").catch(e => console.error('[mijozlar] karta:', (e as Error).message));
}

function schedule(bizId: string, leadId: string): void {
  const key = `${bizId}:${leadId}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    handle(bizId, leadId).catch(e => console.error('[mijozlar]', (e as Error).message));
  }, env.inboxDebounceMs));
}

/** Oxirgi javobimizdan keyingi mijoz xabarlari */
const unanswered = (thread: InboxMessage[]) => {
  const i = thread.map(m => m.direction).lastIndexOf('out');
  return thread.slice(i + 1);
};

async function handle(bizId: string, leadId: string): Promise<void> {
  const biz = businesses.byId(bizId);
  const lead = leads.get(bizId, leadId);
  if (!biz?.active || !lead) return;
  const thread = inbox.thread(bizId, leadId, 30);
  const last = thread.at(-1);
  if (!last || last.direction !== 'in') return;
  const fresh = unanswered(thread);
  const settings = replySettings(biz);
  // Qabul taklifi (klinika) hozircha qoladi: bemor shunchaki «rahmat» desa, egasidagi karta bekor bo'lmasin
  await supersede(biz, lead, 'Yangi xabar keldi — pastda yangi taklif', true);

  if (settings.mode === 'off' || !env.aiEnabled) {
    // Bot suhbatini egasi boshqa joyda ko'rmaydi — shunchaki yetkaziladi
    if (lead.channel === 'bot') await forward(biz, lead, fresh, null);
    return;
  }
  // Bitta suhbat butun biznesning kunlik AI hisobini yeb qo'ymasin (spam yoki bot bilan «o'ynash»): chegaradan keyin xabar egasiga AI'siz yetkaziladi
  if (!leadAiAllowed(lead.id)) {
    await forward(biz, lead, fresh, `Bu suhbatda bugun ${MAX_AI_PER_LEAD_DAY} ta javob tayyorlandi — chegara. Javobni o'zingiz bering`);
    return;
  }
  let d: Decision;
  try {
    d = await decide(biz, lead, thread);
  } catch (e) {
    console.error('[mijozlar] javob tayyorlanmadi:', (e as Error).message);
    await forward(biz, lead, fresh, e instanceof AiLimitError ? "Bugungi AI chegarasi tugadi — bu xabarga o'zingiz javob bering" : "Palantir javob tayyorlay olmadi — o'zingiz javob bering");
    return;
  }
  // Claude o'ylayotganda yana yozgan bo'lsa — navbatdagi ishlov hammasini birga ko'radi
  if (inbox.last(bizId, leadId)?.id !== last.id) return;
  remember(biz, lead, d);
  // Mijoz xodimdan ish kutyapti (qo'ng'iroq qilish, qabul, shikoyat): so'rov qabulxonaga — javobning taqdiridan qat'i nazar
  if (d.request) {
    await openRequest(biz, lead.id, { ...d.request, source: lead.channel, quote: fresh.map(m => m.text).join(' / ') })
      .catch(e => console.error("[mijozlar] so'rov ochilmadi:", (e as Error).message));
  }
  // Yangi javob yoki yangi qabul taklifi bo'lsa — eski qabul taklifi ham eskiradi
  if (d.action !== 'ignore') await supersede(biz, lead, 'Yangi xabar keldi — pastda yangi taklif');

  if (d.action === 'book' && d.booking) {
    try {
      return await receive(biz, lead, fresh, d, settings.mode);
    } catch (e) {
      // Kutilmagan xato (masalan, Telegram kartani qabul qilmadi): bemorning xabari javobsiz yo'qolmasin
      console.error('[mijozlar] qabul:', (e as Error).message);
      return forward(biz, lead, fresh, "Palantir qabulni oxiriga yetkaza olmadi — CRM'ni tekshirib, o'zingiz javob bering");
    }
  }
  if ((d.action === 'reschedule' || d.action === 'cancel_visit') && d.change) {
    try {
      return await changeFlow(biz, lead, fresh, d, settings.mode);
    } catch (e) {
      console.error("[mijozlar] qabulni o'zgartirish:", (e as Error).message);
      return forward(biz, lead, fresh, "Palantir qabulni o'zgartira olmadi — CRM'ni tekshirib, o'zingiz javob bering");
    }
  }
  if (d.action === 'ignore' || !d.reply) {
    // Javob matni yo'q, lekin egasiga aytadigan gap bor (model javob yozishdan bosh tortdi) — hamma kanalda yetkaziladi, xabar javobsiz yo'qolmasin
    if (d.action !== 'ignore' && d.noteForOwner) await forward(biz, lead, fresh, d.noteForOwner);
    else if (lead.channel === 'bot') await forward(biz, lead, fresh, null);
    return;
  }
  const clean = isClean(biz, d.reply);
  if (settings.mode === 'auto' && d.action === 'reply' && clean) {
    // Botda egasi suhbatda yo'q — darhol; shaxsiy chatda egasiga o'zi javob berishga vaqt
    const delay = lead.channel === 'bot' ? 0 : settings.delayMin * env.minuteMs;
    const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'scheduled', note: null, dueAt: new Date(Date.now() + delay).toISOString() });
    if (!delay) await flush(r);
    return;
  }
  const note = !clean ? "Javob taklifida reklama filtriga tushadigan so'z bor — tekshirib yuboring" : d.noteForOwner || null;
  const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'pending', note, dueAt: null, question: d.action === 'ask_owner' ? d.question : null });
  await card(biz, lead, fresh, r);
}

/** Qabul yozilgan bemor — mijoz kartasi unga bog'lanadi (oldin boshqa bemorga bog'langan bo'lsa — tegilmaydi) */
function linkBooked(biz: BusinessRow, lead: LeadRow, patientId: string): void {
  if (!leads.get(biz.id, lead.id)?.patientId) leads.setPatient(biz.id, lead.id, patientId);
}

/** Keyingi qadam vaqti: N kundan keyin soat 10:00 (mahalliy) */
const followAt = (days: number): string => `${iso(new Date(Date.now() + days * DAY_MS))}T10:00`;

/**
 * Mijoz o'zi aytgan ism, telefon, nima xohlashi va (yozishmadan ko'rinsa) keyingi qadam — mijozlar ro'yxatiga.
 * Egasi yoki yordamchi qo'ygan keyingi qadam ustidan yozilmaydi
 */
function remember(biz: BusinessRow, lead: LeadRow, d: Decision): void {
  const patch: { name?: string; phone?: string; note?: string; nextStep?: string; nextAt?: string } = {};
  if (d.customerName && !lead.name) patch.name = d.customerName;
  if (d.customerPhone && !lead.phone) patch.phone = d.customerPhone;
  if (d.leadNote && d.leadNote !== lead.note) patch.note = d.leadNote;
  if (d.followUp && d.followUpDays && !lead.nextAt && (lead.stage === 'new' || lead.stage === 'contacted')) { patch.nextStep = d.followUp; patch.nextAt = followAt(d.followUpDays); }
  if (Object.keys(patch).length) leads.update(biz.id, lead.id, patch);
  // Raqam aytildi — shu odamning boshqa kanaldagi kartalari (Instagram, bot, qo'ng'iroq) shu kartaga yig'iladi
  if (patch.phone) phoneChanged(biz, lead.id);
}

const DAY_MS = 86_400_000;
/** Bitta suhbatdan bir kunda o'zi yoziladigan qabullar (adashgan yoki zararli suhbat CRM'ni to'ldirmasin) */
const MAX_BOOKINGS_PER_LEAD_DAY = 2;
/** Bitta telefon raqamiga, turli suhbatlardan bo'lsa ham, bir haftada o'zi yoziladigan qabullar */
const MAX_BOOKINGS_PER_PHONE_WEEK = 2;
/** Qisqa vaqt ichida shuncha qabul yozilsa — o'zi yozishdan to'xtaydi va egasidan so'raydi */
const BURST_BOOKINGS = 6;
const BURST_WINDOW_MIN = 10;
const CLOCK_RE = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/g;
/** Qabul yozilmagan holatda egasiga taklif qilinadigan betaraf javob («yozdik» deyilmaydi) */
const HOLD_TEXT = "Rahmat! Ma'lumotni tekshirib, tez orada javob beramiz.";

/** Reklama filtri (sozlamasi paneldagi ogohlantirish bilan bitta joydan — brain/index.ts) */
const isClean = (biz: BusinessRow, text: string) => check(text, filterOptions(biz)).length === 0;

/** «O'zi javob bersin» rejimida tasdiqsiz yozish chegaralari: oshgan bo'lsa — sababi (qabul egasining tasdig'iga o'tadi) */
function autoLimit(biz: BusinessRow, lead: LeadRow, phone: string): string | null {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  if (replies.bookings(biz.id, since(DAY_MS), { leadId: lead.id }) >= MAX_BOOKINGS_PER_LEAD_DAY) return `bu suhbatdan bir kunda ${MAX_BOOKINGS_PER_LEAD_DAY} ta qabul yozildi — chegara`;
  if (replies.bookings(biz.id, since(7 * DAY_MS), { phone }) >= MAX_BOOKINGS_PER_PHONE_WEEK) return `bu telefon raqamiga bir haftada ${MAX_BOOKINGS_PER_PHONE_WEEK} ta qabul yozildi — chegara`;
  if (replies.bookings(biz.id, since(BURST_WINDOW_MIN * 60_000)) >= BURST_BOOKINGS) return `oxirgi ${BURST_WINDOW_MIN} daqiqada ${BURST_BOOKINGS} ta qabul yozildi — chegara`;
  if (replies.bookings(biz.id, since(DAY_MS)) >= env.crmPublicDailyBookings) return `bir kunda ${env.crmPublicDailyBookings} ta qabul yozildi — kunlik chegara`;
  return null;
}

/**
 * Qabul CRM'ga yozilayotgan paytda bemor yana yozgan bo'lsa: tasdiq ketgach bu xabarlar «javob berilgan» bo'lib qolardi.
 * Ularga hali taklif tayyorlanmagan bo'lsa — egasiga yetkaziladi.
 */
async function forwardMissed(biz: BusinessRow, lead: LeadRow, sinceIso: string): Promise<void> {
  const since = inbox.thread(biz.id, lead.id, 30).filter(m => m.createdAt >= sinceIso);
  const missed = since.filter(m => m.direction === 'in');
  // Shu orada faqat bitta chiquvchi xabar — tasdiqning o'zi — bo'lishi kerak: yo'q bo'lsa (tasdiq ketmadi) navbatdagi ishlov o'zi javob beradi, ko'p bo'lsa — javob berilgan
  const answeredElsewhere = since.filter(m => m.direction === 'out').length !== 1 || replies.open(biz.id, lead.id).some(r => r.createdAt >= sinceIso);
  if (!missed.length || answeredElsewhere) return;
  await forward(biz, lead, missed, "Qabul yozilayotgan paytda bemor yana yozdi — javobni o'zingiz bering").catch(e => console.error('[mijozlar]', (e as Error).message));
}

/**
 * Bemor qabulga yozilmoqchi (klinika, DentaCRM). Model faqat taklif qiladi: bu yerda ma'lumot va vaqt tekshiriladi.
 *   draft — egasiga karta: «Yozish va yuborish» bosilgandagina CRM'ga yoziladi;
 *   auto  — darhol yoziladi, keyin bemorga tasdiq ketadi va egasiga aytiladi; shubhali holat va chegaradan oshgani — kartaga.
 * Yozib bo'lmasa — bemorga «yozdik» deyilmaydi, qaror sababi bilan egasiga o'tadi.
 */
async function receive(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], d: Decision, mode: AutoReply['mode']): Promise<void> {
  const want = d.booking!;
  const ask: ReplyBooking = { doctorId: want.doctorId, doctorName: '', date: want.date, time: want.time, name: cleanName(d.customerName), phone: normPhone(d.customerPhone) || d.customerPhone };
  const hold = async (why: string, verdict = 'Qabulga yozilmadi') => {
    const who = `${ask.name || "ismi yo'q"}, ${ask.phone || "telefoni yo'q"}`;
    const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text: HOLD_TEXT, status: 'pending', dueAt: null, note: `${verdict}: ${why}. So'ragani: ${ask.date} ${ask.time} (${who})` });
    await card(biz, lead, fresh, r);
  };
  const ready = await checkBooking(biz, ask);
  // Bemor bu orada yana yozgan bo'lsa ("yo'q, boshqa vaqt") — taklif ham, qabul ham yo'q: navbatdagi ishlov hammasini birga ko'radi
  if (inbox.last(biz.id, lead.id)?.id !== fresh.at(-1)?.id) return;
  if ('problem' in ready) return hold(ready.problem);
  const booking: ReplyBooking = { ...ask, doctorName: ready.doctorName };
  // Tasdiqdagi kun, vaqt va shifokor model matnidan emas, yoziladigan qabulning o'zidan olinadi
  const text = `${d.reply}\n📅 ${booking.date} ${booking.time}, ${booking.doctorName}`.trim();
  const propose = async (note: string | null) => {
    const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text, status: 'pending', note, dueAt: null, booking });
    await card(biz, lead, fresh, r);
  };
  // Telefon bazada boshqa odam(lar)niki: oila a'zosimi, xatomi yoki begonami — buni egasi biladi
  if (ready.others.length) return propose(`Bu telefon bazada boshqa ism bilan: ${ready.others.join(', ')}. Tasdiqlasangiz, shu telefon bilan yangi bemor ochiladi`);
  if (!isClean(biz, text)) return propose("Javob taklifida reklama filtriga tushadigan so'z bor — tekshirib yuboring");
  // Model matnida boshqa vaqt aytilgan bo'lsa, bemor ikki xil vaqtni ko'rardi
  if ((d.reply.match(CLOCK_RE) ?? []).some(t => t.replace('.', ':').padStart(5, '0') !== booking.time)) return propose('Javob matnidagi vaqt yozilayotgan qabul vaqtidan boshqa — matnni tekshiring');
  if (mode !== 'auto') return propose(null);
  const limit = autoLimit(biz, lead, booking.phone);
  if (limit) return propose(`O'zim yozmadim: ${limit}. Tasdiqlasangiz — yozaman`);
  if (!canReach(biz, lead)) return propose("O'zim yozmadim: bu mijozga hozir yozib bo'lmaydi");

  const startedAt = new Date().toISOString();
  // Holat darhol «sent»: CRM'ga yozilayotgan qabul boshqa yo'l bilan (vaqti kelgan javob sifatida) ketib qolmaydi va chegaralarda hisobga kiradi
  const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text, status: 'sent', note: null, dueAt: null, booking });
  try {
    linkBooked(biz, lead, await bookForCustomer(biz, booking));
  } catch (e) {
    replies.move(biz.id, r.id, ['sent'], 'dismissed');
    // CRM javob bermagan bo'lsa natija noma'lum — «yozilmadi» deb aytilmaydi (sababning o'zida yozilgan)
    return hold((e as Error).message, 'Qabul tasdiqlanmadi');
  }
  replies.setBooked(biz.id, r.id);
  const line = `📅 Qabulga yozdim: ${esc(bookingLine(booking))}`;
  try {
    const ch = await sendToLead(biz, lead, text, 'palantir');
    await owner?.notify(biz, `🤖 <b>${who(lead)}</b> · ${CHANNEL_LABEL[ch]}\n${line}\n<i>${esc(cut(text, 1500))}</i>`).catch(() => {});
  } catch (e) {
    // Qabul CRM'da bor, lekin bemor bilmaydi — egasi o'zi aytishi kerak
    await owner?.notify(biz, `⚠️ <b>${who(lead)}</b>\n${line}\nLekin bemorga xabar yetmadi (${esc((e as Error).message)}) — o'zingiz ayting.`).catch(() => {});
  }
  await forwardMissed(biz, lead, startedAt);
}

/** Bitta suhbatdan bir kunda o'zi ko'chiriladigan/bekor qilinadigan qabullar */
const MAX_CHANGES_PER_LEAD_DAY = 2;

/**
 * Bemor mavjud qabulini ko'chirmoqchi yoki bekor qilmoqchi (DentaCRM, mijoz bemorga bog'langan). Model faqat taklif qiladi:
 * qabul shu bemorniki, yangi vaqt o'sha shifokorda bo'sh — shu yerda tekshiriladi. draft — karta «Ko'chirish va yuborish»;
 * auto — darhol, kuniga cheklov bilan; bo'lmasa — sababi bilan egasiga
 */
async function changeFlow(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], d: Decision, mode: AutoReply['mode']): Promise<void> {
  const want = d.change!;
  const hold = async (why: string) => {
    const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text: HOLD_TEXT, status: 'pending', dueAt: null, note: `Qabul o'zgartirilmadi: ${why}` });
    await card(biz, lead, fresh, r);
  };
  if (!lead.patientId) return hold("mijoz DentaCRM bemoriga bog'lanmagan");
  const ready = await checkChange(biz, lead.patientId, want);
  // Bemor bu orada yana yozgan bo'lsa — navbatdagi ishlov hammasini birga ko'radi
  if (inbox.last(biz.id, lead.id)?.id !== fresh.at(-1)?.id) return;
  if ('problem' in ready) return hold(ready.problem);
  const change = ready.change;
  // Tasdiqdagi yangi vaqt model matnidan emas, CRM'ga yoziladigan o'zgarishning o'zidan
  const text = `${d.reply}\n${change.kind === 'move' ? `📅 ${change.date} ${change.time}, ${change.doctorName}` : `✖️ ${change.from} — bekor qilindi`}`.trim();
  const propose = async (note: string | null) => {
    const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text, status: 'pending', note, dueAt: null, change });
    await card(biz, lead, fresh, r);
  };
  if (!isClean(biz, text)) return propose("Javob taklifida reklama filtriga tushadigan so'z bor — tekshirib yuboring");
  if (change.kind === 'move' && (d.reply.match(CLOCK_RE) ?? []).some(t => t.replace('.', ':').padStart(5, '0') !== change.time)) return propose('Javob matnidagi vaqt yangi vaqtdan boshqa — matnni tekshiring');
  if (mode !== 'auto') return propose(null);
  if (replies.changes(biz.id, lead.id, new Date(Date.now() - DAY_MS).toISOString()) >= MAX_CHANGES_PER_LEAD_DAY) return propose(`O'zim o'zgartirmadim: bu suhbatda bir kunda ${MAX_CHANGES_PER_LEAD_DAY} marta o'zgartirildi — chegara`);
  if (!canReach(biz, lead)) return propose("O'zim o'zgartirmadim: bu mijozga hozir yozib bo'lmaydi");
  const startedAt = new Date().toISOString();
  const r = replies.create(biz.id, { leadId: lead.id, channel: lead.channel, text, status: 'sent', note: null, dueAt: null, change });
  try {
    await changeVisit(biz, lead.patientId, change);
  } catch (e) {
    replies.move(biz.id, r.id, ['sent'], 'dismissed');
    return hold((e as Error).message);
  }
  replies.setChanged(biz.id, r.id);
  const line = `🔁 ${change.kind === 'move' ? "Qabulni ko'chirdim" : 'Qabulni bekor qildim'}: ${esc(changeLine(change))}`;
  try {
    const ch = await sendToLead(biz, lead, text, 'palantir');
    await owner?.notify(biz, `🤖 <b>${who(lead)}</b> · ${CHANNEL_LABEL[ch]}\n${line}\n<i>${esc(cut(text, 1500))}</i>`).catch(() => {});
  } catch (e) {
    await owner?.notify(biz, `⚠️ <b>${who(lead)}</b>\n${line}\nLekin bemorga xabar yetmadi (${esc((e as Error).message)}) — o'zingiz ayting.`).catch(() => {});
  }
  await forwardMissed(biz, lead, startedAt);
}

/**
 * Server qabul CRM'ga yozilayotgan paytda to'xtagan bo'lsa, natija noma'lum qoladi: bemorga javob ketmagan, egasi bilmaydi.
 * Ishga tushganda bir marta: bunday qabullar egasiga aytiladi va yopiladi (qayta yozishni egasi hal qiladi).
 */
export function recoverBookings(): void {
  for (const r of replies.unfinished()) {
    replies.move(r.businessId, r.id, ['sent'], 'dismissed');
    const biz = businesses.byId(r.businessId);
    if (!biz || !r.booking) continue;
    const lead = leads.get(biz.id, r.leadId);
    // Tarmoqqa chiqilmaydi (server hali ko'tarilyapti, internet bo'lmasligi mumkin): xabar navbatga yoziladi va bot ulangach ketadi
    notices.add(biz.id, [
      `⚠️ <b>${lead ? who(lead) : 'Mijoz'}</b>`,
      `Qabul yozilayotgan paytda Palantir to'xtab qolgan: ${esc(bookingLine(r.booking))}`,
      "CRM'da tekshiring: yozilgan bo'lsa — bemorga o'zingiz ayting, yozilmagan bo'lsa — qayta yozing.",
    ].join('\n'));
  }
}

// ─── Egasiga kartalar ─────────────────────────────────────────────────────────

const REPLY_HINT = "<i>↩️ O'zingiz yozmoqchi bo'lsangiz — shu xabarga «Reply» qiling.</i>";
// Karta Telegram chegarasiga (4096 belgi) sig'ishi shart: sig'masa egasi taklifni umuman ko'rmaydi
const quotes = (fresh: InboxMessage[]) => fresh.slice(-5).map(m => `«${esc(cut(m.text, 400))}»`).join('\n');

async function forward(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], note: string | null): Promise<void> {
  if (!owner || !fresh.length) return;
  const body = [`💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`, quotes(fresh), note ? `\nℹ️ ${esc(note)}` : ''];
  let sentTo: { chatId: string; messageId: number }[];
  try {
    // Qabulxona xodimlari (bo'lsa) va egasi: kim birinchi ko'rsa — kartaga «Reply» qilib javob beradi
    sentTo = await deliverToTeam(biz, [...body, '', REPLY_HINT].join('\n'));
  } catch (e) {
    // Telegram hozir javob bermadi: mijozning xabari egasiga yetmay qolmasin — navbatga (javobni panelda beradi)
    console.error('[mijozlar] egasiga yetkazilmadi, navbatga qo\'yildi:', (e as Error).message);
    notices.add(biz.id, [...body, '', '<i>Javob berish: panel → Mijozlar.</i>'].join('\n'));
    return;
  }
  for (const c of sentTo) relays.add(c.chatId, c.messageId, lead.id);
}

const replyKeyboard = (r: ReplyRow) => Markup.inlineKeyboard([[
  Markup.button.callback(r.booking ? '✅ Yozish va yuborish' : r.change ? (r.change.kind === 'move' ? "✅ Ko'chirish va yuborish" : '✅ Bekor qilish va yuborish') : '✅ Yuborish', `ra|${r.id}`),
  Markup.button.callback('✖️ Kerak emas', `rx|${r.id}`),
]]).reply_markup;

async function card(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], r: ReplyRow): Promise<void> {
  if (!owner) return;
  const html = [
    `💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`,
    quotes(fresh),
    '',
    r.booking ? `📅 <b>Qabulga yozadi:</b> ${esc(bookingLine(r.booking))}\n` : '',
    r.change ? `🔁 <b>${r.change.kind === 'move' ? "Qabulni ko'chiradi" : 'Qabulni bekor qiladi'}:</b> ${esc(changeLine(r.change))}\n` : '',
    `✍️ <b>Javob taklifi:</b>\n<i>${esc(cut(r.text, 1300))}</i>`,
    r.note ? `ℹ️ ${esc(cut(r.note, 500))}` : '',
    '',
    REPLY_HINT,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  let sentTo: { chatId: string; messageId: number }[];
  try {
    sentTo = await deliverToTeam(biz, html, replyKeyboard(r));
  } catch (e) {
    // Karta ketmadi: taklif panelda turibdi — egasi buni bilishi uchun qisqa xabar navbatga qo'yiladi
    console.error('[mijozlar] karta ketmadi, navbatga qo\'yildi:', (e as Error).message);
    notices.add(biz.id, [`💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`, quotes(fresh), '', '<i>Javob taklifi tayyor — tasdiqlash: panel → Mijozlar.</i>'].join('\n'));
    return;
  }
  for (const c of sentTo) {
    replyCards.add(r.id, c.chatId, c.messageId);
    relays.add(c.chatId, c.messageId, lead.id);
    if (c.chatId === biz.ownerChatId) replies.setOwnerMessage(biz.id, r.id, c.messageId);
  }
}

/** Karta natijasi bilan yangilanadi (tugmalar olib tashlanadi) */
async function settleCard(biz: BusinessRow, r: ReplyRow, status: string): Promise<void> {
  const lead = leads.get(biz.id, r.leadId);
  const html = `💬 <b>${lead ? who(lead) : 'Mijoz'}</b> · ${CHANNEL_LABEL[r.channel]}\n✍️ <i>${esc(cut(r.text, 1500))}</i>\n\n${status}`;
  const cards = replyCards.of(r.id);
  if (cards.length) return editTeamCards(cards, html);
  // Eski karta (jamoa kartalaridan oldin yuborilgan) — faqat egasida
  if (owner && r.ownerMessageId) await owner.edit(biz, r.ownerMessageId, html).catch(() => {});
}

/** Mijoz yana yozdi yoki egasi o'zi javob berdi — oldingi takliflar eskirdi */
async function supersede(biz: BusinessRow, lead: LeadRow, why: string, keepBookings = false): Promise<void> {
  for (const r of replies.open(biz.id, lead.id)) {
    if (keepBookings && r.booking) continue;
    if (replies.move(biz.id, r.id, ['pending', 'scheduled'], 'obsolete')) await settleCard(biz, r, `↪️ ${why}`);
  }
}

// ─── Javobni yuborish ─────────────────────────────────────────────────────────

/** "O'zi javob bersin": vaqti kelgan javob (egasi bu orada yozmagan bo'lsa) */
async function flush(r: ReplyRow): Promise<void> {
  const biz = businesses.byId(r.businessId);
  const lead = biz && leads.get(biz.id, r.leadId);
  if (!biz || !lead) return;
  if (!replies.move(biz.id, r.id, ['scheduled'], 'sent')) return;
  try {
    const ch = await sendToLead(biz, lead, r.text, 'palantir');
    // Egasiga xabar yetmasa ham javob yuborilgan hisoblanadi (aks holda qayta yuborilardi)
    await owner?.notify(biz, `🤖 <b>${who(lead)}</b> · ${CHANNEL_LABEL[ch]} — javob berdim:\n<i>${esc(cut(r.text, 1500))}</i>`).catch(() => {});
  } catch (e) {
    replies.move(biz.id, r.id, ['sent'], 'pending');
    const fresh = unanswered(inbox.thread(biz.id, lead.id, 30));
    await card(biz, lead, fresh, { ...r, status: 'pending', note: `Yuborilmadi: ${(e as Error).message}` });
  }
}

export async function flushDue(): Promise<void> {
  for (const r of replies.due(new Date().toISOString())) await flush(r).catch(e => console.error('[mijozlar] yuborilmadi:', (e as Error).message));
}

/** Egasi «Yuborish» ni bosdi (Telegram yoki panel) */
export async function approveReply(biz: BusinessRow, id: string): Promise<void> {
  const r = replies.get(biz.id, id);
  if (!r) throw new Error('Topilmadi');
  if (r.status !== 'pending') throw new Error(r.status === 'sent' ? 'Allaqachon yuborilgan' : 'Bu taklif eskirgan');
  const lead = leads.get(biz.id, r.leadId);
  if (!lead) throw new Error('Mijoz topilmadi');
  // Klinika: avval qabul CRM'ga yoziladi (bo'lmasa bemorga «yozdik» ketmaydi)
  const booking = r.booking && !r.bookedAt ? r.booking : null;
  // Aytib bo'lmaydigan bemorni yozib qo'ymaslik uchun — CRM'ga murojaatdan oldin
  if (booking && !canReach(biz, lead)) throw new Error("Bu mijozga hozir yozib bo'lmaydi — qabul ham yozilmadi");
  const change = r.change && !r.changedAt ? r.change : null;
  if (change && !canReach(biz, lead)) throw new Error("Bu mijozga hozir yozib bo'lmaydi — qabul ham o'zgartirilmadi");
  if (change && !lead.patientId) throw new Error("Mijoz DentaCRM bemoriga bog'lanmagan — qabulni CRM'da o'zingiz o'zgartiring");
  if (!replies.move(biz.id, id, ['pending'], 'sent')) throw new Error('Allaqachon yuborilgan');
  const startedAt = new Date().toISOString();
  if (booking) {
    try {
      linkBooked(biz, lead, await bookForCustomer(biz, booking));
    } catch (e) {
      replies.move(biz.id, id, ['sent'], 'pending');
      throw e;
    }
    replies.setBooked(biz.id, id);
  }
  if (change) {
    try {
      await changeVisit(biz, lead.patientId!, change);
    } catch (e) {
      replies.move(biz.id, id, ['sent'], 'pending');
      throw e;
    }
    replies.setChanged(biz.id, id);
  }
  try {
    await sendToLead(biz, lead, r.text, 'palantir');
  } catch (e) {
    if (!r.booking && !r.change) {
      replies.move(biz.id, id, ['sent'], 'pending');
      throw e;
    }
    // Qabul CRM'da yozilgan yoki o'zgartirilgan: taklif qayta ochilmaydi (ikkinchi marta bajarilmasin) — bemorga egasi o'zi aytadi
    const done = r.booking ? "Qabul CRM'ga yozildi" : "Qabul CRM'da o'zgartirildi";
    const why = `${done}, lekin bemorga xabar yetmadi (${(e as Error).message}) — o'zingiz ayting`;
    await settleCard(biz, r, `⚠️ ${esc(why)}\n${r.booking ? `📅 ${esc(bookingLine(r.booking))}` : `🔁 ${esc(changeLine(r.change!))}`}`);
    throw new Error(why);
  }
  await settleCard(biz, r, r.booking ? `✅ Qabulga yozildi va yuborildi\n📅 ${esc(bookingLine(r.booking))}`
    : r.change ? `✅ ${r.change.kind === 'move' ? "Ko'chirildi" : 'Bekor qilindi'} va yuborildi\n🔁 ${esc(changeLine(r.change))}` : '✅ Yuborildi');
  if (booking || change) await forwardMissed(biz, lead, startedAt);
}

export async function dismissReply(biz: BusinessRow, id: string): Promise<void> {
  const r = replies.get(biz.id, id);
  if (!r) throw new Error('Topilmadi');
  if (!replies.move(biz.id, id, ['pending', 'scheduled'], 'dismissed')) throw new Error('Bu taklif allaqachon hal qilingan');
  await settleCard(biz, r, '✖️ Yuborilmadi');
}

/**
 * Egasi mijozga o'zi yozdi (kartaga «Reply» yoki panel orqali). draftId — egasi shu tayyor javob o'rniga yozgan bo'lsa:
 * farqi «tuzatish» bo'lib saqlanadi (faqat aniq ko'rsatilganda — telefonda yozilgan har gap tuzatish emas).
 */
export async function ownerWrites(biz: BusinessRow, lead: LeadRow, text: string, draftId?: string): Promise<LeadChannel> {
  const draft = draftId ? replies.get(biz.id, draftId) : undefined;
  const ch = await sendToLead(biz, lead, text, 'owner');
  // So'ralgan savolga javob — bilim taklifi; oddiy tayyor javob o'rniga yozilgani — tuzatish
  if (draft && draft.leadId === lead.id && draft.status === 'pending' && !draft.question && !draft.booking && !draft.change && draft.text !== HOLD_TEXT) recordFix(biz, draft.text, text);
  ownerAnswered(biz, lead, text, (html, keyboard) => notifyOwner(biz, html, keyboard));
  await supersede(biz, lead, "O'zingiz javob berdingiz");
  return ch;
}
