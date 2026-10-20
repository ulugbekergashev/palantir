/**
 * O'rnatishdan keyingi tekshiruv:  npm run check
 *
 * Har bir kalit va sozlama HAQIQIY xizmatda sinab ko'riladi — egasi birinchi xabarni yozishidan oldin:
 * Telegram bot (token, boshqa joyda band emasligi), Claude (kalit, hisobdagi mablag', model va server yuboradigan so'rov shakllari),
 * ovoz kalitlari, brauzer, papka, disk, port. Maxfiy qiymatlar ekranga chiqmaydi.
 * Claude tekshiruvi ikki kichik so'rov yuboradi (bir necha sent). O'tkazib yuborish: npm run check -- --no-ai
 */
import '../server/tz';
// Ulash ustasida kiritilgan kalitlar (bazada shifrlangan) .env ustidan qo'yiladi — server ishlatadiganining o'zi tekshiriladi
import '../server/keys';
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { friendlyError } from '../server/agent';
import { FALLBACK, claude } from '../server/claude';
import { env, voiceEnabled } from '../server/env';
import { ffmpegAvailable } from '../server/camera/stream';
import { instagramAvailable } from '../server/inbox/instagram';
import { REPLIER_SHAPES } from '../server/inbox/replier';
import { toolDefinitions } from '../server/tools';

type Level = 'ok' | 'warn' | 'fail';
// Oddiy belgilar: Windows buyruq oynasi emoji'ni ko'rsatmaydi
const MARK: Record<Level, string> = { ok: '[ OK ]', warn: '[  ! ]', fail: '[XATO]' };
const counts: Record<Level, number> = { ok: 0, warn: 0, fail: 0 };
const say = (level: Level, title: string, detail = '') => {
  counts[level]++;
  process.stdout.write(`${MARK[level]} ${title}${detail ? ` — ${detail}` : ''}\n`);
};

const TIMEOUT_MS = 20_000;
const MIN_FREE_GB = 2;
const MAX_CLOCK_DRIFT_MS = 2 * 60_000;
const MIN_ADMIN_PASSWORD = 10;
const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
const reason = (e: unknown) => ((e as Error).name === 'TimeoutError' ? 'javob kelmadi (internetni tekshiring)' : (e as Error).message);

// ─── Kompyuter va papkalar ───────────────────────────────────────────────────

function local(): void {
  const major = Number(process.versions.node.split('.')[0]);
  say(major >= 24 ? 'ok' : 'fail', `Node.js ${process.versions.node}`, major >= 24 ? '' : '24 yoki yangirog\'i kerak (nodejs.org)');
  say(existsSync('.env') ? 'ok' : 'fail', '.env fayli', existsSync('.env') ? '' : 'topilmadi: .env.example dan nusxa oling va kalitlarni kiriting');
  say(existsSync(resolve('dist/index.html')) ? 'ok' : 'fail', 'Panel yig\'ilgan (dist)', existsSync(resolve('dist/index.html')) ? '' : 'npm run build ni yuriting');
  const model = existsSync(resolve('dist/models/ssdlite_mobilenet_v2/model.json'));
  say(model ? 'ok' : 'warn', 'Kamera modeli', model ? '' : 'yo\'q — kamera nazorati ishlamaydi: npm run camera:model, keyin npm run build');

  try {
    const probe = join(env.dataDir, `.tekshiruv-${process.pid}`);
    mkdirSync(env.dataDir, { recursive: true });
    writeFileSync(probe, 'ok');
    rmSync(probe);
    const fs = statfsSync(env.dataDir);
    const freeGb = Number(fs.bavail) * Number(fs.bsize) / 1024 ** 3;
    say(freeGb >= MIN_FREE_GB ? 'ok' : 'warn', `Ma'lumotlar papkasi: ${env.dataDir}`, `bo'sh joy ${freeGb.toFixed(1)} GB${freeGb >= MIN_FREE_GB ? '' : ' — kam'}`);
  } catch (e) {
    say('fail', `Ma'lumotlar papkasi: ${env.dataDir}`, `yozib bo'lmadi: ${(e as Error).message}`);
  }
  const inRepo = env.dataDir.startsWith(resolve('.'));
  say(inRepo ? 'warn' : 'ok', 'Ma\'lumotlar dastur papkasidan tashqarida', inRepo ? 'DATA_DIR dastur papkasi ichida — dasturni yangilaganda o\'chib ketmasin: masalan DATA_DIR=C:\\PalantirData' : '');
  say(env.backupKeep > 0 ? 'ok' : 'warn', 'Zaxira nusxa', env.backupKeep > 0 ? `har kuni, ${env.backupKeep} kun saqlanadi: ${env.backupDir}` : 'o\'chirilgan (BACKUP_KEEP=0)');

  if (!env.adminPassword) say('warn', 'ADMIN_PASSWORD', 'berilmagan — admin sahifasi yopiq, yangi biznes qo\'shib bo\'lmaydi');
  else say(env.adminPassword.length >= MIN_ADMIN_PASSWORD ? 'ok' : 'warn', 'ADMIN_PASSWORD', env.adminPassword.length >= MIN_ADMIN_PASSWORD ? '' : `qisqa — kamida ${MIN_ADMIN_PASSWORD} belgi qiling`);
  say(env.listenHost ? 'ok' : 'warn', `Tinglash manzili: ${env.listenHost || 'hamma tarmoq'}`,
    env.listenHost ? '' : 'panel tarmoqdagi har qanday qurilmadan ochiladi (parol shifrsiz ketadi). Klinika kompyuterida LISTEN_HOST=127.0.0.1 qiling');
}

