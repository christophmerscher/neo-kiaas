/**
 * Runtime configuration, parsed once from process.env at startup.
 *
 * All env-var reading lives here so the rest of the codebase deals with a
 * single, well-typed config object rather than reaching into `process.env`
 * scattered through ten files.
 *
 * The config is immutable. Restart the server to pick up new values.
 *
 * @module config
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Minimal .env reader.
 *
 * Under `docker compose` the variables arrive as real environment
 * variables and this is a no-op (the image doesn't even contain a .env,
 * see .dockerignore). Running `npm start` on a host, however, nothing
 * reads the file — which made an app started outside Docker silently
 * ignore the .env sitting right next to it. So parse it here.
 *
 * Real environment variables always win; the file only fills gaps.
 * Comments must be on their own line, matching what compose accepts.
 *
 * @param {string} file
 */
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;  // no .env is the normal case in the container
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] != null) continue;
    let value = rawValue.trim();
    const quoted = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (value) process.env[key] = value;
  }
}

/** Parse a truthy/falsy string env value. Accepts 1, true, yes, on (case-insensitive). */
function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return /^(?:1|true|yes|on)$/i.test(String(raw).trim());
}

/** Parse a positive integer env value, falling back to a default on missing/invalid. */
function envInt(name, defaultValue) {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

/** Resolve a path-like env value to absolute, or fall back to a computed default. */
function envPath(name, fallback) {
  const raw = process.env[name];
  return raw ? path.resolve(String(raw).trim()) : fallback;
}

/** Project's "host application root" — the kias-web/ directory. */
const APP_DIR = path.resolve(__dirname, '..');

loadEnvFile(path.join(APP_DIR, '.env'));

/**
 * Which half of the application this process runs.
 *
 * - `api` — REST-Schnittstelle: liest die DBF-Daten und beantwortet
 *   `/api/*`. Liefert keine Oberfläche aus.
 * - `web` — React-Oberfläche: liefert `web/dist` aus und reicht `/api/*`
 *   an den API-Dienst weiter. Braucht keine Daten und kein Volume.
 * - `admin` — Vue-Verwaltung: liefert `admin/dist` aus und reicht `/api/*`
 *   weiter. Wie `web`, nur ein anderes Bündel.
 * - `all` — beides in einem Prozess. Voreinstellung, damit `npm start`
 *   und bestehende Einzel-Container unverändert weiterlaufen.
 *
 * Der Umweg über den Weiterleiter im Web-Dienst hat einen Grund: die
 * Oberfläche spricht `/api/...` relativ an. Bliebe das dem Browser
 * überlassen, bräuchte jeder Aufruf eine absolute Adresse, die erst beim
 * Bauen des Bündels feststeht, dazu CORS und einen zweiten offenen Port.
 * So bleibt beides bei einer Herkunft.
 */
function readRole() {
  const raw = (process.env.KIAS_ROLE || 'all').trim().toLowerCase();
  if (raw === '') return 'all';
  if (!['api', 'web', 'admin', 'all'].includes(raw)) {
    throw new Error(
      `KIAS_ROLE="${raw}" is not a known role. `
      + 'Use "api", "web", "admin" or "all".',
    );
  }
  return raw;
}

const ROLE = readRole();

/**
 * Anmeldung an der Verwaltung.
 *
 * Der Benutzername liegt fest. Beim Passwort ist die Voreinstellung mit
 * Absicht schwach und bekannt: die Anwendung soll ohne Konfiguration
 * starten. Damit das nicht unbemerkt in den Betrieb rutscht, merkt sich
 * die Konfiguration, ob noch die Voreinstellung gilt; der Start warnt
 * dann, und die Verwaltung zeigt einen Hinweis.
 */
const ADMIN_USER = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const ADMIN_PASSWORD = process.env.KIAS_ADMIN_PASSWORD
  && process.env.KIAS_ADMIN_PASSWORD.length
  ? process.env.KIAS_ADMIN_PASSWORD
  : DEFAULT_ADMIN_PASSWORD;

/**
 * Data root containing Daten/, Update/, Formulare/ subdirectories.
 *
 * `KIAS_ROOT` is what the app itself reads and what compose sets inside
 * the container (`/data`). `KIAS_DATA_DIR` is the host path compose
 * mounts there; it is accepted as a fallback so that a .env written for
 * Docker also works when the server is started directly with `npm start`.
 * Last resort is the directory above the app, which is where the data
 * lives in a classic KIAS installation.
 */
const DATA_ROOT = envPath('KIAS_ROOT', envPath('KIAS_DATA_DIR', path.resolve(APP_DIR, '..')));

/**
 * @typedef {Object} AppConfig
 * @property {'api'|'web'|'admin'|'all'} role What this process serves.
 * @property {string} apiUrl         Upstream REST service, used when role is "web" or "admin".
 * @property {boolean} admin         Verwaltung samt /api/admin aktiv.
 * @property {string} adminUser      Fester Benutzername der Verwaltung.
 * @property {string} adminPassword  Passwort der Verwaltung.
 * @property {boolean} adminPasswordIsDefault Noch das voreingestellte Passwort.
 * @property {number} adminSessionHours Gültigkeit einer Anmeldung.
 * @property {string} databaseUrl    Postgres für die Einstellungen, leer = keine.
 * @property {string} appDir         Path to kias-web/ on disk.
 * @property {string} dataRoot       Path to the DBF data root.
 * @property {string} formulareDir   Path to the attached PDFs/forms.
 * @property {string} updateDir      Path to the delta-update DBF files.
 * @property {string} carImagesDir   Path to optional car-photo PNG/WebP files.
 * @property {boolean} showCarImages Feature flag — render images in Fahrzeuge cards.
 * @property {boolean} searchBlobs   Precompute lowercased search blobs (fast, ~100 MB).
 * @property {number} searchCacheSize How many filter combinations to memoize.
 * @property {boolean} history       Track update history / removed bulletins.
 * @property {boolean} apiDocs       Serve the Swagger UI under /api/docs.
 * @property {string} serverName     Human-readable name shown by /api/ping.
 * @property {number} port           HTTP port the server listens on.
 * @property {string} host           Network interface to bind to.
 * @property {string} logLevel       Default log level (info, debug, …).
 * @property {string|null} logDir    Directory for rotated log files (null = stdout-only).
 * @property {string} logFile        Active log filename inside logDir.
 * @property {string} logMaxSize     Rotation size threshold (e.g. "10m").
 * @property {number} logMaxFiles    How many historic files to keep.
 * @property {string|number} logFrequency Rotation frequency (daily | hourly | ms).
 * @property {boolean} logStdout     Mirror logs to stdout in addition to file.
 * @property {boolean} logPretty     Use pino-pretty on stdout (dev only).
 */

/** @type {AppConfig} */
const config = Object.freeze({
  role: ROLE,

  // Ziel des Weiterleiters im Web-Dienst. Im Compose-Netz ist das der
  // Dienstname des API-Containers; ein abschließender Schrägstrich stört
  // nicht, er wird beim Zusammenbauen der Adresse entfernt.
  apiUrl: (process.env.KIAS_API_URL || 'http://rest-kias:5175').trim()
    .replace(/\/+$/, ''),

  appDir: APP_DIR,
  dataRoot: DATA_ROOT,
  formulareDir: path.join(DATA_ROOT, 'Formulare'),
  updateDir: path.join(DATA_ROOT, 'Update'),
  carImagesDir: envPath('KIAS_CAR_IMAGES_DIR', path.join(DATA_ROOT, 'car-images')),
  showCarImages: envBool('KIAS_SHOW_CAR_IMAGES', false),

  // Search tuning. Blobs trade roughly 100 MB of heap for a 2-4x faster
  // cold query; turning them off falls back to the per-field rescan.
  searchBlobs: envBool('KIAS_SEARCH_BLOBS', true),
  searchCacheSize: envInt('KIAS_SEARCH_CACHE', 50),

  // Track what each update file added, changed and removed, so deleted
  // bulletins stay explainable. Costs a little memory and load time.
  history: envBool('KIAS_HISTORY', true),

  // Swagger UI for the JSON API, served locally from swagger-ui-dist.
  apiDocs: envBool('KIAS_API_DOCS', true),

  // Verwaltung. Aus heißt: kein Container, keine `/api/admin`-Endpunkte
  // und kein Weg, die Daten neu einzulesen — der Knopf dafür ist aus der
  // Suchoberfläche verschwunden.
  admin: envBool('KIAS_ADMIN', true),
  // Der Benutzername liegt fest, nur das Passwort ist einstellbar. Ohne
  // Angabe bleibt es „admin"; der Start weist dann im Log darauf hin.
  adminUser: ADMIN_USER,
  adminPassword: ADMIN_PASSWORD,
  adminPasswordIsDefault: ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD,
  // Sitzungsdauer der Verwaltung.
  adminSessionHours: envInt('KIAS_ADMIN_SESSION_HOURS', 8),

  // Postgres für die verstellbaren Einstellungen (bislang nur der
  // Datenpfad). Leer heißt: keine Datenbank, es gilt allein die .env, und
  // die Verwaltung kann den Pfad ansehen, aber nicht dauerhaft ändern.
  databaseUrl: (process.env.DATABASE_URL || '').trim(),

  // Name, unter dem sich der Server in der App zeigt. Sinnvoll, wenn in
  // einem Betrieb mehrere laufen ("Werkstatt Nord", "Ersatzteillager").
  serverName: (process.env.KIAS_SERVER_NAME || '').trim() || os.hostname(),

  port: envInt('PORT', 5175),
  host: process.env.HOST || '0.0.0.0',

  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  logDir: process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : null,
  logFile: process.env.LOG_FILE || 'neo-kias.log',
  logMaxSize: process.env.LOG_MAX_SIZE || '10m',
  logMaxFiles: Math.max(1, envInt('LOG_MAX_FILES', 14)),
  logFrequency: /^\d+$/.test(process.env.LOG_FREQUENCY || '')
    ? Number(process.env.LOG_FREQUENCY)
    : (process.env.LOG_FREQUENCY || 'daily'),
  logStdout: process.env.LOG_STDOUT !== 'false',
  logPretty: envBool('LOG_PRETTY', false),
});

module.exports = config;
