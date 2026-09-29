/**
 * Protokoll eines Lesevorgangs.
 *
 * Der Lader überliest ein fehlendes oder unlesbares DBF stillschweigend und
 * liefert eine leere Liste. Das ist richtig so, eine halbe Datenbank ist
 * besser als gar keine, aber es hat einen Preis: ein falscher Datenpfad
 * sieht danach genauso aus wie ein erfolgreicher Lauf über eine leere
 * Datenbank. „0 Aktionen" und nirgends ein Fehler, und die Suche nach der
 * Ursache beginnt bei null.
 *
 * Dieses Protokoll ist die Gegenrechnung. Es hält fest, was gelesen werden
 * sollte, was davon da war, was sich nicht lesen ließ und warum. Es geht
 * ins Protokoll, es hängt am Store, und die Verwaltung zeigt es an. Wer
 * das nächste Mal vor einem leeren Bestand steht, sieht in einem Satz, ob
 * das Verzeichnis fehlte, ob die Rechte nicht reichten oder ob die Daten
 * tatsächlich leer sind.
 *
 * @module data/ReadReport
 */

'use strict';

/**
 * @typedef {Object} DirInfo
 * @property {string} path
 * @property {'ok'|'missing'|'unreadable'} status
 * @property {number} files   Gezählte Einträge, 0 wenn nicht lesbar.
 * @property {string} [error] Meldung des Betriebssystems.
 * @property {string} [code]  errno-Kürzel, etwa ENOENT oder EACCES.
 */

/**
 * @typedef {Object} TableInfo
 * @property {string} table   Name im Bestand, etwa "aktion".
 * @property {string} file    Basisdatei, etwa FO_AKTION.DBF.
 * @property {'ok'|'missing'|'error'} status
 * @property {number} records Datensätze aus der Basisdatei.
 * @property {number} updates Angewandte Update-Dateien.
 * @property {number} merged  Datensätze nach dem Zusammenführen.
 * @property {number} ms
 * @property {string} [error]
 * @property {string} [code]
 */

/**
 * @typedef {Object} Problem
 * @property {'warn'|'error'} level
 * @property {string} file
 * @property {'missing'|'unreadable'|'error'} kind
 * @property {string} detail
 * @property {string} [code]
 */

/** Zahl mit Tausenderpunkten, für Sätze die Menschen lesen. */
function num(value) {
  return Number(value || 0).toLocaleString('de-DE');
}

class ReadReport {
  /** @param {string} root Datenwurzel, aus der gelesen wird. */
  constructor(root) {
    /** @type {string} */
    this.root = root;
    /** @type {string} */
    this.startedAt = new Date().toISOString();
    /** @type {number} */
    this.ms = 0;
    /** @type {Record<string, DirInfo>} */
    this.dirs = {};
    /** @type {TableInfo[]} */
    this.tables = [];
    /** @type {Problem[]} */
    this.problems = [];
    /** @type {{read:number, missing:number, failed:number}} Basisdateien. */
    this.files = { read: 0, missing: 0, failed: 0 };
    /** @type {number} Datensätze über alle Tabellen nach dem Zusammenführen. */
    this.records = 0;
    /** @type {string} */
    this.summary = 'Noch nicht gelesen.';

    this._t0 = Date.now();
  }

  /**
   * Ergebnis der Sichtprüfung eines Unterverzeichnisses festhalten.
   *
   * @param {string} name Daten, Update oder Formulare.
   * @param {DirInfo} info
   */
  addDir(name, info) {
    this.dirs[name] = info;
    if (info.status === 'missing') {
      this.problems.push({
        level: name === 'Daten' ? 'error' : 'warn',
        file: `${name}/`,
        kind: 'missing',
        detail: 'Verzeichnis fehlt.',
        code: info.code,
      });
    } else if (info.status === 'unreadable') {
      this.problems.push({
        level: 'error',
        file: `${name}/`,
        kind: 'unreadable',
        detail: info.error || 'Nicht lesbar.',
        code: info.code,
      });
    }
  }

