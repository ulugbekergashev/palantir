/**
 * Egasining shaxsiy Telegram akkaunti — Palantir unga kod bilan bir marta kiradi
 * (xuddi Telegram Desktop kabi, "Faol seanslar"da «Palantir» bo'lib ko'rinadi).
 * Shundan keyin mijozlar egasiga yozgan chatlarni o'qiydi va uning nomidan javob beradi;
 * egasi buyursa, birinchi bo'lib ham yozadi (username yoki telefon orqali).
 *
 * Kimga javob beriladi: kontaktlarda yo'q odamlar (mijozlar) va allaqachon mijoz bo'lganlar.
 * Kontaktlardagilar (oila, do'stlar) — faqat egasi sozlamada ruxsat bersa. Guruh, kanal va
 * botlarga tegilmaydi. Sessiya bazada shifrlangan.
 *
 * Ikki haydovchi: GramJS (haqiqiy Telegram) va sinov uchun soxta (TG_USER_FAKE_URL).
 */
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { businesses, connections, leads, type BusinessRow, type LeadRow } from '../db';
import { env } from '../env';
import { open, seal } from '../secret';
import { notifyOwner, onIncoming, onOwnerOutgoing, registerSender, replySettings } from './core';

/** Telegram'dan kelgan xabar (haydovchidan mustaqil ko'rinishda) */
export interface TgEvent {
  out: boolean;
  userId: string;
  accessHash: string | null;
  name: string | null;
  username: string | null;
  phone: string | null;
  isContact: boolean;
  isBot: boolean;
  text: string;
  msgId: string;
}

export interface TgAccount { id: string; name: string; username: string; phone: string }
export interface TgTarget { userId?: string | null; accessHash?: string | null; username?: string | null; phone?: string | null; name?: string | null }

interface Driver {
  /** Kod yuboradi */
  begin(key: string, phone: string): Promise<void>;
  code(key: string, code: string): Promise<{ session: string; account: TgAccount } | 'password'>;
  password(key: string, password: string): Promise<{ session: string; account: TgAccount }>;
  /**
   * Saqlangan sessiya bilan ulanadi; sessiya bekor qilingan bo'lsa — false. Tarmoq xatosi — istisno (keyinroq qayta uriniladi).
   * since — shu paytdan (ms) keyingi xabarlar ulangach o'qib olinadi: uzilish paytida kelganlar yo'qolmasin. null — o'qilmaydi (yangi kirish)
   */
  attach(bizId: string, session: string, onEvent: (e: TgEvent) => void, since?: number | null): Promise<boolean>;
  /** Ulanish tirikmi: ok — ishlayapti, revoked — egasi seansni tugatgan, down — javob yo'q (qayta ulash kerak) */
  check(bizId: string): Promise<'ok' | 'revoked' | 'down'>;
  detach(bizId: string, logout: boolean): Promise<void>;
  send(bizId: string, to: TgTarget, text: string): Promise<{ msgId: string; userId: string; accessHash: string | null }>;
}

// ─── GramJS (haqiqiy Telegram) ────────────────────────────────────────────────

const SERVICE_ID = '777000'; // Telegram xizmat xabarlari (kirish kodlari shu yerga keladi)
const errCode = (e: unknown) => String((e as { errorMessage?: string })?.errorMessage ?? (e as Error)?.message ?? '');
const FRIENDLY: Record<string, string> = {
  PHONE_NUMBER_INVALID: "Telefon raqam noto'g'ri",
  PHONE_NUMBER_BANNED: 'Bu raqam Telegram tomonidan bloklangan',
  PHONE_CODE_INVALID: "Kod noto'g'ri",
  PHONE_CODE_EXPIRED: "Kod eskirgan — qaytadan so'rang",
  PASSWORD_HASH_INVALID: "Parol noto'g'ri",
  FLOOD_WAIT: "Telegram ko'p urinish deb to'xtatdi — birozdan keyin qayta urining",
  API_ID_INVALID: 'Serverdagi TG_API_ID yoki TG_API_HASH noto\'g\'ri',
};
/** Telegram «bu seans endi yo'q» degan javoblar. Faqat shularda ulanish o'chiriladi — tarmoq xatosi seansni o'chirmaydi */
const REVOKED = /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|AUTH_KEY_DUPLICATED|AUTH_KEY_PERM_EMPTY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/;
const CHECK_TIMEOUT_MS = 20_000, CONNECT_TIMEOUT_MS = 60_000, CATCHUP_TIMEOUT_MS = 90_000;
/** Uzilishdan keyin ko'riladigan suhbatlar va har biridan olinadigan oxirgi xabarlar soni */
const CATCHUP_DIALOGS = 40, CATCHUP_MESSAGES = 10;
const within = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('javob kutish vaqti tugadi')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e as Error); });
  });
