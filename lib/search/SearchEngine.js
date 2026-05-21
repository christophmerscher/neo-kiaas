/**
 * Bulletin search engine.
 *
 * Implements the cross-table free-text query used by `/api/bulletins`:
 *   - Scans the bulletin's own string fields (BESCHREIB, VERCODUNG, …).
 *   - Joins to scode / formulare / schlagwort / vehicle / repair-group
 *     tables so that "P2002" finds bulletins whose linked SCBEZEICH is
 *     "P2002", and "Mondeo" finds bulletins that touch any FZ named
 *     "Mondeo" — even when the bulletin record itself doesn't mention
 *     the term verbatim.
 *
 * Designed to be cheap: every query walks each table once with a hand-
 * rolled string scan. 12k bulletins × ~10 fields fits well under 200ms
 * cold and < 20ms warm.
 *
 * @module search/SearchEngine
 */

'use strict';

const path = require('path');

/**
 * Trim and shorten a string to a snippet length, appending ellipsis.
 * @param {string} s
 * @param {number} [max=80]
 */
function truncate(s, max = 80) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * For static lookup tables (HTN, KBC, …) we don't know which foreign key
 * a row carries. Try each candidate field in order — whichever we have
 * an index for wins.
 *
 * @param {object} rec        Row from one of the static lookup DBFs.
 * @param {Map<string,Set<string>>} aCodesByFz
 * @param {Map<string,Set<string>>} aCodesByScode
 * @param {Map<string,Set<string>>} aCodesByRepGrup
 * @returns {Array<string>}   Bulletin A_CODEs this row maps to (deduped).
 */
function linkByAnyKey(rec, aCodesByFz, aCodesByScode, aCodesByRepGrup) {
  if (rec.A_CODE) return [rec.A_CODE];
  const out = new Set();
  if (rec.FZ && aCodesByFz.has(rec.FZ))
    for (const c of aCodesByFz.get(rec.FZ)) out.add(c);
  if (rec.SCODE && aCodesByScode.has(rec.SCODE))
    for (const c of aCodesByScode.get(rec.SCODE)) out.add(c);
  if (rec.REPGRUP && aCodesByRepGrup.has(rec.REPGRUP))
    for (const c of aCodesByRepGrup.get(rec.REPGRUP)) out.add(c);
  if (rec.NR && aCodesByRepGrup.has(rec.NR))
    for (const c of aCodesByRepGrup.get(rec.NR)) out.add(c);
  return [...out];
}

class SearchEngine {
  /**
   * @param {import('../data/Store').Store} store
   */
  constructor(store) {
    /** @type {import('../data/Store').Store} */
    this.store = store;
  }

  /**
   * @typedef {Object} ListOptions
   * @property {string} [q]        Free-text search across all tables.
   * @property {string} [fz]       Exact FZ vehicle filter.
   * @property {string} [scode]    Exact symptom-code filter.
   * @property {string} [keyword]  Schlagwort substring filter.
   * @property {string} [yearFrom] Lower bound for A_DAT year.
   * @property {string} [yearTo]   Upper bound for A_DAT year.
   * @property {number} [limit=100]
   * @property {number} [offset=0]
   */

  /**
   * Run a search.
   *
   * @param {ListOptions} [opts]
   * @returns {{ total:number, offset:number, limit:number, results:Array<object> }}
   */
  listBulletins({
    q = '', fz = '', scode = '', keyword = '',
    yearFrom = '', yearTo = '', limit = 100, offset = 0,
  } = {}) {
    if (!this.store.data || !this.store.indexes) {
      return { total: 0, offset, limit, results: [] };
    }

    const idx = this.store.indexes;
    const qLower = q.toLowerCase().trim();
    const keywordLower = keyword.toLowerCase().trim();

    const { textCodeMatches, textHitInfo } = qLower
      ? this._scanLinkedTables(qLower)
      : { textCodeMatches: null, textHitInfo: new Map() };

    const results = [];
    for (const b of this.store.data.aktion) {
      if (!b.A_CODE) continue;

      // Hard filters first — these short-circuit the full-text scan.
      if (fz) {
        const set = idx.vehiclesByCode.get(b.A_CODE);
        if (!set || !set.has(fz)) continue;
      }
      if (scode) {
        const set = idx.symptomsByCode.get(b.A_CODE);
        if (!set || !set.has(scode)) continue;
      }
      if (keywordLower) {
        const kws = idx.keywordsByCode.get(b.A_CODE) || [];
        if (!kws.some(k => k.toLowerCase().includes(keywordLower))) continue;
      }
      if (yearFrom || yearTo) {
        const y = (b.A_DAT || '').slice(0, 4);
        if (yearFrom && y < yearFrom) continue;
        if (yearTo && y > yearTo) continue;
      }

      let snippet = null;
      if (qLower) {
        const direct = this._scanRecord(b, qLower);
        if (direct) {
          snippet = direct;
        } else if (textCodeMatches.has(b.A_CODE)) {
          snippet = textHitInfo.get(b.A_CODE) || null;
        } else {
          continue;  // text-mode but nothing matched → skip
        }
      }
      results.push({ b, snippet });
    }

    results.sort((a, b) => (b.b.A_DAT || '').localeCompare(a.b.A_DAT || ''));
    const total = results.length;
    const page = results
      .slice(offset, offset + limit)
      .map(({ b, snippet }) => ({
        A_CODE: b.A_CODE,
        A_DAT: b.A_DAT,
        N_ART: b.N_ART,
        K_BEZEICH: b.K_BEZEICH,
        HILF_NR: b.HILF_NR,
        BAUZEIT: b.BAUZEIT,
        vehicles: [...(idx.vehiclesByCode.get(b.A_CODE) || [])],
        forms: (idx.formsByCode.get(b.A_CODE) || []).length,
        snippet,
      }));

    return { total, offset, limit, results: page };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Scan a single bulletin's string fields for a substring. Returns a
   * trimmed snippet around the match, or null if none.
   *
   * @private
   * @param {object} record
   * @param {string} qLower lowercased query
   * @returns {string|null}
   */
  _scanRecord(record, qLower) {
    for (const field of Object.keys(record)) {
      const value = record[field];
      if (typeof value !== 'string' || !value) continue;
      const lower = value.toLowerCase();
      const idx = lower.indexOf(qLower);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 40);
      const end = Math.min(value.length, idx + qLower.length + 80);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < value.length ? '…' : '';
      return prefix + value.slice(start, end).replace(/\s+/g, ' ').trim() + suffix;
    }
    return null;
  }

