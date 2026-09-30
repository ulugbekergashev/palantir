import './tz';
import { createBot } from './bot';
import { closeDb } from './db';
import { env, voiceEnabled } from './env';
import { createApp } from './http';
import { startScheduler } from './scheduler';

const bot = createBot();
try {
  await bot.start();
} catch (e) {
  console.error('[bot] ulanmadi — BOT_TOKEN ni tekshiring:', (e as Error).message);
}
const app = createApp(bot);
const server = app.listen(env.port, () => {
  console.log(`Cerebro server: http://localhost:${env.port}`);
  console.log(`  bot:  ${bot.enabled && bot.username() ? `@${bot.username()}` : "o'chiq (BOT_TOKEN yo'q)"}`);
  console.log(`  AI:   ${env.aiEnabled ? `${env.aiModel}${env.webSearch ? ' + internetdan qidirish' : ''}` : "o'chiq (ANTHROPIC_API_KEY yo'q)"}`);
  console.log(`  ovoz: ${voiceEnabled() ? [env.geminiKey && 'Gemini', env.groqKey && 'Groq'].filter(Boolean).join(' → ') : "o'chiq (GEMINI_API_KEY / GROQ_API_KEY yo'q)"}`);
  console.log(`  baza: ${env.dbFile}`);
});
const stopScheduler = startScheduler(bot);

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  stopScheduler();
  bot.stop();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
