/**
 * Sotuvchi: telefon uchun bitta kalit sahifasi — DentaCRM (aktivatsiya va parolni tiklash) va Palantir (aktivatsiya).
 *   npm run kalit-sahifa                      → ish stolida Kalit-DentaCRM-Palantir.html (parolni so'raydi)
 *   npm run kalit-sahifa -- chiqish.html      (sinov: KEY_PAGE_PASSWORD=... bilan so'ramaydi)
 * Maxfiy qismlar sahifaga siz tanlagan parol bilan shifrlanib joylanadi (PBKDF2, DentaLocal key-page bilan bir xil sxema):
 *   DentaCRM so'zlari — DENTALOCAL_DIR (standart D:\Projects\dentalocal) / backend/licenseService.ts; topilmasa — faqat Palantir;
 *   Palantir imzo kaliti — ~/.palantir/litsenziya.pem (yoki LICENSE_SIGNING_KEY_FILE).
 * Fayl hech qayerga yuborilmaydi; uni o'zingizning telefoningizga (Telegram «Saqlangan xabarlar») yuborasiz.
 */
import { createPublicKey, pbkdf2Sync, randomBytes, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runInNewContext } from 'node:vm';
import { checkLicense, LICENSE_PUBLIC_KEY, signingKey } from '../hub/licenseKey';

const ITERATIONS = 300_000;
// Sahifada Palantir imzo kaliti ham bor (qaytarib olib bo'lmaydi): fayl chiqib ketsa, qisqa parolni GPU tez topadi
const MIN_LENGTH = 12;
const HERE = join(import.meta.dirname, 'kalit-sahifa');
const outFile = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), 'Desktop', 'Kalit-DentaCRM-Palantir.html');
const dentaDir = process.env.DENTALOCAL_DIR || 'D:\\Projects\\dentalocal';
const pemFile = process.env.LICENSE_SIGNING_KEY_FILE || join(homedir(), '.palantir', 'litsenziya.pem');
const publicKey = process.env.LICENSE_PUBLIC_KEY || LICENSE_PUBLIC_KEY;

interface Secrets { l?: string; r?: string; p?: string }

function dentaSalts(): Pick<Secrets, 'l' | 'r'> | null {
  const file = join(dentaDir, 'backend', 'licenseService.ts');
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const pick = (name: string) => new RegExp(`const ${name} = '([^']+)';`).exec(src)?.[1];
  const l = pick('SECRET_SALT'), r = pick('RECOVERY_SALT');
  if (!l || !r) throw new Error(`${file} ichida SECRET_SALT / RECOVERY_SALT topilmadi`);
  return { l, r };
}

/** Palantir maxfiy kalitining 32 baytlik o'zagi (PKCS8 oxiri); dasturdagi ochiq kalitga mos kelmasa — xato */
function palantirSeed(): string | null {
  if (!existsSync(pemFile)) return null;
  const key = signingKey(readFileSync(pemFile, 'utf8'));
  const pub = createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  if (pub !== publicKey) throw new Error(`${pemFile} dasturdagi ochiq kalitga mos emas — bu kalit bilan yasalgan kalitlar klinikada ishlamaydi`);
  return key.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
}

/** Sahifadagi unlock() bilan bir xil sxema: PBKDF2 → HMAC oqimi bilan XOR → HMAC belgi */
function encrypt(password: string, plain: string) {
  const salt = randomBytes(16);
  const dk = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, ITERATIONS, 32, 'sha256');
  const pt = Buffer.from(plain, 'utf8');
  const ct = Buffer.alloc(pt.length);
  for (let off = 0, n = 0; off < pt.length; off += 32, n++) {
    const ks = createHmac('sha256', dk).update(Buffer.concat([Buffer.from('enc'), Buffer.from([n])])).digest();
    for (let i = 0; i < 32 && off + i < pt.length; i++) ct[off + i] = pt[off + i] ^ ks[i];
  }
  const tag = createHmac('sha256', createHmac('sha256', dk).update('mac').digest()).update(ct).digest();
  return { v: 1, it: ITERATIONS, s: salt.toString('hex'), c: ct.toString('hex'), t: tag.toString('hex') };
}

