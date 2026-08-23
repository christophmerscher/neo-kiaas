# neo-KIAS Explorer

Moderne Weboberfläche zum Durchsuchen einer lokal vorliegenden KIAS Datenbank
(Ford Service Informationen). Die Anwendung liest die DBF Dateien direkt,
verändert sie nicht und braucht keinen Datenbankserver.

**Inoffizielle Erweiterung, nicht von Ford.** neo-KIAS ist eine unabhängige
Drittanbieteranwendung und steht in keiner Verbindung zu Ford, der Ford Werke
GmbH oder einem ihrer Tochterunternehmen, Partner oder Lieferanten.
Markennamen sind Eigentum der jeweiligen Rechteinhaber.

## Lizenz und Haftungsausschluss

Veröffentlicht unter der [MIT-Lizenz](./LICENSE).

**Diese Software wird ohne jegliche Gewährleistung bereitgestellt.** Die
Nutzung erfolgt vollständig auf eigene Gefahr. In keinem Fall haften die
Autoren für direkte, indirekte, zufällige, besondere oder Folgeschäden, die aus
der Nutzung oder der Unmöglichkeit der Nutzung dieser Software entstehen,
einschließlich, aber nicht beschränkt auf:

- Fehlinterpretation von Daten
- Fehlerhafte Reparaturen oder Diagnosen
- Schäden an Fahrzeugen oder Personen
- Finanzielle Verluste
- Rechtliche Konsequenzen

Maßgeblich sind stets die offiziellen Herstellerunterlagen. Vollständiger
Lizenztext siehe [`LICENSE`](./LICENSE).

## Voraussetzung: das Datenverzeichnis

Beide Startvarianten brauchen ein Verzeichnis, das die KIAS Daten enthält:

```
Kias/
├── Daten/       Basisdatenbank (FO_AKTION.DBF etc.)
├── Update/      Update-Dateien (FO_UA*.dbf, FO_UAF*.dbf, …)
└── Formulare/   PDF und Office Anhänge
```

Beim Start werden die Basisdateien gelesen und anschließend alle update Dateien
der Reihe nach angewendet. Das dauert je nach Datenträger einige Sekunden bis
gut eine Minute; solange zeigt die Oberfläche einen Ladebildschirm.

## Installation auf Debian

Für einen Server, auf dem neo-KIAS dauerhaft laufen soll, gibt es ein
Installationsskript. Es installiert Docker samt Compose-Plugin, falls nicht
vorhanden, kopiert das Repository nach `/opt/neo-kias`, legt die `.env` aus
`.env.example` an, würfelt die Passwörter für Verwaltung und Datenbank aus,
baut das Image und richtet einen systemd-Dienst ein, der beim Booten startet.
Zum Schluss wartet es, bis die Dienste antworten, und zeigt das erzeugte
Passwort genau einmal an.

Repository holen und in das Verzeichnis wechseln:

```bash
git clone https://github.com/christophmerscher/neo-kiaas.git
```

```bash
cd neo-kiaas
```

Skript ausführen, mit dem Pfad zum Datenverzeichnis:

```bash
sudo ./scripts/install-debian.sh --data-dir /srv/kias
```

Sollte das Skript nicht ausführbar sein, etwa weil das Repository als ZIP
heruntergeladen wurde, hilft eines von beiden:

```bash
sudo bash scripts/install-debian.sh --data-dir /srv/kias
```

```bash
chmod +x scripts/install-debian.sh
```

Danach läuft die Suche auf **http://SERVER:5175**, die Verwaltung auf
**http://SERVER:5177** und die Schnittstelle auf **http://SERVER:5176**.

Das Passwort der Verwaltung steht am Ende des Laufs auf dem Bildschirm.
Es wird zufällig erzeugt, damit auf einem erreichbaren Server nicht die
Voreinstellung „admin" gilt, und liegt danach nur noch in der `.env`. Wer
lieber ein eigenes vergibt, nimmt `--admin-password`.

### Optionen

