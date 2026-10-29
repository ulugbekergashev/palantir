/**
 * Sotuvchi: klinika kompyuteri uchun litsenziya kaliti (Hub'ga ulanmagan klinikaga — Hub'da «Aktivlashtirish» tugmasi bor).
 *   npm run kalit -- XXXX-XXXX-XXXX-XXXX     (kodsiz ishga tushirilsa — so'raydi)
 * Klinika panelidagi «Kompyuter kodi»ni oling, chiqqan kalitni (PAL1-…) Telegram'da yuboring — egasi panelga qo'yadi.
 * Maxfiy kalit: ~/.palantir/litsenziya.pem (yoki LICENSE_SIGNING_KEY_FILE) — faqat sotuvchida; yo'qolsa, eski kalitlar ishlayveradi,
 * lekin yangisini yasab bo'lmaydi (ochiq qismi dasturda — hub/licenseKey.ts).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { checkLicense, issueLicense, LICENSE_PUBLIC_KEY, normalizeMachineId, signingKey } from '../hub/licenseKey';

const keyFile = process.env.LICENSE_SIGNING_KEY_FILE || join(homedir(), '.palantir', 'litsenziya.pem');
let given = process.argv.slice(2).join('');
if (!given) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  given = await rl.question('Klinika yuborgan kompyuter kodi (XXXX-XXXX-XXXX-XXXX): ');
  rl.close();
}
const machine = normalizeMachineId(given);
if (!machine) {
  console.error("Kompyuter kodi noto'g'ri — 16 ta belgi: XXXX-XXXX-XXXX-XXXX");
  process.exit(1);
}
let privateKey;
try { privateKey = signingKey(readFileSync(keyFile, 'utf8')); } catch {
  console.error(`Maxfiy kalit topilmadi: ${keyFile}`);
  process.exit(1);
}
const license = issueLicense(machine, privateKey);
// O'zimizni tekshiramiz: maxfiy kalit dasturdagi ochiq kalitga mos kelmasa — bunday kalit klinikada ishlamaydi
if (!checkLicense(license, machine, process.env.LICENSE_PUBLIC_KEY || LICENSE_PUBLIC_KEY)) {
  console.error("Bu maxfiy kalit dasturdagi ochiq kalitga mos emas — boshqa litsenziya.pem bo'lishi mumkin");
  process.exit(1);
}
console.log(`\nKompyuter: ${machine}\nKalit:\n\n${license}\n\nShu kalitni klinikaga yuboring (Telegram'da nusxalab). U panelda «Kalitni kiritish»ga qo'yiladi.\n`);
