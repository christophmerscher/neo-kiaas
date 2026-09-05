<#
.SYNOPSIS
    neo-KIAS unter Windows 11 einrichten.

.DESCRIPTION
    Das Gegenstueck zu scripts/install-debian.sh. Es prueft Docker Desktop,
    kopiert das Repository nach C:\neo-kias, legt die .env aus .env.example
    an, wuerfelt die Passwoerter fuer Verwaltung und Datenbank aus, baut das
    Image und richtet eine Aufgabe ein, die den Stapel bei der Anmeldung
    startet. Zum Schluss wartet es, bis die Dienste antworten.

    Wiederholbar: eingestellte Werte in der .env bleiben unangetastet,
    fehlende Schluessel werden ergaenzt, Passwoerter nicht neu gewuerfelt.
    Angegebene Optionen gewinnen gegen das, was in der .env steht.

    Ein Unterschied zu Debian, der sich nicht wegkonfigurieren laesst:
    Docker Desktop ist kein Dienst, sondern eine Anwendung. Sie laeuft nur,
    solange ein Benutzer angemeldet ist. Fuer einen Rechner, der
    unbeaufsichtigt durchlaeuft, ist Linux die bessere Wahl.

.EXAMPLE
    .\install-windows.ps1 -DataDir C:\Kias

.EXAMPLE
    .\install-windows.ps1 -DataDir D:\Kias -Port 8080 -AdminPassword geheim
#>

#Requires -Version 5.1

[CmdletBinding()]
param(
    # Verzeichnis mit Daten\, Update\ und Formulare\. Ohne Angabe wird gefragt.
    [string] $DataDir = '',

    # Port der Suche auf diesem Rechner.
    [int] $Port = 0,

    # Port der REST-Schnittstelle.
    [int] $ApiPort = 0,

    # Port der Verwaltung.
    [int] $AdminPort = 0,

    # Passwort der Verwaltung. Ohne Angabe wird beim ersten Lauf eines erzeugt.
    [string] $AdminPassword = '',

    # Ohne Verwaltung und ohne Datenbank einrichten. Dann gibt es keinen Weg,
    # die Daten neu einzulesen.
    [switch] $NoAdmin,

    # Docker Desktop nicht anfassen, es ist bereits vorhanden.
    [switch] $SkipDocker,

    # Alles einrichten, aber nicht starten.
    [switch] $NoStart,

    # Zielverzeichnis der Installation.
    [string] $InstallDir = 'C:\neo-kias'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir   = Split-Path -Parent $ScriptDir
$EnvFile   = Join-Path $InstallDir '.env'
$TaskName  = 'neo-KIAS'

# Wird gesetzt, wenn das Skript selbst ein Passwort erzeugt hat; nur dann
# steht es am Ende auf dem Bildschirm.
$script:GeneratedAdminPassword = ''
# Schluessel, die einer vorhandenen .env gefehlt haben.
$script:AddedKeys = @()

# ── Ausgabe ────────────────────────────────────────────────────────────────

function Write-Step { param([string] $Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "  ok $Text" -ForegroundColor Green }
function Write-Warn { param([string] $Text) Write-Host "Warnung: $Text" -ForegroundColor Yellow }
function Stop-Setup { param([string] $Text) Write-Host "Fehler: $Text" -ForegroundColor Red; exit 1 }

# ── Gemeinsame Helfer ──────────────────────────────────────────────────────
#
# Die .env-Helfer teilt sich dieses Skript mit der MSI. Beide muessen die
# Datei gleich anlegen und ergaenzen, sonst laufen die Ergebnisse der beiden
# Installationswege auseinander.
. (Join-Path $ScriptDir 'KiasEnv.ps1')

function Test-PortBusy {
    param([int] $PortNumber)
    try {
        $null = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-Url {
    param([string] $Url)
    try {
        $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return $true
    } catch {
        return $false
    }
}

# ── Vorbedingungen ─────────────────────────────────────────────────────────

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Stop-Setup 'Bitte als Administrator ausfuehren (install-windows.bat mit Rechtsklick, "Als Administrator ausfuehren").'
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'docker-compose.yml')) -or
    -not (Test-Path -LiteralPath (Join-Path $RepoDir 'Dockerfile'))) {
    Stop-Setup "Das Skript muss aus dem neo-KIAS-Repository heraus laufen ($RepoDir sieht nicht danach aus)."
}

$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
    Write-Warn "Windows $($osVersion.Major).$($osVersion.Minor) ist aelter als 10. Docker Desktop verlangt Windows 10 oder 11."
}