function checkPassword(pw: string): string | null {
  if (pw.length < MIN_LENGTH) return `Parol kamida ${MIN_LENGTH} ta belgi bo'lsin.`;
  // Faqat lotin harflari, raqam va oddiy belgilar: Windows konsoli va telefon klaviaturasi bir xil yozishi uchun
  if (!/^[\x21-\x7e]+$/.test(pw)) return "Parolda faqat lotin harflari, raqamlar va belgilar bo'lsin (bo'shliq va kirill harflarisiz).";
  if (/^\d+$/.test(pw)) return "Faqat raqamdan iborat parol oson topiladi — kamida bitta harf qo'shing.";
  return null;
}

async function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\nSahifani ochish uchun parol o'ylab toping (kamida ${MIN_LENGTH} ta belgi, harf + raqam).`);
    console.log("Parol hech qayerda saqlanmaydi — unutsangiz, sahifani qaytadan yaratasiz.\n");
    for (;;) {
      const pw = (await rl.question('Parol: ')).trim();
      const problem = checkPassword(pw);
      if (problem) { console.log(`  ${problem}\n`); continue; }
      if ((await rl.question('Parolni takrorlang: ')).trim() !== pw) { console.log('  Parollar bir xil emas.\n'); continue; }
      return pw;
    }
  } finally {
    rl.close();
  }
}

/** Sahifadagi kriptografiya shu kalitlar bilan to'g'ri ishlashini yozishdan oldin tekshiradi */
function selfCheck(cryptoJs: string, s: Secrets): void {
  const K = runInNewContext(`${cryptoJs}\nKalitCrypto`, { TextEncoder, TextDecoder, btoa, setTimeout }) as {
    palantirLicense: (seed: Uint8Array, id: string) => string; unhex: (h: string) => Uint8Array;
  };
  if (s.p) {
    const id = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
    if (!checkLicense(K.palantirLicense(K.unhex(s.p), id), id, publicKey)) throw new Error('Sahifa yasagan Palantir kaliti tekshiruvdan o\'tmadi');
  }
}

console.log('\n======================================================');
console.log('   Kalit sahifasi — DentaCRM va Palantir (telefon uchun)');
console.log('======================================================');
const denta = dentaSalts(), seed = palantirSeed();
if (!denta && !seed) {
  console.error(`\nHech qaysi maxfiy qism topilmadi:\n  DentaCRM: ${dentaDir}\\backend\\licenseService.ts\n  Palantir: ${pemFile}`);
  process.exit(1);
}
console.log(`  DentaCRM: ${denta ? 'bor' : `yo'q (${dentaDir} topilmadi)`}`);
console.log(`  Palantir: ${seed ? 'bor' : `yo'q (${pemFile} topilmadi)`}`);
const secrets: Secrets = { ...denta, ...(seed && { p: seed }) };

const cryptoJs = readFileSync(join(HERE, 'crypto.js'), 'utf8');
selfCheck(cryptoJs, secrets);

let password = process.env.KEY_PAGE_PASSWORD || '';
if (password) {
  const problem = checkPassword(password);
  if (problem) { console.error(problem); process.exit(1); }
} else {
  password = await askPassword();
}

const template = readFileSync(join(HERE, 'template.html'), 'utf8');
const marks = ['/*__CRYPTO__*/', '/*__PAYLOAD__*/null'];
for (const m of marks) if (!template.includes(m)) throw new Error(`template.html ichida ${m} belgisi yo'q`);
// Almashtirish funksiya bilan: matndagi «$» belgilari almashtirish naqshi bo'lib qolmasin
const page = template
  .replace(marks[0], () => cryptoJs)
  .replace(marks[1], () => JSON.stringify(encrypt(password, JSON.stringify(secrets))));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page, 'utf8');

console.log(`\nTayyor: ${outFile}`);
console.log("Faylni telefoningizga yuboring (Telegram «Saqlangan xabarlar») va brauzerda oching.");
console.log("Faylni boshqalarga bermang: parol himoya qiladi, lekin maxfiy qism baribir uning ichida.\n");
