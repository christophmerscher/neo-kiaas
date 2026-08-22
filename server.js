/**
 * neo-KIAS server entry point.
 *
 * Wires the dependency graph (config → logger → store → search/resolver →
 * Express app), starts the HTTP server, and arranges for a graceful
 * SIGINT/SIGTERM shutdown so log buffers get a chance to flush.
 *
 * Derselbe Einstieg bedient alle Hälften, `KIAS_ROLE` entscheidet:
 * `api` liest die Daten und beantwortet `/api/*`, `web` und `admin`
 * liefern je ein Bündel aus und reichen `/api/*` weiter, `all` macht
 * Suche und Schnittstelle in einem Prozess (Voreinstellung, so läuft
 * `npm start` wie bisher).
 *
 * All business logic lives in the lib/ modules; this file is a thin
 * composition root.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const logger = require('./lib/logger');
const { Store } = require('./lib/data/Store');
const { DataLocation } = require('./lib/data/DataLocation');
const { SettingsStore, KEYS } = require('./lib/data/SettingsStore');
const { SearchEngine } = require('./lib/search/SearchEngine');
const { ReferenceResolver } = require('./lib/search/ReferenceResolver');
const { buildApp } = require('./lib/api/routes');

/**
 * Complain loudly when the data root doesn't look like a KIAS
 * installation. Missing DBF files are skipped silently by the loader, so
 * without this check a wrong path looks exactly like a successful load of
 * an empty database: "0 Aktionen" and no error anywhere.
 *
 * @param {DataLocation} location
 * @returns {boolean} Whether Daten/ exists under the current root.
 */
function checkDataRoot(location) {
  if (location.looksLikeKias) return true;
  logger.error(
    { root: location.root, source: location.source, expected: location.datenDir },
    'data root has no Daten/ subdirectory — the app will start up empty. '
    + 'Set the path in the admin UI, or via KIAS_ROOT (or KIAS_DATA_DIR), '
    + 'to the folder that contains Daten/, Update/ and Formulare/.',
  );
  return false;
}

/**
 * Oberflächen-Hälfte: ein Bündel ausliefern, `/api/*` weiterreichen.
 *
 * Gilt für die Suche (`web`) wie für die Verwaltung (`admin`); der
 * Unterschied ist allein das Verzeichnis. Ohne Store, ohne Datenwurzel,
 * ohne Volume: der Container startet in Sekunden und zeigt sofort seinen
 * Ladebildschirm, während der API-Dienst noch die DBF-Dateien liest.
 */
function startUiTier() {
  const dir = config.role === 'admin' ? 'admin' : 'web';
  const dist = path.join(config.appDir, dir, 'dist');
  const built = fs.existsSync(dist);
  logger.info(
    { role: config.role, api: config.apiUrl, dist: built ? dist : null, logging: logger.kiasConfig },
    `neo-KIAS ${dir} tier starting`,
  );
  if (!built) {
    logger.error(
      { expected: dist },
      `${dir}/dist is missing — run "npm run build:${dir}" before starting `
      + 'this tier, otherwise every page answers 404.',
    );
  }

  const app = buildApp({ config, logger });
  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port, api: config.apiUrl },
      `listening on http://${config.host}:${config.port} (API at ${config.apiUrl})`,
    );
  });
}

/**
 * Den zu benutzenden Datenpfad festlegen.
 *
 * Reihenfolge: was in der Verwaltung gespeichert wurde, sonst die `.env`.
 * Die Datenbank wird erst hier befragt, also nachdem der Server bereits
 * lauscht — der Postgres-Container startet parallel, und ein langsamer
 * oder fehlender Datenbankserver darf die Suche nicht aufhalten.
 *
 * @param {DataLocation} location
 * @param {Store} store
 * @param {SettingsStore} settings
 */
async function resolveDataRoot(location, store, settings) {
  if (!config.admin || !settings.configured) return;
  await settings.init();
  const stored = await settings.get(KEYS.DATA_ROOT);
  if (!stored || typeof stored !== 'string') return;
  location.set(stored, 'db');
  store.setRoot(location.root);
  logger.info({ root: location.root }, 'using the data root set in the admin UI');
}

function main() {
  if (config.role === 'web' || config.role === 'admin') return startUiTier();

  logger.info({
    role: config.role,
    root: config.dataRoot,
    admin: config.admin,
    settingsDb: Boolean(config.databaseUrl),
    carImages: {
      enabled: config.showCarImages,
      dir: config.showCarImages ? config.carImagesDir : null,
      exists: config.showCarImages && fs.existsSync(config.carImagesDir),
    },
    logging: logger.kiasConfig,
    search: { blobs: config.searchBlobs, cacheSize: config.searchCacheSize },
    history: config.history,
    apiDocs: config.apiDocs,
  }, 'neo-KIAS starting');

  // Vorläufig der Pfad aus der .env; die Verwaltung kann ihn gleich
  // überschreiben, sobald die Einstellungsdatenbank antwortet.
  const location = new DataLocation(config.dataRoot, 'env');
  const settings = new SettingsStore({ url: config.databaseUrl, logger });

  const store = new Store(location.root, {
    logger,
    searchBlobs: config.searchBlobs,
    history: config.history,
  });
  const search = new SearchEngine(store, { cacheSize: config.searchCacheSize });
  const resolver = new ReferenceResolver(store);

  // Start serving HTTP immediately so the frontend can render a loading
  // screen while the (~2-minute) DBF read+merge runs in the background.
  // Data-dependent /api routes return 503 until store.load() completes;
  // /api/status stays available throughout so the UI can poll for progress.
  const app = buildApp({ config, logger, store, search, resolver, location, settings });
  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port },
      `listening on http://${config.host}:${config.port} (data load in progress)`,
    );
  });

  // Erst den Pfad klären, dann lesen. Ein Fehlschlag der Datenbank ist
  // kein Grund, gar nicht zu laden: dann gilt eben die .env.
  resolveDataRoot(location, store, settings)
    .catch(err => logger.error({ err: err.message }, 'resolving the data root failed'))
    .then(() => {
      checkDataRoot(location);
      return store.load();
    })
    .then(() => {
      const { aktion } = store.counts();
      if (!aktion) {
        logger.error(
          { root: location.root },
          'data load finished with 0 bulletins — check that the data root points '
          + 'at the folder containing Daten/, Update/ and Formulare/.',
        );
        return;
      }
      logger.info('initial data load complete; serving live requests');
    })
    .catch(err => {
      logger.fatal({ err: err.message, stack: err.stack }, 'initial data load failed');
      process.exit(1);
    });
}

main();

// Flush log buffers on shutdown so the very last requests aren't lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info({ signal: sig }, 'shutdown signal received');
    setTimeout(() => process.exit(0), 200);
  });
}
