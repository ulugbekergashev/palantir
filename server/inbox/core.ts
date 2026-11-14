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
import { businesses, inbox, leads, relays, replies, type BusinessRow, type ChannelPerson, type LeadRow, type ReplyRow } from '../db';
import { notices, settings as store, waiting } from '../serviceStore';
import { cleanName, normPhone } from '../crm/logic';
import { filterOptions, recordFix } from '../brain/index';
import { ownerAnswered } from '../brain/learn';
import { AiLimitError } from '../claude';
import { SubscriptionError } from '../subscription/engine';
import { bookForCustomer, bookingLine, changeLine, changeVisit, checkBooking, checkChange } from '../crm/reception';
import { env } from '../env';
import { decide, type Decision } from './replier';
import { phoneChanged } from '../people';
import { customerWrote } from '../stages';
import { deliverToTeam, editTeamCards, openRequest, settleByBooking } from '../requests/index';
import { replyCards } from '../requests/store';
import { crewWorks } from '../../src/lib/crew';
import { awaitingReply, holdLine } from './hold';
import { isMedia } from './media';
import { splitForInstagram } from './igRules';

export interface Sender {
  /** Shu mijozga shu kanal orqali yozish mumkinmi */
  can(biz: BusinessRow, lead: LeadRow): boolean;
  /**
   * Yuboradi; qaytaradi — kanal bergan xabar id'si (qayta kelsa tanib olish uchun). by — kim yozgan: egasi (odam) yoki Palantir
   * (AI javobi, ommaviy xabar). Instagram 24 soatdan keyin faqat odam yozganiga ruxsat beradi (HUMAN_AGENT)
   */
  send(biz: BusinessRow, lead: LeadRow, text: string, by: 'owner' | 'palantir'): Promise<string | null>;
}

/** Egasiga Telegram orqali xabar (bot) */
export interface OwnerOutlet {
  notify(biz: BusinessRow, html: string, keyboard?: InlineKeyboardMarkup): Promise<number | null>;
  /** keyboard berilmasa — tugmalar olib tashlanadi */
  edit(biz: BusinessRow, messageId: number, html: string, keyboard?: InlineKeyboardMarkup): Promise<void>;
  /** Kompyuterdagi fayl (hujjat sifatida) */
  sendFile(biz: BusinessRow, path: string, caption: string): Promise<void>;
  /** Rasm (kompyuterdagi fayl yoki xotiradagi JPEG — kamera kadri) izoh (HTML, ~1000 belgigacha) va tugmalar bilan */
  sendPhoto(biz: BusinessRow, photo: string | Buffer, html: string, keyboard?: InlineKeyboardMarkup): Promise<number | null>;
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
export const notifyOwnerPhoto = (biz: BusinessRow, photo: string | Buffer, html: string, keyboard?: InlineKeyboardMarkup) => owner?.sendPhoto(biz, photo, html, keyboard) ?? Promise.resolve(null);

export const DEFAULT_REPLY: AutoReply = { mode: 'draft', contacts: false, delayMin: 2 };
/** Qabulxona jamoadan olib tashlangan bo'lsa — javob tayyorlanmaydi (xabarlar saqlanaveradi) */
export const replySettings = (biz: BusinessRow): AutoReply => {
  const s = { ...DEFAULT_REPLY, ...biz.profile.autoReply };
  return crewWorks(biz, 'qabulxona') ? s : { ...s, mode: 'off' };
};

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
      // Instagram uzun javobni bo'laklab yuboradi va har bo'lak alohida aks-sado bo'lib qaytadi — ular ham «bizniki»: aks holda
      // bo'laklar «egasi o'zi yozdi» bo'lib, AI shu mijozga 2 soat javob tayyorlamay qo'yardi (E11)
      if (ch === 'instagram') for (const part of splitForInstagram(text)) ours.set(ourKey(biz.id, ch, part), Date.now());
      const extId = await s.send(biz, lead, text, by);
      inbox.add(biz.id, { leadId: lead.id, channel: ch, direction: 'out', by, text, extId });
      // Bazadagi hozirgi bosqich: shu orada qabul yozilgan bo'lsa (linkBooked — «Mijoz bo'ldi»), eski nusxa uni ustidan yozmasin
      if (leads.get(biz.id, lead.id)?.stage === 'new') leads.update(biz.id, lead.id, { stage: 'contacted' });
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
  /** Kanaldagi asl vaqti (ISO), bilinsa — eski xabarlarni ajratish uchun */
  at?: string;
}