| Option | Bedeutung |
|---|---|
| `--data-dir PFAD` | Verzeichnis mit `Daten/`, `Update/` und `Formulare/`. Ohne Angabe fragt das Skript danach. |
| `--port PORT` | Port der Suche, Standard `5175`. |
| `--api-port PORT` | Port der Schnittstelle, Standard `5176`. |
| `--admin-port PORT` | Port der Verwaltung, Standard `5177`. |
| `--admin-password PASS` | Passwort der Verwaltung. Ohne Angabe wird beim ersten Lauf eines erzeugt. |
| `--no-admin` | Ohne Verwaltung und ohne Datenbank installieren. Dann gibt es keinen Weg, die Daten neu einzulesen. |
| `--skip-docker` | Docker nicht anfassen, es ist bereits vorhanden. |
| `--no-start` | Dienst einrichten und aktivieren, aber nicht starten. |
| `-h`, `--help` | Hilfe anzeigen. |

### Danach

```bash
systemctl status neo-kias
```

```bash
journalctl -u neo-kias -f
```

Das Skript kanmn erneut ausgeführt werden. Ein zweiter Lauf aktualisiert den Code und baut
das Image neu, eingestellte Werte in der `.env` und die Logs bleiben
unangetastet, Passwörter werden nicht neu eerstellt. Das Datenverzeichnis wird
aus der bestehenden `.env` übernommen, `--data-dir` ist also nur beim ersten
Mal nötig.

Kommt in einer neuen Fassung ein Schlüssel dazu, ergänzt ihn der nächste Lauf
in der vorhandenen `.env` und sagt, welche es waren.

Wurde nur die Konfiguration geändert, genügt ein Neustart des Dienstes. Nach
einer Änderung am Code baut `reload` das Image neu:

```bash
systemctl reload neo-kias
```

## Starten mit Docker

Es gibt kein vorgefertigtes Image, gebaut wird immer aus diesem Repository.
Voraussetzung ist Docker mit Compose.

```bash
git clone https://github.com/christophmerscher/neo-kiaas.git
```

Danach im Projektverzeichnis die Konfiguration anlegen und `KIAS_DATA_DIR` auf
den Ordner von oben zeigen lassen:

```bash
cp .env.example .env
```

Bauen und starten:

```bash
docker compose up -d --build
```

Die neo-kias Webapp läuft dann auf **http://localhost:5175**, die Schnittstelle auf
**http://localhost:5176**, die Verwaltung auf **http://localhost:5177**.

Beim ersten Aufruf der Verwaltung meldet man sich mit `admin` an; das Passwort
steht in `KIAS_ADMIN_PASSWORD`, ohne Angabe ist es ebenfalls `admin`.

Weitere Befehle:

```bash
docker compose ps
```

```bash
docker compose logs -f rest-kias
```

```bash
docker compose restart neo-kias
```

```bash
docker compose down
```

## Konfiguration

Alles wird über die `.env` im Projektverzeichnis gesteuert. Sie gilt für beide
Startvarianten: Docker reicht die Werte in den Container, beim Start über npm
liest die Anwendung die Datei selbst. Echte Umgebungsvariablen haben immer
Vorrang vor der Datei.

### Daten und Netzwerk

| Variable | Default | Beschreibung |
|---|---|---|
| `KIAS_DATA_DIR` | – | **Pflicht.** Absoluter Pfad zum Verzeichnis mit `Daten/`, `Update/` und `Formulare/`. Bei Docker der Host Pfad für den Mount, bei npm die Datenwurzel. |
| `KIAS_ROOT` | eine Ebene über der App | Datenwurzel der Anwendung. Im Container setzt compose sie auf `/data`. Nur nötig, wenn sie von `KIAS_DATA_DIR` abweichen soll. |
| `HOST_PORT` | `5175` | Port der Suchoberfläche auf dem Host (nur Docker). |
| `API_PORT` | `5176` | Port der Schnittstelle auf dem Host (nur Docker). Diese Adresse trägt man in athena-KIAS ein. |
| `ADMIN_PORT` | `5177` | Port der Verwaltung auf dem Host (nur Docker). |
| `KIAS_ROLE` | `all` | Was der Prozess bedient: `api`, `web`, `admin` oder alles zusammen. Compose setzt es je Container selbst. |
| `KIAS_API_URL` | `http://rest-kias:5175` | Ziel, an das die Oberfläche `/api` weiterreicht. Nur in der Rolle `web` benutzt. |
| `TZ` | `Europe/Berlin` | Zeitzone im Container. |
| `KIAS_SERVER_NAME` | Rechnername | Name, unter dem sich der Server bei `/api/ping` meldet. Nützlich, wenn mehrere Server im Betrieb laufen. |

