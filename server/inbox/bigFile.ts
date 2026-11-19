/**
 * Katta fayl egasiga: Bot API 50 MB dan kattasini yubora olmaydi (o'rnatuvchi exe — 130 MB+). Shunday fayl o'sha botning o'zi nomidan,
 * lekin Telegram'ga to'g'ridan-to'g'ri (MTProto, GramJS) yuboriladi — 2 GB gacha. Buning uchun TG_API_ID va TG_API_HASH kerak
 * (qo'ng'iroq va shaxsiy Telegram uchun ham shular). Bot odatdagidek ishlayveradi: bu — uning ikkinchi seansi, xabar qabul qilmaydi.
 *
 * Seans DATA_DIR/bot-katta-fayl.session da shifrlangan saqlanadi (har yuborishda qayta kirilsa Telegram FLOOD_WAIT beradi);
 * token almashsa — eski seans tashlanadi.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { StringSession } from 'telegram/sessions/index.js';
import { env } from '../env';
import { open, seal } from '../secret';

const MB = 1024 * 1024;
/** Bot API chegarasi 50 MB; chetida yiqilmasin deb sal pastroq */
export const BOT_API_MAX = 49 * MB;
/** Telegram'ning bot uchun chegarasi 2 GB; chetida yiqilmasin deb sal pastroq */
export const BIG_FILE_MAX = 1990 * MB;
const UPLOAD_WORKERS = 8;
const SEND_TIMEOUT_MS = 30 * 60_000;
const CAPTION_MAX = 1000;

/** Sinov: haqiqiy Telegram o'rniga shu modul (default eksport — sendBigFile bilan bir xil imzo) */
const fakeSender = (): string => process.env.BIG_FILE_FAKE?.trim() ?? '';

export class BigFileError extends Error {}

export const isBig = (path: string): boolean => statSync(path).size > BOT_API_MAX;
/** Katta fayl yuborsa bo'ladimi (bo'lmasa — sababi egasiga tushunarli tilda) */
export function bigFileBlock(path: string): string | null {
  if (statSync(path).size > BIG_FILE_MAX) return 'fayl 2 GB dan katta — Telegram qabul qilmaydi';
  if (fakeSender()) return null;
  if (!env.botToken) return 'Telegram bot ulanmagan';
  if (!env.tgApiId || !env.tgApiHash) return "50 MB dan katta fayl uchun .env da TG_API_ID va TG_API_HASH kerak (my.telegram.org)";
  return null;
}

const sessionFile = () => join(env.dataDir, 'bot-katta-fayl.session');
const tokenMark = () => createHash('sha256').update(env.botToken).digest('hex').slice(0, 16);

function savedSession(): string {
  try {
    if (!existsSync(sessionFile())) return '';
    const { mark, session } = JSON.parse(open(readFileSync(sessionFile(), 'utf8'))) as { mark: string; session: string };
    return mark === tokenMark() ? session : '';
  } catch {
    return ''; // buzilgan yoki boshqa kalit bilan shifrlangan — qaytadan kiriladi
  }
}
const saveSession = (session: string): void => writeFileSync(sessionFile(), seal(JSON.stringify({ mark: tokenMark(), session })));

async function connect(): Promise<TelegramClient> {
  const client = new TelegramClient(new StringSession(savedSession()), env.tgApiId, env.tgApiHash, {
    connectionRetries: 5, deviceModel: 'Palantir', systemVersion: 'server', appVersion: '1.0',
  });
  client.setLogLevel(LogLevel.ERROR);
  await client.start({ botAuthToken: env.botToken });
  saveSession((client.session as StringSession).save());
  return client;
}

/** Bot faqat o'ziga yozgan odamni topa oladi (egasi botni ulagan — yozgan) */
async function ownerPeer(client: TelegramClient, chatId: string): Promise<Api.TypeInputPeer> {
  if (!/^\d+$/.test(chatId)) throw new BigFileError('egasining chati shaxsiy emas (guruh) — katta fayl faqat shaxsiy chatga yuboriladi');
  const users = await client.invoke(new Api.users.GetUsers({ id: [new Api.InputUser({ userId: bigInt(chatId), accessHash: bigInt.zero })] }));
  const user = users[0];
  if (!(user instanceof Api.User) || !user.accessHash) throw new BigFileError('Telegram egasini topmadi — botga bir marta yozing');
  return new Api.InputPeerUser({ userId: user.id, accessHash: user.accessHash });
}

let queue: Promise<unknown> = Promise.resolve();

async function sendNow(chatId: string, path: string, caption: string, onProgress?: (fraction: number) => void): Promise<void> {
  const fake = fakeSender();
  if (fake) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(fake).href) as { default: typeof sendNow };
    return mod.default(chatId, path, caption, onProgress);
  }
  let client: TelegramClient | null = null;
  let timer: NodeJS.Timeout | undefined;
  try {
    client = await connect();
    const peer = await ownerPeer(client, chatId);
    const sending = client.sendFile(peer, {
      file: path, caption: caption.slice(0, CAPTION_MAX), forceDocument: true, workers: UPLOAD_WORKERS,
      attributes: [new Api.DocumentAttributeFilename({ fileName: basename(path) })],
      progressCallback: onProgress ? (fraction: number) => onProgress(fraction) : undefined,
    });
    const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new BigFileError(`${SEND_TIMEOUT_MS / 60_000} daqiqada yuborilmadi`)), SEND_TIMEOUT_MS); });
    await Promise.race([sending, timeout]);
  } catch (e) {
    // Seans bekor qilingan (token almashgan, Telegram chiqarib yuborgan) — keyingi safar qaytadan kiriladi
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED|ACCESS_TOKEN/i.test((e as Error).message)) rmSync(sessionFile(), { force: true });
    throw e;
  } finally {
    clearTimeout(timer);
    await client?.destroy().catch(() => {});
  }
}

/**
 * Faylni bot nomidan egasining shaxsiy chatiga hujjat qilib yuboradi (2 GB gacha). Bir vaqtda bitta fayl — navbat bilan.
 * @param onProgress 0…1 — qancha qismi yuklangani
 */
export function sendBigFile(chatId: string, path: string, caption: string, onProgress?: (fraction: number) => void): Promise<void> {
  const block = bigFileBlock(path);
  if (block) return Promise.reject(new BigFileError(block));
  const run = queue.then(() => sendNow(chatId, path, caption, onProgress));
  queue = run.catch(() => {});
  return run;
}
