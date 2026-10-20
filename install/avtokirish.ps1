# Svet o'chib-yonganda Palantir o'zi ishga tushsin: Windows shu foydalanuvchi bilan o'zi kiradi (avtomatik kirish), keyin
# cerebro-fon.vbs ekranni darhol qulflaydi - Palantir ishlayveradi, kompyuter yonidagi odam esa parolsiz kira olmaydi.
# Hamma narsa (bot, MicroSIP, telefon liniyasi WSL'da) odatdagi foydalanuvchi sessiyasida ishlaydi.
# Parol registrda ochiq yozilmaydi: LSA maxfiy omborida (Sysinternals Autologon kabi). Administrator huquqi kerak.
#   avtokirish.ps1 [-User DOMEN\nom] - yoqish (parol so'raladi va haqiqiy kirish bilan tekshiriladi); standart - joriy foydalanuvchi
#   avtokirish.ps1 -Off               - o'chirish (parol ombordan ham o'chiriladi)
#   avtokirish.ps1 -SelfTest          - LSA ombori va parol tekshiruvi ishlaydimi (CI uchun; avtomatik kirishga tegmaydi)
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
param([string]$User = '', [switch]$Off, [switch]$SelfTest, [switch]$Pause)

$ErrorActionPreference = 'Stop'
$Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$PasswordLess = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device'

