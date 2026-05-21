/**
 * Maps free-text references (e.g. "TSI 62/2007", "OASIS BCM 2426") to
 * actual bulletin A_CODEs in the loaded dataset.
 *
 * The KIAS bulletin codes don't follow a single convention — `TSI 62/2007`
 * might be stored as `062/2007` (zero-padded), `Aktion 24-7074` as plain
 * `24-7074`, etc. The resolver tries exact + variant + fuzzy matching to
 * cover all observed forms.
 *
 * Used by `/api/resolve?ref=…` and indirectly by Store.bulletinDetail
 * to pre-resolve every doc-style reference in a bulletin's free text.
 *
 * @module search/ReferenceResolver
 */

'use strict';

const { REFERENCE_PATTERN, REF_DOC_PREFIX } = require('./patterns');

class ReferenceResolver {
  /**
   * @param {import('../data/Store').Store} store
   */
  constructor(store) {
    this.store = store;
  }

  /**
   * Try to resolve a single reference string to a real A_CODE.
   * Returns the A_CODE on hit, or null when nothing matches.
   *
   * @param {string} rawText
   * @returns {string|null}
   */
  resolveReference(rawText) {
    if (!rawText || !this.store.indexes) return null;
    const aktionByCode = this.store.indexes.aktionByCode;
    const text = String(rawText).trim();

    const candidates = this._buildCandidateList(text);

    // Phase 1: exact match against the bulletin index.
    for (const c of candidates) {
      if (aktionByCode.has(c)) return c;
    }

    // Phase 2: fuzzy match against all A_CODEs.
    const stripped = text
      .replace(REF_DOC_PREFIX, '')
      .trim();
    if (stripped.length < 3) return null;

    const lower = stripped.toLowerCase();
    const lowerNoSpace = lower.replace(/\s+/g, '');
    const codes = [...aktionByCode.keys()];

    // Prefer codes ending with the reference (e.g. ref "62/07" → "X62/07")
    const endsWith = codes.find(c =>
      c.toLowerCase().endsWith(lower) ||
      c.toLowerCase().endsWith(lowerNoSpace),
    );
    if (endsWith) return endsWith;

    // Last resort: contains anywhere
    return codes.find(c => c.toLowerCase().includes(lower)) || null;
  }

  /**
   * Scan free text for every doc-style reference and resolve each one.
   * Returns a `{ refText: A_CODE | null }` map used by the client to
   * decide whether to render each ref as a real link, a self-reference,
   * or plain text.
   *
   * Only doc-style refs are resolved here; DTC and attachment refs are
   * handled entirely on the client (DTC → cross-table search;
   * attachment → bulletin's own form).
   *
   * @param {string} text
   * @returns {Record<string, string|null>}
   */
  resolveTextReferences(text) {
    if (!text || !this.store.indexes) return {};
    /** @type {Record<string, string|null>} */
    const out = {};
    const re = new RegExp(REFERENCE_PATTERN.source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const ref = m[0];
      if (Object.prototype.hasOwnProperty.call(out, ref)) continue;
      if (!REF_DOC_PREFIX.test(ref)) continue;
      // Doc refs without a digit in the code part are almost always false
      // positives ("TSI wird ersetzt", "Aktion ist…").
      const code = ref.replace(REF_DOC_PREFIX, '').trim();
      if (!/\d/.test(code)) continue;
      out[ref] = this.resolveReference(ref);
    }
    return out;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Build the list of candidate A_CODEs to try in order. Generates the
   * verbatim ref, the stripped code, plus common separator variants
   * (slash↔dash) and the no-space form.
   *
   * @private
   * @param {string} text
   * @returns {Set<string>}
   */
  _buildCandidateList(text) {
    /** @type {Set<string>} */
    const tries = new Set();
    const add = (v) => {
      if (!v) return;
      const t = String(v).trim();
      if (t) tries.add(t);
    };

    add(text);
    const stripped = text.replace(REF_DOC_PREFIX, '').trim();
    add(stripped);

    for (const base of [text, stripped]) {
      if (!base) continue;
      add(base.replace(/\//g, '-'));
      add(base.replace(/-/g, '/'));
      add(base.replace(/\s+/g, ''));
    }
    return tries;
  }
}

module.exports = { ReferenceResolver };
