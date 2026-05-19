# neo-KIAS Explorer

**Inoffizielle Erweiterung, nicht von Ford.**
> neo-KIAS ist eine unabhängige Drittanbieter-Anwendung und steht in keiner Verbindung
> zu Ford, der Ford-Werke GmbH oder einem ihrer Tochterunternehmen, Partner oder
> Lieferanten. Markennamen sind Eigentum der jeweiligen Rechteinhaber.

Moderne Weboberfläche zum Durchsuchen einer lokal vorliegenden KIAS-Datenbank
(Ford Service-Informationen).

## Schnellstart (Docker, vorgefertigtes Image)

```bash
# 1) Wenige Dateien herunterladen
curl -O https://raw.githubusercontent.com/christophmerscher/neo-kias/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/christophmerscher/neo-kias/main/.env.example

# 2) .env anlegen und KIAS_DATA_DIR anpassen
cp .env.example .env
# in .env:
#   NEO_KIAS_IMAGE=ghcr.io/christophmerscher/neo-kias
#   IMAGE_TAG=latest         # oder z. B. 1.0.0-alpha für Pinning
#   KIAS_DATA_DIR=/pfad/zum/Kias

# 3) Image holen und starten
docker compose pull
docker compose up -d

# 4) UI öffnen → http://localhost:5175
```

## Image-Tags

