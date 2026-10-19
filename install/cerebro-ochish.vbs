' Ish stolidagi «Cerebro» yorlig'i: Cerebro'ni fonda yoqadi (server va — sozlangan bo'lsa — telefon liniyasi, AI qabulxona),
' tayyor bo'lishini kutadi va AI bosh ekranni (#/ai) brauzerda ochadi. Allaqachon ishlab turgan bo'lsa — faqat panelni ochadi.
Option Explicit
Dim fso, shell, root, port, url, i, http, ready
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

port = EnvValue("PORT")
If port = "" Then port = "3200"
url = "http://localhost:" & port

' Nazoratchi o'zi tekshiradi: ishlab turgan bo'lsa ikkinchisi darhol chiqib ketadi
shell.Run "cmd /c node scripts\supervise.mjs", 0, False

ready = False
For i = 1 To 60
  If Healthy() Then
    ready = True
    Exit For
  End If
  WScript.Sleep 1000
Next

If ready Then
  OpenApp url & "/#/ai"
Else
  MsgBox "Cerebro bir daqiqada ishga tushmadi." & vbCrLf & "Sababi jurnalda: " & root & "\data\logs\supervisor.log", vbExclamation, "Cerebro"
End If

' Cerebro alohida ilova oynasida (tablarsiz, manzil satrisiz; vazifalar panelida o'z belgisi): Chrome yoki Edge --app.
' Ikkalasi ham bo'lmasa — oddiy brauzerda
Sub OpenApp(target)
  Dim browsers, b, pf, pf86, lad
  pf = shell.ExpandEnvironmentStrings("%ProgramFiles%")
  pf86 = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
  lad = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
  browsers = Array(pf & "\Google\Chrome\Application\chrome.exe", pf86 & "\Google\Chrome\Application\chrome.exe", _
                   lad & "\Google\Chrome\Application\chrome.exe", pf86 & "\Microsoft\Edge\Application\msedge.exe", pf & "\Microsoft\Edge\Application\msedge.exe")
  For Each b In browsers
    If fso.FileExists(b) Then
      ' Ovoz bosishsiz ham ishlasin («Quloq»: «Cerebro» deb chaqirish) — brauzer hali ochilmagan bo'lsa kuchga kiradi
      shell.Run """" & b & """ --app=" & target & " --start-maximized --autoplay-policy=no-user-gesture-required", 1, False
      Exit Sub
    End If
  Next
  shell.Run target
End Sub

Function Healthy()
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 2000, 2000
  http.Open "GET", "http://127.0.0.1:" & port & "/api/health", False
  http.Send
  Healthy = (Err.Number = 0 And http.Status = 200)
  On Error GoTo 0
End Function

' .env dagi qiymat (yo'q bo'lsa — bo'sh)
Function EnvValue(name)
  Dim f, line
  EnvValue = ""
  If Not fso.FileExists(root & "\.env") Then Exit Function
  Set f = fso.OpenTextFile(root & "\.env", 1)
  Do Until f.AtEndOfStream
    line = Trim(f.ReadLine)
    If Left(line, Len(name) + 1) = name & "=" Then EnvValue = Trim(Mid(line, Len(name) + 2))
  Loop
  f.Close
End Function
