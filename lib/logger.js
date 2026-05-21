/**
 * Application logger built on top of pino, optionally writing to rotating
 * files via pino-roll.
 *
 * Two transport targets can run simultaneously: stdout (so `docker logs`
 * keeps working) and a date/size-rotating file in {@link config.logDir}.
 * If file logging can't initialise (missing dir, permission error), we
 * fall back to stdout-only so the server still boots.
 *
 * Configuration is taken from {@link module:config} — see that module for
 * the list of `LOG_*` env vars.
 *
 * @module logger
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('./config');

const VALID_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/** Coerce an arbitrary string to a valid pino level, falling back to "info". */
function safeLevel(input) {
  const level = String(input || 'info').toLowerCase();
  return VALID_LEVELS.includes(level) ? level : 'info';
}

/** Build the array of pino transport targets based on the active config. */
function buildTargets(level) {
  /** @type {Array<{target: string, level: string, options: object}>} */
  const targets = [];

  if (config.logStdout) {
    targets.push(config.logPretty
      ? {
          target: 'pino-pretty',
          level,
          options: {
            destination: 1,
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : {
          target: 'pino/file',
          level,
          options: { destination: 1 },
        });
  }

  if (config.logDir) {
    try { fs.mkdirSync(config.logDir, { recursive: true }); } catch { /* ignored */ }
    targets.push({
      target: 'pino-roll',
      level,
      options: {
        file: path.join(config.logDir, config.logFile),
        frequency: config.logFrequency,
        size: config.logMaxSize,
        mkdir: true,
        limit: { count: config.logMaxFiles },
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
      },
    });
  }

  return targets;
}

/** Create the singleton logger, with defensive fallback on transport failure. */
function buildLogger() {
  const level = safeLevel(config.logLevel);
  const targets = buildTargets(level);

  if (targets.length === 0) {
    return pino({ level });
  }

  try {
    const transport = pino.transport({ targets });
    return pino({ level, base: { app: 'neo-kias' } }, transport);
  } catch (err) {
    const fallback = pino({ level });
    fallback.error({ err: err.message }, 'Failed to start file logger, using stdout only');
    return fallback;
  }
}

const logger = buildLogger();

// Expose the resolved config so callers can include it in startup messages
// for easy debugging ("what's my actual log dir?").
logger.kiasConfig = {
  level: safeLevel(config.logLevel),
  dir: config.logDir,
  file: config.logFile,
  maxSize: config.logMaxSize,
  maxFiles: config.logMaxFiles,
  frequency: config.logFrequency,
  stdout: config.logStdout,
};

module.exports = logger;
