/**
 * Jonli sinov: katta faylni (50 MB+) haqiqiy bot nomidan egasiga yuboradi (server/inbox/bigFile.ts).
 *   tsx scripts/live-bigfile.ts <fayl> [chat_id]
 * chat_id berilmasa — bazadagi birinchi egasi ulangan biznes. Kalitlar .env dan (BOT_TOKEN, TG_API_ID, TG_API_HASH).
 * O'rnatilgan Palantir sozlamalari bilan:  node --env-file=C:\Palantir\.env --import tsx scripts/live-bigfile.ts <fayl>
 */
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [file, chatArg] = process.argv.slice(2);
if (!file) { console.error('Fayl kerak: tsx scripts/live-bigfile.ts <fayl> [chat_id]'); process.exit(1); }

const { bigFileBlock, sendBigFile } = await import('../server/inbox/bigFile');
const { env } = await import('../server/env');

/** Baza faqat o'qiladi (server/db import qilinmaydi: u bazani ochib, migratsiya yurgizadi — ishlab turgan Palantir bazasiga tegmaslik uchun) */
function firstOwnerChat(): string | undefined {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(join(env.dataDir, 'palantir.db'), { readOnly: true });
  try { return (db.prepare('SELECT owner_chat_id FROM businesses WHERE owner_chat_id IS NOT NULL LIMIT 1').get() as { owner_chat_id?: string } | undefined)?.owner_chat_id; } finally { db.close(); }
}
const chatId = chatArg ?? firstOwnerChat();
if (!chatId) { console.error('Egasi ulangan biznes topilmadi — chat_id ni qo\'lda bering'); process.exit(1); }
const block = bigFileBlock(file);
if (block) { console.error(`Yuborib bo'lmaydi: ${block}`); process.exit(1); }

const mb = Math.round(statSync(file).size / 1024 / 1024);
const started = Date.now();
let shown = -1;
await sendBigFile(chatId, file, `Sinov: ${basename(file)} (${mb} MB)`, fraction => {
  const percent = Math.floor(fraction * 10) * 10;
  if (percent !== shown) { shown = percent; console.log(`  ${percent}%  (${Math.round((Date.now() - started) / 1000)} s)`); }
});
console.log(`Yuborildi: ${basename(file)}, ${mb} MB, ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(0);