const friendly = (e: unknown) => {
  const c = errCode(e);
  const key = Object.keys(FRIENDLY).find(k => c.startsWith(k));
  return new Error(key ? FRIENDLY[key] : `Telegram: ${c || "noma'lum xato"}`);
};

function gramjs(): Driver {
  const logins = new Map<string, { client: TelegramClient; phone: string; hash: string; at: number }>();
  const live = new Map<string, TelegramClient>();
  const make = (session: string) => {
    const c = new TelegramClient(new StringSession(session), env.tgApiId, env.tgApiHash, {
      connectionRetries: 5, deviceModel: 'Palantir', systemVersion: 'server', appVersion: '1.0',
    });
    c.setLogLevel(LogLevel.ERROR);
    return c;
  };
  const finish = async (client: TelegramClient) => {
    const me = await client.getMe() as Api.User;
    const account: TgAccount = {
      id: me.id.toString(), name: [me.firstName, me.lastName].filter(Boolean).join(' '), username: me.username ?? '', phone: me.phone ? `+${me.phone}` : '',
    };
    const session = (client.session as StringSession).save();
    await client.destroy();
    return { session, account };
  };
  const toEvent = async (m: Api.Message): Promise<TgEvent | null> => {
    const partner = (m.out ? await m.getChat() : await m.getSender()) as Api.User | undefined;
    if (!partner || partner.className !== 'User' || partner.self) return null;
    const text = m.message || (m.media ? '[rasm yoki fayl]' : '');
    if (!text) return null;
    return {
      out: !!m.out, userId: partner.id.toString(), accessHash: partner.accessHash?.toString() ?? null,
      name: [partner.firstName, partner.lastName].filter(Boolean).join(' ') || null, username: partner.username ?? null,
      phone: partner.phone ? `+${partner.phone}` : null, isContact: !!partner.contact, isBot: !!partner.bot, text, msgId: String(m.id),
    };
  };

  /**
   * Uzilish paytida kelgan xabarlar: kutubxona ularni o'zi yetkazmaydi. Oxirgi suhbatlardan since dan keyingi xabarlar eskisidan yangisiga
   * qarab beriladi — egasining o'z javoblari ham (u telefonidan javob bergan bo'lsa, Palantir ikkinchi marta javob bermasin).
   * Bir xabar ikki marta kelsa zarari yo'q: yozishmaga id bo'yicha bir marta tushadi
   */
  const catchUp = async (client: TelegramClient, since: number, onEvent: (e: TgEvent) => void) => {
    for (const d of await client.getDialogs({ limit: CATCHUP_DIALOGS })) {
      if (!d.isUser || !d.inputEntity || (d.date ?? 0) * 1000 < since) continue;
      const messages = await client.getMessages(d.inputEntity, { limit: CATCHUP_MESSAGES });
      for (const m of [...messages].reverse()) {
        if (m.date * 1000 < since) continue;
        const e = await toEvent(m).catch(() => null);
        if (e) onEvent(e);
      }
    }
  };

  return {
    async begin(key, phone) {
      logins.get(key)?.client.destroy().catch(() => {});
      const client = make('');
      try {
        await client.connect();
        const { phoneCodeHash } = await client.sendCode({ apiId: env.tgApiId, apiHash: env.tgApiHash }, phone);
        logins.set(key, { client, phone, hash: phoneCodeHash, at: Date.now() });
      } catch (e) {
        await client.destroy().catch(() => {});
        throw friendly(e);
      }
    },
    async code(key, code) {
      const l = logins.get(key);
      if (!l || Date.now() - l.at > 10 * 60_000) throw new Error("Kod so'rovi eskirgan — raqamni qayta kiriting");
      let r: Api.auth.TypeAuthorization;
      try {
        r = await l.client.invoke(new Api.auth.SignIn({ phoneNumber: l.phone, phoneCodeHash: l.hash, phoneCode: code }));
      } catch (e) {
        if (errCode(e) === 'SESSION_PASSWORD_NEEDED') return 'password';
        throw friendly(e);
      }
      if (r instanceof Api.auth.AuthorizationSignUpRequired) throw new Error("Bu raqamda Telegram akkaunt yo'q");
      logins.delete(key);
      return finish(l.client);
    },
    async password(key, password) {
      const l = logins.get(key);
      if (!l) throw new Error("Kod so'rovi eskirgan — raqamni qayta kiriting");
      try {
        const pwd = await l.client.invoke(new Api.account.GetPassword());
        await l.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }));
      } catch (e) {
        throw friendly(e);
      }
      logins.delete(key);
      return finish(l.client);
    },
    async attach(bizId, session, onEvent, since = null) {
      const client = make(session);
      try {
        // Kutubxona ulana olmasa xato bermaydi (false qaytaradi yoki kutib qoladi) — shuning uchun vaqt chegarasi va natija tekshiruvi
        if ((await within(client.connect(), CONNECT_TIMEOUT_MS)) === false) throw new Error("Telegram'ga ulanib bo'lmadi");
        // Kutubxonaning checkAuthorization() har qanday xatoda (internet uzilganda ham) «seans yo'q» deydi — shuning uchun o'zimiz so'raymiz
        await within(client.invoke(new Api.updates.GetState()), CHECK_TIMEOUT_MS);
        client.addEventHandler(async (ev: NewMessageEvent) => {
          if (!ev.message.isPrivate) return;
          const e = await toEvent(ev.message).catch(() => null);
          if (e) onEvent(e);
        }, new NewMessage({}));
        // Yangilanishlar kelishi uchun holatni bir marta so'rash kerak
        await within(client.getMe(), CHECK_TIMEOUT_MS);
      } catch (e) {
        await client.destroy().catch(() => {});
        if (REVOKED.test(errCode(e))) return false;
        throw e;
      }
      // Bitta biznes — bitta ulanish: oldingisi qolgan bo'lsa (qayta ulanish paytida egasi yangidan kirgan) yopiladi, xabarlar ikki marta kelmasin
      await live.get(bizId)?.destroy().catch(() => {});
      live.set(bizId, client);
      if (since != null) void within(catchUp(client, since, onEvent), CATCHUP_TIMEOUT_MS).catch(e => console.error("[telegram-akkaunt] o'tkazib yuborilgan xabarlar o'qilmadi:", (e as Error).message));
      return true;
    },
    async check(bizId) {
      const c = live.get(bizId);
      if (!c) return 'down';
      try {
        await within(c.invoke(new Api.updates.GetState()), CHECK_TIMEOUT_MS);
        return 'ok';
      } catch (e) {
        return REVOKED.test(errCode(e)) ? 'revoked' : 'down';
      }
    },
    async detach(bizId, logout) {
      const c = live.get(bizId);
      live.delete(bizId);
      if (!c) return;
      if (logout) await c.invoke(new Api.auth.LogOut()).catch(() => {});
      await c.destroy().catch(() => {});
    },
    async send(bizId, to, text) {
      const c = live.get(bizId);
      if (!c) throw new Error('Shaxsiy Telegram ulanmagan');
      let peer: Api.TypeInputPeer;
      if (to.userId && to.accessHash) {
        peer = new Api.InputPeerUser({ userId: bigInt(to.userId), accessHash: bigInt(to.accessHash) });
      } else if (to.username) {
        peer = await c.getInputEntity(to.username.replace(/^@/, '')) as Api.TypeInputPeer;
      } else if (to.phone) {
        // Raqam orqali: kontaktga qo'shib topiladi (Telegram boshqa yo'l bermaydi)
        const r = await c.invoke(new Api.contacts.ImportContacts({
          contacts: [new Api.InputPhoneContact({ clientId: bigInt(Date.now()), phone: to.phone.replace(/[^\d+]/g, ''), firstName: to.name || to.phone, lastName: '' })],
        }));
        const u = r.users[0] as Api.User | undefined;
        if (!u) throw new Error("Bu raqam Telegram'da topilmadi (yoki egasi raqamini yashirgan)");
        peer = new Api.InputPeerUser({ userId: u.id, accessHash: u.accessHash ?? bigInt(0) });
      } else {
        throw new Error("Mijozning Telegram manzili yo'q (username yoki telefon kerak)");
      }
      const m = await c.sendMessage(peer, { message: text }).catch(e => { throw friendly(e); });
      const p = peer as Api.InputPeerUser;
      return { msgId: String(m.id), userId: p.userId?.toString() ?? '', accessHash: p.accessHash?.toString() ?? null };
    },
  };
}

