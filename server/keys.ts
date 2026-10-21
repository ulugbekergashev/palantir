/**
 * Server kalitlari: bot tokeni, Claude, ovoz xizmatlari, shaxsiy Telegram. Avval faqat .env da turardi — o'rnatuvchi faylni
 * Bloknotda tahrirlab, serverni qayta yoqardi. Endi ulash ustasida kiritiladi: kalit haqiqiy xizmatda tekshiriladi, shifrlanib
 * bazada saqlanadi va server to'xtamasdan kuchga kiradi (bot qayta ulanadi, Claude mijozi yangilanadi).
 * Panelda kiritilgan qiymat .env dagidan ustun; panelda o'chirilsa — .env dagisi qaytadi.
 */
import { KEYS, classifyLine, isKeyName, keyInfo, maskSecret, type KeyName } from '../src/lib/secrets';
import type { KeyCheck, KeyView } from '../src/types';
import { settings } from './db';
import { env } from './env';
import { open, seal } from './secret';
import { parseHubCode } from '../src/lib/hubCode';


const fromEnv = Object.fromEntries(KEYS.map(k => [k.name, process.env[k.name]?.trim() ?? ''])) as Record<KeyName, string>;
const stored = new Map<KeyName, { value: string; updatedAt: string }>();

for (const row of settings.all()) {
  if (!isKeyName(row.name)) continue;
  try {
    stored.set(row.name, { value: open(row.value), updatedAt: row.updatedAt });
  } catch {
    // SESSION_SECRET (yoki data/session.secret) almashgan: eski kalitni ochib bo'lmaydi — .env dagisi ishlaydi, panelda qayta kiritiladi
    console.error(`[kalitlar] ${row.name} ochilmadi — maxfiy kalit almashganmi? Panelda qayta kiriting`);
  }
}

const valueOf = (name: KeyName): string => stored.get(name)?.value ?? fromEnv[name];