const timers = new Map<string, NodeJS.Timeout>();
/** Shundan eski mijoz xabariga AI javobni o'zi yubormaydi */
const STALE_MS = 12 * 3_600_000;

/** Bitta suhbat uchun bir kunda tayyorlanadigan javoblar soni */
const MAX_AI_PER_LEAD_DAY = 40;
const leadAi = new Map<string, { day: string; count: number }>();
function leadAiAllowed(leadId: string): boolean {
  const today = iso(new Date());
  // Kun almashganda eski hisoblar tashlanadi (xarita o'smaydi)
  if (leadAi.size > 5000) for (const [k, v] of leadAi) if (v.day !== today) leadAi.delete(k);
  const used = leadAi.get(leadId)?.day === today ? leadAi.get(leadId)!.count : 0;
  if (used >= MAX_AI_PER_LEAD_DAY) return false;
  leadAi.set(leadId, { day: today, count: used + 1 });
  return true;
}

/**
 * Xabarning asl vaqti (kanal bergan): kompyuter o'chiq turganda kelgan xabar «hozir» deb yozilmasin — model kechagi «bugun»ni
 * ertangi kun deb tushunmasin (E4), eski xabarga javob esa faqat taklif bo'lsin (handle: stale). Yangi xabar (bir daqiqadan
 * yaqin) — hozirgi vaqt: Telegram vaqtni butun soniyagacha beradi, aks holda yarim soniya oldin yuborgan javobimiz yozishmada
 * bemorning yangi xabaridan keyin turib qolardi va u «javob berilgan» bo'lib, ishlanmay qolardi. Kelajakdagi vaqt — ham hozirgi
 */
const REAL_AT_MIN_AGE_MS = 60_000;
function realAt(at: string | undefined): string | undefined {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && Date.now() - t > REAL_AT_MIN_AGE_MS ? new Date(t).toISOString() : undefined;
}

export function onIncoming(biz: BusinessRow, m: Incoming): LeadRow {
  const { lead } = leads.fromChannel(biz.id, m.channel, m.person, m.source);
  const saved = inbox.add(biz.id, { leadId: lead.id, channel: m.channel, direction: 'in', by: 'customer', text: m.text, extId: m.extId, at: realAt(m.at) });
  if (!saved) return lead;
  // Botdagi rasm/stiker: asl nusxasi egasida, bemorga «yetkazildi» deyilgan (bot.ts), AI uni ko'rmaydi — yangi ishlov boshlanmaydi
  if (!botMedia(saved)) schedule(biz.id, lead.id);
  // «Yo'qotildi»dagi mijoz yana yozdi — faol ro'yxatga qaytadi (G3); «boshqa yozmang» — belgi va «Yo'qotildi» (E10)
  return customerWrote(biz, lead, m.text);
}

/** Egasi o'zi yozdi (telefonidagi Telegram yoki Instagram'dan); at — asl vaqti (uzilishdan keyin kelganda tartib buzilmasin) */
export function onOwnerOutgoing(biz: BusinessRow, channel: 'telegram' | 'instagram', peer: { tgUserId?: string; igUserId?: string }, text: string, extId: string | null, at?: string): void {
  const lead = peer.igUserId ? leads.byInstagram(biz.id, peer.igUserId) : peer.tgUserId ? leads.byTelegram(biz.id, peer.tgUserId) : undefined;
  // Mijoz bo'lmagan odam bilan yozishma (shaxsiy suhbat) — yozib olinmaydi
  if (!lead) return;
  if ((extId && inbox.has(biz.id, channel, extId)) || isOurEcho(biz.id, channel, text)) return;
  inbox.add(biz.id, { leadId: lead.id, channel, direction: 'out', by: 'owner', text, extId, at: realAt(at) });
  ownerAnswered(biz, lead, text, (html, keyboard) => notifyOwner(biz, html, keyboard));
  void supersede(biz, lead, "O'zingiz javob berdingiz").catch(e => console.error('[mijozlar] karta:', (e as Error).message));
}