async function port(): Promise<void> {
  const health = await get(`http://127.0.0.1:${env.port}/api/health`).then(r => (r.ok ? r.json() as Promise<{ ok?: boolean }> : null)).catch(() => null);
  if (health?.ok) return say('ok', `Port ${env.port}`, 'Palantir hozir ishlab turibdi');
  const free = await new Promise<boolean>(done => {
    const s = createServer();
    s.once('error', () => done(false));
    s.listen(env.port, env.listenHost || undefined, () => s.close(() => done(true)));
  });
  say(free ? 'ok' : 'fail', `Port ${env.port}`, free ? 'bo\'sh' : 'boshqa dastur band qilgan — .env da PORT ni o\'zgartiring');
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function telegram(): Promise<void> {
  if (!env.botToken) return say('fail', 'Telegram bot', "BOT_TOKEN berilmagan (@BotFather → /newbot) — panelda kiriting: http://localhost:3200/#/ulash");
  const api = `${env.telegramApiRoot ?? 'https://api.telegram.org'}/bot${env.botToken}`;
  try {
    const r = await get(`${api}/getMe`);
    const j = await r.json() as { ok: boolean; result?: { username: string }; description?: string };
    if (!j.ok) return say('fail', 'Telegram bot', r.status === 401 ? 'token noto\'g\'ri yoki bekor qilingan' : `Telegram rad etdi: ${j.description ?? r.status}`);
    say('ok', `Telegram bot: @${j.result?.username}`);
    const drift = Math.abs(Date.now() - Date.parse(r.headers.get('date') ?? ''));
    if (Number.isFinite(drift)) say(drift <= MAX_CLOCK_DRIFT_MS ? 'ok' : 'warn', 'Kompyuter soati', drift <= MAX_CLOCK_DRIFT_MS ? `${Intl.DateTimeFormat().resolvedOptions().timeZone}` : `${Math.round(drift / 60_000)} daqiqa farq qiladi — eslatmalar noto'g'ri vaqtda keladi: soatni to'g'rilang`);
    const hook = await (await get(`${api}/getWebhookInfo`)).json() as { result?: { url?: string } };
    if (hook.result?.url) say('fail', 'Bot boshqa joyga ulangan', 'webhook o\'rnatilgan — bu tokenni boshqa dastur ishlatyapti. Yangi bot oching yoki u yerdan uzing');
  } catch (e) {
    say('fail', 'Telegram bot', `ulanib bo'lmadi: ${reason(e)}`);
  }
}

// ─── Claude ──────────────────────────────────────────────────────────────────

async function ai(skip: boolean): Promise<void> {
  if (!env.aiEnabled) return say('fail', 'Claude', "ANTHROPIC_API_KEY berilmagan (platform.claude.com → API keys) — panelda kiriting: http://localhost:3200/#/ulash");
  if (skip) return say('warn', 'Claude', 'kalit bor, lekin tekshirilmadi (--no-ai)');
  const used = (u: Anthropic.Beta.BetaUsage) => `${u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)} kirish, ${u.output_tokens} chiqish tokeni`;
  // Server yuboradigan so'rovlarning o'zi: asboblar, kesh, o'ylash, zaxira model — biror maydon rad etilsa shu yerda ko'rinadi
  try {
    const res = await claude().beta.messages.create({
      model: env.aiModel, max_tokens: 2000,
      system: 'This is an installation check. Reply with the single word OK and call no tools.',
      tools: toolDefinitions(env.webSearch, true),
      messages: [{ role: 'user', content: 'Check.' }],
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      ...FALLBACK,
    });
    say('ok', `Claude — yordamchi (${res.model})`, used(res.usage));
  } catch (e) {
    return say('fail', 'Claude — yordamchi', `${friendlyError(e)}${e instanceof Anthropic.APIError ? ` [${e.status ?? 'aloqa'}: ${e.message.slice(0, 200)}]` : ''}`);
  }
  try {
    const res = await claude().beta.messages.create({
      model: env.aiModel, max_tokens: 8000,
      system: REPLIER_SHAPES.clinicSystem,
      messages: [{ role: 'user', content: '<business_profile>\nName: Tekshiruv klinikasi\nIndustry: stomatologiya\n</business_profile>\n\n<conversation>\n[01-01 10:00] Customer: Assalomu alaykum\n</conversation>\n\nDecide how to answer the customer\'s latest message(s).' }],
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLIER_SHAPES.clinic } },
      ...FALLBACK,
    });
    const text = res.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map(b => b.text).join('');
    const reply = (JSON.parse(text) as { action?: string; reply?: string });
    say(reply.action ? 'ok' : 'fail', 'Claude — mijozlarga javob', reply.action ? `${used(res.usage)}; javob: «${String(reply.reply).slice(0, 80)}»` : 'javob kutilgan shaklda emas');
  } catch (e) {
    say('fail', 'Claude — mijozlarga javob', `${friendlyError(e)}${e instanceof Anthropic.APIError ? ` [${e.status ?? 'aloqa'}: ${e.message.slice(0, 200)}]` : ` [${(e as Error).message.slice(0, 200)}]`}`);
  }
}

