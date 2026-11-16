/**
 * Kotib — ish bo'yicha yozishmalar (Rahbar kotibi, 2026-11-16). Egasining shaxsiy Telegram'iga bemor emas, ish bo'yicha yozganlar:
 * yetkazib beruvchi, texnik laboratoriya, hamkor, ijara egasi. Egasi kartadagi «🤝 Ish bo'yicha»ni bossa — odam bemorlar ro'yxatidan
 * olinadi va AI unga javob bermaydi (begonaga egasi nomidan yozilmaydi), lekin Palantir kuzatadi:
 *   • egasi REMIND_AFTER ichida o'z Telegram'idan javob bermasa — kunduzi bitta eslatma (bir nechtasi bo'lsa — bitta xabarda);
 *   • kechki BITTA xabarda (evening.ts) — hali javob kutayotganlar;
 *   • egasi o'zi yozsa — javob berildi (eslatma kelmaydi). «Javob shart emas» tugmasi ham bor.
 * AI ishlatilmaydi — faqat kod (token sarflanmaydi). Do'st va qarindosh («🙅 Bemor emas», personal.ts) — kuzatilmaydi ham.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import { settings } from '../serviceStore';

/** Shuncha vaqt javobsiz qolgan ish xabari — eslatiladi */
export const REMIND_AFTER_MS = 3 * 3600_000;
/** Bir biznesda eslab qolinadigan ish kontaktlari (eng eskisi tushib qoladi) */
const MAX_CONTACTS = 300;
/** Xabar matnidan saqlanadigan qism (eslatmada ko'rinadi) */
const TEXT_MAX = 300;
/** Bitta eslatma yoki kechki ro'yxatda ko'rsatiladigan odamlar */
const LIST_MAX = 10;

export interface WorkWaiting { text: string; at: string; count: number; reminded: boolean }
export interface WorkContact { id: string; name: string; waiting: WorkWaiting | null }

const key = (bizId: string) => `tg:work:${bizId}`;

