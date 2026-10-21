/** Serverning o'zi: tiklash → port → bot va kanallar (fonda). index.ts qulf olingach yuklaydi */
// Birinchi: ulash ustasida kiritilgan kalitlar .env ustidan qo'yiladi — qolgan modullar yuklanganda ular tayyor turadi
import { onKeyChange } from './keys';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { startBackups } from './backup';
import { swappableBot } from './bot';
import { resetClaude } from './claude';
import { env, voiceEnabled } from './env';
import { createApp } from './http';
import { ffmpegAvailable, stopCameraEngine } from './camera/stream';
import { flushAllWaits } from './camera/waiting';
import { recoverMoney } from './crm/actions';
import { closeDb, notices } from './db';
import { recoverBookings } from './inbox/core';
import { instagramAvailable, startInstagram, stopInstagram } from './inbox/instagram';
import { startInstagramApi, stopInstagramApi } from './inbox/instagramApi';
import { refreshTelegramUser, startTelegramUser, stopTelegramUser, telegramUserAvailable } from './inbox/telegramUser';
import { startScheduler } from './scheduler';
import { startPhone, startRecordingRetention, stopPhone } from './phone/index';
import { startMonitor } from './monitor';
import { startHeartbeat } from './heartbeat';
import { startLicenseReminder } from './license';
import { startOrders } from './orders/run';
import { startVoiceEnv } from './voice/serviceEnv';

/** Bot nomini shuncha kutamiz; Telegram javob bermasa — server baribir ko'tariladi, bot fonda ulanadi */
const BOT_WAIT_MS = 3_000;
/** To'xtashda kanallar (brauzer, Telegram seansi) yopilishini shuncha kutamiz */
const CLOSE_WAIT_MS = 4_000;

/** Portni ochadi. Band bo'lsa — chiqadi: "ishladi" deb yozib, hech narsa tinglamay qolmasin */
function listen(app: Express): Promise<Server> {
  return new Promise(resolve => {
    const ready = (err?: Error) => {
      if (!err) return resolve(server);
      console.error(`[server] ${env.listenHost || '*'}:${env.port} ochilmadi:`, err.message);
      process.exit(1);
    };
    const server: Server = env.listenHost ? app.listen(env.port, env.listenHost, ready) : app.listen(env.port, ready);
  });
}

const bot = swappableBot();
// Kalit almashdi — server to'xtamasdan kuchga kiradi
onKeyChange(async name => {
  if (name === 'BOT_TOKEN') await bot.reload();
  if (name === 'ANTHROPIC_API_KEY') resetClaude();
  if (name === 'TG_API_ID' || name === 'TG_API_HASH') refreshTelegramUser();
});
// Tiklash — bot xabar qabul qila boshlashidan OLDIN: aks holda kutib turgan «Tasdiqlash» bosilishi endigina boshlangan yozuvni «to'xtab qolgan» deb belgilab qo'yardi.
// Tarmoqqa chiqilmaydi: egasiga aytiladigan gaplar bazadagi navbatga yoziladi va bot ulangach yuboriladi (internet kech kelsa ham yo'qolmaydi)
for (const r of recoverMoney()) notices.add(r.businessId, `⚠️ <b>${r.title}</b>\n${r.note ?? ''}`);
recoverBookings();
// Port — tarmoqqa bog'liq ishlardan oldin: internet bo'lmasa ham panel ochiladi, port band bo'lsa bot navbatiga tegilmaydi
const server = await listen(createApp(bot));
if (env.dryRun) {
  // Yangilovchining sinovi: tashqi dunyoga hech narsa ulanmaydi, yangilovchi tekshirib bo'lgach jarayonni to'xtatadi
  console.log(`Palantir sinov rejimida: http://localhost:${env.port}`);
  await new Promise<never>(() => {});
}
await Promise.race([bot.start(), new Promise(r => setTimeout(r, BOT_WAIT_MS))]);
// Rasmiy Instagram (hub orqali) birinchi: ikkalasi ulangan biznesda javob rasmiy yo'l bilan ketadi
startInstagramApi();
startInstagram();
startTelegramUser();
const stopScheduler = startScheduler(bot);
// Xodimlarga berilgan topshiriqlar: jadvaldagi ish, AI ko'zi, kamera qoidalari
const stopOrders = startOrders(bot);
// Ovoz xizmati (Python) panelda kiritilgan kalitlarni va ovozli agent kalitini shu fayldan oladi
const stopVoiceEnv = startVoiceEnv();
// MicroSIP shu kompyuterda ulangan bo'lsa — qo'ng'iroq hodisalari va yozuvlar o'qiladi
startPhone();
const stopRetention = startRecordingRetention();
const stopBackups = startBackups();
// Kanallar nazorati: CRM, rasmiy Instagram va hub, MicroSIP, IP kameralar — uzilsa egasiga aytiladi
const stopMonitor = startMonitor();
// Hub kodi bo'lsa: holat 5 daqiqada (kompyuter o'chsa hub sotuvchiga aytadi)
const stopHeartbeat = startHeartbeat();
// Litsenziya: internet yoki hub uzoq bo'lmasa ham egasiga aytiladi (kuniga bir marta)
const stopLicense = startLicenseReminder();

