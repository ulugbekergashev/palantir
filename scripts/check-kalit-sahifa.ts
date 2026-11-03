/**
 * Kalit sahifasi (npm run kalit-sahifa) tekshiruvi — haqiqiy maxfiy kalitlarsiz: sinov uchun yasalgan Ed25519 juftligi va soxta
 * DentaCRM so'zlari bilan.
 *   1. Sahifa kriptografiyasi (crypto.js) Node'dagi bilan bayt-ba-bayt bir xil: SHA-256, SHA-512, Ed25519, Palantir va DentaCRM kalitlari
 *   2. Sahifa yasaladi; boshqa maxfiy kalit (dasturdagi ochiq kalitga mos emas) — rad
 *   3. Ko'rinmas Chrome'da fayl sifatida ochiladi: noto'g'ri parol, ochish, Palantir va DentaCRM kodlari (o'zi taniydi), parolni tiklash
 *   npm run test:kalit-sahifa
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright-core';
import { checkLicense, issueLicense } from '../hub/licenseKey';
import { chromePath } from './chrome';

let failed = 0, passed = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

interface KC {
  sha256: (b: Uint8Array) => Uint8Array; sha512: (b: Uint8Array) => Uint8Array;
  ed25519Sign: (seed: Uint8Array, m: Uint8Array) => Uint8Array; ed25519Public: (seed: Uint8Array) => Uint8Array;
  palantirLicense: (seed: Uint8Array, id: string, now?: number) => string; normalizeMachineId: (t: string) => string | null;
  dentaLicense: (id: string, salt: string) => string; dentaRecovery: (id: string, salt: string) => string;
}
const K = runInNewContext(`${readFileSync('scripts/kalit-sahifa/crypto.js', 'utf8')}\nKalitCrypto`, { TextEncoder, TextDecoder, btoa, setTimeout }) as KC;
const u8 = (b: Buffer) => new Uint8Array(b);
const same = (a: Uint8Array, b: Buffer) => Buffer.from(a).equals(b);

console.log('\n# Sahifa kriptografiyasi = Node');
const sizes = Array.from({ length: 300 }, (_, n) => n);
ok('SHA-256 (0–299 bayt)', sizes.every(n => { const b = randomBytes(n); return same(K.sha256(u8(b)), createHash('sha256').update(b).digest()); }));
ok('SHA-512 (0–299 bayt)', sizes.every(n => { const b = randomBytes(n); return same(K.sha512(u8(b)), createHash('sha512').update(b).digest()); }));
const pairs = Array.from({ length: 6 }, () => generateKeyPairSync('ed25519'));
const seedOf = (p: typeof pairs[number]) => p.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
ok('Ed25519 imzo va ochiq kalit — Node bilan bir xil (6 juft)', pairs.every(p => {
  const m = randomBytes(44);
  return same(K.ed25519Sign(u8(seedOf(p)), u8(m)), sign(null, m, p.privateKey)) && same(K.ed25519Public(u8(seedOf(p))), p.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
}));
const pair = pairs[0], pub = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const id = 'ABCD-1234-EF56-7890', day = Date.UTC(2026, 10, 3, 15);
const pageKey = K.palantirLicense(u8(seedOf(pair)), id, day);
ok('Palantir kaliti — npm run kalit / Hub bergani bilan aynan bir xil', pageKey === issueLicense(id, pair.privateKey, day), pageKey.slice(0, 16));
ok('Palantir kaliti dasturda tekshiruvdan o\'tadi (berilgan kun bilan)', checkLicense(pageKey, id, pub)?.issuedAt === '2026-11-03');
ok("kod kichik harf, bo'shliq va chiziqsiz yozilsa ham", K.normalizeMachineId(' abcd 1234ef56-7890 ') === id && K.normalizeMachineId('ABCD-1234') === null);
const salt = 'sinov_tuzi_123', hwid = 'HWID-0123456789ABCDEF';
const dentaWant = (s: string, n: number) => createHash('sha256').update(hwid + s).digest('hex').slice(0, n).toUpperCase();
ok('DentaCRM: aktivatsiya va parolni tiklash — licenseService.ts formulasi', K.dentaLicense(hwid, salt) === dentaWant(salt, 24) && K.dentaRecovery(hwid, 'r_tuz') === dentaWant('r_tuz', 20));

console.log('\n# Sahifani yasash');
const work = mkdtempSync(join(tmpdir(), 'palantir-kalit-sahifa-'));
const pem = join(work, 'litsenziya.pem');
writeFileSync(pem, String(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })));
const denta = join(work, 'dentalocal');
mkdirSync(join(denta, 'backend'), { recursive: true });
writeFileSync(join(denta, 'backend', 'licenseService.ts'), `const SECRET_SALT = '${salt}';\nconst RECOVERY_SALT = 'r_tuz';\n`);
const PASSWORD = 'Sinov-2026-kalit';
const build = (out: string, extra: Record<string, string> = {}) => execFileSync(process.execPath,
  ['--no-warnings', '--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, 'scripts/kalit-sahifa.ts', out],
  { env: { ...process.env, KEY_PAGE_PASSWORD: PASSWORD, LICENSE_SIGNING_KEY_FILE: pem, LICENSE_PUBLIC_KEY: pub, DENTALOCAL_DIR: denta, ...extra }, encoding: 'utf8', stdio: 'pipe' });
const full = join(work, 'kalit.html'), onlyPal = join(work, 'faqat-palantir.html');
const log = build(full);
ok('yasaldi: DentaCRM va Palantir bor', log.includes('DentaCRM: bor') && log.includes('Palantir: bor'));
const html = readFileSync(full, 'utf8');
ok("sahifada maxfiy qismlar ochiq ko'rinmaydi", !html.includes(salt) && !html.includes('r_tuz') && !html.includes(seedOf(pair).toString('hex')) && !html.includes('/*__PAYLOAD__*/null'));
build(onlyPal, { DENTALOCAL_DIR: join(work, 'yoq') });
let wrongKey = '';
try { build(join(work, 'x.html'), { LICENSE_PUBLIC_KEY: pairs[1].publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }); } catch (e) { wrongKey = String((e as { stdout?: string; stderr?: string }).stderr ?? e); }
ok('boshqa maxfiy kalit (dasturdagi ochiq kalitga mos emas) — sahifa yasalmaydi', wrongKey.includes('mos emas'));