Liegen die Daten auf einer Netzwerkfreigabe, wird diese auf dem Host gemountet
und `KIAS_DATA_DIR` auf den Mountpoint gesetzt.

### Verwaltung

| Variable | Default | Beschreibung |
|---|---|---|
| `COMPOSE_PROFILES` | `admin` | Mit `admin` starten die Container `admin-kias` und `kias-db`. Leer lassen heißt: keine Verwaltung. |
| `KIAS_ADMIN` | `true` | Schaltet `/api/admin/*` und `POST /api/reload` in `rest-kias` frei. Gehört zu `COMPOSE_PROFILES`, beide zusammen umstellen. |
| `KIAS_ADMIN_PASSWORD` | `admin` | Passwort der Verwaltung. Der Benutzername ist immer `admin`. Ohne Angabe warnt der Start und die Oberfläche zeigt einen Hinweis. |
| `KIAS_ADMIN_SESSION_HOURS` | `8` | Wie lange eine Anmeldung gilt. |
| `POSTGRES_PASSWORD` | `kias` | Passwort der Einstellungsdatenbank. Sie ist nach außen nicht geöffnet. |
| `DATABASE_URL` | aus `POSTGRES_PASSWORD` | Vollständige Adresse der Einstellungsdatenbank. Eigene Angabe nur für einen bereits vorhandenen Postgres. Leer heißt: keine Datenbank. |

### Suche und Speicherbedarf

| Variable | Default | Beschreibung |
|---|---|---|
| `KIAS_SEARCH_BLOBS` | `true` | Beim Laden je Datensatz eine kleingeschriebene Kopie aller Textfelder vorberechnen. Die erste Suche je Filterkombination wird schneller. |
| `KIAS_SEARCH_CACHE` | `50` | Anzahl der Filterkombinationen, deren Trefferliste im Speicher bleibt. Wiederholte Suchen und das Blättern werden daraus bedient. Wird bei jedem Reload verworfen. |
| `KIAS_HISTORY` | `true` | Änderungshistorie der Updates mitschreiben. Schaltet die Seite **Änderungen** frei und erklärt bei der Suche nach einem nicht mehr vorhandenen Aktionscode, was mit ihm passiert ist. |
| `KIAS_API_DOCS` | `true` | Swagger UI der JSON Schnittstelle unter `/api/docs`, lokal ausgeliefert und damit auch ohne Internet nutzbar. Auf `false` antwortet der Pfad mit 404. |


### Bilder

| Variable | Default | Beschreibung |
|---|---|---|
| `KIAS_SHOW_CAR_IMAGES` | `false` | Fotobereich auf den Fahrzeugkarten einschalten. Ohne passendes Bild erscheint eine generische Silhouette. |
| `KIAS_CAR_IMAGES_DIR` | `./car-images` | Verzeichnis mit den Fahrzeugfotos. Dateiname ist der kleingeschriebene Modellname, etwa `mondeo.png`. |

### Logging

