/**
 * Bot (bot.ts) va uning tugmalari (botButtons.ts) uchun umumiy yordamchilar: matn, karta va tugma ko'rinishi, fonda ish,
 * tugmaga javob. Bot holatiga (Telegraf, closure) bog'liq emas.
 */
import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { Lang, MoneyEntry, MoneyStatus, Outbound, Task } from '../src/types';
import { isClinic } from '../src/data/industries';
import { crmConnected } from './crm/index';
import { cameras, leads, type BusinessRow, type LeadRow } from './db';
import { env, voiceEnabled } from './env';

export const langOf = (b: BusinessRow): Lang => b.profile.contentLang ?? 'uz';
export const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const personName = (l: Pick<LeadRow, 'name' | 'username' | 'phone'>) => l.name || (l.username ? `@${l.username}` : null) || l.phone || 'Mijoz';

/** Yordamchi javobi (oddiy Markdown) → Telegram HTML */
export function tgHtml(md: string): string {
  return md.split('\n').map(line => {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    let s = esc(h ? h[1] : line);
    s = s.replace(/^(\s*)[-*]\s+/, '$1• ');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`);
    return h ? `<b>${s}</b>` : s;
  }).join('\n');
}

/** Uzun matn Telegram chegarasiga (4096) bo'linadi — xatboshi bo'yicha */
export function chunks(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split('\n')) {
    if (cur && cur.length + para.length + 1 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${para}` : para.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

export const b = Markup.button.callback;
export type Btn = ReturnType<typeof b>;
export const kb = (rows: Btn[][]): InlineKeyboardMarkup => Markup.inlineKeyboard(rows).reply_markup;

export function followupText(o: Outbound, biz: BusinessRow): string {
  const all = o.leadIds.map(id => leads.get(biz.id, id)).filter((l): l is LeadRow => !!l);
  const offline = all.filter(l => !l.reachable);
  const lines = [
    `<b>✉️ Mijozlarga xabar</b> — ${o.reachable ? `${o.reachable} kishiga Telegram orqali boradi` : "Telegram orqali hech kimga yetib bo'lmaydi"}:`,
    '',
    `<i>${esc(cut(o.text, 2500))}</i>`,
  ];
  if (offline.length) {
    lines.push('', `📞 Qo'ng'iroq qilish kerak (${offline.length}):`, ...offline.slice(0, 15).map(l => `• ${esc(personName(l))}${l.phone ? ` — ${esc(l.phone)}` : ''}`));
    if (offline.length > 15) lines.push(`… yana ${offline.length - 15} ta`);
  }
  if (o.status === 'sent') lines.push('', `✅ Yuborildi: ${o.sentCount} ta`);
  if (o.status === 'cancelled') lines.push('', '✖️ Bekor qilindi');
  return lines.join('\n');
}
export const followupKeyboard = (o: Outbound) => (o.status !== 'draft' ? undefined : kb([[
  ...(o.reachable ? [b(`✅ Yuborish (${o.reachable})`, `fs|${o.id}`)] : []),
  b('✖️ Bekor qilish', `fc|${o.id}`),
]]));

export const MONEY_STATE: Record<MoneyStatus, string> = {
  draft: "<i>Tekshiring. Tasdiqlasangiz — DentaCRM'ga yoziladi. Buni so'ramagan bo'lsangiz — «Bekor qilish».</i>", running: '⏳ Yozilmoqda…', done: "✅ DentaCRM'ga yozildi", cancelled: '✖️ Bekor qilindi',
  failed: '⚠️ Yozilmadi', unknown: "❓ Yozilgan-yozilmagani noma'lum — DentaCRM'da tekshiring", undone: "↩️ Ortga qaytarildi (CRM'dan o'chirildi)",
};
export const moneyText = (e: MoneyEntry): string =>
  [`<b>💰 ${esc(e.title)}</b>`, ...e.details.map(esc), '', MONEY_STATE[e.status], ...(e.note ? [`ℹ️ ${esc(e.note)}`] : [])].join('\n');
export const moneyKeyboard = (e: MoneyEntry) => (e.status === 'draft' ? kb([[b('✅ Tasdiqlash', `ma|${e.id}`), b('✖️ Bekor qilish', `mx|${e.id}`)]])
  : e.canUndo ? kb([[b('↩️ Ortga qaytarish', `mu|${e.id}`)]]) : undefined);

export const reminderText = (t: Task, note = '') =>
  [`⏰ <b>${esc(t.title)}</b>`, t.notes ? esc(t.notes) : '', note].filter(Boolean).join('\n');
export const reminderKeyboard = (t: Task) => kb([[b('✅ Bajarildi', `td|${t.id}`), b('⏰ 1 soatdan keyin', `ts|${t.id}`), b('📅 Ertaga', `tt|${t.id}`)]]);

/** Telegram "xabar o'zgarmadi" xatosi — muammo emas */
export const ignoreUnchanged = (e: unknown) => {
  if (!String((e as Error)?.message).includes('message is not modified')) throw e;
};

/**
 * Uzoq ish (AI, ovoz, ko'p mijozga yuborish) fonda: Telegraf keyingi xabarlarni
 * oldingilari tugamaguncha olmaydi — bitta egasining javobi boshqa bizneslarni kutdirmasin.
 * Bitta biznesning gaplari baribir navbat bilan ishlanadi (agent.ts).
 */
export const detach = (what: string, work: () => Promise<unknown>) => {
  void work().catch(e => console.error(`[bot] ${what}:`, (e as Error)?.message ?? e));
};

/**
 * Tugma bosilishiga javob (ekrandagi qisqa ogohlantirish). Eskirgan bosishga Telegram javobni rad etadi —
 * bu xato asosiy ishni to'xtatmasligi kerak (xabar yuborilmay yoki karta yangilanmay qolardi)
 */
export const toast = (ctx: { answerCbQuery: (text?: string, extra?: { show_alert?: boolean }) => Promise<unknown> }, text?: string, extra?: { show_alert?: boolean }): Promise<unknown> =>
  ctx.answerCbQuery(text, extra).catch(e => { console.error('[bot] tugma javobi:', (e as Error).message); });

/** Telegram javob bermasa qayta ulanish oralig'i: 5 soniyadan boshlab ikki baravar o'sadi, ko'pi bilan bir daqiqa */
export const RETRY_MIN_MS = 5_000, RETRY_MAX_MS = 60_000;

/** Yordam matni: misollar biznesga mos (klinika — qabul va to'lov, qolganlar — mijoz va savdo); ovoz — faqat ovoz xizmati sozlangan bo'lsa */
export function helpFor(biz: BusinessRow): string {
  const clinic = isClinic(biz.profile.industry, crmConnected(biz.id));
  const examples = clinic
    ? [
      '• «Bugun nechta bemor yozilgan, tushum qancha?»',
      "• «Ertaga soat 10 da laboratoriyaga qo'ng'iroq qilishni eslat»",
      "• «Kamola Tursunova 300 ming to'ladi»",
      '• «Ertaga Rustamovda bo\'sh vaqt bormi?»',
    ]
    : [
      "• «Ertaga soat 10 da Aziz akaga qo'ng'iroq qilishni eslat»",
      "• «Aziz Karimov, +998 90 123 45 67, demo so'radi — mijozlarga qo'sh, payshanba eslat»",
      '• «Kecha yozganlarga javob tayyorla»',
      '• «Tabassum klinikasiga tijorat taklifi tayyorla»',
    ];
  return [
    `Men — Palantir, biznesingiz uchun AI yordamchi. Oddiy gapiring${voiceEnabled() ? ' yoki ovozli xabar yuboring' : ''}. Masalan:`,
    '',
    ...examples,
    "• Narxnoma yoki shartnoma namunasini fayl qilib yuboring (PDF, Word, Excel) — o'qib, bilimga qo'shaman",
    '• «Bugun nima qilishim kerak?»',
    '',
    ...(cameras.list(biz.id).length ? ["/kamera — kameralardan hozirgi rasm (savol bilan: «/kamera qabulxonada kim bor»)"] : []),
    '/vazifalar — ochiq vazifalar',
    "/savollar — mijozlar ko'p so'raydigan savollarni birma-bir so'rayman, javobingizni eslab qolaman",
    '/yangi — yangi suhbat (oldingisini unutadi, vazifa va mijozlar qoladi)',
    ...(env.hub ? ["/yordam — muammo bo'lsa Palantir jamoasiga yozing (masalan: «/yordam Instagram'ga javob ketmayapti»), javob shu yerga keladi"] : []),
  ].join('\n');
}

/** Qaytarish ro'yxatida Telegram'ga shuncha bemor chiqadi (qolgani — DentaCRM'da) */
export const RECALL_SHOWN = 40;
