# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Neue Seite **Änderungen**: Changelog der KIAS-Update-Kette. Je
  Update-Datei ist zu sehen, welche Aktionen neu kamen, geändert wurden,
  eine neue Nummer bekamen oder zurückgezogen wurden, mit dem Zeitraum aus
  `FO_Up.DBF`. Erreichbar über die Fußzeile der Startseite, filterbar,
  ein Klick auf einen Code sucht danach.
- Sucht man einen Aktionscode, den ein Update zurückgezogen oder
  umnummeriert hat, sagt die Trefferliste das jetzt, statt leer zu bleiben.
- `GET /api/history` liefert dieselben Daten als JSON.
- `KIAS_HISTORY` (Default `true`) schaltet das Mitschreiben ab; dann
  verschwinden Seite, Fußzeilen-Link und Hinweis.

### Fixed
- Umnummerierte Aktionen gingen beim Zusammenführen verloren. `UPAKTION=2`
  bedeutet nicht immer "gelöscht": trägt der Satz einen abweichenden
  `OLDKEY`, wurde die Aktion nur neu nummeriert (`23-2141` → `2141/23`).
  Der Loader hat in beiden Fällen nur den alten Schlüssel entfernt und den
  neuen nie angelegt. Auf dem aktuellen Datenstand fehlten dadurch 7 von
  13 umnummerierten Aktionen (12.198 statt 12.205).

### Fixed
- The app now reads its own `.env` when started outside Docker, and
  accepts `KIAS_DATA_DIR` as a fallback for `KIAS_ROOT`. Previously
  `npm start` ignored the file entirely and fell back to the directory
  above the app, which loads zero rows whenever the repo and the KIAS
  installation live in different places.
- A data root without a `Daten/` subdirectory, and a load that ends with
  zero bulletins, are now logged as errors instead of passing for a
  successful load. `/api/status` reports `rootOk`.

### Changed
- Search is substantially faster. Rows now carry a precomputed lowercased
  blob of their text fields, so a query does one `includes` per row instead
  of lowercasing every field again: first-time queries drop from roughly
  100-150 ms to 25-90 ms.
- Match lists are memoized per filter combination (LRU, 50 entries by
  default), so repeated queries and paging through a result set answer in
  well under a millisecond. The cache is dropped on every data reload.
- `/api/status` reports `searchCache` counters (hits, misses, evictions).

### Added
- `KIAS_SEARCH_BLOBS` (default `true`) to trade the roughly 100 MB the
  blobs cost against query speed, and `KIAS_SEARCH_CACHE` (default `50`)
  to size the memoization cache.

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

[Unreleased]: https://github.com/YOUR_GITHUB_USERNAME/neo-kias/compare/v1.0.0-alpha...HEAD
[1.0.0-alpha]: https://github.com/YOUR_GITHUB_USERNAME/neo-kias/releases/tag/v1.0.0-alpha
