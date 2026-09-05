# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.1] — 2026-09-05

### Added
- `scripts/install-windows.ps1` samt Starter `install-windows.bat`: das
  Gegenstück zum Debian-Skript für Windows 11. Prüft Docker Desktop
  (Angebot zur Installation über winget), kopiert nach `C:\neo-kias`,
  erzeugt die `.env` samt Passwörtern, baut das Image, legt eine geplante
  Aufgabe für den Start bei der Anmeldung an und wartet, bis die Dienste
  antworten. Gleiche Optionen wie unter Debian, in
  PowerShell-Schreibweise.
- `.gitattributes` hält `.bat` und `.ps1` auf CRLF.
- Installationspaket `installer\`: eine MSI (WiX 5), Herausgeber
  fMerscher, Produkt neo-KIAS. Zeigt die MIT-Lizenz samt
  Haftungsausschluss und verlangt die Zustimmung, fragt das
  Datenverzeichnis ab und lässt erst weiter, wenn dort ein `Daten`-Ordner
  mit lesbaren DBF-Dateien liegt, sucht Docker Desktop, legt die `.env`
  an und richtet den Windows-Dienst `neo-KIAS` ein.
- Der Dienst wartet auf die Docker-Engine, ohne Zeitlimit, baut beim
  ersten Start das Abbild und hält die Container am Leben. Protokoll
  unter `%ProgramData%\neo-KIAS\service.log`.
- Docker Desktop ist Voraussetzung und wird nicht mehr mitinstalliert.
  Fehlt es, nennt ein eigenes Fenster die Bezugsquelle, öffnet auf Wunsch
  die Seite von Docker und sieht auf Knopfdruck noch einmal nach. Grund
  für die Kehrtwende: Docker verlangt WSL 2, eingeschaltete
  Virtualisierung und einen Neustart, und in einer virtuellen Maschine
  ohne verschachtelte Virtualisierung läuft es überhaupt nicht. Eine
  Viertelstunde Wartezeit, an deren Ende trotzdem nichts läuft, hilft
  niemandem.
- Das Fortschrittsfenster sagt, was gerade passiert, statt eine leere
  Statuszeile zu zeigen.
- Das Abschlussfenster nennt es beim Namen, wenn Docker fehlt, statt nur
  eine erfolgreich abgeschlossene Installation zu melden.
- `scripts\KiasEnv.ps1`: die Helfer für die `.env` liegen jetzt an einer
  Stelle und werden vom PowerShell-Installer wie von der MSI benutzt.

### Changed
- `scripts\install-windows.ps1` holt sich diese Helfer aus `KiasEnv.ps1`,
  statt eine zweite Fassung davon zu führen.
- Das Bauverzeichnis `installer\build\` bleibt aus der Versionsverwaltung
  heraus.

## [1.2.0] — 2026-08-22

### Added
- Verwaltung als eigene Vue-Oberfläche (Dienst `admin-kias`, Port 5177),
  hinter Benutzer `admin` und `KIAS_ADMIN_PASSWORD`; ohne Angabe gilt
  „admin", worauf Start und Oberfläche hinweisen.
- In der Verwaltung: Datenpfad setzen, Zugriff darauf prüfen (Daten/,
  Update/, Formulare/, DBF-Zählung, Leseprobe) und neu einlesen.
  Gespeichert wird nur ein Pfad, der die Prüfung besteht.
- Postgres (`kias-db`) für die Einstellungen, die die Verwaltung ändern
  darf. Die KIAS-Daten selbst bleiben in den DBF-Dateien. Ein dort
  gespeicherter Pfad gewinnt gegen `KIAS_DATA_DIR`; ohne Datenbank gilt
  weiter allein die `.env`.
- `COMPOSE_PROFILES=admin` und `KIAS_ADMIN` schalten Verwaltung und
  Datenbank zusammen ein oder aus.
- `/api/admin/*` und die Rolle `KIAS_ROLE=admin`.
- Das Debian-Skript richtet die neuen Dienste mit ein: es würfelt die
  Passwörter für Verwaltung und Datenbank aus und zeigt das der
  Verwaltung einmal an, kennt `--admin-password`, `--no-admin`,
  `--api-port` und `--admin-port`, warnt vor belegten Ports und wartet
  am Ende, bis die Dienste antworten. Ein zweiter Lauf ergänzt fehlende
  Schlüssel in einer vorhandenen `.env`, ohne gesetzte Werte anzufassen.
- Oberfläche und Schnittstelle laufen als zwei Dienste: `neo-kias` liefert
  die React-Seite (Port 5175), `rest-kias` die REST-Schnittstelle
  (Port 5176). Ein Image, `KIAS_ROLE` entscheidet.
- Der Web-Dienst reicht `/api/*` an `KIAS_API_URL` weiter, damit die Seite
  mit einer Herkunft auskommt und ohne CORS. Antwortet die Schnittstelle
  nicht, kommt 502, nicht 503.
- `GET /healthz`: Lebenszeichen ohne Daten und ohne Weiterleitung, für den
  Healthcheck des Web-Containers.
- `npm run start:api` und `npm run start:web` starten die Hälften einzeln.
- `GET /api/ping`: winzige Lebendprüfung mit Dienstkennung, Name und
  Ladezustand. Die App prüft damit eine eingegebene Serveradresse.
- `GET /api/health`: Zustand für Überwachung und Betrieb. 200 bei `ok`,
  503 bei `starting` und `unhealthy`, mit Einzelprüfungen für Datenwurzel
  und Datenbestand.
- `KIAS_SERVER_NAME` benennt den Server; ohne Angabe der Rechnername.

### Changed
- „neu einlesen" ist aus der Suchoberfläche verschwunden und sitzt jetzt
  in der Verwaltung. `POST /api/reload` verlangt dieselben Zugangsdaten;
  ohne Verwaltung (`KIAS_ADMIN=false`) antwortet der Pfad mit 404.
- `/api/status` nennt mit `rootSource`, ob der Datenpfad aus der `.env`
  oder aus der Datenbank stammt.
- Der Healthcheck in Dockerfile und Compose fragt `/api/health` statt
  `/api/status` nach Textstellen zu durchsuchen.
- `Store.hasDataRoot()` beantwortet die Frage nach `Daten/` an einer
  Stelle; `/api/status` und `/api/health` können nicht auseinanderlaufen.

## [1.1.4-alpha] — 2026-08-14

### Changed
- „neu einlesen" liest nur noch, wenn sich die Daten geändert haben. Der
  Server vergleicht Größe und Änderungsdatum aller gelesenen Dateien mit
  dem Stand des letzten Einlesens; bei Gleichstand antwortet er sofort.
  Auf einem Server ohne Anmeldung, wo jeder den Knopf sieht, spart das die
  wiederholten Leseläufe.
- Gleichzeitige Klicks lösen keinen zweiten Ladevorgang mehr aus, sie
  warten auf den laufenden. Sechs gleichzeitige Anfragen ergeben ein
  Einlesen.
- Die Oberfläche meldet das Ergebnis („Keine Änderungen an den Daten",
  „Neu eingelesen: X Aktionen") und sperrt den Knopf währenddessen.
- `/api/reload?force=true` erzwingt das Einlesen, falls eine Kopie Größe
  und Zeitstempel erhalten hat.
- `/api/status` enthält `dataCheck` mit dem Fingerabdruck der Dateien.

## [1.1.3-alpha] — 2026-08-14

### Added
- `scripts/install-debian.sh`: bringt eine Debian-Maschine von null auf
  einen laufenden neo-KIAS. Installiert Docker samt Compose-Plugin,
  kopiert das Repository nach `/opt/neo-kias`, legt die `.env` aus
  `.env.example` an, baut das Image und richtet einen systemd-Dienst ein,
  der beim Booten startet.
- Das Skript ist wiederholbar: ein zweiter Lauf aktualisiert Code und
  Image, lässt `.env` und Logs aber unberührt.
- README: Abschnitt zur Installation samt Optionen.

### Fixed
- Zerschossene Tabelle „Bilder" in der README, die Zeile zu
  `KIAS_API_DOCS` stand zwischen Kopf und Trennzeile.
- `.gitattributes` erzwingt LF für Shell-Skripte, sonst scheitert ein auf
  Windows ausgecheckter Installer unter Linux am Zeilenende.

## [1.1.2-alpha] — 2026-08-11

### Added
- Swagger UI under `/api/docs`, describing all twelve endpoints with
  parameters, response shapes and the 503-while-loading case. Served from
  the local `swagger-ui-dist` package, so it works without internet
  access; the bare spec is at `/api/docs/openapi.json`.
- `KIAS_API_DOCS` (default `true`) switches it off; the path then
  answers 404.
- Footer link **API** on the landing page, shown only when the docs are
  enabled.

## [1.1.1-alpha] — 2026-08-11

### Fixed
- The loading screen now actually appears. Reading the DBF files blocked
  the event loop in one piece (6.8 s locally, about a minute in a
  container), so the server answered nothing at all during startup, not
  even the HTML of that screen.
- The read and merge loops hand control back every 20 ms. Longest block is
  now 0.3 s, load time is unchanged.
- Honest wording on the splash: seconds to two minutes depending on the
  medium, instead of a flat "about 2 minutes".

## [1.1.0-alpha] — 2026-08-11

### Added
- "Änderungen" page: per update file, which bulletins were added, changed,
  renumbered or withdrawn, with the period each update covers. Linked from
  the landing footer.
- The page has its own search; the query lives in the URL
  (`?page=history&hq=25SC4`) and is shareable.
- Withdrawn bulletins stay readable: the last known record is kept and
  opens in the normal detail view, marked by a banner.
- A search for a code that no longer resolves explains what happened to it
  and links to the last known state and to the changelog.
- `GET /api/history` serves the changelog as JSON.
- `KIAS_HISTORY`, `KIAS_SEARCH_BLOBS` and `KIAS_SEARCH_CACHE` env switches.
- `/api/status` reports `rootOk` and `searchCache` counters.

### Changed
- Search is 2 to 4 times faster on first use (precomputed lowercased blobs).
- Repeated queries and paging are served from an LRU cache, well under a
  millisecond; dropped on every reload.
- The app reads its own `.env` outside Docker and accepts `KIAS_DATA_DIR`
  as a fallback for `KIAS_ROOT`.

### Fixed
- Renumbered bulletins were dropped: `UPAKTION=2` with a differing `OLDKEY`
  is a renumbering, not a deletion. 7 of 13 were missing, 12,198 → 12,205.
- A data root without `Daten/`, and a load ending with zero bulletins, are
  logged as errors instead of passing for a successful load.
- A bulletin can be opened without an active search behind it, so `?code=`
  links and the changelog work.

## [1.0.0-alpha] — 2026-05-19

### Added
- First public release.
- DBF/FPT loader with per-file encoding detection (CP850 / Win1252 by
  language-driver byte) and proper 16-bit C-field size handling for VO 2.7
  files.
- Delta-update merger for `Update/FO_U*.dbf` files.
- Google-style search UI with cross-table reference matching.
- Dedicated browsers for Symptomcodes and Fahrzeuge (cards + table views).
- Bulletin detail view with inline links to other bulletins (`TSI 60/2010`,
  `OASIS BCM 2426`, ...) and to attached forms (`siehe Abbildung`).
- Self-reference detection so a bulletin's own `SSM 54371` etc. isn't
  rendered as a clickable link.
- Dark mode, view-mode toggle, persistent UI preferences.
- Docker image with multi-arch (`amd64`, `arm64`) build.
- Rotating file logger (pino + pino-roll), structured JSON request logs
  including caller IP and forwarded IP.
- Optional car photos in Fahrzeuge cards via `KIAS_SHOW_CAR_IMAGES`.

[Unreleased]: https://github.com/christophmerscher/neo-kiaas/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.2.1
[1.2.0]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.2.0
[1.1.4-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.4-alpha
[1.1.3-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.3-alpha
[1.1.2-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.2-alpha
[1.1.1-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.1-alpha
[1.1.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.0-alpha
[1.0.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.0.0-alpha
