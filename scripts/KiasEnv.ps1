<#
.SYNOPSIS
    Gemeinsame Helfer fuer die .env von neo-KIAS.

.DESCRIPTION
    Wird von install-windows.ps1 und von der MSI (installer\msi-configure.ps1)
    eingebunden. Beide muessen dieselbe Datei auf dieselbe Weise anlegen und
    ergaenzen, sonst laufen die Ergebnisse der beiden Installationswege
    auseinander.

    Vor dem Einbinden muss $script:EnvFile gesetzt sein.
#>

# Schluessel, die einer vorhandenen .env gefehlt haben. Die Aufrufer zeigen
# sie am Ende an, damit eine Aktualisierung nachvollziehbar bleibt.
$script:AddedKeys = @()

function Get-EnvValue {
    param([string] $Key)
    if (-not (Test-Path -LiteralPath $script:EnvFile)) { return '' }
    $line = Select-String -LiteralPath $script:EnvFile -Pattern "^$([regex]::Escape($Key))=" |
            Select-Object -Last 1
    if ($null -eq $line) { return '' }
    return $line.Line.Substring($Key.Length + 1)
}

# Zahl aus der .env, mit Rueckfallwert wenn dort nichts Brauchbares steht.
function Get-EnvPort {
    param([string] $Key, [int] $Fallback)
    $value = Get-EnvValue $Key
    if ($value -match '^\s*(\d+)\s*$') { return [int] $Matches[1] }
    return $Fallback
}

function Test-EnvKey {
    param([string] $Key)
    if (-not (Test-Path -LiteralPath $script:EnvFile)) { return $false }
    return [bool] (Select-String -LiteralPath $script:EnvFile -Pattern "^$([regex]::Escape($Key))=" -Quiet)
}

# Ueberschreiben, oder anhaengen falls der Schluessel fehlt.
#
# Geschrieben wird ausdruecklich ohne Byte Order Mark. "Set-Content -Encoding
# UTF8" setzt in Windows PowerShell eines an den Anfang, und ein BOM vor der
# ersten Zeile macht deren Schluessel fuer docker compose unlesbar.
function Set-EnvValue {
    param([string] $Key, [string] $Value)
    if (Test-EnvKey $Key) {
        $lines = @(Get-Content -LiteralPath $script:EnvFile)
        $out = foreach ($line in $lines) {
            if ($line -match "^$([regex]::Escape($Key))=") { "$Key=$Value" } else { $line }
        }
        [System.IO.File]::WriteAllLines(
            $script:EnvFile, [string[]] $out, (New-Object System.Text.UTF8Encoding($false)))
    } else {
        Add-Content -LiteralPath $script:EnvFile -Value "$Key=$Value"
    }
}

# Nur anhaengen, wenn der Schluessel noch gar nicht vorkommt. Damit wird eine
# .env aus einer aelteren Fassung vollstaendig, ohne dass eingestellte Werte
# verlorengehen.
function Set-EnvDefault {
    param([string] $Key, [string] $Value)
    if (Test-EnvKey $Key) { return }
    Add-Content -LiteralPath $script:EnvFile -Value "$Key=$Value"
    $script:AddedKeys += $Key
}

# Passwort ohne Sonderzeichen: es landet in einer .env und in einer
# Verbindungsadresse, und an beiden Stellen waeren Schraegstriche oder
# Anfuehrungszeichen ein eigenes Problem. Aehnlich aussehende Zeichen wie
# l, I, 0 und O fehlen, weil solche Passwoerter abgetippt werden.
function New-Secret {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = [byte[]]::new(24)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

# Docker Desktop nimmt Pfade mit Schraegstrichen entgegen und stolpert nicht
# ueber Rueckstriche in der .env, die compose sonst als Escape lesen koennte.
function ConvertTo-ComposePath {
    param([string] $Path)
    return ($Path -replace '\\', '/').TrimEnd('/')
}

<#
.SYNOPSIS
    Die .env anlegen oder vervollstaendigen.

.DESCRIPTION
    Eine vorhandene Datei behaelt jeden gesetzten Wert, es kommen nur
    fehlende Schluessel dazu. Passwoerter werden genau einmal gewuerfelt.
    Gibt das erzeugte Verwaltungspasswort zurueck, oder eine leere
    Zeichenkette, wenn schon eines dastand.
#>
function Initialize-KiasEnv {
    param(
        [Parameter(Mandatory = $true)][string] $DataDir,
        [string] $ExampleFile,
        [string] $AdminPassword = '',
        [switch] $NoAdmin
    )

    if (-not (Test-Path -LiteralPath $script:EnvFile)) {
        if (-not $ExampleFile -or -not (Test-Path -LiteralPath $ExampleFile)) {
            throw ".env.example fehlt, .env kann nicht erzeugt werden."
        }
        Copy-Item -LiteralPath $ExampleFile -Destination $script:EnvFile
    }

    Set-EnvValue 'KIAS_DATA_DIR' (ConvertTo-ComposePath $DataDir)

    Set-EnvDefault 'HOST_PORT'  '5175'
    Set-EnvDefault 'API_PORT'   '5176'
    Set-EnvDefault 'ADMIN_PORT' '5177'
    Set-EnvDefault 'KIAS_ADMIN_SESSION_HOURS' '8'

    $generated = ''
    if ($NoAdmin) {
        Set-EnvValue 'COMPOSE_PROFILES' ''
        Set-EnvValue 'KIAS_ADMIN' 'false'
        return $generated
    }

    Set-EnvDefault 'COMPOSE_PROFILES' 'admin'
    Set-EnvDefault 'KIAS_ADMIN' 'true'

    if ($AdminPassword) {
        Set-EnvValue 'KIAS_ADMIN_PASSWORD' $AdminPassword
    } elseif (-not (Get-EnvValue 'KIAS_ADMIN_PASSWORD')) {
        $generated = New-Secret
        Set-EnvValue 'KIAS_ADMIN_PASSWORD' $generated
    }

    $pg = Get-EnvValue 'POSTGRES_PASSWORD'
    if (-not $pg -or $pg -eq 'kias') { Set-EnvValue 'POSTGRES_PASSWORD' (New-Secret) }

    return $generated
}
