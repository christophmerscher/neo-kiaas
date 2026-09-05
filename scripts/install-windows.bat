@echo off
rem ===========================================================================
rem  neo-KIAS unter Windows 11 einrichten.
rem
rem  Diese Datei ist nur der Starter. Die eigentliche Arbeit macht
rem  install-windows.ps1 daneben; das vermeidet zwei Fassungen derselben
rem  Logik, die nach dem dritten Aendern auseinanderlaufen.
rem
rem  Doppelklick genuegt: fehlen die Administratorrechte, fragt der Starter
rem  selbst danach. Alle Argumente werden durchgereicht:
rem
rem      install-windows.bat -DataDir C:\Kias
rem      install-windows.bat -DataDir D:\Kias -Port 8080 -NoAdmin
rem ===========================================================================

setlocal
set "PS_SCRIPT=%~dp0install-windows.ps1"

if not exist "%PS_SCRIPT%" (
    echo Fehler: install-windows.ps1 liegt nicht neben dieser Datei.
    echo Erwartet: %PS_SCRIPT%
    pause
    exit /b 1
)

rem Rechte pruefen, mit derselben Abfrage wie im PowerShell-Skript. Ein
rem eigener Test ueber "net session" oder "fltmc" kann je nach Rechner
rem falsch antworten, und dann liefe die Erhoehung unten im Kreis.
powershell.exe -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if errorlevel 1 goto elevate

rem PowerShell 7 bevorzugen, falls vorhanden, sonst das mitgelieferte 5.1.
set "PS_EXE=powershell.exe"
where pwsh >nul 2>&1
if not errorlevel 1 set "PS_EXE=pwsh.exe"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo Fertig.
) else (
    echo Abgebrochen mit Code %RC%.
)
pause
exit /b %RC%

:elevate
rem Ohne Administratorrechte: dieselbe Datei noch einmal starten, erhoben.
rem Die Installation laeuft dann in einem eigenen Fenster weiter, deshalb
rem endet dieses hier gleich danach.
echo Administratorrechte werden angefordert...
if "%*"=="" (
    powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
) else (
    powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
)
exit /b 0
