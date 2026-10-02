#!/usr/bin/env bash
#
# neo-KIAS auf einem Debian-Server aktualisieren.
#
# Gedacht für den Sprung von einer Fassung auf die nächste, etwa von 1.2.0
# auf 1.3.0 mit der Protokollsammlung. Ein Aufruf genügt:
#
#   sudo ./scripts/update-debian.sh
#
# Was dabei passiert, der Reihe nach:
#
#   1. Die bestehende Installation sichern (Quelltext und .env)
#   2. Den Stapel anhalten
#   3. Den neuen Quelltext über die Installation legen, .env und Logs
#      bleiben unberührt
#   4. Die .env nachziehen: Schlüssel, die in der neuen .env.example
#      vorkommen und in der bestehenden fehlen, werden ergänzt. Eingestellte
#      Werte ändert das Skript nicht.
#   5. Die systemd-Unit neu schreiben, falls sie sich geändert hat
#   6. Das Image bauen und den Dienst starten
#   7. Nachsehen, ob die neue Fassung tatsächlich antwortet
#
# Geht dabei etwas schief, führt
#
#   sudo ./scripts/update-debian.sh --rollback
#
# zurück auf den Stand vor dem letzten Lauf.
#
# Das Installationsskript kann vieles davon auch. Der Unterschied: dieses
# hier setzt eine bestehende Installation voraus, fragt nichts, legt vorher
# eine Sicherung an und sagt am Ende, von welcher Fassung auf welche es
# gegangen ist.
#
set -euo pipefail

INSTALL_DIR="/opt/neo-kias"
SERVICE_NAME="neo-kias"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
# Der Container läuft als uid 1000; das Logverzeichnis auf dem Wirt muss
# ihm gehören, sonst schreibt die Anwendung still nur noch nach stdout.
CONTAINER_UID=1000
# So viele Sicherungen bleiben liegen, ältere werden aufgeräumt.
KEEP_BACKUPS=3

WITH_LOGS=0
NO_START=0
NO_BACKUP=0
DO_ROLLBACK=0
DO_PRUNE=0

ADDED_KEYS=""
GENERATED_ADMIN_PASSWORD=""

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# ── Ausgabe ────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
else
  C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_OFF=""
fi

info()  { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()    { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn()  { printf '%sWarnung:%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()   { printf '%sFehler:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
neo-KIAS auf einem Debian-Server aktualisieren.

Aufruf:
  sudo ./scripts/update-debian.sh [Optionen]

Optionen:
  --dir PFAD      Installationsverzeichnis (Standard /opt/neo-kias).
  --with-logs     Die Protokollsammlung (Loki, Alloy, Grafana) beim Update
                  gleich mit einschalten. Ohne diese Option bleibt das
                  Profil so, wie es in der .env steht.
  --no-backup     Keine Sicherung anlegen. Dann gibt es auch kein Zurück.
  --no-start      Alles vorbereiten, aber den Dienst nicht starten.
  --prune         Nach dem Bauen die verwaisten Images aufräumen.
  --rollback      Den Stand vor dem letzten Lauf wiederherstellen.
  -h, --help      Diese Hilfe.

Die .env wird nachgezogen, nicht ersetzt: fehlende Schlüssel kommen aus
der neuen .env.example dazu, eingestellte Werte bleiben, wie sie sind.
Daten, Logs und die Datenbank der Verwaltung fasst das Skript nicht an.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --with-logs) WITH_LOGS=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --prune) DO_PRUNE=1; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unbekannte Option: $1" ;;
  esac
done

ENV_FILE="${INSTALL_DIR}/.env"
BACKUP_PREFIX="${INSTALL_DIR}.backup-"

# ── .env lesen und schreiben ───────────────────────────────────────────────
#
# Dieselben Helfer wie im Installationsskript: Werte ohne Anführungszeichen,
# docker compose nähme sie sonst als Teil des Wertes mit.

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
env_has() { grep -q "^$1=" "$ENV_FILE"; }

env_set() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')"
  if env_has "$key"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

env_default() {
  local key="$1" value="$2"
  env_has "$key" && return 0
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  ADDED_KEYS="${ADDED_KEYS}${ADDED_KEYS:+, }${key}"
}

gen_secret() {
  local s=""
  if command -v openssl >/dev/null 2>&1; then
    s="$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | cut -c1-24 || true)"
  fi
  if [ -z "$s" ]; then
    s="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 24 || true)"
  fi
  [ -n "$s" ] || die "Kein Zufallsgenerator gefunden."
  printf '%s' "$s"
}

# Die Version aus einer package.json, ohne jq: das ist auf einem frisch
# aufgesetzten Server nicht selbstverständlich vorhanden.
version_of() {
  [ -f "$1" ] || { printf 'unbekannt'; return 0; }
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
}

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null
  else
    wget -q -O /dev/null --timeout=5 "$1" 2>/dev/null
  fi
}