// ─── Soxta haydovchi (faqat sinov: TG_USER_FAKE_URL) ──────────────────────────

function fake(base: string): Driver {
  const call = async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json() as T & { error?: string };
    if (!r.ok) throw friendly({ errorMessage: j.error });
    return j;
  };
  const phones = new Map<string, string>();
  const live = new Map<string, { session: string; stop: boolean }>();
  return {
    async begin(key, phone) { phones.set(key, phone); await call('/code', { phone }); },
    async code(key, code) {
      const r = await call<{ password?: boolean; session?: string; account?: TgAccount }>('/sign', { phone: phones.get(key), code });
      return r.password ? 'password' : { session: r.session!, account: r.account! };
    },
    async password(key, password) { return call<{ session: string; account: TgAccount }>('/password', { phone: phones.get(key), password }); },
    async attach(bizId, session, onEvent) {
      const state = { session, stop: false };
      live.set(bizId, state);
      void (async () => {
        while (!state.stop) {
          try {
            const { events } = await call<{ events: TgEvent[] }>('/updates', { session });
            for (const e of events) onEvent(e);
          } catch { await new Promise(r => setTimeout(r, 300)); }
        }
      })();
      return true;
    },
    async check(bizId) { return live.has(bizId) ? 'ok' : 'down'; },
    async detach(bizId) { const s = live.get(bizId); if (s) s.stop = true; live.delete(bizId); },
    async send(bizId, to, text) {
      const s = live.get(bizId);
      if (!s) throw new Error('Shaxsiy Telegram ulanmagan');
      return call('/send', { session: s.session, to, text });
    },
  };
}