/** Kalitni server sozlamasiga qo'yadi: env (dastur o'qiydigan joy) va process.env (Anthropic kutubxonasi o'zi o'qiydi) */
function apply(name: KeyName): void {
  const v = valueOf(name);
  if (v) process.env[name] = v;
  else delete process.env[name];
  switch (name) {
    case 'BOT_TOKEN': env.botToken = v; break;
    case 'ANTHROPIC_API_KEY': env.aiEnabled = !!(v || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.AI_DISABLED !== '1'; break;
    case 'GEMINI_API_KEY': env.geminiKey = v; break;
    case 'GROQ_API_KEY': env.groqKey = v; break;
    case 'VOICELAB_API_KEY': env.voicelabKey = v; break;
    case 'SPEECHLAB_API_KEY': env.speechlabKey = v; break;
    case 'TG_API_ID': env.tgApiId = Number(v) || 0; break;
    case 'TG_API_HASH': env.tgApiHash = v; break;
    case 'PALANTIR_HUB': env.hub = v ? parseHubCode(v) : null; break;
  }
}
for (const k of KEYS) apply(k.name);

type Listener = (name: KeyName) => void | Promise<void>;
const listeners: Listener[] = [];
/** Kalit almashganda qayta ulanadiganlar (bot, Claude mijozi, shaxsiy Telegram) shu yerga yoziladi */
export const onKeyChange = (fn: Listener): void => { listeners.push(fn); };
async function changed(name: KeyName): Promise<void> {
  for (const fn of listeners) {
    try { await fn(name); } catch (e) { console.error(`[kalitlar] ${name} almashgach qayta ulanmadi:`, (e as Error).message); }
  }
}

export function keyList(): KeyView[] {
  return KEYS.map(k => {
    const v = valueOf(k.name);
    const panel = stored.get(k.name);
    return { name: k.name, label: k.label, where: k.where, required: !!k.required, source: panel ? 'panel' : v ? 'env' : null, masked: v ? maskSecret(v) : null, updatedAt: panel?.updatedAt ?? null };
  });
}

const MAX_KEY_CHARS = 400;
/** Ko'rinishi to'g'rimi (tarmoqqa chiqmasdan). Xato bo'lsa — egasiga tushunarli sabab */
export function keyFormatError(name: KeyName, value: string): string | null {
  if (!value || value.length > MAX_KEY_CHARS || /\s/.test(value)) return `${keyInfo(name).label} bo'sh yoki ichida bo'sh joy bor — qayta nusxalang`;
  if (name === 'TG_API_ID') return /^\d{3,10}$/.test(value) ? null : 'Telegram API ID faqat raqamlardan iborat (my.telegram.org dagi «App api_id»)';
  if (name === 'VOICELAB_API_KEY') return value.length >= 16 ? null : 'VoiceLab kaliti juda qisqa — butunlay nusxalang';
  const c = classifyLine(value);
  if (c?.kind !== 'key' || c.key !== name) return `Bu ${keyInfo(name).label.toLowerCase()}ga o'xshamaydi${c?.kind === 'key' ? ` — bu ${c.label.toLowerCase()}` : ''}`;
  return c.error ?? null;
}

// ─── Haqiqiy xizmatda tekshirish ─────────────────────────────────────────────

const TIMEOUT_MS = 15_000;
const call = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
const offline = (e: unknown): KeyCheck => ({
  ok: false, canForce: true,
  error: (e as Error).name === 'TimeoutError' ? 'Javob kelmadi — internetni tekshiring' : `Xizmatga ulanib bo'lmadi: ${(e as Error).message}`,
});
const errorText = async (r: Response): Promise<string> => {
  const j = await r.json().catch(() => ({})) as { error?: { message?: string } | string; description?: string; message?: string };
  return String((typeof j.error === 'object' ? j.error?.message : j.error) ?? j.description ?? j.message ?? r.status);
};

async function checkBot(token: string): Promise<KeyCheck> {
  const api = `${env.telegramApiRoot ?? 'https://api.telegram.org'}/bot${token}`;
  const r = await call(`${api}/getMe`);
  const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string }; description?: string };
  if (!j.ok) {
    if (r.status === 401 || r.status === 404) return { ok: false, canForce: false, error: "Token noto'g'ri yoki bekor qilingan: @BotFather → /mybots → bot → API Token'dan qayta nusxalang" };
    return { ok: false, canForce: true, error: `Telegram rad etdi: ${j.description ?? r.status}` };
  }
  const hook: { result?: { url?: string } } = await call(`${api}/getWebhookInfo`).then(x => x.json()).catch(() => ({}));
  if (hook.result?.url) return { ok: false, canForce: true, error: `@${j.result?.username} boshqa dasturga ulangan (webhook bor): u yerdan uzing yoki yangi bot oching` };
  return { ok: true, info: `@${j.result?.username} ulandi` };
}

async function checkClaude(key: string): Promise<KeyCheck> {
  // Bitta harfli javob: hisobda mablag' borligi va model shu kalitga ochiqligi ham tekshiriladi (bir sentning mingdan biri)
  const r = await call(`${env.anthropicRoot}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.aiModel, max_tokens: 1, system: 'Key check. Reply with OK.', messages: [{ role: 'user', content: 'OK' }] }),
  });
  if (r.ok) return { ok: true, info: `Kalit ishlayapti (${env.aiModel})` };
  const why = await errorText(r);
  if (r.status === 401) return { ok: false, canForce: false, error: "Kalit noto'g'ri yoki o'chirilgan — platform.claude.com → API keys'dan yangisini oling" };
  if (r.status === 403) return { ok: false, canForce: false, error: `Kalitga ruxsat yo'q: ${why}` };
  if (r.status === 400 && /credit|balance/i.test(why)) return { ok: false, canForce: true, error: "Kalit to'g'ri, lekin Claude hisobida mablag' yo'q: platform.claude.com → Billing'da to'ldiring" };
  if (r.status === 404) return { ok: false, canForce: true, error: `${env.aiModel} modeli bu kalitga ochiq emas` };
  if (r.status === 429) return { ok: true, info: 'Kalit ishlayapti', warn: "Hozir so'rovlar chegarasiga tegdi — biroz kutib ishlaydi" };
  return { ok: false, canForce: true, error: `Claude hozir javob bermadi (${r.status}) — keyinroq tekshiring` };
}

/** Oddiy «kalit ishlaydimi» so'rovi: 200 — ishlaydi, 400/401/403 — kalit yaroqsiz, boshqasi — tekshirib bo'lmadi */
async function checkGet(url: string, headers: Record<string, string>, info: string): Promise<KeyCheck> {
  const r = await call(url, { headers });
  if (r.ok) return { ok: true, info };
  if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, canForce: false, error: `Kalit ishlamadi: ${await errorText(r)}` };
  return { ok: false, canForce: true, error: `Xizmat javob bermadi (${r.status})` };
}

