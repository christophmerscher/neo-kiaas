#!/usr/bin/env bash
#
# neo-KIAS nachsehen, wenn etwas nicht stimmt.
#
# Das Skript stellt die Fragen, die bei einem leeren Bestand immer zuerst
# gestellt werden, und es stellt sie an beiden Enden: auf dem Wirt und im
# Container. Genau dazwischen sitzt der häufigste Fehler. Ein Bind-Mount,
# dessen Quelle auf dem Wirt verschwunden ist, legt im Container ein
# leeres Verzeichnis an. Von innen sieht alles gesund aus, nur ist nichts
# da; von außen liegen die Daten scheinbar an Ort und Stelle.
#
#   sudo ./scripts/analyse-kias.sh data       Datenpfad und Mount
#   sudo ./scripts/analyse-kias.sh env        Welche Einstellungen gelten
#   sudo ./scripts/analyse-kias.sh services   Container und ihr Zustand
#   sudo ./scripts/analyse-kias.sh logs       Die Zeilen der Lesevorgänge
#   sudo ./scripts/analyse-kias.sh mount      Einhängungen von Wirt und Container
#   sudo ./scripts/analyse-kias.sh all        Alles nacheinander
#
# Der Rückgabewert ist 0, wenn nichts zu beanstanden war, sonst 1. Damit
# lässt sich das Skript auch in eine Überwachung hängen.
#
set -uo pipefail

INSTALL_DIR=""
PROBLEMS=0

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Wartezeit für Zugriffe auf eine Freigabe. Eine tote NFS-Freigabe
# antwortet nicht und blockiert sonst bis zum Sankt-Nimmerleins-Tag.
readonly PROBE_TIMEOUT=8

# ── Ausgabe ────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_OFF=""
fi

head1()  { printf '\n%s== %s ==%s\n' "$C_INFO" "$*" "$C_OFF"; }
good()   { printf '  %s✓%s %s\n' "$C_OK" "$C_OFF" "$*"; }
hint()   { printf '  %s·%s %s\n' "$C_DIM" "$C_OFF" "$*"; }
bad()    { printf '  %s✗%s %s\n' "$C_ERR" "$C_OFF" "$*"; PROBLEMS=$((PROBLEMS + 1)); }
soft()   { printf '  %s!%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()    { printf '%sFehler:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 2; }

usage() {
  cat <<'EOF'
neo-KIAS untersuchen.

Aufruf:
  sudo ./scripts/analyse-kias.sh [Befehl] [Optionen]

Befehle:
  data        Datenpfad aus der .env lesen, den Mount prüfen und für jedes
              der Verzeichnisse Daten/, Update/ und Formulare/ nachsehen,
              ob es da und lesbar ist. Zusätzlich dieselbe Frage im
              Container gestellt, denn dort muss es ankommen. (Voreinstellung)
  env         Welche Einstellungen gerade gelten. Passwörter werden nicht
              ausgegeben.
  services    Container, Zustand, Neustarts, Ports.
  logs [N]    Die letzten N Zeilen zu Lesevorgängen und Fehlern (Standard 40).
  mount       Die Einhängungen beider Seiten vergleichen. Beantwortet die
              Frage, ob die Daten wirklich weg sind oder ob nur der
              Container eine andere Sicht hat als der Wirt.
  all         Alles nacheinander.

Optionen:
  --dir PFAD  Installationsverzeichnis. Ohne Angabe wird erst im Repository
              nachgesehen, aus dem das Skript läuft, dann unter
              /opt/neo-kias.
  -h, --help  Diese Hilfe.

Rückgabewert: 0 wenn alles in Ordnung ist, 1 wenn etwas zu beanstanden war.
EOF
}

# ── Argumente ──────────────────────────────────────────────────────────────

COMMAND=""
LOG_LINES=40