// ─── Ulash va kanalga bog'lash ────────────────────────────────────────────────

const pickDriver = (): Driver | null => (env.tgUserFakeUrl ? fake(env.tgUserFakeUrl) : env.tgApiId && env.tgApiHash ? gramjs() : null);
let driver: Driver | null = pickDriver();
export const telegramUserAvailable = () => !!driver;

/**
 * TG_API_ID va TG_API_HASH ulash ustasida kiritildi: server to'xtamasdan shaxsiy Telegram yoqiladi.
 * Ishlab turgan drayver almashtirilmaydi — ulangan seanslar o'z kaliti bilan ishlayveradi (yangi kalit qayta yoqilganda kuchga kiradi)
 */
export function refreshTelegramUser(): void {
  if (driver || halted) return;
  driver = pickDriver();
  if (driver) startTelegramUser();
}

/** Mijoz bilan yozishmami yoki shaxsiy suhbatmi */
function accept(biz: BusinessRow, e: TgEvent): boolean {
  if (e.isBot || e.userId === SERVICE_ID) return false;
  const settings = replySettings(biz);
  if (settings.mode === 'off') return false;
  if (leads.byTelegram(biz.id, e.userId)) return true;
  return !e.isContact || settings.contacts;
}

function onEvent(bizId: string, e: TgEvent): void {
  const biz = businesses.byId(bizId);
  if (!biz?.active) return;
  if (e.out) {
    onOwnerOutgoing(biz, 'telegram', { tgUserId: e.userId }, e.text, e.msgId);
    return;
  }
  if (!accept(biz, e)) return;
  onIncoming(biz, {
    channel: 'telegram',
    person: { tgUserId: e.userId, tgAccessHash: e.accessHash ?? undefined, name: e.name, username: e.username, phone: e.phone },
    text: e.text, extId: e.msgId, source: 'Telegram (shaxsiy)',
  });
}

