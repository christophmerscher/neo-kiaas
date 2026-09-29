#!/usr/bin/env bash
#
# neo-KIAS installer for Debian and derivatives.
#
# Installs Docker with the Compose plugin if missing, copies this
# repository to /opt/neo-kias, creates the .env from .env.example, builds
# the image and registers a systemd unit that starts the stack at boot.
#
# Der Stapel besteht aus vier Diensten: Suche, REST-Schnittstelle,
# Verwaltung und die kleine Postgres-Datenbank für die Einstellungen. Die
# letzten beiden lassen sich mit --no-admin weglassen.
#
# Safe to re-run: vorhandene Werte in der .env und vorhandene Logs bleiben
# unangetastet. Fehlende Schlüssel werden ergänzt, damit eine .env aus
# einer älteren Fassung nach dem Lauf vollständig ist. Re-running updates
# the code and rebuilds the image.
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
API_PORT=""
ADMIN_PORT=""
ADMIN_PASSWORD=""
NO_ADMIN=0
WITH_LOGS=0
SKIP_DOCKER=0
NO_START=0

# Wird gesetzt, wenn das Skript selbst ein Passwort erzeugt hat; nur dann
# steht es am Ende auf dem Bildschirm.
GENERATED_ADMIN_PASSWORD=""
# Schlüssel, die einer vorhandenen .env gefehlt haben.
ADDED_KEYS=""

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

# ── .env lesen und schreiben ───────────────────────────────────────────────
#
# Alle drei Helfer arbeiten auf ${INSTALL_DIR}/.env und setzen voraus, dass
# die Datei existiert. Werte werden nie in Anführungszeichen geschrieben:
# docker compose nimmt sie sonst mit.

ENV_FILE="${INSTALL_DIR}/.env"

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

env_has() { grep -q "^$1=" "$ENV_FILE"; }

# Überschreiben, oder anhängen falls der Schlüssel fehlt.
env_set() {
  local key="$1" value="$2" escaped
  # In der Ersetzung von sed sind &, | und \ Sonderzeichen. Ein per
  # --admin-password übergebenes "a&b" käme sonst verstümmelt an.
  escaped="$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')"
  if env_has "$key"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# Nur anhängen, wenn der Schlüssel noch gar nicht vorkommt. Damit wird
# eine .env aus einer älteren Fassung vollständig, ohne dass eingestellte
# Werte verlorengehen.
env_default() {
  local key="$1" value="$2"
  env_has "$key" && return 0
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  ADDED_KEYS="${ADDED_KEYS}${ADDED_KEYS:+, }${key}"
}

# Passwort ohne Sonderzeichen: es landet in einer .env, in einer
# Verbindungsadresse und in einem sed-Ausdruck, und an jeder dieser
# Stellen wären Schrägstriche oder Anführungszeichen ein eigenes Problem.
gen_secret() {
  local s=""
  if command -v openssl >/dev/null 2>&1; then
    s="$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | cut -c1-24 || true)"
  fi
  if [ -z "$s" ]; then
    s="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 24 || true)"
  fi
  [ -n "$s" ] || die "Kein Zufallsgenerator gefunden. Passwort bitte mit --admin-password setzen."
  printf '%s' "$s"
}

# Eine URL abfragen, mit dem, was auf dem Rechner da ist.
http_client_missing() {
  ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1
}

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null
  else
    wget -q -O /dev/null --timeout=5 "$1" 2>/dev/null
  fi
}

# Belegt jemand anderes den Port schon?
port_busy() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"
  else
    return 1
  fi
}

usage() {
  cat <<'EOF'
neo-KIAS auf Debian installieren.

Aufruf:
  sudo ./scripts/install-debian.sh [Optionen]

Optionen:
  --data-dir PFAD       Verzeichnis mit Daten/, Update/ und Formulare/.
                        Ohne Angabe wird interaktiv gefragt.
  --port PORT           Port der Suche (Standard 5175).
  --api-port PORT       Port der REST-Schnittstelle (Standard 5176).
  --admin-port PORT     Port der Verwaltung (Standard 5177).
  --admin-password PASS Passwort der Verwaltung. Ohne Angabe wird beim
                        ersten Lauf eines erzeugt und am Ende angezeigt.
  --no-admin            Ohne Verwaltung und ohne Datenbank installieren.
  --with-logs           Zusaetzlich Loki, Alloy und Grafana starten. Die
                        Protokolle sind dann unter Port 5178 durchsuchbar,
                        Anmeldung wie bei der Verwaltung. Kostet rund
                        300 MB Arbeitsspeicher.
                        Dann gibt es keinen Weg, die Daten neu einzulesen.
  --skip-docker         Docker nicht installieren, es ist bereits vorhanden.
  --no-start            Dienst einrichten, aber nicht starten.
  -h, --help            Diese Hilfe.

Das Skript ist wiederholbar: vorhandene Werte in der .env und vorhandene
Logs bleiben unangetastet, fehlende Schlüssel werden ergänzt, der Code
wird aktualisiert und das Image neu gebaut. Angegebene Optionen gewinnen
gegen das, was in der .env steht.
EOF
}

