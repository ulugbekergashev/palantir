' Palantir'ni oynasiz (fonda) ishga tushiradi. Kompyuter yonganda shu fayl ishlaydi (Avtoyuklash papkasidagi yorliq orqali).
' Nazoratchi (scripts\supervise.mjs) serverni yoqadi va to'xtab qolsa qayta yoqadi. Jurnal: DATA_DIR\logs
' Svet o'chib-yonib Windows o'zi kirgan bo'lsa (install\avtokirish.ps1) - ekran darhol qulflanadi: Palantir ishlayveradi,
' kompyuter yonidagi odam esa parolsiz kira olmaydi. Odam o'zi kirganda qulflanmaydi.
Option Explicit
Dim fso, shell, root
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
' Windows vazifasi "Palantir" bor bo'lsa (administrator bilan o'rnatilgan) - qo'lda yoqish ham shu vazifa orqali: Palantir
' foydalanuvchi seansidan tashqarida ishlaydi va Windows'dan chiqilganda o'chmaydi (H10). Vazifa yo'q - avvalgidek shu seansda
If shell.Run("schtasks.exe /Query /TN Palantir", 0, True) = 0 Then
  shell.Run "schtasks.exe /Run /TN Palantir", 0, True
Else
  shell.Run "cmd /c node scripts\supervise.mjs", 0, False
End If
If AutoLogonJustNow() Then shell.Run "rundll32.exe user32.dll,LockWorkStation", 0, False

' Avtomatik kirish yoqilgan va kompyuter 5 daqiqadan kam oldin yongan - demak bu kirishni odam emas, Windows qildi
Function AutoLogonJustNow()
  Dim flag, os, boot, booted
  AutoLogonJustNow = False
  On Error Resume Next
  flag = shell.RegRead("HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\AutoAdminLogon")
  If Err.Number <> 0 Then Exit Function
  If CStr(flag) <> "1" Then Exit Function
  For Each os In GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT LastBootUpTime FROM Win32_OperatingSystem")
    boot = os.LastBootUpTime
  Next
  If Err.Number <> 0 Or Len(boot) < 14 Then Exit Function
  ' yyyymmddHHMMSS.ffffff+zzz - mahalliy vaqt
  booted = DateSerial(Left(boot, 4), Mid(boot, 5, 2), Mid(boot, 7, 2)) + TimeSerial(Mid(boot, 9, 2), Mid(boot, 11, 2), Mid(boot, 13, 2))
  If Err.Number <> 0 Then Exit Function
  AutoLogonJustNow = (DateDiff("n", booted, Now) < 5)
End Function
