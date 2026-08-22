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
`.env.example` an, baut das Image und richtet einen systemd-Dienst ein, der
beim Booten startet.

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

Danach läuft die Oberfläche auf **http://SERVER:5175**. Das erste Einlesen
dauert je nach Datenträger bis zu zwei Minuten, solange zeigt die Seite einen
Ladebildschirm mit Fortschritt.

### Optionen

| Option | Bedeutung |
|---|---|
| `--data-dir PFAD` | Verzeichnis mit `Daten/`, `Update/` und `Formulare/`. Ohne Angabe fragt das Skript danach. |
| `--port PORT` | Port auf dem Host, Standard `5175`. |
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

Das Skript ist wiederholbar: ein zweiter Lauf aktualisiert den Code und baut
das Image neu, eine vorhandene `.env` und die Logs bleiben unangetastet. Das
Datenverzeichnis wird dabei aus der bestehenden `.env` übernommen, `--data-dir`
ist also nur beim ersten Mal nötig.

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
| `KIAS_SERVER_NAME` | Rechnername | Name, unter dem sich der Server in der App meldet. Nützlich, wenn mehrere Server im Betrieb laufen. |

Liegen die Daten auf einer Netzwerkfreigabe, wird diese auf dem Host gemountet
und `KIAS_DATA_DIR` auf den Mountpoint gesetzt.

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
das Volume sofort im Container sichtbar. Danach die Daten neu einlesen:

- Knopf **„neu einlesen"** in der Fußzeile der Startseite, oder
- `curl -X POST http://localhost:5175/api/reload`

Ein Neustart ist nicht nötig.

### Wann wirklich gelesen wird

Die Anwendung läuft ohne Anmeldung, jeder Benutzer sieht den Knopf. Damit er
nicht bei jedem Klick minutenlange Leseläufe auslöst, prüft der Server zuerst
Größe und Änderungsdatum aller Dateien, die er liest, rund tausend Stück in
etwa 50 Millisekunden. Stimmen sie mit dem Stand des letzten Einlesens
überein, passiert nichts und die Oberfläche meldet „Keine Änderungen an den
Daten".

Klicken mehrere Personen gleichzeitig, entsteht trotzdem nur ein Ladevorgang:
wer währenddessen klickt, wartet auf den laufenden mit, statt einen zweiten
anzustoßen.

Hat eine Kopie Größe und Zeitstempel erhalten, sodass die Prüfung die Änderung
nicht sieht, hilft:

```bash
curl -X POST "http://localhost:5175/api/reload?force=true"
```

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

## Server finden und Verbindung prüfen

Die App athena-KIAS kennt die Adresse des Servers zunächst nicht. Dafür gibt
es zwei Endpunkte, die auch dann schon antworten, wenn die DBF-Dateien noch
eingelesen werden.

### `GET /api/ping`

Winzig und ohne Datenzugriff, 72 Bytes und rund zwei Millisekunden:

```json
{ "pong": true, "service": "neo-kias", "version": "1.1.4-alpha", "loaded": false }
```

Zwei Aufgaben: eine von Hand eingegebene Adresse prüfen, bevor die App
weitergeht, und beim Absuchen eines Subnetzes die vielen Adressen schnell
verwerfen, hinter denen nichts steckt. `loaded: false` heißt, der Server
lebt, liest aber noch; die Datenendpunkte antworten so lange mit 503.

### `GET /api/discover`

Sagt, wer da antwortet: Name, Version, Fähigkeiten, Ladezustand, die eigenen
IPv4-Adressen und eine `instanceId`. Die Kennung ist über Neustarts stabil
und unterscheidet zwei Installationen. Praktischer Nutzen: findet die App
denselben Server unter mehreren Adressen, erkennt sie das an der gleichen
`instanceId` und zeigt ihn nur einmal an.

Der Pfad der Datenwurzel steht bewusst **nicht** in der Antwort, anders als
bei `/api/status`. Beide Endpunkte sind unauthentifiziert.

### Wie die App den Server findet

Ein HTTP-Endpunkt kann sich nicht selbst finden, wer ihn aufruft kennt die
Adresse bereits. Das Finden passiert deshalb außerhalb von HTTP, und die
beiden Endpunkte bestätigen anschließend den Fund:

| Weg | Aufwand | Grenzen |
|---|---|---|
| Gespeicherte Adresse aus dem letzten Start | keiner | nur wenn sich nichts geändert hat |
| mDNS / DNS-SD (`_neokias._tcp`) | Bibliothek auf beiden Seiten | Docker braucht `network_mode: host`, iOS eine Berechtigung |
| Subnetz absuchen mit `/api/ping` | nur clientseitig | nur das eigene /24 |
| Adresse von Hand, geprüft per Ping | keiner | Benutzer muss sie kennen |

Gemessen auf einem gewöhnlichen Heimnetz: 254 Adressen mit 32 gleichzeitigen
Anfragen und 800 ms Zeitlimit dauern **6,5 Sekunden**.

## API

Die Endpunkte sind unter **http://localhost:5175/api/docs** interaktiv
dokumentiert (Swagger UI, abschaltbar über `KIAS_API_DOCS`). Die
Spezifikation allein liegt unter `/api/docs/openapi.json`.


- `GET /api/ping` – lebt der Server? Antwortet auch während des Einlesens
- `GET /api/discover` – Name, Version, Kennung, Adressen
- `GET /api/status` – Ladezustand, Zähler, `rootOk`
- `POST /api/reload` – Daten neu einlesen
- `GET /api/bulletins?q=&fz=&scode=&keyword=&yearFrom=&yearTo=&limit=&offset=`
- `GET /api/bulletin/:code` – Volltext inklusive verknüpfter Daten
- `GET /api/vehicles`, `GET /api/scodes`, `GET /api/updates`
- `GET /api/history` – Änderungen je Update
- `GET /api/forms/:file` – Formular ausliefern
