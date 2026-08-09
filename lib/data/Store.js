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

const { loadAll } = require('../loader');
const { buildIndexes } = require('./Indexes');
const { attachSearchBlobs } = require('./SearchBlob');

class Store {
  /**
   * @param {string} rootDir Absolute path to the directory containing
   *   Daten/, Update/ and Formulare/.
   * @param {{ logger?: import('pino').BaseLogger, searchBlobs?: boolean }} [opts]
   */
  constructor(rootDir, { logger, searchBlobs = true } = {}) {
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
     * Bumped on every completed load. Collaborators that cache derived
     * results (e.g. SearchEngine) compare against it to know when their
     * cache went stale.
     * @type {number}
     */
    this.version = 0;
  }

  /**
   * Read all DBF files, apply deltas, and rebuild indexes.
   *
   * Concurrent callers share the same promise so we never start two loads
   * in parallel.
   *
   * @returns {Promise<void>}
   */
  async load() {
    if (this.loading) return this.loading;
    const startedAt = Date.now();
    this.progress = { stage: 'starting', name: '', current: 0, total: 1, startedAt };
    this.loading = (async () => {
      try {
        const data = await loadAll(this.rootDir, (step) => {
          this.progress = { ...step, startedAt };
        });
        this.progress = { stage: 'indexing', name: 'Indizes aufbauen', current: 1, total: 1, startedAt };
        const blobs = this.searchBlobs ? attachSearchBlobs(data) : null;
        this.data = data;
        this.indexes = buildIndexes(data);
        this.loadedAt = new Date();
        this.version++;
        const ms = Date.now() - startedAt;
        if (this.logger) {
          this.logger.info({ ms, blobs, ...this.counts() }, 'data (re)loaded');
        } else {
          console.log(`Loaded in ${(ms / 1000).toFixed(1)}s`);
        }
      } finally {
        this.progress = null;
        this.loading = null;
      }
    })();
    return this.loading;
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
    if (!b) return null;

    const vehicles = [...(idx.vehiclesByCode.get(code) || [])]
      .map(fz => idx.fzByCode.get(fz) || { FZ: fz });
    const repGrups = [...(idx.repGrupsByCode.get(code) || [])]
      .map(nr => ({ NR: nr, ...(idx.repGrupByNr.get(nr) || {}) }));
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

    return { ...b, saetze, vehicles, repGrups, symptoms, forms, keywords, refs };
  }
}

module.exports = { Store };
