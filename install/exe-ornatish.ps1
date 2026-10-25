# Palantir-Ornatish.exe ichidagi o'rnatuvchi (exe'ni scripts\setup-exe.ts yig'adi, ichida reliz arxivi app.zip - kutubxonalari bilan).
# Exe vaqtinchalik papkaga ochiladi va shu faylni ishga tushiradi: app.zip dastur papkasiga ochiladi, keyin install\ornatish.ps1
# (internetsiz yo'l: files.json, node_modules va panel tayyor). Avval o'rnatilgan bo'lsa - o'sha papkaga yoziladi (.env va
# ma'lumotlar joyida qoladi). Oyna oxirida Enter kutadi: admin paroli shu oynada chiqadi.
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
$ErrorActionPreference = 'Stop'
$Zip = Join-Path $PSScriptRoot 'app.zip'
$DefaultRoot = 'C:\Palantir'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Finish([int]$code) {
  Write-Host ''
  Read-Host 'Oynani yopish uchun Enter bosing' | Out-Null
  exit $code
}
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; Finish 1 }

# Avvalgi o'rnatish: avtoyuklash yorlig'ining ishchi papkasi (install\ornatish.ps1 yaratadi), bo'lmasa - C:\Palantir
function Installed-Root {
  $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Palantir.lnk'
  if (Test-Path $link) {
    $dir = (New-Object -ComObject WScript.Shell).CreateShortcut($link).WorkingDirectory
    if ($dir -and (Test-Path (Join-Path $dir 'package.json'))) { return $dir }
  }
  return $DefaultRoot
}

Step "Palantir o'rnatilmoqda"
$root = Installed-Root
$update = Test-Path (Join-Path $root 'package.json')
if ($update) { Note "Avvalgi o'rnatish: $root - yangilanadi (.env, baza va ma'lumotlar saqlanadi)" } else { Note "Dastur papkasi: $root" }

# Ishlab turgan nusxa to'xtatiladi: aks holda uning fayllari band - ustidan yozib bo'lmaydi
if ($update -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Push-Location $root
  try {
    node scripts\supervise.mjs status | Out-Null
    if ($LASTEXITCODE -eq 0) { Note "Ishlab turgan Palantir to'xtatilmoqda..."; node scripts\supervise.mjs stop }
  } finally { Pop-Location }
}

Step 'Fayllar ochilmoqda (1-3 daqiqa)'
try { New-Item -ItemType Directory -Force $root | Out-Null } catch { Fail "$root papkasini yaratib bo'lmadi: $($_.Exception.Message)" }
# Windows 10/11 dagi tar zip'ni tez ochadi; u yo'q bo'lsa - PowerShell'ning o'zi (sekinroq)
$opened = $false
if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
  tar.exe -xf $Zip -C $root
  $opened = $LASTEXITCODE -eq 0
}
if (-not $opened) {
  try { Expand-Archive -Path $Zip -DestinationPath $root -Force; $opened = $true } catch { Note $_.Exception.Message }
}
if (-not $opened) { Fail "Fayllarni ochib bo'lmadi. Palantir ishlab turgan bo'lsa - to'xtatib (install\Toxtatish.cmd), exe'ni qayta ishga tushiring." }
Note "Fayllar joyida: $root"

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'install\ornatish.ps1')
if ($LASTEXITCODE -ne 0) { Fail "O'rnatish oxiriga yetmadi - yuqoridagi xabarni o'qing. Exe'ni qayta ishga tushirsangiz, qolgan joyidan davom etadi." }
if (-not $update) {
  Write-Host ''
  Write-Host '   Admin parolini yozib oldingizmi? U dastur papkasidagi .env faylida ham turadi.' -ForegroundColor Yellow
}
Finish 0