  /**
   * Scan every "linked" table (vehicles, scodes, schlagworte, formulare,
   * static lookups) for a substring. Returns the set of bulletin A_CODEs
   * each of these matches projects to, plus a human-readable "where it
   * matched" snippet keyed by A_CODE.
   *
   * @private
   * @param {string} qLower lowercased query
   * @returns {{ textCodeMatches: Set<string>, textHitInfo: Map<string,string> }}
   */
  _scanLinkedTables(qLower) {
    const idx = this.store.indexes;
    const data = this.store.data;
    const textCodeMatches = new Set();
    const textHitInfo = new Map();

    const addHits = (aCodes, descBuilder) => {
      for (const code of aCodes) {
        if (!code) continue;
        textCodeMatches.add(code);
        if (!textHitInfo.has(code)) textHitInfo.set(code, descBuilder(code));
      }
    };

    const firstMatch = (rec) => {
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        if (typeof v === 'string' && v && v.toLowerCase().includes(qLower)) {
          return { field: k, value: v };
        }
      }
      return null;
    };

    /**
     * Table descriptor:
     *   - label: human-readable name for the snippet
     *   - src: rows array
     *   - getCodes: maps a row to bulletin A_CODEs
     *   - refLabel: optional secondary label (e.g. "Symptomcode 1620020")
     */
    const tables = [
      { name: 'aktFz',      label: 'Fahrzeug-Verknüpfung', src: data.aktFz,
        getCodes: r => r.A_CODE ? [r.A_CODE] : [] },
      { name: 'formulare',  label: 'Formular',             src: data.formulare,
        getCodes: r => r.A_CODE ? [r.A_CODE] : [] },
      { name: 'symptom',    label: 'Symptom',              src: data.symptom,
        getCodes: r => r.A_CODE ? [r.A_CODE] : [] },
      { name: 'saetze',     label: 'Satz',                 src: data.saetze,
        getCodes: r => r.A_CODE ? [r.A_CODE] : [] },
      { name: 'schlagwort', label: 'Schlagwort',           src: data.schlagwort,
        getCodes: r => r.A_CODE ? [r.A_CODE] : [] },
      { name: 'scode',      label: 'Symptomcode',          src: data.scode,
        getCodes: r => r.SCODE ? [...(idx.aCodesByScode.get(r.SCODE) || [])] : [],
        refLabel: r => `${r.SCODE}${r.SCBEZEICH ? ' — ' + r.SCBEZEICH : ''}` },
      { name: 'fz',         label: 'Fahrzeug',             src: data.fz,
        getCodes: r => r.FZ ? [...(idx.aCodesByFz.get(r.FZ) || [])] : [],
        refLabel: r => `${r.FZ}${r.INTBEZEICH || r.BEZEICH ? ' — ' + (r.INTBEZEICH || r.BEZEICH) : ''}` },
      { name: 'repGrup',    label: 'Reparaturgruppe',      src: data.repGrup,
        getCodes: r => r.NR ? [...(idx.aCodesByRepGrup.get(r.NR) || [])] : [],
        refLabel: r => `${r.NR}${r.BEZEICH ? ' — ' + r.BEZEICH : ''}` },
      { name: 'repNGrup',   label: 'Rep.-Untergruppe',     src: data.repNGrup,
        getCodes: r => r.NR ? [...(idx.aCodesByRepGrup.get(r.NR) || [])] : [] },
      { name: 'rep2Grup',   label: 'Reparatur-2-Gruppe',   src: data.rep2Grup || [],
        getCodes: r => r.NR ? [...(idx.aCodesByRepGrup.get(r.NR) || [])] : [] },
      // Static lookup tables: link by whichever FK they carry.
      { name: 'htn',        label: 'HTN',                  src: data.htn || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
      { name: 'htnGrup',    label: 'HTN-Gruppe',           src: data.htnGrup || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
      { name: 'htnRepg',    label: 'HTN-Rep.-Gruppe',      src: data.htnRepg || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
      { name: 'kbc',        label: 'KBC',                  src: data.kbc || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
      { name: 'kbcGrup',    label: 'KBC-Gruppe',           src: data.kbcGrup || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
      { name: 'kbcHgrup',   label: 'KBC-Hauptgruppe',      src: data.kbcHgrup || [],
        getCodes: r => linkByAnyKey(r, idx.aCodesByFz, idx.aCodesByScode, idx.aCodesByRepGrup) },
    ];

    for (const t of tables) {
      for (const rec of t.src) {
        const m = firstMatch(rec);
        if (!m) continue;
        const codes = t.getCodes(rec);
        if (codes.length === 0) continue;
        const ref = t.refLabel ? t.refLabel(rec) : null;
        addHits(codes, () =>
          `${t.label}${ref ? ' ' + ref : ''} [${m.field}]: ${truncate(m.value)}`,
        );
      }
    }

    return { textCodeMatches, textHitInfo };
  }
}

module.exports = { SearchEngine };