  /**
   * Eine gelesene (oder eben nicht gelesene) Basistabelle festhalten.
   *
   * @param {TableInfo} info
   */
  addTable(info) {
    this.tables.push(info);
    this.records += info.merged || 0;
    if (info.status === 'ok') this.files.read++;
    if (info.status === 'missing') {
      this.files.missing++;
      this.problems.push({
        level: 'warn',
        file: info.file,
        kind: 'missing',
        detail: 'Basisdatei nicht vorhanden.',
      });
    }
    if (info.status === 'error') {
      this.files.failed++;
      this.problems.push({
        level: 'error',
        file: info.file,
        kind: 'error',
        detail: info.error || 'Lesen fehlgeschlagen.',
        code: info.code,
      });
    }
  }

  /**
   * Eine einzelne Update-Datei, die sich nicht anwenden ließ.
   *
   * @param {string} file
   * @param {Error & {code?:string}} err
   */
  addUpdateFailure(file, err) {
    this.problems.push({
      level: 'warn',
      file,
      kind: 'error',
      detail: err.message,
      code: err.code,
    });
  }

  /** Ist überhaupt etwas herausgekommen? */
  get ok() {
    return this.records > 0 && this.files.failed === 0;
  }

  /** Abschließen und den Satz bilden, der im Protokoll und in der Verwaltung steht. */
  finish() {
    this.ms = Date.now() - this._t0;

    const daten = this.dirs.Daten;
    if (daten && daten.status === 'missing') {
      this.summary = 'Kein Verzeichnis Daten/ unter dem Datenpfad. '
        + 'Es wurde nichts gelesen, der Bestand bleibt leer.';
    } else if (daten && daten.status === 'unreadable') {
      this.summary = `Daten/ ist nicht lesbar (${daten.error}). Der Bestand bleibt leer.`;
    } else if (this.files.read === 0) {
      this.summary = 'Keine einzige Basistabelle gefunden. Unter Daten/ liegen '
        + 'die erwarteten DBF-Dateien nicht.';
    } else if (this.records === 0) {
      this.summary = `${this.files.read} Basistabellen gelesen, aber ohne einen `
        + 'einzigen Datensatz.';
    } else if (this.files.failed > 0) {
      this.summary = `${num(this.records)} Datensätze gelesen, `
        + `${this.files.failed} Datei(en) ließen sich nicht lesen.`;
    } else if (this.files.missing > 0) {
      this.summary = `${num(this.records)} Datensätze gelesen, `
        + `${this.files.missing} Basisdatei(en) fehlen.`;
    } else {
      this.summary = `${num(this.records)} Datensätze aus ${this.files.read} Tabellen gelesen.`;
    }
    return this;
  }

  /**
   * Kurzfassung für eine Protokollzeile. Die volle Tabellenliste bläht
   * jede Zeile auf, ohne dass sie jemand liest; die Probleme dagegen sind
   * genau das, wonach später gesucht wird.
   */
  toLog() {
    return {
      root: this.root,
      ms: this.ms,
      records: this.records,
      files: this.files,
      dirs: Object.fromEntries(
        Object.entries(this.dirs).map(([name, info]) => [name, info.status]),
      ),
      problems: this.problems.length,
      firstProblem: this.problems.length
        ? `${this.problems[0].file}: ${this.problems[0].detail}`
        : null,
    };
  }

  /** Vollständige Fassung für die Verwaltung. */
  toJSON() {
    return {
      root: this.root,
      startedAt: this.startedAt,
      ms: this.ms,
      ok: this.ok,
      summary: this.summary,
      dirs: this.dirs,
      files: this.files,
      records: this.records,
      problems: this.problems,
      tables: this.tables,
    };
  }
}

module.exports = { ReadReport };
