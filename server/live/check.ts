/**
 * Jonli tekshiruv: har bir ulangan kanal HAQIQIY xizmatda sinaladi — server o'zi ishlatayotgan ulanish va brauzer seansi bilan
 * (o'rnatuvchi klinikada «hammasi ishlayaptimi?» deganda; xodimdan hech narsa so'ralmaydi). Faqat o'qiladi: mijozga ham, egasiga ham
 * xabar ketmaydi (Telegram'ga — ko'rinmas «yozmoqda…» belgisi), post joylanmaydi, CRM'ga yozilmaydi.
 * Claude'ga — bitta kichik so'rov (bir sentdan kam). deep — Meta AI'ga ham savol beriladi (kunlik chegaradan bittasi, bir-ikki daqiqa).
 */
import type { LiveCheck } from '../../src/types';
import type { LiveChannel } from '../../src/lib/live';
import { iso } from '../../src/lib/week';
import { friendlyError } from '../agent';
import { ffmpegAvailable } from '../camera/stream';
import { think } from '../claude';
import { crmConnected, crmStatus, withCrm } from '../crm/index';
import { cameras, connections, type BusinessRow } from '../db';
import { diskProblem, freeMb } from '../disk';
import { env } from '../env';
import { instagramStatus, instagramUserExists } from '../inbox/instagram';
import { instagramApiStatus } from '../inbox/instagramApi';
import { telegramBusinessStatus } from '../inbox/telegramBusiness';
import { telegramUserAccount, telegramUserAvailable } from '../inbox/telegramUser';
import { MetaAiError, askMetaAi, metaAiStatus } from '../marketing/metaAi';
import { phoneProblem, phoneStatus } from '../phone/index';
import { lineChecks } from '../voice/line';

/** Bitta kanal shuncha vaqtda javob bermasa — «javob kelmadi» (Meta AI javobni uzoqroq yozadi) */
const PROBE_MS = 30_000;
const META_AI_MS = 4 * 60_000;
/** IP kameradan shuncha vaqt kadr kelmasa — uzilgan (monitor.ts bilan bir xil) */
const CAMERA_SILENT_MS = 5 * 60_000;
/** Claude javobi shuncha vaqt eslab qolinadi: tugmani qayta-qayta bosish egasining kunlik AI chegarasini yemasin */
const AI_CACHE_MS = 60_000;

type Outcome = Omit<LiveCheck, 'key' | 'label' | 'ms'>;
const ok = (detail: string): Outcome => ({ level: 'ok', detail });
const warn = (detail: string): Outcome => ({ level: 'warn', detail });
const fail = (detail: string): Outcome => ({ level: 'fail', detail });
const off = (detail = 'ulanmagan'): Outcome => ({ level: 'off', detail });

interface Probe { key: string; label: string; run: () => Promise<Outcome | Outcome[]>; timeoutMs?: number }

class Timeout extends Error {}
/** Egasiga ko'rsatiladigan sabab (tozalangan matn); boshqa xato — umumiy matn, tafsiloti jurnalga */
class ProbeError extends Error {}

