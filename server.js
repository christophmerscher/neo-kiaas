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

async function main() {
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
  await store.load();

  const search = new SearchEngine(store);
  const resolver = new ReferenceResolver(store);

  const app = buildApp({ config, logger, store, search, resolver });

  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port },
      `listening on http://${config.host}:${config.port}`,
    );
  });
}

main().catch(err => {
  logger.fatal({ err: err.message, stack: err.stack }, 'fatal startup error');
  process.exit(1);
});

// Flush log buffers on shutdown so the very last requests aren't lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info({ signal: sig }, 'shutdown signal received');
    setTimeout(() => process.exit(0), 200);
  });
}
