/**
 * Egasining shaxsiy Telegram akkaunti — Cerebro unga kod bilan bir marta kiradi
 * (xuddi Telegram Desktop kabi, "Faol seanslar"da «Cerebro» bo'lib ko'rinadi).
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
  /** Saqlangan sessiya bilan ulanadi; sessiya bekor qilingan bo'lsa — false */
  attach(bizId: string, session: string, onEvent: (e: TgEvent) => void): Promise<boolean>;
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
      connectionRetries: 5, deviceModel: 'Cerebro', systemVersion: 'server', appVersion: '1.0',
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
    async attach(bizId, session, onEvent) {
      const client = make(session);
      await client.connect();
      if (!(await client.checkAuthorization())) {
        await client.destroy().catch(() => {});
        return false;
      }
      client.addEventHandler(async (ev: NewMessageEvent) => {
        if (!ev.message.isPrivate) return;
        const e = await toEvent(ev.message).catch(() => null);
        if (e) onEvent(e);
      }, new NewMessage({}));
      // Yangilanishlar kelishi uchun holatni bir marta so'rash kerak
      await client.getMe();
      live.set(bizId, client);
      return true;
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
    async detach(bizId) { const s = live.get(bizId); if (s) s.stop = true; live.delete(bizId); },
    async send(bizId, to, text) {
      const s = live.get(bizId);
      if (!s) throw new Error('Shaxsiy Telegram ulanmagan');
      return call('/send', { session: s.session, to, text });
    },
  };
}

// ─── Ulash va kanalga bog'lash ────────────────────────────────────────────────

const driver: Driver | null = env.tgUserFakeUrl ? fake(env.tgUserFakeUrl) : env.tgApiId && env.tgApiHash ? gramjs() : null;
export const telegramUserAvailable = () => !!driver;

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

export async function startTelegramUser(): Promise<void> {
  if (!driver) return;
  const d = driver;
  registerSender('telegram', {
    can: (biz, lead) => !!connections.get(biz.id, 'telegram') && !!((lead.tgUserId && lead.tgAccessHash) || lead.username || lead.phone),
    async send(biz: BusinessRow, lead: LeadRow, text: string) {
      const r = await d.send(biz.id, { userId: lead.tgUserId, accessHash: lead.tgAccessHash, username: lead.username, phone: lead.phone, name: lead.name }, text);
      if (r.userId && r.accessHash && (!lead.tgUserId || !lead.tgAccessHash)) leads.setTelegramPeer(biz.id, lead.id, r.userId, r.accessHash);
      return r.msgId;
    },
  });
  for (const c of connections.all('telegram')) {
    try {
      const ok = await d.attach(c.businessId, open(c.secret), e => onEvent(c.businessId, e));
      if (!ok) await lost(c.businessId);
    } catch (e) {
      console.error('[telegram-akkaunt] ulanmadi:', (e as Error).message);
    }
  }
}

/** Egasi telefonidan "Cerebro" seansini tugatgan */
async function lost(bizId: string): Promise<void> {
  connections.remove(bizId, 'telegram');
  const biz = businesses.byId(bizId);
  if (biz) await notifyOwner(biz, "⚠️ Shaxsiy Telegram uzildi (seans tugatilgan). Qayta ulash: panel → Ulanishlar.").catch(() => {});
}

export async function stopTelegramUser(): Promise<void> {
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