# ── Argumente ──────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --data-dir=*) DATA_DIR="${1#*=}"; shift ;;
    --port) HOST_PORT="${2:-}"; shift 2 ;;
    --port=*) HOST_PORT="${1#*=}"; shift ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --api-port=*) API_PORT="${1#*=}"; shift ;;
    --admin-port) ADMIN_PORT="${2:-}"; shift 2 ;;
    --admin-port=*) ADMIN_PORT="${1#*=}"; shift ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --admin-password=*) ADMIN_PASSWORD="${1#*=}"; shift ;;
    --no-admin) NO_ADMIN=1; shift ;;
    --with-logs) WITH_LOGS=1; shift ;;
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

if [ -z "$DATA_DIR" ] && [ -f "$ENV_FILE" ]; then
  # Bei einer Aktualisierung den bestehenden Wert übernehmen.
  DATA_DIR="$(env_get KIAS_DATA_DIR)"
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
    --exclude '.git/' --exclude 'node_modules/' \
    --exclude 'web/node_modules/' --exclude 'web/dist/' \
    --exclude 'admin/node_modules/' --exclude 'admin/dist/' \
    --exclude 'logs/' --exclude '.env' \
    "${REPO_DIR}/" "${INSTALL_DIR}/"
else
  # Ohne rsync: tar-Pipe mit denselben Ausnahmen.
  ( cd "$REPO_DIR" && tar -c \
      --exclude='./.git' --exclude='./node_modules' \
      --exclude='./web/node_modules' --exclude='./web/dist' \
      --exclude='./admin/node_modules' --exclude='./admin/dist' \
      --exclude='./logs' --exclude='./.env' . ) | ( cd "$INSTALL_DIR" && tar -x )
fi
ok "Dateien kopiert"

# ── .env ───────────────────────────────────────────────────────────────────

FRESH_ENV=0
if [ -f "$ENV_FILE" ]; then
  ok ".env vorhanden, eingestellte Werte bleiben"
else
  [ -f "${INSTALL_DIR}/.env.example" ] || die ".env.example fehlt, .env kann nicht erzeugt werden."
  cp "${INSTALL_DIR}/.env.example" "$ENV_FILE"
  FRESH_ENV=1
fi
chmod 600 "$ENV_FILE"

# Der Datenpfad kommt immer aus dieser Sitzung: entweder von --data-dir
# oder aus der vorhandenen .env, aus der er oben schon gelesen wurde.
env_set KIAS_DATA_DIR "$DATA_DIR"

# Angegebene Optionen gewinnen, alles andere bleibt, wie es war.
[ -n "$HOST_PORT" ]  && env_set HOST_PORT  "$HOST_PORT"
[ -n "$API_PORT" ]   && env_set API_PORT   "$API_PORT"
[ -n "$ADMIN_PORT" ] && env_set ADMIN_PORT "$ADMIN_PORT"

# Schlüssel, die es in älteren Fassungen noch nicht gab. Nur ergänzen,
# damit eine gewachsene .env nach dem Lauf vollständig ist.
env_default HOST_PORT 5175
env_default API_PORT 5176
env_default ADMIN_PORT 5177

# ── Verwaltung und ihre Datenbank ──────────────────────────────────────────
#
# Zwei Schalter, die zusammengehören: das Compose-Profil startet die
# Container admin-kias und kias-db, KIAS_ADMIN gibt /api/admin/* in
# rest-kias frei. Nur eines von beiden ergäbe entweder eine Oberfläche vor
# verschlossener Tür oder eine offene Tür ohne Oberfläche.
if [ "$NO_ADMIN" -eq 1 ]; then
  env_set COMPOSE_PROFILES ""
  env_set KIAS_ADMIN false
  info "Ohne Verwaltung (--no-admin): kein Weg, die Daten neu einzulesen."
