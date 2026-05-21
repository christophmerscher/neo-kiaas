/**
 * Express middleware factories.
 *
 * @module api/middleware
 */

'use strict';

const pinoHttp = require('pino-http');

/**
 * Normalise common IP forms (IPv4-mapped IPv6, loopback) for cleaner logs.
 * @param {string|undefined|null} ip
 * @returns {string}
 */
function cleanIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/**
 * Extract the most reliable caller IP we can. Prefer X-Forwarded-For (left
 * entry = original client when behind a proxy), then X-Real-IP, then the
 * raw socket address. Works on both the Express req and the raw
 * IncomingMessage that pino-http hands to its callbacks.
 *
 * @param {import('http').IncomingMessage & {ip?:string}} req
 * @returns {string}
 */
function callerIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return cleanIp(String(fwd).split(',')[0].trim());
  if (req.headers && req.headers['x-real-ip']) return cleanIp(req.headers['x-real-ip']);
  if (req.ip) return cleanIp(req.ip);
  if (req.socket && req.socket.remoteAddress) return cleanIp(req.socket.remoteAddress);
  return 'unknown';
}

/**
 * Build the pino-http middleware. One JSON line per request with method,
 * URL, status, duration and caller IP — both inside a structured `req`
 * object and as a human-readable `msg` suffix.
 *
 * Static asset requests are skipped because they're noisy and not
 * interesting from an audit perspective.
 *
 * @param {import('pino').BaseLogger} logger
 * @returns {import('express').RequestHandler}
 */
function buildHttpLogger(logger) {
  return pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage(req, res) {
      return `${callerIp(req)} ${req.method} ${req.originalUrl || req.url} -> ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${callerIp(req)} ${req.method} ${req.originalUrl || req.url} -> ${res.statusCode}: ${err && err.message}`;
    },
    // Inject audit fields at the top level so log aggregators can index
    // them without digging into the nested `req` object.
    customProps(req /* , res */) {
      const fwd = req.headers['x-forwarded-for'];
      return {
        remoteIp: callerIp(req),
        forwardedFor: fwd || undefined,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
      };
    },
    autoLogging: {
      ignore(req) {
        return req.url && /\.(?:js|css|map|png|svg|ico|woff2?)(\?|$)/i.test(req.url);
      },
    },
  });
}

module.exports = { buildHttpLogger, callerIp, cleanIp };