while [ $# -gt 0 ]; do
  case "$1" in
    data|env|services|logs|mount|all) COMMAND="$1"; shift
      if [ "$COMMAND" = "logs" ] && [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
        LOG_LINES="$1"; shift
      fi
      ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unbekannter Befehl oder Option: $1" ;;
  esac
done
COMMAND="${COMMAND:-data}"

# ── Installation finden ────────────────────────────────────────────────────

if [ -z "$INSTALL_DIR" ]; then
  if [ -f "${REPO_DIR}/.env" ]; then
    INSTALL_DIR="$REPO_DIR"
  elif [ -f "/opt/neo-kias/.env" ]; then
    INSTALL_DIR="/opt/neo-kias"
  else
    die "Keine Installation gefunden. Mit --dir PFAD angeben."
  fi
fi

ENV_FILE="${INSTALL_DIR}/.env"
[ -f "$ENV_FILE" ] || die "${ENV_FILE} gibt es nicht."
[ -r "$ENV_FILE" ] || die "${ENV_FILE} ist nicht lesbar. Mit sudo aufrufen."

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

compose() { ( cd "$INSTALL_DIR" && docker compose "$@" ) 2>/dev/null; }

have_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

container_running() {
  [ -n "$(compose ps -q "$1" 2>/dev/null)" ]
}

# Einen Befehl im REST-Container ausführen. Dort sind die Daten gemountet,
# und nur dort zählt, ob sie ankommen.
in_container() {
  compose exec -T rest-kias sh -c "$1" 2>/dev/null
}

# Mit Zeitlimit, damit eine hängende Freigabe das Skript nicht mitnimmt.
probe() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$PROBE_TIMEOUT" "$@"
  else
    "$@"
  fi
}

# Einzahl oder Mehrzahl. "1 DBF-Dateien" liest sich wie ein Fehler im
# Programm, und genau danach sucht gerade jemand.
plural() {
  [ "$1" -eq 1 ] && printf '%s' "$2" || printf '%s' "$3"
}

count_files() {
  # $1 Verzeichnis, $2 Muster (case-insensitive)
  probe find "$1" -maxdepth 1 -type f -iname "$2" 2>/dev/null | wc -l | tr -d ' '
}

newest_file() {
  probe find "$1" -maxdepth 1 -type f -printf '%T@ %TY-%Tm-%Td %TH:%TM %f\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-
}

# ── data ───────────────────────────────────────────────────────────────────