http_body() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$1" 2>/dev/null
  else
    wget -q -O - --timeout=5 "$1" 2>/dev/null
  fi
}

# Quelltext kopieren, immer mit denselben Ausnahmen: .env, Logs und alles,
# was das Image sich beim Bauen selbst holt.
copy_tree() {
  local from="$1" to="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '.git/' --exclude 'node_modules/' \
      --exclude 'web/node_modules/' --exclude 'web/dist/' \
      --exclude 'admin/node_modules/' --exclude 'admin/dist/' \
      --exclude 'logs/' --exclude '.env' \
      "${from}/" "${to}/"
  else
    ( cd "$from" && tar -c \
        --exclude='./.git' --exclude='./node_modules' \
        --exclude='./web/node_modules' --exclude='./web/dist' \
        --exclude='./admin/node_modules' --exclude='./admin/dist' \
        --exclude='./logs' --exclude='./.env' . ) | ( cd "$to" && tar -x )
  fi
}

compose() { ( cd "$INSTALL_DIR" && docker compose "$@" ); }

stack_stop() {
  if [ "$HAS_SYSTEMD" -eq 1 ] && systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
    systemctl stop "${SERVICE_NAME}.service"
  else
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi
}

stack_start() {
  if [ "$HAS_SYSTEMD" -eq 1 ]; then
    systemctl restart "${SERVICE_NAME}.service"
  else
    compose up -d --remove-orphans
  fi
}

# ── Vorbedingungen ─────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen."

command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
  || die "'docker compose' antwortet nicht. Ist Docker installiert?"

[ -d "$INSTALL_DIR" ] \
  || die "Unter ${INSTALL_DIR} ist nichts installiert. Für die erste Einrichtung scripts/install-debian.sh verwenden."
[ -f "$ENV_FILE" ] \
  || die "${ENV_FILE} fehlt. Das sieht nicht nach einer neo-KIAS-Installation aus."

HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  HAS_SYSTEMD=1
fi

# ── Zurück auf den letzten Stand ───────────────────────────────────────────

if [ "$DO_ROLLBACK" -eq 1 ]; then
  # shellcheck disable=SC2012
  LAST_BACKUP="$(ls -1d "${BACKUP_PREFIX}"* 2>/dev/null | sort | tail -1 || true)"
  [ -n "$LAST_BACKUP" ] || die "Keine Sicherung gefunden (${BACKUP_PREFIX}*)."

  BACK_VERSION="$(version_of "${LAST_BACKUP}/package.json")"
  info "Stelle ${LAST_BACKUP} wieder her (Fassung ${BACK_VERSION})"

  stack_stop
  copy_tree "$LAST_BACKUP" "$INSTALL_DIR"
  # Die .env gehört zum Stand: eine neue Fassung kann Schlüssel ergänzt
  # haben, die die alte nicht versteht.
  if [ -f "${LAST_BACKUP}/.env" ]; then
    cp -a "${LAST_BACKUP}/.env" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok ".env des alten Standes zurückgespielt"
  fi
  ok "Dateien zurückgespielt"

  info "Baue das Image der alten Fassung"
  compose --profile admin build
  [ "$NO_START" -eq 1 ] || { stack_start; ok "Dienst gestartet"; }

  printf '\n%sZurück auf Fassung %s.%s\n\n' "$C_OK" "$BACK_VERSION" "$C_OFF"
  exit 0
fi

# ── Fassungen ──────────────────────────────────────────────────────────────