| Variable | Default | Beschreibung |
|---|---|---|
| `KIAS_LOG_DIR` | `./logs` | Host Pfad für die Logdateien. Unter Linux werden Schreibrechte für uid 1000 benötigt (`sudo chown 1000:1000 ./logs`). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` oder `trace`. Ab `debug` werden auch Suchfilter protokolliert. |
| `LOG_MAX_SIZE` | `10m` | Rotation ab dieser Dateigröße. |
| `LOG_FREQUENCY` | `daily` | `daily`, `hourly`. Rotiert wird nach der zuerst zutreffenden Regel. |
| `LOG_MAX_FILES` | `14` | Anzahl der aufbewahrten Dateien. |
| `LOG_STDOUT` | `true` | `false` schaltet die Ausgabe in `docker compose logs` ab. |

Die Anwendung schreibt strukturierte JSON Logs, eine Zeile je HTTP-Anfrage,
inklusive aufrufender IP und Antwortzeit.

## Updates einspielen

Neue Update Dateien in den Ordner `Update/` kopieren. Bei Docker sind sie durch
das Volume sofort im Container sichtbar. Danach die Daten neu einlesen, in der
**Verwaltung** unter http://localhost:5177, Karte „Neu einlesen".

Ein Neustart ist nicht nötig.

Aus der Suchoberfläche ist der Knopf verschwunden. Sie läuft ohne Anmeldung,
also sah ihn jeder, der die Seite offen hatte; ein Leselauf betrifft aber alle
Benutzer gleichzeitig. Für Skripte geht es weiter über die Schnittstelle,
jetzt mit Zugangsdaten:

```bash
curl -u admin:PASSWORT -X POST http://localhost:5176/api/reload
```

### Wann wirklich gelesen wird

Damit ein Klick nicht jedes Mal einen minutenlangen Leselauf auslöst, prüft
der Server zuerst Größe und Änderungsdatum aller Dateien, die er liest, rund
tausend Stück in etwa 50 Millisekunden. Stimmen sie mit dem Stand des letzten
Einlesens überein, passiert nichts und die Verwaltung meldet „Keine Änderungen
an den Daten".

Klicken mehrere Personen gleichzeitig, entsteht trotzdem nur ein Ladevorgang:
wer währenddessen klickt, wartet auf den laufenden mit, statt einen zweiten
anzustoßen.

Hat eine Kopie Größe und Zeitstempel erhalten, sodass die Prüfung die Änderung
nicht sieht, hilft das Häkchen **„Erzwingen"** in der Verwaltung, oder:

```bash
curl -u admin:PASSWORT -X POST "http://localhost:5176/api/reload?force=true"
```

## Verwaltung

Eine eigene Oberfläche (Vue) unter **http://localhost:5177**, hinter Benutzer
`admin` und dem Passwort aus `KIAS_ADMIN_PASSWORD`. Sie kann drei Dinge:

- **Zustand** ansehen: geladen oder nicht, Anzahl der Aktionen, Stand des
  letzten Einlesens, Fortschritt während eines Ladelaufs.
- **Datenpfad** setzen. `Zugriff testen` sieht nach, ob unter dem Pfad
  `Daten/`, `Update/` und `Formulare/` liegen, zählt die DBF-Dateien und liest
  probeweise in eine hinein. Gespeichert wird erst, wenn diese Prüfung besteht;
  danach liest der Server sofort neu ein.
- **Neu einlesen**, mit oder ohne Erzwingen.

Zwei Dinge, die dabei leicht zu übersehen sind:

Der Pfad gilt **aus Sicht des Servers**. Im Container ist das der Ort, an den
das Volume zeigt, also meist `/data`, und nicht der Laufwerksbuchstabe des
Arbeitsplatzes. Ein Pfad, der im Container nicht existiert, fällt schon bei
der Prüfung durch und wird gar nicht erst gespeichert.

Der gespeicherte Pfad liegt in `kias-db` und gewinnt gegen `KIAS_DATA_DIR` aus
der `.env`. Die `.env` bleibt die Vorgabe für den ersten Start und für den
Fall, dass keine Datenbank läuft; die Verwaltung zeigt an, welche der beiden
Quellen gerade gilt. Ohne Datenbank lässt sich der Pfad ansehen und testen,
aber nicht speichern.

## Die Seite „Änderungen"

KIAS liefert seine Daten als Basisstand plus eine nummerierte Kette von
Updates. Beim Zusammenführen entsteht der aktuelle Stand, die Zwischenschritte
gehen dabei verloren: eine Aktion, die ein Update aufnimmt und ein späteres
zurückzieht, wäre danach spurlos verschwunden.

Die Seite **Änderungen** (Link in der Fußzeile) hält den Verlauf fest. Je
Update ist zu sehen, was neu kam, was geändert wurde, was eine neue Nummer
bekam und was zurückgezogen wurde, jeweils mit dem abgedeckten Zeitraum. Die
Seite ist durchsuchbar, der Suchbegriff steht in der URL.

Sucht man einen Aktionscode, den es nicht mehr gibt, erklärt die Trefferliste
den Grund, statt leer zu bleiben:

> **25SC4** gab es, wurde aber mit Update 007 / 2026 (30.04.2026)
> zurückgezogen und ist deshalb nicht mehr im Bestand.

Der letzte bekannte Stand lässt sich weiterhin vollständig öffnen.
Umnummerierte Aktionen verweisen auf ihren neuen Code (`WN003/2026` ->
`WN003/26`).

## Verbindung und Gesundheit

Kleine Endpunkte, die auch dann schon antworten, wenn die DBF-Dateien noch
eingelesen werden. Sie hängen vor der 503-Sperre der Datenendpunkte.

### `GET /api/ping`

Für die App athena-KIAS: prüft eine eingegebene Serveradresse, bevor es
weitergeht. Winzig, rund 100 Bytes und zwei Millisekunden.

```json
{ "pong": true, "service": "neo-kias", "name": "Werkstatt Nord",
  "version": "1.2.0", "loaded": false }