console.log("\n# Telefondagi kabi: fayl brauzerda");
const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(full).href);
  await page.fill('#pin', 'notogri-parol1');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => document.getElementById('lockMsg')!.textContent!.length > 0, null, { timeout: 60_000 });
  ok("noto'g'ri parol — ochilmaydi", (await page.textContent('#lockMsg'))!.includes("noto'g'ri") && await page.isHidden('#mainView'));
  await page.fill('#pin', `${PASSWORD} `); // telefon klaviaturasi oxiriga bo'shliq qo'shsa ham ochiladi
  await page.click('#unlockBtn');
  await page.waitForSelector('#mainView', { state: 'visible', timeout: 60_000 });
  ok("to'g'ri parol — ochildi, ikkala dastur tanlovi bor", await page.isVisible('#products'));
  await page.fill('#code', 'abcd 1234 ef56 7890');
  const palKey = (await page.textContent('#key'))!.trim();
  ok("Palantir kodi joylandi — o'zi Palantir'ga o'tdi, kalit dasturda o'tadi", await page.getAttribute('body', 'data-product') === 'palantir' && checkLicense(palKey, id, pub) !== null && await page.isHidden('#modes'), palKey.slice(0, 20));
  await page.fill('#code', hwid.toLowerCase());
  ok("DentaCRM kodi joylandi — o'zi DentaCRM'ga o'tdi, aktivatsiya kaliti to'g'ri", await page.getAttribute('body', 'data-product') === 'denta' && (await page.textContent('#key'))!.trim() === dentaWant(salt, 24));
  await page.click('#modes button[data-mode=recovery]');
  ok('DentaCRM parolni tiklash kaliti', (await page.textContent('#key'))!.trim() === dentaWant('r_tuz', 20));
  await page.fill('#code', 'HWID-0123...');
  ok("chala DentaCRM kodi — kalit chiqmaydi, sababi aytiladi", (await page.textContent('#codeMsg'))!.includes("to'liq emas") && await page.isDisabled('#copyBtn'));
  await page.click('#products button[data-product=palantir]');
  await page.fill('#code', 'ABCD-1234-EF56');
  ok("chala Palantir kodi — kalit chiqmaydi", (await page.textContent('#codeMsg'))!.includes("noto'g'ri") && await page.isDisabled('#copyBtn'),
    `${await page.textContent('#codeMsg')} · ${await page.getAttribute('body', 'data-product')}`);
  await page.screenshot({ path: join(tmpdir(), 'kalit-sahifa.png') });
  await page.click('#lockBtn');
  ok('qulflash — maxfiy qism xotiradan chiqadi', await page.isVisible('#lockView') && await page.evaluate(() => (document.getElementById('key')!.textContent ?? '') === ''));

  await page.goto(pathToFileURL(onlyPal).href);
  await page.fill('#pin', PASSWORD);
  await page.click('#unlockBtn');
  await page.waitForSelector('#mainView', { state: 'visible', timeout: 60_000 });
  await page.fill('#code', id);
  ok("dentalocal yo'q kompyuterda yasalgan sahifa — faqat Palantir, tanlov yashirin", await page.isHidden('#products') && checkLicense((await page.textContent('#key'))!.trim(), id, pub) !== null);
  ok('sahifada JS xatosi yo\'q', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} o'tdi`);
process.exitCode = failed ? 1 : 0;