Veröffentlicht auf [GitHub Container Registry](https://github.com/christophmerscher/neo-kias/pkgs/container/neo-kias):

| Tag        | Bedeutung                                                                      |
|------------|--------------------------------------------------------------------------------|
| `latest`   | Aktueller Stand des `main`-Branch (rolling). Ideal zum Mitschwimmen.           |
| `1.0.0`    | Konkrete Release-Version (semver). Pinning für reproduzierbare Deployments.    |
| `1.0`      | Letzte Minor-Version (z. B. `1.0.0`, `1.0.1`, ...).                              |
| `1`        | Letzte Major-Version.                                                          |
| `main`     | Identisch mit `latest`.                                                        |

Multi-Architektur: jedes Image enthält `linux/amd64` und `linux/arm64` Layer
(Apple Silicon, Raspberry Pi 4/5, etc.). Docker zieht automatisch die passende
Variante.

## Architektur

TBD

## Setup

```bash
cd kias-web
npm install
npm run install:web
npm run build:web
```

## Starten

```bash
npm start
# öffnet http://localhost:5175
```

Die Anwendung lädt beim Start alle Dateien aus `../Daten` und wendet danach alle
Update-Dateien aus `../Update` der Reihe nach an (Insert/Update/Delete nach `UPAKTION`).

## Updates einspielen

Wenn neue Updatedaateien im `Update/`-Ordner landen:

- Entweder den Button **„Neu laden"** oben rechts klicken
- Oder `curl -X POST http://localhost:5175/api/reload`
- Oder den Server neu starten

## Deployment mit Docker

Die Anwendung kann komplett in einem Docker Container betrieben werden. Das Datenbank Verzeichnis wird per Volume gemountet, die Anwendung selbst weiß nicht, ob die Daten lokal, auf einem NAS oder auf einer Netzwerkfreigabe liegen.

### Setup

```bash
# 1) .env anlegen und KIAS_DATA_DIR anpassen
cp .env.example .env
# bearbeite .env: KIAS_DATA_DIR=<absoluter Pfad zu deinem Kias-Ordner>

# 2) Image bauen und starten
docker compose up -d --build

# 3) UI öffnen
#    → http://localhost:5175
```

### Konfiguration (`.env`)

| Variable        | Pflicht | Beschreibung                                                                 |
|-----------------|:-------:|------------------------------------------------------------------------------|
| `KIAS_DATA_DIR` | ✅      | Absoluter Pfad zum Verzeichnis, das `Daten/`, `Update/` und `Formulare/` enthält. Kann ein lokaler Pfad oder ein bereits gemounteter Netzwerkpfad sein. |
| `HOST_PORT`     | –       | Port auf dem Host (Default `5175`).                                          |
| `TZ`            | –       | Zeitzone im Container (Default `Europe/Berlin`).                             |

Innerhalb des Containers wird das Datenverzeichnis readonly nach `/data`
gemountet; die Variable `KIAS_ROOT=/data` weist die Anwendung dort hinein.

### Netzwerkfreigaben (SMB / NFS)

Mount auf dem Host vornehmen, anschließend in `.env` den Mountpoint angeben:

```bash
# Beispiel Linux/SMB
sudo mount -t cifs //fileserver/kias-share /mnt/kias \
  -o username=USER,password=PASS,uid=1000,gid=1000

# In .env:
KIAS_DATA_DIR=/mnt/kias
```

Alternativ kann Compose das Volume selbst mounten, dafür `volumes:` im
`docker-compose.yml` um eine Definition mit `driver_opts` erweitern. Für die
meisten Setups ist „auf dem Host mounten" aber der robustere Weg.

### Updates einspielen (Docker-Variante)

Neue Update-Dateien einfach in den `Update/`-Ordner auf dem Host kopieren dank Volume sind sie sofort im Container sichtbar. Daten neu einlesen:

```bash
curl -X POST http://localhost:5175/api/reload
```

oder den Button **„neu einlesen"** in der UI klicken.

### Logs und Healthcheck

Die Anwendung schreibt strukturierte JSON Logs sowohl auf `stdout` (sichtbar
in `docker compose logs`) als auch in rotierte Dateien im Volume `/logs`,
das auf das Host-Verzeichnis `${KIAS_LOG_DIR}` (Default `./logs`) gemountet
wird.

```bash
docker compose logs -f neo-kias       # Live-Logs (Stdout)
ls -lh ./logs                         # Rotierte Dateien auf dem Host
tail -f ./logs/neo-kias.log           # aktive Logdatei
docker compose ps                     # Healthcheck-Status
```

#### Konfigurierbare Log-Variablen in `.env`

| Variable          | Default       | Beschreibung |
|-------------------|---------------|--------------|
| `KIAS_LOG_DIR`    | `./logs`      | Host-Pfad für Logdateien. Schreibrechte für uid 1000 nötig. |
| `LOG_LEVEL`       | `info`        | `fatal` / `error` / `warn` / `info` / `debug` / `trace`. |
| `LOG_MAX_SIZE`    | `10m`         | Rotation bei dieser Dateigröße (z. B. `5m`, `100m`, `1k`). |
| `LOG_FREQUENCY`   | `daily`       | `daily`, `hourly` oder Millisekunden. |
| `LOG_MAX_FILES`   | `14`          | Anzahl historischer Dateien, die behalten werden. Ältere werden gelöscht. |
| `LOG_STDOUT`      | `true`        | `false` schaltet `docker logs` ab, wenn nur Dateien gewünscht sind. |

Rotation erfolgt **nach erster zutreffender Regel**, d. h. eine neue Datei
wird sowohl bei Tageswechsel als auch bei Erreichen der Maximalgröße begonnen.

#### Inhalt der Logs

Jeder HTTP-Request wird als eigene Zeile mit folgenden Feldern erfasst:

```json
{
  "level": "info",
  "time": "2026-05-12T14:23:01.847Z",
  "app": "neo-kias",
  "req": {
    "method": "GET",
    "url": "/api/bulletin/2436%2F10",
    "remoteIp": "192.168.1.42",
    "forwardedFor": "203.0.113.7",
    "userAgent": "Mozilla/5.0 ...",
    "referer": "http://localhost:5175/"
  },
  "res": { "statusCode": 200 },
  "responseTime": 4,
  "msg": "192.168.1.42 GET /api/bulletin/2436%2F10 -> 200"
}
```

Auf Level `debug` werden zusätzlich die Suchfilter und aufgelösten
Bulletin-Codes geloggt, sodass nachvollziehbar ist, wer wonach gesucht hat.
`forwardedFor` füllt sich nur, wenn neo-KIAS hinter einem Reverse Proxy
läuft (Header `X-Forwarded-For`).

#### Volumes-Berechtigungen

Der Container läuft als unprivilegierter User `node` (uid 1000). Wenn das
Hostverzeichnis nicht beschreibbar ist, startet die Anwendung trotzdem,
fällt aber stillschweigend auf Stdout-Logging zurück (siehe `docker logs`).
Korrekte Berechtigungen einrichten:

```bash
# Linux / macOS
mkdir -p ./logs && sudo chown 1000:1000 ./logs

# Windows (Docker Desktop): Logs liegen unter %USERPROFILE%, das normalerweise
# uneingeschränkt schreibbar ist — kein chown nötig.
```

Healthcheck: wartet bis zu 2 Minuten auf das Laden der Daten und gilt
anschließend als healthy, sobald `/api/status` `"loaded":true` meldet.

## Entwicklung (Hot-Reload)

Zwei Terminals:

```bash
# Terminal 1 – API-Server
npm run dev:server

# Terminal 2 – Vite (http://localhost:5173, /api wird zu 5175 geproxyt)
npm run dev:web
```

## API-Endpoints

- `GET  /api/status` – Ladewtatus & Zähler
- `POST /api/reload` – Daten neu einlesen
- `GET  /api/bulletins?q=&fz=&scode=&keyword=&yearFrom=&yearTo=&limit=&offset=`
- `GET  /api/bulletin/:code` – Volltext inkl. verknüpfter Daten
- `GET  /api/vehicles`, `GET /api/scodes`, `GET /api/updates`
- `GET  /api/forms/:file` – Formular PDF ausliefern

## Release-Prozess (für Maintainer)

Neue Versionen werden über Git-Tags veröffentlicht. Der CI-Workflow (siehe
`.github/workflows/docker.yml`) baut das Image automatisch und publiziert
es nach GHCR mit semantischer Tag-Logik.

```bash
# 1) Versionsnummer in package.json hochziehen
#    (z. B. 1.0.0-alpha → 1.0.0-beta)

# 2) Commit + Push auf main
git add package.json web/src/App.jsx
git commit -m "release: bump to 1.0.0-beta"
git push origin main

# 3) Tag setzen und pushen
git tag v1.0.0-beta
git push origin v1.0.0-beta
```

Was dann automatisch passiert:

- GHA-Workflow startet beim Tag-Push (`v*.*.*`).
- Image wird für `linux/amd64` und `linux/arm64` gebaut.
- Tags werden gesetzt: `1.0.0-beta`, `1.0`, `1`, plus `latest` (nur für
  stabile Releases; Pre-Releases wie `-alpha`/`-beta`/`-rc` aktualisieren
  `latest` **nicht**).
- Provenance-Attestation wird mit veröffentlicht.

## Build aus Quellcode

Falls man das Image lokal bauen (statt aus GHCR ziehen) möchte:

```bash
# Auschecken
git clone https://github.com/YOUR_GITHUB_USERNAME/neo-kias.git
cd neo-kias

# Image lokal bauen
docker compose build

# Mit gleicher .env starten
docker compose up -d
```

## Fork

Bei einem Fork:

1. Repo forken auf GitHub.
2. In `.env`:  `NEO_KIAS_IMAGE=ghcr.io/<dein-fork>/neo-kias`
3. Push nach `main` -> der eigene CI-Workflow baut und published nach dem
   eigenen GHCR-Namespace.
4. Package-Visibility ggf. auf "Public" stellen (siehe oben).

## Lizenz & Haftungsausschluss

Veröffentlicht unter der [MIT-Lizenz](./LICENSE).

**Diese Software wird ohne jegliche Gewährleistung bereitgestellt.** Die Nutzung
erfolgt vollständig auf eigene Gefahr. In keinem Fall haften die Autoren für
direkte, indirekte, zufällige, besondere oder Folgeschäden, die aus der Nutzung
oder Unmöglichkeit der Nutzung dieser Software entstehen – einschließlich, aber
nicht beschränkt auf:

- Fehlinterpretation von Daten
- Fehlerhafte Reparaturen oder Diagnosen
- Schäden an Fahrzeugen oder Personen
- Finanzielle Verluste
- Rechtliche Konsequenzen

Maßgeblich sind stets die offiziellen Hersteller­unterlagen. Vollständiger
Lizenztext siehe [`LICENSE`](./LICENSE).