```

`loaded: false` heißt: der Server lebt, liest aber noch. Die App kann die
Adresse also übernehmen und so lange einen Ladehinweis zeigen, statt „keine
Verbindung" zu melden. `service` unterscheidet einen neo-KIAS von einem
beliebigen anderen Dienst, der auf demselben Port antwortet.

### `GET /api/health`

Für Überwachung und Betrieb, nicht für die App. Antwortet **200** nur bei
`status: "ok"`, sonst **503**:

| status | HTTP | Bedeutung |
|---|---|---|
| `ok` | 200 | Daten geladen, Server benutzbar |
| `starting` | 503 | liest gerade ein |
| `unhealthy` | 503 | unter der Datenwurzel fehlt `Daten/` |

```json
{
  "status": "ok", "service": "neo-kias", "version": "1.2.0",
  "uptimeSeconds": 30,
  "checks": {
    "dataRoot": { "ok": true, "detail": null },
    "data": { "ok": true, "loading": false, "bulletins": 12205,
              "loadedAt": "2026-08-22T09:55:13.559Z" }
  }
}
```

Der Docker-Healthcheck des Dienstes `rest-kias` benutzt diesen Endpunkt, und
ein vorgeschalteter Load Balancer fragt an derselben Stelle.

### `GET /healthz`

Lebt dieser Prozess? Ohne Datenzugriff, ohne Weiterleitung, deshalb außerhalb
von `/api`. Der Web-Dienst prüft sich damit selbst: `/api/health` ginge bei ihm
durch den Weiterleiter und meldete den Zustand der Schnittstelle statt den
eigenen, wäre also während des Einlesens fälschlich krank.

```json
{ "ok": true, "role": "web" }
```

Alle drei Endpunkte sind unauthentifiziert. Der Pfad der Datenwurzel steht
bewusst nicht darin, anders als bei `/api/status`.

### Wenn die Schnittstelle fehlt

Antwortet `rest-kias` nicht, liefert der Weiterleiter **502** mit
`{"error":"upstream"}`. Bewusst nicht 503: das heißt in diesem Projekt „liest
noch ein", und genau das soll die Oberfläche hier nicht glauben. Die Seite
selbst bleibt erreichbar und fragt weiter nach, bis die Schnittstelle da ist.

## API

Die Endpunkte sind unter **http://localhost:5175/api/docs** interaktiv
dokumentiert (Swagger UI, abschaltbar über `KIAS_API_DOCS`). Die
Spezifikation allein liegt unter `/api/docs/openapi.json`.


- `GET /api/ping` – lebt der Server? Antwortet auch während des Einlesens
- `GET /api/health` – benutzbar? 200 bei `ok`, sonst 503
- `GET /healthz` – lebt dieser Prozess? Ohne Daten, ohne Weiterleitung
- `GET /api/status` – Ladezustand, Zähler, `rootOk`, Herkunft des Pfads
- `POST /api/reload` – Daten neu einlesen, mit Anmeldung
- `POST /api/admin/login`, `/logout`, `GET /api/admin/session` – Anmeldung
- `GET /api/admin/state` – alles, was die Verwaltung anzeigt
- `POST /api/admin/data-root/test` – Zugriff auf einen Pfad prüfen
- `PUT /api/admin/data-root` – Pfad speichern und neu einlesen
- `GET /api/bulletins?q=&fz=&scode=&keyword=&yearFrom=&yearTo=&limit=&offset=`
- `GET /api/bulletin/:code` – Volltext inklusive verknüpfter Daten
- `GET /api/vehicles`, `GET /api/scodes`, `GET /api/updates`
- `GET /api/history` – Änderungen je Update
- `GET /api/forms/:file` – Formular ausliefern