async function measured(p: Probe): Promise<LiveCheck[]> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Timeout()), p.timeoutMs ?? PROBE_MS); });
  try {
    const out = await Promise.race([p.run(), limit]);
    const list = Array.isArray(out) ? out : [out];
    return list.map((o, i) => ({ key: list.length > 1 ? `${p.key}:${i}` : p.key, label: p.label, ...o, ms: Date.now() - t0 }));
  } catch (e) {
    if (!(e instanceof Timeout) && !(e instanceof ProbeError)) console.error(`[tekshiruv] ${p.key}:`, e);
    const detail = e instanceof Timeout ? `${Math.round((p.timeoutMs ?? PROBE_MS) / 1000)} soniyada javob kelmadi`
      : e instanceof ProbeError ? e.message : 'kutilmagan xato — jurnalga yozildi';
    return [{ key: p.key, label: p.label, level: 'fail', detail, ms: Date.now() - t0 }];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Kanallar ────────────────────────────────────────────────────────────────

async function disk(): Promise<Outcome> {
  const problem = diskProblem(env.dataDir, env.diskMinFreeMb);
  const free = freeMb(env.dataDir);
  if (problem) return fail(problem);
  return ok(free === null ? "bo'sh joy o'lchanmadi" : `${(free / 1024).toFixed(1)} GB bo'sh`);
}

/** Bot tokeni ishlaydimi va egasining chatiga yeta oladimi (egasi botni bloklagan bo'lsa — shu yerda bilinadi) */
async function telegramBot(biz: BusinessRow): Promise<Outcome> {
  if (!env.botToken) return off("BOT_TOKEN kiritilmagan");
  const root = env.telegramApiRoot ?? 'https://api.telegram.org';
  const call = async (method: string, body: Record<string, unknown> = {}) => {
    const r = await fetch(`${root}/bot${env.botToken}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(PROBE_MS),
    }).catch(() => null);
    if (!r) throw new ProbeError("Telegram'ga ulanib bo'lmadi — internetni tekshiring");
    const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string }; description?: string };
    // Token so'rov manzilida — xato matniga faqat Telegram javobi tushadi
    if (!j.ok) throw new ProbeError(r.status === 401 ? "bot tokeni noto'g'ri yoki bekor qilingan" : `Telegram: ${String(j.description ?? r.status).slice(0, 120)}`);
    return j.result;
  };
  const me = await call('getMe');
  const name = `@${me?.username ?? 'bot'}`;
  if (!biz.ownerChatId) return warn(`${name} ishlayapti, lekin egasi botga hali /start bosmagan`);
  try {
    await call('sendChatAction', { chat_id: biz.ownerChatId, action: 'typing' });
  } catch (e) {
    return fail(`${name} egasining chatiga yeta olmadi (${(e as Error).message}) — egasi botni bloklamaganini tekshiring`);
  }
  return ok(`${name}, egasining chatiga yetadi`);
}

const aiSeen = new Map<string, { at: number; outcome: Outcome }>();

async function claudeAi(biz: BusinessRow): Promise<Outcome> {
  if (!env.aiEnabled) return fail("ANTHROPIC_API_KEY kiritilmagan — Palantir javob bera olmaydi");
  const seen = aiSeen.get(biz.id);
  if (seen && Date.now() - seen.at < AI_CACHE_MS) return seen.outcome;
  const outcome = await pingAi(biz);
  aiSeen.set(biz.id, { at: Date.now(), outcome });
  return outcome;
}

async function pingAi(biz: BusinessRow): Promise<Outcome> {
  try {
    const r = await think(biz.id, 'owner', {
      model: env.aiModel, max_tokens: 16,
      system: 'You check that the AI service works. Reply with the single word OK.',
      messages: [{ role: 'user', content: 'ping' }],
    });
    const text = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text ? ok(`${r.model} javob berdi`) : warn(`${r.model} bo'sh javob qaytardi`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

function telegramPersonal(biz: BusinessRow): Outcome {
  const account = telegramUserAccount(biz.id);
  if (!account) return off();
  return telegramUserAvailable() ? ok(account) : fail(`${account} ulangan, lekin bu kompyuterda Telegram kalitlari (TG_API_ID) yo'q`);
}

function telegramBusiness(biz: BusinessRow): Outcome {
  const s = telegramBusinessStatus(biz.id);
  if (!s.account) return off();
  return s.canReply ? ok(s.account) : warn(`${s.account} — Telegram Business'da «javob berish» ruxsati berilmagan`);
}

/** Brauzerdagi Instagram: seans tirikmi — egasining o'z profili so'raladi (Instagram'ga bitta oddiy so'rov) */
async function instagramWeb(biz: BusinessRow): Promise<Outcome> {
  const s = instagramStatus(biz.id);
  if (!s.account) return off();
  if (s.waiting) return warn(`${s.account} — kirish oynasi ochiq, egasi hali kirmagan`);
  if (s.problem) return fail(`${s.account}: ${s.problem}`);
  const alive = await instagramUserExists(biz.id, s.account.replace(/^@/, ''));
  // Seans tugagani s.problem da bo'ladi; bu yerda — vaqtinchalik (cheklov, tarmoq): qayta kirishga undalmaydi
  if (alive === null) return warn(`${s.account}: Instagram hozir javob bermadi — birozdan keyin qayta tekshiring`);
  return alive ? ok(`${s.account}, seans tirik`) : warn(`${s.account}: Instagram bu akkauntni topmadi (nomi o'zgarganmi?)`);
}

function instagramOfficial(biz: BusinessRow): Outcome {
  if (!connections.get(biz.id, 'instagram_api')) return off();
  const s = instagramApiStatus(biz.id);
  if (s.problem) return fail(`${s.account}: ${s.problem}`);
  if (s.expiresAt && Date.parse(s.expiresAt) - Date.now() < 7 * 86_400_000) return warn(`${s.account}: kirish muddati ${s.expiresAt.slice(0, 10)} da tugaydi`);
  return ok(String(s.account));
}

const metaAiAsking = new Set<string>();

async function metaAi(biz: BusinessRow, deep: boolean): Promise<Outcome> {
  const s = metaAiStatus(biz.id);
  if (!s.connected) return off();
  if (!s.available) return fail('bu kompyuterda brauzer (Chrome yoki Edge) topilmadi');
  if (s.waiting) return warn('kirish oynasi ochiq, egasi hali kirmagan');
  if (s.problem) return fail(s.problem);
  const left = `bugun ${s.usedToday}/${s.dailyLimit} savol`;
  if (!deep) return ok(`ulangan, ${left} (savol berib ko'rish — chuqur tekshiruvda)`);
  // Oxirgi savol Marketologning o'ziga qoladi: tekshiruv kunlik chegarani tugatib qo'ymasin
  if (s.usedToday >= s.dailyLimit - 1) return warn(`ulangan, ${left} — chegara tugayapti, savol berilmadi`);
  if (metaAiAsking.has(biz.id)) return warn('oldingi tekshiruv savoli hali javob kutyapti');
  metaAiAsking.add(biz.id);
  // Vaqt chegarasi o'tsa ham brauzerdagi savol tugaguncha belgi turadi — ikkinchi savol ustma-ust ketmaydi
  const asked = askMetaAi(biz, "Bitta so'z bilan javob ber: salom").finally(() => metaAiAsking.delete(biz.id));
  try {
    const answer = await asked;
    return answer.trim() ? ok(`savolga javob berdi («${answer.trim().slice(0, 40)}»)`) : warn("javob bo'sh keldi");
  } catch (e) {
    if (e instanceof MetaAiError) return fail(e.message);
    throw e;
  }
}

/** Post joylash: haqiqiy post joylanmaydi — kerakli narsalar bormi (Instagram seansi, rasm uchun ffmpeg) */
function posting(biz: BusinessRow): Outcome {
  const ig = instagramStatus(biz.id);
  if (!ig.account && !connections.get(biz.id, 'meta_ai')) return off();
  if (!ig.account) return warn("Instagram brauzer orqali ulanmagan — postlar faqat qoralama bo'lib qoladi");
  if (ig.problem) return fail(`Instagram: ${ig.problem}`);
  if (!ffmpegAvailable()) return fail("ffmpeg yo'q — rasm Instagram o'lchamiga keltirilmaydi");
  return ok(`${ig.account} ga joylashga tayyor (haqiqiy post joylanmadi)`);
}

async function crm(biz: BusinessRow): Promise<Outcome> {
  if (!crmConnected(biz.id)) return off();
  try {
    const list = await withCrm(biz.id, c => c.appointments(iso(new Date())));
    return ok(`${crmStatus(biz.id).account ?? 'DentaCRM'}: bugun ${list.length} ta qabul`);
  } catch {
    return fail(crmStatus(biz.id).problem ?? 'DentaCRM javob bermadi');
  }
}

async function microsip(biz: BusinessRow): Promise<Outcome> {
  const s = await phoneStatus(biz);
  if (!s.available) return off('faqat Windows kompyuterda');
  if (!s.mine) return s.otherBusiness ? warn('MicroSIP boshqa biznesga ulangan') : off();
  const problem = phoneProblem(biz.id);
  if (problem) return fail(problem);
  return s.recording ? ok(`ulangan, yozuv yoqiq (${s.recordFormat ?? 'audio'})`) : warn("ulangan, lekin qo'ng'iroq yozuvi o'chiq — tahlil bo'lmaydi");
}

async function phoneLine(biz: BusinessRow): Promise<Outcome[]> {
  const list = await lineChecks(biz.id);
  return list.length ? list.map(c => (c.problem ? fail(`${c.label}: ${c.problem}`) : ok(`${c.label} ishlayapti`))) : [off()];
}

function cameraList(biz: BusinessRow): Outcome[] {
  const list = cameras.list(biz.id);
  if (!list.length) return [off('kamera qo\'shilmagan')];
  const now = Date.now();
  return list.map(cam => {
    const seen = cam.lastSeenAt ? Date.parse(cam.lastSeenAt) : 0;
    if (seen && now - seen <= CAMERA_SILENT_MS) return ok(`«${cam.name}»: kadr ${Math.max(1, Math.round((now - seen) / 1000))} soniya oldin keldi`);
    const where = cam.ip ? ` (${cam.ip})` : '';
    return cam.ip ? fail(`«${cam.name}»${where}: kadr kelmayapti — tok, tarmoq yoki manzilni tekshiring`) : warn(`«${cam.name}»: kadr kelmayapti — kamera oynasi yopiq bo'lishi mumkin`);
  });
}

async function hub(): Promise<Outcome> {
  if (!env.hub) return off('hub kodi kiritilmagan');
  const r = await fetch(`${env.hub.url}/health`, { signal: AbortSignal.timeout(PROBE_MS) }).catch(() => null);
  if (!r?.ok) return fail(`${new URL(env.hub.url).host} javob bermadi${r ? ` (${r.status})` : ''}`);
  return ok(new URL(env.hub.url).host);
}

function probes(biz: BusinessRow, deep: boolean): (Probe & { channel: LiveChannel })[] {
  return [
    { channel: 'disk', key: 'disk', label: 'Kompyuter diski', run: disk },
    { channel: 'telegram', key: 'telegram_bot', label: 'Telegram bot', run: () => telegramBot(biz) },
    { channel: 'telegram', key: 'telegram_user', label: 'Telegram (shaxsiy)', run: async () => telegramPersonal(biz) },
    { channel: 'telegram', key: 'telegram_business', label: 'Telegram Business', run: async () => telegramBusiness(biz) },
    { channel: 'ai', key: 'ai', label: 'Claude (AI)', run: () => claudeAi(biz) },
    { channel: 'instagram', key: 'instagram', label: 'Instagram (brauzer)', run: () => instagramWeb(biz) },
    { channel: 'instagram', key: 'instagram_api', label: 'Instagram (rasmiy)', run: async () => instagramOfficial(biz) },
    { channel: 'meta_ai', key: 'meta_ai', label: 'Meta AI', run: () => metaAi(biz, deep), timeoutMs: deep ? META_AI_MS : PROBE_MS },
    { channel: 'post', key: 'post', label: 'Post joylash', run: async () => posting(biz) },
    { channel: 'crm', key: 'crm', label: 'DentaCRM', run: () => crm(biz) },
    { channel: 'microsip', key: 'microsip', label: 'Telefon (MicroSIP)', run: () => microsip(biz) },
    { channel: 'line', key: 'line', label: 'Telefon liniyasi', run: () => phoneLine(biz) },
    { channel: 'camera', key: 'camera', label: 'Kameralar', run: async () => cameraList(biz) },
    { channel: 'hub', key: 'hub', label: 'Palantir Hub', run: hub },
  ];
}

const running = new Set<string>();

export class LiveBusy extends Error {}

/** Biznes kanallarini parallel sinaydi. only — faqat shu kanallar (bo'sh — hammasi) */
export async function liveCheck(biz: BusinessRow, opts: { deep?: boolean; only?: LiveChannel[] } = {}): Promise<LiveCheck[]> {
  if (running.has(biz.id)) throw new LiveBusy('Tekshiruv allaqachon ketyapti — tugashini kuting');
  running.add(biz.id);
  try {
    const chosen = probes(biz, !!opts.deep).filter(p => !opts.only?.length || opts.only.includes(p.channel));
    return (await Promise.all(chosen.map(measured))).flat();
  } finally {
    running.delete(biz.id);
  }
}
