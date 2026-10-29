/**
 * O'rnatuvchi .exe (DentaLocal kabi — Windows'ning o'z IExpress'i bilan, qo'shimcha dasturlarsiz). Ichida: reliz arxivi kutubxonalari
 * bilan (scripts/archive.ts), install/exe-ornatish.ps1 va runtime\ — o'rnatishda internetdan hech narsa yuklanmaydi:
 *   runtime\node-*.msi       Node.js rasmiy o'rnatgichi (kompyuterda Node 24 bo'lmasa qo'yiladi)
 *   runtime\ffmpeg\          ffmpeg (IP kameralar; Gyan «essentials», GPL — LICENSE yonida)
 *   runtime\python\          Python (ko'chma) va ovoz xizmati kutubxonalari (tgvoice/requirements.txt)
 *   tgvoice\models\…ru-0.22  «Quloq» modeli
 * Klinikada: exe → «o'rnatilsinmi?» → administrator ruxsati → C:\Palantir ga ochadi → install\ornatish.ps1 (savolsiz) → ulash ustasi.
 * Imzosiz exe: internetdan kelgan bo'lsa Windows «noma'lum dastur» deb to'xtatadi — «Подробнее» → «Выполнить в любом случае».
 *   npm run setup-exe -- [--out reliz] [--modules <papka>] [--yengil]
 * Kutubxonalar: --modules berilmasa — ishlash uchun keraklilari alohida papkaga o'rnatiladi (npm ci --omit=dev, internet kerak),
 * o'zingizdagi node_modules'ga tegilmaydi. --yengil — runtime\siz (kichik exe; o'rnatishda Node, ffmpeg, Python internetdan).
 * Yuklanganlar <out>\kesh da saqlanadi (SHA256 qotirilgan — keyingi yig'ishda qayta yuklanmaydi).
 * Talab: Windows (iexpress.exe), git, yig'ilgan panel (npm run build), Python launcher (py -3.14) va «Quloq» modeli
 * (tgvoice\models — install\Telefon.cmd -OnlyVoice yuklaydi).
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzipSync } from 'fflate';
import { writeArchive } from './archive';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (text: string): never => { console.error(`setup-exe: ${text}`); process.exit(1); };
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;

/** Exe ichidagi qismlar: versiya va SHA256 birga o'zgaradi. Python — kutubxonalarni qo'yadigan «py» bilan bir xil versiya */
const PARTS = {
  node: { url: 'https://nodejs.org/dist/v24.13.1/node-v24.13.1-x64.msi', sha256: '03fe815e236ad8fb6fa4289921a746e1492571acee49105154f2cc0b07021515' },
  python: { url: 'https://www.python.org/ftp/python/3.14.6/python-3.14.6-embed-amd64.zip', sha256: 'df901e84a896ff1ee720ad03377e0c8d8c2244fda79808aeeaff6316df1cb75c', minor: '3.14' },
  ffmpeg: { url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.0/ffmpeg-8.0-essentials_build.zip', sha256: '647e467caf82b9fa200a562769b5ff4d736aaf725804ed2c64ea9752106fa569' },
};
const WAKE_MODEL = 'tgvoice/models/vosk-model-small-ru-0.22';
/** Ovoz xizmati ishga tushishi uchun kerakli modullar (install/telefon.ps1 ham shularni tekshiradi) */
const VOICE_IMPORTS = 'import vosk, ntgcalls, pytgcalls, telethon, google.genai, httpx, websockets';

const OUT = option('--out') ?? 'reliz';
const light = args.includes('--yengil');
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
if (process.platform !== 'win32') fail("faqat Windows'da (iexpress.exe)");
if (!existsSync(join('dist', 'index.html'))) fail("panel yig'ilmagan — avval npm run build");
if (!light && !existsSync(WAKE_MODEL)) fail(`«Quloq» modeli yo'q (${WAKE_MODEL}) — install\\Telefon.cmd -OnlyVoice yuklaydi`);

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Keshdan yoki internetdan (bir marta); SHA256 mos kelmasa — ishlatilmaydi */
async function fetchPart(part: { url: string; sha256: string }): Promise<string> {
  const file = resolve(OUT, 'kesh', basename(new URL(part.url).pathname));
  if (existsSync(file) && sha256(file) === part.sha256) return file;
  mkdirSync(dirname(file), { recursive: true });
  console.log(`yuklanmoqda: ${part.url}`);
  const r = await fetch(part.url);
  if (!r.ok || !r.body) fail(`${part.url} — ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), createWriteStream(`${file}.tmp`));
  if (sha256(`${file}.tmp`) !== part.sha256) { rmSync(`${file}.tmp`, { force: true }); fail(`${basename(file)}: SHA256 mos emas — fayl buzilgan yoki almashtirilgan`); }
  renameSync(`${file}.tmp`, file);
  return file;
}

function unpack(zipFile: string, target: string, pick: (name: string) => string | null): void {
  for (const [name, data] of Object.entries(unzipSync(readFileSync(zipFile), { filter: f => pick(f.name) !== null }))) {
    const to = pick(name);
    if (!to || name.endsWith('/')) continue;
    mkdirSync(dirname(join(target, to)), { recursive: true });
    writeFileSync(join(target, to), data);
  }
}

/** Ko'chma Python: site-packages yoqiladi va ovoz xizmati kutubxonalari shu kompyuterdagi bir xil versiyali Python'ning pip'i bilan qo'yiladi */
function stagePython(zipFile: string, dir: string): void {
  const have = execFileSync('py', [`-${PARTS.python.minor}`, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' }).trim();
  if (have !== PARTS.python.minor) fail(`py -${PARTS.python.minor} topilmadi (${have}) — Python ${PARTS.python.minor} o'rnating`);
  unpack(zipFile, dir, name => name);
  const pth = join(dir, `python${PARTS.python.minor.replace('.', '')}._pth`);
  // ._pth bor bo'lsa Python skript papkasini yo'lga qo'shmaydi (izolyatsiya rejimi): ovoz skriptlari bir-birini (call_live, common…)
  // topishi uchun tgvoice\ ham yozib qo'yiladi — klinikada runtime\python\ dan ikki pog'ona yuqorida
  writeFileSync(pth, readFileSync(pth, 'utf8').replace('#import site', 'Lib\\site-packages\r\n..\\..\\tgvoice\r\nimport site'));
  console.log("ovoz xizmati kutubxonalari o'rnatilmoqda...");
  execFileSync('py', [`-${PARTS.python.minor}`, '-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--no-warn-script-location',
    '--target', join(dir, 'Lib', 'site-packages'), '-r', join('tgvoice', 'requirements.txt')], { stdio: 'inherit' });
  execFileSync(join(dir, 'python.exe'), ['-c', VOICE_IMPORTS], { stdio: 'inherit' });
}

async function stageRuntime(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const msi = await fetchPart(PARTS.node);
  copyFileSync(msi, join(dir, basename(msi)));
  unpack(await fetchPart(PARTS.ffmpeg), join(dir, 'ffmpeg'), name =>
    name.endsWith('/bin/ffmpeg.exe') ? 'ffmpeg.exe' : /\/(LICENSE|README\.txt)$/.test(name) ? basename(name) : null);
  stagePython(await fetchPart(PARTS.python), join(dir, 'python'));
}

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
const extra = light ? [] : [{ dir: join(work, 'runtime'), name: 'runtime' }, { dir: WAKE_MODEL, name: WAKE_MODEL }];
if (!light) await stageRuntime(join(work, 'runtime'));

const zip = await writeArchive(join(work, 'app.zip'), { version, modules, skip: OUT, extra });
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
// IExpress yo'lida bo'sh joy bo'lsa (masalan «Hp Vitus Gaming») ovozsiz yiqiladi — shunda exe paydo bo'lmaydi
if (!existsSync(target)) fail('IExpress exe yaratmadi (papka yo\'lida bo\'sh joy bo\'lmasin) — palantir.sed: ' + sedFile);
rmSync(work, { recursive: true, force: true });
console.log(`tayyor: ${target} — ${mb(statSync(target).size)}`);