else
  env_default COMPOSE_PROFILES admin
  env_default KIAS_ADMIN true
  # Ein bestehendes, absichtlich abgeschaltetes Setup nicht ungefragt
  # wieder einschalten: dafür gibt es keinen Auftrag.
fi

# Die Protokollsammlung ist ein eigenes Profil und kommt nur auf Ansage
# dazu. Umgekehrt wird sie nicht von selbst wieder entfernt: wer sie
# einmal eingeschaltet hat, soll sie nach einem Update noch haben.
if [ "$WITH_LOGS" -eq 1 ]; then
  CURRENT_PROFILES="$(env_get COMPOSE_PROFILES)"
  case ",${CURRENT_PROFILES}," in
    *,logs,*) : ;;
    *) env_set COMPOSE_PROFILES "$([ -n "$CURRENT_PROFILES" ] && echo "${CURRENT_PROFILES},logs" || echo "logs")" ;;
  esac
  env_default GRAFANA_PORT 5178
  env_default LOKI_RETENTION 720h
  env_default ALLOY_CONFIG config.alloy
  info "Mit Protokollsammlung (--with-logs): Grafana auf Port $(env_get GRAFANA_PORT)."
fi

ADMIN_ON="$(env_get COMPOSE_PROFILES)"

if [ -n "$ADMIN_ON" ]; then
  # Passwort der Verwaltung. Die Vorlage lässt es leer, was in der
  # Anwendung "admin" bedeutet. Auf einem Server, den jemand erreichen
  # kann, ist das kein Zustand, deshalb wird beim ersten Mal eines
  # erzeugt und am Ende genau einmal angezeigt.
  if [ -n "$ADMIN_PASSWORD" ]; then
    env_set KIAS_ADMIN_PASSWORD "$ADMIN_PASSWORD"
    ok "Passwort der Verwaltung aus --admin-password übernommen"
  elif [ -z "$(env_get KIAS_ADMIN_PASSWORD)" ]; then
    GENERATED_ADMIN_PASSWORD="$(gen_secret)"
    env_set KIAS_ADMIN_PASSWORD "$GENERATED_ADMIN_PASSWORD"
    ok "Passwort der Verwaltung erzeugt"
  else
    ok "Passwort der Verwaltung bleibt, wie es in der .env steht"
  fi

  # Dasselbe für die Datenbank. Sie ist nach außen nicht geöffnet, ein
  # geratenes Passwort wäre trotzdem eine unnötige Einladung.
  if [ -z "$(env_get POSTGRES_PASSWORD)" ] || [ "$(env_get POSTGRES_PASSWORD)" = "kias" ]; then
    env_set POSTGRES_PASSWORD "$(gen_secret)"
  fi
fi

env_default KIAS_ADMIN_SESSION_HOURS 8

if [ "$FRESH_ENV" -eq 1 ]; then
  ok ".env aus .env.example erzeugt (KIAS_DATA_DIR=${DATA_DIR})"
elif [ -n "$ADDED_KEYS" ]; then
  ok ".env ergänzt um: ${ADDED_KEYS}"
fi

# Logverzeichnis muss dem Containerbenutzer gehören.
mkdir -p "${INSTALL_DIR}/logs"
chown -R "${CONTAINER_UID}:${CONTAINER_UID}" "${INSTALL_DIR}/logs"

PORT_IN_USE="$(env_get HOST_PORT)";        PORT_IN_USE="${PORT_IN_USE:-5175}"
API_PORT_IN_USE="$(env_get API_PORT)";     API_PORT_IN_USE="${API_PORT_IN_USE:-5176}"
ADMIN_PORT_IN_USE="$(env_get ADMIN_PORT)"; ADMIN_PORT_IN_USE="${ADMIN_PORT_IN_USE:-5177}"

# Belegte Ports melden, aber nur solange der Dienst noch nicht läuft:
# sonst warnt das Skript bei jedem zweiten Lauf über die eigenen Container.
if ! systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
  for entry in "Suche:${PORT_IN_USE}" "Schnittstelle:${API_PORT_IN_USE}"; do
    port_busy "${entry#*:}" && warn "Port ${entry#*:} (${entry%%:*}) ist bereits belegt. In der .env einen anderen setzen."
  done
  if [ -n "$ADMIN_ON" ]; then
    port_busy "$ADMIN_PORT_IN_USE" \
      && warn "Port ${ADMIN_PORT_IN_USE} (Verwaltung) ist bereits belegt. In der .env einen anderen setzen."
  fi
fi

# ── Image bauen ────────────────────────────────────────────────────────────

