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

function main() {
  logger.info({
    root: config.dataRoot,
    carImages: {
      enabled: config.showCarImages,
      dir: config.showCarImages ? config.carImagesDir : null,
      exists: config.showCarImages && fs.existsSync(config.carImagesDir),
    },
    logging: logger.kiasConfig,
  }, 'neo-KIAS starting');

  const store = new Store(config.dataRoot, { logger });
  const search = new SearchEngine(store);
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
    .then(() => logger.info('initial data load complete; serving live requests'))
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
