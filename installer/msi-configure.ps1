<#
.SYNOPSIS
    Die .env anlegen, aufgerufen aus der MSI.

.DESCRIPTION
    Laeuft als aufgeschobene Custom Action im Systemkontext, direkt nachdem
    die Dateien liegen und bevor der Dienst startet. Baut kein Abbild und
    startet keine Container: das macht der Dienst selbst, weil dafuer die
    Docker-Engine laufen muss, und die steht bei einer frischen
    Docker-Installation erst nach der Anmeldung bereit.

    Eine vorhandene .env wird nicht ueberschrieben, nur ergaenzt. Eine
    Neuinstallation ueber eine bestehende hinweg behaelt damit Passwoerter
    und Ports.

.NOTES
    Ausgaben landen im Protokoll unter %ProgramData%\neo-KIAS.
#>

[CmdletBinding()]
param(
    # Verzeichnis, in das die MSI installiert hat.
    [Parameter(Mandatory = $true)][string] $InstallDir,

    # Verzeichnis mit Daten\, Update\ und Formulare\.
    [Parameter(Mandatory = $true)][string] $DataDir,

    # Optionales Passwort der Verwaltung. Ohne Angabe wird eines erzeugt.
    [string] $AdminPassword = '',

    # Ohne Verwaltung und ohne Datenbank einrichten.
    [switch] $NoAdmin
)

$ErrorActionPreference = 'Stop'

$logDir = Join-Path $env:ProgramData 'neo-KIAS'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'install.log'

function Write-Log {
    param([string] $Text)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Add-Content -LiteralPath $logFile -Value $line
    Write-Host $line
}

try {
    Write-Log "Konfiguriere neo-KIAS in $InstallDir (Daten: $DataDir)"

    $EnvFile = Join-Path $InstallDir '.env'
    . (Join-Path $InstallDir 'scripts\KiasEnv.ps1')

    $fresh = -not (Test-Path -LiteralPath $EnvFile)
    $generated = Initialize-KiasEnv `
        -DataDir $DataDir `
        -ExampleFile (Join-Path $InstallDir '.env.example') `
        -AdminPassword $AdminPassword `
        -NoAdmin:$NoAdmin

    # Compose legt das Protokollverzeichnis sonst als Datei an, wenn der
    # Pfad beim ersten Start noch nicht existiert.
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null

    if ($fresh) {
        Write-Log ".env erzeugt"
    } elseif ($script:AddedKeys.Count -gt 0) {
        Write-Log (".env ergaenzt um: " + ($script:AddedKeys -join ', '))
    } else {
        Write-Log ".env vorhanden, unveraendert uebernommen"
    }

    if ($generated) {
        Write-Log "Passwort der Verwaltung erzeugt, es steht in $EnvFile unter KIAS_ADMIN_PASSWORD"
    }

    Write-Log 'Fertig. Den Rest erledigt der Dienst neo-KIAS: Abbild bauen und Container starten.'
    exit 0
} catch {
    Write-Log "FEHLER: $($_.Exception.Message)"
    exit 1
}
