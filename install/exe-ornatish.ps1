# Palantir-Ornatish.exe ichidagi o'rnatuvchi (exe'ni scripts\setup-exe.ts yig'adi, ichida reliz arxivi app.zip - kutubxonalari bilan).
# Exe vaqtinchalik papkaga ochiladi va shu faylni ishga tushiradi: app.zip dastur papkasiga ochiladi, keyin install\ornatish.ps1
# (internetsiz yo'l: files.json, node_modules va panel tayyor). Avval o'rnatilgan bo'lsa - o'sha papkaga yoziladi (.env va
# ma'lumotlar joyida qoladi). Oyna oxirida Enter kutadi: admin paroli shu oynada chiqadi.
# Jurnal: %TEMP%\palantir-exe.log (bu oyna) va %TEMP%\palantir-ornatish.log (ornatish.ps1) - oyna yopilsa ham qoladi.
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
$ErrorActionPreference = 'Stop'
$Zip = Join-Path $PSScriptRoot 'app.zip'
$DefaultRoot = 'C:\Palantir'
$Log = Join-Path $env:TEMP 'palantir-exe.log'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Finish([int]$code) {
  Write-Host ''
  Read-Host 'Oynani yopish uchun Enter bosing' | Out-Null
  exit $code
}
function Fail([string]$text) {
  Write-Host "   X $text" -ForegroundColor Red
  Write-Host "   Jurnal: $Log va $(Join-Path $env:TEMP 'palantir-ornatish.log')"
  Finish 1
}

# Oyna boshqa oynalar ortida qolib ketmasin: o'rnatuvchi "hech narsa bo'lmadi" deb yopib qo'ymasin
function Show-Front {
  try {
    Add-Type -Namespace Palantir -Name Oyna -MemberDefinition '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
    $h = [Palantir.Oyna]::GetConsoleWindow()
    [Palantir.Oyna]::ShowWindow($h, 9) | Out-Null
    [Palantir.Oyna]::SetForegroundWindow($h) | Out-Null
  } catch { }
}

# Avvalgi o'rnatish: avtoyuklash yorlig'ining ishchi papkasi (install\ornatish.ps1 yaratadi), bo'lmasa - C:\Palantir
function Installed-Root {
  $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Palantir.lnk'
  if (Test-Path $link) {
    $dir = (New-Object -ComObject WScript.Shell).CreateShortcut($link).WorkingDirectory
    if ($dir -and (Test-Path (Join-Path $dir 'package.json'))) { return $dir }
  }
  return $DefaultRoot
}

# tar jim ishlaydi (20 mingga yaqin fayl): har 2 soniyada vaqt chiqadi - oyna qotib qolgandek ko'rinmasin
function Open-Zip([string]$target) {
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { return $false }
  $p = Start-Process -FilePath 'tar.exe' -ArgumentList '-xf', "`"$Zip`"", '-C', "`"$target`"" -NoNewWindow -PassThru
  $null = $p.Handle # PowerShell 5.1: busiz ExitCode bo'sh qoladi
  $started = Get-Date
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 2
    Write-Host ("`r   ... {0} soniya" -f [int]((Get-Date) - $started).TotalSeconds) -NoNewline
  }
  Write-Host ''
  return ($p.ExitCode -eq 0)
}

# Administrator huquqi bitta ruxsat bilan: Node.js o'rnatgichi va "kompyuter yonganda o'zi ishga tushish" (Windows vazifasi) uchun.
# Ruxsat berilgan oyna shu faylni qayta ishga tushiradi; bu oyna u tugashini kutadi
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host ''
  Write-Host '   Administrator ruxsati so''raladi - chiqqan oynada "Da / Yes" ni bosing. O''rnatish yangi oynada davom etadi.' -ForegroundColor Yellow
  try {
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
    exit $p.ExitCode
  } catch {
    Write-Host '   Ruxsat berilmadi - Palantir o''rnatilmadi. Exe''ni qayta ishga tushirib, "Da / Yes" ni bosing.' -ForegroundColor Red
    Finish 1
  }
}
try { Start-Transcript -Path $Log -Force | Out-Null } catch { }

Show-Front
Write-Host ''
Write-Host '  ==============================================================' -ForegroundColor Yellow
Write-Host '   PALANTIR O''RNATILMOQDA - 3-10 DAQIQA. OYNANI YOPMANG.' -ForegroundColor Yellow
Write-Host '   Savol berilmaydi. Oxirida admin paroli chiqadi.' -ForegroundColor Yellow
Write-Host '  ==============================================================' -ForegroundColor Yellow

Step "Palantir o'rnatilmoqda"
$root = Installed-Root
# Fayllar bor, lekin .env yo'q - avvalgi o'rnatish oxiriga yetmagan (oyna yopilgan): yangi o'rnatishdek davom etadi
$files = Test-Path (Join-Path $root 'package.json')
$update = Test-Path (Join-Path $root '.env')
if ($update) { Note "Avvalgi o'rnatish: $root - yangilanadi (.env, baza va ma'lumotlar saqlanadi)" }
elseif ($files) { Note "Oxiriga yetmagan o'rnatish: $root - davom ettiriladi" }
else { Note "Dastur papkasi: $root" }

# Ishlab turgan nusxa to'xtatiladi: aks holda uning fayllari band - ustidan yozib bo'lmaydi
if ($files -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Push-Location $root
  try {
    node scripts\supervise.mjs status | Out-Null
    if ($LASTEXITCODE -eq 0) { Note "Ishlab turgan Palantir to'xtatilmoqda..."; node scripts\supervise.mjs stop }
  } finally { Pop-Location }
}

Step 'Fayllar ochilmoqda (1-3 daqiqa)'
try { New-Item -ItemType Directory -Force $root | Out-Null } catch { Fail "$root papkasini yaratib bo'lmadi: $($_.Exception.Message)" }
# Windows 10/11 dagi tar zip'ni tez ochadi; u yo'q bo'lsa - PowerShell'ning o'zi (ancha sekin, o'z jarayon chizig'i bilan)
$opened = Open-Zip $root
if (-not $opened) {
  Note "tar bilan bo'lmadi - boshqa usul bilan ochilmoqda (10 daqiqagacha)..."
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