// ─── Qo'shimcha kanallar ─────────────────────────────────────────────────────

async function extras(): Promise<void> {
  if (!voiceEnabled()) say('warn', 'Ovozli xabarlar', "o'chiq: VOICELAB_API_KEY (voicelab.uz → Dasturchi), GEMINI_API_KEY (aistudio.google.com, bepul) yoki GROQ_API_KEY kiriting");
  if (env.voicelabKey) {
    const ok = await get(`${env.voicelabUrl}/v1/stt/transcriptions`, { authorization: `Bearer ${env.voicelabKey}` }).then(r => r.status, reason);
    say(ok === 200 ? 'ok' : 'fail', 'Ovoz: VoiceLab kaliti', ok === 200 ? '' : `ishlamadi (${ok}) — kalitda «stt» ruxsati bormi?`);
  }
  if (env.geminiKey) {
    const ok = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': env.geminiKey }).then(r => r.status, reason);
    say(ok === 200 ? 'ok' : 'fail', 'Ovoz: Gemini kaliti', ok === 200 ? '' : `ishlamadi (${ok})`);
  }
  if (env.groqKey) {
    const ok = await get('https://api.groq.com/openai/v1/models', { authorization: `Bearer ${env.groqKey}` }).then(r => r.status, reason);
    say(ok === 200 ? 'ok' : 'fail', 'Ovoz: Groq kaliti', ok === 200 ? '' : `ishlamadi (${ok})`);
  }
  say(env.tgApiId && env.tgApiHash ? 'ok' : 'warn', 'Shaxsiy Telegram', env.tgApiId && env.tgApiHash ? 'yoqilgan (egasi panelda kod bilan ulaydi)' : 'o\'chiq: my.telegram.org → API development tools dan TG_API_ID va TG_API_HASH oling');
  if (env.speechlabKey) {
    const r = await get(`${env.speechlabUrl}/agents`, { authorization: `Bearer ${env.speechlabKey}` }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) as { agents?: { id: number; name: string; default?: boolean }[] } }), e => ({ status: reason(e), body: {} as { agents?: { id: number; name: string; default?: boolean }[] } }));
    const agent = r.body.agents?.find(a => env.speechlabAgentId ? a.id === env.speechlabAgentId : a.default);
    say(r.status === 200 && agent ? 'ok' : 'fail', "Qo'ng'iroq bilan eslatish (SpeechLab)", r.status === 200 ? (agent ? `agent «${agent.name}» (balans va telefon liniyasini panelda tekshiring)` : "agent topilmadi — CallAgent'da agentni yoqing") : `kalit ishlamadi (${r.status})`);
  } else say('warn', "Qo'ng'iroq bilan eslatish", "o'chiq — eslatmalar Telegram'da (ovozli xabar bilan) keladi");
  say(ffmpegAvailable() ? 'ok' : 'warn', 'IP kameralar (ffmpeg)', ffmpegAvailable() ? 'ffmpeg topildi' : "ffmpeg yo'q — IP kameralar ishlamaydi (veb-kamera ishlaydi): winget install Gyan.FFmpeg, keyin oynani qayta oching");
  say(instagramAvailable() ? 'ok' : 'warn', 'Instagram (brauzer)', instagramAvailable() ? 'Chrome yoki Edge topildi (egasi panelda bir marta kiradi)' : 'Chrome yoki Edge topilmadi — o\'rnating yoki IG_BROWSER da yo\'lini bering');
}

process.stdout.write('Palantir — o\'rnatish tekshiruvi\n\n');
local();
await port();
await telegram();
await ai(process.argv.includes('--no-ai'));
await extras();
process.stdout.write(`\nNatija: ${counts.ok} ta joyida, ${counts.warn} ta ogohlantirish, ${counts.fail} ta xato.\n${counts.fail ? 'Xatolarni tuzatib, qayta tekshiring: npm run check' : 'Ishga tushirish mumkin.'}\n`);
process.exit(counts.fail ? 1 : 0);
