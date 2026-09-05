<#
.SYNOPSIS
    Die neo-KIAS.msi bauen.

.DESCRIPTION
    Vier Schritte:
      1. Den Windows-Dienst uebersetzen, mit dem csc.exe des .NET Framework.
         Kein SDK noetig, das Framework liegt auf jedem Windows 10 und 11.
      2. Die Lizenz von Text nach RTF bringen, weil der Lizenzdialog von
         Windows Installer nur RTF anzeigt.
      3. Aus dem Projektverzeichnis eine Dateiliste erzeugen (Files.wxs).
         WiX 5 bringt kein heat.exe mehr mit, also macht das dieses Skript.
      4. wix build aufrufen.

    Voraussetzungen:
      dotnet tool install --global wix
      wix extension add -g WixToolset.UI.wixext
      wix extension add -g WixToolset.Util.wixext

.EXAMPLE
    .\build.ps1
#>

[CmdletBinding()]
param(
    # Fassung des Pakets. Ohne Angabe aus der package.json.
    [string] $ProductVersion = '',

    # Wohin die MSI soll.
    [string] $OutputDir = ''
)

$ErrorActionPreference = 'Stop'

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir      = Split-Path -Parent $InstallerDir
$BuildDir     = Join-Path $InstallerDir 'build'
if (-not $OutputDir) { $OutputDir = $BuildDir }