const accountLabel = (a: Record<string, string>) => [a.name, a.username ? `@${a.username}` : a.phone].filter(Boolean).join(' · ');
export const telegramUserAccount = (bizId: string) => {
  const c = connections.get(bizId, 'telegram');
  return c ? accountLabel(c.account) : null;
};

/** Qayta ulanish: 15 soniyadan boshlab ikki baravar o'sadi, ko'pi bilan besh daqiqa. Tirikligini tekshirish — har daqiqada */
const RETRY_MIN_MS = 15_000, RETRY_MAX_MS = 5 * 60_000, WATCH_MS = 60_000;
/** Server qayta tushgach (tok o'chgan, yangilangan) shuncha vaqt ichida kelgan xabarlar o'qib olinadi */
const BOOT_CATCHUP_MS = 6 * 3600_000;
/** Har ulanishning oxirgi tirik ko'rilgan payti: qayta ulanganda shundan keyingi xabarlar o'qib olinadi */
const lastAlive = new Map<string, number>();
const bootedAt = Date.now();
/** Ketma-ket shuncha tekshiruvda javob bo'lmasa — ulanish noldan qayta quriladi (bir martalik uzilishga tegilmaydi) */
const DOWN_LIMIT = 2;
const attaching = new Set<string>();
const downs = new Map<string, number>();
let halted = false;
let watcher: NodeJS.Timeout | null = null;

/**
 * Saqlangan seans bilan ulanadi va ulanmaguncha qayta urinadi (kompyuter internetsiz yongan, Telegram vaqtincha javob bermayapti).
 * Faqat Telegram seansni bekor qilingan desa — ulanish o'chiriladi va egasiga aytiladi
 */
async function keepAttached(bizId: string): Promise<void> {
  if (!driver || attaching.has(bizId)) return;
  attaching.add(bizId);
  try {
    for (let wait = RETRY_MIN_MS; !halted; wait = Math.min(wait * 2, RETRY_MAX_MS)) {
      const c = connections.get(bizId, 'telegram');
      if (!c) return; // shu orada egasi uzgan
      try {
        const since = lastAlive.get(bizId) ?? bootedAt - BOOT_CATCHUP_MS;
        if (!(await driver.attach(bizId, open(c.secret), e => onEvent(bizId, e), since))) await lost(bizId);
        else lastAlive.set(bizId, Date.now());
        return;
      } catch (e) {
        console.error(`[telegram-akkaunt] ulanmadi — ${Math.round(wait / 1000)} soniyadan keyin qayta uriniladi:`, (e as Error).message);
      }
      await new Promise(r => setTimeout(r, wait));
    }
  } finally {
    attaching.delete(bizId);
  }
}

/** Ulanishlar tirikligini tekshiradi: jim uzilib qolgan seans qayta quriladi, bekor qilingani — o'chiriladi */
async function watch(): Promise<void> {
  if (!driver) return;
  for (const c of connections.all('telegram')) {
    const id = c.businessId;
    if (attaching.has(id)) continue;
    const state = await driver.check(id).catch(() => 'down' as const);
    if (state === 'ok') { downs.delete(id); lastAlive.set(id, Date.now()); continue; }
    if (state === 'revoked') {
      await driver.detach(id, false).catch(() => {});
      await lost(id);
      continue;
    }
    const n = (downs.get(id) ?? 0) + 1;
    downs.set(id, n);
    if (n < DOWN_LIMIT) continue;
    downs.delete(id);
    console.error('[telegram-akkaunt] javob bermayapti — qayta ulanadi');
    await driver.detach(id, false).catch(() => {});
    void keepAttached(id);
  }
}

