/**
 * In-memory KIAS dataset.
 *
 * The {@link Store} class is responsible for the data lifecycle only:
 *   - Loading DBF files and applying delta updates ({@link load})
 *   - Rebuilding lookup indexes after each load
 *   - Reporting stats for `/api/status`
 *   - Providing flat accessors for vehicles, scodes, and a single bulletin
 *
 * Querying / searching lives in {@link module:search/SearchEngine}; reference
 * resolution lives in {@link module:search/ReferenceResolver}. They both
 * take a Store instance via their constructors (dependency injection),
 * which keeps Store free of any HTTP/search concerns and makes both
 * collaborators trivial to unit-test with a stub Store.
 *
 * @module data/Store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadAll } = require('../loader');
const { createYielder } = require('../cooperative');
const { buildIndexes } = require('./Indexes');
const { attachSearchBlobs } = require('./SearchBlob');
const { buildHistory } = require('./History');
const { fingerprintDataDir } = require('./DataFingerprint');
const { ReadReport } = require('./ReadReport');

class Store {
  /**
   * @param {string} rootDir Absolute path to the directory containing
   *   Daten/, Update/ and Formulare/.
   * @param {{ logger?: import('pino').BaseLogger, searchBlobs?: boolean, history?: boolean }} [opts]
   */
  constructor(rootDir, { logger, searchBlobs = true, history = true } = {}) {
    /** @type {string} */
    this.rootDir = rootDir;
    /** @type {import('./Indexes').StoreData | null} */
    this.data = null;
    /** @type {import('./Indexes').StoreIndexes | null} */
    this.indexes = null;
    /** @type {Date | null} */
    this.loadedAt = null;
    /** @type {Promise<void> | null} In-flight load, deduplicates concurrent reloads. */
    this.loading = null;
    /**
     * Progress info while a load is in flight, exposed via stats() so the
     * frontend can render a loading screen. Null when no load is running.
     * @type {{ stage: string, name: string, current: number, total: number, startedAt: number } | null}
     */
    this.progress = null;
    /** @type {import('pino').BaseLogger | null} */
    this.logger = logger || null;
    /**
     * Precompute the derived search column. Off trades query speed for
     * roughly 100 MB of heap; the search engine handles both cases.
     * @type {boolean}
     */
    this.searchBlobs = searchBlobs;
    /**
     * Track what each update file added, changed and removed. Off means
     * deleted bulletins leave no trace, exactly as before.
     * @type {boolean}
     */
    this.trackHistory = history;
    /**
     * Result of {@link module:data/History.buildHistory}, or null when
     * tracking is off or no load has happened yet.
     * @type {{updates:Array<object>, removedByCode:Map<string,object>, totals:object} | null}
     */
    this.history = null;
    /**
     * Bumped on every completed load. Collaborators that cache derived
     * results (e.g. SearchEngine) compare against it to know when their
     * cache went stale.
     * @type {number}
     */
    this.version = 0;
    /**
     * Fingerprint of the data files as of the last completed load, see
     * {@link module:data/DataFingerprint}. Lets a reload request tell
     * "someone changed the data" apart from "someone pressed the button".
     * @type {{digest:string, files:number, ms:number} | null}
     */
    this.fingerprint = null;
    /**
     * Protokoll des letzten Lesevorgangs: welche Verzeichnisse und Dateien
     * gefunden wurden und woran es gescheitert ist. Bleibt auch stehen,
     * wenn der Lauf nichts gefunden hat, denn genau dann wird es gebraucht.
     * @type {ReadReport | null}
     */
    this.lastRead = null;
  }

  /**
   * Read all DBF files, apply deltas, and rebuild indexes.
   *
   * Concurrent callers share the same promise so we never start two loads
   * in parallel.
   *
   * @param {{ trigger?: string }} [opts] Wer das Lesen ausgelöst hat.
   *   Steht so im Protokoll und beantwortet später die Frage, ob der
   *   leere Bestand vom Start kam oder von einem Knopfdruck.
   * @returns {Promise<void>}
   */
  async load({ trigger = 'unknown' } = {}) {
    if (this.loading) return this.loading;
    const startedAt = Date.now();
    this.progress = { stage: 'starting', name: '', current: 0, total: 1, startedAt };
    this.loading = (async () => {
      const report = new ReadReport(this.rootDir);
      try {
        if (this.logger) {
          this.logger.info({ root: this.rootDir, trigger }, 'reading the data');
        }
        // Taken before reading, not after: a file that changes while we
        // read must still look "new" on the next check.
        const fingerprint = fingerprintDataDir(this.rootDir);
        // Keine einzige Datei unter Daten/ und Update/: das steht fest,
        // bevor die erste Tabelle geöffnet wird, und ist bei einem
        // weggelaufenen Bind-Mount die erste ehrliche Auskunft.
        if (fingerprint.files === 0 && this.logger) {
          this.logger.error(
            { root: this.rootDir, trigger, dirs: fingerprint.dirs, checkMs: fingerprint.ms },
            'no data files found under the data root before reading',
          );
        }
        const changeLog = this.trackHistory ? [] : null;
        // One yielder for the whole load: it keeps the HTTP server
        // answering (loading screen, /api/status) while we parse.
        const tick = createYielder();
        const data = await loadAll(this.rootDir, (step) => {
          this.progress = { ...step, startedAt };
        }, { changeLog, tick, report, logger: this.logger });
        this.progress = { stage: 'indexing', name: 'Indizes aufbauen', current: 1, total: 1, startedAt };
        const blobs = this.searchBlobs ? await attachSearchBlobs(data, tick) : null;
        this.history = changeLog
          ? await buildHistory(changeLog, path.join(this.rootDir, 'Update'))
          : null;
        this.data = data;
        this.indexes = buildIndexes(data);
        this.loadedAt = new Date();
        this.fingerprint = fingerprint;
        this.version++;
        const ms = Date.now() - startedAt;
        report.finish();
        this.lastRead = report;
        if (this.logger) {
          this.logger.info(
            {
              ms, blobs, trigger, fingerprint: fingerprint.digest.slice(0, 12),
              history: this.history ? this.history.totals : null, ...this.counts(),
            },
            'data (re)loaded',
          );
          // Die Zeile, die zählt, wenn die Suche nichts mehr findet. Sie
          // sagt nicht nur "leer", sondern warum: kein Daten/, keine
          // Rechte, oder tatsächlich nichts drin.
          const line = { trigger, ...report.toLog(), summary: report.summary };
          if (report.records === 0) {
            this.logger.error(line, 'the data read produced nothing');
          } else if (report.problems.length) {
            this.logger.warn(line, 'the data read had problems');
          } else {
            this.logger.info(line, 'data read complete');
          }
        } else {
          console.log(`Loaded in ${(ms / 1000).toFixed(1)}s — ${report.summary}`);
        }
      } catch (err) {
        report.finish();
        this.lastRead = report;
        if (this.logger) {
          this.logger.error(
            { trigger, err: err.message, code: err.code, ...report.toLog() },
            'the data read was aborted by an error',
          );
        }
        throw err;
      } finally {
        this.progress = null;
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /**
   * Auf ein anderes Datenverzeichnis umstellen.
   *
   * Der bisherige Bestand bleibt stehen, bis der nächste Ladelauf ihn
   * ersetzt: die Suche soll während des Wechsels nicht ins Leere greifen.
   * Der Fingerabdruck wird verworfen, sonst hielte die Prüfung „hat sich
   * etwas geändert?" den fremden Stand für den eigenen und lüde nie.
   *
   * @param {string} rootDir
   * @returns {boolean} ob sich der Pfad überhaupt geändert hat
   */
  setRoot(rootDir) {
    const next = require('path').resolve(rootDir);
    if (next === this.rootDir) return false;
    const previous = this.rootDir;
    this.rootDir = next;
    this.fingerprint = null;
    if (this.logger) this.logger.warn({ from: previous, to: next }, 'data root changed');
    return true;
  }

  /**
   * Whether the configured root actually looks like a KIAS installation.
   *
   * Same question the startup check asks; kept here so `/api/status` and
   * `/api/health` cannot drift apart in their answer.
   *
   * @returns {boolean}
   */
  hasDataRoot() {
    return fs.existsSync(path.join(this.rootDir, 'Daten'));
  }

  /**
   * Reload, but only when the data on disk actually changed.
   *
   * The app is used by several people at once without any login, so the
   * button is pressed far more often than the data changes. Three cases:
   *
   *  - a load is already running: join it, never queue a second one
   *  - the fingerprint matches the last load: skip, answer immediately
   *  - anything else: read as usual
   *
   * @param {{ force?: boolean, trigger?: string }} [opts] `force` re-reads
   *   regardless, for the case where a copy preserved size and timestamps.
   * @returns {Promise<{reloaded:boolean, reason:'in-progress'|'unchanged'|'changed'|'forced'|'initial', files:number, checkMs:number, digest:string}>}
   */
  async reloadIfChanged({ force = false, trigger = 'reload' } = {}) {
    if (this.loading) {
      await this.loading;
      return {
        reloaded: false, reason: 'in-progress',
        files: this.fingerprint ? this.fingerprint.files : 0,
        checkMs: 0,
        digest: this.fingerprint ? this.fingerprint.digest : '',
      };
    }

    const current = fingerprintDataDir(this.rootDir);
    const previous = this.fingerprint;

    if (!force && previous && previous.digest === current.digest) {
      if (this.logger) {
        this.logger.info(
          { trigger, root: this.rootDir, files: current.files, checkMs: current.ms },
          'data unchanged since the last read, skipped',
        );
      }
      return {
        reloaded: false, reason: 'unchanged',
        files: current.files, checkMs: current.ms, digest: current.digest,
      };
    }

    await this.load({ trigger });
    return {
      reloaded: true,
      reason: force ? 'forced' : (previous ? 'changed' : 'initial'),
      files: current.files, checkMs: current.ms, digest: current.digest,
    };
  }

  /**
   * Snapshot of how many rows each table holds.
   *
   * @returns {Record<string, number>}
   */
  counts() {
    if (!this.data) return {};
    return Object.fromEntries(
      Object.entries(this.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
    );
  }

  /**
   * @returns {{
   *   loaded: boolean,
   *   loadedAt: Date|null,
   *   counts: Record<string,number>,
   *   loading: boolean,
   *   progress: { stage:string, name:string, current:number, total:number, elapsedMs:number } | null
   * }}
   */
  stats() {
    const loading = this.loading != null;
    const progress = this.progress
      ? {
          stage: this.progress.stage,
          name: this.progress.name,
          current: this.progress.current,
          total: this.progress.total,
          elapsedMs: Date.now() - this.progress.startedAt,
        }
      : null;
    if (!this.data) {
      return { loaded: false, loadedAt: null, counts: {}, loading, progress };
    }
    return { loaded: true, loadedAt: this.loadedAt, counts: this.counts(), loading, progress };
  }

  // ── History accessors ───────────────────────────────────────────────────

  /**
   * The changelog, newest update first. Empty when history is disabled.
   *
   * @returns {{ enabled:boolean, totals:object|null, updates:Array<object> }}
   */
  changelog() {
    if (!this.history) return { enabled: false, totals: null, updates: [] };
    return { enabled: true, totals: this.history.totals, updates: this.history.updates };
  }

  /**
   * Look up a code the update chain retired, either by withdrawing the
   * bulletin or by renumbering it. Lets a search for a code that no
   * longer resolves explain itself instead of coming back empty.
   *
   * @param {string} code
   * @returns {{kind:'removed'|'renamed', code:string, newCode:string, title:string, date:string, updateSeq:string, updateLabel:string, updateAt:string} | null}
   */
  formerBulletin(code) {
    if (!this.history || !code) return null;
    return this.history.formerByCode.get(String(code).trim().toUpperCase()) || null;
  }

  // ── Flat accessors ──────────────────────────────────────────────────────

  /**
   * All known vehicles, sorted for stable rendering in the UI.
   * @returns {Array<{FZ:string, BEZEICH?:string, INTBEZEICH?:string, VON?:string, BIS?:string}>}
   */
  vehicles() {
    if (!this.data) return [];
    return this.data.fz
      .filter(v => v.FZ)
      .map(v => ({
        FZ: v.FZ,
        BEZEICH: v.BEZEICH,
        INTBEZEICH: v.INTBEZEICH,
        VON: v.VON,
        BIS: v.BIS,
      }))
      .sort((a, b) => (a.POSITION || a.FZ).localeCompare(b.POSITION || b.FZ));
  }

  /**
   * All symptom codes grouped by category.
   * @returns {Array<{KATEGORI:string, entries:Array<object>}>}
   */
  scodes() {
    if (!this.data) return [];
    const byCategory = new Map();
    for (const r of this.data.scode) {
      const cat = r.KATEGORI || '';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(r);
    }
    return [...byCategory.entries()]
      .sort()
      .map(([KATEGORI, entries]) => ({
        KATEGORI,
        entries: entries.slice().sort((a, b) => a.SCODE.localeCompare(b.SCODE)),
      }));
  }

  /**
   * Detail view for a single bulletin. Resolves links to vehicles, repair
   * groups, symptoms, attached forms, keywords, and pre-classified text
   * references (for clickable links in the UI).
   *
   * The reference map is injected via {@link injectReferenceMap} from the
   * caller (server) so Store stays free of search-engine concerns.
   *
   * @param {string} code A_CODE of the bulletin to look up.
   * @param {{ resolveTextReferences?: (text:string)=>Record<string,string|null> }} [opts]
   * @returns {object|null}
   */
  bulletinDetail(code, { resolveTextReferences } = {}) {
    if (!this.indexes) return null;
    const idx = this.indexes;
    const b = idx.aktionByCode.get(code);
    if (!b) return this.retiredBulletinDetail(code, { resolveTextReferences });

    const vehicles = [...(idx.vehiclesByCode.get(code) || [])]
      .map(fz => idx.fzByCode.get(fz) || { FZ: fz });
    const repGrups = [...(idx.repGrupsByCode.get(code) || [])]
      .sort()
      .map(nr => ({ NR: nr, ...(idx.repGrupByNr.get(nr) || {}) }));
    // Die neue Gruppenstruktur steht in einer eigenen Spalte (WREPGRUP)
    // und wird getrennt geliefert, weil die Nummernkreise nicht
    // vergleichbar sind: "12" gegen "414-01". Eine einzelne Zeile in
    // FO_AKT_FZ trägt immer nur eine der beiden Sorten, eine Aktion über
    // ihre Zeilen hinweg aber meistens beide (9.730 von 12.381; 1.610
    // nur alt, 114 nur neu). Der Text der Hauptgruppe kommt aus der
    // Kopfzeile derselben GRUPPE, sonst stünde dort nur die Nummer.
    const repNGrups = [...(idx.repNGrupsByCode.get(code) || [])]
      .sort()
      .map(nr => {
        const row = idx.repNGrupByNr.get(nr) || {};
        return {
          NR: nr,
          CTEXT: row.CTEXT || '',
          GRUPPE: row.GRUPPE || '',
          GRTEXT: idx.repNGrupHeadByGruppe.get(row.GRUPPE) || '',
        };
      });
    const symptoms = [...(idx.symptomsByCode.get(code) || [])]
      .map(s => idx.scodeByCode.get(s) || { SCODE: s });
    const forms = idx.formsByCode.get(code) || [];
    const keywords = idx.keywordsByCode.get(code) || [];
    const saetze = idx.saetzeByCode.get(code) || null;

    /** @type {Record<string, string|null>} */
    let refs = {};
    if (typeof resolveTextReferences === 'function') {
      const allText = [
        b.K_BEZEICH, b.BAUZEIT, b.BESCHREIB, b.VERGUETUNG,
        b.VERCODUNG, b.ARBZEIT, b.ETEILE, b.NACHFASS,
      ].filter(v => typeof v === 'string' && v).join('\n');
      refs = resolveTextReferences(allText);
    }

    return { ...b, saetze, vehicles, repGrups, repNGrups, symptoms, forms, keywords, refs };
  }

  /**
   * Detail view for a bulletin the update chain retired. Serves the last
   * known record straight from the history, so the full text stays
   * readable even though the code no longer resolves. The linked data
   * (vehicles, symptoms, forms) went with the same update, hence empty.
   *
   * @param {string} code
   * @param {{ resolveTextReferences?: (text:string)=>Record<string,string|null> }} [opts]
   * @returns {object|null}
   */
  retiredBulletinDetail(code, { resolveTextReferences } = {}) {
    const former = this.formerBulletin(code);
    if (!former || !former.record) return null;
    const b = former.record;

    let refs = {};
    if (typeof resolveTextReferences === 'function') {
      const allText = [
        b.K_BEZEICH, b.BAUZEIT, b.BESCHREIB, b.VERGUETUNG,
        b.VERCODUNG, b.ARBZEIT, b.ETEILE, b.NACHFASS,
      ].filter(v => typeof v === 'string' && v).join('\n');
      refs = resolveTextReferences(allText);
    }

    const { record, ...meta } = former;
    return {
      ...b,
      A_CODE: former.code,
      saetze: null,
      vehicles: [], repGrups: [], symptoms: [], forms: [], keywords: [],
      refs,
      former: meta,
    };
  }
}

module.exports = { Store };
