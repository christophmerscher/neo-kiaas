# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Der Ladebildschirm erscheint jetzt tatsächlich. Das Einlesen der
  DBF-Dateien blockierte die Event-Loop am Stück, gemessen 6,8 Sekunden
  lokal und rund eine Minute im Container, in der der Server keine einzige
  Antwort ausliefern konnte, auch nicht das HTML des Ladebildschirms. Die
  Leseschleifen geben nun alle 20 ms an die Event-Loop zurück; die längste
  Blockade liegt bei rund 0,3 Sekunden, die Ladezeit bleibt gleich.

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

[Unreleased]: https://github.com/christophmerscher/neo-kiaas/compare/v1.1.0-alpha...HEAD
[1.1.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.0-alpha
[1.0.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.0.0-alpha
