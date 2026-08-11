/**
 * neo-KIAS server entry point.
 *
 * Wires the dependency graph (config → logger → store → search/resolver →
 * Express app), starts the HTTP server, and arranges for a graceful
 * SIGINT/SIGTERM shutdown so log buffers get a chance to flush.
 *
 * All business logic lives in the lib/ modules; this file is a thin
 * composition root.
 */

'use strict';

const fs = require('fs');
const config = require('./lib/config');
const logger = require('./lib/logger');
const { Store } = require('./lib/data/Store');
const { SearchEngine } = require('./lib/search/SearchEngine');
const { ReferenceResolver } = require('./lib/search/ReferenceResolver');
const { buildApp } = require('./lib/api/routes');

/**
 * Complain loudly when the configured data root doesn't look like a KIAS
 * installation. Missing DBF files are skipped silently by the loader, so
 * without this check a wrong KIAS_ROOT looks exactly like a successful
 * load of an empty database: "0 Aktionen" and no error anywhere.
 *
 * @returns {boolean} Whether Daten/ exists under the configured root.
 */
function checkDataRoot() {
  const datenDir = require('path').join(config.dataRoot, 'Daten');
  if (fs.existsSync(datenDir)) return true;
  logger.error(
    { root: config.dataRoot, expected: datenDir },
    'data root has no Daten/ subdirectory — the app will start up empty. '
    + 'Set KIAS_ROOT (or KIAS_DATA_DIR) to the folder that contains '
    + 'Daten/, Update/ and Formulare/.',
  );
  return false;
}

function main() {
  logger.info({
    root: config.dataRoot,
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

  checkDataRoot();

  const store = new Store(config.dataRoot, {
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
  const app = buildApp({ config, logger, store, search, resolver });
  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port },
      `listening on http://${config.host}:${config.port} (data load in progress)`,
    );
  });

  // Kick off the load. We log success/failure but don't tie it to listen()
  // — the server keeps serving the loading screen + /api/status either way.
  store.load()
    .then(() => {
      const { aktion } = store.counts();
      if (!aktion) {
        logger.error(
          { root: config.dataRoot },
          'data load finished with 0 bulletins — check that KIAS_ROOT points '
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
