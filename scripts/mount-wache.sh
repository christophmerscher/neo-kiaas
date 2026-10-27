#!/usr/bin/env bash
#
# Den Moment festhalten, in dem die Daten verschwinden.
#
# Der gemeldete Fehler tritt im laufenden Betrieb auf, ohne dass jemand
# etwas neu startet: irgendwann steht die Suche auf 0 Aktionen. Wer davor
# sitzt und wartet, verpasst ihn; wer ihn hinterher untersucht, findet nur
# noch das Ergebnis. Diese Wache fragt im Takt drei Stellen ab und schreibt
# je eine Zeile mit:
#
#   1. Wie viele DBF-Dateien der Wirt unter Daten/ sieht
#   2. Wie viele der Container unter /data/Daten sieht
#   3. Was der Dienst meldet: Aktionen im Bestand, Stand, Lesefehler
#
# Genau dazwischen liegt die Antwort. Gehen die Zahlen auf dem Wirt und im
# Container auseinander, ist es die Einhängung; gehen beide gleichzeitig auf
# null, ist die Quelle weg; bleibt beides stehen und nur der Dienst zeigt
# nichts, liegt es am Programm.
#
# Beim ersten Auseinanderlaufen schreibt die Wache zusätzlich einen
# vollständigen Befund in eine eigene Datei, und zwar sofort, solange der
# Zustand noch da ist.
#
#   sudo ./scripts/mount-wache.sh                 alle 60 Sekunden, Ausgabe im Terminal
#   sudo ./scripts/mount-wache.sh --interval 30   schnellerer Takt
#   sudo ./scripts/mount-wache.sh --once          nur einmal messen
#
# Dauerhaft im Hintergrund, auch nach dem Abmelden:
#   sudo nohup ./scripts/mount-wache.sh > /dev/null 2>&1 &
#
set -uo pipefail

INSTALL_DIR=""
INTERVAL=60
ONCE=0
LOG_FILE=""

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly PROBE_TIMEOUT=8

usage() {
  cat <<'EOF'
Beobachtet Datenverzeichnis, Container und Dienst im Takt.

Aufruf:
  sudo ./scripts/mount-wache.sh [Optionen]

Optionen:
  --interval N   Sekunden zwischen zwei Messungen (Standard 60).
  --once         Nur einmal messen und beenden.
  --log DATEI    Wohin die Zeilen geschrieben werden
                 (Standard <Installation>/logs/mount-wache.log).
  --dir PFAD     Installationsverzeichnis.
  -h, --help     Diese Hilfe.

Jede Zeile hat die Form:
  ZEIT  wirt=N  container=N  dienst=N  stand=...  lesefehler=ja|nein  hinweis

Beim ersten Mal, dass Wirt und Container auseinanderlaufen oder der
Bestand auf null geht, entsteht zusätzlich ein vollständiger Befund unter
<Installation>/logs/mount-befund-<Zeitstempel>.txt.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="${2:-60}"; shift 2 ;;
    --interval=*) INTERVAL="${1#*=}"; shift ;;
    --once) ONCE=1; shift ;;
    --log) LOG_FILE="${2:-}"; shift 2 ;;
    --log=*) LOG_FILE="${1#*=}"; shift ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; printf 'Unbekannte Option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ -z "$INSTALL_DIR" ]; then
  if [ -f "${REPO_DIR}/.env" ]; then INSTALL_DIR="$REPO_DIR"
  elif [ -f "/opt/neo-kias/.env" ]; then INSTALL_DIR="/opt/neo-kias"
  else printf 'Keine Installation gefunden, mit --dir angeben.\n' >&2; exit 2; fi
fi

ENV_FILE="${INSTALL_DIR}/.env"
[ -r "$ENV_FILE" ] || { printf '%s ist nicht lesbar, bitte mit sudo starten.\n' "$ENV_FILE" >&2; exit 2; }

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

DATA_DIR="$(env_get KIAS_DATA_DIR)"
API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-5176}"
LOG_DIR="${INSTALL_DIR}/logs"
mkdir -p "$LOG_DIR" 2>/dev/null
LOG_FILE="${LOG_FILE:-${LOG_DIR}/mount-wache.log}"

compose() { ( cd "$INSTALL_DIR" && docker compose "$@" ) 2>/dev/null; }

probe() {
  if command -v timeout >/dev/null 2>&1; then timeout "$PROBE_TIMEOUT" "$@"; else "$@"; fi
}

# Zahl der DBF-Dateien auf dem Wirt. Bei einer hängenden Freigabe liefert
# timeout 124, und das ist etwas anderes als "null Dateien": einmal hängt
# es, einmal ist es leer. Deshalb der eigene Wert -1.
wirt_dateien() {
  local out
  out="$(probe find "${DATA_DIR}/Daten" -maxdepth 1 -type f -iname '*.dbf' 2>/dev/null | wc -l)"
  case $? in
    0) printf '%s' "$(printf '%s' "$out" | tr -d ' ')" ;;
    124) printf '%s' '-1' ;;
    *) printf '%s' '0' ;;
  esac
}