[ -f "${REPO_DIR}/docker-compose.yml" ] && [ -f "${REPO_DIR}/Dockerfile" ] \
  || die "Das Skript muss aus dem neo-KIAS-Repository heraus laufen (${REPO_DIR} sieht nicht danach aus)."

OLD_VERSION="$(version_of "${INSTALL_DIR}/package.json")"
NEW_VERSION="$(version_of "${REPO_DIR}/package.json")"

info "Installiert: ${OLD_VERSION}, neu: ${NEW_VERSION}"
if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  info "Gleiche Fassungsnummer. Der Lauf geht trotzdem durch, Quelltext und"
  info "Abbild werden erneuert; schaden kann das nicht."
fi

# ── Sichern ────────────────────────────────────────────────────────────────

BACKUP_DIR=""
if [ "$NO_BACKUP" -eq 1 ]; then
  warn "Ohne Sicherung (--no-backup). --rollback hat danach nichts, worauf es zurückgehen könnte."
else
  BACKUP_DIR="${BACKUP_PREFIX}$(date +%Y%m%d-%H%M%S)"
  info "Sichere nach ${BACKUP_DIR}"
  mkdir -p "$BACKUP_DIR"
  copy_tree "$INSTALL_DIR" "$BACKUP_DIR"
  cp -a "$ENV_FILE" "${BACKUP_DIR}/.env"
  chmod 600 "${BACKUP_DIR}/.env"
  ok "Sicherung angelegt (Fassung ${OLD_VERSION})"

  # Ältere Sicherungen aufräumen, sonst füllt jeder Lauf die Platte weiter.
  # shellcheck disable=SC2012
  ls -1d "${BACKUP_PREFIX}"* 2>/dev/null | sort | head -n "-${KEEP_BACKUPS}" | while read -r old; do
    rm -rf -- "$old"
    info "Alte Sicherung entfernt: ${old}"
  done
fi

# ── Anhalten und austauschen ───────────────────────────────────────────────

info "Halte den Stapel an"
stack_stop
ok "Angehalten"

info "Lege den neuen Quelltext nach ${INSTALL_DIR}"
copy_tree "$REPO_DIR" "$INSTALL_DIR"
ok "Dateien aktualisiert"

chmod 600 "$ENV_FILE"

# ── .env nachziehen ────────────────────────────────────────────────────────
#
# Der eigentliche Grund für dieses Skript. Eine neue Fassung bringt neue
# Schlüssel mit, und eine .env aus 1.2.0 kennt sie nicht. Statt sie hier
# einzeln aufzuzählen, was bei der nächsten Fassung wieder veraltet wäre,
# wird die mitgelieferte .env.example durchgegangen: jeder Schlüssel, der
# dort steht und in der bestehenden .env fehlt, kommt mit seinem
# Vorgabewert dazu. Eingestellte Werte bleiben unangetastet.

EXAMPLE="${INSTALL_DIR}/.env.example"
[ -f "$EXAMPLE" ] || die ".env.example fehlt im neuen Stand."

while IFS= read -r line; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    # Diese drei kommen nie aus der Vorlage: der Datenpfad ist von Hand
    # gesetzt, die beiden Passwörter werden unten erzeugt. Eine leere
    # Vorgabe bedeutete bei ihnen "admin" beziehungsweise "kias", und das
    # wäre nach einem Update ein stiller Rückschritt.
    KIAS_DATA_DIR|KIAS_ADMIN_PASSWORD|POSTGRES_PASSWORD) continue ;;
    *) env_default "$key" "$value" ;;
  esac
done < "$EXAMPLE"

[ -n "$(env_get KIAS_DATA_DIR)" ] \
  || warn "KIAS_DATA_DIR steht nicht in der .env. Ohne Datenpfad startet die Anwendung leer."

