/**
 * Zadarma (onlayn SIP raqam) — API kalitlari bilan telefon liniyasini o'zi sozlaydi: egasi faqat «Key» va «Secret» ni kiritadi.
 *   1. Kalitlar tekshiriladi (balans so'raladi).
 *   2. Faol raqam tanlanadi (O'zbekiston raqami ustun).
 *   3. Palantir uchun alohida SIP ochiladi (klinikaning boshqa qurilmalari o'z SIP'ida qoladi) — parolni Palantir o'zi yaratadi.
 *   4. Raqamga kelgan qo'ng'iroqlar shu SIP'ga yo'naltiriladi.
 * Imzo: base64(hmac_sha1_hex(yo'l + parametrlar + md5(parametrlar), secret)) — https://zadarma.com/en/support/api/
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export interface ZadarmaKeys { key: string; secret: string }
export interface ZadarmaNumber { number: string; status: string; country?: string; channels?: number; sip?: string | number | null }
export interface ZadarmaSetup { number: string; sipId: string; password: string; balance: number; currency: string; channels: number | null }

/** Zadarma SIP serveri: 5061 — shifrlangan (TLS); oddiy SIP (5060) ba'zi provayderlarda to'silgan */
export const ZADARMA_HOST = 'sip.zadarma.com', ZADARMA_PORT = 5061;
const BASE = () => process.env.ZADARMA_API_URL || 'https://api.zadarma.com';
const TIMEOUT_MS = 15_000;
const SIP_NAME = 'Palantir AI';

export class ZadarmaError extends Error {}

/** PHP http_build_query bilan bir xil: kalitlar alifbo tartibida, bo'sh joy «+» */
const query = (params: Record<string, string>) =>
  new URLSearchParams(Object.keys(params).sort().map(k => [k, params[k]])).toString();

export function zadarmaSign(path: string, params: Record<string, string>, secret: string): string {
  const q = query(params);
  const md5 = createHash('md5').update(q).digest('hex');
  return Buffer.from(createHmac('sha1', secret).update(path + q + md5).digest('hex')).toString('base64');
}

async function call<T>(keys: ZadarmaKeys, verb: 'GET' | 'POST' | 'PUT', path: string, params: Record<string, string> = {}): Promise<T> {
  const q = query(params);
  const url = `${BASE()}${path}${verb === 'GET' && q ? `?${q}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: verb,
      headers: { Authorization: `${keys.key}:${zadarmaSign(path, params, keys.secret)}`, ...(verb === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
      body: verb === 'GET' ? undefined : q,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ZadarmaError(`Zadarma'ga ulanib bo'lmadi: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => null) as { status?: string; message?: string } | null;
  if (!res.ok || body?.status !== 'success') {
    if (res.status === 401 || /auth|signature|key/i.test(body?.message ?? '')) throw new ZadarmaError("Zadarma kaliti noto'g'ri — Key va Secret'ni qayta nusxalang");
    throw new ZadarmaError(`Zadarma rad etdi: ${body?.message ?? `HTTP ${res.status}`}`);
  }
  return body as T;
}

export async function zadarmaBalance(keys: ZadarmaKeys): Promise<{ balance: number; currency: string }> {
  const r = await call<{ balance: number | string; currency: string }>(keys, 'GET', '/v1/info/balance/');
  return { balance: Number(r.balance) || 0, currency: r.currency || 'USD' };
}

export async function zadarmaNumbers(keys: ZadarmaKeys): Promise<ZadarmaNumber[]> {
  const r = await call<{ info?: ZadarmaNumber[] }>(keys, 'GET', '/v1/direct_numbers/');
  return (r.info ?? []).map(n => ({ ...n, number: String(n.number).replace(/\D/g, '') }));
}

/** Parol: harflar va raqamlar (Zadarma maxsus belgilarni hamma joyda qabul qilmaydi), 18 belgi */
function newPassword(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(18);
  const body = [...bytes].map(b => abc[b % abc.length]).join('');
  return `${body.slice(0, 15)}Z7k`; // katta harf, raqam, kichik harf albatta bo'lsin
}

/** Raqam tanlash: berilgani; bo'lmasa — faol O'zbekiston raqami, bo'lmasa — birinchi faol */
export function pickNumber(list: ZadarmaNumber[], wanted?: string | null): ZadarmaNumber {
  const on = list.filter(n => n.status === 'on');
  const want = wanted?.replace(/\D/g, '');
  if (want) {
    const n = list.find(x => x.number === want || x.number.endsWith(want));
    if (!n) throw new ZadarmaError(`Zadarma'da ${wanted} raqami topilmadi`);
    if (n.status !== 'on') throw new ZadarmaError(`${wanted} raqami hali faol emas (holati: ${n.status}) — Zadarma tekshiruvi tugashini kuting`);
    return n;
  }
  const pick = on.find(n => n.number.startsWith('998')) ?? on[0];
  if (pick) return pick;
  if (list.length) throw new ZadarmaError(`Zadarma'dagi raqam hali faol emas (holati: ${list[0].status}) — hujjatlar tekshiruvi tugashini kuting`);
  throw new ZadarmaError("Zadarma hisobida raqam yo'q — avval raqam ulang (Toshkent, 71)");
}

/**
 * To'liq sozlash. knownSip — avvalgi sozlashda ochilgan SIP (qayta ishga tushirilsa yangisi ochilmaydi, faqat paroli yangilanadi)
 */
export async function zadarmaSetup(keys: ZadarmaKeys, opts: { number?: string | null; knownSip?: string | null } = {}): Promise<ZadarmaSetup> {
  const { balance, currency } = await zadarmaBalance(keys);
  const number = pickNumber(await zadarmaNumbers(keys), opts.number);
  const password = newPassword();
  const sips = (await call<{ sips?: { id: string | number; display_name?: string }[] }>(keys, 'GET', '/v1/sip/')).sips ?? [];
  const mine = sips.find(s => String(s.id) === opts.knownSip) ?? sips.find(s => s.display_name === SIP_NAME);
  let sipId: string;
  if (mine) {
    sipId = String(mine.id);
    await call(keys, 'PUT', `/v1/sip/${sipId}/password/`, { value: password });
  } else {
    try {
      sipId = String((await call<{ sip: string | number }>(keys, 'POST', '/v1/sip/create/', { name: SIP_NAME, password, callerid: number.number })).sip);
    } catch (e) {
      throw new ZadarmaError(`Palantir uchun SIP ochib bo'lmadi (${(e as Error).message}). Zadarma kabinetida yangi SIP qo'shishga ruxsat borligini tekshiring`);
    }
  }
  await call(keys, 'PUT', '/v1/direct_numbers/set_sip_id/', { number: number.number, sip_id: sipId });
  return { number: number.number, sipId, password, balance, currency, channels: number.channels ?? null };
}
