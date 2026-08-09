/**
 * Derived "search blob" column.
 *
 * Every free-text query used to lowercase each string field of every row
 * again (12k bulletins + 216k link rows + 60k symptoms = a few million
 * throwaway strings per keystroke). Instead we compute one lowercased
 * concatenation of a row's string fields once per load, and let the search
 * engine use it as a cheap pre-filter: if the blob does not contain the
 * query, no field can, so the per-field scan is skipped entirely.
 *
 * The blob is attached as a NON-ENUMERABLE property. That matters:
 *   - `Object.keys(rec)` (used by the field scan and snippet builder)
 *     does not see it, so match results stay byte-identical.
 *   - `{ ...rec }` and `JSON.stringify(rec)` do not copy it, so API
 *     responses are unchanged.
 *
 * Fields are joined with "\n", so the blob is a superset of each single
 * field's text: a query that matches a field always matches the blob
 * (no false negatives). A match spanning two concatenated fields is a
 * false positive, which the subsequent per-field scan filters out.
 *
 * @module data/SearchBlob
 */

'use strict';

/** Property name of the derived column. Non-enumerable, see module docs. */
const BLOB_KEY = '__blob';

/**
 * Lowercased concatenation of all string fields of a row.
 *
 * @param {object} rec
 * @returns {string}
 */
function blobOf(rec) {
  let out = '';
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (typeof v === 'string' && v) out += out ? '\n' + v : v;
  }
  return out.toLowerCase();
}

/**
 * Attach the derived blob to every row of every table in a loaded dataset.
 * Idempotent: re-attaching after a reload overwrites the old value.
 *
 * @param {import('./Indexes').StoreData} data
 * @returns {{ rows:number, bytes:number }} Rows touched and blob characters held.
 */
function attachSearchBlobs(data) {
  let rows = 0;
  let bytes = 0;
  for (const table of Object.values(data)) {
    if (!Array.isArray(table)) continue;
    for (const rec of table) {
      if (!rec || typeof rec !== 'object') continue;
      const blob = blobOf(rec);
      Object.defineProperty(rec, BLOB_KEY, {
        value: blob,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      rows++;
      bytes += blob.length;
    }
  }
  return { rows, bytes };
}

module.exports = { attachSearchBlobs, blobOf, BLOB_KEY };