export async function checkKey(name: KeyName, value: string): Promise<KeyCheck> {
  try {
    switch (name) {
      case 'BOT_TOKEN': return await checkBot(value);
      case 'ANTHROPIC_API_KEY': return await checkClaude(value);
      case 'GEMINI_API_KEY': return await checkGet(`${env.geminiApiRoot}/v1beta/models?pageSize=1`, { 'x-goog-api-key': value }, "Ishlayapti: ovozli xabarlarni matnga o'giradi");
      case 'GROQ_API_KEY': return await checkGet(`${env.groqApiRoot}/openai/v1/models`, { authorization: `Bearer ${value}` }, "Ishlayapti: zaxira ovoz o'giruvchi");
      case 'VOICELAB_API_KEY': return await checkGet(`${env.voicelabUrl}/v1/stt/transcriptions`, { authorization: `Bearer ${value}` }, "Ishlayapti: o'zbek ovozi");
      case 'SPEECHLAB_API_KEY': return await checkGet(`${env.speechlabUrl}/agents`, { authorization: `Bearer ${value}` }, "Ishlayapti: qo'ng'iroq qilib eslatadi");
      case 'TG_API_ID':
      case 'TG_API_HASH': return { ok: true, info: 'Saqlandi: egasining raqami bilan ulanganda tekshiriladi' };
      case 'PALANTIR_HUB': {
        const hub = parseHubCode(value)!;
        return await checkGet(`${hub.url}/api/ping`, { authorization: `Bearer ${hub.key}` }, "Ishlayapti: Hub klinikani tanidi — rasmiy Instagram'ni ulash mumkin");
      }
    }
  } catch (e) {
    return offline(e);
  }
}

export type SetResult = { ok: true; key: KeyView; check: KeyCheck } | { ok: false; error: string; canForce: boolean };

/** Kalitni tekshiradi va saqlaydi. force — tekshirib bo'lmagan (internet, xizmat band) yoki mablag'i yo'q kalitni baribir saqlash */
export async function setKey(name: KeyName, raw: string, force = false): Promise<SetResult> {
  const value = raw.trim();
  const bad = keyFormatError(name, value);
  if (bad) return { ok: false, error: bad, canForce: false };
  const check = await checkKey(name, value);
  if (!check.ok && !(force && check.canForce)) return { ok: false, error: check.error, canForce: check.canForce };
  const updatedAt = new Date().toISOString();
  settings.set(name, seal(value));
  stored.set(name, { value, updatedAt });
  apply(name);
  await changed(name);
  return { ok: true, key: keyList().find(k => k.name === name)!, check };
}

/** Panelda kiritilgan kalitni o'chiradi: .env da bo'lsa — o'sha qaytadi */
export async function removeKey(name: KeyName): Promise<KeyView> {
  settings.remove(name);
  stored.delete(name);
  apply(name);
  await changed(name);
  return keyList().find(k => k.name === name)!;
}
