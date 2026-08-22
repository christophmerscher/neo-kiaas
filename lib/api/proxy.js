/**
 * Weiterleitung von `/api/*` an den REST-Dienst.
 *
 * Nur der Web-Dienst benutzt sie. Die Oberfläche spricht ihre Endpunkte
 * relativ an (`/api/bulletins`), also muss unter derselben Herkunft etwas
 * antworten. Statt das Bündel mit einer absoluten Adresse zu bauen und
 * CORS zu öffnen, reicht dieser Prozess die Anfrage weiter.
 *
 * Bewusst ohne Fremdpaket: Node kann HTTP-Ströme selbst verbinden, und
 * ein durchgereichter Strom hält auch PDF-Anhänge und Fahrzeugbilder
 * unverändert, ohne sie vorher in den Speicher zu legen.
 *
 * @module api/proxy
 */

'use strict';

const http = require('http');
const https = require('https');

/**
 * Frist für eine weitergeleitete Anfrage.
 *
 * Großzügig, weil `POST /api/reload` im schlimmsten Fall den kompletten
 * DBF-Bestand neu liest; das dauert auf langsamen Datenträgern Minuten.
 * Eine Frist muss es trotzdem geben, sonst hängen Verbindungen für immer,
 * wenn der API-Dienst mitten in der Antwort verschwindet.
 */
const PROXY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Kopfzeilen, die zur einzelnen Verbindung gehören und deshalb nicht
 * weitergereicht werden dürfen (RFC 9110, hop-by-hop).
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Kopfzeilen für die Anfrage an den API-Dienst zusammenstellen.
 *
 * `host` fällt weg, damit Node den des Ziels einsetzt. Die
 * X-Forwarded-Zeilen sorgen dafür, dass im Protokoll des API-Dienstes die
 * Adresse des Browsers steht und nicht die des Web-Containers.
 *
 * @param {import('express').Request} req
 * @returns {Object}
 */
function forwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name) || name === 'host') continue;
    headers[name] = value;
  }
  const before = req.headers['x-forwarded-for'];
  const from = req.socket.remoteAddress || '';
  headers['x-forwarded-for'] = before ? `${before}, ${from}` : from;
  headers['x-forwarded-proto'] = req.protocol;
  if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
  return headers;
}

/**
 * `/api/*` an den REST-Dienst hängen.
 *
 * @param {import('express').Express} app
 * @param {Object} deps
 * @param {string} deps.target  Basisadresse des API-Dienstes, z. B. http://rest-kias:5175
 * @param {import('pino').BaseLogger} deps.logger
 */
function registerApiProxy(app, { target, logger }) {
  const base = new URL(target);
  const client = base.protocol === 'https:' ? https : http;
  // Ein Ziel darf einen Pfad tragen (hinter einem eigenen Reverse Proxy).
  const prefix = base.pathname.replace(/\/+$/, '');

  app.use('/api', (req, res) => {
    // originalUrl statt url: innerhalb von app.use ist "/api" bereits
    // abgeschnitten, samt Abfragezeichenfolge soll aber alles ankommen.
    const upstreamUrl = new URL(prefix + req.originalUrl, base);

    const upstream = client.request(
      upstreamUrl,
      { method: req.method, headers: forwardHeaders(req) },
      (answer) => {
        const headers = {};
        for (const [name, value] of Object.entries(answer.headers)) {
          if (HOP_BY_HOP.has(name)) continue;
          headers[name] = value;
        }
        res.writeHead(answer.statusCode || 502, headers);
        answer.pipe(res);
      },
    );

    upstream.setTimeout(PROXY_TIMEOUT_MS, () => {
      upstream.destroy(new Error(`no answer within ${PROXY_TIMEOUT_MS} ms`));
    });

    upstream.on('error', (err) => {
      const log = req.log || logger;
      log.warn(
        { err: err.message, target: upstreamUrl.href },
        'upstream API not reachable',
      );
      if (res.headersSent) return res.destroy();
      // 502 und nicht 503: 503 heißt in diesem Projekt „lädt noch", und
      // genau das soll die Oberfläche hier nicht glauben.
      res.status(502).json({
        error: 'upstream',
        message: 'Die REST-Schnittstelle antwortet nicht.',
        target: `${base.protocol}//${base.host}`,
      });
    });

    // Bricht der Browser ab, muss die Anfrage nach oben nicht weiterlaufen.
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });

    req.pipe(upstream);
  });

  logger.info({ target: base.href }, 'proxying /api to the REST service');
}

module.exports = { registerApiProxy };
