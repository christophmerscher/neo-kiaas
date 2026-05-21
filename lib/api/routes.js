/**
 * Express route registration.
 *
 * Routes are organised in small handler functions for readability. The
 * factory ({@link buildApp}) wires the routes against the dependencies
 * passed in — Store, SearchEngine, ReferenceResolver, etc. — so the same
 * server code is trivially mockable in tests.
 *
 * @module api/routes
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { buildHttpLogger, callerIp } = require('./middleware');

/**
 * Build a fully-wired Express app.
 *
 * @param {Object} deps
 * @param {import('../config')} deps.config
 * @param {import('pino').BaseLogger} deps.logger
 * @param {import('../data/Store').Store} deps.store
 * @param {import('../search/SearchEngine').SearchEngine} deps.search
 * @param {import('../search/ReferenceResolver').ReferenceResolver} deps.resolver
 * @returns {import('express').Express}
 */
function buildApp({ config, logger, store, search, resolver }) {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json());
  app.use(buildHttpLogger(logger));

  registerStatusRoutes(app, { store, config });
  registerBulletinRoutes(app, { store, search, resolver });
  registerLookupRoutes(app, { store });
  registerFormRoutes(app, { config });
  registerCarImageRoutes(app, { config });
  registerUpdatesRoute(app, { config });
  registerStaticUi(app, config.appDir);

  return app;
}

// ── /api/status, /api/reload ───────────────────────────────────────────────

function registerStatusRoutes(app, { store, config }) {
  app.get('/api/status', (req, res) => {
    res.json({
      ...store.stats(),
      root: config.dataRoot,
      features: { carImages: config.showCarImages },
    });
  });

  app.post('/api/reload', async (req, res) => {
    req.log.warn({ ip: callerIp(req) }, 'manual reload requested');
    const t0 = Date.now();
    await store.load();
    req.log.info({ ms: Date.now() - t0 }, 'manual reload completed');
    res.json(store.stats());
  });
}

// ── /api/bulletins, /api/bulletin/:code, /api/resolve ──────────────────────

function registerBulletinRoutes(app, { store, search, resolver }) {
  app.get('/api/bulletins', (req, res) => {
    const { q, fz, scode, keyword, yearFrom, yearTo, limit, offset } = req.query;
    const filters = {
      q: q || '', fz: fz || '', scode: scode || '',
      keyword: keyword || '', yearFrom: yearFrom || '', yearTo: yearTo || '',
      limit: Math.min(500, Number(limit) || 100),
      offset: Number(offset) || 0,
    };
    const result = search.listBulletins(filters);
    req.log.debug({ filters, total: result.total, returned: result.results.length }, 'bulletins query');
    res.json(result);
  });

  app.get('/api/bulletin/:code', (req, res) => {
    const code = req.params.code;
    const detail = store.bulletinDetail(code, {
      resolveTextReferences: (t) => resolver.resolveTextReferences(t),
    });
    if (!detail) {
      req.log.warn({ code }, 'bulletin not found');
      return res.status(404).json({ error: 'not found' });
    }
    req.log.debug({ code }, 'bulletin fetched');
    res.json(detail);
  });

  app.get('/api/resolve', (req, res) => {
    const ref = (req.query.ref || '').toString();
    if (!ref) return res.status(400).json({ error: 'missing ref' });
    const code = resolver.resolveReference(ref);
    if (!code) {
      req.log.info({ ref }, 'reference not resolvable');
      return res.status(404).json({ error: 'not resolvable' });
    }
    req.log.debug({ ref, code }, 'reference resolved');
    res.json({ resolved: code });
  });
}

// ── /api/vehicles, /api/scodes ─────────────────────────────────────────────

function registerLookupRoutes(app, { store }) {
  app.get('/api/vehicles', (req, res) => res.json(store.vehicles()));
  app.get('/api/scodes', (req, res) => res.json(store.scodes()));
}

// ── /api/forms/:file ───────────────────────────────────────────────────────

function registerFormRoutes(app, { config }) {
  app.get('/api/forms/:file', (req, res) => {
    const f = req.params.file;
    if (f.includes('..') || f.includes('/') || f.includes('\\')) {
      req.log.warn({ file: f }, 'rejected form request with traversal');
      return res.status(400).send('invalid');
    }
    const p = path.join(config.formulareDir, f);
    if (!fs.existsSync(p)) {
      req.log.warn({ file: f }, 'form not found');
      return res.status(404).send('not found');
    }
    req.log.info({ file: f }, 'form served');
    res.sendFile(p);
  });
}

// ── /api/car-images ────────────────────────────────────────────────────────

function registerCarImageRoutes(app, { config }) {
  app.get('/api/car-images', (req, res) => {
    if (!config.showCarImages) return res.json([]);
    if (!fs.existsSync(config.carImagesDir)) return res.json([]);
    try {
      const items = fs.readdirSync(config.carImagesDir)
        .filter(f => /\.(png|jpe?g|webp|svg|gif|avif)$/i.test(f))
        .map(f => ({
          file: f,
          slug: path.basename(f, path.extname(f)).toLowerCase(),
        }));
      res.json(items);
    } catch (e) {
      req.log && req.log.warn({ err: e.message }, 'car-images list failed');
      res.json([]);
    }
  });

  app.get('/api/car-images/:file', (req, res) => {
    if (!config.showCarImages) return res.status(404).send('disabled');
    const f = req.params.file;
    if (f.includes('..') || f.includes('/') || f.includes('\\')) {
      return res.status(400).send('invalid');
    }
    const p = path.join(config.carImagesDir, f);
    if (!fs.existsSync(p)) return res.status(404).send('not found');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.sendFile(p);
  });
}

// ── /api/updates ───────────────────────────────────────────────────────────

function registerUpdatesRoute(app, { config }) {
  app.get('/api/updates', (req, res) => {
    if (!fs.existsSync(config.updateDir)) return res.json([]);
    const items = fs.readdirSync(config.updateDir)
      .filter(f => /^FO_Inhalt\d+\.dbf$/i.test(f))
      .map(f => {
        const s = fs.statSync(path.join(config.updateDir, f));
        return { file: f, mtime: s.mtime, size: s.size };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
    res.json(items);
  });
}

// ── Static UI (SPA fallback) ───────────────────────────────────────────────

function registerStaticUi(app, appDir) {
  const dist = path.join(appDir, 'web', 'dist');
  if (!fs.existsSync(dist)) return;
  app.use(express.static(dist));
  // SPA route fallback: any non-/api path serves the React index.
  app.get(/^(?!\/api).*/, (req, res) =>
    res.sendFile(path.join(dist, 'index.html')),
  );
}

module.exports = { buildApp };
