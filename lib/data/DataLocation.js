/**
 * Wo die KIAS-Daten liegen — zur Laufzeit umstellbar.
 *
 * Bisher stand der Pfad in der eingefrorenen Konfiguration. Seit die
 * Verwaltung ihn ändern darf, braucht es eine Stelle, die alle Beteiligten
 * gemeinsam lesen: Store, `/api/status` und die Endpunkte für Formulare
 * und Updates. Sonst liest die Suche nach einem Wechsel aus dem neuen
 * Verzeichnis, während die Anhänge noch aus dem alten kommen.
 *
 * @module data/DataLocation
 */

'use strict';

const fs = require('fs');
const path = require('path');

class DataLocation {
  /**
   * @param {string} root Verzeichnis mit Daten/, Update/ und Formulare/.
   * @param {'env'|'db'} [source] Woher der Pfad stammt, für die Anzeige.
   */
  constructor(root, source = 'env') {
    this.set(root, source);
  }

  /**
   * @param {string} root
   * @param {'env'|'db'} source
   */
  set(root, source) {
    this.root = path.resolve(root);
    this.source = source;
    this.datenDir = path.join(this.root, 'Daten');
    this.formulareDir = path.join(this.root, 'Formulare');
    this.updateDir = path.join(this.root, 'Update');
  }

  /** Ob unter dem Pfad ein `Daten/` liegt. */
  get looksLikeKias() {
    return fs.existsSync(this.datenDir);
  }

  /** Kurzfassung für `/api/status` und die Verwaltung. */
  describe() {
    return { root: this.root, source: this.source };
  }
}

module.exports = { DataLocation };