cmd_data() {
  head1 "Datenpfad laut .env"

  local data_dir
  data_dir="$(env_get KIAS_DATA_DIR)"
  if [ -z "$data_dir" ]; then
    bad "KIAS_DATA_DIR steht nicht in ${ENV_FILE}. Ohne Datenpfad startet die Anwendung leer."
    return
  fi
  hint "${ENV_FILE}"
  good "KIAS_DATA_DIR=${data_dir}"
  hint "Im Container liegt derselbe Ort unter /data (siehe docker-compose.yml)."

  # ── Der Mount selbst ────────────────────────────────────────────────────
  head1 "Erreichbarkeit auf dem Wirt"

  # Erst mit Zeitlimit anklopfen, und zwar mit einem eigenen Programm und
  # nicht mit dem eingebauten test: eine hängende Freigabe nimmt sonst die
  # Shell mit, und timeout kann einen Builtin nicht abbrechen.
  local rc
  probe ls -d "$data_dir" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 124 ]; then
    bad "Der Pfad antwortet nicht innerhalb von ${PROBE_TIMEOUT} Sekunden. Das ist das Bild einer hängenden Netzfreigabe."
    hint "Nachsehen mit: mount | grep -i '$(basename "$data_dir")'"
    return
  fi
  if [ "$rc" -ne 0 ]; then
    bad "Es gibt nichts unter ${data_dir}."
    hint "Entweder wurde das Verzeichnis verschoben, oder eine Freigabe ist nicht eingehängt."
    return
  fi

  if [ ! -d "$data_dir" ]; then
    bad "${data_dir} ist kein Verzeichnis."
    return
  fi
  good "Verzeichnis ist da"

  if probe ls -1 "$data_dir" >/dev/null 2>&1; then
    good "Verzeichnis ist lesbar"
  else
    bad "Verzeichnis ist nicht lesbar. Rechte prüfen: ls -ld ${data_dir}"
  fi

  # Woher der Platz kommt. Bei einer Freigabe, die nicht eingehängt ist,
  # steht hier die lokale Platte, und das ist der eigentliche Befund.
  if command -v findmnt >/dev/null 2>&1; then
    local src fstype opts
    src="$(probe findmnt -n -o SOURCE --target "$data_dir" 2>/dev/null)"
    fstype="$(probe findmnt -n -o FSTYPE --target "$data_dir" 2>/dev/null)"
    opts="$(probe findmnt -n -o OPTIONS --target "$data_dir" 2>/dev/null)"
    if [ -n "$fstype" ]; then
      hint "Dateisystem: ${fstype}, Quelle: ${src}"
      case "$fstype" in
        cifs|nfs|nfs4|smb3)
          good "Liegt auf einer Netzfreigabe (${fstype})"
          case "$opts" in
            *ro,*|*,ro|ro) hint "Eingehängt nur zum Lesen, für neo-KIAS reicht das." ;;
          esac
          ;;
        *)
          if command -v mountpoint >/dev/null 2>&1 && ! mountpoint -q "$data_dir"; then
            hint "Kein eigener Einhängepunkt, der Pfad liegt auf ${fstype}."
            hint "Sollte hier eine Freigabe liegen, ist sie gerade nicht eingehängt."
          fi
          ;;
      esac
    fi
  fi

  if command -v df >/dev/null 2>&1; then
    local free
    free="$(probe df -h "$data_dir" 2>/dev/null | awk 'NR==2 {print $4" frei von "$2}')"
    [ -n "$free" ] && hint "Platz: ${free}"
  fi

  # ── Die drei Verzeichnisse ──────────────────────────────────────────────
  head1 "Die Verzeichnisse unter dem Datenpfad"

  local host_dbf=0
  local dir_name dir_path count newest

  for dir_name in Daten Update Formulare; do
    dir_path="${data_dir}/${dir_name}"
    probe ls -d "$dir_path" >/dev/null 2>&1
    if [ $? -ne 0 ] || [ ! -d "$dir_path" ]; then
      case "$dir_name" in
        Daten) bad "Daten/ fehlt. Ohne dieses Verzeichnis bleibt der Bestand leer." ;;
        Update) soft "Update/ fehlt. Zulässig, dann gilt allein der Basisstand." ;;
        Formulare) soft "Formulare/ fehlt. Zulässig, dann bleiben Anhänge unerreichbar." ;;
      esac
      continue
    fi
    if ! probe ls -1 "$dir_path" >/dev/null 2>&1; then
      bad "${dir_name}/ ist nicht lesbar. Rechte prüfen: ls -ld ${dir_path}"
      continue
    fi

    if [ "$dir_name" = "Formulare" ]; then
      count="$(count_files "$dir_path" '*')"
      good "Formulare/ ist lesbar, ${count} $(plural "$count" Datei Dateien)"
    else
      count="$(count_files "$dir_path" '*.dbf')"
      [ "$dir_name" = "Daten" ] && host_dbf="$count"
      if [ "$count" -eq 0 ]; then
        bad "${dir_name}/ ist lesbar, enthält aber keine einzige DBF-Datei."
      else
        good "${dir_name}/ ist lesbar, ${count} $(plural "$count" DBF-Datei DBF-Dateien)"
      fi
    fi

    newest="$(newest_file "$dir_path")"
    [ -n "$newest" ] && hint "zuletzt geändert: ${newest}"
  done

  # ── Wirklich hineinlesen ────────────────────────────────────────────────
  if [ "$host_dbf" -gt 0 ]; then
    local probe_file
    probe_file="$(probe find "${data_dir}/Daten" -maxdepth 1 -type f -iname '*.dbf' 2>/dev/null | head -1)"
    if [ -n "$probe_file" ]; then
      if probe head -c 32 "$probe_file" >/dev/null 2>&1; then
        good "Leseprobe bestanden: $(basename "$probe_file")"
      else
        bad "$(basename "$probe_file") lässt sich nicht lesen, obwohl die Datei im Verzeichnis steht."
        hint "Das ist typisch für eine Freigabe, deren Zugangsdaten abgelaufen sind."
      fi
    fi
  fi

  # ── Und jetzt im Container ──────────────────────────────────────────────
  head1 "Dasselbe aus Sicht des Containers"

  if ! have_docker; then
    soft "Docker antwortet nicht, die Prüfung im Container entfällt."
    return
  fi
  if ! container_running rest-kias; then
    soft "Der Container rest-kias läuft nicht, die Prüfung im Container entfällt."
    hint "Starten mit: cd ${INSTALL_DIR} && docker compose up -d"
    return
  fi

  local inner_dbf
  if ! in_container 'test -d /data' >/dev/null 2>&1; then
    bad "Im Container gibt es /data nicht. Das Volume aus der docker-compose.yml kommt nicht an."
    return
  fi

  if ! in_container 'test -d /data/Daten' >/dev/null 2>&1; then
    bad "Im Container fehlt /data/Daten, obwohl es auf dem Wirt vorhanden sein mag."
    hint "Genau so sieht ein Bind-Mount aus, dessen Quelle verschwunden ist: Docker"
    hint "legt dann ein leeres Verzeichnis an, und von innen wirkt alles heil."
    hint "Hilft: Freigabe wieder einhängen, danach 'docker compose up -d --force-recreate rest-kias'."
    return
  fi

  inner_dbf="$(in_container 'ls -1 /data/Daten 2>/dev/null | grep -ic "\.dbf$"' | tr -d ' \r')"
  inner_dbf="${inner_dbf:-0}"

  if [ "$inner_dbf" -eq 0 ]; then
    bad "Im Container liegt unter /data/Daten keine DBF-Datei."
  else
    good "Im Container sichtbar: ${inner_dbf} $(plural "$inner_dbf" DBF-Datei DBF-Dateien) unter /data/Daten"
  fi

  if [ "$host_dbf" -gt 0 ] && [ "$inner_dbf" -ne "$host_dbf" ]; then
    bad "Wirt und Container sind sich nicht einig: ${host_dbf} gegen ${inner_dbf} DBF-Dateien."
    hint "Der Container hält noch den alten Mount. Hilft:"
    hint "  cd ${INSTALL_DIR} && docker compose up -d --force-recreate rest-kias"
  elif [ "$inner_dbf" -gt 0 ]; then
    good "Wirt und Container zeigen denselben Bestand"
  fi

  # ── Was die Anwendung daraus gemacht hat ────────────────────────────────
  head1 "Was die Anwendung geladen hat"

  local api_port status bulletins
  api_port="$(env_get API_PORT)"; api_port="${api_port:-5176}"
  status="$(probe curl -fsS --max-time 5 "http://127.0.0.1:${api_port}/api/status" 2>/dev/null)"
  if [ -z "$status" ]; then
    soft "Die Schnittstelle unter Port ${api_port} antwortet nicht. Liest sie gerade ein?"
    return
  fi

  # Ein Lauf, der gerade liest, hält naturgemäß noch nichts. Das als Fehler
  # zu melden, wäre ein Fehlalarm nach jedem Neustart.
  if printf '%s' "$status" | grep -q '"loading"[[:space:]]*:[[:space:]]*true'; then
    soft "Die Anwendung liest gerade ein. Das dauert je nach Datenträger bis zu zwei Minuten."
    hint "Danach noch einmal nachsehen."
    return
  fi

  bulletins="$(printf '%s' "$status" | sed -n 's/.*"aktion"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
  if [ -z "$bulletins" ] || [ "$bulletins" -eq 0 ] 2>/dev/null; then
    bad "Die Anwendung hält 0 Aktionen. Gelesen wurde also nichts Brauchbares."
    hint "Den Grund nennt: $0 logs"
  else
    good "Die Anwendung hält ${bulletins} Aktionen"
  fi
}

