/**
 * «Palantir Hub» yorlig'i — sotuvchining (egasining) ish stolida alohida dastur kabi: o'z belgisi, o'z oynasi (manzil qatori va
 * varaqlarsiz — Chrome yoki Edge «--app» rejimi) va o'z brauzer profili (Hub kirishi boshqa saytlar bilan aralashmaydi, vazifalar
 * panelida Palantir'dan alohida turadi).
 *
 * Bosilganda: shu kompyuterda Hub asosiy kaliti bo'lsa (~/.palantir/hub.env — hub:deploy yozgan) u nusxalanadi — kirish oynasida
 * Ctrl+V va Enter; 2 daqiqadan keyin, nusxa hali o'sha bo'lsa — tozalanadi. Kalit faylga yoki havolaga yozilmaydi.
 * Fayllar: %LOCALAPPDATA%\PalantirHub (belgi, ochish skripti, profil). Ishga tushirish: npm run hub:yorliq
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('Yorliq faqat Windows uchun');

const HUB_ENV = join(homedir(), '.palantir', 'hub.env');
const DEFAULT_DOMAIN = '92-5-56-138.sslip.io';
const domain = process.env.HUB_DOMAIN
  || (existsSync(HUB_ENV) ? /^HUB_DOMAIN=(.+)$/m.exec(readFileSync(HUB_ENV, 'utf8'))?.[1]?.trim() : undefined)
  || DEFAULT_DOMAIN;
if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error(`Hub manzili noto'g'ri: ${domain}`);
const url = `https://${domain}/admin`;

const dir = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PalantirHub');
mkdirSync(dir, { recursive: true });
const icon = join(dir, 'palantir-hub.ico');
copyFileSync(resolve('Palantir-logo/hub/palantir-hub.ico'), icon);

// Kalit faqat bosilganda o'qiladi (skriptda saqlanmaydi); brauzer — Chrome, bo'lmasa Edge
const ps1 = join(dir, 'ochish.ps1');
writeFileSync(ps1, `# Palantir Hub — scripts/hub-yorliq.ts yaratgan
$ErrorActionPreference = 'SilentlyContinue'
$url = '${url}'
$keyFile = Join-Path $env:USERPROFILE '.palantir\\hub.env'
$key = $null
if (Test-Path $keyFile) { $key = ((Get-Content $keyFile | Where-Object { $_ -like 'HUB_ADMIN_KEY=*' }) -replace '^HUB_ADMIN_KEY=', '').Trim() }
if ($key) { Set-Clipboard -Value $key }
$browser = @("$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe", "\${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",
  "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe", "\${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Start-Process $url; exit }
$dataDir = Join-Path $PSScriptRoot 'profil'
Start-Process $browser -ArgumentList "--app=$url", "--user-data-dir=\`"$dataDir\`"", '--no-first-run', '--no-default-browser-check', '--window-size=1440,920'
if ($key) { Start-Sleep -Seconds 120; if ((Get-Clipboard) -eq $key) { Set-Clipboard -Value ' ' } }
`, 'utf8');

// Konsol oynasi milt etib ko'rinmasin — VBScript orqali yashirin
const vbs = join(dir, 'ochish.vbs');
writeFileSync(vbs, `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1}""", 0, False\r\n`, 'utf8');

const desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim();
const lnk = join(desktop, 'Palantir Hub.lnk');
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', [
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(lnk) + ')',
  '$s.TargetPath = ' + q(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')),
  '$s.Arguments = ' + q(`"${vbs}"`),
  '$s.WorkingDirectory = ' + q(dir),
  '$s.IconLocation = ' + q(`${icon},0`),
  '$s.Description = ' + q('Palantir Hub — hamma mijozlarni boshqarish'),
  '$s.Save()',
].join('; ')], { stdio: 'inherit' });

console.log(`Yorliq: ${lnk}\n  ochadi: ${url} (alohida oyna va profil: ${dir})`);
