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
const { registerDocsRoutes } = require('./docs');
const { registerHealthRoutes } = require('./health');
const { registerApiProxy } = require('./proxy');
const { registerAdminRoutes } = require('./admin');

/**
 * Build a fully-wired Express app.
 *
 * Was der Prozess bedient, hängt an `config.role`: die REST-Endpunkte
 * (`api`), eine der beiden Oberflächen samt Weiterleitung dorthin (`web`,
 * `admin`) oder Suche und Schnittstelle zusammen (`all`). Store, Suche
 * und Auflöser werden von den Oberflächen nicht gebraucht und sind dort
 * undefined.
 *
 * @param {Object} deps
 * @param {import('../config')} deps.config
 * @param {import('pino').BaseLogger} deps.logger
 * @param {import('../data/Store').Store} [deps.store]
 * @param {import('../search/SearchEngine').SearchEngine} [deps.search]
 * @param {import('../search/ReferenceResolver').ReferenceResolver} [deps.resolver]
 * @param {import('../data/DataLocation').DataLocation} [deps.location]
 * @param {import('../data/SettingsStore').SettingsStore} [deps.settings]
 * @returns {import('express').Express}
 */
function buildApp({ config, logger, store, search, resolver, location, settings }) {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(buildHttpLogger(logger));

  // Lebendprüfung des Prozesses selbst, ohne Daten und ohne Weiterleitung.
  // Der Web-Container hängt seinen Healthcheck hier hinein: /api/health
  // spräche über den Weiterleiter und meldete den Zustand des anderen
  // Dienstes, der Web-Container gälte also während des Einlesens als krank.
  app.get('/healthz', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, role: config.role });
  });

  const servesUi = config.role === 'web' || config.role === 'admin';

  if (servesUi) {
    registerApiProxy(app, { target: config.apiUrl, logger });
  } else {
    app.use(express.json());
    registerApiRoutes(app, { config, logger, store, search, resolver, location, settings });
  }

  // Welches Bündel ausgeliefert wird, hängt an der Rolle: die Suche unter
  // web/dist, die Verwaltung unter admin/dist. In „all" bleibt alles wie
  // bisher in einem Prozess, die Rolle „api" liefert nichts als JSON.
  if (config.role === 'admin') {
    registerStaticUi(app, path.join(config.appDir, 'admin', 'dist'));
  } else if (config.role !== 'api') {
    registerStaticUi(app, path.join(config.appDir, 'web', 'dist'));
  }

  return app;
}

/**
 * Alle `/api/*`-Endpunkte in der Reihenfolge, in der sie sich gegenseitig
 * abschirmen: erst die während des Einlesens erreichbaren, dann die Sperre,
 * dann alles, was Daten braucht.
 */
function registerApiRoutes(app, { config, logger, store, search, resolver, location, settings }) {
  // /api/status is always available (even while loading) so the frontend
  // can poll for progress and decide when to swap from loading screen to
  // normal UI.
  registerStatusRoutes(app, { store, config, search, location });

  // Erreichbarkeit und Gesundheit: müssen auch während des Einlesens
  // antworten, sonst kann weder die App eine Verbindung prüfen noch die
  // Überwachung zwischen „startet noch" und „kaputt" unterscheiden.
  registerHealthRoutes(app, { config, store });

  // Die Verwaltung ebenfalls vor der Sperre: liegt der Datenpfad falsch,
  // ist nichts geladen — und genau dann muss man ihn richtigstellen können.
  if (config.admin) {
    const { requireAdmin } = registerAdminRoutes(app, { config, logger, store, location, settings });
    registerReloadRoute(app, { store, requireAdmin });
  } else {
    // Ohne Verwaltung gibt es keinen Weg, neu einzulesen. Das darf man
    // sagen, statt es als „gibt es nicht" aussehen zu lassen.
    app.all('/api/admin/{*rest}', (req, res) => res.status(404).json({
      error: 'admin-disabled',
      message: 'Die Verwaltung ist abgeschaltet (KIAS_ADMIN=false).',
    }));
    app.post('/api/reload', (req, res) => res.status(404).json({
      error: 'admin-disabled',
      message: 'Neu einlesen läuft über die Verwaltung, und die ist abgeschaltet.',
    }));
  }

  // The API documentation is static and does not touch the data, so it is
  // mounted before the gate below and stays readable during the load.
  if (config.apiDocs) registerDocsRoutes(app, { config });

  // Every other /api endpoint goes through a gate: if the store hasn't
  // finished its initial load, return 503. The client treats 503 as
  // "still warming up — keep polling status" rather than a real error.
  app.use('/api', requireLoaded(store));

  registerBulletinRoutes(app, { store, search, resolver });
  registerHistoryRoutes(app, { store, config });
  registerLookupRoutes(app, { store });
  registerFormRoutes(app, { location });
  registerCarImageRoutes(app, { config });
  registerUpdatesRoute(app, { location });
}

/**
 * Express middleware that responds 503 to any /api request when the store
 * hasn't finished its initial load yet. /api/status is registered before
 * this gate so it stays reachable.
 *
 * @param {import('../data/Store').Store} store
 */