# ── env ────────────────────────────────────────────────────────────────────

cmd_env() {
  head1 "Einstellungen"

  hint "${ENV_FILE}"

  local profiles admin_on logs_on
  profiles="$(env_get COMPOSE_PROFILES)"
  admin_on=""; case ",${profiles}," in *,admin,*) admin_on=1 ;; esac
  logs_on="";  case ",${profiles}," in *,logs,*)  logs_on=1 ;; esac

  printf '  %-22s %s\n' "Fassung" "$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${INSTALL_DIR}/package.json" 2>/dev/null | head -1)"
  printf '  %-22s %s\n' "Datenpfad" "$(env_get KIAS_DATA_DIR)"
  printf '  %-22s %s\n' "Profile" "${profiles:-keine}"
  printf '  %-22s %s\n' "Suche" "Port $(env_get HOST_PORT || true)"
  printf '  %-22s %s\n' "Schnittstelle" "Port $(env_get API_PORT || true)"
  printf '  %-22s %s\n' "Verwaltung" "$([ -n "$admin_on" ] && echo "Port $(env_get ADMIN_PORT)" || echo 'abgeschaltet')"
  printf '  %-22s %s\n' "Protokolle" "$([ -n "$logs_on" ] && echo "Port $(env_get GRAFANA_PORT), Aufbewahrung $(env_get LOKI_RETENTION)" || echo 'abgeschaltet')"
  printf '  %-22s %s\n' "Zeitzone" "$(env_get TZ)"
  printf '  %-22s %s\n' "Protokollstufe" "$(env_get LOG_LEVEL)"

  # Passwörter kommen hier nicht hin, auch nicht gekürzt. Es steht nur da,
  # ob eines gesetzt ist.
  if [ -n "$admin_on" ]; then
    if [ -n "$(env_get KIAS_ADMIN_PASSWORD)" ]; then
      good "Ein Passwort für die Verwaltung ist gesetzt"
    else
      bad "Kein Passwort für die Verwaltung gesetzt, es gilt 'admin'."
    fi
  fi
}