function Note([string]$text) { Write-Host "   $text" }
function Warn([string]$text) { Write-Host "   ! $text" -ForegroundColor Yellow }
# -Pause: administrator oynasi alohida ochiladi - xabar o'qilmasdan yopilib ketmasin
function Done([int]$code) { if ($Pause) { Read-Host '   Davom etish uchun Enter' | Out-Null }; exit $code }
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; Done 1 }
function Is-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# Administrator huquqi o'zi so'raladi. Foydalanuvchi nomi undan OLDIN olinadi: boshqa administrator hisobi bilan tasdiqlansa,
# avtomatik kirish o'sha administratorga emas, Palantir ishlaydigan foydalanuvchiga sozlansin
if (-not $Off -and -not $SelfTest -and -not $User) { $User = "$($env:USERDOMAIN)\$($env:USERNAME)" }
if (-not (Is-Admin) -and -not $SelfTest) {
  $again = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Pause')
  if ($Off) { $again += '-Off' } else { $again += @('-User', "`"$User`"") }
  try { $p = Start-Process powershell -Verb RunAs -ArgumentList $again -Wait -PassThru } catch { Fail 'Administrator huquqi berilmadi' }
  exit $p.ExitCode
}

# LSA maxfiy ombori va parol tekshiruvi (advapi32). C# 5 sintaksisi: PowerShell 5.1 shu bilan kompilyatsiya qiladi
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CerebroLsa {
  [StructLayout(LayoutKind.Sequential)]
  private struct LsaString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)]
  private struct LsaAttributes { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }

  [DllImport("advapi32.dll")] private static extern uint LsaOpenPolicy(IntPtr system, ref LsaAttributes attributes, uint access, out IntPtr policy);
  [DllImport("advapi32.dll")] private static extern uint LsaStorePrivateData(IntPtr policy, ref LsaString key, IntPtr data);
  [DllImport("advapi32.dll")] private static extern uint LsaRetrievePrivateData(IntPtr policy, ref LsaString key, out IntPtr data);
  [DllImport("advapi32.dll")] private static extern uint LsaClose(IntPtr policy);
  [DllImport("advapi32.dll")] private static extern uint LsaFreeMemory(IntPtr buffer);
  [DllImport("advapi32.dll")] private static extern int LsaNtStatusToWinError(uint status);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool LogonUser(string user, string domain, string password, int logonType, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

  private const uint POLICY_ALL_ACCESS = 0x000F0FFF;
  private const uint NOT_FOUND = 0xC0000034;

  private static LsaString Text(string s) {
    LsaString r = new LsaString();
    r.Buffer = Marshal.StringToHGlobalUni(s);
    r.Length = (ushort)(s.Length * 2);
    r.MaximumLength = (ushort)(s.Length * 2 + 2);
    return r;
  }

  private static IntPtr Open() {
    LsaAttributes a = new LsaAttributes();
    a.Length = Marshal.SizeOf(typeof(LsaAttributes));
    IntPtr policy;
    uint status = LsaOpenPolicy(IntPtr.Zero, ref a, POLICY_ALL_ACCESS, out policy);
    if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status));
    return policy;
  }

  // value = null - maxfiy qiymat o'chiriladi
  public static void Store(string key, string value) {
    IntPtr policy = Open();
    LsaString k = Text(key);
    IntPtr data = IntPtr.Zero;
    LsaString v = new LsaString();
    try {
      if (value != null) {
        v = Text(value);
        data = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(LsaString)));
        Marshal.StructureToPtr(v, data, false);
      }
      uint status = LsaStorePrivateData(policy, ref k, data);
      if (status != 0 && !(value == null && status == NOT_FOUND)) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status));
    } finally {
      Marshal.FreeHGlobal(k.Buffer);
      if (v.Buffer != IntPtr.Zero) Marshal.FreeHGlobal(v.Buffer);
      if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
      LsaClose(policy);
    }
  }

  // Yo'q bo'lsa - null
  public static string Retrieve(string key) {
    IntPtr policy = Open();
    LsaString k = Text(key);
    IntPtr data;
    try {
      uint status = LsaRetrievePrivateData(policy, ref k, out data);
      if (status == NOT_FOUND) return null;
      if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status));
      LsaString s = (LsaString)Marshal.PtrToStructure(data, typeof(LsaString));
      string result = Marshal.PtrToStringUni(s.Buffer, s.Length / 2);
      LsaFreeMemory(data);
      return result;
    } finally {
      Marshal.FreeHGlobal(k.Buffer);
      LsaClose(policy);
    }
  }

  // Parol to'g'rimi: Windows'ga haqiqiy (interaktiv) kirish bilan tekshiriladi
  public static bool CheckPassword(string user, string domain, string password) {
    IntPtr token;
    bool ok = LogonUser(user, domain, password, 2, 0, out token);
    if (ok) CloseHandle(token);
    return ok;
  }
}
'@

if (-not (Is-Admin)) { Fail 'Administrator huquqi kerak' }

# --- Sinov (CI): ombor yozadi, o'qiydi, o'chiradi; noto'g'ri parol rad etiladi ---------------
if ($SelfTest) {
  $key = 'CerebroSelfTest'
  [CerebroLsa]::Store($key, 'sinov-123')
  $back = [CerebroLsa]::Retrieve($key)
  [CerebroLsa]::Store($key, $null)
  $gone = [CerebroLsa]::Retrieve($key)
  $wrong = [CerebroLsa]::CheckPassword($env:USERNAME, $env:USERDOMAIN, "notogri-$([guid]::NewGuid())")
  if ($back -eq 'sinov-123' -and $null -eq $gone -and -not $wrong) { Note 'LSA ombori va parol tekshiruvi ishlaydi'; Done 0 }
  Fail "Sinov o'tmadi: o'qildi=[$back] o'chgandan keyin=[$gone] notogri parol qabul qilindi=$wrong"
}

# --- O'chirish -----------------------------------------------------------------
if ($Off) {
  Set-ItemProperty -Path $Winlogon -Name AutoAdminLogon -Value '0'
  Remove-ItemProperty -Path $Winlogon -Name DefaultPassword -ErrorAction SilentlyContinue
  [CerebroLsa]::Store('DefaultPassword', $null)
  Note "Avtomatik kirish o'chirildi, parol ombordan o'chirildi"
  Done 0
}

# --- Yoqish --------------------------------------------------------------------
if (-not $User -or $User -notmatch '^[^\\]+\\[^\\]+$') { Fail "Foydalanuvchi DOMEN\nom ko'rinishida berilishi kerak (-User)" }
$domain, $name = $User -split '\\', 2
Write-Host ''
Write-Host "   Svet o'chib-yonganda Windows '$User' bilan o'zi kiradi va ekranni darhol qulflaydi."
$secure = Read-Host "   '$User' ning Windows paroli" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $plain) { Fail "Parolsiz foydalanuvchi: avval Windows'da parol qo'ying (Sozlamalar > Hisoblar > Kirish parametrlari), keyin qayta urining" }
if (-not [CerebroLsa]::CheckPassword($name, $domain, $plain)) { Fail "Parol noto'g'ri - avtomatik kirish yoqilmadi" }

[CerebroLsa]::Store('DefaultPassword', $plain)
$plain = $null
Set-ItemProperty -Path $Winlogon -Name AutoAdminLogon -Value '1'
Set-ItemProperty -Path $Winlogon -Name DefaultUserName -Value $name
Set-ItemProperty -Path $Winlogon -Name DefaultDomainName -Value $domain
# Ochiq matndagi eski parol va 'faqat N marta' cheklovi qolmasin
Remove-ItemProperty -Path $Winlogon -Name DefaultPassword -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $Winlogon -Name AutoLogonCount -ErrorAction SilentlyContinue
# 'Faqat Windows Hello bilan kirish' yoqilgan bo'lsa Windows avtomatik kirishni e'tiborsiz qoldiradi
if ((Get-ItemProperty -Path $PasswordLess -Name DevicePasswordLessBuildVersion -ErrorAction SilentlyContinue).DevicePasswordLessBuildVersion -eq 2) {
  Set-ItemProperty -Path $PasswordLess -Name DevicePasswordLessBuildVersion -Value 0
  Warn "'Faqat Windows Hello bilan kirish' o'chirildi - usiz avtomatik kirish ishlamaydi"
}
Note "Avtomatik kirish yoqildi: svet o'chib-yonganda Palantir 1-2 daqiqada o'zi ishga tushadi, ekran qulflangan bo'ladi"
Note "BIOS'da 'Restore on AC power loss -> Power On' ham qo'yilgan bo'lsin (docs\ORNATISH.md)"
Done 0