function Write-Step { param([string] $Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "  ok $Text" -ForegroundColor Green }
function Stop-Build { param([string] $Text) Write-Host "Fehler: $Text" -ForegroundColor Red; exit 1 }

if (-not $ProductVersion) {
    $pkg = Get-Content (Join-Path $RepoDir 'package.json') -Raw | ConvertFrom-Json
    # MSI kennt nur Zahlen: aus 1.2.0-alpha wird 1.2.0.
    $ProductVersion = ($pkg.version -split '-')[0]
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# ── 1. Dienst uebersetzen ──────────────────────────────────────────────────

Write-Step "Uebersetze den Windows-Dienst"
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { Stop-Build "csc.exe nicht gefunden unter $csc" }

$serviceExe = Join-Path $BuildDir 'NeoKiasService.exe'
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    "/out:$serviceExe" `
    /reference:System.dll /reference:System.ServiceProcess.dll `
    (Join-Path $InstallerDir 'service\NeoKiasService.cs')
if ($LASTEXITCODE -ne 0) { Stop-Build 'Der Dienst liess sich nicht uebersetzen.' }
Write-Ok (Split-Path $serviceExe -Leaf)

# ── 2. Lizenz nach RTF ─────────────────────────────────────────────────────

Write-Step 'Erzeuge die Lizenz als RTF'
$licenseTxt = Join-Path $InstallerDir 'License.txt'
$licenseRtf = Join-Path $BuildDir 'License.rtf'
# Ausdruecklich als UTF-8 lesen. Windows PowerShell nimmt fuer eine Datei
# ohne BOM sonst die Zeichentabelle des Systems an, und aus jedem Umlaut
# wuerden zwei Zeichen, die unten einzeln umgeschrieben werden.
$text = [System.IO.File]::ReadAllText($licenseTxt, [System.Text.Encoding]::UTF8)

# RTF ist reines ASCII, alles darueber wird als \'xx in Codepage 1252
# geschrieben. Rueckstrich und geschweifte Klammern sind Steuerzeichen.
$sb = New-Object System.Text.StringBuilder
$null = $sb.Append('{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fnil\fcharset0 Segoe UI;}}')
$null = $sb.Append("`r`n\fs18`r`n")
foreach ($ch in $text.ToCharArray()) {
    switch ($ch) {
        "`r" { }
        "`n" { $null = $sb.Append("\par`r`n") }
        '\'  { $null = $sb.Append('\\') }
        '{'  { $null = $sb.Append('\{') }
        '}'  { $null = $sb.Append('\}') }
        default {
            $code = [int] $ch
            if ($code -lt 128) {
                $null = $sb.Append($ch)
            } else {
                $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes([string] $ch)
                foreach ($b in $bytes) { $null = $sb.Append(("\'{0:x2}" -f $b)) }
            }
        }
    }
}
$null = $sb.Append('}')
[System.IO.File]::WriteAllText($licenseRtf, $sb.ToString(), [System.Text.Encoding]::ASCII)
Write-Ok 'License.rtf'

# ── 3. Verknuepfungen ──────────────────────────────────────────────────────

$urlSearch = Join-Path $BuildDir 'neo-KIAS Suche.url'
$urlAdmin  = Join-Path $BuildDir 'neo-KIAS Verwaltung.url'
"[InternetShortcut]`r`nURL=http://localhost:5175/`r`n" |
    Set-Content -LiteralPath $urlSearch -Encoding ascii
"[InternetShortcut]`r`nURL=http://localhost:5177/`r`n" |
    Set-Content -LiteralPath $urlAdmin -Encoding ascii

# ── 4. Dateiliste erzeugen ─────────────────────────────────────────────────

Write-Step 'Sammle die Projektdateien'

# Was nicht ins Paket gehoert: das Image baut seine Abhaengigkeiten selbst,
# die Buendel entstehen im Container, und eine .env wird beim Installieren
# erzeugt.
$excludeDirs  = @('.git', 'node_modules', 'dist', 'logs', 'build', '.idea', '.vscode')
$excludeFiles = @('.env')

$files = Get-ChildItem -LiteralPath $RepoDir -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($RepoDir.Length + 1)
    $parts = $relative -split '\\'
    $inExcluded = $false
    foreach ($part in $parts[0..($parts.Length - 2)]) {
        if ($excludeDirs -contains $part) { $inExcluded = $true; break }
    }
    -not $inExcluded -and ($excludeFiles -notcontains $_.Name)
}

if ($files.Count -eq 0) { Stop-Build 'Keine Dateien gefunden.' }

# Verzeichnisse und Komponenten als WiX-Fragment schreiben. Je Datei eine
# eigene Komponente: das ist die Regel von Windows Installer und macht
# spaetere Aktualisierungen berechenbar.
$dirIds = @{}
$xml = New-Object System.Text.StringBuilder
$null = $xml.AppendLine('<?xml version="1.0" encoding="utf-8"?>')
$null = $xml.AppendLine('<!-- Erzeugt von installer\build.ps1. Nicht von Hand aendern. -->')
$null = $xml.AppendLine('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
$null = $xml.AppendLine('  <Fragment>')

# Verzeichnisbaum
$dirs = $files | ForEach-Object { Split-Path $_.FullName.Substring($RepoDir.Length + 1) -Parent } |
        Where-Object { $_ } | Sort-Object -Unique
$null = $xml.AppendLine('    <DirectoryRef Id="INSTALLFOLDER">')

function Get-DirId {
    param([string] $Relative)
    $safe = 'dir_' + ($Relative -replace '[^A-Za-z0-9_]', '_')
    if ($safe.Length -gt 60) { $safe = $safe.Substring(0, 55) + ($Relative.GetHashCode() -band 0xFFFF) }
    return $safe
}

# Baum aufbauen, damit verschachtelte Verzeichnisse korrekt ineinander
# liegen. Sortiert nach Tiefe, dann alphabetisch.
$tree = @{}
foreach ($dir in $dirs) {
    $parts = $dir -split '\\'
    for ($i = 0; $i -lt $parts.Length; $i++) {
        $path = ($parts[0..$i] -join '\')
        if (-not $tree.ContainsKey($path)) { $tree[$path] = $parts[$i] }
    }
}

function Write-DirNode {
    param([string] $Path, [int] $Depth)
    $indent = ' ' * (6 + $Depth * 2)
    $id = Get-DirId $Path
    $dirIds[$Path] = $id
    $null = $xml.AppendLine("$indent<Directory Id=`"$id`" Name=`"$($tree[$Path])`">")
    $children = $tree.Keys | Where-Object {
        $_ -ne $Path -and $_.StartsWith("$Path\") -and ($_.Substring($Path.Length + 1) -notmatch '\\')
    } | Sort-Object
    foreach ($child in $children) { Write-DirNode -Path $child -Depth ($Depth + 1) }
    $null = $xml.AppendLine("$indent</Directory>")
}

$roots = $tree.Keys | Where-Object { $_ -notmatch '\\' } | Sort-Object
foreach ($root in $roots) { Write-DirNode -Path $root -Depth 1 }
$null = $xml.AppendLine('    </DirectoryRef>')

# Komponenten
$null = $xml.AppendLine('    <ComponentGroup Id="ProjectFiles">')
$index = 0
foreach ($file in $files) {
    $relative = $file.FullName.Substring($RepoDir.Length + 1)
    $parent = Split-Path $relative -Parent
    $dirId = if ($parent) { $dirIds[$parent] } else { 'INSTALLFOLDER' }
    $index++
    $fileId = 'f{0}' -f $index
    $source = $file.FullName -replace '&', '&amp;'
    $null = $xml.AppendLine("      <Component Directory=`"$dirId`" Guid=`"*`">")
    $null = $xml.AppendLine("        <File Id=`"$fileId`" Source=`"$source`" KeyPath=`"yes`" />")
    $null = $xml.AppendLine('      </Component>')
}
$null = $xml.AppendLine('    </ComponentGroup>')
$null = $xml.AppendLine('  </Fragment>')
$null = $xml.AppendLine('</Wix>')

$filesWxs = Join-Path $BuildDir 'Files.wxs'
[System.IO.File]::WriteAllText($filesWxs, $xml.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Ok ("{0} Dateien in {1} Verzeichnissen" -f $files.Count, $dirs.Count)

# ── 5. MSI bauen ───────────────────────────────────────────────────────────

Write-Step "Baue die MSI ($ProductVersion)"
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    Stop-Build 'Das WiX-Werkzeug fehlt. Installieren mit: dotnet tool install --global wix'
}

$msi = Join-Path $OutputDir 'neo-KIAS.msi'
# Die Werte vorher in Variablen: PowerShell wertet Klammern mitten in einem
# Argument nicht aus, "-d Name=(Join-Path ...)" kaeme als Text an.
$customActionsJs = Join-Path $InstallerDir 'CustomActions.js'
$mainWxs = Join-Path $InstallerDir 'neo-KIAS.wxs'
& wix build `
    $mainWxs $filesWxs `
    -arch x64 `
    -culture de-DE `
    -ext WixToolset.UI.wixext `
    -ext WixToolset.Util.wixext `
    -d ProductVersion=$ProductVersion `
    -d ServiceExe=$serviceExe `
    -d LicenseRtf=$licenseRtf `
    -d CustomActionsJs=$customActionsJs `
    -d UrlSearch=$urlSearch `
    -d UrlAdmin=$urlAdmin `
    -out $msi
if ($LASTEXITCODE -ne 0) { Stop-Build 'wix build ist fehlgeschlagen.' }

Write-Ok $msi

# ── 6. Pruefen ─────────────────────────────────────────────────────────────

Write-Step 'Pruefe das Paket (ICE)'
# ICE38 und ICE57 halten alles im Startmenue fuer benutzerbezogen und
# verlangen einen Schluesselpfad unter HKCU. Bei einer Installation fuer
# alle Benutzer ist das Startmenue aber das gemeinsame, und die Komponente
# ist damit maschinenbezogen richtig. Beide Meldungen sind hier also
# falscher Alarm und werden ausgenommen, alle anderen nicht.
& wix msi validate $msi -sice ICE38 -sice ICE57
if ($LASTEXITCODE -ne 0) { Stop-Build 'Die Pruefung hat Fehler gemeldet.' }
Write-Ok 'keine Beanstandungen'

Write-Host ''
Write-Host 'Testen:' -ForegroundColor Cyan
Write-Host "  msiexec /i `"$msi`" /l*v install.log"
Write-Host "  msiexec /i `"$msi`" /qn KIASDATADIR=C:\Kias /l*v install.log"
Write-Host "  msiexec /x `"$msi`" /qn"
