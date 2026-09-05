' Lanza la app sin abrir ninguna ventana de consola.
' Usa rutas relativas a este propio archivo para que funcione en cualquier
' equipo donde se clone el repo (tras haber corrido "npm install").
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
WshShell.Run """" & scriptDir & "\node_modules\electron\dist\electron.exe"" .", 1, False
