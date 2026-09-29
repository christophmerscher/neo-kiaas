/**
 * Verwaltung: Anmeldung, Datenpfad, Neu-Einlesen.
 *
 * Diese Endpunkte gehören zum REST-Dienst, weil dort die Daten liegen.
 * Die Vue-Oberfläche ist nur ihr Bedienteil und reicht die Aufrufe weiter.
 *
 * Sie hängen bewusst **vor** der 503-Sperre der Datenendpunkte: gerade
 * wenn nichts geladen ist, weil der Pfad falsch steht, muss man sich
 * anmelden und ihn richtigstellen können.
 *
 * Ein Benutzer, ein Passwort, kein Rollenwerk. Mehr braucht eine
 * Werkstatt nicht, und alles darüber hinaus wäre eine Benutzerverwaltung,
 * die niemand pflegen will.
 *
 * @module api/admin
 */

'use strict';

const crypto = require('crypto');
const { inspectDataRoot } = require('../data/inspectDataRoot');
const { KEYS } = require('../data/SettingsStore');

/** Name des Sitzungskekses. */
const COOKIE = 'kias_admin';

/**
 * Vergleich, dessen Dauer nicht vom Inhalt abhängt.
 *
 * Ein `===` verrät über die Laufzeit, wie viele Zeichen am Anfang
 * stimmen. Bei einem Passwort, das über das Netz geraten werden kann,
 * ist das ein Beitrag, den man leicht vermeidet.
 *
 * @param {string} a
 * @param {string} b
 */