container_dateien() {
  local out
  out="$(compose exec -T rest-kias sh -c "find /data/Daten -maxdepth 1 -type f -iname '*.dbf' 2>/dev/null | wc -l")"
  [ -n "$out" ] || { printf '%s' '-1'; return; }
  printf '%s' "$(printf '%s' "$out" | tr -d '[:space:]')"
}

# Der Dienst wird von außen gefragt, nicht im Container: so misst die Wache
# dasselbe, was die Werkstatt sieht.
status_json() {
  if command -v curl >/dev/null 2>&1; then
    probe curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/api/status" 2>/dev/null
  else
    probe wget -q -O - --timeout=5 "http://127.0.0.1:${API_PORT}/api/status" 2>/dev/null
  fi
}

json_wert() {
  # $1 JSON, $2 Schlüssel. Ohne jq, das ist auf einem frischen Server nicht
  # selbstverständlich da.
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -1
}

befund_schreiben() {
  local grund="$1"
  local ziel="${LOG_DIR}/mount-befund-$(date +%Y%m%d-%H%M%S).txt"
  {
    printf '# Befund %s\n# Grund: %s\n\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$grund"
    printf '## Wirt\n'
    probe ls -la "$DATA_DIR" 2>&1 | head -20
    printf '\n## findmnt\n'
    probe findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS --target "$DATA_DIR" 2>&1
    printf '\n## Netzfreigaben\n'
    probe mount 2>/dev/null | grep -Ei 'type (cifs|nfs|nfs4|smb3)'
    printf '\n## Container\n'
    compose exec -T rest-kias sh -c 'ls -la /data; echo; grep " /data " /proc/1/mountinfo' 2>&1 | head -30
    printf '\n## Zustand der Container\n'
    compose ps 2>&1
    printf '\n## /api/status\n'
    status_json
    printf '\n\n## Kern\n'
    dmesg 2>/dev/null | grep -iE 'cifs|smb|nfs' | tail -20
    printf '\n## Protokoll des Dienstes\n'
    compose logs --tail 60 rest-kias 2>&1 | grep -E 'read|load|data root|mount' | tail -30
  } > "$ziel" 2>&1
  printf '%s' "$ziel"
}

messen() {
  local zeit wirt cont js aktionen stand lesefehler hinweis
  zeit="$(date '+%Y-%m-%d %H:%M:%S')"
  wirt="$(wirt_dateien)"
  cont="$(container_dateien)"
  js="$(status_json)"
  if [ -z "$js" ]; then
    aktionen="?"; stand="-"; lesefehler="?"
  else
    aktionen="$(json_wert "$js" 'aktion')"
    stand="$(json_wert "$js" 'loadedAt')"
    if printf '%s' "$js" | grep -q '"readError":{'; then lesefehler="ja"; else lesefehler="nein"; fi
  fi
  aktionen="${aktionen:-?}"

  hinweis=""
  if [ "$wirt" = "-1" ]; then
    hinweis="Wirt antwortet nicht, Freigabe hängt"
  elif [ "$cont" = "-1" ]; then
    hinweis="Container nicht erreichbar"
  elif [ "${wirt:-0}" -gt 0 ] && [ "${cont:-0}" -eq 0 ]; then
    hinweis="AUSEINANDER: Wirt hat Daten, Container nicht"
  elif [ "${wirt:-0}" -eq 0 ] && [ "${cont:-0}" -eq 0 ]; then
    hinweis="BEIDE LEER: die Quelle ist weg"
  elif [ "$lesefehler" = "ja" ]; then
    hinweis="Dienst hält einen eingefrorenen Stand"
  fi

  printf '%s  wirt=%s  container=%s  dienst=%s  stand=%s  lesefehler=%s  %s\n' \
    "$zeit" "$wirt" "$cont" "$aktionen" "${stand:--}" "$lesefehler" "$hinweis" \
    | tee -a "$LOG_FILE"

  # Nur beim ersten Mal einen vollständigen Befund schreiben: danach ist
  # der Zustand derselbe, und zwanzig gleiche Dateien helfen niemandem.
  if [ -n "$hinweis" ] && [ "$ALARM" -eq 0 ]; then
    case "$hinweis" in
      AUSEINANDER*|BEIDE*|Wirt*)
        ALARM=1
        local datei
        datei="$(befund_schreiben "$hinweis")"
        printf '  >> Befund geschrieben: %s\n' "$datei" | tee -a "$LOG_FILE"
        ;;
    esac
  fi
}

ALARM=0
printf 'Wache läuft. Datenpfad %s, Takt %ss, Protokoll %s\n' "$DATA_DIR" "$INTERVAL" "$LOG_FILE"
printf 'Beenden mit Strg+C.\n\n'

messen
[ "$ONCE" -eq 1 ] && exit 0

while true; do
  sleep "$INTERVAL"
  messen
done
