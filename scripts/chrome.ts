/**
 * Brauzer sinovlari uchun Chrome: CHROME berilgan bo'lsa — o'sha, aks holda shu OS'dagi odatiy joy (server/browserPath.ts).
 * Server ishga tushirilishidan oldin chaqiriladi: Chrome yo'q bo'lsa sinov darhol aniq xato bilan to'xtaydi — yarim yo'lda
 * yiqilib, yetim qolgan server portni band qilib turmasin (keyingi sinov o'shanga ulanib, adashib qoladi).
 */
import { existsSync } from 'node:fs';
import { installedBrowser } from '../server/browserPath';

export function chromePath(): string {
  const given = process.env.CHROME;
  const found = given ? (existsSync(given) ? given : null) : installedBrowser();
  if (!found) {
    console.error(given ? `CHROME=${given} — bunday fayl yo'q` : "Chrome yoki Edge topilmadi — o'rnating yoki CHROME=<yo'l> bering");
    process.exit(1);
  }
  return found;
}
