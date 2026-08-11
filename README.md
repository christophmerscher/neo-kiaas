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

Die Oberfläche läuft dann auf **http://localhost:5175**.

Weitere Befehle:

```bash
docker compose ps
```

```bash
docker compose logs -f
```

```bash
docker compose down
```

## Starten mit npm

Voraussetzung ist Node.js 20 oder neuer.

```bash
npm install
```

```bash
npm run install:web
```

```bash
npm run build:web
```

```bash
npm start
```

Auch hier läuft die Oberfläche auf **http://localhost:5175**.

Ohne weitere Angabe sucht die Anwendung die Daten **eine Ebene über dem
Anwendungsverzeichnis**. Liegt das Repository woanders als die KIAS-Installation,
was bei der Entwicklung der Normalfall ist, setzt man den Pfad entweder in der
`.env` (`KIAS_ROOT`, ersatzweise `KIAS_DATA_DIR`) oder einmalig in der Shell:

```bash
$env:KIAS_ROOT = "C:\Users\me\Kias"; npm start
```

Zeigt die Datenwurzel ins Leere, meldet der Start eine Fehlerzeile im Log und
`/api/status` liefert `rootOk: false`, statt eine leere Datenbank vorzutäuschen.


Vite läuft dann auf http://localhost:5173 und leitet `/api` an Port 5175 weiter.

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
| `HOST_PORT` | `5175` | Port auf dem Host (nur Docker). |
| `TZ` | `Europe/Berlin` | Zeitzone im Container. |

Liegen die Daten auf einer Netzwerkfreigabe, wird diese auf dem Host gemountet
und `KIAS_DATA_DIR` auf den Mountpoint gesetzt.

### Suche und Speicherbedarf

| Variable | Default | Beschreibung |
|---|---|---|
| `KIAS_SEARCH_BLOBS` | `true` | Beim Laden je Datensatz eine kleingeschriebene Kopie aller Textfelder vorberechnen. Die erste Suche je Filterkombination wird schneller. |
| `KIAS_SEARCH_CACHE` | `50` | Anzahl der Filterkombinationen, deren Trefferliste im Speicher bleibt. Wiederholte Suchen und das Blättern werden daraus bedient. Wird bei jedem Reload verworfen. |
| `KIAS_HISTORY` | `true` | Änderungshistorie der Updates mitschreiben. Schaltet die Seite **Änderungen** frei und erklärt bei der Suche nach einem nicht mehr vorhandenen Aktionscode, was mit ihm passiert ist. |


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
das Volume sofort im Container sichtbar. Danach die Daten neu einlesen:

- Knopf **„neu einlesen"** in der Fußzeile der Startseite, oder
- `curl -X POST http://localhost:5175/api/reload`

Ein Neustart ist nicht nötig.

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

## API

- `GET /api/status` – Ladezustand, Zähler, `rootOk`
- `POST /api/reload` – Daten neu einlesen
- `GET /api/bulletins?q=&fz=&scode=&keyword=&yearFrom=&yearTo=&limit=&offset=`
- `GET /api/bulletin/:code` – Volltext inklusive verknüpfter Daten
- `GET /api/vehicles`, `GET /api/scodes`, `GET /api/updates`
- `GET /api/history` – Änderungen je Update
- `GET /api/forms/:file` – Formular ausliefern