const open = !env.listenHost || env.listenHost === '0.0.0.0' || env.listenHost === '::';
console.log(`Palantir server: http://localhost:${env.port}${open ? ' (hamma tarmoq interfeyslari)' : ` (${env.listenHost})`}`);
console.log(`  bot:  ${!bot.enabled ? "o'chiq (BOT_TOKEN yo'q)" : bot.username() ? `@${bot.username()}` : "ulanmoqda (Telegram hozircha javob bermadi — o'zi qayta urinadi)"}`);
console.log(`  AI:   ${env.aiEnabled ? `${env.aiModel}${env.webSearch ? ' + internetdan qidirish' : ''}` : "o'chiq (ANTHROPIC_API_KEY yo'q)"}`);
console.log(`  ovoz: ${voiceEnabled() ? [env.voicelabKey && 'VoiceLab', env.geminiKey && 'Gemini', env.groqKey && 'Groq'].filter(Boolean).join(' → ') : "o'chiq (VOICELAB_API_KEY / GEMINI_API_KEY / GROQ_API_KEY yo'q)"}`);
console.log(`  shaxsiy Telegram: ${telegramUserAvailable() ? 'yoqilgan' : !env.tgPersonal ? "o'chiq (keyinga qoldirilgan — TG_PERSONAL=1)" : "o'chiq (TG_API_ID / TG_API_HASH yo'q)"}`);
const igBrowser = instagramAvailable() ? 'brauzer orqali' : env.igViaBrowser ? "brauzer: Chrome yoki Edge topilmadi — IG_BROWSER" : '';
const igOfficial = env.hub ? `rasmiy (hub: ${new URL(env.hub.url).host})` : '';
console.log(`  Instagram: ${[igOfficial, igBrowser].filter(Boolean).join(' + ') || "o'chiq (Palantir Hub kodi yo'q)"}`);
console.log(`  IP kameralar: ${ffmpegAvailable() ? 'yoqilgan (ffmpeg bor)' : "o'chiq (ffmpeg topilmadi — FFMPEG_PATH)"}`);
console.log(`  baza: ${env.dbFile}`);

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  stopScheduler();
  stopOrders();
  stopVoiceEnv();
  stopBackups();
  stopPhone();
  stopRetention();
  stopMonitor();
  stopHeartbeat();
  stopLicense();
  stopInstagramApi();
  bot.stop();
  flushAllWaits();
  stopCameraEngine();
  // Brauzer (Instagram) va Telegram seansi yopilishi kutiladi: chala yopilgan brauzer keyingi ishga tushishda profilni band qilib turardi
  const closed = Promise.race([Promise.allSettled([stopTelegramUser(), stopInstagram()]), new Promise(r => setTimeout(r, CLOSE_WAIT_MS))]);
  server.close(() => {
    void closed.then(() => {
      closeDb();
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), CLOSE_WAIT_MS + 2_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Nazoratchi (scripts/supervise.mjs) tinch to'xtatishni shu yo'l bilan so'raydi: Windows'da jarayonga signal yuborib bo'lmaydi
process.on('message', m => { if (m === 'stop') shutdown(); });
