/**
 * Erreichbarkeit und Gesundheit: `/api/ping` und `/api/health`.
 *
 * Zwei Endpunkte mit klar verschiedenen Aufgaben:
 *
 *  - `/api/ping` beantwortet „antwortet unter dieser Adresse ein
 *    neo-KIAS?" mit möglichst wenig Aufwand. Die App braucht ihn, um eine
 *    eingegebene Serveradresse zu prüfen, bevor sie weitergeht.
 *  - `/api/health` beantwortet „ist dieser Server benutzbar?" und ist für
 *    Überwachung und Betrieb gedacht: Docker-Healthcheck heute, ein
 *    vorgeschalteter Load Balancer, sobald die Schnittstelle getrennt von
 *    der Suchoberfläche läuft. Er antwortet mit 200 nur dann, wenn Daten
 *    geladen sind, sonst mit 503.
 *
 * Beide hängen vor der 503-Sperre der Datenendpunkte, sonst könnte weder
 * die App noch die Überwachung feststellen, dass der Server zwar lebt,
 * aber noch einliest.
 *
 * @module api/health
 */

'use strict';

const { version } = require('../../package.json');

/** Kennung des Dienstes. Die App prüft darauf, bevor sie etwas glaubt. */
const SERVICE_ID = 'neo-kias';

/**
 * @param {import('express').Express} app
 * @param {{ config: import('../config'), store: import('../data/Store').Store }} deps
 */
function registerHealthRoutes(app, { config, store }) {
  const startedAt = Date.now();

  // Beide Antworten beschreiben den Zustand *jetzt* und dürfen nicht aus
  // einem Zwischenspeicher kommen.
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

  // Klein halten: wer eine Adresse sucht, schickt viele solcher Anfragen.
  app.get('/api/ping', (req, res) => {
    noStore(res);
    res.json({
      pong: true,
      service: SERVICE_ID,
      name: config.serverName,
      version,
      loaded: Boolean(store.data),
    });
  });

  app.get('/api/health', (req, res) => {
    noStore(res);
    const stats = store.stats();
    const rootOk = store.hasDataRoot();

    // Ohne Datenwurzel läuft der Server zwar, kann aber nie etwas
    // ausliefern; das ist ein Fehler und keine Anlaufphase.
    const status = !rootOk
      ? 'unhealthy'
      : stats.loaded
        ? 'ok'
        : 'starting';

    res.status(status === 'ok' ? 200 : 503).json({
      status,
      service: SERVICE_ID,
      version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      checks: {
        dataRoot: {
          ok: rootOk,
          detail: rootOk ? null : 'Unter der Datenwurzel fehlt Daten/',
        },
        data: {
          ok: stats.loaded,
          loading: stats.loading,
          bulletins: stats.counts.aktion ?? 0,
          loadedAt: stats.loadedAt,
        },
      },
    });
  });
}

module.exports = { registerHealthRoutes, SERVICE_ID };