# ── services ───────────────────────────────────────────────────────────────

cmd_services() {
  head1 "Container"

  if ! have_docker; then
    bad "Docker antwortet nicht."
    return
  fi

  local ps_out
  ps_out="$(compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}')"
  if [ -z "$ps_out" ] || [ "$(printf '%s' "$ps_out" | wc -l)" -lt 1 ]; then
    bad "Es läuft kein Container dieser Installation."
    hint "Starten mit: cd ${INSTALL_DIR} && docker compose up -d"
    return
  fi
  printf '%s\n' "$ps_out" | sed 's/^/  /'

  # Ein Container, der immer wieder neu startet, meldet sich sonst nirgends.
  local name restarts
  for name in rest-kias neo-kias admin-kias kias-db kias-loki kias-alloy kias-grafana; do
    container_running "$name" || continue
    restarts="$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo 0)"
    if [ "${restarts:-0}" -gt 3 ]; then
      bad "${name} wurde ${restarts} Mal neu gestartet. Da stimmt etwas nicht."
      hint "docker compose -f ${INSTALL_DIR}/docker-compose.yml logs --tail 50 ${name}"
    fi
  done

  local unhealthy
  unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null)"
  if [ -n "$unhealthy" ]; then
    bad "Nicht gesund: ${unhealthy}"
  else
    good "Kein Container meldet sich als ungesund"
  fi
}

# Protokollzeilen lesbar machen.
#
# Die Zeilen sind JSON und damit für Grafana gedacht, nicht für ein
# Terminal. Liegt jq oder python3 bereit, wird daraus Uhrzeit, Stufe und
# Satz; sonst bleibt die Zeile stehen, gekürzt auf eine Breite, die sich
# noch lesen lässt.
format_lines() {
  if command -v jq >/dev/null 2>&1; then
    sed 's/^[^{]*//' | jq -r 'try ((.time/1000 | strftime("%H:%M:%S")) + "  "
      + (if .level >= 50 then "FEHLER " elif .level >= 40 then "WARNUNG" else "       " end)
      + "  " + .msg
      + (if .summary then "  (" + .summary + ")" else "" end))
      catch .' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys, time
