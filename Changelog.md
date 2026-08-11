# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/christophmerscher/neo-kiaas/compare/v1.1.2-alpha...HEAD
[1.1.2-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.2-alpha
[1.1.1-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.1-alpha
[1.1.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.1.0-alpha
[1.0.0-alpha]: https://github.com/christophmerscher/neo-kiaas/releases/tag/v1.0.0-alpha
