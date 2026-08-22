/**
 * Erkennung und Erreichbarkeit: `/api/ping` und `/api/discover`.
 *
 * Ein HTTP-Endpunkt kann sich nicht selbst finden: wer ihn aufruft, kennt
 * die Adresse bereits. Das Finden im Netz passiert deshalb außerhalb von
 * HTTP (mDNS, Broadcast, Abtasten des Subnetzes), und diese beiden
 * Endpunkte sind das Gegenstück dazu:
 *
 *  - `/api/ping` beantwortet die Frage „antwortet unter dieser Adresse ein
 *    neo-KIAS?" mit möglichst wenig Aufwand. Die App nutzt ihn, um eine
 *    von Hand eingegebene Adresse zu prüfen und um beim Abtasten eines
 *    Subnetzes 254 Adressen schnell zu verwerfen.
 *  - `/api/discover` beantwortet „wer bist du und was kannst du?" und
 *    liefert Name, Version, Kennung und die eigenen Adressen.
 *
 * Beide hängen bewusst vor der 503-Sperre: eine Verbindungsprüfung muss
 * auch dann gelingen, wenn die DBF-Dateien noch eingelesen werden. Das
 * Feld `loaded` sagt der App, ob sie warten muss.
 *
 * @module api/discovery
 */

'use strict';

const crypto = require('crypto');
const os = require('os');

const { version } = require('../../package.json');

/** Kennung des Dienstes. Die App prüft darauf, bevor sie etwas glaubt. */
const SERVICE_ID = 'neo-kias';

/** Fassung des Antwortformats, unabhängig von der Version der Anwendung. */
const DISCOVERY_VERSION = 1;

/**
 * IPv4-Adressen dieses Rechners, ohne Loopback.
 *
 * Hilft der App: hat sie den Server über mDNS oder eine Abtastung
 * gefunden, weiß sie damit auch, unter welchen weiteren Adressen er
 * erreichbar ist, etwa in einem zweiten Netz.
 *
 * @returns {Array<{address:string, iface:string}>}
 */
function localAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const [iface, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      out.push({ address: entry.address, iface });
    }
  }
  return out;
}

/**
 * Stabile Kennung dieser Installation.
 *
 * Abgeleitet aus Rechnername, Port und Datenwurzel, also ohne Datei, die
 * geschrieben und gesichert werden müsste. Über Neustarts hinweg gleich,
 * zwischen zwei Installationen verschieden. Die App merkt sich damit
 * einen Server auch dann wieder, wenn sich seine IP geändert hat.
 *
 * @param {import('../config')} config
 * @returns {string}
 */
function instanceId(config) {
  return crypto
    .createHash('sha256')
    .update(`${os.hostname()}|${config.port}|${config.dataRoot}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * @param {import('express').Express} app
 * @param {{ config: import('../config'), store: import('../data/Store').Store }} deps
 */
function registerDiscoveryRoutes(app, { config, store }) {
  const id = instanceId(config);

  // Beide Antworten dürfen nicht aus einem Zwischenspeicher kommen: sie
  // sagen etwas über den Zustand *jetzt* aus.
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

  // Klein halten: beim Abtasten eines Subnetzes fallen bis zu 254 Anfragen
  // an, und das Ergebnis wird nur auf „antwortet da jemand" geprüft.
  app.get('/api/ping', (req, res) => {
    noStore(res);
    res.json({
      pong: true,
      service: SERVICE_ID,
      version,
      loaded: Boolean(store.data),
    });
  });

  app.get('/api/discover', (req, res) => {
    noStore(res);
    const stats = store.stats();
    res.json({
      service: SERVICE_ID,
      discoveryVersion: DISCOVERY_VERSION,
      name: config.serverName,
      instanceId: id,
      version,
      api: { base: '/api', docs: config.apiDocs ? '/api/docs' : null },
      features: {
        carImages: config.showCarImages,
        history: config.history,
        apiDocs: config.apiDocs,
      },
      data: {
        loaded: stats.loaded,
        loading: stats.loading,
        rootOk: store.hasDataRoot(),
        bulletins: stats.counts.aktion ?? 0,
        loadedAt: stats.loadedAt,
      },
      server: {
        port: config.port,
        // Absichtlich ohne Pfad der Datenwurzel: die Antwort ist
        // unauthentifiziert, und wo die Daten liegen geht niemanden im
        // Netz etwas an.
        addresses: localAddresses(),
      },
      time: new Date().toISOString(),
    });
  });
}

module.exports = {
  registerDiscoveryRoutes,
  localAddresses,
  instanceId,
  SERVICE_ID,
  DISCOVERY_VERSION,
};