info "Baue das Image (beim ersten Mal einige Minuten)"
# Alle drei Dienste teilen sich ein Image; das Profil sorgt dafür, dass
# auch bei abgeschalteter Verwaltung dasselbe Abbild entsteht.
( cd "$INSTALL_DIR" && docker compose --profile admin build )
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

    # Kurz abwarten, ob die Dienste tatsächlich antworten. Nicht auf die
    # Daten warten: deren Einlesen dauert Minuten, und /api/ping antwortet
    # ausdrücklich schon vorher.
    if http_client_missing; then
      info "Weder curl noch wget vorhanden, überspringe die Erreichbarkeitsprüfung."
    else
      info "Warte auf die Dienste"
      waited=0
      while [ "$waited" -lt 60 ]; do
        http_ok "http://127.0.0.1:${API_PORT_IN_USE}/api/ping" && break
        sleep 2
        waited=$((waited + 2))
      done
      if [ "$waited" -lt 60 ]; then
        ok "Schnittstelle antwortet"
      else
        warn "Die Schnittstelle hat in 60 Sekunden nicht geantwortet. 'journalctl -u ${SERVICE_NAME} -f' zeigt, woran es liegt."
      fi

      if http_ok "http://127.0.0.1:${PORT_IN_USE}/healthz"; then
        ok "Suche antwortet"
      else
        warn "Die Suche unter Port ${PORT_IN_USE} antwortet nicht."
      fi

      if [ -n "$ADMIN_ON" ]; then
        if http_ok "http://127.0.0.1:${ADMIN_PORT_IN_USE}/healthz"; then
          ok "Verwaltung antwortet"
        else
          warn "Die Verwaltung unter Port ${ADMIN_PORT_IN_USE} antwortet nicht."
        fi
      fi
    fi
  else
    info "Start übersprungen (--no-start)"
  fi
else
  warn "Ohne systemd: Unit liegt unter ${UNIT_FILE}, aktiviert wurde sie nicht."
fi

# ── Abschluss ──────────────────────────────────────────────────────────────

# Für die Adressen die erste eigene IP nehmen: auf einem Server sitzt der
# Browser fast nie auf demselben Rechner, und "localhost" hilft dort nicht.
HOSTADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOSTADDR="${HOSTADDR:-localhost}"

cat <<EOF

$(printf '%sneo-KIAS ist installiert.%s' "$C_OK" "$C_OFF")

  Verzeichnis     ${INSTALL_DIR}
  Konfiguration   ${INSTALL_DIR}/.env
  Daten           ${DATA_DIR}
  Suche           http://${HOSTADDR}:${PORT_IN_USE}
  Schnittstelle   http://${HOSTADDR}:${API_PORT_IN_USE}
  API-Doku        http://${HOSTADDR}:${PORT_IN_USE}/api/docs
  Verwaltung      $([ -n "$ADMIN_ON" ] && echo "http://${HOSTADDR}:${ADMIN_PORT_IN_USE}" || echo 'abgeschaltet (--no-admin)')
  Protokolle      $(case ",$(env_get COMPOSE_PROFILES)," in *,logs,*) echo "http://${HOSTADDR}:$(env_get GRAFANA_PORT)" ;; *) echo 'abgeschaltet (--with-logs schaltet sie ein)' ;; esac)
EOF

if [ -n "$ADMIN_ON" ]; then
  if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
    cat <<EOF

$(printf '%sZugang zur Verwaltung%s' "$C_WARN" "$C_OFF")

  Benutzer        admin
  Passwort        ${GENERATED_ADMIN_PASSWORD}

Dieses Passwort wurde eben erzeugt und steht nur hier und in der .env.
Jetzt notieren. Ändern geht in ${INSTALL_DIR}/.env unter
KIAS_ADMIN_PASSWORD, danach 'systemctl restart ${SERVICE_NAME}'.
EOF
  else
    cat <<EOF

  Verwaltung: Benutzer admin, Passwort aus KIAS_ADMIN_PASSWORD in der .env.
EOF
  fi
fi

cat <<EOF

Nützliche Befehle:

  systemctl status ${SERVICE_NAME}
  systemctl restart ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f
  docker compose -f ${INSTALL_DIR}/docker-compose.yml ps
  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f rest-kias

Das erste Einlesen der DBF-Dateien dauert je nach Datenträger bis zu zwei
Minuten. Solange zeigt die Oberfläche einen Ladebildschirm mit Fortschritt.
Neu einlesen geht danach in der Verwaltung, in der Suche gibt es den Knopf
bewusst nicht mehr.
EOF
