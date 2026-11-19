// Sinov: haqiqiy Telegram o'rniga (server/inbox/bigFile.ts, BIG_FILE_FAKE). Chaqiruvlarni BIG_FILE_FAKE_LOG ga yozadi.
import { appendFileSync } from 'node:fs';

function note(row) {
  if (process.env.BIG_FILE_FAKE_LOG) appendFileSync(process.env.BIG_FILE_FAKE_LOG, `${JSON.stringify(row)}\n`);
}

export default async function send(chatId, path, caption, onProgress) {
  note({ at: 'start', chatId, path, caption });
  onProgress?.(0.5);
  await new Promise(done => setTimeout(done, 30));
  onProgress?.(1);
  note({ at: 'end', chatId, path, caption });
}