/** Kanalni ro'yxatga oladi va saqlangan seanslarni FONDA ulaydi: Telegram javob bermasa ham server kutib qolmaydi */
export function startTelegramUser(): void {
  if (!driver) return;
  const d = driver;
  registerSender('telegram', {
    // Telefon bo'yicha faqat egasi o'zi kiritgan mijozga yoziladi: yozishmada aytilgan raqam begona odamniki bo'lishi mumkin
    can: (biz, lead) => !!connections.get(biz.id, 'telegram') && !!((lead.tgUserId && lead.tgAccessHash) || lead.username || (lead.phone && lead.channel === 'manual')),
    async send(biz: BusinessRow, lead: LeadRow, text: string) {
      const r = await d.send(biz.id, { userId: lead.tgUserId, accessHash: lead.tgAccessHash, username: lead.username, phone: lead.phone, name: lead.name }, text);
      if (r.userId && r.accessHash && (!lead.tgUserId || !lead.tgAccessHash)) leads.setTelegramPeer(biz.id, lead.id, r.userId, r.accessHash);
      return r.msgId;
    },
  });
  for (const c of connections.all('telegram')) void keepAttached(c.businessId);
  let watching = false;
  watcher = setInterval(() => {
    if (watching) return;
    watching = true;
    void watch().catch(e => console.error('[telegram-akkaunt] tekshiruv:', (e as Error).message)).finally(() => { watching = false; });
  }, WATCH_MS);
}

/** Egasi telefonidan "Palantir" seansini tugatgan */
async function lost(bizId: string): Promise<void> {
  connections.remove(bizId, 'telegram');
  const biz = businesses.byId(bizId);
  if (biz) await notifyOwner(biz, "⚠️ Shaxsiy Telegram uzildi (seans tugatilgan). Qayta ulash: panel → Ulanishlar.").catch(() => {});
}

export async function stopTelegramUser(): Promise<void> {
  halted = true;
  if (watcher) clearInterval(watcher);
  if (!driver) return;
  for (const c of connections.all('telegram')) await driver.detach(c.businessId, false).catch(() => {});
}

// Panel: kirish qadamlari
const need = () => { if (!driver) throw new Error("Shaxsiy Telegram serverda sozlanmagan (TG_API_ID, TG_API_HASH)"); return driver; };

export async function loginStart(biz: BusinessRow, phone: string): Promise<void> {
  const clean = phone.replace(/[^\d+]/g, '');
  if (!/^\+?\d{9,15}$/.test(clean)) throw new Error("Telefon raqamni to'liq kiriting: +998 90 123 45 67");
  await need().begin(biz.id, clean.startsWith('+') ? clean : `+${clean}`);
}

async function connected(biz: BusinessRow, r: { session: string; account: TgAccount }): Promise<string> {
  const d = need();
  await d.detach(biz.id, false).catch(() => {});
  connections.save(biz.id, 'telegram', seal(r.session), { ...r.account });
  await d.attach(biz.id, r.session, e => onEvent(biz.id, e));
  // Yangi kirish: shu paytgacha kelgan xabarlar Palantir'niki emas — keyingi qayta ulanishda faqat bundan keyingilari o'qiladi
  lastAlive.set(biz.id, Date.now());
  return accountLabel({ ...r.account });
}

export async function loginCode(biz: BusinessRow, code: string): Promise<{ account: string } | { password: true }> {
  const r = await need().code(biz.id, code.replace(/\D/g, ''));
  return r === 'password' ? { password: true } : { account: await connected(biz, r) };
}

export async function loginPassword(biz: BusinessRow, password: string): Promise<{ account: string }> {
  return { account: await connected(biz, await need().password(biz.id, password)) };
}

export async function disconnectTelegramUser(biz: BusinessRow): Promise<void> {
  await driver?.detach(biz.id, true);
  connections.remove(biz.id, 'telegram');
}