/**
 * Ishlanishi kutilayotgan suhbatlar bazada ham turadi: taymer xotirada, dastur shu orada qayta ishga tushsa (yangilanish, o'chib-yonish)
 * mijozning xabari javobsiz yo'qolmasin — resumeUnanswered qaytadan ishlaydi
 */
const PENDING = 'inbox:pending';
const pendingKeys = (): string[] => {
  try { return JSON.parse(store.all().find(r => r.name === PENDING)?.value ?? '[]') as string[]; } catch { return []; }
};
function markPending(key: string, on: boolean): void {
  const all = new Set(pendingKeys());
  if (on === all.has(key)) return;
  if (on) all.add(key); else all.delete(key);
  store.set(PENDING, JSON.stringify([...all].slice(-500)));
}

function schedule(bizId: string, leadId: string): void {
  const key = `${bizId}:${leadId}`;
  clearTimeout(timers.get(key));
  markPending(key, true);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    handle(bizId, leadId)
      .catch(e => console.error('[mijozlar]', (e as Error).message))
      // Ishlov paytida yana xabar kelgan bo'lsa — yangi taymer bor, belgi qoladi
      .finally(() => { if (!timers.has(key)) markPending(key, false); });
  }, env.inboxDebounceMs));
}

/** Dastur ishga tushganda: oldingi safar ishlanmay qolgan suhbatlar qaytadan navbatga (6 soatdan eski xabarga AI endi javob bermaydi) */
export function resumeUnanswered(maxAgeMs = 6 * 3_600_000): number {
  let n = 0;
  for (const key of pendingKeys()) {
    const [bizId, leadId] = key.split(':');
    const last = bizId && leadId ? inbox.last(bizId, leadId) : undefined;
    const fresh = last?.direction === 'in' && Date.now() - Date.parse(last.createdAt) < maxAgeMs && !replies.open(bizId, leadId).length;
    if (fresh) { schedule(bizId, leadId); n++; } else markPending(key, false);
  }
  return n;
}

/** Botdagi matnsiz xabar (rasm, stiker…): asl nusxasi egasida — javob kutmaydi va ishlovni to'xtatmaydi */
const botMedia = (m: InboxMessage): boolean => m.channel === 'bot' && isMedia(m);

/**
 * Shu xabardan keyin suhbatda yangi narsa bormi (bemor yana yozdi yoki egasi javob berdi) — bo'lsa, tayyorlangan javob eskirgan:
 * navbatdagi ishlov hammasini birga ko'radi. Botdagi rasm/stiker sanalmaydi — uning ishlovi yo'q (aks holda AI o'ylayotganda
 * kelgan rasm tayyor javobni jim tashlab yuborardi — E3)
 */
function newerThan(bizId: string, leadId: string, msgId: string): boolean {
  const thread = inbox.thread(bizId, leadId, 30);
  const i = thread.findIndex(m => m.id === msgId);
  return i < 0 || thread.slice(i + 1).some(m => !botMedia(m));
}

/** Oxirgi javobimizdan keyingi mijoz xabarlari */
const unanswered = (thread: InboxMessage[]) => {
  const i = thread.map(m => m.direction).lastIndexOf('out');
  return thread.slice(i + 1);
};