# ── Docker ─────────────────────────────────────────────────────────────────

function Test-DockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    # "compose version" antwortet nur, wenn auch die Engine laeuft.
    try {
        $null = docker compose version 2>$null
    } catch {
        return $false
    }
    return ($LASTEXITCODE -eq 0)
}

if (Test-DockerReady) {
    Write-Ok "Docker vorhanden: $((docker --version) -replace ',.*', '')"
} elseif ($SkipDocker) {
    Stop-Setup '-SkipDocker gesetzt, aber "docker compose" antwortet nicht. Laeuft Docker Desktop?'
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    Stop-Setup 'Docker ist installiert, antwortet aber nicht. Docker Desktop starten, das Wal-Symbol abwarten und das Skript noch einmal aufrufen.'
} else {
    Write-Step 'Installiere Docker Desktop ueber winget'
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Stop-Setup 'winget fehlt. Docker Desktop bitte von https://docker.com/products/docker-desktop von Hand installieren und das Skript danach erneut aufrufen.'
    }
    winget install --id Docker.DockerDesktop --exact --accept-source-agreements --accept-package-agreements
    Write-Host ''
    Write-Warn 'Docker Desktop ist installiert, laeuft aber noch nicht.'
    Write-Host @'
Jetzt bitte:
  1. Windows neu starten, falls winget danach verlangt hat.
  2. Docker Desktop starten und warten, bis das Wal-Symbol ruhig steht.
  3. Dieses Skript noch einmal aufrufen.
'@
    exit 0
}

# ── Datenverzeichnis ───────────────────────────────────────────────────────

if (-not $DataDir -and (Test-Path -LiteralPath $EnvFile)) {
    # Bei einer Aktualisierung den bestehenden Wert uebernehmen.
    $DataDir = Get-EnvValue 'KIAS_DATA_DIR'
    if ($DataDir) { Write-Step "Uebernehme KIAS_DATA_DIR aus der vorhandenen .env: $DataDir" }
}

if (-not $DataDir) {
    $DataDir = Read-Host 'Pfad zum KIAS-Datenverzeichnis (enthaelt Daten\, Update\, Formulare\)'
}

if (-not $DataDir) { Stop-Setup 'Das Datenverzeichnis darf nicht leer sein.' }

$DataDir = ConvertTo-ComposePath $DataDir
if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'Daten'))) {
    Write-Warn "Unter $DataDir liegt kein Verzeichnis 'Daten'. Die Anwendung startet dann mit 0 Aktionen."
}

# ── Dateien nach C:\neo-kias ───────────────────────────────────────────────

Write-Step "Installiere nach $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# node_modules, gebaute Buendel, Logs, .env und die Git-Historie gehoeren
# nicht dorthin: das Image baut seine Abhaengigkeiten selbst.
$robocopyArgs = @(
    $RepoDir, $InstallDir, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', '.git', 'node_modules', 'dist', 'logs',
    '/XF', '.env'
)
& robocopy @robocopyArgs | Out-Null
# Robocopy meldet Erfolg mit 0 bis 7; ab 8 ist etwas schiefgegangen.
if ($LASTEXITCODE -ge 8) { Stop-Setup "Kopieren fehlgeschlagen (robocopy $LASTEXITCODE)." }
Write-Ok 'Dateien kopiert'

# ── .env ───────────────────────────────────────────────────────────────────

$freshEnv = -not (Test-Path -LiteralPath $EnvFile)
if (-not $freshEnv) { Write-Ok '.env vorhanden, eingestellte Werte bleiben' }

$hadPassword = [bool] (Get-EnvValue 'KIAS_ADMIN_PASSWORD')

# Anlegen, ergaenzen, Passwoerter wuerfeln. Dieselbe Routine benutzt die MSI.
$script:GeneratedAdminPassword = Initialize-KiasEnv `
    -DataDir $DataDir `
    -ExampleFile (Join-Path $InstallDir '.env.example') `
    -AdminPassword $AdminPassword `
    -NoAdmin:$NoAdmin