function load(bizId: string): WorkContact[] {
  try {
    const raw: unknown = JSON.parse(settings.all().find(r => r.name === key(bizId))?.value ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((c): c is WorkContact => !!c && typeof c === 'object' && typeof (c as WorkContact).id === 'string')
      .map(c => ({ id: c.id, name: String(c.name ?? ''), waiting: c.waiting && typeof c.waiting.at === 'string' ? c.waiting : null }));
  } catch {
    return [];
  }
}
const save = (bizId: string, list: WorkContact[]): void => { settings.set(key(bizId), JSON.stringify(list.slice(-MAX_CONTACTS))); };
const update = (bizId: string, id: string, fn: (c: WorkContact) => WorkContact): void => {
  const list = load(bizId);
  if (list.some(c => c.id === id)) save(bizId, list.map(c => (c.id === id ? fn(c) : c)));
};
const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

export const workChats = {
  has: (bizId: string, id: string): boolean => load(bizId).some(c => c.id === id),
  get: (bizId: string, id: string): WorkContact | null => load(bizId).find(c => c.id === id) ?? null,
  all: (bizId: string): WorkContact[] => load(bizId),
  /** Egasi belgiladi. waiting — belgilangan paytdagi javobsiz xabar (bo'lsa — kuzatuv shundan boshlanadi) */
  add(bizId: string, id: string, name: string, waiting: { text: string; at: string } | null): void {
    const c: WorkContact = { id, name, waiting: waiting ? { text: clip(waiting.text), at: waiting.at, count: 1, reminded: false } : null };
    save(bizId, [...load(bizId).filter(x => x.id !== id), c]);
  },
  remove: (bizId: string, id: string): void => save(bizId, load(bizId).filter(c => c.id !== id)),
  /** Ish kontakti yozdi: birinchi javobsiz xabar vaqti saqlanadi (eslatma shundan hisoblanadi), matn — oxirgisi */
  incoming(bizId: string, id: string, name: string | null, text: string, at: string): void {
    update(bizId, id, c => ({
      ...c, name: name || c.name,
      waiting: c.waiting ? { ...c.waiting, text: clip(text), count: c.waiting.count + 1 } : { text: clip(text), at, count: 1, reminded: false },
    }));
  },
  /** Egasi o'zi javob berdi yoki «javob shart emas» dedi */
  answered: (bizId: string, id: string): void => update(bizId, id, c => ({ ...c, waiting: null })),
  /** Javob kutayotganlar, eng uzoq kutgani birinchi */
  waiting: (bizId: string): WorkContact[] =>
    load(bizId).filter(c => c.waiting).sort((a, b) => a.waiting!.at.localeCompare(b.waiting!.at)),
  /** Eslatish vaqti kelgan, hali eslatilmaganlar */
  due: (bizId: string, now = Date.now()): WorkContact[] =>
    workChats.waiting(bizId).filter(c => !c.waiting!.reminded && now - Date.parse(c.waiting!.at) >= REMIND_AFTER_MS),
  markReminded(bizId: string, ids: string[]): void {
    save(bizId, load(bizId).map(c => (ids.includes(c.id) && c.waiting ? { ...c, waiting: { ...c.waiting, reminded: true } } : c)));
  },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** «3 soat», «1 kun» — qancha kutyapti */
export function waitedFor(at: string, now = Date.now()): string {
  const h = Math.max(0, Math.floor((now - Date.parse(at)) / 3600_000));
  if (h < 1) return 'hozirgina';
  if (h < 24) return `${h} soat`;
  return `${Math.floor(h / 24)} kun`;
}

const line = (c: WorkContact, now: number) =>
  `• <b>${esc(c.name || 'Ismi yo\'q')}</b> — «${esc(c.waiting!.text)}»${c.waiting!.count > 1 ? ` (+${c.waiting!.count - 1} xabar)` : ''} · ${waitedFor(c.waiting!.at, now)} kutyapti`;

/** Kunduzgi eslatma: matn va har odamga «javob shart emas» tugmasi */
export function reminderMessage(list: WorkContact[], now = Date.now()): { html: string; buttons: { text: string; data: string }[][] } {
  const shown = list.slice(0, LIST_MAX);
  const html = ['📨 <b>Javob kutyapti</b> — ish bo\'yicha yozganlar:', ...shown.map(c => line(c, now)),
    list.length > shown.length ? `… yana ${list.length - shown.length} kishi` : '',
    '', "<i>Telegram'ingizdan javob bersangiz — o'zim belgilayman. Javob kerak bo'lmasa — pastdagi tugma.</i>"].filter(Boolean).join('\n');
  return { html, buttons: shown.map(c => [{ text: `✅ ${cut(c.name || 'Bu odam', 24)} — javob shart emas`, data: `wd|${c.id}` }]) };
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Send = (chatId: string, html: string, buttons: { text: string; data: string }[][]) => Promise<void>;

/**
 * Har tekshiruvda (scheduler.ts), faqat kunduzi (REQUEST_HOURS): eslatish vaqti kelgan ish xabarlari — biznesga bitta xabar
 * (shu paytda muddati kelganlarning hammasi birga). Har xabar bir marta eslatiladi; kechasi kelgani — ertalab. Internet yo'q — belgilanmaydi, keyingi tekshiruvda yana
 */
export async function workTick(send: Send, bizes: { id: string; active: boolean; ownerChatId: string | null }[],
  transient: (e: unknown) => boolean, now = Date.now()): Promise<void> {
  for (const biz of bizes) {
    if (!biz.active || !biz.ownerChatId) continue;
    const list = workChats.due(biz.id, now);
    if (!list.length) continue;
    const m = reminderMessage(list, now);
    try {
      await send(biz.ownerChatId, m.html, m.buttons);
    } catch (e) {
      console.error('[kotib] eslatma:', (e as Error).message);
      if (transient(e)) return;
    }
    workChats.markReminded(biz.id, list.map(c => c.id));
  }
}

/** Kechki xabar qismi: hali javob kutayotganlar; hech kim bo'lmasa — null */
export function workEveningHtml(bizId: string, now = Date.now()): string | null {
  const list = workChats.waiting(bizId);
  if (!list.length) return null;
  const shown = list.slice(0, LIST_MAX);
  return ['📨 <b>Javob kutayotganlar</b> (ish bo\'yicha):', ...shown.map(c => line(c, now)),
    list.length > shown.length ? `… yana ${list.length - shown.length} kishi` : ''].filter(Boolean).join('\n');
}

export const workRow = (leadId: string): InlineKeyboardButton => Markup.button.callback("🤝 Ish bo'yicha (hamkor)", `nw|${leadId}`);
export const undoWorkRow = (tgUserId: string): InlineKeyboardButton[] => [Markup.button.callback('↩️ Qaytarish — bu bemor', `wu|${tgUserId}`)];
