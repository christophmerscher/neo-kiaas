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

/** Data root containing Daten/, Update/, Formulare/ subdirectories. */
const DATA_ROOT = envPath('KIAS_ROOT', path.resolve(APP_DIR, '..'));

/**
 * @typedef {Object} AppConfig
 * @property {string} appDir         Path to kias-web/ on disk.
 * @property {string} dataRoot       Path to the DBF data root.
 * @property {string} formulareDir   Path to the attached PDFs/forms.
 * @property {string} updateDir      Path to the delta-update DBF files.
 * @property {string} carImagesDir   Path to optional car-photo PNG/WebP files.
 * @property {boolean} showCarImages Feature flag — render images in Fahrzeuge cards.
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
  appDir: APP_DIR,
  dataRoot: DATA_ROOT,
  formulareDir: path.join(DATA_ROOT, 'Formulare'),
  updateDir: path.join(DATA_ROOT, 'Update'),
  carImagesDir: envPath('KIAS_CAR_IMAGES_DIR', path.join(DATA_ROOT, 'car-images')),
  showCarImages: envBool('KIAS_SHOW_CAR_IMAGES', false),

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