if ($NoAdmin) {
    Write-Step 'Ohne Verwaltung (-NoAdmin): kein Weg, die Daten neu einzulesen.'
} elseif ($AdminPassword) {
    Write-Ok 'Passwort der Verwaltung aus -AdminPassword uebernommen'
} elseif ($script:GeneratedAdminPassword) {
    Write-Ok 'Passwort der Verwaltung erzeugt'
} elseif ($hadPassword) {
    Write-Ok 'Passwort der Verwaltung bleibt, wie es in der .env steht'
}

# Angegebene Optionen gewinnen, alles andere bleibt, wie es war.
if ($Port -gt 0)      { Set-EnvValue 'HOST_PORT'  "$Port" }
if ($ApiPort -gt 0)   { Set-EnvValue 'API_PORT'   "$ApiPort" }
if ($AdminPort -gt 0) { Set-EnvValue 'ADMIN_PORT' "$AdminPort" }

# Unter Windows gibt es keine uid 1000: Docker Desktop reicht Bind-Mounts
# ohne Rechtepruefung durch. Das Verzeichnis muss nur existieren.
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null

$adminOn = Get-EnvValue 'COMPOSE_PROFILES'

if ($freshEnv) {
    Write-Ok ".env aus .env.example erzeugt (KIAS_DATA_DIR=$DataDir)"
} elseif ($script:AddedKeys.Count -gt 0) {
    Write-Ok (".env ergaenzt um: " + ($script:AddedKeys -join ', '))
}

$hostPortInUse  = Get-EnvPort 'HOST_PORT'  5175
$apiPortInUse   = Get-EnvPort 'API_PORT'   5176
$adminPortInUse = Get-EnvPort 'ADMIN_PORT' 5177

# Belegte Ports melden, aber nur solange nichts von uns laeuft: sonst warnt
# das Skript bei jedem zweiten Lauf ueber die eigenen Container.
$running = ''
try { $running = docker ps --filter 'name=rest-kias' --format '{{.Names}}' 2>$null } catch { }
if (-not $running) {
    $toCheck = @{ 'Suche' = $hostPortInUse; 'Schnittstelle' = $apiPortInUse }
    if ($adminOn) { $toCheck['Verwaltung'] = $adminPortInUse }
    foreach ($name in $toCheck.Keys) {
        if (Test-PortBusy $toCheck[$name]) {
            Write-Warn "Port $($toCheck[$name]) ($name) ist bereits belegt. In der .env einen anderen setzen."
        }
    }
}

# ── Image bauen ────────────────────────────────────────────────────────────

Write-Step 'Baue das Image (beim ersten Mal einige Minuten)'
Push-Location $InstallDir
try {
    # Alle drei Dienste teilen sich ein Image; das Profil sorgt dafuer, dass
    # auch bei abgeschalteter Verwaltung dasselbe Abbild entsteht.
    docker compose --profile admin build
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'Der Bau des Images ist fehlgeschlagen.' }
} finally {
    Pop-Location
}
Write-Ok 'Image gebaut'