function sameSecret(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  // timingSafeEqual verlangt gleiche Länge; die Länge selbst ist kein
  // Geheimnis, deshalb darf sie vorab entscheiden.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Kekse aus der Kopfzeile lesen, ohne Zusatzpaket. */
function readCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Anmeldungen dieses Prozesses.
 *
 * Im Speicher und nicht in Postgres: ein Neustart des Dienstes meldet
 * alle ab, was bei einer Verwaltung eher erwünscht als lästig ist, und
 * es liegt kein Sitzungsschlüssel dauerhaft irgendwo herum.
 */
class Sessions {
  constructor(hours) {
    this.ttlMs = Math.max(1, hours) * 3600_000;
    /** @type {Map<string, number>} Schlüssel auf Ablaufzeit. */
    this.tokens = new Map();
  }

  create() {
    this.sweep();
    const token = crypto.randomBytes(32).toString('base64url');
    this.tokens.set(token, Date.now() + this.ttlMs);
    return token;
  }

  valid(token) {
    if (!token) return false;
    const until = this.tokens.get(token);
    if (!until) return false;
    if (until < Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  drop(token) {
    if (token) this.tokens.delete(token);
  }

  sweep() {
    const now = Date.now();
    for (const [token, until] of this.tokens) if (until < now) this.tokens.delete(token);
  }
}

/**
 * Verwaltungsendpunkte anhängen.
 *
 * @param {import('express').Express} app
 * @param {Object} deps
 * @param {import('../config')} deps.config
 * @param {import('pino').BaseLogger} deps.logger
 * @param {import('../data/Store').Store} deps.store
 * @param {import('../data/DataLocation').DataLocation} deps.location
 * @param {import('../data/SettingsStore').SettingsStore} deps.settings
 * @returns {{ requireAdmin: import('express').RequestHandler }}
 */
function registerAdminRoutes(app, { config, logger, store, location, settings }) {
  const sessions = new Sessions(config.adminSessionHours);

  /**
   * Zugang prüfen: entweder die Sitzung aus der Oberfläche oder HTTP
   * Basic, damit ein `curl -u admin:…` aus einem Skript weiter geht.
   */
  const requireAdmin = (req, res, next) => {
    if (sessions.valid(readCookies(req)[COOKIE])) return next();

    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const [user, ...rest] = Buffer.from(header.slice(6), 'base64')
        .toString('utf8').split(':');
      const password = rest.join(':');
      if (sameSecret(user, config.adminUser) && sameSecret(password, config.adminPassword)) {
        return next();
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="neo-KIAS", charset="UTF-8"');
    res.status(401).json({ error: 'unauthorized', message: 'Anmeldung erforderlich.' });
  };

  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

  // ── Anmeldung ─────────────────────────────────────────────────────────

  app.post('/api/admin/login', (req, res) => {
    const { user, password } = req.body || {};
    const ok = sameSecret(user || '', config.adminUser)
      && sameSecret(password || '', config.adminPassword);
    if (!ok) {
      req.log.warn({ user }, 'admin login rejected');
      // Absichtlich ohne Hinweis darauf, was falsch war.
      return res.status(401).json({ error: 'unauthorized', message: 'Benutzer oder Passwort stimmt nicht.' });
    }
    const token = sessions.create();
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.adminSessionHours * 3600_000,
    });
    req.log.info('admin logged in');
    noStore(res);
    res.json({
      authenticated: true,
      user: config.adminUser,
      defaultPassword: config.adminPasswordIsDefault,
    });
  });

  app.post('/api/admin/logout', (req, res) => {
    sessions.drop(readCookies(req)[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    noStore(res);
    res.json({ authenticated: false });
  });

  app.get('/api/admin/session', (req, res) => {
    noStore(res);
    res.json({
      authenticated: sessions.valid(readCookies(req)[COOKIE]),
      user: config.adminUser,
      defaultPassword: config.adminPasswordIsDefault,
    });
  });

  // ── Zustand ───────────────────────────────────────────────────────────

  app.get('/api/admin/state', requireAdmin, (req, res) => {
    noStore(res);
    const stats = store.stats();
    res.json({
      version: require('../../package.json').version,
      serverName: config.serverName,
      data: {
        root: location.root,
        source: location.source,
        envRoot: config.dataRoot,
        looksLikeKias: location.looksLikeKias,
        loaded: stats.loaded,
        loading: stats.loading,
        progress: stats.progress,
        loadedAt: stats.loadedAt,
        bulletins: stats.counts.aktion ?? 0,
        fingerprint: store.fingerprint
          ? { digest: store.fingerprint.digest.slice(0, 12), files: store.fingerprint.files }
          : null,
        // Was der letzte Lesevorgang gefunden hat und was nicht. Ohne das
        // steht in der Verwaltung nur "0 Aktionen", und die Frage nach dem
        // Warum führt ins Protokoll statt auf den Bildschirm.
        read: store.lastRead ? store.lastRead.toJSON() : null,
      },
      settings: settings.status(),
      features: {
        carImages: config.showCarImages,
        history: config.history,
        apiDocs: config.apiDocs,
      },
      defaultPassword: config.adminPasswordIsDefault,
    });
  });

  // ── Datenpfad ─────────────────────────────────────────────────────────

  app.post('/api/admin/data-root/test', requireAdmin, (req, res) => {
    const wanted = (req.body && req.body.path) || location.root;
    const report = inspectDataRoot(wanted);
    // Die gescheiterten Prüfungen mitschreiben und nicht nur "ok: false":
    // welcher Teil gefehlt hat, ist die ganze Auskunft.
    req.log[report.ok ? 'info' : 'warn'](
      {
        path: report.root,
        ok: report.ok,
        summary: report.summary,
        failed: report.checks.filter(c => !c.ok).map(c => `${c.name}: ${c.detail}`),
      },
      'data root tested',
    );
    noStore(res);
    res.json(report);
  });

  app.put('/api/admin/data-root', requireAdmin, async (req, res) => {
    const wanted = (req.body && req.body.path) || '';
    const report = inspectDataRoot(wanted);
    if (!report.ok) {
      // Kein unbrauchbarer Pfad in der Datenbank: sonst startet der
      // Dienst beim nächsten Mal ins Leere und niemand weiß, warum.
      return res.status(400).json({
        error: 'unusable',
        message: report.summary,
        report,
      });
    }

    try {
      await settings.set(KEYS.DATA_ROOT, report.root, config.adminUser);
    } catch (err) {
      return res.status(503).json({ error: 'not-saved', message: err.message, report });
    }

    const changed = store.setRoot(report.root);
    location.set(report.root, 'db');
    req.log.warn(
      { path: report.root, changed, summary: report.summary },
      'data root saved',
    );

    // Ein neuer Pfad ohne Einlesen wäre ein halber Wechsel: die Suche
    // zeigte weiter den alten Bestand. Deshalb sofort laden, aber ohne
    // die Antwort daran zu hängen — das dauert Minuten.
    const reload = req.body && req.body.reload === false ? false : true;
    if (reload) {
      store.load({ trigger: 'root-change' })
        .catch(err => req.log.error({ err: err.message }, 'load after root change failed'));
    }

    noStore(res);
    res.json({ ok: true, root: report.root, source: 'db', reloading: reload, report });
  });

  // ── Neu einlesen ──────────────────────────────────────────────────────

  app.post('/api/admin/reload', requireAdmin, async (req, res) => {
    const force = String(req.query.force || (req.body && req.body.force) || '') === 'true';
    req.log.warn({ force, root: location.root }, 'reload requested from the admin UI');
    const t0 = Date.now();
    const reload = await store.reloadIfChanged({ force, trigger: 'admin' });
    const read = store.lastRead;
    req.log.info(
      { ms: Date.now() - t0, ...reload, read: read ? read.toLog() : null },
      `reload finished${read ? ': ' + read.summary : ''}`,
    );
    noStore(res);
    res.json({ ...store.stats(), reload, read: read ? read.toJSON() : null });
  });

  if (config.adminPasswordIsDefault) {
    logger.warn(
      { user: config.adminUser },
      'the admin UI still uses the default password — set KIAS_ADMIN_PASSWORD',
    );
  }

  return { requireAdmin };
}

module.exports = { registerAdminRoutes };
