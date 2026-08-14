#!/usr/bin/env bash
#
# neo-KIAS installer for Debian and derivatives.
#
# Installs Docker with the Compose plugin if missing, copies this
# repository to /opt/neo-kias, creates the .env from .env.example, builds
# the image and registers a systemd unit that starts the stack at boot.
#
# Safe to re-run: an existing .env is never overwritten, and neither are
# the logs. Re-running updates the code and rebuilds the image.
#
#   sudo ./scripts/install-debian.sh --data-dir /srv/kias
#
set -euo pipefail

INSTALL_DIR="/opt/neo-kias"
SERVICE_NAME="neo-kias"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
# The container runs as uid 1000, so the log directory on the host must
# belong to that id, otherwise the app silently falls back to stdout only.
CONTAINER_UID=1000

DATA_DIR=""
HOST_PORT=""
SKIP_DOCKER=0
NO_START=0

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
neo-KIAS auf Debian installieren.

Aufruf:
  sudo ./scripts/install-debian.sh [Optionen]

Optionen:
  --data-dir PFAD   Verzeichnis mit Daten/, Update/ und Formulare/.
                    Ohne Angabe wird interaktiv gefragt.
  --port PORT       Port auf dem Host (Standard 5175).
  --skip-docker     Docker nicht installieren, es ist bereits vorhanden.
  --no-start        Dienst einrichten, aber nicht starten.
  -h, --help        Diese Hilfe.

Das Skript ist wiederholbar: eine vorhandene .env und vorhandene Logs
bleiben unangetastet, der Code wird aktualisiert und das Image neu gebaut.
EOF
}

# ── Argumente ──────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --data-dir=*) DATA_DIR="${1#*=}"; shift ;;
    --port) HOST_PORT="${2:-}"; shift 2 ;;
    --port=*) HOST_PORT="${1#*=}"; shift ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unbekannte Option: $1" ;;
  esac
done

# ── Vorbedingungen ─────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen."

[ -f "${REPO_DIR}/docker-compose.yml" ] && [ -f "${REPO_DIR}/Dockerfile" ] \
  || die "Das Skript muss aus dem neo-KIAS-Repository heraus laufen (${REPO_DIR} sieht nicht danach aus)."

DISTRO="unbekannt"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO="${ID:-unbekannt}"
  case "${ID:-}:${ID_LIKE:-}" in
    debian:*|ubuntu:*|raspbian:*|*:*debian*) : ;;
    *) warn "Nicht als Debian erkannt (${DISTRO}). Das Skript läuft weiter, die Paketinstallation kann aber fehlschlagen." ;;
  esac
else
  warn "/etc/os-release fehlt, Distribution unbekannt."
fi

HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  HAS_SYSTEMD=1
else
  warn "systemd ist nicht aktiv. Der Dienst wird angelegt, aber nicht aktiviert."
fi

# ── Docker ─────────────────────────────────────────────────────────────────

have_compose() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

install_docker() {
  info "Installiere Docker aus dem offiziellen Repository"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  install -m 0755 -d /etc/apt/keyrings
  local codename repo_id
  repo_id="${ID:-debian}"
  # Ubuntu und Raspbian haben eigene Repos; alles andere bekommt Debian.
  case "$repo_id" in
    ubuntu) repo_id="ubuntu" ;;
    raspbian) repo_id="raspbian" ;;
    *) repo_id="debian" ;;
  esac
  codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || die "VERSION_CODENAME fehlt in /etc/os-release, Docker-Repo lässt sich nicht bestimmen."

  curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${repo_id} ${codename} stable
EOF

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null

  systemctl enable --now docker >/dev/null 2>&1 || true
}

if have_compose; then
  ok "Docker vorhanden: $(docker --version | sed 's/,.*//'), $(docker compose version --short 2>/dev/null || echo 'Compose-Plugin')"
elif [ "$SKIP_DOCKER" -eq 1 ]; then
  die "--skip-docker gesetzt, aber 'docker compose' ist nicht verfügbar."
else
  install_docker
  have_compose || die "Docker-Installation fehlgeschlagen, 'docker compose' antwortet nicht."
  ok "Docker installiert: $(docker --version | sed 's/,.*//')"
fi

# ── Datenverzeichnis ───────────────────────────────────────────────────────

if [ -z "$DATA_DIR" ] && [ -f "${INSTALL_DIR}/.env" ]; then
  # Bei einer Aktualisierung den bestehenden Wert übernehmen.
  DATA_DIR="$(sed -n 's/^KIAS_DATA_DIR=//p' "${INSTALL_DIR}/.env" | tail -1)"
  [ -n "$DATA_DIR" ] && info "Übernehme KIAS_DATA_DIR aus der vorhandenen .env: ${DATA_DIR}"
fi