# ── Autostart ──────────────────────────────────────────────────────────────
#
# Windows hat kein systemd. Die Container tragen "restart: unless-stopped",
# kommen nach einem Neustart also von allein wieder hoch, sobald Docker
# Desktop laeuft. Die Aufgabe hier deckt den Rest ab: sie legt fehlende
# Container neu an, etwa nach einem "docker compose down".
Write-Step "Richte die geplante Aufgabe '$TaskName' ein"
$dockerExe = (Get-Command docker).Source
$action = New-ScheduledTaskAction -Execute $dockerExe `
    -Argument 'compose up -d' -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
# Verzoegerung, weil Docker Desktop nach der Anmeldung selbst erst hochkommt.
$trigger.Delay = 'PT2M'
# Als der angemeldete Benutzer, nicht als SYSTEM: Docker Desktop gehoert zur
# Sitzung dieses Benutzers, ein Dienstkonto sieht seine Engine nicht.
$taskUser = "$env:USERDOMAIN\$env:USERNAME"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -User $taskUser -RunLevel Highest -Force | Out-Null
Write-Ok 'Aufgabe eingerichtet (startet bei der Anmeldung)'

# ── Starten ────────────────────────────────────────────────────────────────

if ($NoStart) {
    Write-Step 'Start uebersprungen (-NoStart)'
} else {
    Write-Step 'Starte die Dienste'
    Push-Location $InstallDir
    try {
        docker compose up -d
        if ($LASTEXITCODE -ne 0) { Stop-Setup 'Der Start ist fehlgeschlagen.' }
    } finally {
        Pop-Location
    }

    # Kurz abwarten, ob die Dienste tatsaechlich antworten. Nicht auf die
    # Daten warten: deren Einlesen dauert Minuten, und /api/ping antwortet
    # ausdruecklich schon vorher.
    Write-Step 'Warte auf die Dienste'
    $waited = 0
    while ($waited -lt 60 -and -not (Test-Url "http://127.0.0.1:$apiPortInUse/api/ping")) {
        Start-Sleep -Seconds 2
        $waited += 2
    }
    if ($waited -lt 60) {
        Write-Ok 'Schnittstelle antwortet'
    } else {
        Write-Warn "Die Schnittstelle hat in 60 Sekunden nicht geantwortet. 'docker compose logs -f rest-kias' zeigt, woran es liegt."
    }

    if (Test-Url "http://127.0.0.1:$hostPortInUse/healthz") {
        Write-Ok 'Suche antwortet'
    } else {
        Write-Warn "Die Suche unter Port $hostPortInUse antwortet nicht."
    }

    if ($adminOn) {
        if (Test-Url "http://127.0.0.1:$adminPortInUse/healthz") {
            Write-Ok 'Verwaltung antwortet'
        } else {
            Write-Warn "Die Verwaltung unter Port $adminPortInUse antwortet nicht."
        }
    }
}

# ── Abschluss ──────────────────────────────────────────────────────────────

$verwaltung = if ($adminOn) { "http://localhost:$adminPortInUse" } else { 'abgeschaltet (-NoAdmin)' }

Write-Host ''
Write-Host 'neo-KIAS ist installiert.' -ForegroundColor Green
Write-Host ''
Write-Host "  Verzeichnis     $InstallDir"
Write-Host "  Konfiguration   $EnvFile"
Write-Host "  Daten           $DataDir"
Write-Host "  Suche           http://localhost:$hostPortInUse"
Write-Host "  Schnittstelle   http://localhost:$apiPortInUse"
Write-Host "  API-Doku        http://localhost:$hostPortInUse/api/docs"
Write-Host "  Verwaltung      $verwaltung"

if ($adminOn) {
    if ($script:GeneratedAdminPassword) {
        Write-Host ''
        Write-Host 'Zugang zur Verwaltung' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '  Benutzer        admin'
        Write-Host "  Passwort        $($script:GeneratedAdminPassword)"
        Write-Host ''
        Write-Host 'Dieses Passwort wurde eben erzeugt und steht nur hier und in der .env.'
        Write-Host "Jetzt notieren. Aendern geht in $EnvFile unter KIAS_ADMIN_PASSWORD,"
        Write-Host 'danach "docker compose up -d" im Installationsverzeichnis.'
    } else {
        Write-Host ''
        Write-Host '  Verwaltung: Benutzer admin, Passwort aus KIAS_ADMIN_PASSWORD in der .env.'
    }
}

Write-Host @"

Nuetzliche Befehle (im Verzeichnis $InstallDir):

  docker compose ps
  docker compose logs -f rest-kias
  docker compose up -d
  docker compose down

Das erste Einlesen der DBF-Dateien dauert je nach Datentraeger bis zu zwei
Minuten. Solange zeigt die Oberflaeche einen Ladebildschirm mit Fortschritt.
Neu einlesen geht danach in der Verwaltung, in der Suche gibt es den Knopf
bewusst nicht mehr.

Docker Desktop ist kein Dienst: der Stapel laeuft nur, solange ein Benutzer
angemeldet ist. Fuer einen Rechner, der unbeaufsichtigt durchlaeuft, ist die
Debian-Installation die bessere Wahl.
"@
