' Palantir'ni oynasiz (fonda) ishga tushiradi. Kompyuter yonganda shu fayl ishlaydi (Avtoyuklash papkasidagi yorliq orqali).
' Nazoratchi (scripts\supervise.mjs) serverni yoqadi va to'xtab qolsa qayta yoqadi. Jurnal: DATA_DIR\logs
Option Explicit
Dim fso, shell, root
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "cmd /c node scripts\supervise.mjs", 0, False