/** AI javob tayyorlay olmadi: xodimga sababi (obuna limiti yoki kirilmagani — kutish yoki qayta kirish kerakligini bilsin) */
export function whyNoReply(e: unknown): string {
  if (e instanceof AiLimitError) return "Bugungi AI chegarasi tugadi — bu xabarga o'zingiz javob bering";
  if (e instanceof SubscriptionError && e.reason === 'limit') return "Claude obunasining limiti tugadi — limit yangilanguncha o'zingiz javob bering";
  if (e instanceof SubscriptionError && e.reason === 'auth') return "Claude obunasiga kirilmagan — Palantir javob tayyorlay olmadi, o'zingiz javob bering";
  return "Palantir javob tayyorlay olmadi — o'zingiz javob bering";
}

/** «O'zi javob bersin»da AI javob bermagan bemorga «yetkazildi» — shu suhbatga ko'pi bilan shuncha vaqtda bir marta */
const HOLD_EVERY_MS = 3600_000;
const held = new Map<string, number>();
/** Shoshilinch belgilar (bemor matnida): «yetkazildi» bilan birga 103 eslatiladi */
const URGENT = /qon\s*(ket|to'xta|oqa)|kuchli og'ri|chidab bo'lma|shish(ib|gan|di)|isitma|harorat|nafas|hushdan|кров|сильн\S* бол|не могу терпеть|опух|отек|отёк|температур|задыха/i;
const foldApostrophe = (s: string) => s.replace(/[ʻʼ’‘`´]/g, "'");

/**
 * «O'zi javob bersin» rejimida bemor javobni darhol kutadi: AI javob bermagan bo'lsa (bilmaydi, xato, limit, egasining tasdig'i kerak)
 * bemor jim qolmasin — xodimga yetkazilgani aytiladi (shoshilinch holatda — 103). Boshqa rejimlarda bot o'zi aytadi (bot.ts)
 */
async function holdCustomer(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], mode: AutoReply['mode']): Promise<void> {
  if (mode !== 'auto' || !fresh.length) return;
  // Instagram «so'rovlar» papkasidagi odam: unga yozish so'rovni qabul qiladi — buni egasi hal qilsin
  if (lead.channel === 'instagram' && lead.source?.includes("so'rov")) return;
  if (Date.now() - (held.get(lead.id) ?? 0) < HOLD_EVERY_MS) return;
  held.set(lead.id, Date.now());
  const urgent = fresh.some(m => URGENT.test(foldApostrophe(m.text)));
  const text = [
    holdLine(biz.profile.name),
    'Сообщение передано сотруднику, скоро ответим.',
    ...(urgent ? ['', "⚠️ Holat og'ir bo'lsa (qon to'xtamayapti, yuz shishib ketdi, nafas qiyin) — darhol 103 ga qo'ng'iroq qiling.", 'Если состояние тяжёлое — сразу звоните 103.'] : []),
  ].join('\n');
  await sendToLead(biz, lead, text, 'palantir').catch(e => console.error('[mijozlar] «yetkazildi» yuborilmadi:', (e as Error).message));
}

async function handle(bizId: string, leadId: string): Promise<void> {
  const biz = businesses.byId(bizId);
  const lead = leads.get(bizId, leadId);
  if (!biz?.active || !lead) return;
  const thread = inbox.thread(bizId, leadId, 30);
  const last = thread.at(-1);
  if (!last || last.direction !== 'in') return;
  const fresh = unanswered(thread);
  // Botda faqat rasm, video, stiker… (dastur qayta yonganda shunday suhbat ham navbatga tushadi): AI javob yozmaydi. Savol bilan
  // birga kelsa — pastda odatdagidek, model «[rasm]» belgisini ko'radi. Boshqa kanallarda asl nusxa egasiga bormaydi — AI qaror qiladi
  if (fresh.every(botMedia)) return;
  const settings = replySettings(biz);
  // Egasi shu suhbatga yaqinda o'zi yozgan — u gaplashayotgan joyga AI aralashmaydi: javob faqat taklif bo'lib egasiga boradi
  const ownerTalking = thread.some(m => m.by === 'owner' && Date.now() - Date.parse(m.createdAt) < env.humanPauseMin * env.minuteMs);
  // Eski xabar (kompyuter o'chiq turgan, Instagram keyin berdi): vaziyat o'zgargan bo'lishi mumkin — javob ham faqat taklif
  const stale = Date.now() - Date.parse(last.createdAt) > STALE_MS;
  const mode = settings.mode === 'auto' && (ownerTalking || stale) ? 'draft' : settings.mode;
  // Qabul taklifi (klinika) hozircha qoladi: bemor shunchaki «rahmat» desa, egasidagi karta bekor bo'lmasin
  await supersede(biz, lead, 'Yangi xabar keldi — pastda yangi taklif', true);

  if (settings.mode === 'off' || !env.aiEnabled) {
    // Bot suhbatini egasi boshqa joyda ko'rmaydi — shunchaki yetkaziladi
    // AI o'chiq: bot suhbatiga faqat odam javob beradi — egasining javobi kerak
    if (lead.channel === 'bot') await forward(biz, lead, fresh, null, true);
    return;
  }
  // Bitta suhbat butun biznesning kunlik AI hisobini yeb qo'ymasin (spam yoki bot bilan «o'ynash»): chegaradan keyin xabar egasiga AI'siz yetkaziladi
  if (!leadAiAllowed(lead.id)) {
    await forward(biz, lead, fresh, `Bu suhbatda bugun ${MAX_AI_PER_LEAD_DAY} ta javob tayyorlandi — chegara. Javobni o'zingiz bering`);
    await holdCustomer(biz, lead, fresh, mode);
    return;
  }
  let d: Decision;
  try {
    d = await decide(biz, lead, thread);
  } catch (e) {
    console.error('[mijozlar] javob tayyorlanmadi:', (e as Error).message);
    await forward(biz, lead, fresh, whyNoReply(e));
    await holdCustomer(biz, lead, fresh, mode);
    return;
  }
  // Claude o'ylayotganda yana yozgan bo'lsa — navbatdagi ishlov hammasini birga ko'radi (botdagi rasm — javobni to'xtatmaydi)
  if (newerThan(bizId, leadId, last.id)) return;
  remember(biz, lead, d);
  // Mijoz xodimdan ish kutyapti (qo'ng'iroq qilish, qabul, shikoyat): so'rov qabulxonaga — javobning taqdiridan qat'i nazar
  if (d.request) {
    await openRequest(biz, lead.id, { ...d.request, source: lead.channel, quote: fresh.map(m => m.text).join(' / ') })
      .catch(e => console.error("[mijozlar] so'rov ochilmadi:", (e as Error).message));
  }
  // Yangi javob yoki yangi qabul taklifi bo'lsa — eski qabul taklifi ham eskiradi
  if (d.action !== 'ignore') await supersede(biz, lead, 'Yangi xabar keldi — pastda yangi taklif');

  // Qabul oqimi bemorga yozmagan bo'lsa (egasining tasdig'iga ketdi, CRM rad etdi, xato) — suhbatning oxiri hali o'sha kiruvchi xabar
  const holdIfSilent = () => (newerThan(bizId, leadId, last.id) ? Promise.resolve() : holdCustomer(biz, lead, fresh, mode));
  if (d.action === 'book' && d.booking) {
    try {
      await receive(biz, lead, fresh, d, mode);
    } catch (e) {
      // Kutilmagan xato (masalan, Telegram kartani qabul qilmadi): bemorning xabari javobsiz yo'qolmasin
      console.error('[mijozlar] qabul:', (e as Error).message);
      await forward(biz, lead, fresh, "Palantir qabulni oxiriga yetkaza olmadi — CRM'ni tekshirib, o'zingiz javob bering");
    }
    return holdIfSilent();
  }
  if ((d.action === 'reschedule' || d.action === 'cancel_visit') && d.change) {
    try {
      await changeFlow(biz, lead, fresh, d, mode);
    } catch (e) {
      console.error("[mijozlar] qabulni o'zgartirish:", (e as Error).message);
      await forward(biz, lead, fresh, "Palantir qabulni o'zgartira olmadi — CRM'ni tekshirib, o'zingiz javob bering");
    }
    return holdIfSilent();
  }
  if (d.action === 'ignore' || !d.reply) {
    // Javob matni yo'q, lekin egasiga aytadigan gap bor (model javob yozishdan bosh tortdi) — hamma kanalda yetkaziladi, xabar javobsiz yo'qolmasin
    if (d.action !== 'ignore' && d.noteForOwner) await forward(biz, lead, fresh, d.noteForOwner);
    else if (lead.channel === 'bot') await forward(biz, lead, fresh, null);
    // «rahmat», «ok» kabi javob kerak bo'lmagan xabar — bemorga ham hech narsa yozilmaydi
    if (d.action !== 'ignore') await holdCustomer(biz, lead, fresh, mode);
    return;
  }
  const clean = isClean(biz, d.reply);
  if (mode === 'auto' && d.action === 'reply' && clean) {
    // Botda egasi suhbatda yo'q — darhol; shaxsiy chatda egasiga o'zi javob berishga vaqt
    const delay = lead.channel === 'bot' ? 0 : settings.delayMin * env.minuteMs;
    const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'scheduled', note: null, dueAt: new Date(Date.now() + delay).toISOString() });
    if (!delay) await flush(r);
    return;
  }
  const note = !clean ? "Javob taklifida reklama filtriga tushadigan so'z bor — tekshirib yuboring" : d.noteForOwner || null;
  const r = replies.create(bizId, { leadId, channel: lead.channel, text: d.reply, status: 'pending', note, dueAt: null, question: d.action === 'ask_owner' ? d.question : null });
  await card(biz, lead, fresh, r);
  // Javob egasining tasdig'ini kutadi (bilmagan narsasi, filtrga tushgan so'z) — bemorga hozircha «yetkazildi»
  await holdCustomer(biz, lead, fresh, mode);
}