function requireLoaded(store) {
  return (req, res, next) => {
    if (store.data && store.indexes) return next();
    res.status(503).json({
      error: 'loading',
      message: 'Database is still loading. Try again in a few seconds.',
      progress: store.stats().progress,
    });
  };
}

// ── /api/status, /api/reload ───────────────────────────────────────────────

function registerStatusRoutes(app, { store, config, search, location }) {
  app.get('/api/status', (req, res) => {
    res.json({
      ...store.stats(),
      root: location.root,
      // "env" oder "db": ob der Pfad aus der .env stammt oder in der
      // Verwaltung gesetzt wurde.
      rootSource: location.source,
      // False means the configured root has no Daten/ subdirectory, i.e.
      // the app is running against nothing. Lets the UI say "data
      // directory not found" instead of showing an empty database.
      rootOk: store.hasDataRoot(),
      features: {
        carImages: config.showCarImages,
        history: config.history,
        apiDocs: config.apiDocs,
      },
      searchCache: search.cacheInfo(),
      // Digest of the data files behind the current state; the reload
      // endpoint compares against it.
      dataCheck: store.fingerprint
        ? { digest: store.fingerprint.digest.slice(0, 12), files: store.fingerprint.files }
        : null,
    });
  });

}

/**
 * `POST /api/reload`, jetzt hinter der Anmeldung.
 *
 * Der Knopf saß früher in der Suchoberfläche, wo ihn jeder ohne Anmeldung
 * sah. Er sitzt jetzt in der Verwaltung, und der Endpunkt verlangt
 * dieselben Zugangsdaten — sonst wäre die Verlagerung nur Kosmetik.
 *
 * Geprüft wird trotzdem erst, ob sich die Dateien überhaupt geändert
 * haben; gleichzeitige Anfragen schließen sich dem laufenden Lauf an,
 * statt einen zweiten anzustoßen.
 */
function registerReloadRoute(app, { store, requireAdmin }) {
  app.post('/api/reload', requireAdmin, async (req, res) => {
    const force = String(req.query.force || '') === 'true';
    req.log.warn({ ip: callerIp(req), force }, 'manual reload requested');
    const t0 = Date.now();
    const reload = await store.reloadIfChanged({ force, trigger: 'api' });
    req.log.info(
      { ms: Date.now() - t0, ...reload, read: store.lastRead ? store.lastRead.summary : null },
      'manual reload finished',
    );
    res.json({ ...store.stats(), reload });
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

    // Nothing found for what looks like a bulletin code? A later update
    // may have withdrawn or renumbered it. Saying so beats an empty page.
    if (result.total === 0 && filters.q) {
      const former = store.formerBulletin(filters.q);
      // Without the archived record: the detail endpoint serves that.
      if (former) {
        const { record, ...meta } = former;
        result.former = { ...meta, hasRecord: Boolean(record) };
      }
    }

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

// ── /api/history ───────────────────────────────────────────────────────────

function registerHistoryRoutes(app, { store, config }) {
  app.get('/api/history', (req, res) => {
    if (!config.history) {
      return res.json({ enabled: false, totals: null, updates: [] });
    }
    const log = store.changelog();
    req.log.debug({ updates: log.updates.length }, 'history requested');
    res.json(log);
  });
}

// ── /api/vehicles, /api/scodes ─────────────────────────────────────────────

function registerLookupRoutes(app, { store }) {
  app.get('/api/vehicles', (req, res) => res.json(store.vehicles()));
  app.get('/api/scodes', (req, res) => res.json(store.scodes()));
}

// ── /api/forms/:file ───────────────────────────────────────────────────────

function registerFormRoutes(app, { location }) {
  app.get('/api/forms/:file', (req, res) => {
    const f = req.params.file;
    if (f.includes('..') || f.includes('/') || f.includes('\\')) {
      req.log.warn({ file: f }, 'rejected form request with traversal');
      return res.status(400).send('invalid');
    }
    // Über location und nicht über config: der Pfad kann sich zur
    // Laufzeit ändern, und Anhänge müssen demselben Stand folgen wie die
    // Suche.
    const p = path.join(location.formulareDir, f);
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

function registerUpdatesRoute(app, { location }) {
  app.get('/api/updates', (req, res) => {
    if (!fs.existsSync(location.updateDir)) return res.json([]);
    const items = fs.readdirSync(location.updateDir)
      .filter(f => /^FO_Inhalt\d+\.dbf$/i.test(f))
      .map(f => {
        const s = fs.statSync(path.join(location.updateDir, f));
        return { file: f, mtime: s.mtime, size: s.size };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
    res.json(items);
  });
}

// ── Static UI (SPA fallback) ───────────────────────────────────────────────

function registerStaticUi(app, dist) {
  if (!fs.existsSync(dist)) return;
  app.use(express.static(dist));
  // SPA route fallback: any non-/api path serves the React index.
  app.get(/^(?!\/api).*/, (req, res) =>
    res.sendFile(path.join(dist, 'index.html')),
  );
}

module.exports = { buildApp };