# Die Protokollsammlung nur auf Ansage einschalten, aber niemals von selbst
# wieder abschalten.
if [ "$WITH_LOGS" -eq 1 ]; then
  CURRENT_PROFILES="$(env_get COMPOSE_PROFILES)"
  case ",${CURRENT_PROFILES}," in
    *,logs,*) ok "Die Protokollsammlung war bereits eingeschaltet" ;;
    *)
      env_set COMPOSE_PROFILES "$([ -n "$CURRENT_PROFILES" ] && echo "${CURRENT_PROFILES},logs" || echo "logs")"
      ok "Protokollsammlung eingeschaltet (Profil logs)"
      ;;
  esac
  env_default GRAFANA_PORT 5178
  env_default LOKI_RETENTION 720h
  env_default ALLOY_CONFIG config.alloy
fi

PROFILES="$(env_get COMPOSE_PROFILES)"
ADMIN_ON=""
case ",${PROFILES}," in *,admin,*) ADMIN_ON=1 ;; esac
LOGS_ON=""
case ",${PROFILES}," in *,logs,*) LOGS_ON=1 ;; esac

# Passwörter: nur erzeugen, wenn keines dasteht. Ein vorhandenes anzufassen
# wäre das Letzte, was ein Update tun sollte.
if [ -n "$ADMIN_ON" ]; then
  if [ -z "$(env_get KIAS_ADMIN_PASSWORD)" ]; then
    GENERATED_ADMIN_PASSWORD="$(gen_secret)"
    env_set KIAS_ADMIN_PASSWORD "$GENERATED_ADMIN_PASSWORD"
    ok "Passwort der Verwaltung erzeugt, es stand bisher keines in der .env"
  fi
  if [ -z "$(env_get POSTGRES_PASSWORD)" ] || [ "$(env_get POSTGRES_PASSWORD)" = "kias" ]; then
    env_set POSTGRES_PASSWORD "$(gen_secret)"
    ok "Passwort der Einstellungsdatenbank erzeugt"
  fi
fi

if [ -n "$ADDED_KEYS" ]; then
  ok ".env ergänzt um: ${ADDED_KEYS}"
else
  ok ".env war bereits vollständig"
fi

# Logverzeichnis muss weiterhin dem Containerbenutzer gehören.
mkdir -p "${INSTALL_DIR}/logs"
chown -R "${CONTAINER_UID}:${CONTAINER_UID}" "${INSTALL_DIR}/logs"

# ── systemd-Unit erneuern ──────────────────────────────────────────────────
#
# Auch wenn sie sich selten ändert: nach einem Update soll die Unit zum
# Stand gehören, nicht zu dem, was vor zwei Fassungen galt.

DOCKER_BIN="$(command -v docker)"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=neo-KIAS Explorer
Documentation=https://github.com/christophmerscher/neo-kiaas
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=${DOCKER_BIN} compose up -d --remove-orphans
ExecStop=${DOCKER_BIN} compose down
ExecReload=${DOCKER_BIN} compose up -d --build
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
  ok "systemd-Unit erneuert"
else
  warn "Ohne systemd: Unit liegt unter ${UNIT_FILE}, aktiviert wurde sie nicht."
fi

# ── Bauen ──────────────────────────────────────────────────────────────────

info "Baue das Image (einige Minuten)"
compose --profile admin build
ok "Image gebaut"

if [ "$DO_PRUNE" -eq 1 ]; then
  info "Räume verwaiste Images auf"
  docker image prune -f >/dev/null 2>&1 || true
  ok "Aufgeräumt"
fi

# ── Starten ────────────────────────────────────────────────────────────────

PORT_IN_USE="$(env_get HOST_PORT)";        PORT_IN_USE="${PORT_IN_USE:-5175}"
API_PORT_IN_USE="$(env_get API_PORT)";     API_PORT_IN_USE="${API_PORT_IN_USE:-5176}"
ADMIN_PORT_IN_USE="$(env_get ADMIN_PORT)"; ADMIN_PORT_IN_USE="${ADMIN_PORT_IN_USE:-5177}"
GRAFANA_PORT_IN_USE="$(env_get GRAFANA_PORT)"; GRAFANA_PORT_IN_USE="${GRAFANA_PORT_IN_USE:-5178}"

RUNNING_VERSION=""
if [ "$NO_START" -eq 1 ]; then
  info "Start übersprungen (--no-start)"
