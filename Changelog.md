# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.1] — 2026-10-26

### Fixed
- **Ein leerer Lesevorgang hat den guten Bestand überschrieben.** Gemeldet
  als „Programm leert Datenbank": nach einiger Laufzeit stand die Suche
  auf 0 Aktionen, und neu einlesen half nicht. Die Kette war diese: der
  Lader überliest fehlende Dateien mit Absicht und liefert leere Listen,
  und `Store.load()` hat dieses Ergebnis ungeprüft übernommen. Damit war
  der vollständige Bestand aus dem Arbeitsspeicher weg, obwohl er zum
  Arbeiten gereicht hätte. Ein Lauf, der keine einzige Aktion findet,
  während welche im Speicher stehen, wird jetzt verworfen. Stand,
  Fingerabdruck und Daten bleiben unangetastet.
- **Der verworfene Lauf wurde als Erfolg gemeldet.** Die Verwaltung zeigte
  einen grünen Kasten mit „Erzwungen neu eingelesen. 0 Dateien geprüft
  (0 ms). Bestand: 0 Aktionen." `/api/reload` und `/api/admin/reload`
  antworten nun mit **409** und dem Satz aus dem Leseprotokoll, die
  Verwaltung zeigt ihn rot.
- Die Suche sah einen eingefrorenen Bestand nicht von einem aktuellen
  unterscheiden. `/api/status` liefert dafür das neue Feld `readError`
  (Zeitpunkt, Auslöser, Grund, Stand des gehaltenen Bestands), die
  Startseite zeigt daraus einen Hinweis, und die Verwaltung schaltet die
  Zustandsplakette auf „Stand eingefroren".

### Notes
- Der Auslöser lag außerhalb dieses Programms: ein Bind-Mount auf eine
  Windows-Freigabe (`${KIAS_DATA_DIR}:/data:ro`) wird beim Start des
  Containers einmal aufgelöst. Hängt die Freigabe zu diesem Zeitpunkt
  nicht, bindet Docker das leere Verzeichnis darunter, und zwar
  dauerhaft: ein späteres Einhängen auf dem Wirt erreicht den Container
  nicht mehr (Mount-Propagation steht auf `rprivate`). Diese Fassung
  macht daraus einen Hinweis statt eines Datenverlusts; die Ursache
  behebt man im Betrieb, etwa mit einem Docker-Volume mit `type: cifs`
  oder mit `RequiresMountsFor` in der systemd-Unit.
- Wurde die Datenbank tatsächlich geleert, gilt der leere Stand erst nach
  einem Neustart des Dienstes.

## [1.4.0] — 2026-10-19

### Added
- **Reparaturgruppen im Detail.** Unter den Fahrzeugen steht jetzt, in
  welche Gruppen eine Aktion einsortiert ist, etwa „414-01 Batterie,
  Befestigung u. Kabel" und „31 Ladesystem". Das ist neben dem Fahrzeug
  die zweite Achse, nach der KIAS selbst navigiert, und sie fehlte
  bisher vollständig in der Oberfläche, obwohl die Schnittstelle einen
  Teil davon schon lieferte.
- `/api/bulletin/:code` liefert dazu das neue Feld `repNGrups` neben dem
  bisherigen `repGrups`. Getrennt und nicht zusammengeworfen, weil die
  Nummernkreise nicht vergleichbar sind: „31" gegen „414-01".

### Fixed
- **Die neue Gruppenstruktur wurde gar nicht eingelesen.** `FO_AKT_FZ`
  führt zwei Spalten, `REPGRUP` für die alten zweistelligen Gruppen und
  `WREPGRUP` für die neuen sechsstelligen aus dem TSI-Ordner ab 2001.
  Indiziert war nur die erste. Von 317.837 Verknüpfungen tragen 152.084
  die alte und 163.111 die neue Gruppe, nie beide auf derselben Zeile;
  über alle Zeilen einer Aktion hinweg sind 9.730 Aktionen in beiden
  Strukturen eingeordnet, 1.610 nur in der alten und 114 nur in der
  neuen. Die neue Hälfte lag damit brach.
- In der Volltextsuche fanden Treffer aus `FO_REPNGRUP` keine Aktion
  mehr: aufgelöst wurde über den Index der alten, zweistelligen Nummern,
  in dem eine „414-01" nie vorkommt. Der Treffer wurde stillschweigend
  verworfen. Jetzt gibt es dafür einen eigenen Index.

## [1.3.2] — 2026-10-19