stufe = {40: "WARNUNG", 50: "FEHLER ", 60: "FEHLER "}
for zeile in sys.stdin:
    zeile = zeile.rstrip()
    start = zeile.find("{")
    if start < 0:
        print(zeile[:200])
        continue
    try:
        d = json.loads(zeile[start:])
    except ValueError:
        print(zeile[:200])
        continue
    uhr = time.strftime("%H:%M:%S", time.localtime(d.get("time", 0) / 1000))
    rest = "  (" + d["summary"] + ")" if d.get("summary") else ""
    print("%s  %s  %s%s" % (uhr, stufe.get(d.get("level"), "       "), d.get("msg", ""), rest))
' 2>/dev/null
  else
    cut -c1-200
  fi
}

# ── logs ───────────────────────────────────────────────────────────────────

cmd_logs() {
  head1 "Lesevorgänge und Fehler (letzte ${LOG_LINES} Zeilen)"

  if ! have_docker; then
    bad "Docker antwortet nicht."
    return
  fi

  # Die Zeilen, die beim Suchen nach einem leeren Bestand zählen. Alles
  # andere ist für diese Frage Rauschen.
  local out
  out="$(compose logs --tail 4000 rest-kias 2>/dev/null \
    | grep -E 'reading the data|data read|data root|data files|not readable|base table|lookup table|unchanged since|produced nothing' \
    | tail -n "$LOG_LINES")"

  if [ -z "$out" ]; then
    soft "Keine passenden Zeilen gefunden. Entweder ist alles in Ordnung, oder"
    soft "die Protokolle sind kürzer als der Zeitraum, der gesucht wird."
    return
  fi

  printf '%s\n' "$out" | format_lines | sed 's/^/  /'

  if printf '%s' "$out" | grep -q 'produced nothing'; then
    bad "Mindestens ein Lesevorgang hat nichts geliefert."
  fi
}

# ── mount ──────────────────────────────────────────────────────────────────
#
# Die Frage, die `data` offen lässt: wenn im Container nichts ankommt, liegt
# das daran, dass die Daten auf dem Wirt weg sind, oder daran, dass der
# Container eine andere Sicht hat als der Wirt?
#
# Ein Bind-Mount wird beim Start des Containers einmal aufgelöst und landet
# als Kopie in dessen Namensraum. Was danach auf dem Wirt ein- oder
# ausgehängt wird, erreicht ihn nicht mehr (Propagation steht auf
# rprivate). Deshalb vergleicht dieser Befehl die Einhängetabellen beider
# Seiten: steht beim Container kein cifs oder nfs, sondern das Dateisystem
# der lokalen Platte, dann zeigt /data auf das leere Verzeichnis unter der
# Freigabe und nicht auf die Freigabe selbst.

