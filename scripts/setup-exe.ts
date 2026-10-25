/**
 * O'rnatuvchi .exe (DentaLocal kabi — Windows'ning o'z IExpress'i bilan, qo'shimcha dasturlarsiz). Ichida: reliz arxivi kutubxonalari
 * bilan (scripts/archive.ts) va install/exe-ornatish.ps1. Klinikada: exe → «o'rnatilsinmi?» → C:\Palantir ga ochadi →
 * install\ornatish.ps1 (internetsiz yo'l) → ulash ustasi. Imzosiz exe: internetdan kelgan bo'lsa Windows «noma'lum dastur» deb
 * to'xtatadi — «Подробнее / More info» → «Выполнить в любом случае / Run anyway».
 *   npm run setup-exe -- [--out reliz] [--modules <papka>]
 * Kutubxonalar: --modules berilmasa — ishlash uchun keraklilari alohida papkaga o'rnatiladi (npm ci --omit=dev, internet kerak),
 * o'zingizdagi node_modules'ga tegilmaydi. Reliz yig'ilganda (npm prune --omit=dev dan keyin) — --modules node_modules.
 * Talab: Windows (iexpress.exe), git (kuzatiladigan fayllar), yig'ilgan panel (npm run build).
 */
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeArchive } from './archive';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (text: string): never => { console.error(`setup-exe: ${text}`); process.exit(1); };
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;

const OUT = option('--out') ?? 'reliz';
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
if (process.platform !== 'win32') fail("faqat Windows'da (iexpress.exe)");
if (!existsSync(join('dist', 'index.html'))) fail("panel yig'ilmagan — avval npm run build");

// IExpress papkalarni olmaydi: exe'ga uchta fayl kiradi, dastur o'zi app.zip ichida
const work = resolve(OUT, 'exe-ish');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

let modules = option('--modules');
if (!modules) {
  const dir = join(work, 'kutubxonalar');
  mkdirSync(dir);
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(f, join(dir, f));
  console.log("kutubxonalar (faqat ishlash uchun keraklilari) o'rnatilmoqda...");
  execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
  modules = join(dir, 'node_modules');
}
if (!existsSync(join(modules, 'tsx'))) fail(`${modules} da kutubxonalar yo'q (tsx topilmadi)`);

const zip = await writeArchive(join(work, 'app.zip'), { version, modules, skip: OUT });
console.log(`arxiv: ${zip.files} fayl, ${mb(zip.size)}`);
copyFileSync(join('install', 'exe-ornatish.ps1'), join(work, 'exe-ornatish.ps1'));
writeFileSync(join(work, 'ornatish.bat'), '@echo off\r\ntitle Palantir\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0exe-ornatish.ps1"\r\n');

const target = resolve(OUT, `Palantir-Ornatish-${version}.exe`);
rmSync(target, { force: true });
const files = ['ornatish.bat', 'exe-ornatish.ps1', 'app.zip'];
const sed = [
  '[Version]', 'Class=IEXPRESS', 'SEDVersion=3',
  '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=0', 'HideExtractAnimation=0', 'UseLongFileName=1',
  'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N',
  'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%', 'FinishMessage=%FinishMessage%', 'TargetName=%TargetName%',
  'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%', 'PostInstallCmd=%PostInstallCmd%', 'AdminQuietInstCmd=%AdminQuietInstCmd%',
  'UserQuietInstCmd=%UserQuietInstCmd%', 'SourceFiles=SourceFiles',
  '[Strings]',
  `InstallPrompt=Palantir ${version} o'rnatilsinmi?`, 'DisplayLicense=', 'FinishMessage=', `TargetName=${target}`, 'FriendlyName=Palantir',
  'AppLaunched=cmd /c ornatish.bat', 'PostInstallCmd=<None>', 'AdminQuietInstCmd=', 'UserQuietInstCmd=',
  ...files.map((f, i) => `FILE${i}="${f}"`),
  '[SourceFiles]', `SourceFiles0=${work}\\`,
  '[SourceFiles0]', ...files.map((_, i) => `%FILE${i}%=`),
  '',
].join('\r\n');
const sedFile = join(work, 'palantir.sed');
writeFileSync(sedFile, sed);

console.log('exe yig\'ilmoqda (IExpress, bir necha daqiqa)...');
execFileSync(join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'iexpress.exe'), ['/N', '/Q', sedFile], { stdio: 'inherit' });
if (!existsSync(target)) fail("IExpress exe yaratmadi — palantir.sed ni tekshiring: " + sedFile);
rmSync(work, { recursive: true, force: true });
console.log(`tayyor: ${target} — ${mb(statSync(target).size)}`);
