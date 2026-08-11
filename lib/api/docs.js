/**
 * Swagger UI for the JSON API.
 *
 * The assets come from the `swagger-ui-dist` package and are served from
 * disk, never from a CDN: neo-KIAS usually runs in a workshop network
 * without internet access, and the container must not depend on one.
 * Only the two files the page actually needs are exposed, not the whole
 * package directory (which also contains source maps and alternative
 * bundles).
 *
 * Mounted before the "still loading" gate, so the documentation is
 * readable while the DBF files are still being parsed.
 *
 * @module api/docs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('./openapi');

/** Files of swagger-ui-dist we hand out, mapped to their content type. */
const ASSETS = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
};

/**
 * Minimal Swagger UI host page. Deliberately hand-written instead of the
 * one shipped by swagger-ui-dist, which points at the demo petstore API.
 *
 * @param {string} title
 * @returns {string}
 */
function indexHtml(title) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
    .swagger-ui .info { margin: 24px 0; }
  </style>
</head>
<body>
  <div id="swagger"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger',
      deepLinking: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;
}

/**
 * Register `/api/docs`, its spec and its assets.
 *
 * @param {import('express').Express} app
 * @param {{ config: import('../config') }} deps
 */
function registerDocsRoutes(app, { config }) {
  let distDir;
  try {
    distDir = require('swagger-ui-dist').getAbsoluteFSPath();
  } catch {
    distDir = null;
  }

  const spec = buildOpenApiSpec(config);
  const html = indexHtml(`${spec.info.title} ${spec.info.version}`);

  app.get('/api/docs/openapi.json', (req, res) => res.json(spec));

  app.get('/api/docs/:file', (req, res, next) => {
    const type = ASSETS[req.params.file];
    if (!type || !distDir) return next();
    const p = path.join(distDir, req.params.file);
    if (!fs.existsSync(p)) return next();
    res.type(type);
    // The assets are versioned with the package, so they can sit in the
    // browser cache for a while.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(p);
  });

  // Express treats /api/docs and /api/docs/ as the same route, so no
  // redirect is needed. The asset URLs in the page are absolute for the
  // same reason: they must not depend on the trailing slash.
  const page = (req, res) => {
    if (!distDir) {
      return res.status(500).type('text/plain; charset=utf-8').send(
        'swagger-ui-dist ist nicht installiert. Die Spezifikation selbst '
        + 'liegt unter /api/docs/openapi.json.',
      );
    }
    res.type('text/html; charset=utf-8').send(html);
  };
  app.get('/api/docs', page);
}

module.exports = { registerDocsRoutes };