cmd_mount() {
  local data_dir
  data_dir="$(env_get KIAS_DATA_DIR)"
  [ -n "$data_dir" ] || { bad "KIAS_DATA_DIR steht nicht in ${ENV_FILE}."; return; }

  head1 "Einhängetabelle auf dem Wirt"
  if command -v findmnt >/dev/null 2>&1; then
    probe findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS --target "$data_dir" 2>/dev/null \
      | sed 's/^/  /' || soft "findmnt hat nicht geantwortet."
  else
    probe mount 2>/dev/null | grep -F "$data_dir" | sed 's/^/  /' \
      || hint "Kein eigener Mount auf ${data_dir}, es liegt auf der lokalen Platte."
  fi

  local host_fs host_src
  host_fs="$(probe findmnt -n -o FSTYPE --target "$data_dir" 2>/dev/null)"
  host_src="$(probe findmnt -n -o SOURCE --target "$data_dir" 2>/dev/null)"

  head1 "Netzfreigaben insgesamt"
  local shares
  shares="$(probe mount 2>/dev/null | grep -Ei 'type (cifs|nfs|nfs4|smb3)')"
  if [ -n "$shares" ]; then
    printf '%s\n' "$shares" | sed 's/^/  /'
  else
    soft "Es ist gar keine Netzfreigabe eingehängt."
    hint "Wenn die Daten von einem anderen Rechner kommen, fehlt hier der Mount."
  fi

  head1 "Automatisches Aus- und Einhängen"
  # Ein Automount hängt nach einer Leerlaufzeit wieder aus. Auf dem Wirt
  # fällt das niemandem auf, der Container bekommt das neue Einhängen aber
  # nie zu sehen. Das ist der Ablauf, der zu "die Daten waren einfach weg"
  # passt, ohne dass jemand etwas neu gestartet hat.
  local fstab_lines
  fstab_lines="$(grep -v '^[[:space:]]*#' /etc/fstab 2>/dev/null | grep -F "$data_dir")"
  if [ -n "$fstab_lines" ]; then
    printf '%s\n' "$fstab_lines" | sed 's/^/  /'
    # Eine fstab-Zeile hat sechs Felder: Gerät, Ort, Typ, Optionen, Dump, Pass.
    # Ein hineinkopierter mount-Befehl sieht richtig aus, hängt beim Start aber
    # nichts ein, und dann steht die Freigabe nur so lange, wie jemand sie von
    # Hand gesetzt hat.
    if ! printf '%s\n' "$fstab_lines" \
      | awk -v d="$data_dir" 'NF >= 3 && ($2 == d || $2 == d "/") { ok = 1 } END { exit ok ? 0 : 1 }'; then
      bad "Keine dieser Zeilen ist ein gültiger fstab-Eintrag für ${data_dir}."
      hint "Erwartet wird: Gerät Ort Typ Optionen Dump Pass, also etwa"
      hint "//rechner/freigabe ${data_dir} cifs credentials=/etc/kias-smb.cred,ro,uid=1000,gid=1000,_netdev,nofail 0 0"
      hint "Nachprüfen mit: findmnt --verify, danach muss mount -a stumm durchlaufen."
    elif printf '%s\n' "$fstab_lines" | grep -q 'x-systemd.automount'; then
      soft "x-systemd.automount ist gesetzt. Hängt der Mount im Leerlauf aus, sieht der Container danach ein leeres Verzeichnis."
      hint "Gegenmittel: x-systemd.idle-timeout=0, oder die Freigabe als Docker-Volume einhängen."
    fi
    if printf '%s\n' "$fstab_lines" | grep -q 'password='; then
      soft "In der fstab steht ein Passwort im Klartext, die Datei ist für alle lesbar."
      hint "Besser: credentials=/etc/kias-smb.cred mit chmod 600."
    fi
  else
    hint "Kein Eintrag für ${data_dir} in /etc/fstab."
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --type=automount --no-legend 2>/dev/null | sed 's/^/  /' | head -5
  fi

  head1 "Sicht des Containers"
  if ! have_docker || ! container_running rest-kias; then
    soft "rest-kias läuft nicht, die Container-Sicht lässt sich nicht prüfen."
    return
  fi

  # Den Typ aus der Einhängetabelle lesen, nicht aus stat: im Container steckt
  # nur die BusyBox-Fassung von stat, und die kennt cifs nicht. Sie meldet dann
  # UNKNOWN, obwohl die Freigabe sauber eingehängt ist.
  local cmi cfs
  cmi="$(in_container "grep ' /data ' /proc/1/mountinfo 2>/dev/null | head -1")"
  cfs="$(printf '%s\n' "$cmi" | awk '{ for (i = 1; i <= NF; i++) if ($i == "-") { print $(i + 1); exit } }')"
  if [ -z "$cfs" ]; then
    cfs="$(in_container "stat -f -c %T /data 2>/dev/null")"
    case "$cfs" in UNKNOWN|unknown) cfs="" ;; esac
  fi
  hint "Dateisystem unter /data im Container: ${cfs:-unbekannt}"
  [ -n "$cmi" ] && printf '%s\n' "$cmi" | sed 's/^/  /'

  local host_count cont_count
  host_count="$(probe find "${data_dir}/Daten" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
  cont_count="$(in_container "find /data/Daten -maxdepth 1 -type f 2>/dev/null | wc -l" | tr -d ' ')"
  hint "Dateien in Daten/: Wirt ${host_count:-0}, Container ${cont_count:-0}"

  if [ "${host_count:-0}" -gt 0 ] && [ "${cont_count:-0}" -eq 0 ]; then
    bad "Auf dem Wirt liegen Daten, im Container kommt nichts an."
    hint "Das ist kein Rechteproblem, sondern zwei verschiedene Einhängungen."
    hint "Sofort hilft: docker compose up -d --force-recreate rest-kias"
    hint "Dauerhaft: die Freigabe als Docker-Volume (type: cifs) einhängen."
  elif [ "${host_count:-0}" -eq 0 ] && [ "${cont_count:-0}" -eq 0 ]; then
    bad "Auf beiden Seiten ist Daten/ leer. Dann fehlt die Quelle, nicht der Mount."
    hint "Auf dem Wirt nachsehen: ls -la ${data_dir} und mount | grep -i cifs"
  elif [ "${cont_count:-0}" -gt 0 ]; then
    good "Der Container sieht ${cont_count} Dateien in Daten/."
  fi

  case "$host_fs" in
    cifs|nfs|nfs4|smb3)
      hint "Wirt hängt ${host_fs} von ${host_src}."
      case "$cfs" in
        "")
          hint "Der Typ im Container ließ sich nicht bestimmen, der Vergleich entfällt."
          ;;
        cifs|smb2|smb3|nfs|nfs4)
          good "Der Container hängt ebenfalls auf einer Netzfreigabe (${cfs})."
          ;;
        *)
          bad "Der Container hängt dagegen auf ${cfs}. Die beiden sehen nicht dieselbe Einhängung."
          hint "Sofort hilft: docker compose up -d --force-recreate rest-kias"
          ;;
      esac
      ;;
    "") hint "Für ${data_dir} gibt es keinen eigenen Mount, es liegt auf der lokalen Platte." ;;
    *)  hint "Wirt: ${host_fs} (${host_src})." ;;
  esac

  head1 "Meldungen des Kerns zu Freigaben"
  local kern
  kern="$(dmesg 2>/dev/null | grep -iE 'cifs|smb|nfs' | tail -12)"
  if [ -n "$kern" ]; then
    printf '%s\n' "$kern" | sed 's/^/  /'
    if printf '%s' "$kern" | grep -qiE 'reconnect|session|timed out|not responding'; then
      soft "Der Kern meldet Abrisse an der Freigabe. Zeitpunkt mit dem Ausfall vergleichen."
    fi
  else
    hint "Keine Meldungen zu cifs, smb oder nfs im Puffer (dmesg braucht meist sudo)."
  fi
}

# ── Ablauf ─────────────────────────────────────────────────────────────────

printf '%sneo-KIAS, Untersuchung%s  (%s)\n' "$C_INFO" "$C_OFF" "$INSTALL_DIR"

case "$COMMAND" in
  data) cmd_data ;;
  env) cmd_env ;;
  services) cmd_services ;;
  logs) cmd_logs ;;
  mount) cmd_mount ;;
  all) cmd_env; cmd_services; cmd_data; cmd_mount; cmd_logs ;;
esac

printf '\n'
if [ "$PROBLEMS" -eq 0 ]; then
  printf '%sNichts zu beanstanden.%s\n' "$C_OK" "$C_OFF"
  exit 0
fi
printf '%s%d Punkt(e) zu beanstanden, siehe oben.%s\n' "$C_ERR" "$PROBLEMS" "$C_OFF"
exit 1