if [ -z "$DATA_DIR" ]; then
  if [ -t 0 ]; then
    printf 'Pfad zum KIAS-Datenverzeichnis (enthält Daten/, Update/, Formulare/): '
    read -r DATA_DIR
  else
    die "Kein Datenverzeichnis angegeben. --data-dir PFAD verwenden."
  fi
fi

[ -n "$DATA_DIR" ] || die "Das Datenverzeichnis darf nicht leer sein."
if [ ! -d "$DATA_DIR/Daten" ]; then
  warn "Unter ${DATA_DIR} liegt kein Verzeichnis 'Daten'. Die Anwendung startet dann mit 0 Aktionen."
fi

# ── Dateien nach /opt/neo-kias ─────────────────────────────────────────────

info "Installiere nach ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"

# node_modules, Logs, .env und die Git-Historie gehören nicht dorthin: das
# Image baut seine Abhängigkeiten selbst, und .env wird unten erzeugt.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git/' --exclude 'node_modules/' --exclude 'web/node_modules/' \
    --exclude 'logs/' --exclude '.env' \
    "${REPO_DIR}/" "${INSTALL_DIR}/"
else
  # Ohne rsync: tar-Pipe mit denselben Ausnahmen.
  ( cd "$REPO_DIR" && tar -c \
      --exclude='./.git' --exclude='./node_modules' --exclude='./web/node_modules' \
      --exclude='./logs' --exclude='./.env' . ) | ( cd "$INSTALL_DIR" && tar -x )
fi
ok "Dateien kopiert"

# ── .env ───────────────────────────────────────────────────────────────────

if [ -f "${INSTALL_DIR}/.env" ]; then
  ok ".env vorhanden, bleibt unverändert"
else
  [ -f "${INSTALL_DIR}/.env.example" ] || die ".env.example fehlt, .env kann nicht erzeugt werden."
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  # Nur die Werte setzen, die von der Vorlage abweichen müssen.
  sed -i "s|^KIAS_DATA_DIR=.*|KIAS_DATA_DIR=${DATA_DIR}|" "${INSTALL_DIR}/.env"
  [ -n "$HOST_PORT" ] && sed -i "s|^HOST_PORT=.*|HOST_PORT=${HOST_PORT}|" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env aus .env.example erzeugt (KIAS_DATA_DIR=${DATA_DIR})"
fi

# Logverzeichnis muss dem Containerbenutzer gehören.
mkdir -p "${INSTALL_DIR}/logs"
chown -R "${CONTAINER_UID}:${CONTAINER_UID}" "${INSTALL_DIR}/logs"

PORT_IN_USE="$(sed -n 's/^HOST_PORT=//p' "${INSTALL_DIR}/.env" | tail -1)"
PORT_IN_USE="${PORT_IN_USE:-5175}"

# ── Image bauen ────────────────────────────────────────────────────────────

info "Baue das Image (beim ersten Mal einige Minuten)"
( cd "$INSTALL_DIR" && docker compose build )
ok "Image gebaut"

# ── systemd ────────────────────────────────────────────────────────────────

# systemd verlangt absolute Pfade in ExecStart. Docker liegt je nach
# Installationsweg unter /usr/bin oder /usr/local/bin.
DOCKER_BIN="$(command -v docker)"
[ -n "$DOCKER_BIN" ] || die "docker nicht im PATH gefunden."

info "Schreibe ${UNIT_FILE} (docker: ${DOCKER_BIN})"
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
# Compose baut selbst, falls das Image fehlt, etwa nach einem Prune.
ExecStart=${DOCKER_BIN} compose up -d
ExecStop=${DOCKER_BIN} compose down
ExecReload=${DOCKER_BIN} compose up -d --build
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
ok "Unit geschrieben"

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service" >/dev/null
  ok "Dienst aktiviert (startet beim Booten)"
  if [ "$NO_START" -eq 0 ]; then
    systemctl restart "${SERVICE_NAME}.service"
    ok "Dienst gestartet"
  else
    info "Start übersprungen (--no-start)"
  fi
else
  warn "Ohne systemd: Unit liegt unter ${UNIT_FILE}, aktiviert wurde sie nicht."
fi

# ── Abschluss ──────────────────────────────────────────────────────────────

cat <<EOF

$(printf '%sneo-KIAS ist installiert.%s' "$C_OK" "$C_OFF")

  Verzeichnis     ${INSTALL_DIR}
  Konfiguration   ${INSTALL_DIR}/.env
  Daten           ${DATA_DIR}
  Oberfläche      http://localhost:${PORT_IN_USE}
  API-Doku        http://localhost:${PORT_IN_USE}/api/docs

Nützliche Befehle:

  systemctl status ${SERVICE_NAME}
  systemctl restart ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f
  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f

Das erste Einlesen der DBF-Dateien dauert je nach Datenträger bis zu zwei
Minuten. Solange zeigt die Oberfläche einen Ladebildschirm mit Fortschritt.
EOF
