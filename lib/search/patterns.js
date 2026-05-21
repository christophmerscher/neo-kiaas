/**
 * Reference-pattern definitions shared by the server-side resolver and
 * (in spirit) the client's LinkedText component.
 *
 * The combined {@link REFERENCE_PATTERN} catches every kind of inline
 * reference we recognise in bulletin text — diagnostic-trouble codes,
 * cross-references to other bulletins, and pointers to attached forms.
 * Individual {@link REF_DTC}, {@link REF_DOC}, etc. patterns are exposed
 * so callers can re-test a match to classify it.
 *
 * @module search/patterns
 */

'use strict';

/** Diagnostic Trouble Code, e.g. P2002, U014000, B14DA. */
const REF_DTC = /\b[PBCU][0-9A-F]{4,7}\b/;

/**
 * Reference to another bulletin by document type. Captures `TSI 62/2007`,
 * `OASIS BCM 2426`, `Aktion Nr. 24-7074`, `Bulletin 12345`, …
 */
const REF_DOC = /\b(?:TSI|OASIS(?:\s+BCM)?|GSB|SSM|FSA|TI|TSB|Aktion|Bulletin|Service[\s-]?Aktion|SA)\s+(?:Nr\.?\s*)?[A-Z0-9](?:[\w./-]*[\w/-])?/;

/** A numbered attachment reference, e.g. `Formular 3`, `Anhang 2.1`. */
const REF_NUM_ATTACH = /\b(?:Formular|Anhang|Anlage|Abbildung|Bild|Anzeige)\s+\d+(?:[.\-]\d+)?/;

/** Generic "siehe ..." attachment pointer without an explicit number. */
const REF_SIEHE = /\b(?:siehe|s\.|sh\.|vgl\.)\s+(?:Abbildung|Anhang|Anlage|Anzeige|Bild|Formular|original\s+Information(?:en)?)/;

/**
 * Combined pattern used to scan free text. Always returned with the `gi`
 * flag — call `.lastIndex = 0` between scans or build a fresh `RegExp`
 * from `.source` if you need a non-stateful instance.
 */
const REFERENCE_PATTERN = new RegExp(
  [REF_DTC.source, REF_DOC.source, REF_NUM_ATTACH.source, REF_SIEHE.source].join('|'),
  'gi',
);

/** Strips the document-type prefix from a doc-style ref (`TSI 62/2007` → `62/2007`). */
const REF_DOC_PREFIX = /^(?:TSI|OASIS(?:\s+BCM)?|GSB|SSM|FSA|TI|TSB|Aktion|Bulletin|Service[\s-]?Aktion|SA)\s+(?:Nr\.?\s*)?/i;

module.exports = {
  REF_DTC,
  REF_DOC,
  REF_NUM_ATTACH,
  REF_SIEHE,
  REFERENCE_PATTERN,
  REF_DOC_PREFIX,
};