### Fixed
- **Drei Nachrichtenarten trugen die falsche Bezeichnung.** `L` stand als
  „Lieferanten-Information" in der Oberfläche, ist aber die
  **Schwerpunktliste**; `M` stand als „Meldung" und ist **Aktuelles zu
  Modellen**; `G` stand als „Gewährleistungsinformation" und ist die
  **Allgemeine Service-Information**. Betroffen waren 974 der 12.381
  Nachrichten. Die Buchstaben muss man nicht raten: KIAS führt sie je
  Fabrikat im Klartext in `System\Fabrikate.DBF`, und die Daten bestätigen
  es (`SP990603` heißt „Liste nicht kulanzfähiger Bauteile", `A0001/05`
  entspricht dem Nummernformat für „Aktuelles zu Modellen"). Woher die
  Bezeichnungen stammen, steht jetzt als Kommentar in
  `web/src/utils/nArt.js`, damit sie niemand wieder zurückrät.
- `S` heißt jetzt „Service-Rundschreiben (SR)" statt „Service-Aktion", das
  war mit `A` zu verwechseln.
- Die Nachrichtenart `I` ist entfallen; einen solchen Buchstaben gibt es
  im Bestand nicht und im Fabrikat auch nicht. `A`, `O` und `T` bleiben
  unverändert, die waren richtig.

## [1.3.1] — 2026-10-02

### Added
- `scripts/update-debian.sh`: aktualisiert eine bestehende Installation
  auf den Stand des Repositorys, aus dem es läuft. Sichert vorher,
  tauscht den Quelltext, zieht die `.env` nach (fehlende Schlüssel aus
  der neuen `.env.example`, eingestellte Werte bleiben), erneuert die
  systemd-Unit, baut das Image, startet und sieht nach, ob die neue
  Fassung auch antwortet. `--with-logs` schaltet dabei die
  Protokollsammlung ein, `--rollback` führt auf den Stand davor zurück.
- `scripts/analyse-kias.sh`: Untersuchung mit eigenen Befehlen. `data`
  liest den Datenpfad aus der `.env`, prüft die Erreichbarkeit samt
  Einhängepunkt und Freigabe, sieht für `Daten/`, `Update/` und
  `Formulare/` einzeln nach und stellt dieselben Fragen anschließend im
  Container. Weichen Wirt und Container voneinander ab, steht das als
  eigener Befund da; genau so sieht ein Bind-Mount aus, dessen Quelle
  verschwunden ist. Dazu `env`, `services`, `logs` und `all`.
  Rückgabewert 1, wenn etwas zu beanstanden war, damit sich das Skript
  auch in eine Überwachung hängen lässt.

### Fixed
- **Zugangsdaten standen im Protokoll.** `pino-http` schreibt in der
  Voreinstellung sämtliche Kopfzeilen mit, also auch `authorization`
  (bei HTTP Basic das Passwort, nur mit Base64 verpackt) und `cookie`
  samt gültigem Sitzungsschlüssel der Verwaltung. Das lag in den
  rotierenden Dateien und wanderte seit 1.3.0 zusätzlich nach Loki.
  Kopfzeilen werden jetzt nicht mehr mitgeschrieben, und `authorization`,
  `cookie` und `set-cookie` sind zusätzlich auf Ebene des Protokollierers
  unkenntlich gemacht.
- Eine Protokollzeile je Anfrage ist dadurch von rund 1,5 kB auf etwa
  ein Drittel geschrumpft, was auch die Aufbewahrung in Loki entlastet.
- Der verrutschte Hilfetext von `install-debian.sh`: der Satz zur
  abgeschalteten Verwaltung stand unter `--with-logs`.

## [1.3.0] — 2026-09-29

### Added
- Protokollsammlung als eigenes Compose-Profil `logs`: Grafana Alloy
  sammelt ein, Loki bewahrt auf (30 Tage, einstellbar), Grafana zeigt an
  (Port 5178). Angemeldet wird sich mit `admin` und
  `KIAS_ADMIN_PASSWORD`, also denselben Zugangsdaten wie bei der
  Verwaltung. Eine fertige Übersicht ist dabei: Ladeläufe mit ihrem
  Ergebnis, Datensätze beim letzten Lesen, Dauer, nicht gelesene
  Dateien, Fehler je Dienst, Zugriffe auf die Verwaltung. Ab Werk aus,
  die drei Container kosten rund 300 MB Arbeitsspeicher.
- `scripts/install-debian.sh --with-logs` schaltet das Profil gleich mit
  ein und nennt die Adresse in der Zusammenfassung.
- Leseprotokoll: jeder Ladelauf hält fest, welche Verzeichnisse und
  Basistabellen gefunden wurden, wie viele Datensätze daraus kamen und
  woran die übrigen gescheitert sind, mitsamt errno-Kürzel. Das Ergebnis
  steht im Protokoll des Dienstes, hängt am Store und kommt über
  `/api/admin/state` in die Verwaltung.
- Neue Karte „Letzter Lesevorgang" in der Verwaltung. Ein leerer Bestand
  sagt jetzt selbst, warum er leer ist, statt nur „0 Aktionen" zu zeigen.
- Jeder Ladelauf trägt seinen Auslöser (`startup`, `admin`, `api`,
  `root-change`) im Protokoll. Damit ist später zu sehen, ob der leere
  Bestand vom Start kam oder von einem Knopfdruck.
- Fehlt unter Daten/ und Update/ jede Datei, steht das als Fehler im
  Protokoll, bevor die erste Tabelle geöffnet wird. Bei einem
  weggelaufenen Bind-Mount ist das die erste ehrliche Auskunft.

### Fixed
- Der DBF-Leser ließ bei einer Datei, die keine DBF-Datei ist, den
  Dateizeiger offen: der Kopf wurde außerhalb des `try` gelesen, also lief
  das `finally` mit dem `close` nie. Unter Windows bleibt die Datei damit
  gesperrt, bis der Dienst endet, und ein Update, das sie ersetzen will,
  kommt nicht an ihr vorbei.
- Ein fehlendes oder unlesbares Verzeichnis unter dem Datenpfad wurde
  stillschweigend übergangen. Jetzt steht in einer Zeile, ob es fehlt
  oder ob die Rechte nicht reichen; das sind zwei verschiedene
  Handgriffe.

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

[Unreleased]: https://github.com/christophmerscher/neo-kiaas/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.3.1
[1.3.0]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.3.0
[1.2.1]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.2.1
[1.2.0]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.2.0
[1.1.4-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.4-alpha
[1.1.3-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.3-alpha
[1.1.2-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.2-alpha
[1.1.1-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.1-alpha
[1.1.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.0-alpha
[1.0.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.0.0-alpha