/** Qabul yozilgan bemor — mijoz kartasi unga bog'lanadi (oldin boshqa bemorga bog'langan bo'lsa — tegilmaydi) */
/**
 * Qabul CRM'ga yozildi: karta bemorga bog'lanadi va «Mijoz bo'ldi» bosqichiga o'tadi (keyingi qadam o'chadi). Aks holda bemor
 * faol ro'yxatda qolib, ertasi «💤 Unutilgan»ga tushardi va unga «qayta yozish» xabari tayyorlanardi (plan.ts)
 */
function linkBooked(biz: BusinessRow, lead: LeadRow, patientId: string): void {
  if (!leads.get(biz.id, lead.id)?.patientId) leads.setPatient(biz.id, lead.id, patientId);
  leads.update(biz.id, lead.id, { stage: 'won' });
  // Shu bemorning qabulni kutayotgan so'rovlari (yozilish, qayta qo'ng'iroq) maqsadiga yetdi — o'zi yopiladi (G1)
  void settleByBooking(biz, lead.id, "Qabulga yozildi (yozishmada)").catch(e => console.error("[so'rov] yopilmadi:", (e as Error).message));
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
  // Raqam aytildi (tasdiqlanmagan) — shu raqamdagi qo'ng'iroq va qo'lda qo'shilgan kartalar yig'iladi; boshqa Telegram/Instagram odamining
  // kartasi emas (E6: xato yoki birovning raqami ikki odamni qaytarib bo'lmaydigan qilib qo'shardi). Bot tugmasi bilan yuborilgan raqam — bot.ts
  if (patch.phone) phoneChanged(biz, lead.id, 'chat');
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
  if (newerThan(biz.id, lead.id, fresh.at(-1)!.id)) return;
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
  if (newerThan(biz.id, lead.id, fresh.at(-1)!.id)) return;
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

/**
 * Mijoz xabari jamoaga (xodimlar va egasi). waitAnswer — egasining javobi kerak (AI javob bermadi): panelda «Sizni kutyapti»da turadi
 * (attention.ts) — Telegram ulanmagan bo'lsa ham bemor yo'qolmasin. Hech kimga yetmasa — navbatga: egasi ulanganda yetkaziladi
 */
async function forward(biz: BusinessRow, lead: LeadRow, fresh: InboxMessage[], note: string | null, waitAnswer = note !== null): Promise<void> {
  if (!fresh.length) return;
  if (waitAnswer) waiting.mark(biz.id, lead.id, note);
  if (!owner) return;
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
  // Hech kimga yetmadi (egasi botga hali ulanmagan, xodim yo'q): navbatda kutadi — egasi ulanganda yuboriladi (scheduler.ts)
  if (!sentTo.length) {
    if (waitAnswer) notices.add(biz.id, [...body, '', '<i>Javob berish: panel → Mijozlar.</i>'].join('\n'));
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
  // Har karta yuborilishi bilan ro'yxatga: xodim kartaga darhol «Reply» qilsa yoki bossa — u topiladi
  const register = (c: { chatId: string; messageId: number }) => {
    replyCards.add(r.id, c.chatId, c.messageId);
    relays.add(c.chatId, c.messageId, lead.id);
    if (c.chatId === biz.ownerChatId) replies.setOwnerMessage(biz.id, r.id, c.messageId);
  };
  try {
    await deliverToTeam(biz, html, replyKeyboard(r), register);
  } catch (e) {
    // Karta ketmadi: taklif panelda turibdi — egasi buni bilishi uchun qisqa xabar navbatga qo'yiladi
    console.error('[mijozlar] karta ketmadi, navbatga qo\'yildi:', (e as Error).message);
    notices.add(biz.id, [`💬 <b>${who(lead)}</b> · ${CHANNEL_LABEL[lead.channel]}`, quotes(fresh), '', '<i>Javob taklifi tayyor — tasdiqlash: panel → Mijozlar.</i>'].join('\n'));
    return;
  }
  // Kartalar ketayotgan paytda taklif hal bo'lgan (xodim yubordi yoki o'zi javob berdi) — kechikkan kartalar ham yopilsin
  const now = replies.get(biz.id, r.id);
  if (now && now.status !== 'pending' && now.status !== 'scheduled') await settleCard(biz, now, SETTLED[now.status] ?? '↪️ Hal qilindi');
}

/** Kartalar yuborilayotganda hal bo'lgan taklif: kechikkan kartaga qisqa holat (to'liq matni boshqa kartalarda) */
const SETTLED: Partial<Record<ReplyRow['status'], string>> = { sent: '✅ Yuborildi', obsolete: '↪️ Eskirdi', dismissed: '✖️ Yuborilmadi' };

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

/** Vaqtidan shuncha daqiqa kechikkan avto-javob o'zicha yuborilmaydi — egasiga karta (dastur o'chiq turgan) */
const LATE_REPLY_MIN = 15;

/** "O'zi javob bersin": vaqti kelgan javob (egasi bu orada yozmagan bo'lsa) */
async function flush(r: ReplyRow): Promise<void> {
  const biz = businesses.byId(r.businessId);
  const lead = biz && leads.get(biz.id, r.leadId);
  if (!biz || !lead) return;
  // Javob tayyorlangandan keyin bemor yana yozgan: eski javob endi yuborilsa yangi xabar «javob berilgan» bo'lib qolardi va unga hech
  // kim javob bermasdi (E5). Yangi xabarning ishlovi (onIncoming → schedule) hammasiga birga javob tayyorlaydi. Botdagi rasm/stiker
  // bundan mustasno — uning asl nusxasi egasida, javob kerak emas (handle ham unga javob yozmaydi)
  if (inbox.thread(biz.id, lead.id, 30).some(m => m.direction === 'in' && !botMedia(m) && m.createdAt > r.createdAt)) {
    if (replies.move(biz.id, r.id, ['scheduled'], 'obsolete')) await settleCard(biz, r, '↪️ Bemor yana yozdi — yangi javob tayyorlanadi');
    return;
  }
  // Kompyuter o'chiq turgan — javob o'z vaqtida ketmadi: soatlar o'tib o'zicha yuborilmaydi («bugun ochiqmiz» ertasi kuni noto'g'ri), egasi ko'rib yuborsin (E4)
  const late = r.dueAt ? Date.now() - Date.parse(r.dueAt) : 0;
  if (late > LATE_REPLY_MIN * env.minuteMs) {
    if (!replies.move(biz.id, r.id, ['scheduled'], 'pending')) return;
    const fresh = unanswered(inbox.thread(biz.id, lead.id, 30));
    await card(biz, lead, fresh, { ...r, status: 'pending', note: `Kompyuter o'chiq edi — javob ${Math.round(late / env.minuteMs)} daqiqa kechikdi, o'zim yubormadim: tekshirib yuboring` });
    return;
  }
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
  await expireStale().catch(e => console.error('[mijozlar] eski takliflar:', (e as Error).message));
}

/** Egasi shuncha vaqt tasdiqlamagan javob taklifi eskiradi: kunlar o'tib yuborilgan «ha, ertaga ishlaymiz» noto'g'ri bo'ladi */
const REPLY_STALE_MS = 48 * 3_600_000;
/**
 * Eskirgan takliflar: ertalabki «N ta javob tayyor» va «Sizni kutyapti»da sanalmaydi, kartasida «eskirdi» deyiladi. Bemor hali
 * javobsiz bo'lsa — «javob kutyapti» ga o'tadi (yo'qolib ketmaydi)
 */
export async function expireStale(now = Date.now()): Promise<number> {
  let n = 0;
  for (const r of replies.pendingBefore(new Date(now - REPLY_STALE_MS).toISOString())) {
    const biz = businesses.byId(r.businessId);
    if (!biz || !replies.move(biz.id, r.id, ['pending'], 'obsolete')) continue;
    n++;
    await settleCard(biz, r, "⌛ Eskirdi — 2 kun tasdiqlanmadi. Bemorga yozish kerak bo'lsa — o'zingiz yozing");
    // «Yetkazildi» javob emas — bemor hali kutyapti (hold.ts)
    if (awaitingReply(inbox.thread(biz.id, r.leadId, 30))) waiting.mark(biz.id, r.leadId, "Javob taklifi 2 kun tasdiqlanmay eskirdi");
  }
  return n;
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
/**
 * Odam mijozga yozdi (egasi yoki xodim — panel, Telegram kartasiga «Reply»). staff — yozgan xodimning ismi: uning javobi egasiga
 * «Aziza javobi» deb eslab qolishga taklif qilinadi (egasi tasdiqlasa — bilim), AI taklifini tuzatgani esa «egasining tuzatishi»
 * bo'lib mijozlarga javobga tushmaydi
 */
export async function ownerWrites(biz: BusinessRow, lead: LeadRow, text: string, draftId?: string, staff?: string | null): Promise<LeadChannel> {
  const draft = draftId ? replies.get(biz.id, draftId) : undefined;
  const ch = await sendToLead(biz, lead, text, 'owner');
  // So'ralgan savolga javob — bilim taklifi; oddiy tayyor javob o'rniga yozilgani — tuzatish (faqat egasiniki)
  if (!staff && draft && draft.leadId === lead.id && draft.status === 'pending' && !draft.question && !draft.booking && !draft.change && draft.text !== HOLD_TEXT) recordFix(biz, draft.text, text);
  ownerAnswered(biz, lead, text, (html, keyboard) => notifyOwner(biz, html, keyboard), staff ?? null);
  await supersede(biz, lead, staff ? `${staff} javob berdi` : "O'zingiz javob berdingiz");
  return ch;
}