else
  info "Starte den Stapel"
  stack_start
  ok "Gestartet"

  info "Warte auf die Schnittstelle"
  waited=0
  while [ "$waited" -lt 90 ]; do
    http_ok "http://127.0.0.1:${API_PORT_IN_USE}/api/ping" && break
    sleep 2
    waited=$((waited + 2))
  done

  if [ "$waited" -lt 90 ]; then
    # Die Fassung aus der laufenden Anwendung lesen und nicht aus der
    # Datei: nur das beweist, dass der neue Stand auch wirklich läuft.
    RUNNING_VERSION="$(http_body "http://127.0.0.1:${API_PORT_IN_USE}/api/ping" \
      | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    if [ "$RUNNING_VERSION" = "$NEW_VERSION" ]; then
      ok "Schnittstelle antwortet, Fassung ${RUNNING_VERSION}"
    else
      warn "Die Schnittstelle meldet Fassung '${RUNNING_VERSION}', erwartet war ${NEW_VERSION}."
    fi
  else
    warn "Die Schnittstelle hat in 90 Sekunden nicht geantwortet."
    warn "Zum Nachsehen: journalctl -u ${SERVICE_NAME} -n 50"
    warn "Zurück auf den alten Stand: sudo $0 --rollback"
  fi

  http_ok "http://127.0.0.1:${PORT_IN_USE}/healthz" \
    && ok "Suche antwortet" || warn "Die Suche unter Port ${PORT_IN_USE} antwortet nicht."

  if [ -n "$ADMIN_ON" ]; then
    http_ok "http://127.0.0.1:${ADMIN_PORT_IN_USE}/healthz" \
      && ok "Verwaltung antwortet" || warn "Die Verwaltung unter Port ${ADMIN_PORT_IN_USE} antwortet nicht."
  fi

  if [ -n "$LOGS_ON" ]; then
    # Grafana braucht nach dem ersten Start einen Moment, bis es die
    # mitgelieferte Übersicht eingelesen hat.
    waited=0
    while [ "$waited" -lt 40 ]; do
      http_ok "http://127.0.0.1:${GRAFANA_PORT_IN_USE}/api/health" && break
      sleep 2
      waited=$((waited + 2))
    done
    [ "$waited" -lt 40 ] \
      && ok "Grafana antwortet" \
      || warn "Grafana unter Port ${GRAFANA_PORT_IN_USE} antwortet nicht."
  fi
fi

# ── Abschluss ──────────────────────────────────────────────────────────────

HOSTADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOSTADDR="${HOSTADDR:-localhost}"

cat <<EOF

$(printf '%sneo-KIAS ist aktualisiert: %s -> %s%s' "$C_OK" "$OLD_VERSION" "$NEW_VERSION" "$C_OFF")

  Verzeichnis     ${INSTALL_DIR}
  Daten           $(env_get KIAS_DATA_DIR)
  Suche           http://${HOSTADDR}:${PORT_IN_USE}
  Schnittstelle   http://${HOSTADDR}:${API_PORT_IN_USE}
  Verwaltung      $([ -n "$ADMIN_ON" ] && echo "http://${HOSTADDR}:${ADMIN_PORT_IN_USE}" || echo 'abgeschaltet')
  Protokolle      $([ -n "$LOGS_ON" ] && echo "http://${HOSTADDR}:${GRAFANA_PORT_IN_USE}" || echo 'abgeschaltet (--with-logs schaltet sie ein)')
  Sicherung       ${BACKUP_DIR:-keine (--no-backup)}
EOF

if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
  cat <<EOF

$(printf '%sZugang zur Verwaltung%s' "$C_WARN" "$C_OFF")

  Benutzer        admin
  Passwort        ${GENERATED_ADMIN_PASSWORD}

In der .env stand bisher keines, deshalb wurde eben eines erzeugt. Es
steht nur hier und in ${ENV_FILE}. Dasselbe Passwort gilt für Grafana.
EOF
fi

cat <<EOF

Nach dem Update lohnt ein Blick auf die Daten:

  sudo ${INSTALL_DIR}/scripts/analyse-kias.sh data

Zurück auf den Stand davor:

  sudo $0 --rollback

Das Einlesen der DBF-Dateien läuft im Hintergrund und dauert je nach
Datenträger bis zu zwei Minuten. Solange zeigt die Suche ihren
Ladebildschirm.
EOF
